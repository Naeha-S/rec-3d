#!/usr/bin/env python3
"""
fetch_elevation.py — Sample NASA SRTM1 30 m DEM (tile N13E080) over the
Rajalakshmi Engineering College campus bounding box and cache the raw 1-arcsecond
window in data/raw/srtm_rec_dem.json plus a 5 m bilinear grid for project.py.
"""

from __future__ import annotations
import argparse
import gzip
import json
import math
import pathlib
import struct
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
DEM_CACHE = RAW_DIR / "srtm_rec_dem.json"
SRTM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/skadi/N13/N13E080.hgt.gz"
TMP_HGT = pathlib.Path("/tmp/N13E080.hgt.gz")

# Subset window covering lon [80.0000, 80.0080], lat [13.0050, 13.0140]
LON_MIN, LON_MAX = 80.0000, 80.0080
LAT_MIN, LAT_MAX = 13.0050, 13.0140


def extract_srtm_subset(hgt_gz_path: pathlib.Path) -> dict:
    with gzip.open(hgt_gz_path, "rb") as f:
        buf = f.read()
    n = 3601  # 1-arcsecond SRTM1 tile (3601 x 3601 big-endian int16)
    c0 = max(0, int(math.floor((LON_MIN - 80.0) * 3600)) - 2)
    c1 = min(n - 1, int(math.ceil((LON_MAX - 80.0) * 3600)) + 2)
    r0 = max(0, int(math.floor((14.0 - LAT_MAX) * 3600)) - 2)
    r1 = min(n - 1, int(math.ceil((14.0 - LAT_MIN) * 3600)) + 2)

    samples: list[list[int]] = []
    for r in range(r0, r1 + 1):
        row_vals: list[int] = []
        for c in range(c0, c1 + 1):
            idx = (r * n + c) * 2
            val = struct.unpack(">h", buf[idx : idx + 2])[0]
            row_vals.append(int(val))
        samples.append(row_vals)

    return {
        "source": "NASA SRTM1 v3 30m (N13E080 via AWS Terrain Tiles Public Dataset)",
        "tile": "N13E080",
        "date_sampled": "2026-11-22",
        "r0": r0,
        "c0": c0,
        "rows": len(samples),
        "cols": len(samples[0]),
        "samples_asl_m": samples,
    }


def sample_dem_bilinear(dem: dict, lon: float, lat: float) -> float:
    # Clamp lon slightly >= 80.0000 for points at the western edge
    u = max(0.0, (lon - 80.0) * 3600.0) - dem["c0"]
    v = (14.0 - lat) * 3600.0 - dem["r0"]
    rows, cols = dem["rows"], dem["cols"]
    u = max(0.0, min(cols - 1.001, u))
    v = max(0.0, min(rows - 1.001, v))
    ic, ir = int(u), int(v)
    du, dv = u - ic, v - ir
    s = dem["samples_asl_m"]
    z00, z10 = s[ir][ic], s[ir][ic + 1]
    z01, z11 = s[ir + 1][ic], s[ir + 1][ic + 1]
    return (1 - du) * (1 - dv) * z00 + du * (1 - dv) * z10 + (1 - du) * dv * z01 + du * dv * z11


def build_elevation_grid(
    dem: dict,
    lon0: float,
    lat0: float,
    cell: float = 5.0,
    half_width_m: float = 360.0,
    half_depth_m: float = 400.0,
) -> dict:
    """
    Build a centered 5 m grid spanning [-half_width_m, +half_width_m] in X
    and [-half_depth_m, +half_depth_m] in Z, normalized so min elevation = 0.0 m.
    """
    mx = 111320.0 * math.cos(math.radians(lat0))
    cols = int(round((2 * half_width_m) / cell)) + 1
    rows = int(round((2 * half_depth_m) / cell)) + 1

    # Bare-earth DTM filter: SRTM1 is a radar surface model (DSM) where tree canopy
    # and industrial warehouse roofs create localized +12..18 m spikes above bare ground
    # (Thandalam bare earth sits between ~27.5 m and ~33.8 m ASL, ~6.3 m gentle relief).
    BASE_MIN_ASL = 27.5
    BASE_MAX_ASL = 33.8

    raw_grid: list[list[float]] = []
    min_h = float("inf")
    for r in range(rows):
        z = -half_depth_m + r * cell
        lat = lat0 - z / 111320.0
        row_vals: list[float] = []
        for c in range(cols):
            x = -half_width_m + c * cell
            lon = lon0 + x / mx
            h = sample_dem_bilinear(dem, lon, lat)
            h_clamped = max(BASE_MIN_ASL, min(BASE_MAX_ASL, h))
            min_h = min(min_h, h_clamped)
            row_vals.append(h_clamped)
        raw_grid.append(row_vals)

    # Smooth with a 2-pass 5x5 kernel so 30m SRTM posts become smooth natural campus terrain
    cur = [[v - min_h for v in row] for row in raw_grid]
    for _ in range(2):
        nxt: list[list[float]] = []
        for r in range(rows):
            row_out: list[float] = []
            for c in range(cols):
                acc, cnt = 0.0, 0
                for dr in (-2, -1, 0, 1, 2):
                    for dc in (-2, -1, 0, 1, 2):
                        rr = min(rows - 1, max(0, r + dr))
                        cc = min(cols - 1, max(0, c + dc))
                        acc += cur[rr][cc]
                        cnt += 1
                row_out.append(acc / cnt)
            nxt.append(row_out)
        cur = nxt

    smoothed: list[list[float]] = []
    max_rel = 0.0
    for r in range(rows):
        row_out = []
        for c in range(cols):
            val = round(max(0.0, cur[r][c]), 2)
            max_rel = max(max_rel, val)
            row_out.append(val)
        smoothed.append(row_out)

    return {
        "cell": int(cell),
        "min": 0.0,
        "max": round(max_rel, 2),
        "grid": smoothed,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch & cache SRTM 30m elevation for REC campus")
    parser.add_argument("--offline", action="store_true", help="Use cached data/raw/srtm_rec_dem.json")
    args = parser.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    if not args.offline:
        if not TMP_HGT.exists():
            print(f"[fetch_elevation] Downloading {SRTM_URL} ...")
            req = urllib.request.Request(SRTM_URL, headers={"User-Agent": "REC-Campus-3D/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                TMP_HGT.write_bytes(resp.read())
        dem = extract_srtm_subset(TMP_HGT)
        DEM_CACHE.write_text(json.dumps(dem, indent=2), encoding="utf-8")
        print(f"[fetch_elevation] Cached SRTM1 subset ({dem['rows']}x{dem['cols']}) -> {DEM_CACHE}")
    elif not DEM_CACHE.exists():
        raise RuntimeError(f"Missing {DEM_CACHE}; run without --offline once.")
    else:
        dem = json.loads(DEM_CACHE.read_text(encoding="utf-8"))

    preview = build_elevation_grid(dem, 80.0036, 13.0088)
    print(
        f"[fetch_elevation] 5m grid ready: {len(preview['grid'])}x{len(preview['grid'][0])}, "
        f"min={preview['min']}m, max={preview['max']}m"
    )


if __name__ == "__main__":
    main()
