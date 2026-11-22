#!/usr/bin/env python3
"""
project.py — Reconcile REC.kml + data/raw/campus_osm.geojson + SRTM 5 m elevation
into projected metric coordinates and write public/campus.json.

Coordinate system (PLAN.md §3 & §4):
  - Origin [LON0, LAT0] = campus centroid [80.0036, 13.0088]
  - +X = East (metres), -Z = North (metres), +Z = South (metres)
  - north_deg = -1.8 (true campus axis bearing relative to due E-W grid)
"""

from __future__ import annotations
import json
import math
import pathlib
import random
import xml.etree.ElementTree as ET
from fetch_elevation import build_elevation_grid

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
PUBLIC_DIR = ROOT / "public"
KML_PATH = RAW_DIR / "REC.kml"
OSM_GEOJSON_PATH = RAW_DIR / "campus_osm.geojson"
DEM_CACHE_PATH = RAW_DIR / "srtm_rec_dem.json"
OUT_CAMPUS_JSON = PUBLIC_DIR / "campus.json"

LON0, LAT0 = 80.0036, 13.0088
MX = 111320.0 * math.cos(math.radians(LAT0))
MY = 111320.0
HALF_W, HALF_D, CELL = 360.0, 400.0, 5.0


def project(lon: float, lat: float) -> tuple[float, float]:
    return (round((lon - LON0) * MX, 2), round(-(lat - LAT0) * MY, 2))


def poly_signed_area(pts: list[list[float]]) -> float:
    area = 0.0
    n = len(pts)
    for i in range(n):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % n]
        area += x1 * z2 - x2 * z1
    return 0.5 * area


def ensure_ccw_2d(pts: list[list[float]]) -> list[list[float]]:
    """Ensure consistent winding for THREE.Shape((x, -z))."""
    if poly_signed_area(pts) > 0:
        return list(reversed(pts))
    return pts


def make_ngon(cx: float, cz: float, rx: float, rz: float, n: int = 12) -> list[list[float]]:
    pts = [
        [round(cx + math.cos(2 * math.pi * i / n) * rx, 2), round(cz + math.sin(2 * math.pi * i / n) * rz, 2)]
        for i in range(n)
    ]
    return ensure_ccw_2d(pts)


def make_rotated_rect(cx: float, cz: float, hw: float, hd: float, angle_rad: float) -> list[list[float]]:
    ca, sa = math.cos(angle_rad), math.sin(angle_rad)
    corners = [(-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd)]
    pts = [
        [round(cx + x * ca - z * sa, 2), round(cz + x * sa + z * ca, 2)]
        for x, z in corners
    ]
    return ensure_ccw_2d(pts)


def rdp(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    if len(pts) < 3:
        return pts
    x1, y1 = pts[0]
    x2, y2 = pts[-1]
    dx, dy = x2 - x1, y2 - y1
    denom = math.hypot(dx, dy)
    dmax, idx = 0.0, 0
    for i in range(1, len(pts) - 1):
        px, py = pts[i]
        d = math.hypot(px - x1, py - y1) if denom == 0 else abs(dy * px - dx * py + x2 * y1 - y2 * x1) / denom
        if d > dmax:
            dmax, idx = d, i
    if dmax > eps:
        left = rdp(pts[: idx + 1], eps)
        right = rdp(pts[idx:], eps)
        return left[:-1] + right
    return [pts[0], pts[-1]]


def segs_intersect(a: list[float], b: list[float], c: list[float], d: list[float]) -> bool:
    def ccw(p1: list[float], p2: list[float], p3: list[float]) -> float:
        return (p2[0] - p1[0]) * (p3[1] - p1[1]) - (p2[1] - p1[1]) * (p3[0] - p1[0])

    d1, d2 = ccw(a, b, c), ccw(a, b, d)
    d3, d4 = ccw(c, d, a), ccw(c, d, b)
    return (d1 * d2 < -1e-6) and (d3 * d4 < -1e-6)


def clean_polygon(raw_coords: list[tuple[float, float]], eps: float = 0.9) -> list[list[float]]:
    pts = list(raw_coords)
    if len(pts) > 1 and math.hypot(pts[0][0] - pts[-1][0], pts[0][1] - pts[-1][1]) < 0.25:
        pts = pts[:-1]

    dedup: list[tuple[float, float]] = []
    for p in pts:
        if not dedup or math.hypot(p[0] - dedup[-1][0], p[1] - dedup[-1][1]) >= 0.45:
            dedup.append(p)
    if len(dedup) < 3:
        return [[round(x, 2), round(z, 2)] for x, z in raw_coords[:3]]

    closed = dedup + [dedup[0]]
    simp = rdp(closed, eps)[:-1]
    if len(simp) < 3:
        simp = dedup

    cleaned = [[round(x, 2), round(z, 2)] for x, z in simp]
    changed = True
    while changed and len(cleaned) > 3:
        changed = False
        n = len(cleaned)
        for i in range(n):
            p_prev = cleaned[(i - 1) % n]
            p_curr = cleaned[i]
            p_next = cleaned[(i + 1) % n]
            v1 = (p_prev[0] - p_curr[0], p_prev[1] - p_curr[1])
            v2 = (p_next[0] - p_curr[0], p_next[1] - p_curr[1])
            l1, l2 = math.hypot(*v1), math.hypot(*v2)
            if l1 < 0.6 or l2 < 0.6:
                cleaned.pop(i)
                changed = True
                break
            cos_ang = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2)
            if cos_ang > 0.94 or cos_ang < -0.995:
                cleaned.pop(i)
                changed = True
                break

    for _ in range(10):
        n = len(cleaned)
        crossed = False
        for i in range(n):
            a, b = cleaned[i], cleaned[(i + 1) % n]
            for j in range(i + 2, n):
                if i == 0 and j == n - 1:
                    continue
                c, d = cleaned[j], cleaned[(j + 1) % n]
                if segs_intersect(a, b, c, d):
                    if (j - i) <= n // 2:
                        del cleaned[i + 1 : j + 1]
                    else:
                        cleaned = cleaned[i + 1 : j + 1]
                    crossed = True
                    break
            if crossed:
                break
        if not crossed:
            break

    return ensure_ccw_2d(cleaned)


