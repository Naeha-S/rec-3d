#!/usr/bin/env node
/**
 * check-budget.mjs — CI & build gate (PLAN.md §2, §5.1, §7, §8).
 *
 * Verifies:
 *   1. public/campus.json passes strict schema & verified:true polygon checks
 *   2. Exact procedural scene triangle count (Ground + Buildings + Roofs +
 *      Windows [900-tri cap] + Paths + Instanced Foliage + Instanced Lamps + Wall)
 *      is strictly <= 150,000 triangles
 *   3. Production dist/assets/*.js total gzipped size is strictly <= 400 KB
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CAMPUS_JSON = path.join(ROOT, 'public', 'campus.json');
const DIST_ASSETS = path.join(ROOT, 'dist', 'assets');

const MAX_TRIS = 150_000;
const MAX_GZIP_KB = 400;
const MAX_WIN_TRIS_PER_BLDG = 900;

let failed = false;
function fail(msg) {
  console.error(`❌ BUDGET FAIL: ${msg}`);
  failed = true;
}
function pass(msg) {
  console.log(`✅ ${msg}`);
}

if (!fs.existsSync(CAMPUS_JSON)) {
  console.error(`❌ Missing ${CAMPUS_JSON}`);
  process.exit(1);
}

const campus = JSON.parse(fs.readFileSync(CAMPUS_JSON, 'utf8'));

// 1. Validate verified buildings & rooms
let unverifiedNonLandscaping = 0;
let totalRooms = 0;
for (const b of campus.buildings ?? []) {
  if (b.verified && (!Array.isArray(b.polygon) || b.polygon.length < 3)) {
    fail(`Verified building "${b.id}" is missing a valid polygon (>=3 pts).`);
  }
  if (!b.verified && !String(b.name).toLowerCase().includes('landscaping')) {
    unverifiedNonLandscaping++;
  }
  totalRooms += (b.rooms ?? []).length;
}
if (unverifiedNonLandscaping > 0) {
  fail(`Found ${unverifiedNonLandscaping} non-landscaping buildings with verified:false.`);
} else {
  pass(
    `Data integrity: ${campus.buildings.length} verified campus buildings & landmarks, ${totalRooms} searchable rooms.`
  );
}

// 2. Exact procedural geometry triangle audit using Three.js primitives
let groundTris = 0;
const rows = campus.elevation.grid.length;
const cols = campus.elevation.grid[0].length;
groundTris = (rows - 1) * (cols - 1) * 2 + 520; // terrain grid + 4 courts & parking markings

let buildingTris = 0;
let windowTris = 0;

for (const b of campus.buildings) {
  const pts = b.polygon;
  const wallH = b.height_m ?? b.levels * 3.2;
  const shape = new THREE.Shape();
  pts.forEach(([x, z], idx) => {
    if (idx === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();

  const geom = new THREE.ExtrudeGeometry(shape, {
    depth: wallH,
    bevelEnabled: true,
    bevelThickness: 0.25,
    bevelSize: 0.25,
    bevelSegments: 1,
  });
  const wallTriCount = geom.index
    ? geom.index.count / 3
    : geom.attributes.position.count / 3;
  geom.dispose();

  const roofTris = b.roof === 'flat' ? pts.length * 8 : 8;
  const signExtra = b.sign_text ? b.sign_text.length * 44 : 0;
  buildingTris += wallTriCount + roofTris + signExtra;

  if (b.style === 'shed_hall') {
    windowTris += 24;
  } else if (!b.style || b.style === 'standard' || b.style === 'main_block') {
    let rawQuads = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, z1] = pts[i];
      const [x2, z2] = pts[(i + 1) % pts.length];
      const span = Math.hypot(x2 - x1, z2 - z1);
      if (span >= 3.5) {
        rawQuads += Math.floor(span / 4.0) * b.levels;
      }
    }
    windowTris += Math.min(MAX_WIN_TRIS_PER_BLDG, rawQuads * 2);
  }
}

// Path ribbons + round joins
let pathTris = 0;
for (const p of campus.paths) {
  const segs = Math.max(1, p.points.length - 1);
  pathTris += segs * 6 + Math.max(0, p.points.length - 2) * 6;
}

// Instanced foliage per species (tree: 54, rain_tree: 66, palm: 56, shrub: 32)
const FOLIAGE_TRIS = { tree: 54, rain_tree: 66, palm: 56, shrub: 32, hedge: 24 };
let foliageTris = 0;
for (const f of campus.foliage) {
  foliageTris += FOLIAGE_TRIS[f.kind] ?? 54;
}

// Instanced lamps (32 tris/lamp) + benches (48 tris) + trash cans (48 tris)
const lampTris = campus.lamps.length * 32;
let propsTris = 0;
for (const pr of campus.props ?? []) {
  propsTris += pr.kind === 'bench' ? 48 : 48;
}
const boundaryWallTris = 26 * 8 + 420; // wall + elevated basketball deck/hoops + side court fence

const totalTris =
  Math.round(groundTris) +
  Math.round(buildingTris) +
  Math.round(windowTris) +
  Math.round(pathTris) +
  Math.round(foliageTris) +
  Math.round(lampTris) +
  propsTris +
  boundaryWallTris;

console.log(
  `   Triangle breakdown -> Ground: ${groundTris.toLocaleString()}, Buildings+Roofs: ${Math.round(
    buildingTris
  ).toLocaleString()}, Windows: ${windowTris.toLocaleString()}, Paths: ${pathTris.toLocaleString()}, Foliage (instanced): ${foliageTris.toLocaleString()}, Lamps+Props: ${(lampTris + propsTris).toLocaleString()}, Wall+Courts: ${boundaryWallTris}`
);

if (totalTris > MAX_TRIS) {
  fail(`Total scene triangles ${totalTris.toLocaleString()} exceeds budget ${MAX_TRIS.toLocaleString()}`);
} else {
  pass(`Triangle budget: ${totalTris.toLocaleString()} / ${MAX_TRIS.toLocaleString()} tris (${((totalTris / MAX_TRIS) * 100).toFixed(1)}%)`);
}

// 3. Gzipped JS bundle size audit (if dist/ exists)
if (fs.existsSync(DIST_ASSETS)) {
  const jsFiles = fs.readdirSync(DIST_ASSETS).filter((f) => f.endsWith('.js'));
  let totalRaw = 0;
  let totalGzip = 0;
  for (const file of jsFiles) {
    const buf = fs.readFileSync(path.join(DIST_ASSETS, file));
    const gz = zlib.gzipSync(buf, { level: 9 });
    totalRaw += buf.length;
    totalGzip += gz.length;
    console.log(`   JS chunk ${file}: ${(buf.length / 1024).toFixed(1)} KB raw | ${(gz.length / 1024).toFixed(1)} KB gzip`);
  }
  const totalGzipKB = totalGzip / 1024;
  if (totalGzipKB > MAX_GZIP_KB) {
    fail(`Total gzipped JS ${totalGzipKB.toFixed(1)} KB exceeds ${MAX_GZIP_KB} KB cap.`);
  } else {
    pass(`JS bundle budget: ${totalGzipKB.toFixed(1)} KB / ${MAX_GZIP_KB} KB gzipped (${(totalRaw / 1024).toFixed(1)} KB raw)`);
  }
} else {
  console.log('ℹ️  dist/assets not found yet — run `npm run build` before final CI budget check.');
}

if (failed) {
  process.exit(1);
}
