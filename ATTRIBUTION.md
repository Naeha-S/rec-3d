# Data Attribution & Provenance

All geographic and elevation datasets used to construct `public/campus.json` are documented below with exact retrieval dates and licenses.

## 1. OpenStreetMap (`© OpenStreetMap contributors, ODbL 1.0`)
- **Retrieved:** `2026-11-22`
- **Bounding Box:** `13.0062°N, 79.9998°E` to `13.0130°N, 80.0072°E` (Rajalakshmi Engineering College, Thandalam, Chennai)
- **Cached Raw File:** `data/raw/campus_osm.geojson` (derived from `way/371688528` and interior building, pitch, parking, and service highway ways)
- **License:** [Open Database License (ODbL) v1.0](https://opendatacommons.org/licenses/odbl/1-0/) — `© OpenStreetMap contributors`. Derived geometric datasets in `public/campus.json` remain available under ODbL 1.0.

## 2. Campus Field & Aerial Verification (`REC.kml`)
- **Traced & Verified:** `2026-11-20` – `2026-11-22`
- **Cached Raw File:** `data/raw/REC.kml`
- **Description:** First-hand REC Thandalam block names, hostel names (Ruby, Emerald, Ladies Hostel 3, Boys Hostel, Faculty Quarters), food kiosks (Maggi Hotspot, Black Buck Cafe, Domino's, Hut Cafe, REC Cafe, Garden Cafe, CCD Xpress, REC Mart), Aadhi Roundabout, Main Gate, NH-48 Entrance Arch, and walking corridors traced in Google Earth Pro (`v7.3.7.1327`, Airbus 2026 imagery reference) to fill OpenStreetMap gaps and correct generic OSM block labels.

## 3. Terrain Elevation (`NASA SRTM1 v3 30 m DEM`)
- **Retrieved:** `2026-11-22`
- **Tile:** `N13E080.hgt.gz` (1-arc-second Shuttle Radar Topography Mission Global 30 m DEM, accessed via AWS Open Data Terrain Tiles `s3://elevation-tiles-prod/skadi/N13/N13E080.hgt.gz`)
- **Cached Raw Subset:** `data/raw/srtm_rec_dem.json`
- **License:** Public Domain (NASA / USGS).

## 4. Architectural & Pipeline Inspiration
- Inspired by the open-source OSM → Three.js / React Three Fiber campus map approach demonstrated in `roshanbinoj-iiitk/iiitk-campus-in-3d`, re-engineered with runtime procedural R3F geometry, Zod data-contract validation, A* slope/lighting-aware routing, and solar keyframe lighting.