def point_in_poly(x: float, z: float, poly: list[list[float]]) -> bool:
    inside = False
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, zi = poly[i]
        xj, zj = poly[j]
        if ((zi > z) != (zj > z)) and (x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def dist_point_to_seg(px: float, pz: float, ax: float, az: float, bx: float, bz: float) -> float:
    dx, dz = bx - ax, bz - az
    l2 = dx * dx + dz * dz
    if l2 < 1e-9:
        return math.hypot(px - ax, pz - az)
    t = max(0.0, min(1.0, ((px - ax) * dx + (pz - az) * dz) / l2))
    return math.hypot(px - (ax + t * dx), pz - (az + t * dz))


def parse_kml() -> tuple[dict[str, list[tuple[float, float]]], list[tuple[str, list[tuple[float, float]]]]]:
    tree = ET.parse(KML_PATH)
    ns = {"kml": "http://www.opengis.net/kml/2.2"}
    polys: dict[str, list[tuple[float, float]]] = {}
    lines: list[tuple[str, list[tuple[float, float]]]] = []
    for pm in tree.getroot().findall(".//kml:Placemark", ns):
        name_el = pm.find("kml:name", ns)
        name = name_el.text.strip() if name_el is not None and name_el.text else "unnamed"
        coords_el = pm.find(".//kml:coordinates", ns)
        if coords_el is None or not coords_el.text:
            continue
        pts = [
            project(float(tok.split(",")[0]), float(tok.split(",")[1]))
            for tok in coords_el.text.strip().split()
        ]
        if pm.find(".//kml:Polygon", ns) is not None:
            if name == "I Block to Idea Factory":
                lines.append((name, pts[:2]))
            else:
                polys[name] = pts
        elif pm.find(".//kml:LineString", ns) is not None:
            lines.append((name, pts))
    return polys, lines


def parse_osm() -> tuple[dict[str, list[tuple[float, float]]], list[dict]]:
    gj = json.loads(OSM_GEOJSON_PATH.read_text(encoding="utf-8"))
    named_polys: dict[str, list[tuple[float, float]]] = {}
    features = gj.get("features", [])
    for feat in features:
        props = feat.get("properties", {})
        geom = feat.get("geometry", {})
        if geom.get("type") == "Polygon":
            ring = [project(c[0], c[1]) for c in geom["coordinates"][0]]
            if "name" in props:
                named_polys[props["name"]] = ring
    return named_polys, features


def sample_grid_elev(elev: dict, x: float, z: float) -> float:
    cell = elev["cell"]
    grid = elev["grid"]
    rows, cols = len(grid), len(grid[0])
    u = (x + HALF_W) / cell
    v = (z + HALF_D) / cell
    u = max(0.0, min(cols - 1.001, u))
    v = max(0.0, min(rows - 1.001, v))
    ic, ir = int(u), int(v)
    du, dv = u - ic, v - ir
    z00, z10 = grid[ir][ic], grid[ir][ic + 1]
    z01, z11 = grid[ir + 1][ic], grid[ir + 1][ic + 1]
    return (1 - du) * (1 - dv) * z00 + du * (1 - dv) * z10 + (1 - du) * dv * z01 + du * dv * z11


def main() -> None:
    kml_polys, _ = parse_kml()
    osm_polys, osm_features = parse_osm()
    dem = json.loads(DEM_CACHE_PATH.read_text(encoding="utf-8"))
    elevation = build_elevation_grid(dem, LON0, LAT0, cell=CELL, half_width_m=HALF_W, half_depth_m=HALF_D)

    # Curated Teachers Hostel / Faculty Quarters stepped U-footprint (de-spiked from KML)
    teachers_clean = ensure_ccw_2d([
        [204.1, -230.9], [208.1, -207.3], [266.4, -216.8], [264.2, -230.5],
        [229.8, -225.2], [227.4, -233.9], [288.8, -244.6], [286.0, -260.0],
        [216.8, -251.7], [203.3, -243.2],
    ])

    white_stairs_pts = None
    pickle_pts = None
    parkwiz1_pts = None
    parkwiz2_pts = None
    for feat in osm_features:
        p = feat["properties"]
        g = feat["geometry"]
        if g["type"] == "Polygon":
            ring = [project(c[0], c[1]) for c in g["coordinates"][0]]
            if p.get("name") == "White Stairs":
                white_stairs_pts = ring
            elif p.get("name") == "Pickle Ball Court":
                pickle_pts = ring
            elif p.get("name") == "PARKWIZ 1":
                parkwiz1_pts = ring
            elif p.get("name") == "PARKWIZ 2":
                parkwiz2_pts = ring

    # Distinct separated footprints for Workshop Lab 2 (west, next to C Block) & Workshop Lab 1 (east) — shortened by 1/4th in length (~50.5 m)
    workshop_2_poly = ensure_ccw_2d([
        [-73.5, 68.6], [-58.2, 68.3], [-57.0, 118.8], [-72.2, 119.1],
    ])
    workshop_1_poly = ensure_ccw_2d([
        [-54.4, 68.1], [-38.4, 67.8], [-37.4, 118.5], [-53.2, 118.8],
    ])

    # Clean C-Block footprint set well back from both west road (x=-104) and south road (z=146.5)
    c_block_poly = ensure_ccw_2d([
        [-94.5, 83.5], [-77.8, 83.2], [-76.8, 134.0], [-93.5, 134.3],
    ])

    # Proper square TPT Dept & EB Block (24m x 24m)
    tpt_square_poly = make_rotated_rect(214.0, -54.0, hw=12.0, hd=12.0, angle_rad=math.radians(-3.5))

    # Proper square Maggi Hotspot kiosk (6.8m x 6.8m) beside B-Block courtyard cobblestone path
    maggi_square_poly = make_rotated_rect(-23.5, 2.0, hw=3.4, hd=3.4, angle_rad=math.radians(6.0))

    # Larger REC Mart footprint (13.6m x 9.6m) right next to the central N-S road
    rec_mart_poly = ensure_ccw_2d([
        [6.4, 24.2], [20.0, 24.2], [20.0, 33.8], [6.4, 33.8],
    ])

    # Expanded 6th Sense Garden / Garden Cafe botanical compound
    sixth_sense_garden_poly = ensure_ccw_2d([
        [197.5, -109.0], [233.0, -109.0], [233.0, -71.0], [197.5, -71.0],
    ])

    # Bigger open-ish Hut Cafe footprint inside the Hut Cafe compound
    hut_cafe_poly = ensure_ccw_2d([
        [-23.5, 63.2], [14.5, 64.2], [13.5, 89.5], [-24.5, 88.2],
    ])

    # Main Security Gate Arch spanning across the entrance road at (-141.5, -202.0)
    gate_arch_poly = make_rotated_rect(-141.5, -202.0, hw=7.2, hd=2.4, angle_rad=math.radians(-42.0))
    # NH-48 Highway Entrance Arch spanning the approach road at (-345.5, -395.5)
    hw_arch_poly = make_rotated_rect(-345.5, -395.5, hw=7.5, hd=2.5, angle_rad=math.radians(-30.0))

    # Aadhi Statue centered inside the roundabout at (-40.2, -65.5)
    aadhi_poly = make_ngon(-40.2, -65.5, rx=4.2, rz=4.2, n=8)

    # A Block Fountain centered inside the north A-Block carriage loop at (76.2, -111.0)
    fountain_poly = make_ngon(76.2, -111.0, rx=5.2, rz=4.2, n=12)

    # Swimming Pool surrounding deck & enclosure structure around KML Swimming Pool [156.9..176.7, -34.0..5.0]
    pool_enclosure_poly = ensure_ccw_2d([
        [152.5, -38.5], [181.0, -38.5], [181.0, 9.2], [152.5, 9.2],
    ])

    # Reconciled Campus Buildings with exact user-specified heights & floor counts
    building_specs = [
        {
            "id": "main-gate",
            "name": "Main Security Gate",
            "cat": "gate",
            "polygon_override": gate_arch_poly,
            "levels": 1,
            "height_m": 8.5,
            "roof": "flat",
            "style": "arch",
            "rooms": [
                "Main Security Archway",
                "Visitor Pass Counter",
                "Delivery Drop-off Point",
                "Campus Shuttle Stop",
            ],
            "verified": True,
        },
        {
            "id": "highway-entrance",
            "name": "NH-48 Entrance Arch",
            "cat": "gate",
            "polygon_override": hw_arch_poly,
            "levels": 1,
            "height_m": 9.2,
            "roof": "flat",
            "style": "arch",
            "rooms": [
                "REC Highway Entrance Arch",
                "Student Parking Checkpost",
            ],
            "verified": True,
        },
        {
            "id": "a-block",
            "name": "A Block · Main & Admin Block",
            "cat": "admin",
            "raw": osm_polys["Admin Block"],
            "eps": 0.4,
            "levels": 3,
            "height_m": 12.0,
            "roof": "flat",
            "style": "main_block",
            "sign_text": "RAJALAKSHMI ENGINEERING COLLEGE",
            "rooms": [
                "Principal Office",
                "Dean Academics Office",
                "Administrative Office",
                "Admissions Cell",
                "Purple Hall",
                "Placement & Training Cell",
                "Controller of Examinations",
                "CSE HoD",
                "CSE Department",
                "Main Computer Lab",
                "Accounts & Fee Counter",
            ],
            "verified": True,
        },
        {
            "id": "a-block-fountain",
            "name": "A Block Fountain",
            "cat": "admin",
            "polygon_override": fountain_poly,
            "levels": 1,
            "height_m": 2.6,
            "roof": "flat",
            "style": "fountain",
            "rooms": [
                "Main Portico Fountain",
                "Front Visitor Drop-off Loop",
            ],
            "verified": True,
        },
        {
            "id": "b-block",
            "name": "B Block · ECE & EEE",
            "cat": "academic",
            "raw": osm_polys["Workshop Block"],
            "eps": 0.4,
            "levels": 5,
            "height_m": 18.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "ECE HoD",
                "ECE Department",
                "VLSI Lab",
                "Embedded Systems Lab",
                "DSP & Microprocessor Lab",
                "Communication Systems Lab",
                "RF & Microwave Lab",
                "EEE HoD",
                "EEE Department",
                "Power Electronics Lab",
                "Electrical Machines Lab",
            ],
            "verified": True,
        },
        {
            "id": "c-block",
            "name": "C Block · Mechanical & Fluid Lab",
            "cat": "academic",
            "polygon_override": c_block_poly,
            "levels": 3,
            "height_m": 14.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Mechanical HoD",
                "Mechanical Department",
                "Fluid Mechanics Lab",
                "Strength of Materials Lab",
                "Thermal Engineering Lab",
                "CAD CAM Lab",
                "Metrology & Dynamics Lab",
                "Civil HoD",
                "Civil Engineering Department",
            ],
            "verified": True,
        },
        {
            "id": "d-block",
            "name": "D Block · IT, Biotech & BME",
            "cat": "academic",
            "raw": kml_polys["D block"],
            "eps": 0.8,
            "levels": 8,
            "height_m": 30.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "IT HoD",
                "Information Technology Department",
                "Cloud & Networks Lab",
                "Biotechnology HoD",
                "Molecular Biology Lab",
                "Bioprocess Engineering Lab",
                "Biomedical HoD",
                "Diagnostic & Medical Electronics Lab",
                "Food Technology Lab",
            ],
            "verified": True,
        },
        {
            "id": "i-block",
            "name": "I Block · First-Year & TIFAC",
            "cat": "academic",
            "raw": osm_polys["TIFAC"],
            "eps": 0.4,
            "levels": 5,
            "height_m": 20.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "First Year Coordinator",
                "Science & Humanities HoD",
                "Engineering Physics Lab",
                "Engineering Chemistry Lab",
                "English Communication Lab",
                "Mathematics Department",
                "TIFAC-CORE Machine Vision",
                "MEMS Design Centre",
            ],
            "verified": True,
        },
        {
            "id": "j-block",
            "name": "J Block and Library",
            "cat": "academic",
            "raw": osm_polys["Library / J Block"],
            "eps": 0.4,
            "levels": 4,
            "height_m": 16.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Central Library",
                "Digital Library & E-Journals",
                "Silent Reading Hall",
                "AI & Data Science HoD",
                "CSBS HoD",
                "MBA Department",
                "J-Block Seminar Hall",
            ],
            "verified": True,
        },
        {
            "id": "tech-lounge",
            "name": "Tech Lounge · Coding & COE",
            "cat": "academic",
            "raw": osm_polys["Tech Lounge"],
            "eps": 0.4,
            "levels": 2,
            "height_m": 10.5,
            "roof": "gable",
            "style": "standard",
            "rooms": [
                "Tech Lounge Coding Arena",
                "Placement Assessment Centre",
                "AI & ML Centre of Excellence",
                "Cybersecurity & IoT Lab",
                "Hackathon Hall",
            ],
            "verified": True,
        },
        {
            "id": "idea-factory",
            "name": "Idea Factory · AICTE & Architecture",
            "cat": "academic",
            "raw": kml_polys["Idea Factory"],
            "eps": 0.5,
            "levels": 2,
            "height_m": 15.0,
            "roof": "shed",
            "style": "standard",
            "rooms": [
                "AICTE IDEA Lab",
                "3D Printing & Fab Studio",
                "Isaac Asimov Robotics Lab",
                "School of Architecture Studio",
                "Architecture HoD",
            ],
            "verified": True,
        },
        {
            "id": "automobile-block",
            "name": "Automobile & Aero Engineering",
            "cat": "academic",
            "raw": osm_polys["Automobile Block"],
            "eps": 0.4,
            "levels": 2,
            "height_m": 10.0,
            "roof": "shed",
            "style": "shed_hall",
            "rooms": [
                "Automobile HoD",
                "IC Engines & Vehicle Dynamics Lab",
                "Aeronautical HoD",
                "Subsonic Wind Tunnel Lab",
                "Mechatronics & Robotics HoD",
            ],
            "verified": True,
        },
        {
            "id": "workshop-lab-1",
            "name": "Workshop Lab 1 · Electrical & Electronics",
            "cat": "academic",
            "polygon_override": workshop_1_poly,
            "levels": 1,
            "height_m": 9.0,
            "roof": "gable",
            "style": "shed_hall",
            "rooms": [
                "Basic Electrical Engineering Practice",
                "Electronics PCB & Soldering Bay",
                "Instrumentation Workshop",
            ],
            "verified": True,
        },
        {
            "id": "workshop-lab-2",
            "name": "Workshop Lab 2 · Civil & Mechanical",
            "cat": "academic",
            "polygon_override": workshop_2_poly,
            "levels": 1,
            "height_m": 9.0,
            "roof": "gable",
            "style": "shed_hall",
            "rooms": [
                "Carpentry & Fitting Shop",
                "Welding & Sheet Metal Shop",
                "Foundry & Smithy Practice Bay",
            ],
            "verified": True,
        },
        {
            "id": "indoor-auditorium",
            "name": "Indoor Auditorium",
            "cat": "sports",
            "raw": osm_polys["Indoor Auditorium"],
            "eps": 0.4,
            "levels": 1,
            "height_m": 12.0,
            "roof": "gable",
            "style": "shed_hall",
            "rooms": [
                "Main Convocation Auditorium",
                "Indoor Stadium Wooden Courts",
                "Table Tennis & Carrom Hall",
                "Physical Education Director",
            ],
            "verified": True,
        },
        {
            "id": "swimming-pool-complex",
            "name": "Swimming Pool Complex",
            "cat": "sports",
            "polygon_override": pool_enclosure_poly,
            "levels": 1,
            "height_m": 3.4,
            "roof": "flat",
            "style": "pool_enclosure",
            "rooms": [
                "25m Campus Swimming Pool",
                "Poolside Changing & Shower Pavilion",
                "Lifeguard & Coach Deck",
            ],
            "verified": True,
        },
        {
            "id": "gym",
            "name": "REC Fitness & Gym",
            "cat": "sports",
            "raw": kml_polys["Gym"],
            "eps": 0.4,
            "levels": 2,
            "height_m": 9.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Strength & Conditioning Gym",
                "Cardio Fitness Zone",
                "Sports Changing Rooms",
            ],
            "verified": True,
        },
        {
            "id": "white-stairs",
            "name": "White Stairs",
            "cat": "sports",
            "raw": white_stairs_pts,
            "eps": 0.4,
            "levels": 1,
            "height_m": 3.0,
            "roof": "flat",
            "style": "steps",
            "rooms": [
                "Three-Step Outdoor Seating",
                "Central Ground Hangout Steps",
            ],
            "verified": True,
        },
        {
            "id": "boys-hostel",
            "name": "Boys Hostel",
            "cat": "hostel",
            "raw": osm_polys["NRI Boy's Hostel"],
            "eps": 0.4,
            "levels": 7,
            "height_m": 26.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Boys Hostel Warden Office",
                "Boys Hostel Block 1 & 2",
                "Boys Mess Hall",
                "Hostel Common Recreation Room",
            ],
            "verified": True,
        },
        {
            "id": "canteen-pg-block",
            "name": "Main Canteen & PG Block",
            "cat": "service",
            "raw": kml_polys["Canteen"],
            "eps": 0.5,
            "levels": 3,
            "height_m": 13.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Main Vegetarian Canteen",
                "Faculty Dining Hall",
                "Campus Medical Room & Dispensary",
                "PG Lecture Rooms",
            ],
            "verified": True,
        },
        {
            "id": "ladies-hostel-3",
            "name": "Ladies Hostel 3",
            "cat": "hostel",
            "raw": osm_polys["Boy's Hostel 1"],
            "eps": 0.5,
            "levels": 6,
            "height_m": 24.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Ladies Hostel 3 Warden Office",
                "LH-3 Study & Dining Hall",
                "LH-3 Residential Wing",
            ],
            "verified": True,
        },
        {
            "id": "emerald-hostel",
            "name": "Emerald Ladies Hostel",
            "cat": "hostel",
            "raw": kml_polys["Emerald Ladies Hostel"],
            "eps": 0.5,
            "levels": 7,
            "height_m": 25.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Emerald Hostel Warden Office",
                "Emerald Hostel Dining Mess",
                "Emerald Residential Wing",
            ],
            "verified": True,
        },
        {
            "id": "ruby-hostel",
            "name": "Ruby Ladies Hostel",
            "cat": "hostel",
            "raw": osm_polys["Girl's Hostel 1"],
            "eps": 0.5,
            "levels": 5,
            "height_m": 20.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Ruby Hostel Warden Office",
                "Ruby Senior Wing",
                "Ruby Common Reading Room",
            ],
            "verified": True,
        },
        {
            "id": "teachers-hostel",
            "name": "Teachers Hostel · Faculty Quarters",
            "cat": "hostel",
            "polygon_override": teachers_clean,
            "levels": 7,
            "height_m": 26.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Faculty Quarters Reception",
                "Visiting Guest Suites",
                "Staff Residence Block",
            ],
            "verified": True,
        },
        {
            "id": "rec-transport",
            "name": "REC Transport & Bus Bay",
            "cat": "service",
            "raw": kml_polys["REC Transport"],
            "eps": 0.4,
            "levels": 1,
            "height_m": 5.5,
            "roof": "shed",
            "style": "shed_hall",
            "rooms": [
                "Transport Department Office",
                "College Bus Route Desk",
                "Fleet Dispatch Counter",
            ],
            "verified": True,
        },
        {
            "id": "tpt-eb-block",
            "name": "TPT Dept and EB Block",
            "cat": "academic",
            "polygon_override": tpt_square_poly,
            "levels": 4,
            "height_m": 16.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "TPT Department",
                "Campus Electrical Substation (EB)",
                "Power Backup Control Room",
                "Estate Maintenance Office",
            ],
            "verified": True,
        },
        {
            "id": "rec-cafe",
            "name": "REC Cafe",
            "cat": "service",
            "raw": osm_polys["REC Cafe"],
            "eps": 0.4,
            "levels": 2,
            "height_m": 12.0,
            "roof": "gable",
            "style": "shed_hall",
            "rooms": [
                "REC Cafe Food Hall",
                "Fresh Juice & Bakery Counter",
            ],
            "verified": True,
        },
        {
            "id": "hut-cafe",
            "name": "Hut Cafe",
            "cat": "service",
            "polygon_override": hut_cafe_poly,
            "levels": 1,
            "height_m": 8.6,
            "roof": "gable",
            "style": "pavilion_cafe",
            "rooms": [
                "Hut Cafe Open Snack Pavilion",
                "Tea, Chaat & Sandwich Counter",
            ],
            "verified": True,
        },
        {
            "id": "garden-cafe",
            "name": "Garden Cafe · 6th Sense Garden",
            "cat": "service",
            "polygon_override": sixth_sense_garden_poly,
            "levels": 1,
            "height_m": 5.2,
            "roof": "flat",
            "style": "sixth_sense_garden",
            "rooms": [
                "6th Sense Garden",
                "Garden Cafe Open Seating Patio",
                "Meditation Statue Courtyard",
                "Dosa & Tiffin Huts",
            ],
            "verified": True,
        },
        {
            "id": "dominos",
            "name": "Domino's Pizza · REC",
            "cat": "service",
            "raw": kml_polys["Dominos"],
            "eps": 0.4,
            "levels": 1,
            "height_m": 4.2,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Domino's Campus Outlet",
                "Express Takeaway Counter",
            ],
            "verified": True,
        },
        {
            "id": "black-buck-cafe",
            "name": "Black Buck Cafe",
            "cat": "service",
            "raw": kml_polys["Black Buck Cafe"],
            "eps": 0.4,
            "levels": 1,
            "height_m": 4.2,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Black Buck Coffee Bar",
                "Cold Brew & Waffles Counter",
            ],
            "verified": True,
        },
        {
            "id": "maggi-hotspot",
            "name": "Maggi Hotspot",
            "cat": "service",
            "polygon_override": maggi_square_poly,
            "levels": 1,
            "height_m": 3.8,
            "roof": "flat",
            "style": "maggi_kiosk",
            "rooms": [
                "Maggi Hotspot Kiosk",
                "Selfie Spot & Beverage Counter",
            ],
            "verified": True,
        },
        {
            "id": "rec-mart",
            "name": "REC Mart · Stationery & Print",
            "cat": "service",
            "polygon_override": rec_mart_poly,
            "levels": 1,
            "height_m": 4.8,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "Campus Stationery & Lab Coat Shop",
                "Reprography & Record Binding",
            ],
            "verified": True,
        },
        {
            "id": "cafe-coffee-day",
            "name": "Cafe Coffee Day Xpress",
            "cat": "service",
            "raw": kml_polys["Cafe Coffee Day"],
            "eps": 0.3,
            "levels": 1,
            "height_m": 4.0,
            "roof": "flat",
            "style": "standard",
            "rooms": [
                "CCD Xpress Coffee Counter",
            ],
            "verified": True,
        },
        {
            "id": "aadhi-statue",
            "name": "Aadhi Statue",
            "cat": "admin",
            "polygon_override": aadhi_poly,
            "levels": 1,
            "height_m": 8.5,
            "roof": "flat",
            "style": "monument",
            "rooms": [
                "Aadhi Statue Roundabout",
                "Orientation Assembly Point",
            ],
            "verified": True,
        },
    ]

    buildings: list[dict] = []
    for spec in building_specs:
        poly = spec.get("polygon_override") or clean_polygon(spec["raw"], spec.get("eps", 0.5))
        entry = {
            "id": spec["id"],
            "name": spec["name"],
            "cat": spec["cat"],
            "polygon": poly,
            "levels": spec["levels"],
            "height_m": spec["height_m"],
            "roof": spec["roof"],
            "style": spec["style"],
            "rooms": spec["rooms"],
            "verified": spec["verified"],
        }
        if "sign_text" in spec:
            entry["sign_text"] = spec["sign_text"]
        buildings.append(entry)

    # Campus Boundary & Ground Areas (Eco Pond removed; central ground is open lawn; only the 4 courts are pitch)
    campus_perimeter = ensure_ccw_2d([
        [-356.0, -402.0], [-324.0, -405.0], [-252.0, -295.0], [-132.0, -220.0],
        [  35.0, -262.0], [ 302.0, -270.0], [ 298.0, -196.0], [ 242.0, -135.0],
        [ 252.0,  -95.0], [ 246.0,  110.0], [ 255.0,  218.0], [ 178.0,  226.0],
        [  32.0,  206.0], [ -55.0,  186.0], [-145.0,  145.0], [-292.0,  156.0],
        [-285.0,   62.0], [-235.0,    2.0], [-148.0,   -2.0], [-142.0, -108.0],
        [ -82.0, -112.0], [-156.0, -192.0], [-286.0, -206.0], [-306.0, -222.0],
        [-296.0, -268.0], [-356.0, -378.0],
    ])

    areas: list[dict] = [
        {
            "id": "campus-grounds",
            "kind": "lawn",
            "polygon": campus_perimeter,
        },
        {
            "id": "b-block-quad",
            "kind": "lawn",
            "polygon": ensure_ccw_2d([[-92.0, -10.0], [18.0, -10.0], [18.0, 52.0], [-92.0, 52.0]]),
        },
        {
            "id": "central-grassy-ground",
            "kind": "lawn",
            "polygon": ensure_ccw_2d([[34.0, -52.0], [150.0, -52.0], [150.0, 134.0], [34.0, 134.0]]),
        },
        # ONLY the 4 courts marked as pitch!
        {
            "id": "basketball-court",
            "kind": "pitch",
            "polygon": clean_polygon(kml_polys["Basket Ball Court"], 0.3),
        },
        {
            "id": "soccer-court",
            "kind": "pitch",
            "polygon": clean_polygon(kml_polys["Soccer Court"], 0.3),
        },
        {
            "id": "badminton-court",
            "kind": "pitch",
            "polygon": clean_polygon(kml_polys["Badminton Court"], 0.3),
        },
        {
            "id": "pickleball-court",
            "kind": "pitch",
            "polygon": clean_polygon(pickle_pts, 0.3),
        },
        # Swimming Pool & tiled deck + A Block Fountain water
        {
            "id": "pool-deck-area",
            "kind": "paved",
            "polygon": pool_enclosure_poly,
        },
        {
            "id": "swimming-pool",
            "kind": "water",
            "polygon": clean_polygon(kml_polys["Swimming Pool"], 0.3),
        },
        {
            "id": "fountain-island-lawn",
            "kind": "lawn",
            "polygon": make_ngon(76.2, -111.0, rx=13.5, rz=6.0, n=14),
        },
        {
            "id": "a-block-fountain-water",
            "kind": "water",
            "polygon": make_ngon(76.2, -111.0, rx=4.4, rz=3.5, n=12),
        },
        {
            "id": "student-parking-1",
            "kind": "parking",
            "polygon": clean_polygon(parkwiz1_pts, 0.4),
        },
        {
            "id": "student-parking-2",
            "kind": "parking",
            "polygon": clean_polygon(parkwiz2_pts, 0.4),
        },
        {
            "id": "bus-bay-parking",
            "kind": "parking",
            "polygon": ensure_ccw_2d([[22.0, -225.0], [88.0, -225.0], [88.0, -206.0], [22.0, -206.0]]),
        },
        {
            "id": "admin-forecourt",
            "kind": "paved",
            "polygon": ensure_ccw_2d([[14.0, -68.0], [132.0, -68.0], [132.0, -56.0], [14.0, -56.0]]),
        },
        {
            "id": "hostel-plaza",
            "kind": "paved",
            "polygon": ensure_ccw_2d([[-42.0, 138.0], [205.0, 138.0], [205.0, 149.0], [-42.0, 149.0]]),
        },
    ]

    # Exact Road & Footway Connections reconciled directly from satellite + OSM ways + KML paths
    J = {
        "hw_entry": (-353.0, -408.0),
        "pk1_turn": (-337.9, -382.3),
        "pk2_turn": (-268.5, -267.7),
        "gate_nw": (-147.0, -207.5),
        "gate_in": (-137.7, -200.1),
        "north_j": (-41.2, -109.1),
        # Fountain loop on NORTH side of A Block
        "fount_w": (60.6, -112.3),
        "fount_e": (91.9, -112.8),
        "north_ne": (184.7, -116.0),
        # Garden Cafe -> Teachers Hostel -> Main Road
        "garden_w": (182.6, -103.0),
        "east_n": (184.4, -68.2),
        "ne_merge": (226.9, -176.5),
        "teachers_se": (280.0, -224.0),
        "teachers_ne": (310.0, -258.0),
        "main_road_ne": (356.0, -316.0),
        # Bus / Transport northern avenue
        "bus_front": (48.0, -208.0),
        # Aadhi Statue Roundabout (-40.2, -65.5) right in front of B Block's northern entrance (-40.6, -58.6)
        "aadhi_n": (-40.9, -75.4),
        "aadhi_e": (-29.8, -64.5),
        "aadhi_se": (-29.1, -59.8),
        "aadhi_s": (-40.6, -59.8),
        "aadhi_w": (-50.4, -64.9),
        "aadhi_sw": (-51.5, -59.8),
        # West B-Block & North-West Loop
        "nw_corner": (-106.8, -106.7),
        "west_b_n": (-107.2, -54.0),
        "west_b_mid": (-105.1, 23.9),
        "west_mid": (-102.8, 56.9),
        # Central Campus Spine & Loop
        "central_n": (24.5, -59.7),
        "ablock_s": (74.0, -61.8),
        "tech_s": (148.0, -66.0),
        "central_mid": (25.3, 29.0),
        "central_hut": (25.7, 58.1),
        "central_s": (38.5, 144.0),
        # East Sports / J Block / Auditorium / Hostels Loop
        "eb_w": (185.5, -52.0),
        "jblock_w": (188.0, -8.0),
        "ccd_w": (189.8, 22.0),
        "audi_w": (191.5, 54.0),
        "east_se": (187.4, 136.0),
        # Southern Hostels & West Academic Connectors (clear of C-Block!)
        "boys_n": (-24.0, 146.5),
        "lh3_n": (84.0, 141.5),
        "emerald_n": (166.0, 138.0),
        "ruby_n": (212.0, 142.0),
        "hut_n": (-4.0, 57.5),
        "b_cobble_n": (-40.5, -17.8),
        "b_cobble_mid": (-38.2, 3.0),
        "b_cobble_s": (-32.8, 57.4),
        "wk1_n": (-46.5, 57.3),
        "wk2_n": (-65.5, 57.1),
        "cblock_n": (-86.2, 57.0),
        "west_d": (-104.5, 96.0),
        "west_s": (-104.5, 146.5),
        "cafe_s": (-124.0, 56.9),
        "idea_s": (-180.0, 48.0),
        "iblock_ne": (-198.0, 54.0),
        "auto_e": (-172.0, 96.0),
    }

    raw_paths = [
        # 1. Highway Entrance -> Main Security Gate Arch -> North Junction -> Aadhi Statue
        ("p-gate-approach", "road", ["hw_entry", "pk1_turn", (-274.4, -270.8), "pk2_turn", "gate_nw", "gate_in"], True),
        ("p-gate-to-aadhi", "road", ["gate_in", (-86.0, -152.0), "north_j", "aadhi_n"], True),

        # 2. Road on the OTHER (NORTH) side of A Block + Fountain Carriage Loop!
        ("p-ablock-north-w", "road", ["north_j", (12.0, -110.4), (53.7, -111.4), "fount_w"], True),
        ("p-fountain-outer", "road", ["fount_w", (66.2, -115.5), (76.2, -118.2), (85.2, -117.0), "fount_e"], True),
        ("p-fountain-portico", "service", ["fount_w", (63.5, -107.0), (70.5, -104.2), (79.8, -104.0), (88.1, -105.5), "fount_e"], True),
        ("p-ablock-north-e", "road", ["fount_e", (118.0, -113.5), (170.6, -116.6), "north_ne"], True),

        # 3. Road connecting Garden Cafe -> Faculty Quarters (Teachers Hostel) -> Beyond to Main Road!
        ("p-garden-connector", "road", ["east_n", "garden_w", "north_ne"], True),
        ("p-garden-to-teachers", "road", ["north_ne", (190.3, -130.0), "ne_merge", "teachers_se", "teachers_ne", (335.2, -301.0), "main_road_ne"], True),
        ("p-north-transport-road", "road", ["gate_in", (-45.0, -205.0), "bus_front", (157.1, -213.2), (186.1, -206.2), "ne_merge"], True),

        # 4. Northwest Loop around Domino's & West side of B Block
        ("p-nw-loop", "road", ["north_j", (-96.4, -108.7), "nw_corner", (-108.9, -98.8), "west_b_n", "west_b_mid", "west_mid"], True),

        # 5. Aadhi Statue Roundabout & Main South-of-A-Block Spine
        ("p-aadhi-ring-e", "road", ["aadhi_n", (-32.9, -72.4), "aadhi_e", "aadhi_se"], True),
        ("p-aadhi-ring-w", "road", ["aadhi_n", (-46.6, -71.6), "aadhi_w", "aadhi_sw"], True),
        ("p-aadhi-ring-s", "road", ["aadhi_sw", "aadhi_s", "aadhi_se"], True),
        ("p-bblock-front-entry", "footway", ["aadhi_s", (-40.6, -58.6)], True),
        ("p-bblock-north-road", "road", ["west_b_n", (-88.4, -56.5), "aadhi_sw"], True),
        ("p-main-spine", "road", ["aadhi_se", "central_n", "ablock_s", "tech_s", "east_n"], True),

        # 6. Central Ground Ring (East of B Block -> Hostels -> Indoor Auditorium -> J Block -> TPT/EB)
        ("p-central-ns", "road", ["central_n", "central_mid", "central_hut", (28.6, 89.5), (31.5, 120.9), "central_s"], True),
        ("p-south-hostel-road", "road", ["central_s", (43.1, 138.9), "lh3_n", "emerald_n", (178.3, 134.9), "east_se"], True),
        ("p-east-campus-road", "road", ["east_se", (191.0, 125.9), (194.1, 107.1), "audi_w", "ccd_w", "jblock_w", "eb_w", "east_n"], True),

        # 7. Workshop / Hut Cafe Cross Avenue, Straight B-Block Cobblestone Path & West Academic Connectors
        ("p-workshop-avenue", "service", ["central_hut", "hut_n", "b_cobble_s", "wk1_n", "wk2_n", "cblock_n", "west_mid"], True),
        ("p-bblock-cobblestone", "cobblestone", ["b_cobble_n", "b_cobble_mid", "b_cobble_s"], True),
        ("p-west-south-link", "service", ["west_mid", "west_d", "west_s", "boys_n", "central_s"], True),
        ("p-ruby-promenade", "service", ["east_se", "ruby_n"], True),
        ("p-idea-iblock-road", "service", ["west_mid", "cafe_s", "idea_s", "iblock_ne"], True),
        ("p-auto-spur", "service", ["west_d", (-156.0, 86.0), "auto_e"], False),
        ("p-teachers-entry", "service", ["teachers_se", (258.0, -226.0)], True),
        ("p-parking-1", "service", ["pk1_turn", (-310.2, -389.7), (-294.7, -362.5), (-272.0, -318.0)], False),
        ("p-parking-2", "service", ["pk2_turn", (-281.7, -230.0)], False),

        # 8. Clean Pedestrian Footways (no stray lines cutting across courts or White Stairs!)
        ("p-ablock-south-walk", "footway", ["ablock_s", (74.0, -68.0)], True),
        ("p-tech-entry", "footway", ["tech_s", (152.0, -72.0)], True),
        ("p-garden-entry", "footway", ["garden_w", (198.5, -91.0)], True),
        ("p-eb-entry", "footway", ["eb_w", (202.0, -52.5)], True),
        ("p-jblock-entry", "footway", ["jblock_w", (198.0, -8.0)], True),
        ("p-audi-entry", "footway", ["audi_w", (206.0, 54.0)], True),
        ("p-pool-walk", "footway", ["jblock_w", (181.0, -14.0)], True),
        ("p-gym-walk", "footway", ["audi_w", (175.0, 54.0)], True),
        ("p-recmart-road-link", "footway", ["central_mid", (19.8, 29.0)], True),
        ("p-maggi-link", "footway", ["b_cobble_mid", (-26.8, 2.2)], True),
        ("p-dominos-walk", "footway", ["aadhi_w", (-62.0, -68.0)], True),
        ("p-hut-entry", "footway", ["hut_n", (-4.0, 64.5)], True),
        ("p-wk1-entry", "footway", ["wk1_n", (-46.5, 68.5)], True),
        ("p-wk2-entry", "footway", ["wk2_n", (-65.5, 68.8)], True),
        ("p-cblock-entry", "footway", ["cblock_n", (-86.2, 83.8)], True),
        ("p-dblock-entry", "footway", ["west_d", (-115.0, 96.0)], True),
        ("p-reccafe-entry", "footway", ["cafe_s", (-124.0, 48.0)], True),
        ("p-idea-entry", "footway", ["idea_s", (-180.0, 36.0)], True),
        ("p-iblock-entry", "footway", ["iblock_ne", (-206.0, 66.0)], True),
        ("p-bus-entry", "footway", ["bus_front", (48.0, -228.0)], True),
        ("p-canteen-entry", "footway", ["central_s", (34.0, 154.0)], True),
        ("p-lh3-entry", "footway", ["lh3_n", (84.0, 154.0)], True),
        ("p-emerald-entry", "footway", ["emerald_n", (166.0, 152.0)], True),
        ("p-ruby-entry", "footway", ["ruby_n", (214.0, 156.0)], True),
        ("p-boys-entry", "footway", ["boys_n", (-24.0, 154.0)], True),
    ]

    width_map = {"road": 6.0, "service": 3.5, "cobblestone": 2.3, "footway": 1.8}
    paths: list[dict] = []
    for pid, kind, seq, lit in raw_paths:
        pts: list[list[float]] = []
        for item in seq:
            x, z = J[item] if isinstance(item, str) else item
            pts.append([round(x, 2), round(z, 2)])
        total_len = sum(
            math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
            for i in range(len(pts) - 1)
        )
        dh = abs(sample_grid_elev(elevation, *pts[-1]) - sample_grid_elev(elevation, *pts[0]))
        slope = round(dh / max(1.0, total_len), 3)
        paths.append(
            {
                "id": pid,
                "kind": kind,
                "points": pts,
                "width": width_map[kind],
                "slope": slope,
                "lit": lit,
            }
        )

    # Street Lamps along lit roads, cobblestone paths & gathering spots (~28 m spacing + landmark lights)
    lamps: list[dict] = []
    for p in paths:
        if not p["lit"] or p["kind"] == "footway":
            continue
        pts = p["points"]
        offset_d = p["width"] * 0.5 + 1.25
        step_d = 22.0 if p["kind"] == "cobblestone" else 29.0
        carry = 8.0
        for i in range(len(pts) - 1):
            ax, az = pts[i]
            bx, bz = pts[i + 1]
            seg_len = math.hypot(bx - ax, bz - az)
            if seg_len < 1.0:
                continue
            ux, uz = (bx - ax) / seg_len, (bz - az) / seg_len
            nx, nz = -uz, ux
            d = carry
            while d < seg_len:
                lx = round(ax + ux * d + nx * offset_d, 2)
                lz = round(az + uz * d + nz * offset_d, 2)
                if -350 <= lx <= 350 and -395 <= lz <= 390:
                    if all(math.hypot(lx - ex["x"], lz - ex["z"]) > 13.5 for ex in lamps):
                        lamps.append({"x": lx, "z": lz, "height": 7.5})
                d += step_d
            carry = d - seg_len

    # Extra plaza & courtside lamps around Basketball Court, Hut Cafe, Maggi Hotspot, REC Mart & 6th Sense Garden
    extra_lamp_spots = [
        (42.2, -38.0), (42.2, -22.0), (67.2, -30.0),
        (-28.0, 5.5), (21.5, 23.0), (-26.0, 62.5), (16.0, 62.5),
        (202.0, -88.0), (222.0, -88.0), (68.0, -106.0), (84.0, -106.0),
    ]
    for lx, lz in extra_lamp_spots:
        if all(math.hypot(lx - ex["x"], lz - ex["z"]) > 8.0 for ex in lamps):
            lamps.append({"x": lx, "z": lz, "height": 6.8})

    # Campus Benches & Trash Cans scattered naturally along avenues, cafes, gardens & Basketball Court sidelines
    props: list[dict] = []

    def add_prop(kind: str, px: float, pz: float, angle: float) -> None:
        props.append({"kind": kind, "x": round(px, 2), "z": round(pz, 2), "angle": round(angle, 3)})

    # 1. Dedicated courtside benches along BOTH sidelines of the elevated Basketball Court!
    # Basketball court spans x=[44.8, 64.7], z=[-45.8, -15.7]
    for bz in (-38.5, -30.8, -23.0):
        add_prop("bench", 42.6, bz, math.pi * 0.5)   # West sideline facing East (+X) onto court
    for bz in (-36.5, -25.5):
        add_prop("bench", 66.8, bz, -math.pi * 0.5)  # East sideline facing West (-X) onto court
    add_prop("trash_can", 42.6, -16.5, 0.0)
    add_prop("trash_can", 66.8, -43.5, 0.0)

    # 2. Benches & trash cans around Maggi Hotspot, B-Block cobblestone walk, REC Mart, Hut Cafe & 6th Sense Garden
    curated_benches = [
        # Along B-Block cobblestone path
        (-38.8, -8.0, math.pi * 0.46), (-36.8, 15.0, math.pi * 0.46), (-34.8, 36.0, math.pi * 0.46),
        (-41.2, 8.0, -math.pi * 0.54), (-39.2, 28.0, -math.pi * 0.54),
        # Around Maggi Hotspot & B-Block quad
        (-18.5, 6.8, math.pi), (-28.5, -1.5, math.pi * 0.5), (-14.0, -2.0, -math.pi * 0.5),
        # Outside REC Mart & near White Stairs
        (21.8, 26.2, math.pi * 0.5), (21.8, 32.0, math.pi * 0.5),
        (38.0, 16.0, math.pi * 0.5), (39.0, 65.5, math.pi * 0.5),
        # Outside Hut Cafe lawn
        (-20.0, 60.8, math.pi), (-8.0, 60.8, math.pi), (6.0, 61.2, math.pi), (17.0, 74.0, math.pi * 0.5),
        # Inside 6th Sense Garden (Garden Cafe)
        (206.0, -95.0, 0.0), (222.0, -95.0, 0.0), (206.0, -82.0, math.pi), (222.0, -82.0, math.pi),
        # A-Block South forecourt & North Fountain loop
        (42.0, -64.0, 0.0), (62.0, -64.0, 0.0), (88.0, -64.0, 0.0), (112.0, -64.0, 0.0),
        (68.0, -116.0, 0.0), (84.0, -116.0, 0.0),
        # Aadhi Statue roundabout & Domino's
        (-54.5, -62.0, math.pi * 0.5), (-27.0, -62.0, -math.pi * 0.5),
    ]
    for bx, bz, bang in curated_benches:
        add_prop("bench", bx, bz, bang)

    curated_bins = [
        (-19.2, -2.6), (-27.2, 4.8),          # Maggi Hotspot bins
        (20.8, 24.4), (20.8, 33.6),           # REC Mart bins
        (-23.0, 61.8), (13.5, 62.2),          # Hut Cafe bins
        (202.0, -90.5), (216.0, -88.0), (228.0, -92.0),  # 6th Sense Garden bins (like yellow bin in photo!)
        (42.8, 20.5), (43.5, 61.5),           # White Stairs north & south ends
        (71.5, -65.5), (76.5, -105.0),        # A-Block entrances
        (-40.8, -16.5), (-33.5, 55.2),        # Cobblestone path ends
        (-58.0, -66.5), (-30.5, -58.0),       # Domino's & Aadhi roundabout
        (189.0, 20.5), (203.0, 52.0),         # CCD Xpress & Indoor Auditorium
        (-121.0, 50.0), (-177.0, 40.0),       # REC Cafe & Idea Factory
        (36.0, 150.0), (86.0, 150.0), (168.0, 148.0), (-21.0, 150.0),  # Hostels & Main Canteen
    ]
    for tx, tz in curated_bins:
        add_prop("trash_can", tx, tz, 0.0)

    # 3. Additional benches & paired trash cans distributed along major campus avenues
    for p in paths:
        if p["id"] in ("p-main-spine", "p-central-ns", "p-east-campus-road", "p-south-hostel-road", "p-workshop-avenue"):
            pts = p["points"]
            off = p["width"] * 0.5 + 1.85
            for i in range(len(pts) - 1):
                ax, az = pts[i]
                bx, bz = pts[i + 1]
                slen = math.hypot(bx - ax, bz - az)
                if slen < 26.0:
                    continue
                ux, uz = (bx - ax) / slen, (bz - az) / slen
                nx, nz = -uz, ux
                ang = math.atan2(-nx, -nz)
                d = 18.0
                while d < slen - 12.0:
                    px = ax + ux * d - nx * off
                    pz = az + uz * d - nz * off
                    if all(math.hypot(px - q["x"], pz - q["z"]) > 14.0 for q in props):
                        add_prop("bench", px, pz, ang)
                        if len(props) % 2 == 0:
                            add_prop("trash_can", px + ux * 1.6, pz + uz * 1.6, 0.0)
                    d += 46.0

    # Dense Lush Campus & Surrounding Green-Belt Foliage (~1,165 trees & shrubs!)
    rng = random.Random(20261123)
    # Keep ONLY the inner grassy turf east of the courts + direct sightline apron in front of White Stairs open,
    # allowing lush tree rows around all 4 courts, behind/beside White Stairs, around the ground perimeter, and along adjacent roads!
    central_open_field = ensure_ccw_2d([[99.0, -36.0], [142.0, -36.0], [142.0, 120.0], [99.0, 120.0]])
    stairs_view_apron = ensure_ccw_2d([[56.5, 23.0], [99.0, 23.0], [99.0, 57.0], [56.5, 57.0]])
    blocked_polys = (
        [b["polygon"] for b in buildings if b["id"] != "garden-cafe"]
        + [make_rotated_rect(215.2, -90.0, hw=11.5, hd=11.0, angle_rad=0.0)]
        + [a["polygon"] for a in areas if a["kind"] in ("pitch", "water", "parking", "paved")]
        + [central_open_field, stairs_view_apron]
    )

    def is_clear_for_tree(x: float, z: float, margin: float = 3.4) -> bool:
        for poly in blocked_polys:
            if point_in_poly(x, z, poly):
                return False
            for i in range(len(poly)):
                ax, az = poly[i]
                bx, bz = poly[(i + 1) % len(poly)]
                if dist_point_to_seg(x, z, ax, az, bx, bz) < margin:
                    return False
        for p in paths:
            pts = p["points"]
            clearance = p["width"] * 0.5 + 1.85
            for i in range(len(pts) - 1):
                if dist_point_to_seg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) < clearance:
                    return False
        return True

    foliage: list[dict] = []

    def add_tree(kind: str, tx: float, tz: float, r_range: tuple[float, float], h_range: tuple[float, float]) -> None:
        foliage.append(
            {
                "id": f"t-{len(foliage) + 1:04d}",
                "kind": kind,
                "x": round(tx, 2),
                "z": round(tz, 2),
                "radius": round(rng.uniform(*r_range), 2),
                "height": round(rng.uniform(*h_range), 1),
            }
        )

    # 1A. Curated lush trees framing the Courts, White Stairs, Central Ground border, and Central Roads
    courts_and_ground_spots = [
        # West & North & South & East of Basketball Court + Fenced Side Court
        (32.5, -48.0, "rain_tree"), (32.8, -39.0, "tree"), (33.2, -29.5, "rain_tree"), (33.5, -20.0, "tree"), (34.0, -11.5, "palm"),
        (60.2, -50.5, "tree"), (60.2, -7.5, "tree"),
        (39.0, -6.5, "tree"), (48.0, -6.0, "rain_tree"), (57.5, -6.2, "palm"), (68.0, -5.8, "rain_tree"), (78.5, -6.0, "tree"), (88.0, -6.5, "palm"),
        (91.0, -45.0, "rain_tree"), (91.5, -35.0, "tree"), (91.5, -24.5, "rain_tree"), (91.2, -14.0, "tree"),
        # Northern border of Central Ground along A-Block / Tech Lounge road
        (42.0, -53.5, "tree"), (54.0, -53.5, "rain_tree"), (70.0, -53.8, "tree"), (84.0, -53.8, "palm"),
        (96.0, -53.5, "rain_tree"), (108.0, -53.5, "tree"), (120.0, -53.5, "rain_tree"), (132.0, -53.2, "palm"), (143.0, -52.5, "rain_tree"),
        # Framing White Stairs (behind west top edge + north & south flanks + transition to courts)
        (36.0, 4.0, "rain_tree"), (44.5, 6.0, "tree"), (53.5, 11.5, "palm"),
        (38.2, 16.5, "rain_tree"), (38.8, 24.5, "tree"), (39.2, 32.5, "rain_tree"), (39.6, 40.5, "tree"),
        (40.0, 48.5, "rain_tree"), (40.4, 56.5, "tree"), (41.0, 63.5, "palm"),
        (49.5, 16.2, "tree"), (56.0, 15.5, "rain_tree"), (50.5, 64.5, "tree"), (57.5, 63.5, "rain_tree"),
        # Around Southern Courts (Badminton & Pickleball) & along Central Road south leg
        (36.2, 71.0, "rain_tree"), (36.8, 80.0, "tree"), (37.5, 89.5, "palm"), (38.2, 98.5, "rain_tree"),
        (39.0, 108.0, "tree"), (39.8, 117.5, "rain_tree"), (40.5, 127.0, "palm"),
        (68.0, 62.5, "tree"), (80.0, 62.5, "rain_tree"), (92.0, 63.0, "palm"),
        (96.5, 73.0, "tree"), (96.8, 84.0, "rain_tree"), (96.8, 95.5, "tree"), (96.8, 107.0, "rain_tree"), (96.5, 118.5, "palm"), (96.5, 128.5, "tree"),
        # Eastern & Southern perimeter of Central Ground (along Pool, Gym & Hostels)
        (147.0, -36.0, "rain_tree"), (147.2, -24.0, "palm"), (147.2, -12.0, "tree"), (147.2, 0.0, "rain_tree"),
        (147.5, 12.5, "tree"), (147.5, 25.0, "palm"), (147.8, 38.0, "rain_tree"), (148.0, 51.0, "tree"),
        (148.2, 64.0, "rain_tree"), (148.2, 77.0, "palm"), (148.5, 90.0, "tree"), (148.5, 103.0, "rain_tree"), (148.5, 116.0, "tree"),
        (106.0, 126.5, "rain_tree"), (118.0, 126.8, "tree"), (130.0, 126.8, "palm"), (142.0, 126.5, "rain_tree"),
        # West side of Central Road (along B Block east wing, REC Mart, Hut Cafe & Workshops)
        (18.8, -46.0, "tree"), (19.0, -34.0, "rain_tree"), (19.2, -22.0, "palm"), (19.5, -10.0, "tree"),
        (19.8, 2.0, "rain_tree"), (20.0, 14.0, "tree"), (20.5, 40.0, "rain_tree"), (21.0, 51.0, "palm"),
        (22.2, 72.0, "rain_tree"), (23.0, 84.0, "tree"), (24.0, 96.0, "rain_tree"), (25.0, 108.0, "palm"), (26.0, 120.0, "tree"),
    ]
    for tx, tz, tkind in courts_and_ground_spots:
        if is_clear_for_tree(tx, tz, 1.9) and all(math.hypot(tx - f["x"], tz - f["z"]) > 4.8 for f in foliage):
            if tkind == "rain_tree":
                add_tree("rain_tree", tx, tz, (4.3, 6.2), (11.0, 15.0))
            elif tkind == "palm":
                add_tree("palm", tx, tz, (2.5, 3.4), (10.5, 14.5))
            else:
                add_tree("tree", tx, tz, (3.0, 4.5), (9.0, 13.5))

    # 1B. Dense avenue trees lining both sides of campus roads & avenues (tighter spacing near central ground!)
    central_road_ids = {"p-central-ns", "p-main-spine", "p-south-hostel-road", "p-workshop-avenue", "p-east-campus-road"}
    for p in paths:
        if p["kind"] not in ("road", "service"):
            continue
        pts = p["points"]
        is_central_rd = p["id"] in central_road_ids
        side_off = p["width"] * 0.5 + (3.3 if is_central_rd else 3.8)
        step_d = 9.5 if is_central_rd else 14.5
        for i in range(len(pts) - 1):
            ax, az = pts[i]
            bx, bz = pts[i + 1]
            seg_len = math.hypot(bx - ax, bz - az)
            if seg_len < 10.0:
                continue
            ux, uz = (bx - ax) / seg_len, (bz - az) / seg_len
            nx, nz = -uz, ux
            d = 5.5
            while d < seg_len - 4.0:
                for sgn in (-1.0, 1.0):
                    tx = ax + ux * d + nx * side_off * sgn + rng.uniform(-0.9, 0.9)
                    tz = az + uz * d + nz * side_off * sgn + rng.uniform(-0.9, 0.9)
                    if -352 <= tx <= 352 and -395 <= tz <= 380 and is_clear_for_tree(tx, tz, 2.3 if is_central_rd else 2.8):
                        if all(math.hypot(tx - f["x"], tz - f["z"]) > (5.4 if is_central_rd else 6.2) for f in foliage):
                            roll = rng.random()
                            if roll < 0.34:
                                add_tree("rain_tree", tx, tz, (4.4, 6.4), (11.0, 15.5))
                            elif roll < 0.48:
                                add_tree("palm", tx, tz, (2.5, 3.4), (10.5, 14.5))
                            else:
                                add_tree("tree", tx, tz, (3.0, 4.5), (9.0, 13.5))
                d += step_d

    # 2. Dense interior campus groves (north woodland between Gate/Transport/A-Block, B-Block quad, Garden Cafe, Hostels)
    attempts = 0
    while len(foliage) < 845 and attempts < 18000:
        attempts += 1
        tx = rng.uniform(-345.0, 295.0)
        tz = rng.uniform(-392.0, 218.0)
        if not point_in_poly(tx, tz, campus_perimeter):
            continue
        if not is_clear_for_tree(tx, tz, 3.0):
            continue
        if any(math.hypot(tx - f["x"], tz - f["z"]) < 6.4 for f in foliage):
            continue
        roll = rng.random()
        if roll < 0.30:
            add_tree("rain_tree", tx, tz, (4.5, 6.8), (11.5, 16.0))
        elif roll < 0.40:
            add_tree("palm", tx, tz, (2.4, 3.4), (9.5, 14.5))
        elif roll < 0.50:
            add_tree("shrub", tx, tz, (1.3, 2.2), (2.2, 3.8))
        else:
            add_tree("tree", tx, tz, (2.8, 4.6), (8.5, 14.0))

    # 3. Surrounding Thandalam green-belt woodland outside the campus border so exterior is lush & wooded
    ext_attempts = 0
    while len(foliage) < 1175 and ext_attempts < 16000:
        ext_attempts += 1
        tx = rng.uniform(-352.0, 352.0)
        tz = rng.uniform(-392.0, 360.0)
        if point_in_poly(tx, tz, campus_perimeter):
            continue
        if not is_clear_for_tree(tx, tz, 4.0):
            continue
        if any(math.hypot(tx - f["x"], tz - f["z"]) < 10.5 for f in foliage):
            continue
        roll = rng.random()
        if roll < 0.38:
            add_tree("rain_tree", tx, tz, (4.8, 7.0), (11.0, 16.5))
        elif roll < 0.48:
            add_tree("palm", tx, tz, (2.6, 3.5), (10.0, 15.0))
        else:
            add_tree("tree", tx, tz, (3.2, 4.9), (9.0, 14.5))

    campus_doc = {
        "meta": {
            "name": "Rajalakshmi Engineering College",
            "origin": [LON0, LAT0],
            "north_deg": -1.8,
            "units": "metres",
            "generated": "2026-11-22",
        },
        "buildings": buildings,
        "paths": paths,
        "areas": areas,
        "foliage": foliage,
        "lamps": lamps,
        "props": props,
        "elevation": elevation,
    }

    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    OUT_CAMPUS_JSON.write_text(json.dumps(campus_doc, separators=(",", ":")), encoding="utf-8")
    size_kb = OUT_CAMPUS_JSON.stat().st_size / 1024.0
    total_rooms = sum(len(b["rooms"]) for b in buildings)
    print(
        f"[project] Wrote {OUT_CAMPUS_JSON} ({size_kb:.1f} KB): "
        f"{len(buildings)} buildings ({total_rooms} rooms), {len(paths)} paths, "
        f"{len(areas)} areas, {len(foliage)} foliage, {len(lamps)} lamps, {len(props)} props"
    )


if __name__ == "__main__":
    main()
