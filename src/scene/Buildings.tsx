import { useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { Building, BuildingCategory, ElevationData } from '../types';
import { getPolygonCentroid, sampleElevation } from '../logic/elevation';

interface BuildingsProps {
  buildings: Building[];
  elevation: ElevationData;
  selectedId: string | null;
  hoveredId: string | null;
  activeCategory: BuildingCategory | 'all';
  castShadow: boolean;
  nightFactor: number;
  onHover: (building: Building | null, screenPos?: { x: number; y: number }) => void;
  onSelect: (building: Building) => void;
}

// Authentic REC architectural palette matched to aerial campus photography (image-4.png):
// Crisp white/chalk-white facades with vermilion red-orange trim & cool slate roofs
export const WALL_PALETTE: Record<BuildingCategory, string> = {
  academic: '#f1f3f6',
  admin: '#f6f7f9',
  hostel: '#eef0f4',
  service: '#eceae4',
  gate: '#f4f4f6',
  sports: '#e8edf0',
};

export const ROOF_PALETTE: Record<BuildingCategory, string> = {
  academic: '#7c8794',
  admin: '#495a6b',
  hostel: '#838c96',
  service: '#78828c',
  gate: '#dc3c22',
  sports: '#5b768c',
};

// Minimalist low-poly 3D vector stroke font (coordinates in [0..1] x [0..1])
type Stroke = [number, number, number, number];
const GLYPH_STROKES: Record<string, Stroke[]> = {
  A: [[0, 0, 0.5, 1], [1, 0, 0.5, 1], [0.2, 0.42, 0.8, 0.42]],
  B: [[0, 0, 0, 1], [0, 1, 0.8, 1], [0.8, 1, 0.8, 0.52], [0, 0.52, 0.85, 0.52], [0.85, 0.52, 0.85, 0], [0, 0, 0.85, 0]],
  C: [[0.95, 0.92, 0.15, 1], [0.15, 1, 0, 0.5], [0, 0.5, 0.15, 0], [0.15, 0, 0.95, 0.08]],
  D: [[0, 0, 0, 1], [0, 1, 0.72, 0.92], [0.72, 0.92, 0.92, 0.5], [0.92, 0.5, 0.72, 0.08], [0.72, 0.08, 0, 0]],
  E: [[0, 0, 0, 1], [0, 1, 0.92, 1], [0, 0.52, 0.78, 0.52], [0, 0, 0.92, 0]],
  F: [[0, 0, 0, 1], [0, 1, 0.92, 1], [0, 0.52, 0.76, 0.52]],
  G: [[0.92, 0.9, 0.15, 1], [0.15, 1, 0, 0.5], [0, 0.5, 0.15, 0], [0.15, 0, 0.92, 0], [0.92, 0, 0.92, 0.48], [0.5, 0.48, 0.92, 0.48]],
  H: [[0, 0, 0, 1], [0.92, 0, 0.92, 1], [0, 0.52, 0.92, 0.52]],
  I: [[0.46, 0, 0.46, 1], [0.15, 1, 0.77, 1], [0.15, 0, 0.77, 0]],
  J: [[0.8, 1, 0.8, 0.18], [0.8, 0.18, 0.45, 0], [0.45, 0, 0.08, 0.22]],
  K: [[0, 0, 0, 1], [0.05, 0.5, 0.92, 1], [0.22, 0.56, 0.92, 0]],
  L: [[0, 1, 0, 0], [0, 0, 0.9, 0]],
  M: [[0, 0, 0, 1], [0, 1, 0.48, 0.35], [0.96, 1, 0.48, 0.35], [0.96, 0, 0.96, 1]],
  N: [[0, 0, 0, 1], [0, 1, 0.92, 0], [0.92, 0, 0.92, 1]],
  O: [[0.12, 0, 0.84, 0], [0.84, 0, 0.96, 0.5], [0.96, 0.5, 0.84, 1], [0.84, 1, 0.12, 1], [0.12, 1, 0, 0.5], [0, 0.5, 0.12, 0]],
  P: [[0, 0, 0, 1], [0, 1, 0.85, 1], [0.85, 1, 0.85, 0.52], [0.85, 0.52, 0, 0.52]],
  R: [[0, 0, 0, 1], [0, 1, 0.85, 1], [0.85, 1, 0.85, 0.52], [0.85, 0.52, 0, 0.52], [0.38, 0.52, 0.92, 0]],
  S: [[0.9, 0.92, 0.12, 0.98], [0.12, 0.98, 0.05, 0.56], [0.05, 0.56, 0.88, 0.44], [0.88, 0.44, 0.85, 0.04], [0.85, 0.04, 0.06, 0.08]],
  T: [[0, 1, 0.96, 1], [0.48, 0, 0.48, 1]],
  U: [[0, 1, 0, 0.15], [0, 0.15, 0.48, 0], [0.48, 0, 0.92, 0.15], [0.92, 0.15, 0.92, 1]],
  V: [[0, 1, 0.48, 0], [0.96, 1, 0.48, 0]],
  W: [[0, 1, 0.22, 0], [0.22, 0, 0.48, 0.55], [0.48, 0.55, 0.74, 0], [0.74, 0, 0.96, 1]],
  Y: [[0, 1, 0.48, 0.48], [0.96, 1, 0.48, 0.48], [0.48, 0.48, 0.48, 0]],
};

function pushColoredBox(
  verts: number[],
  norms: number[],
  cols: number[],
  box: THREE.BufferGeometry,
  colorHex: string
) {
  const nonIdx = box.index ? box.toNonIndexed() : box;
  nonIdx.computeVertexNormals();
  const p = nonIdx.attributes.position;
  const n = nonIdx.attributes.normal;
  const c = new THREE.Color(colorHex);
  for (let i = 0; i < p.count; i++) {
    verts.push(p.getX(i), p.getY(i), p.getZ(i));
    norms.push(n.getX(i), n.getY(i), n.getZ(i));
    cols.push(c.r, c.g, c.b);
  }
  if (nonIdx !== box) nonIdx.dispose();
}

function build3DSignGeometry(
  text: string,
  centerX: number,
  baseY: number,
  centerZ: number,
  dirX: number,
  dirZ: number,
  letterHeight = 2.25
): THREE.BufferGeometry {
  const verts: number[] = [];
  const norms: number[] = [];
  const cols: number[] = [];

  const upper = text.toUpperCase();
  const charW = letterHeight * 0.68;
  const gap = letterHeight * 0.24;
  const step = charW + gap;
  const totalW = upper.length * step - gap;
  const startOffset = -totalW * 0.5;
  const thickness = 0.34;
  const strokeW = letterHeight * 0.17;
  const angleY = Math.atan2(-dirZ, dirX);

  // Subtle steel mounting rail along bottom of letters
  const rail = new THREE.BoxGeometry(totalW + 1.6, 0.18, 0.22);
  rail.rotateY(angleY);
  rail.translate(centerX, baseY - 0.1, centerZ);
  pushColoredBox(verts, norms, cols, rail, '#52525b');
  rail.dispose();

  for (let idx = 0; idx < upper.length; idx++) {
    const ch = upper[idx];
    if (ch === ' ') continue;
    const strokes = GLYPH_STROKES[ch];
    if (!strokes) continue;

    const charBase = startOffset + idx * step;
    for (const [x0, y0, x1, y1] of strokes) {
      const lx0 = charBase + x0 * charW;
      const ly0 = y0 * letterHeight;
      const lx1 = charBase + x1 * charW;
      const ly1 = y1 * letterHeight;
      const dx = lx1 - lx0;
      const dy = ly1 - ly0;
      const len = Math.hypot(dx, dy);
      if (len < 0.02) continue;

      const midLocalX = (lx0 + lx1) * 0.5;
      const midY = baseY + (ly0 + ly1) * 0.5;
      const rotZ = Math.atan2(dy, dx);

      const segBox = new THREE.BoxGeometry(len + strokeW * 0.38, strokeW, thickness);
      segBox.rotateZ(rotZ);
      segBox.rotateY(angleY);
      segBox.translate(
        centerX + dirX * midLocalX,
        midY,
        centerZ + dirZ * midLocalX
      );
      pushColoredBox(verts, norms, cols, segBox, '#d12b22');
      segBox.dispose();
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return out;
}

function computePrincipalAxis(poly: [number, number][]) {
  let bestLen = 0;
  let ux = 1;
  let uz = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len > bestLen) {
      bestLen = len;
      ux = (x2 - x1) / len;
      uz = (z2 - z1) / len;
    }
  }
  const vx = -uz;
  const vz = ux;
  const [cx, cz] = getPolygonCentroid(poly);

  let minU = Infinity,
    maxU = -Infinity;
  let minV = Infinity,
    maxV = -Infinity;
  for (const [px, pz] of poly) {
    const du = (px - cx) * ux + (pz - cz) * uz;
    const dv = (px - cx) * vx + (pz - cz) * vz;
    if (du < minU) minU = du;
    if (du > maxU) maxU = du;
    if (dv < minV) minV = dv;
    if (dv > maxV) maxV = dv;
  }

  return { cx, cz, ux, uz, vx, vz, minU, maxU, minV, maxV };
}

function buildRoofGeometry(b: Building, wallHeight: number): THREE.BufferGeometry {
  const topY = wallHeight + 0.25;

  if (b.roof === 'flat') {
    const parapetH = 0.9;
    const thick = 0.55;
    const ring = b.polygon;
    const verts: number[] = [];

    const shape = new THREE.Shape();
    ring.forEach(([x, z], idx) => {
      if (idx === 0) shape.moveTo(x, -z);
      else shape.lineTo(x, -z);
    });
    shape.closePath();
    const deckGeo = new THREE.ShapeGeometry(shape);
    deckGeo.rotateX(-Math.PI / 2);
    const nonIdxDeck = deckGeo.toNonIndexed();
    const dp = nonIdxDeck.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      verts.push(dp.getX(i), topY + 0.04, dp.getZ(i));
    }
    deckGeo.dispose();
    nonIdxDeck.dispose();

    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i];
      const [bx, bz] = ring[(i + 1) % ring.length];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.25) continue;
      const nx = -dz / len;
      const nz = dx / len;
      const ox0 = ax + nx * 0.2,
        oz0 = az + nz * 0.2;
      const ox1 = bx + nx * 0.2,
        oz1 = bz + nz * 0.2;
      const ix0 = ax - nx * thick,
        iz0 = az - nz * thick;
      const ix1 = bx - nx * thick,
        iz1 = bz - nz * thick;
      const y0 = topY;
      const y1 = topY + parapetH;

      verts.push(ox0, y0, oz0, ox1, y0, oz1, ox1, y1, oz1);
      verts.push(ox0, y0, oz0, ox1, y1, oz1, ox0, y1, oz0);
      verts.push(ix1, y0, iz1, ix0, y0, iz0, ix0, y1, iz0);
      verts.push(ix1, y0, iz1, ix0, y1, iz0, ix1, y1, iz1);
      verts.push(ox0, y1, oz0, ox1, y1, oz1, ix1, y1, iz1);
      verts.push(ox0, y1, oz0, ix1, y1, iz1, ix0, y1, iz0);
    }

    const buf = new THREE.BufferGeometry();
    buf.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    buf.computeVertexNormals();
    return buf;
  }

  const obb = computePrincipalAxis(b.polygon);
  const toWorld = (u: number, v: number): [number, number] => [
    obb.cx + u * obb.ux + v * obb.vx,
    obb.cz + u * obb.uz + v * obb.vz,
  ];
  const overhang = 0.55;
  const u0 = obb.minU - overhang;
  const u1 = obb.maxU + overhang;
  const v0 = obb.minV - overhang;
  const v1 = obb.maxV + overhang;
  const vMid = (v0 + v1) * 0.5;

  const [c00x, c00z] = toWorld(u0, v0);
  const [c10x, c10z] = toWorld(u1, v0);
  const [c11x, c11z] = toWorld(u1, v1);
  const [c01x, c01z] = toWorld(u0, v1);

  const verts: number[] = [];
  if (b.roof === 'gable') {
    const ridgeH = topY + Math.min(3.1, Math.max(1.6, (v1 - v0) * 0.14));
    const [r0x, r0z] = toWorld(u0, vMid);
    const [r1x, r1z] = toWorld(u1, vMid);

    // Outward normals verified via v × u = +Y in Three.js right-handed space
    verts.push(c00x, topY, c00z, r1x, ridgeH, r1z, c10x, topY, c10z);
    verts.push(c00x, topY, c00z, r0x, ridgeH, r0z, r1x, ridgeH, r1z);
    verts.push(c11x, topY, c11z, r0x, ridgeH, r0z, c01x, topY, c01z);
    verts.push(c11x, topY, c11z, r1x, ridgeH, r1z, r0x, ridgeH, r0z);
    verts.push(c00x, topY, c00z, c01x, topY, c01z, r0x, ridgeH, r0z);
    verts.push(c11x, topY, c11z, c10x, topY, c10z, r1x, ridgeH, r1z);
  } else {
    const highY = topY + Math.min(2.2, Math.max(1.2, (v1 - v0) * 0.1));
    verts.push(c00x, topY, c00z, c11x, highY, c11z, c10x, topY, c10z);
    verts.push(c00x, topY, c00z, c01x, highY, c01z, c11x, highY, c11z);
    verts.push(c00x, topY, c00z, c01x, topY, c01z, c01x, highY, c01z);
    verts.push(c11x, topY, c11z, c10x, topY, c10z, c11x, highY, c11z);
    verts.push(c01x, topY, c01z, c11x, topY, c11z, c11x, highY, c11z);
    verts.push(c01x, topY, c01z, c11x, highY, c11z, c01x, highY, c01z);
  }

  const buf = new THREE.BufferGeometry();
  buf.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  buf.computeVertexNormals();
  return buf;
}

