#!/usr/bin/env python3
"""
fetch_osm.py — Fetch OpenStreetMap features over Rajalakshmi Engineering College,
Thandalam, Chennai and write data/raw/campus_osm.geojson.

Handles Overpass 502/504 flakiness with multi-endpoint retry + exponential backoff,
falls back to OpenStreetMap API v0.6 bbox JSON if Overpass mirrors are overloaded,
and uses cached data/raw/osm_raw.json when --offline is passed or network is unavailable.
"""

from __future__ import annotations
import argparse
import json
import pathlib
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
RAW_OSM_CACHE = RAW_DIR / "osm_raw.json"
OUT_GEOJSON = RAW_DIR / "campus_osm.geojson"

# Tight bounding box enclosing REC campus + approach corridor (South, West, North, East)
BBOX_SWNE = (13.0062, 79.9998, 13.0130, 80.0072)

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

OVERPASS_QUERY = """[out:json][timeout:60];
(
  way["building"]({s},{w},{n},{e});
  way["highway"]({s},{w},{n},{e});
  way["landuse"]({s},{w},{n},{e});
  way["leisure"]({s},{w},{n},{e});
  way["natural"]({s},{w},{n},{e});
  way["amenity"]({s},{w},{n},{e});
  node["highway"="street_lamp"]({s},{w},{n},{e});
  node["natural"="tree"]({s},{w},{n},{e});
  node["amenity"]({s},{w},{n},{e});
);
out body;
>;
out skel qt;
""".format(s=BBOX_SWNE[0], w=BBOX_SWNE[1], n=BBOX_SWNE[2], e=BBOX_SWNE[3])


def fetch_from_overpass() -> dict | None:
    body = urllib.parse.urlencode({"data": OVERPASS_QUERY}).encode("utf-8")
    for attempt in range(3):
        backoff = 2.0 ** attempt
        for endpoint in OVERPASS_ENDPOINTS:
            try:
                req = urllib.request.Request(
                    endpoint,
                    data=body,
                    headers={"User-Agent": "REC-Campus-3D/1.0 (ODbL)"},
                )
                with urllib.request.urlopen(req, timeout=25) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                    if "elements" in payload and len(payload["elements"]) > 0:
                        print(f"[fetch_osm] Fetched {len(payload['elements'])} elements from {endpoint}")
                        return payload
            except Exception as exc:
                print(f"[fetch_osm] {endpoint} failed ({exc}); retrying after {backoff:.1f}s...")
                time.sleep(backoff)
    return None


def fetch_from_osm_v06() -> dict | None:
    s, w, n, e = BBOX_SWNE
    url = f"https://api.openstreetmap.org/api/0.6/map.json?bbox={w},{s},{e},{n}"
    try:
        req = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "REC-Campus-3D/1.0 (ODbL)",
            },
        )
        with urllib.request.urlopen(req, timeout=25) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
            if "elements" in payload:
                print(f"[fetch_osm] Fetched {len(payload['elements'])} elements via OSM API v0.6")
                return payload
    except Exception as exc:
        print(f"[fetch_osm] OSM API v0.6 fallback failed: {exc}")
    return None


def osm_json_to_geojson(osm_data: dict) -> dict:
    s, w, n, e = BBOX_SWNE
    nodes: dict[int, tuple[float, float]] = {}
    features: list[dict] = []

    for el in osm_data.get("elements", []):
        if el.get("type") == "node" and "lon" in el and "lat" in el:
            nodes[el["id"]] = (float(el["lon"]), float(el["lat"]))

    for el in osm_data.get("elements", []):
        tags = el.get("tags")
        if not tags:
            continue
        el_type = el.get("type")
        if el_type == "node":
            lon, lat = float(el["lon"]), float(el["lat"])
            if not (w <= lon <= e and s <= lat <= n):
                continue
            features.append(
                {
                    "type": "Feature",
                    "id": f"node/{el['id']}",
                    "properties": {"osm_id": el["id"], "osm_type": "node", **tags},
                    "geometry": {"type": "Point", "coordinates": [lon, lat]},
                }
            )
        elif el_type == "way":
            coords: list[list[float]] = []
            if "geometry" in el:
                coords = [[float(pt["lon"]), float(pt["lat"])] for pt in el["geometry"]]
            elif "nodes" in el:
                coords = [list(nodes[nid]) for nid in el["nodes"] if nid in nodes]
            if len(coords) < 2:
                continue
            cx = sum(c[0] for c in coords) / len(coords)
            cy = sum(c[1] for c in coords) / len(coords)
            if not (w <= cx <= e and s <= cy <= n):
                continue

            is_closed = len(coords) >= 4 and coords[0] == coords[-1]
            is_area = is_closed and any(
                k in tags for k in ("building", "landuse", "leisure", "natural", "amenity")
            ) and "highway" not in tags

            geom = (
                {"type": "Polygon", "coordinates": [coords]}
                if is_area
                else {"type": "LineString", "coordinates": coords}
            )
            features.append(
                {
                    "type": "Feature",
                    "id": f"way/{el['id']}",
                    "properties": {"osm_id": el["id"], "osm_type": "way", **tags},
                    "geometry": geom,
                }
            )

    return {
        "type": "FeatureCollection",
        "metadata": {
            "source": "OpenStreetMap contributors (ODbL)",
            "bbox": list(BBOX_SWNE),
        },
        "features": features,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch OSM features for REC campus")
    parser.add_argument("--offline", action="store_true", help="Use cached data/raw/osm_raw.json only")
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    osm_data = None

    if not args.offline:
        osm_data = fetch_from_overpass() or fetch_from_osm_v06()
        if osm_data is not None:
            RAW_OSM_CACHE.write_text(json.dumps(osm_data), encoding="utf-8")

    if osm_data is None and RAW_OSM_CACHE.exists():
        print(f"[fetch_osm] Loading cached {RAW_OSM_CACHE}")
        osm_data = json.loads(RAW_OSM_CACHE.read_text(encoding="utf-8"))

    if osm_data is None:
        raise RuntimeError("No OSM data available from network or data/raw/osm_raw.json cache.")

    geojson = osm_json_to_geojson(osm_data)
    OUT_GEOJSON.write_text(json.dumps(geojson, indent=2), encoding="utf-8")
    print(f"[fetch_osm] Wrote {len(geojson['features'])} features -> {OUT_GEOJSON}")


if __name__ == "__main__":
    main()
