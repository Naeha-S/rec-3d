import { useMemo } from 'react';
import * as THREE from 'three';
import type { CampusPath, ElevationData, PathKind, RouteResult } from '../types';
import { sampleElevation } from '../logic/elevation';

interface PathsProps {
  paths: CampusPath[];
  elevation: ElevationData;
  route: RouteResult | null;
}

const PATH_COLORS: Record<PathKind, string> = {
  road: '#67707a',
  service: '#858d95',
  cobblestone: '#8c8880',
  footway: '#b7b0a2',
};

const PATH_LIFT: Record<PathKind, number> = {
  road: 0.16,
  service: 0.14,
  cobblestone: 0.15,
  footway: 0.12,
};

function buildRibbonMesh(
  polylines: { points: [number, number][]; width: number; liftY: number }[],
  elevation: ElevationData,
  subdivideStepM = 3.5
): THREE.BufferGeometry {
  const verts: number[] = [];

  for (const line of polylines) {
    const hw = line.width * 0.5;
    const pts = line.points;

    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const segLen = Math.hypot(dx, dz);
      if (segLen < 0.05) continue;

      const nx = (-dz / segLen) * hw;
      const nz = (dx / segLen) * hw;
      const steps = Math.max(1, Math.ceil(segLen / subdivideStepM));

      for (let s = 0; s < steps; s++) {
        const t0 = s / steps;
        const t1 = (s + 1) / steps;
        const x0 = ax + dx * t0;
        const z0 = az + dz * t0;
        const x1 = ax + dx * t1;
        const z1 = az + dz * t1;

        const l0x = x0 + nx, l0z = z0 + nz;
        const r0x = x0 - nx, r0z = z0 - nz;
        const l1x = x1 + nx, l1z = z1 + nz;
        const r1x = x1 - nx, r1z = z1 - nz;

        const yl0 = sampleElevation(elevation, l0x, l0z) + line.liftY;
        const yr0 = sampleElevation(elevation, r0x, r0z) + line.liftY;
        const yl1 = sampleElevation(elevation, l1x, l1z) + line.liftY;
        const yr1 = sampleElevation(elevation, r1x, r1z) + line.liftY;

        verts.push(l0x, yl0, l0z, r1x, yr1, r1z, r0x, yr0, r0z);
        verts.push(l0x, yl0, l0z, l1x, yl1, l1z, r1x, yr1, r1z);
      }
    }

    const capSegs = 6;
    for (let i = 0; i < pts.length; i++) {
      const [cx, cz] = pts[i];
      const yc = sampleElevation(elevation, cx, cz) + line.liftY + 0.004;
      for (let s = 0; s < capSegs; s++) {
        const a0 = (s / capSegs) * Math.PI * 2;
        const a1 = ((s + 1) / capSegs) * Math.PI * 2;
        const x0 = cx + Math.cos(a0) * hw;
        const z0 = cz + Math.sin(a0) * hw;
        const x1 = cx + Math.cos(a1) * hw;
        const z1 = cz + Math.sin(a1) * hw;
        const y0 = sampleElevation(elevation, x0, z0) + line.liftY + 0.004;
        const y1 = sampleElevation(elevation, x1, z1) + line.liftY + 0.004;
        verts.push(cx, yc, cz, x1, y1, z1, x0, y0, z0);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * Builds subtle cobblestone stone-curb borders + transverse stone joints so
 * 'cobblestone' paths read distinctly as paved stone walkways.
 */
function buildCobbleJointsMesh(
  cobblePaths: CampusPath[],
  elevation: ElevationData
): THREE.BufferGeometry {
  const verts: number[] = [];

  for (const p of cobblePaths) {
    const hw = p.width * 0.5;
    const pts = p.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz);
      if (len < 0.2) continue;
      const ux = dx / len;
      const uz = dz / len;
      const nx = -uz;
      const nz = ux;

      // Transverse stone joint bands every 1.6 m
      for (let d = 0.8; d < len - 0.4; d += 1.6) {
        const cx = ax + ux * d;
        const cz = az + uz * d;
        const bw = 0.14;
        const l0x = cx - ux * bw + nx * hw, l0z = cz - uz * bw + nz * hw;
        const r0x = cx - ux * bw - nx * hw, r0z = cz - uz * bw - nz * hw;
        const l1x = cx + ux * bw + nx * hw, l1z = cz + uz * bw + nz * hw;
        const r1x = cx + ux * bw - nx * hw, r1z = cz + uz * bw - nz * hw;
        const y = sampleElevation(elevation, cx, cz) + 0.162;
        verts.push(l0x, y, l0z, r1x, y, r1z, r0x, y, r0z);
        verts.push(l0x, y, l0z, l1x, y, l1z, r1x, y, r1z);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.computeVertexNormals();
  return geo;
}

export function Paths({ paths, elevation, route }: PathsProps) {
  const { roadGeo, serviceGeo, cobbleBaseGeo, cobbleJointGeo, footwayGeo } = useMemo(() => {
    const byKind = (kind: PathKind, widthAdd = 0, liftOverride?: number) =>
      paths
        .filter((p) => p.kind === kind)
        .map((p) => ({
          points: p.points,
          width: p.width + widthAdd,
          liftY: liftOverride ?? PATH_LIFT[kind],
        }));

    const cobbles = paths.filter((p) => p.kind === 'cobblestone');

    return {
      roadGeo: buildRibbonMesh(byKind('road'), elevation),
      serviceGeo: buildRibbonMesh(byKind('service'), elevation),
      cobbleBaseGeo: buildRibbonMesh(byKind('cobblestone'), elevation, 2.5),
      cobbleJointGeo: buildCobbleJointsMesh(cobbles, elevation),
      footwayGeo: buildRibbonMesh(byKind('footway'), elevation),
    };
  }, [paths, elevation]);

  const routeVisual = useMemo(() => {
    if (!route || !route.ok || route.points.length < 2) return null;
    const ribbon = buildRibbonMesh(
      [{ points: route.points, width: 2.25, liftY: 0.34 }],
      elevation,
      3.5
    );
    const startPt = route.points[0];
    const endPt = route.points[route.points.length - 1];
    const startY = sampleElevation(elevation, startPt[0], startPt[1]);
    const endY = sampleElevation(elevation, endPt[0], endPt[1]);
    return { ribbon, startPt, endPt, startY, endY };
  }, [route, elevation]);

  return (
    <group name="campus-paths-group">
      <mesh geometry={roadGeo}>
        <meshStandardMaterial color={PATH_COLORS.road} roughness={0.92} metalness={0.0} />
      </mesh>
      <mesh geometry={serviceGeo}>
        <meshStandardMaterial color={PATH_COLORS.service} roughness={0.92} metalness={0.0} />
      </mesh>
      <mesh geometry={cobbleBaseGeo}>
        <meshStandardMaterial color={PATH_COLORS.cobblestone} roughness={0.96} metalness={0.0} />
      </mesh>
      <mesh geometry={cobbleJointGeo}>
        <meshStandardMaterial color="#68645d" roughness={0.98} metalness={0.0} />
      </mesh>
      <mesh geometry={footwayGeo}>
        <meshStandardMaterial color={PATH_COLORS.footway} roughness={0.95} metalness={0.0} />
      </mesh>

      {routeVisual && (
        <group name="active-walking-route">
          <mesh geometry={routeVisual.ribbon}>
            <meshStandardMaterial
              color="#c83a22"
              emissive="#e0482d"
              emissiveIntensity={0.55}
              roughness={0.38}
            />
          </mesh>

          <mesh position={[routeVisual.startPt[0], routeVisual.startY + 2.4, routeVisual.startPt[1]]}>
            <cylinderGeometry args={[0.85, 0.85, 4.2, 8]} />
            <meshStandardMaterial color="#18181b" emissive="#27272a" emissiveIntensity={0.35} />
          </mesh>

          <mesh position={[routeVisual.endPt[0], routeVisual.endY + 3.2, routeVisual.endPt[1]]}>
            <octahedronGeometry args={[1.8, 0]} />
            <meshStandardMaterial color="#e0482d" emissive="#dc381f" emissiveIntensity={0.8} flatShading />
          </mesh>
        </group>
      )}
    </group>
  );
}