/**
 * Custom vertex-colored architectural geometry for special campus structures:
 * - 'arch': Open drive-through Main Security Gate / NH-48 Entrance Arch
 * - 'steps': 3 big white terraced steps for White Stairs
 * - 'monument': Aadhi Statue roundabout pylon + purple REC emblem
 * - 'fountain': Raised circular stone basin + 2-tier fountain spray in front of A Block
 * - 'pool_enclosure': Perimeter enclosure wall + poolside changing-room pavilion
 * - 'pavilion_cafe': Open-sided Hut Cafe with columns, low parapet counter & overhanging pitched roof
 * - 'open_cafe': Open-air Garden Cafe patio with umbrellas, tables & tiffin counter
 */
function buildSpecialStructure(
  b: Building,
  elevation: ElevationData,
  baseY: number
): THREE.BufferGeometry | null {
  const obb = computePrincipalAxis(b.polygon);
  const angleY = Math.atan2(-obb.uz, obb.ux);
  const spanU = Math.max(4.0, obb.maxU - obb.minU);
  const spanV = Math.max(3.0, obb.maxV - obb.minV);
  const verts: number[] = [];
  const norms: number[] = [];
  const cols: number[] = [];

  const addLocalBox = (
    w: number,
    h: number,
    d: number,
    lu: number,
    ly: number,
    lv: number,
    hex: string
  ) => {
    const box = new THREE.BoxGeometry(w, h, d);
    box.translate(lu, ly, lv);
    box.rotateY(angleY);
    box.translate(obb.cx, 0, obb.cz);
    pushColoredBox(verts, norms, cols, box, hex);
    box.dispose();
  };

  if (b.style === 'arch') {
    const h = b.height_m;
    const clearHalf = Math.max(3.6, spanU * 0.34);
    const pierW = 1.9;
    const pierD = Math.min(3.6, spanV);
    const lintelW = (clearHalf + pierW) * 2 + 1.4;

    // Left & right piers straddling the road
    addLocalBox(pierW, h - 1.4, pierD, -clearHalf - pierW * 0.45, (h - 1.4) * 0.5, 0, '#f3efe6');
    addLocalBox(pierW, h - 1.4, pierD, clearHalf + pierW * 0.45, (h - 1.4) * 0.5, 0, '#f3efe6');
    // Terracotta pilaster accents on piers
    addLocalBox(0.55, h - 1.3, pierD + 0.16, -clearHalf - pierW * 0.45, (h - 1.3) * 0.5, 0, '#c25238');
    addLocalBox(0.55, h - 1.3, pierD + 0.16, clearHalf + pierW * 0.45, (h - 1.3) * 0.5, 0, '#c25238');
    // Overhead spanning arch beam (5.5m+ clearance below!)
    addLocalBox(lintelW, 1.55, pierD + 0.5, 0, h - 0.8, 0, '#f6f3eb');
    // Terracotta top crown cornice
    addLocalBox(lintelW + 0.7, 0.48, pierD + 0.8, 0, h + 0.15, 0, '#b84830');
    // Guard booth beside left pier
    addLocalBox(2.4, 2.8, 2.4, -clearHalf - pierW - 1.3, 1.4, 0, '#e5dfd3');
  } else if (b.style === 'steps') {
    // 3 big wide white terraced steps facing the central grassy ground (+X)
    const stepColors = ['#f7f7f2', '#efefea', '#e6e6df'];
    const totalDepth = Math.max(7.5, spanV);
    const stepW = totalDepth / 3;
    for (let s = 0; s < 3; s++) {
      const stepH = (3 - s) * 0.92;
      // Ensure steps descend eastward (+X) toward the central field
      const eastSign = obb.vx >= 0 ? 1 : -1;
      const lv = (-1 + s) * stepW * eastSign;
      addLocalBox(spanU * 0.94, stepH + 0.8, stepW + 0.15, 0, stepH * 0.5 - 0.4, lv, stepColors[s]);
    }
  } else if (b.style === 'monument') {
    // Aadhi Statue (image-5.png): REC's heroic Blackbuck mascot in purple tracksuit,
    // yellow zipper, raised right fist, purple visor & swept-back spiraled horns on dark granite plinth!
    const baseCyl = new THREE.CylinderGeometry(4.3, 4.5, 0.42, 14);
    baseCyl.translate(obb.cx, 0.21, obb.cz);
    pushColoredBox(verts, norms, cols, baseCyl, '#e5e7eb');
    baseCyl.dispose();

    const lawnCyl = new THREE.CylinderGeometry(3.85, 3.85, 0.48, 14);
    lawnCyl.translate(obb.cx, 0.24, obb.cz);
    pushColoredBox(verts, norms, cols, lawnCyl, '#589c54');
    lawnCyl.dispose();

    // Dark charcoal-granite octagonal pedestal
    const plinth = new THREE.CylinderGeometry(1.75, 1.95, 1.85, 8);
    plinth.translate(obb.cx, 1.15, obb.cz);
    pushColoredBox(verts, norms, cols, plinth, '#272c33');
    plinth.dispose();

    const plinthCap = new THREE.CylinderGeometry(1.92, 1.92, 0.18, 8);
    plinthCap.translate(obb.cx, 2.12, obb.cz);
    pushColoredBox(verts, norms, cols, plinthCap, '#3f4650');
    plinthCap.dispose();

    // Helper for rotated/positioned mascot limbs facing North-West (-X/-Z Main Gate roundabout approach)
    const mascotYaw = Math.PI * 0.84;
    const addMascotPart = (
      geom: THREE.BufferGeometry,
      lx: number,
      ly: number,
      lz: number,
      rx: number,
      ry: number,
      rz: number,
      hex: string
    ) => {
      geom.rotateX(rx);
      geom.rotateZ(rz);
      geom.rotateY(ry);
      geom.translate(lx, 2.2 + ly, lz);
      geom.rotateY(mascotYaw);
      geom.translate(obb.cx, 0, obb.cz);
      pushColoredBox(verts, norms, cols, geom, hex);
      geom.dispose();
    };

    // Hooves / athletic shoes
    addMascotPart(new THREE.BoxGeometry(0.45, 0.24, 0.68), -0.58, 0.12, 0.08, 0, 0.1, 0, '#d6d3d1');
    addMascotPart(new THREE.BoxGeometry(0.45, 0.24, 0.68), 0.58, 0.12, -0.05, 0, -0.15, 0, '#d6d3d1');

    // Purple tracksuit legs in heroic wide stance
    addMascotPart(new THREE.CylinderGeometry(0.28, 0.23, 1.85, 7), -0.46, 1.08, 0.04, 0, 0, -0.16, '#5b3ea8');
    addMascotPart(new THREE.CylinderGeometry(0.28, 0.23, 1.85, 7), 0.46, 1.08, -0.02, 0, 0, 0.16, '#5b3ea8');

    // Pelvis & dark belt
    addMascotPart(new THREE.CylinderGeometry(0.56, 0.52, 0.48, 8), 0, 2.02, 0, 0, 0, 0, '#53389e');
    addMascotPart(new THREE.CylinderGeometry(0.58, 0.58, 0.14, 8), 0, 2.26, 0, 0, 0, 0, '#31255a');

    // Athletic V-taper purple tracksuit jacket torso
    addMascotPart(new THREE.CylinderGeometry(0.76, 0.55, 1.55, 8), 0, 3.05, 0, 0, 0, 0, '#6246b5');

    // Bright yellow front zipper stripe & gold 'R' chest emblem
    addMascotPart(new THREE.BoxGeometry(0.11, 1.48, 0.14), 0, 3.06, 0.62, -0.08, 0, 0, '#facc15');
    addMascotPart(new THREE.BoxGeometry(0.28, 0.34, 0.12), 0.3, 3.32, 0.62, -0.08, 0, 0, '#eab308');

    // Right arm (viewer's left, -X): raised high in victorious pumped fist!
    addMascotPart(new THREE.CylinderGeometry(0.22, 0.2, 1.05, 7), -0.98, 3.62, 0.08, 0, 0, 0.72, '#6246b5');
    addMascotPart(new THREE.CylinderGeometry(0.2, 0.18, 0.95, 7), -1.32, 4.32, 0.22, 0.2, 0, 0.08, '#6246b5');
    addMascotPart(new THREE.DodecahedronGeometry(0.28, 0), -1.35, 4.88, 0.32, 0, 0, 0, '#a89988');

    // Left arm (viewer's right, +X): bent confidently with hand on hip!
    addMascotPart(new THREE.CylinderGeometry(0.22, 0.2, 0.95, 7), 0.96, 3.35, 0.0, 0, 0, -0.68, '#6246b5');
    addMascotPart(new THREE.CylinderGeometry(0.19, 0.18, 0.85, 7), 0.92, 2.68, 0.12, 0.18, 0, 0.58, '#6246b5');
    addMascotPart(new THREE.DodecahedronGeometry(0.24, 0), 0.62, 2.38, 0.25, 0, 0, 0, '#a89988');

    // White collar & sculpted Blackbuck neck + head + muzzle
    addMascotPart(new THREE.CylinderGeometry(0.32, 0.38, 0.52, 8), 0, 3.98, 0.06, 0.1, 0, 0, '#f5f5f4');
    addMascotPart(new THREE.DodecahedronGeometry(0.52, 0), 0, 4.46, 0.12, 0, 0, 0, '#968778');
    addMascotPart(new THREE.ConeGeometry(0.34, 0.75, 7), 0, 4.42, 0.56, Math.PI * 0.46, 0, 0, '#e7e5e4');

    // Iconic purple futuristic visor / sunglasses across eyes!
    addMascotPart(new THREE.BoxGeometry(0.82, 0.22, 0.38), 0, 4.58, 0.42, 0.05, 0, 0, '#6d4aff');

    // Pointed antelope ears
    addMascotPart(new THREE.ConeGeometry(0.14, 0.65, 5), -0.48, 4.82, -0.02, -0.2, 0, 0.68, '#8c7d6e');
    addMascotPart(new THREE.ConeGeometry(0.14, 0.65, 5), 0.48, 4.82, -0.02, -0.2, 0, -0.68, '#8c7d6e');

    // Two long swept-back spiraled Blackbuck horns!
    addMascotPart(new THREE.ConeGeometry(0.13, 1.85, 6), -0.34, 5.55, -0.48, -0.62, 0, 0.24, '#44403c');
    addMascotPart(new THREE.ConeGeometry(0.13, 1.85, 6), 0.34, 5.55, -0.48, -0.62, 0, -0.24, '#44403c');
  } else if (b.style === 'fountain') {
    // Circular white stone basin rim + 2-tier pedestal + shimmering water spray crown
    const outerRim = new THREE.CylinderGeometry(4.9, 5.1, 0.78, 16, 1, true);
    outerRim.translate(obb.cx, 0.39, obb.cz);
    pushColoredBox(verts, norms, cols, outerRim, '#f5f2ea');
    outerRim.dispose();

    const coping = new THREE.CylinderGeometry(5.15, 5.15, 0.18, 16);
    coping.translate(obb.cx, 0.8, obb.cz);
    pushColoredBox(verts, norms, cols, coping, '#faf8f2');
    coping.dispose();

    const waterDisc = new THREE.CylinderGeometry(4.65, 4.65, 0.12, 16);
    waterDisc.translate(obb.cx, 0.86, obb.cz);
    pushColoredBox(verts, norms, cols, waterDisc, '#38bdf8');
    waterDisc.dispose();

    const tier1 = new THREE.CylinderGeometry(1.35, 1.65, 1.1, 10);
    tier1.translate(obb.cx, 1.3, obb.cz);
    pushColoredBox(verts, norms, cols, tier1, '#f1ede4');
    tier1.dispose();

    const bowl = new THREE.CylinderGeometry(2.1, 1.1, 0.38, 12);
    bowl.translate(obb.cx, 1.95, obb.cz);
    pushColoredBox(verts, norms, cols, bowl, '#faf8f2');
    bowl.dispose();

    const spray = new THREE.ConeGeometry(1.15, 1.35, 8);
    spray.translate(obb.cx, 2.55, obb.cz);
    pushColoredBox(verts, norms, cols, spray, '#bae6fd');
    spray.dispose();
  } else if (b.style === 'pool_enclosure') {
    // Raised zero-z-fighting architectural Swimming Pool Complex:
    // Travertine pool deck apron + recessed turquoise water basin + lane lines + changing pavilion
    const halfU = spanU * 0.5;
    const halfV = spanV * 0.5;
    let maxGroundH = 0;
    for (let su = -halfU; su <= halfU; su += 5.0) {
      for (let sv = -halfV; sv <= halfV; sv += 5.0) {
        const wx = obb.cx + su * obb.ux + sv * obb.vx;
        const wz = obb.cz + su * obb.uz + sv * obb.vz;
        maxGroundH = Math.max(maxGroundH, sampleElevation(elevation, wx, wz) - baseY);
      }
    }
    const deckTop = maxGroundH + 0.44;
    const waterTop = maxGroundH + 0.28;
    const northDeckW = 7.4;
    const southDeckW = 4.2;
    const sideDeckW = 4.4;
    const basinU = Math.max(16.0, spanU - northDeckW - southDeckW);
    const basinV = Math.max(10.0, spanV - sideDeckW * 2);
    const basinCenterU = (northDeckW - southDeckW) * 0.5;

    // 1. Four solid raised travertine pool deck slabs framing the open pool basin
    addLocalBox(northDeckW, deckTop, spanV, -halfU + northDeckW * 0.5, deckTop * 0.5, 0, '#e8e3d5');
    addLocalBox(southDeckW, deckTop, spanV, halfU - southDeckW * 0.5, deckTop * 0.5, 0, '#e8e3d5');
    addLocalBox(basinU + 0.2, deckTop, sideDeckW, basinCenterU, deckTop * 0.5, -halfV + sideDeckW * 0.5, '#e8e3d5');
    addLocalBox(basinU + 0.2, deckTop, sideDeckW, basinCenterU, deckTop * 0.5, halfV - sideDeckW * 0.5, '#e8e3d5');

    // Crisp white inner coping trim around the pool water edge
    addLocalBox(basinU + 0.7, 0.08, 0.42, basinCenterU, deckTop + 0.03, -basinV * 0.5 - 0.18, '#fafaf9');
    addLocalBox(basinU + 0.7, 0.08, 0.42, basinCenterU, deckTop + 0.03, basinV * 0.5 + 0.18, '#fafaf9');
    addLocalBox(0.42, 0.08, basinV + 0.7, basinCenterU - basinU * 0.5 - 0.18, deckTop + 0.03, 0, '#fafaf9');
    addLocalBox(0.42, 0.08, basinV + 0.7, basinCenterU + basinU * 0.5 + 0.18, deckTop + 0.03, 0, '#fafaf9');

    // 2. Clean recessed turquoise water slab (well above terrain, 16 cm below coping — zero z-fighting!)
    addLocalBox(basinU, waterTop, basinV, basinCenterU, waterTop * 0.5, 0, '#23a6d8');

    // Subtle swimming lane divider ropes along the length of the pool
    for (const frac of [-0.3, -0.1, 0.1, 0.3]) {
      addLocalBox(basinU - 1.4, 0.04, 0.14, basinCenterU, waterTop + 0.025, frac * basinV, '#bae6fd');
    }

    // 3. Perimeter enclosure walls + north changing-room & shower pavilion
    const wallH = 2.15;
    addLocalBox(spanU, wallH, 0.42, 0, deckTop + wallH * 0.5, -halfV + 0.21, '#ede8dc');
    addLocalBox(spanU, wallH, 0.42, 0, deckTop + wallH * 0.5, halfV - 0.21, '#ede8dc');
    addLocalBox(0.42, wallH, spanV, -halfU + 0.21, deckTop + wallH * 0.5, 0, '#ede8dc');
    addLocalBox(0.42, wallH, spanV, halfU - 0.21, deckTop + wallH * 0.5, 0, '#ede8dc');
    addLocalBox(5.0, 3.2, spanV * 0.84, -halfU + 3.1, deckTop + 1.6, 0, '#f4f4f5');
    addLocalBox(5.6, 0.36, spanV * 0.88, -halfU + 3.1, deckTop + 3.35, 0, '#4f8699');
  } else if (b.style === 'pavilion_cafe') {
    // Taller open-ish Hut Cafe (height increased!): raised deck, low half-walls, tall 5.4m columns, overhanging gable roof
    const w = spanU;
    const d = spanV;
    const eaveH = 5.4;
    // Floor slab
    addLocalBox(w, 0.38, d, 0, 0.19, 0, '#d8d2c7');
    // Low 1.15 m warm brick/terracotta half-walls around perimeter with wide open entrances
    addLocalBox(w * 0.36, 1.15, 0.4, -w * 0.3, 0.76, -d * 0.47, '#c85a38');
    addLocalBox(w * 0.36, 1.15, 0.4, w * 0.3, 0.76, -d * 0.47, '#c85a38');
    addLocalBox(w * 0.36, 1.15, 0.4, -w * 0.3, 0.76, d * 0.47, '#c85a38');
    addLocalBox(w * 0.36, 1.15, 0.4, w * 0.3, 0.76, d * 0.47, '#c85a38');
    addLocalBox(0.4, 1.15, d * 0.7, -w * 0.47, 0.76, 0, '#c85a38');
    addLocalBox(0.4, 1.15, d * 0.7, w * 0.47, 0.76, 0, '#c85a38');
    // Central kitchen/serving island inside open hall
    addLocalBox(w * 0.42, 2.6, d * 0.34, 0, 1.48, 0.08 * d, '#f1efe8');
    // Tall open structural columns around the perimeter
    const colsU = [-0.46, -0.16, 0.16, 0.46];
    const colsV = [-0.46, 0.46];
    for (const cu of colsU) {
      for (const cv of colsV) {
        addLocalBox(0.46, eaveH, 0.46, cu * w, eaveH * 0.5 + 0.2, cv * d, '#5c402c');
      }
    }
    // Overhanging warm terracotta pavilion roof
    const roofGeo = buildRoofGeometry(b, eaveH);
    pushColoredBox(verts, norms, cols, roofGeo, '#a84c30');
    roofGeo.dispose();
  } else if (b.style === 'maggi_kiosk') {
    // Maggi Hotspot (image-2.png): Proper square bright-red kiosk with yellow Maggi logo plaque,
    // white overhanging flat roof slab, white base plinth & right-side glass counter!
    const kSize = Math.min(spanU, spanV);
    const kH = 3.45;
    // White tiled base plinth
    addLocalBox(kSize + 1.2, 0.24, kSize + 1.2, 0, 0.12, 0, '#f8fafc');
    // Vivid Maggi Red square body
    addLocalBox(kSize, kH, kSize, 0, 0.24 + kH * 0.5, 0, '#dc2626');
    // Crisp white overhanging canopy roof slab
    addLocalBox(kSize + 1.5, 0.28, kSize + 1.5, 0, 0.24 + kH + 0.14, 0, '#f8fafc');

    // Front facade details (facing West/South toward B-Block cobblestone path, -U & +V)
    const fz = kSize * 0.5 + 0.06;
    // Left half: black frame + iconic yellow Maggi square plaque + red Maggi oval + yellow Hotspot text bar
    addLocalBox(kSize * 0.38, 1.15, 0.1, -kSize * 0.24, 2.65, fz, '#18181b');
    addLocalBox(kSize * 0.3, 0.92, 0.14, -kSize * 0.24, 2.65, fz + 0.03, '#facc15');
    addLocalBox(kSize * 0.22, 0.38, 0.17, -kSize * 0.24, 2.65, fz + 0.05, '#dc2626');
    addLocalBox(kSize * 0.36, 0.38, 0.14, -kSize * 0.24, 1.72, fz + 0.02, '#f59e0b');
    addLocalBox(kSize * 0.16, 0.24, 0.12, -kSize * 0.24, 1.25, fz + 0.02, '#cbd5e1'); // Selfie Spot plate

    // Right half: dark glass beverage display fridge & sliding service window + bottom white vent
    addLocalBox(kSize * 0.44, 2.55, 0.12, kSize * 0.22, 2.02, fz, '#1e293b');
    addLocalBox(kSize * 0.4, 0.28, 0.12, kSize * 0.22, 0.52, fz, '#f1f5f9');
    // Chrome foot-rail along bottom front
    addLocalBox(kSize * 0.88, 0.09, 0.16, 0, 0.38, fz + 0.12, '#e2e8f0');
  } else if (b.style === 'idea_factory') {
    // Idea Factory (image-2.png):
    // Tall modern building with crisp white/silver perimeter cladding frame,
    // full-height floor-to-ceiling glass curtain wall across the front facade,
    // vertical white/metallic mullions/fins, and ground-level entrance portal.
    const w = spanU;
    const d = spanV;
    const h = b.height_m || 15.0;

    // Ground plaza / stepped granite plinth
    addLocalBox(w + 1.4, 0.36, d + 1.4, 0, 0.18, 0, '#94a3b8');
    // Main structural core (slightly recessed behind glass curtain wall)
    addLocalBox(w - 0.6, h - 0.4, d - 0.8, 0, 0.36 + (h - 0.4) * 0.5, 0, '#e2e8f0');

    // Full-height dark blue-teal glass curtain wall on front (+V) and back (-V)
    for (const sgn of [-1, 1]) {
      const gz = sgn * (d * 0.5 - 0.12);
      addLocalBox(w - 1.4, h - 1.4, 0.18, 0, 0.36 + (h - 1.0) * 0.5, gz, '#1e3a5f');

      // Vertical architectural mullions / perforated screen fins
      const numFins = Math.max(6, Math.floor(w / 2.2));
      for (let i = 0; i <= numFins; i++) {
        const fu = -w * 0.5 + 0.8 + (i / numFins) * (w - 1.6);
        addLocalBox(0.18, h - 1.2, 0.34, fu, 0.36 + (h - 1.0) * 0.5, gz + sgn * 0.08, '#f1f5f9');
      }

      // Subtle horizontal floor spandrel bands behind/across the glass
      const floors = Math.max(3, Math.round(h / 3.6));
      for (let f = 1; f < floors; f++) {
        const fy = 0.36 + (f / floors) * (h - 1.2);
        addLocalBox(w - 1.3, 0.22, 0.24, 0, fy, gz + sgn * 0.02, '#cbd5e1');
      }
    }

    // Crisp white/silver outer cladding frame (left/right pillars + top parapet beam)
    addLocalBox(1.1, h, d + 0.15, -w * 0.5 + 0.55, 0.36 + h * 0.5, 0, '#f8fafc');
    addLocalBox(1.1, h, d + 0.15, w * 0.5 - 0.55, 0.36 + h * 0.5, 0, '#f8fafc');
    addLocalBox(w + 0.2, 1.15, d + 0.25, 0, 0.36 + h - 0.4, 0, '#f8fafc');

    // Ground-level recessed entrance portal on front (+V)
    addLocalBox(4.2, 3.4, 0.9, 0, 0.36 + 1.7, d * 0.5 + 0.15, '#cbd5e1');
    addLocalBox(3.4, 2.9, 0.3, 0, 0.36 + 1.45, d * 0.5 + 0.48, '#0f172a');
  } else if (b.style === 'dominos') {
    // Domino's Pizza (image-1.png):
    // Dark navy-blue exterior, pitched/slanted roof with bright red fascia trim,
    // Domino's red-and-blue square logo + white signage, serving window & outdoor patio railing.
    const w = spanU;
    const d = spanV;
    const h = b.height_m || 4.6;

    // Concrete patio plinth
    addLocalBox(w + 1.6, 0.24, d + 2.4, 0, 0.12, 0.5, '#cbd5e1');
    // Dark navy-blue main building body
    addLocalBox(w, h, d, 0, 0.24 + h * 0.5, 0, '#172554');
    // Slanted/stepped roof cap with bright red fascia trim
    addLocalBox(w + 0.5, 0.32, d + 0.7, 0, 0.24 + h + 0.16, 0.1, '#dc2626');
    addLocalBox(w + 0.3, 0.25, d + 0.5, 0, 0.24 + h + 0.38, 0.05, '#1e293b');

    // Front (+V) Domino's signage: red/blue tilted logo + white "Domino's" bar
    const fz = d * 0.5 + 0.08;
    addLocalBox(0.75, 0.75, 0.12, -w * 0.18, 0.24 + h - 0.9, fz, '#dc2626');
    addLocalBox(0.75, 0.75, 0.12, -w * 0.18 - 0.45, 0.24 + h - 1.25, fz, '#2563eb');
    addLocalBox(w * 0.42, 0.65, 0.12, w * 0.14, 0.24 + h - 1.05, fz, '#f8fafc');

    // Serving window + illuminated menu board
    addLocalBox(w * 0.36, 1.5, 0.12, -w * 0.15, 0.24 + 1.6, fz, '#0f172a');
    addLocalBox(w * 0.32, 0.55, 0.14, -w * 0.15, 0.24 + 2.1, fz + 0.02, '#fef08a');

    // Outdoor seating black metal railing along front patio
    const rz = d * 0.5 + 1.45;
    addLocalBox(w + 1.2, 0.08, 0.08, 0, 0.24 + 0.95, rz, '#18181b');
    for (let i = -3; i <= 3; i++) {
      addLocalBox(0.08, 0.95, 0.08, (i / 3) * (w * 0.5), 0.24 + 0.48, rz, '#18181b');
    }
  } else if (b.style === 'rec_cafe') {
    // REC Cafe (image-3.png):
    // Boxy modern building with horizontal striped/louvered grey & white cladding,
    // dark recessed window/entrance openings, "REC Cafe" corner sign, and base hedges.
    const w = spanU;
    const d = spanV;
    const h = b.height_m || 8.5;

    // Base plinth + steps
    addLocalBox(w + 1.0, 0.32, d + 1.0, 0, 0.16, 0, '#cbd5e1');
    // Main concrete core
    addLocalBox(w, h, d, 0, 0.32 + h * 0.5, 0, '#a1a1aa');

    // Horizontal striped/louvered cladding bands all around
    const bands = Math.max(8, Math.floor(h / 0.55));
    for (let i = 0; i < bands; i++) {
      const by = 0.32 + (i + 0.5) * (h / bands);
      const col = i % 2 === 0 ? '#e4e4e7' : '#71717a';
      addLocalBox(w + 0.16, 0.26, d + 0.16, 0, by, 0, col);
    }

    // Dark recessed openings on opposite sides (-V & +U)
    addLocalBox(w * 0.48, 2.2, 0.24, -w * 0.12, 0.32 + h * 0.58, -d * 0.5 - 0.04, '#18181b');
    addLocalBox(w * 0.36, 2.4, 0.24, -w * 0.2, 0.32 + 1.2, -d * 0.5 - 0.04, '#18181b');
    addLocalBox(0.24, 2.2, d * 0.45, w * 0.5 + 0.04, 0.32 + h * 0.58, 0, '#18181b');

    // "REC Cafe" white sign plaque on the opposite corner
    addLocalBox(2.2, 1.1, 0.14, w * 0.32, 0.32 + 3.2, -d * 0.5 - 0.14, '#f8fafc');
    // Green hedges along the opposite base
    addLocalBox(w * 0.6, 0.75, 0.85, w * 0.15, 0.32 + 0.38, -d * 0.5 - 0.55, '#4d7c0f');
  } else if (b.style === 'b_block') {
    // B Block (image-4.png, image-5.png):
    // Iconic terracotta-red & white 5-floor academic block with protruding 4-column portico
    // and triangular pediment facing North (-Z, toward Aadhi Statue roundabout).
    const w = spanU;
    const d = spanV;
    const h = b.height_m || 18.0;

    // White ground floor & top floor, terracotta-red middle bands
    addLocalBox(w, h * 0.28, d * 0.45, 0, h * 0.14, 0, '#f8fafc');
    addLocalBox(w, h * 0.44, d * 0.45, 0, h * 0.50, 0, '#b84a39');
    addLocalBox(w, h * 0.28, d * 0.45, 0, h * 0.86, 0, '#f8fafc');

    // Side wings extending South (+V)
    addLocalBox(w * 0.18, h, d * 0.55, -w * 0.41, h * 0.5, d * 0.25, '#f8fafc');
    addLocalBox(w * 0.18, h, d * 0.55, w * 0.41, h * 0.5, d * 0.25, '#f8fafc');

    // Dark horizontal window bands on front (-V)
    for (let f = 0; f < 4; f++) {
      const fy = 2.4 + f * 3.8;
      addLocalBox(w * 0.88, 1.35, 0.16, 0, fy, -d * 0.225 - 0.04, '#1e293b');
    }

    // Protruding front portico (-V, facing Aadhi Statue):
    // Raised white plinth, 4 tall terracotta-red columns, flat canopy + triangular pediment fascia
    const pz = -d * 0.225 - 5.5;
    addLocalBox(15.5, 0.35, 11.0, 0, 0.175, pz, '#e2e8f0');
    for (const cx of [-6.4, -2.4, 2.4, 6.4]) {
      addLocalBox(0.85, 7.2, 0.85, cx, 3.6, pz - 4.2, '#c0503e');
    }
    // Portico roof slab & terracotta-red fascia + stepped pediment
    addLocalBox(15.2, 1.8, 10.8, 0, 7.8, pz, '#c0503e');
    addLocalBox(10.0, 1.1, 0.6, 0, 9.1, pz - 5.1, '#c0503e');
    addLocalBox(5.2, 0.9, 0.6, 0, 9.9, pz - 5.1, '#c0503e');
  } else if (b.style === 'skybridge') {
    // 2nd-floor covered skybridge connecting D Block & C Block (y = 4.2m to 7.4m)
    const w = spanU;
    const d = spanV;
    addLocalBox(w, 0.35, d, 0, 4.35, 0, '#cbd5e1');
    addLocalBox(w, 2.5, 0.2, 0, 5.75, -d * 0.5 + 0.1, '#1e3a5f');
    addLocalBox(w, 2.5, 0.2, 0, 5.75, d * 0.5 - 0.1, '#1e3a5f');
    addLocalBox(w, 0.35, d + 0.4, 0, 7.15, 0, '#f8fafc');
  } else if (b.style === 'sixth_sense_garden' || b.style === 'open_cafe') {
    // 6th Sense Garden / Garden Cafe (image-6.png):
    // Botanical garden with grey pebble walkway leading to a cream stone plinth + seated purple
    // meditating statue, bright-blue conical-roofed yellow & open gazebo huts, white pavilion & white truss!
    const w = spanU;
    const d = spanV;

    // Central grey cobblestone/pebble garden walkway leading straight from West road (-U) to center statue
    addLocalBox(w * 0.52, 0.16, 3.2, -w * 0.22, 0.08, 0, '#8d928e');
    addLocalBox(3.0, 0.16, d * 0.58, 0.04 * w, 0.08, 0, '#8d928e');

    // Cream stone pedestal in center of garden + seated meditating purple mascot statue!
    const pedX = obb.cx + 0.04 * w * obb.ux;
    const pedZ = obb.cz + 0.04 * w * obb.uz;
    addLocalBox(4.4, 0.88, 3.2, 0.04 * w, 0.44, 0, '#e8e2d2');

    // Seated cross-legged purple meditating statue on pedestal
    const lotus = new THREE.CylinderGeometry(1.05, 1.15, 0.42, 8);
    lotus.translate(pedX, 1.08, pedZ);
    pushColoredBox(verts, norms, cols, lotus, '#4f359b');
    lotus.dispose();

    const mTorso = new THREE.CylinderGeometry(0.46, 0.56, 1.05, 8);
    mTorso.translate(pedX, 1.78, pedZ);
    pushColoredBox(verts, norms, cols, mTorso, '#5b3ea8');
    mTorso.dispose();

    const mHead = new THREE.DodecahedronGeometry(0.36, 0);
    mHead.translate(pedX, 2.55, pedZ);
    pushColoredBox(verts, norms, cols, mHead, '#5b3ea8');
    mHead.dispose();

    for (const sgn of [-1, 1]) {
      const horn = new THREE.ConeGeometry(0.08, 0.85, 5);
      horn.rotateZ(sgn * -0.25);
      horn.translate(pedX + sgn * 0.22, 3.12, pedZ - 0.1);
      pushColoredBox(verts, norms, cols, horn, '#3b2778');
      horn.dispose();
    }

    // 3 iconic sky-blue pyramid/conical-roofed garden huts behind & beside the statue (middle one has bright yellow walls!)
    const huts: { fu: number; fv: number; wallHex: string | null }[] = [
      { fu: 0.28, fv: -0.22, wallHex: null },       // Open blue-roofed gazebo (left-back)
      { fu: 0.30, fv: 0.02, wallHex: '#eab308' },   // Yellow-walled kiosk hut with blue roof (center-back, image-6.png!)
      { fu: 0.28, fv: 0.26, wallHex: null },        // Open blue-roofed gazebo (right-back)
    ];
    for (const hut of huts) {
      const hx = obb.cx + hut.fu * w * obb.ux + hut.fv * d * obb.vx;
      const hz = obb.cz + hut.fu * w * obb.uz + hut.fv * d * obb.vz;

      const base = new THREE.CylinderGeometry(2.6, 2.6, 0.22, 6);
      base.translate(hx, 0.11, hz);
      pushColoredBox(verts, norms, cols, base, '#d6d3cb');
      base.dispose();

      if (hut.wallHex) {
        const yWall = new THREE.BoxGeometry(3.4, 2.5, 3.4);
        yWall.translate(hx, 1.36, hz);
        pushColoredBox(verts, norms, cols, yWall, hut.wallHex);
        yWall.dispose();
      } else {
        for (const [px, pz] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) {
          const post = new THREE.BoxGeometry(0.18, 2.55, 0.18);
          post.translate(hx + px, 1.38, hz + pz);
          pushColoredBox(verts, norms, cols, post, '#334155');
          post.dispose();
        }
      }

      const blueRoof = new THREE.ConeGeometry(3.25, 1.55, 4);
      blueRoof.rotateY(Math.PI * 0.25);
      blueRoof.translate(hx, 3.38, hz);
      pushColoredBox(verts, norms, cols, blueRoof, '#1982c4');
      blueRoof.dispose();
    }

    // White flat-roofed pavilion on the northern/left side of 6th Sense Garden (image-6.png left!)
    addLocalBox(8.5, 0.32, 5.2, -0.14 * w, 3.35, -0.32 * d, '#f8fafc');
    addLocalBox(8.2, 0.2, 4.9, -0.14 * w, 0.1, -0.32 * d, '#dcd8cf');
    for (const [cu, cv] of [[-3.6, -2.1], [3.6, -2.1], [-3.6, 2.1], [3.6, 2.1]]) {
      addLocalBox(0.26, 3.2, 0.26, -0.14 * w + cu, 1.65, -0.32 * d + cv, '#e2e8f0');
    }

    // White space-frame truss column + teal counter kiosk on the southern/right side (image-6.png right!)
    addLocalBox(1.1, 4.4, 1.1, 0.08 * w, 2.2, 0.36 * d, '#f1f5f9');
    addLocalBox(5.5, 0.45, 0.85, 0.2 * w, 4.1, 0.36 * d, '#f1f5f9');
    addLocalBox(4.8, 2.6, 3.6, 0.3 * w, 1.35, 0.36 * d, '#0f766e');
  } else {
    return null;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return out;
}

/**
 * Builds A Block's signature classical terracotta vertical pilasters + cornice band
 * matching the real REC Main Block facade photo (`image-1.png`).
 */
function buildMainBlockTrim(b: Building, wallHeight: number): THREE.BufferGeometry {
  const verts: number[] = [];
  const norms: number[] = [];
  const cols: number[] = [];
  const ring = b.polygon;

  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 6.0) continue;

    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    const angleY = Math.atan2(-uz, ux);

    // Top terracotta cornice band along long facades
    const cornice = new THREE.BoxGeometry(len + 0.5, 0.68, 0.42);
    cornice.rotateY(angleY);
    cornice.translate(
      (ax + bx) * 0.5 + nx * 0.28,
      wallHeight + 0.05,
      (az + bz) * 0.5 + nz * 0.28
    );
      pushColoredBox(verts, norms, cols, cornice, '#dc3c22');
      cornice.dispose();

      // Vermilion red-orange vertical pilasters every ~9.5 m (image-4.png)
      const count = Math.floor(len / 9.5);
      for (let k = 1; k <= count; k++) {
        const frac = k / (count + 1);
        const px = ax + dx * frac + nx * 0.3;
        const pz = az + dz * frac + nz * 0.3;
        const pilaster = new THREE.BoxGeometry(0.95, wallHeight + 0.3, 0.45);
        pilaster.rotateY(angleY);
        pilaster.translate(px, (wallHeight + 0.3) * 0.5, pz);
        pushColoredBox(verts, norms, cols, pilaster, '#dc3c22');
        pilaster.dispose();
      }
    }

  // Rounded cylindrical striped end-rotundas at East & West ends of A Block + central white portico block (image-4.png!)
  {
    const obb = computePrincipalAxis(b.polygon);
    const signAngle = Math.atan2(-obb.uz, obb.ux);
    for (const endU of [obb.minU + 1.5, obb.maxU - 1.5]) {
      const rx = obb.cx + endU * obb.ux;
      const rz = obb.cz + endU * obb.uz;
      const cyl = new THREE.CylinderGeometry(5.2, 5.2, wallHeight + 1.8, 12);
      cyl.translate(rx, (wallHeight + 1.8) * 0.5, rz);
      pushColoredBox(verts, norms, cols, cyl, '#f6f7f9');
      cyl.dispose();

      for (const bandFrac of [0.28, 0.58, 0.88, 1.04]) {
        const stripe = new THREE.CylinderGeometry(5.38, 5.38, 0.72, 12);
        stripe.translate(rx, wallHeight * bandFrac, rz);
        pushColoredBox(verts, norms, cols, stripe, '#dc3c22');
        stripe.dispose();
      }
    }

    // Raised white central stairwell/portico crown block (seen in center of A Block in image-4.png)
    const centerCrown = new THREE.BoxGeometry(11.5, 3.6, 8.2);
    centerCrown.rotateY(signAngle);
    centerCrown.translate(obb.cx - 4.0, wallHeight + 1.9, obb.cz - 3.2);
    pushColoredBox(verts, norms, cols, centerCrown, '#f8fafc');
    centerCrown.dispose();
  }

  if (b.sign_text) {
    const obb = computePrincipalAxis(b.polygon);
    const signAngle = Math.atan2(-obb.uz, obb.ux);
    const centroid = getPolygonCentroid(b.polygon);
    const northZ = Math.min(...b.polygon.map((p) => p[1])) + 2.5;
    const southZ = Math.max(...b.polygon.map((p) => p[1])) - 2.5;
    const boardW = b.sign_text.length * 2.15 * 0.95 + 2.8;

    for (const bz of [northZ + 0.34, southZ - 0.34]) {
      const fascia = new THREE.BoxGeometry(boardW, 3.35, 0.32);
      fascia.rotateY(signAngle);
      fascia.translate(centroid[0], wallHeight + 2.42, bz);
      pushColoredBox(verts, norms, cols, fascia, '#f7f4ec');
      fascia.dispose();

      const cap = new THREE.BoxGeometry(boardW + 0.5, 0.28, 0.48);
      cap.rotateY(signAngle);
      cap.translate(centroid[0], wallHeight + 4.15, bz);
      pushColoredBox(verts, norms, cols, cap, '#dc3c22');
      cap.dispose();
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return out;
}

/**
 * Builds REC's signature vermilion red-orange corner/stairwell accent strips + top parapet band
 * for multi-story academic & hostel blocks, matching aerial campus photo `image-4.png`.
 */
function buildStandardRecTrim(b: Building, wallHeight: number): THREE.BufferGeometry | null {
  if (b.levels < 3) return null;
  const verts: number[] = [];
  const norms: number[] = [];
  const cols: number[] = [];
  const ring = b.polygon;

  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 8.0) continue;

    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;
    const angleY = Math.atan2(-uz, ux);

    // Crisp red-orange top parapet accent band
    const band = new THREE.BoxGeometry(len + 0.3, 0.55, 0.36);
    band.rotateY(angleY);
    band.translate((ax + bx) * 0.5 + nx * 0.22, wallHeight + 0.62, (az + bz) * 0.5 + nz * 0.22);
    pushColoredBox(verts, norms, cols, band, '#dd4024');
    band.dispose();

    // Vertical red-orange stairwell/corner accent bay on major facades (>= 18 m)
    if (len >= 18.0) {
      for (const frac of len >= 42.0 ? [0.14, 0.86] : [0.18]) {
        const px = ax + dx * frac + nx * 0.25;
        const pz = az + dz * frac + nz * 0.25;
        const tower = new THREE.BoxGeometry(2.6, wallHeight + 1.05, 0.55);
        tower.rotateY(angleY);
        tower.translate(px, (wallHeight + 1.05) * 0.5, pz);
        pushColoredBox(verts, norms, cols, tower, '#dd4024');
        tower.dispose();
      }
    }
  }

  if (verts.length === 0) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norms, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  return out;
}

