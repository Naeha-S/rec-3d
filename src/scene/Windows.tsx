import { useMemo } from 'react';
import * as THREE from 'three';
import type { Building, ElevationData } from '../types';
import { getBuildingBaseY } from './Buildings';

interface WindowsProps {
  buildings: Building[];
  elevation: ElevationData;
  nightFactor: number;
}

const MAX_TRIS_PER_BUILDING = 900; // 900 tri cap each (450 quads)
const MAX_QUADS_PER_BUILDING = Math.floor(MAX_TRIS_PER_BUILDING / 2);

const NON_WINDOW_STYLES = new Set([
  'arch',
  'steps',
  'monument',
  'fountain',
  'pool_enclosure',
  'pavilion_cafe',
  'open_cafe',
  'sixth_sense_garden',
  'maggi_kiosk',
  'idea_factory',
  'dominos',
  'rec_cafe',
  'b_block',
  'skybridge',
]);

interface MergedBuildingWindows {
  id: string;
  baseY: number;
  isShedHall: boolean;
  windowGeo: THREE.BufferGeometry | null;
  doorGeo: THREE.BufferGeometry | null;
}

function signedAreaXZ(poly: [number, number][]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    area += x1 * z2 - x2 * z1;
  }
  return 0.5 * area;
}

/**
 * Generates merged window bays & ground-floor shed doors per building:
 * - Multi-floor buildings space `b.levels` rows evenly across `b.height_m`
 * - `shed_hall` buildings (Indoor Auditorium, REC Cafe, Workshops) render ONLY
 *   large ground-floor entrance doors + a few small dimly-lit ground-floor windows
 * - Strictly capped at <= 900 triangles per building
 */
