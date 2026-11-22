# REC Campus in 3D — Project Brief (`PLAN.md`)

## 1. What this is
A static, low-poly 3D model of the Rajalakshmi Engineering College campus at Thandalam, published as a website. A fresher lands on it, types `"ECE HoD"`, gets a highlighted building and a walking route from the gate, and takes a nine-stop orientation tour. It runs on a phone, offline after first load, from GitHub Pages, for free.

It is an orientation aid, not a game and not a CAD model. It exists because a 2D campus map is unreadable to someone who has never been there.

- **Audience:** incoming first-years, visiting parents, event guests, delivery riders.
- **Non-goals:** interiors you can walk through, real-time navigation, VR, photoreal rendering, live timetables.
- **Provenance:** reimplementation of the technique in `roshanbinoj-iiitk/iiitk-campus-in-3d` (OSM → geometry → R3F viewer), with the Blender step demoted from mandatory pipeline to optional art pass.
- **Scope boundary:** campus boundary wall and nothing outside it. No Sriperumbudur, no highway.

## 2. Deliverables
```text
rec-campus-3d/
├─ README.md                  run, build, deploy, data provenance
├─ PLAN.md                    this file
├─ LICENSE                    MIT for code
├─ ATTRIBUTION.md             ODbL credit + every source, dated
├─ vite.config.ts             base constant, build target
├─ public/
│  ├─ campus.json             the entire world, projected metres
│  ├─ og.jpg                  1200×630 aerial render
│  ├─ favicon.svg
│  └─ robots.txt
├─ scripts/
│  ├─ fetch_osm.py            Overpass → raw GeoJSON
│  ├─ project.py              lon/lat → metres, writes campus.json
│  ├─ fetch_elevation.py      SRTM → grid
│  ├─ check-budget.mjs        fails above 150k tris / 400 KB gzipped JS
│  └─ build_campus.py         Blender art pass (optional)
├─ src/
│  ├─ main.tsx, App.tsx
│  ├─ data/load.ts            zod validation, fallback card
│  ├─ scene/                  Ground, Buildings, Windows, Foliage, Lamps, Paths, Sky
│  ├─ logic/                  route.ts (A*), search.ts, tour.ts, solar.ts
│  └─ ui/                     Search, Toolbar, TimeControls, Chips, Loader, About
└─ .github/workflows/deploy.yml
```
Plus a screen recording of the tour (`docs/tour.webm`) and screenshots at 4 times of day (`docs/screenshots/`).

## 3. Data contract
`public/campus.json`, projected in metres relative to `meta.origin`. Nothing hardcoded in components.
- `cat` (`academic | admin | hostel | service | gate | sports`) drives architectural wall & roof palette.
- `kind` drives path/area/foliage material.
- `slope` and `lit` drive A* route weight: `length × (1 + 0.4|slope|) × (lit ? 1 : 1.15)`.
- `verified: false` renders a dashed grey outline and greys the label.
- `levels × 3.2` = building wall height in metres.
- Missing polygon on a `verified: true` building is a strict validation error; missing polygon on an unverified building derives a fallback rectangle from `levels` and forces `verified: false`.

## 4. Extraction & Projection
- `scripts/fetch_osm.py` queries Overpass (with multi-mirror backoff and OSM API v0.6 fallback) and caches `data/raw/campus_osm.geojson`.
- `scripts/fetch_elevation.py` samples NASA SRTM1 30 m tile `N13E080` and writes a bare-earth 5 m bilinear grid.
- `scripts/project.py` reconciles Google Earth Pro campus traces (`data/raw/REC.kml`) with OpenStreetMap geometry, projects `(lon, lat)` to `(x, z)` metres around centroid `[80.0036, 13.0088]` (`north = -Z`, `east = +X`, `north_deg = -1.8`), and outputs `public/campus.json`.

## 5. Budgets & Definition of Done
- Every campus building has a traced polygon, `verified: true`, accurate REC name, and searchable rooms (zero `verified: false` except deliberate landscaping).
- Search finds 130+ rooms/labs/offices in `< 5 ms` (`Ctrl+K`, arrows, `Enter` flies & routes, `Esc` closes).
- A* walking route works from Main Security Gate to every hostel & academic block; unreachable landscaping islands cleanly report `"No walking route"`.
- Total scene triangles `< 150,000` and total gzipped JS `< 400 KB`, enforced in CI via `scripts/check-budget.mjs`.
- Four times of day (Dawn `06:30`, Noon `12:30`, Golden Hour `17:30`, Night `21:00`) render cleanly without exposure blowout.
- Accessible keyboard navigation, `sr-only` `<h1>`, visible focus rings, `prefers-reduced-motion` honoured, ODbL attribution footer.
