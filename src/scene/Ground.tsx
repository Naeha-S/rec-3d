import { useMemo } from 'react';
import * as THREE from 'three';
import type { AreaKind, CampusArea, CampusPath, ElevationData } from '../types';
import { getElevationBounds, sampleElevation } from '../logic/elevation';

interface GroundProps {
  elevation: ElevationData;
  areas: CampusArea[];
  paths: CampusPath[];
  receiveShadow: boolean;
}

// Lush surrounding Thandalam green woodland tone (no sandy/grey outside border)
const EXTERIOR_GREEN_COLOR = new THREE.Color('#739b6b');

const AREA_COLORS: Record<AreaKind, THREE.Color> = {
  lawn: new THREE.Color('#82a879'),
  paved: new THREE.Color('#cfc9be'),
  pitch: new THREE.Color('#65995f'),
  parking: new THREE.Color('#7f868d'),
  water: new THREE.Color('#4aa3c8'),
};

const AREA_PRIORITY: Record<AreaKind, number> = {
  lawn: 1,
  paved: 2,
  parking: 3,
  pitch: 4,
  water: 5,
};

function pointInPolygon(x: number, z: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    const intersect =
      zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function distPointToSeg(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  if (l2 < 1e-9) return Math.hypot(px - ax, pz - az);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

function getPolygonBBox(poly: [number, number][]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of poly) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

function pushGroundQuad(
  positions: number[],
  elev: ElevationData,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  halfWidth: number,
  liftY: number
) {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const nx = (-dz / len) * halfWidth;
  const nz = (dx / len) * halfWidth;
  const steps = Math.max(1, Math.ceil(len / 4.0));

  for (let s = 0; s < steps; s++) {
    const t0 = s / steps;
    const t1 = (s + 1) / steps;
    const sx0 = ax + dx * t0;
    const sz0 = az + dz * t0;
    const sx1 = ax + dx * t1;
    const sz1 = az + dz * t1;

    const p0x = sx0 + nx, p0z = sz0 + nz;
    const p1x = sx0 - nx, p1z = sz0 - nz;
    const p2x = sx1 - nx, p2z = sz1 - nz;
    const p3x = sx1 + nx, p3z = sz1 + nz;

    const y0 = sampleElevation(elev, p0x, p0z) + liftY;
    const y1 = sampleElevation(elev, p1x, p1z) + liftY;
    const y2 = sampleElevation(elev, p2x, p2z) + liftY;
    const y3 = sampleElevation(elev, p3x, p3z) + liftY;

    // Upward (+Y) counter-clockwise winding
    positions.push(
      p0x, y0, p0z,
      p2x, y2, p2z,
      p1x, y1, p1z,
      p0x, y0, p0z,
      p3x, y3, p3z,
      p2x, y2, p2z
    );
  }
}

function pushColoredPart(
  verts: number[],
  norms: number[],
  cols: number[],
  geom: THREE.BufferGeometry,
  hex: string
) {
  const nonIdx = geom.index ? geom.toNonIndexed() : geom;
  nonIdx.computeVertexNormals();
  const pos = nonIdx.attributes.position;
  const nrm = nonIdx.attributes.normal;
  const c = new THREE.Color(hex);
  for (let i = 0; i < pos.count; i++) {
    verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    norms.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    cols.push(c.r, c.g, c.b);
  }
  if (nonIdx !== geom) nonIdx.dispose();
}

export function Ground({ elevation, areas, paths, receiveShadow }: GroundProps) {
  const { terrainGeo, markingsGeo, waterGeo, wallGeo, courtStructsGeo, courtMeshFenceGeo } = useMemo(() => {
    const { rows, cols, width, depth, minX, minZ } = getElevationBounds(elevation);

    const sortedAreas = [...areas]
      .map((a) => ({ area: a, bbox: getPolygonBBox(a.polygon), prio: AREA_PRIORITY[a.kind] }))
      .sort((a, b) => b.prio - a.prio);

    function classifyPoint(x: number, z: number): AreaKind | 'exterior' {
      for (const item of sortedAreas) {
        const { minX: ax0, maxX: ax1, minZ: az0, maxZ: az1 } = item.bbox;
        if (x >= ax0 && x <= ax1 && z >= az0 && z <= az1) {
          if (pointInPolygon(x, z, item.area.polygon)) {
            return item.area.kind;
          }
        }
      }
      return 'exterior';
    }

    const basePlane = new THREE.PlaneGeometry(width, depth, cols - 1, rows - 1);
    basePlane.rotateX(-Math.PI / 2);

    const posAttr = basePlane.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const c = Math.min(cols - 1, Math.max(0, Math.round((vx - minX) / elevation.cell)));
      const r = Math.min(rows - 1, Math.max(0, Math.round((vz - minZ) / elevation.cell)));
      posAttr.setY(i, elevation.grid[r][c]);
    }

    const nonIndexed = basePlane.toNonIndexed();
    basePlane.dispose();
    const triPos = nonIndexed.attributes.position;
    const colors = new Float32Array(triPos.count * 3);
    const tmpCol = new THREE.Color();

    for (let t = 0; t < triPos.count; t += 3) {
      const cx = (triPos.getX(t) + triPos.getX(t + 1) + triPos.getX(t + 2)) / 3;
      const cz = (triPos.getZ(t) + triPos.getZ(t + 1) + triPos.getZ(t + 2)) / 3;
      const cy = (triPos.getY(t) + triPos.getY(t + 1) + triPos.getY(t + 2)) / 3;
      const kind = classifyPoint(cx, cz);

      if (kind === 'exterior') {
        tmpCol.copy(EXTERIOR_GREEN_COLOR);
      } else if (kind === 'water') {
        tmpCol.copy(AREA_COLORS.paved);
      } else {
        tmpCol.copy(AREA_COLORS[kind]);
      }

      const facetHash =
        Math.sin(cx * 0.11 + cz * 0.15) * 0.024 +
        Math.cos(cx * 0.05 - cz * 0.07) * 0.014 +
        (cy / 24) * 0.02;
      tmpCol.offsetHSL(facetHash * 0.15, 0, facetHash);

      for (let k = 0; k < 3; k++) {
        const idx = (t + k) * 3;
        colors[idx] = tmpCol.r;
        colors[idx + 1] = tmpCol.g;
        colors[idx + 2] = tmpCol.b;
      }
    }

    nonIndexed.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    nonIndexed.computeVertexNormals();

    // 2. Markings ONLY on the 4 courts (kind === 'pitch') and parking lots
    const markPos: number[] = [];
    for (const a of areas) {
      const bb = getPolygonBBox(a.polygon);
      const w = bb.maxX - bb.minX;
      const d = bb.maxZ - bb.minZ;
      const cx = (bb.minX + bb.maxX) * 0.5;
      const cz = (bb.minZ + bb.maxZ) * 0.5;

      if (a.kind === 'pitch') {
        const isElevatedBball = a.id === 'basketball-court';
        // For the elevated BB court, its deck is a flat BoxGeometry at by + 0.48;
        // use a flat constant Y (by + 0.495) so lines never dip below the deck.
        const bballBaseY = isElevatedBball ? sampleElevation(elevation, cx, cz) : 0;
        const pushCourtQuad = (
          ax: number,
          az: number,
          bx: number,
          bz: number,
          width: number
        ) => {
          if (!isElevatedBball) {
            pushGroundQuad(markPos, elevation, ax, az, bx, bz, width, 0.14);
            return;
          }
          const dx = bx - ax;
          const dz = bz - az;
          const len = Math.hypot(dx, dz);
          if (len < 0.05) return;
          const nx = (-dz / len) * (width * 0.5);
          const nz = (dx / len) * (width * 0.5);
          const y = bballBaseY + 0.805;
          markPos.push(
            ax + nx, y, az + nz,
            bx + nx, y, bz + nz,
            ax - nx, y, az - nz,
            ax - nx, y, az - nz,
            bx + nx, y, bz + nz,
            bx - nx, y, bz - nz
          );
        };

        const inset = 1.0;
        const x0 = bb.minX + inset;
        const x1 = bb.maxX - inset;
        const z0 = bb.minZ + inset;
        const z1 = bb.maxZ - inset;
        const lw = 0.15;
        pushCourtQuad(x0, z0, x1, z0, lw);
        pushCourtQuad(x1, z0, x1, z1, lw);
        pushCourtQuad(x1, z1, x0, z1, lw);
        pushCourtQuad(x0, z1, x0, z0, lw);

        if (w >= d) {
          pushCourtQuad(cx, z0, cx, z1, lw);
        } else {
          pushCourtQuad(x0, cz, x1, cz, lw);
        }

        const radius = Math.min(w, d) * 0.18;
        if (radius >= 2.0) {
          const segs = 14;
          for (let s = 0; s < segs; s++) {
            const a0 = (s / segs) * Math.PI * 2;
            const a1 = ((s + 1) / segs) * Math.PI * 2;
            pushCourtQuad(
              cx + Math.cos(a0) * radius,
              cz + Math.sin(a0) * radius,
              cx + Math.cos(a1) * radius,
              cz + Math.sin(a1) * radius,
              lw * 0.85
            );
          }
        }

        // Extra basketball key boxes + 3-point arcs on the elevated Basketball Court
        if (isElevatedBball) {
          const keyHalfW = 2.4;
          const keyLen = 5.4;
          // North key
          pushCourtQuad(cx - keyHalfW, z0, cx - keyHalfW, z0 + keyLen, 0.12);
          pushCourtQuad(cx + keyHalfW, z0, cx + keyHalfW, z0 + keyLen, 0.12);
          pushCourtQuad(cx - keyHalfW, z0 + keyLen, cx + keyHalfW, z0 + keyLen, 0.12);
          // South key
          pushCourtQuad(cx - keyHalfW, z1, cx - keyHalfW, z1 - keyLen, 0.12);
          pushCourtQuad(cx + keyHalfW, z1, cx + keyHalfW, z1 - keyLen, 0.12);
          pushCourtQuad(cx - keyHalfW, z1 - keyLen, cx + keyHalfW, z1 - keyLen, 0.12);

          // 3-point arcs at North & South baselines
          const arcR = Math.min(6.75, (x1 - x0) * 0.42);
          const arcSegs = 14;
          for (let s = 0; s < arcSegs; s++) {
            const t0 = (s / arcSegs) * Math.PI;
            const t1 = ((s + 1) / arcSegs) * Math.PI;
            pushCourtQuad(
              cx + Math.cos(t0) * arcR,
              z0 + 1.2 + Math.sin(t0) * arcR,
              cx + Math.cos(t1) * arcR,
              z0 + 1.2 + Math.sin(t1) * arcR,
              0.11
            );
            pushCourtQuad(
              cx + Math.cos(t0) * arcR,
              z1 - 1.2 - Math.sin(t0) * arcR,
              cx + Math.cos(t1) * arcR,
              z1 - 1.2 - Math.sin(t1) * arcR,
              0.11
            );
          }
        }
      } else if (a.kind === 'parking') {
        const stripeSpacing = 3.2;
        if (w >= d) {
          const zMid = cz;
          pushGroundQuad(markPos, elevation, bb.minX + 2, zMid, bb.maxX - 2, zMid, 0.13, 0.13);
          for (let sx = bb.minX + 3; sx <= bb.maxX - 3; sx += stripeSpacing) {
            if (pointInPolygon(sx, zMid, a.polygon)) {
              pushGroundQuad(
                markPos,
                elevation,
                sx,
                zMid - Math.min(5.5, d * 0.38),
                sx,
                zMid + Math.min(5.5, d * 0.38),
                0.11,
                0.13
              );
            }
          }
        } else {
          const xMid = cx;
          pushGroundQuad(markPos, elevation, xMid, bb.minZ + 2, xMid, bb.maxZ - 2, 0.13, 0.13);
          for (let sz = bb.minZ + 3; sz <= bb.maxZ - 3; sz += stripeSpacing) {
            if (pointInPolygon(xMid, sz, a.polygon)) {
              pushGroundQuad(
                markPos,
                elevation,
                xMid - Math.min(5.5, w * 0.38),
                sz,
                xMid + Math.min(5.5, w * 0.38),
                sz,
                0.11,
                0.13
              );
            }
          }
        }
      }
    }

    const markBuffer = new THREE.BufferGeometry();
    markBuffer.setAttribute('position', new THREE.Float32BufferAttribute(markPos, 3));
    markBuffer.computeVertexNormals();

    // 3. Shimmering water surface for A Block Fountain (Swimming Pool renders its own recessed basin cleanly in Buildings.tsx)
    const waterVerts: number[] = [];
    for (const a of areas) {
      if (a.kind !== 'water' || !a.id.includes('fountain')) continue;
      const shape = new THREE.Shape();
      a.polygon.forEach(([x, z], idx) => {
        if (idx === 0) shape.moveTo(x, -z);
        else shape.lineTo(x, -z);
      });
      shape.closePath();
      const sGeo = new THREE.ShapeGeometry(shape);
      sGeo.rotateX(-Math.PI / 2);
      const bb = getPolygonBBox(a.polygon);
      const nonIdx = sGeo.toNonIndexed();
      const sp = nonIdx.attributes.position;
      const centerWaterY =
        sampleElevation(elevation, (bb.minX + bb.maxX) * 0.5, (bb.minZ + bb.maxZ) * 0.5) + 0.52;
      for (let i = 0; i < sp.count; i++) {
        waterVerts.push(sp.getX(i), centerWaterY, sp.getZ(i));
      }
      sGeo.dispose();
      nonIdx.dispose();
    }
    const waterBuffer = new THREE.BufferGeometry();
    waterBuffer.setAttribute('position', new THREE.Float32BufferAttribute(waterVerts, 3));
    waterBuffer.computeVertexNormals();

    // 4. Campus Boundary Wall with clean openings wherever roads cross the perimeter
    const boundaryArea = areas.find((a) => a.id === 'campus-grounds');
    const roadPaths = paths.filter((p) => p.kind === 'road');
    const wallVerts: number[] = [];

    const isNearRoad = (px: number, pz: number): boolean => {
      for (const rp of roadPaths) {
        for (let k = 0; k < rp.points.length - 1; k++) {
          const [rx0, rz0] = rp.points[k];
          const [rx1, rz1] = rp.points[k + 1];
          if (distPointToSeg(px, pz, rx0, rz0, rx1, rz1) < 5.8) return true;
        }
      }
      return false;
    };

    if (boundaryArea) {
      const ring = boundaryArea.polygon;
      const halfThick = 0.32;
      const wallH = 1.75;
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i];
        const [bx, bz] = ring[(i + 1) % ring.length];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 0.2) continue;

        const nx = (-dz / len) * halfThick;
        const nz = (dx / len) * halfThick;
        const subSteps = Math.max(1, Math.ceil(len / 5.0));

        for (let s = 0; s < subSteps; s++) {
          const t0 = s / subSteps;
          const t1 = (s + 1) / subSteps;
          const sx0 = ax + dx * t0;
          const sz0 = az + dz * t0;
          const sx1 = ax + dx * t1;
          const sz1 = az + dz * t1;
          const mx = (sx0 + sx1) * 0.5;
          const mz = (sz0 + sz1) * 0.5;
          if (isNearRoad(mx, mz)) continue;

          const ya = sampleElevation(elevation, sx0, sz0) - 0.25;
          const yb = sampleElevation(elevation, sx1, sz1) - 0.25;
          const ta = ya + wallH;
          const tb = yb + wallH;

          const aOutX = sx0 + nx, aOutZ = sz0 + nz;
          const aInX = sx0 - nx, aInZ = sz0 - nz;
          const bOutX = sx1 + nx, bOutZ = sz1 + nz;
          const bInX = sx1 - nx, bInZ = sz1 - nz;

          wallVerts.push(aOutX, ya, aOutZ, bOutX, yb, bOutZ, bOutX, tb, bOutZ);
          wallVerts.push(aOutX, ya, aOutZ, bOutX, tb, bOutZ, aOutX, ta, aOutZ);
          wallVerts.push(bInX, yb, bInZ, aInX, ya, aInZ, aInX, ta, aInZ);
          wallVerts.push(bInX, yb, bInZ, aInX, ta, aInZ, bInX, tb, bInZ);
          wallVerts.push(aOutX, ta, aOutZ, bOutX, tb, bOutZ, bInX, tb, bInZ);
          wallVerts.push(aOutX, ta, aOutZ, bInX, tb, bInZ, aInX, ta, aInZ);
        }
      }
    }
    const wallBuffer = new THREE.BufferGeometry();
    wallBuffer.setAttribute('position', new THREE.Float32BufferAttribute(wallVerts, 3));
    wallBuffer.computeVertexNormals();

    // 5. Elevated Basketball Court plinth + hoops AND All-Around Fence on Side Court (soccer-court)
    const csVerts: number[] = [];
    const csNorms: number[] = [];
    const csCols: number[] = [];
    const fencePanelVerts: number[] = [];

    const bballArea = areas.find((a) => a.id === 'basketball-court');
    if (bballArea) {
      const bb = getPolygonBBox(bballArea.polygon);
      const bw = bb.maxX - bb.minX;
      const bd = bb.maxZ - bb.minZ;
      const bcx = (bb.minX + bb.maxX) * 0.5;
      const bcz = (bb.minZ + bb.maxZ) * 0.5;
      const by = sampleElevation(elevation, bcx, bcz);

      // Stepped concrete apron (+0.60 m) + crisp elevated court surface (+0.78 m)
      const apron = new THREE.BoxGeometry(bw + 1.4, 0.72, bd + 1.4);
      apron.translate(bcx, by + 0.24, bcz);
      pushColoredPart(csVerts, csNorms, csCols, apron, '#b5b8bc');
      apron.dispose();

      const deck = new THREE.BoxGeometry(bw, 0.18, bd);
      deck.translate(bcx, by + 0.69, bcz);
      pushColoredPart(csVerts, csNorms, csCols, deck, '#3e7b52');
      deck.dispose();

      // North & South basketball hoop stanchions, backboards & orange rims
      for (const sgn of [-1, 1]) {
        const hz = bcz + sgn * (bd * 0.5 - 0.8);
        const post = new THREE.BoxGeometry(0.22, 3.3, 0.22);
        post.translate(bcx, by + 2.35, hz);
        pushColoredPart(csVerts, csNorms, csCols, post, '#334155');
        post.dispose();

        const arm = new THREE.BoxGeometry(0.18, 0.18, 1.0);
        arm.translate(bcx, by + 3.85, hz - sgn * 0.45);
        pushColoredPart(csVerts, csNorms, csCols, arm, '#334155');
        arm.dispose();

        const board = new THREE.BoxGeometry(1.85, 1.15, 0.1);
        board.translate(bcx, by + 3.95, hz - sgn * 0.95);
        pushColoredPart(csVerts, csNorms, csCols, board, '#f8fafc');
        board.dispose();

        const rim = new THREE.BoxGeometry(0.55, 0.08, 0.55);
        rim.translate(bcx, by + 3.58, hz - sgn * 1.25);
        pushColoredPart(csVerts, csNorms, csCols, rim, '#ea580c');
        rim.dispose();
      }
    }

    // All-around perimeter sports fence on the side court (soccer-court)
    const fencedCourt = areas.find((a) => a.id === 'soccer-court');
    if (fencedCourt) {
      const ring = fencedCourt.polygon;
      const fenceH = 3.8;
      for (let i = 0; i < ring.length; i++) {
        const [ax, az] = ring[i];
        const [bx, bz] = ring[(i + 1) % ring.length];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 0.5) continue;
        const angleY = Math.atan2(-dz, dx);
        const mx = (ax + bx) * 0.5;
        const mz = (az + bz) * 0.5;
        const my = sampleElevation(elevation, mx, mz);

        // Top, middle & bottom horizontal fence rails
        for (const ry of [0.22, fenceH * 0.52, fenceH]) {
          const rail = new THREE.BoxGeometry(len, 0.09, 0.09);
          rail.rotateY(angleY);
          rail.translate(mx, my + ry, mz);
          pushColoredPart(csVerts, csNorms, csCols, rail, '#27303a');
          rail.dispose();
        }

        // Vertical steel posts every ~6.5 m
        const postCount = Math.max(1, Math.round(len / 6.5));
        for (let p = 0; p < postCount; p++) {
          const frac = p / postCount;
          const px = ax + dx * frac;
          const pz = az + dz * frac;
          const py = sampleElevation(elevation, px, pz);
          const post = new THREE.BoxGeometry(0.12, fenceH + 0.15, 0.12);
          post.translate(px, py + fenceH * 0.5, pz);
          pushColoredPart(csVerts, csNorms, csCols, post, '#27303a');
          post.dispose();
        }

        // Double-sided translucent mesh panel along each side
        const ya = sampleElevation(elevation, ax, az);
        const yb = sampleElevation(elevation, bx, bz);
        fencePanelVerts.push(ax, ya + 0.15, az, bx, yb + 0.15, bz, bx, yb + fenceH, bz);
        fencePanelVerts.push(ax, ya + 0.15, az, bx, yb + fenceH, bz, ax, ya + fenceH, az);
      }
    }

    const courtStructsBuffer = new THREE.BufferGeometry();
    courtStructsBuffer.setAttribute('position', new THREE.Float32BufferAttribute(csVerts, 3));
    courtStructsBuffer.setAttribute('normal', new THREE.Float32BufferAttribute(csNorms, 3));
    courtStructsBuffer.setAttribute('color', new THREE.Float32BufferAttribute(csCols, 3));

    const courtFenceBuffer = new THREE.BufferGeometry();
    courtFenceBuffer.setAttribute('position', new THREE.Float32BufferAttribute(fencePanelVerts, 3));
    courtFenceBuffer.computeVertexNormals();

    return {
      terrainGeo: nonIndexed,
      markingsGeo: markBuffer,
      waterGeo: waterBuffer,
      wallGeo: wallBuffer,
      courtStructsGeo: courtStructsBuffer,
      courtMeshFenceGeo: courtFenceBuffer,
    };
  }, [elevation, areas, paths]);

  return (
    <group name="campus-ground-group">
      {/* Lush green surrounding base skirt so exterior beyond the wall is verdant green */}
      <mesh position={[0, -0.45, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3200, 3200, 1, 1]} />
        <meshStandardMaterial color="#739b6b" roughness={0.97} metalness={0.0} />
      </mesh>

      <mesh geometry={terrainGeo} receiveShadow={receiveShadow}>
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0.0} flatShading />
      </mesh>

      <mesh geometry={markingsGeo}>
        <meshStandardMaterial
          color="#f5f6f2"
          roughness={0.85}
          metalness={0.0}
          polygonOffset
          polygonOffsetFactor={-1}
        />
      </mesh>

      <mesh geometry={waterGeo}>
        <meshStandardMaterial
          color="#35a7d6"
          emissive="#1a6c8e"
          emissiveIntensity={0.14}
          roughness={0.18}
          metalness={0.14}
        />
      </mesh>

      <mesh geometry={wallGeo} castShadow={receiveShadow} receiveShadow={receiveShadow}>
        <meshStandardMaterial color="#cfc8bc" roughness={0.9} metalness={0.0} flatShading />
      </mesh>

      <mesh geometry={courtStructsGeo} castShadow={receiveShadow} receiveShadow={receiveShadow}>
        <meshStandardMaterial vertexColors roughness={0.85} metalness={0.08} flatShading />
      </mesh>

      <mesh geometry={courtMeshFenceGeo}>
        <meshStandardMaterial
          color="#2c3e35"
          transparent
          opacity={0.28}
          roughness={0.7}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