export function Windows({ buildings, elevation, nightFactor }: WindowsProps) {
  const items = useMemo<MergedBuildingWindows[]>(() => {
    const result: MergedBuildingWindows[] = [];

    for (const b of buildings) {
      if (NON_WINDOW_STYLES.has(b.style)) continue;
      const ring = b.polygon;
      if (ring.length < 3) continue;

      const areaSign = signedAreaXZ(ring) <= 0 ? 1 : -1;
      const outwardOffset = 0.31;

      if (b.style === 'shed_hall') {
        // Huge shed halls (Indoor Auditorium, REC Cafe, Workshops):
        // Ground-floor wide doors + only a few ground-floor windows, NOT brightly lit multi-floor grids
        const winPositions: number[] = [];
        const winColors: number[] = [];
        const doorPositions: number[] = [];

        for (let i = 0; i < ring.length; i++) {
          const [x1, z1] = ring[i];
          const [x2, z2] = ring[(i + 1) % ring.length];
          const dx = x2 - x1;
          const dz = z2 - z1;
          const span = Math.hypot(dx, dz);
          if (span < 7.0) continue;

          const ux = dx / span;
          const uz = dz / span;
          const nx = -uz * areaSign;
          const nz = ux * areaSign;

          // Wide ground-floor double doors (~every 18 m, at least 1 on main walls >= 14 m)
          const doorCount = span >= 14.0 ? Math.max(1, Math.floor(span / 18.0)) : 0;
          const doorHalfW = 1.35;
          const doorH = 3.2;
          for (let dIdx = 1; dIdx <= doorCount; dIdx++) {
            const frac = dIdx / (doorCount + 1);
            const cx = x1 + dx * frac + nx * (outwardOffset + 0.02);
            const cz = z1 + dz * frac + nz * (outwardOffset + 0.02);
            const lx = cx - ux * doorHalfW;
            const lz = cz - uz * doorHalfW;
            const rx = cx + ux * doorHalfW;
            const rz = cz + uz * doorHalfW;
            doorPositions.push(lx, 0.1, lz, rx, 0.1, rz, rx, doorH, rz);
            doorPositions.push(lx, 0.1, lz, rx, doorH, rz, lx, doorH, lz);
          }

          // Sparse small ground-floor windows (~every 11 m, avoiding door centers)
          const winCount = Math.floor(span / 11.0);
          const winHalfW = 0.65;
          for (let wIdx = 1; wIdx <= winCount; wIdx++) {
            const frac = (wIdx - 0.5) / winCount;
            // Skip if close to a door fraction
            let nearDoor = false;
            for (let dIdx = 1; dIdx <= doorCount; dIdx++) {
              if (Math.abs(frac - dIdx / (doorCount + 1)) * span < 3.0) {
                nearDoor = true;
                break;
              }
            }
            if (nearDoor) continue;

            const cx = x1 + dx * frac + nx * outwardOffset;
            const cz = z1 + dz * frac + nz * outwardOffset;
            const lx = cx - ux * winHalfW;
            const lz = cz - uz * winHalfW;
            const rx = cx + ux * winHalfW;
            const rz = cz + uz * winHalfW;
            const y0 = 1.5;
            const y1 = 2.6;
            winPositions.push(lx, y0, lz, rx, y0, rz, rx, y1, rz);
            winPositions.push(lx, y0, lz, rx, y1, rz, lx, y1, lz);
            for (let v = 0; v < 6; v++) {
              winColors.push(0.28, 0.27, 0.25);
            }
          }
        }

        let wGeo: THREE.BufferGeometry | null = null;
        if (winPositions.length > 0) {
          wGeo = new THREE.BufferGeometry();
          wGeo.setAttribute('position', new THREE.Float32BufferAttribute(winPositions, 3));
          wGeo.setAttribute('color', new THREE.Float32BufferAttribute(winColors, 3));
          wGeo.computeVertexNormals();
        }

        let dGeo: THREE.BufferGeometry | null = null;
        if (doorPositions.length > 0) {
          dGeo = new THREE.BufferGeometry();
          dGeo.setAttribute('position', new THREE.Float32BufferAttribute(doorPositions, 3));
          dGeo.computeVertexNormals();
        }

        if (wGeo || dGeo) {
          result.push({
            id: b.id,
            baseY: getBuildingBaseY(b, elevation),
            isShedHall: true,
            windowGeo: wGeo,
            doorGeo: dGeo,
          });
        }
        continue;
      }

      // Standard & Main Block multi-story window bays scaled to exact `b.height_m` & `b.levels`
      let rawCount = 0;
      for (let i = 0; i < ring.length; i++) {
        const [x1, z1] = ring[i];
        const [x2, z2] = ring[(i + 1) % ring.length];
        const span = Math.hypot(x2 - x1, z2 - z1);
        if (span >= 3.5) {
          rawCount += Math.floor(span / 4.0) * b.levels;
        }
      }
      if (rawCount === 0) continue;

      const baySpacing =
        rawCount > MAX_QUADS_PER_BUILDING
          ? 4.0 * (rawCount / MAX_QUADS_PER_BUILDING)
          : 4.0;

      const positions: number[] = [];
      const colors: number[] = [];
      let quadCount = 0;

      const floorStep = b.height_m / b.levels;
      const winH = Math.min(1.85, Math.max(1.35, floorStep * 0.48));
      const sillOffset = Math.max(0.65, (floorStep - winH) * 0.52);
      const halfW = 0.72;

      for (let i = 0; i < ring.length && quadCount < MAX_QUADS_PER_BUILDING; i++) {
        const [x1, z1] = ring[i];
        const [x2, z2] = ring[(i + 1) % ring.length];
        const dx = x2 - x1;
        const dz = z2 - z1;
        const span = Math.hypot(dx, dz);
        if (span < 3.5) continue;

        const ux = dx / span;
        const uz = dz / span;
        const nx = -uz * areaSign;
        const nz = ux * areaSign;

        const baysOnWall = Math.max(1, Math.floor(span / baySpacing));
        for (let bi = 1; bi <= baysOnWall && quadCount < MAX_QUADS_PER_BUILDING; bi++) {
          const frac = bi / (baysOnWall + 1);
          const cx = x1 + dx * frac + nx * outwardOffset;
          const cz = z1 + dz * frac + nz * outwardOffset;

          const lx = cx - ux * halfW;
          const lz = cz - uz * halfW;
          const rx = cx + ux * halfW;
          const rz = cz + uz * halfW;

          for (let lv = 0; lv < b.levels && quadCount < MAX_QUADS_PER_BUILDING; lv++) {
            const y0 = lv * floorStep + sillOffset;
            const y1 = y0 + winH;

            positions.push(lx, y0, lz, rx, y0, rz, rx, y1, rz);
            positions.push(lx, y0, lz, rx, y1, rz, lx, y1, lz);

            const seed = Math.abs(Math.sin(i * 19.3 + bi * 7.7 + lv * 31.1));
            const litScale = seed > 0.24 ? 0.78 + seed * 0.22 : 0.3;
            for (let v = 0; v < 6; v++) {
              colors.push(litScale, litScale * 0.96, litScale * 0.88);
            }
            quadCount++;
          }
        }
      }

      if (positions.length === 0) continue;

      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();

      result.push({
        id: b.id,
        baseY: getBuildingBaseY(b, elevation),
        isShedHall: false,
        windowGeo: geo,
        doorGeo: null,
      });
    }

    return result;
  }, [buildings, elevation]);

  const dayGlass = '#7da3bc';
  const nightGlow = '#ffd996';
  const emissiveIntensity = 0.08 + nightFactor * 1.48;

  return (
    <group name="campus-windows-group">
      {items.map((w) => (
        <group key={w.id} position={[0, w.baseY, 0]}>
          {w.windowGeo && (
            <mesh geometry={w.windowGeo}>
              <meshStandardMaterial
                color={w.isShedHall ? '#5c6f7d' : nightFactor > 0.35 ? '#f6dfb2' : dayGlass}
                emissive={
                  w.isShedHall
                    ? '#334155'
                    : nightFactor > 0.15
                    ? nightGlow
                    : '#4c7691'
                }
                emissiveIntensity={w.isShedHall ? 0.04 + nightFactor * 0.12 : emissiveIntensity}
                vertexColors
                roughness={0.3}
                metalness={0.18}
              />
            </mesh>
          )}
          {w.doorGeo && (
            <mesh geometry={w.doorGeo}>
              <meshStandardMaterial color="#3b3632" roughness={0.78} metalness={0.12} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}