function buildDashedUnverifiedOutline(b: Building, wallHeight: number): THREE.BufferGeometry {
  const segs: number[] = [];
  const ring = b.polygon;
  const yLow = 0.5;
  const yHigh = wallHeight + 0.55;

  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % ring.length];
    segs.push(ax, yHigh, az, bx, yHigh, bz);
    segs.push(ax, yLow, az, bx, yLow, bz);
    segs.push(ax, yLow, az, ax, yHigh, az);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  return geo;
}

export function getBuildingBaseY(b: Building, elev: ElevationData): number {
  let minGround = Infinity;
  for (const [x, z] of b.polygon) {
    const h = sampleElevation(elev, x, z);
    if (h < minGround) minGround = h;
  }
  return (Number.isFinite(minGround) ? minGround : 0) - 0.2;
}

interface BuiltBuildingMesh {
  building: Building;
  baseY: number;
  wallHeight: number;
  centroid: [number, number];
  specialGeo: THREE.BufferGeometry | null;
  wallGeo: THREE.BufferGeometry | null;
  roofGeo: THREE.BufferGeometry | null;
  trimGeo: THREE.BufferGeometry | null;
  signGeo: THREE.BufferGeometry | null;
  dashedGeo: THREE.BufferGeometry | null;
}

export function Buildings({
  buildings,
  elevation,
  selectedId,
  hoveredId,
  activeCategory,
  castShadow,
  nightFactor,
  onHover,
  onSelect,
}: BuildingsProps) {
  const meshes = useMemo<BuiltBuildingMesh[]>(() => {
    return buildings.map((b) => {
      const wallHeight = b.height_m;
      const centroid = getPolygonCentroid(b.polygon);
      const baseY = getBuildingBaseY(b, elevation);
      const specialGeo = buildSpecialStructure(b, elevation, baseY);

      if (specialGeo) {
        return {
          building: b,
          baseY,
          wallHeight,
          centroid,
          specialGeo,
          wallGeo: null,
          roofGeo: null,
          trimGeo: null,
          signGeo: null,
          dashedGeo: !b.verified ? buildDashedUnverifiedOutline(b, wallHeight) : null,
        };
      }

      const shape = new THREE.Shape();
      b.polygon.forEach(([x, z], idx) => {
        if (idx === 0) shape.moveTo(x, -z);
        else shape.lineTo(x, -z);
      });
      shape.closePath();

      const wallGeo = new THREE.ExtrudeGeometry(shape, {
        depth: wallHeight,
        bevelEnabled: true,
        bevelThickness: 0.25,
        bevelSize: 0.25,
        bevelSegments: 1,
      });
      wallGeo.rotateX(-Math.PI / 2);
      wallGeo.computeVertexNormals();

      const roofGeo = buildRoofGeometry(b, wallHeight);
      const trimGeo =
        b.style === 'main_block'
          ? buildMainBlockTrim(b, wallHeight)
          : b.style === 'standard'
          ? buildStandardRecTrim(b, wallHeight)
          : null;

      let signGeo: THREE.BufferGeometry | null = null;
      if (b.sign_text) {
        const obb = computePrincipalAxis(b.polygon);
        const eastSign = obb.ux >= 0 ? 1 : -1;
        const eX = obb.ux * eastSign;
        const eZ = obb.uz * eastSign;
        const northZ = Math.min(...b.polygon.map((p) => p[1])) + 2.5;
        const southZ = Math.max(...b.polygon.map((p) => p[1])) - 2.5;

        // Forward-reading 3D red sign facing North Fountain (-Z) AND South Main Ground (+Z)
        const northSign = build3DSignGeometry(
          b.sign_text,
          centroid[0],
          wallHeight + 1.25,
          northZ,
          -eX,
          -eZ,
          2.15
        );
        const southSign = build3DSignGeometry(
          b.sign_text,
          centroid[0],
          wallHeight + 1.25,
          southZ,
          eX,
          eZ,
          2.15
        );

        const posN = northSign.attributes.position.array as Float32Array;
        const posS = southSign.attributes.position.array as Float32Array;
        const nrmN = northSign.attributes.normal.array as Float32Array;
        const nrmS = southSign.attributes.normal.array as Float32Array;
        const colN = northSign.attributes.color.array as Float32Array;
        const colS = southSign.attributes.color.array as Float32Array;

        const mergedPos = new Float32Array(posN.length + posS.length);
        mergedPos.set(posN, 0);
        mergedPos.set(posS, posN.length);
        const mergedNrm = new Float32Array(nrmN.length + nrmS.length);
        mergedNrm.set(nrmN, 0);
        mergedNrm.set(nrmS, nrmN.length);
        const mergedCol = new Float32Array(colN.length + colS.length);
        mergedCol.set(colN, 0);
        mergedCol.set(colS, colN.length);

        northSign.dispose();
        southSign.dispose();

        signGeo = new THREE.BufferGeometry();
        signGeo.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
        signGeo.setAttribute('normal', new THREE.BufferAttribute(mergedNrm, 3));
        signGeo.setAttribute('color', new THREE.BufferAttribute(mergedCol, 3));
      }

      const dashedGeo = !b.verified ? buildDashedUnverifiedOutline(b, wallHeight) : null;

      return {
        building: b,
        baseY,
        wallHeight,
        centroid,
        specialGeo: null,
        wallGeo,
        roofGeo,
        trimGeo,
        signGeo,
        dashedGeo,
      };
    });
  }, [buildings, elevation]);

  const dashedLineObjects = useMemo(() => {
    const map = new Map<string, THREE.LineSegments>();
    const mat = new THREE.LineDashedMaterial({
      color: '#64748b',
      dashSize: 1.5,
      gapSize: 1.0,
    });
    for (const m of meshes) {
      if (m.dashedGeo) {
        const ls = new THREE.LineSegments(m.dashedGeo, mat);
        ls.computeLineDistances();
        map.set(m.building.id, ls);
      }
    }
    return map;
  }, [meshes]);

  return (
    <group name="campus-buildings-group">
      {meshes.map((m) => {
        const b = m.building;
        const isSelected = selectedId === b.id;
        const isHovered = hoveredId === b.id;
        const isFilteredOut = activeCategory !== 'all' && b.cat !== activeCategory;

        const baseWallHex = !b.verified
          ? '#cbd5e1'
          : b.style === 'shed_hall'
          ? '#eef0f3'
          : WALL_PALETTE[b.cat];
        const baseRoofHex = !b.verified
          ? '#94a3b8'
          : b.style === 'shed_hall'
          ? '#828a91'
          : ROOF_PALETTE[b.cat];

        const wallColor = isSelected
          ? '#fff7ed'
          : isHovered
          ? '#fafaf9'
          : isFilteredOut
          ? '#d6d7d4'
          : baseWallHex;

        const roofColor = isSelected
          ? '#b93822'
          : isHovered
          ? '#334155'
          : isFilteredOut
          ? '#b2b5b2'
          : baseRoofHex;

        const emissiveHex = isSelected ? '#9a3412' : isHovered ? '#334155' : '#000000';
        const emissiveIntensity = isSelected ? 0.14 : isHovered ? 0.08 : 0;

        const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(b, { x: e.clientX, y: e.clientY });
        };

        const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(b, { x: e.clientX, y: e.clientY });
        };

        const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(null);
        };

        const handleClick = (e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onSelect(b);
        };

        const dashedObj = dashedLineObjects.get(b.id);

        return (
          <group key={b.id} position={[0, m.baseY, 0]}>
            {m.specialGeo && (
              <mesh
                geometry={m.specialGeo}
                castShadow={castShadow}
                receiveShadow={castShadow}
                onPointerOver={handlePointerOver}
                onPointerMove={handlePointerMove}
                onPointerOut={handlePointerOut}
                onClick={handleClick}
              >
                <meshStandardMaterial
                  vertexColors
                  color="#ffffff"
                  emissive={
                    isSelected
                      ? '#9a3412'
                      : b.style === 'fountain' && nightFactor > 0.25
                      ? '#0284c7'
                      : b.style === 'pavilion_cafe' && nightFactor > 0.25
                      ? '#b45309'
                      : emissiveHex
                  }
                  emissiveIntensity={
                    isSelected
                      ? 0.12
                      : (b.style === 'fountain' || b.style === 'pavilion_cafe') && nightFactor > 0.25
                      ? nightFactor * 0.26
                      : emissiveIntensity
                  }
                  roughness={0.82}
                  metalness={0.04}
                  flatShading
                />
              </mesh>
            )}

            {m.wallGeo && (
              <mesh
                geometry={m.wallGeo}
                castShadow={castShadow}
                receiveShadow={castShadow}
                onPointerOver={handlePointerOver}
                onPointerMove={handlePointerMove}
                onPointerOut={handlePointerOut}
                onClick={handleClick}
              >
                <meshStandardMaterial
                  color={wallColor}
                  emissive={emissiveHex}
                  emissiveIntensity={emissiveIntensity}
                  roughness={0.88}
                  metalness={0.02}
                  flatShading
                />
              </mesh>
            )}

            {m.roofGeo && (
              <mesh
                geometry={m.roofGeo}
                castShadow={castShadow}
                receiveShadow={castShadow}
                onPointerOver={handlePointerOver}
                onPointerMove={handlePointerMove}
                onPointerOut={handlePointerOut}
                onClick={handleClick}
              >
                <meshStandardMaterial
                  color={roofColor}
                  emissive={emissiveHex}
                  emissiveIntensity={emissiveIntensity * 0.6}
                  roughness={0.9}
                  metalness={0.02}
                  flatShading
                />
              </mesh>
            )}

            {m.trimGeo && (
              <mesh geometry={m.trimGeo} castShadow={castShadow} receiveShadow={castShadow}>
                <meshStandardMaterial vertexColors roughness={0.84} metalness={0.03} flatShading />
              </mesh>
            )}

            {m.signGeo && (
              <mesh geometry={m.signGeo} castShadow={castShadow}>
                <meshStandardMaterial
                  vertexColors
                  emissive="#dc2626"
                  emissiveIntensity={0.12 + nightFactor * 0.95}
                  roughness={0.45}
                  metalness={0.1}
                  flatShading
                />
              </mesh>
            )}

            {dashedObj && <primitive object={dashedObj} />}

            {isSelected && (
              <mesh
                position={[m.centroid[0], m.wallHeight + 4.4, m.centroid[1]]}
                rotation={[Math.PI, 0, 0]}
              >
                <coneGeometry args={[1.4, 3.0, 4]} />
                <meshStandardMaterial
                  color="#c83a22"
                  emissive="#c83a22"
                  emissiveIntensity={0.45}
                  flatShading
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}
