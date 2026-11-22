import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ElevationData, FoliageItem } from '../types';
import { sampleElevation } from '../logic/elevation';

interface FoliageProps {
  foliage: FoliageItem[];
  elevation: ElevationData;
  castShadow: boolean;
}

interface ColoredPart {
  geo: THREE.BufferGeometry;
  bottomColor: string;
  topColor: string;
  minY: number;
  maxY: number;
  leafNoise?: number;
}

/**
 * Merges low-poly tree sub-meshes while baking vertical & radial per-vertex color
 * variation into the BufferGeometry `color` attribute (under-canopy AO shadow -> sunlit crown tips
 * + per-vertex facet hue/lightness variance).
 */
function buildVertexColoredPrototype(parts: ColoredPart[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const colBottom = new THREE.Color();
  const colTop = new THREE.Color();
  const vCol = new THREE.Color();

  for (const part of parts) {
    const nonIdx = part.geo.index ? part.geo.toNonIndexed() : part.geo;
    nonIdx.computeVertexNormals();
    const pos = nonIdx.attributes.position;
    const norm = nonIdx.attributes.normal;
    colBottom.set(part.bottomColor);
    colTop.set(part.topColor);
    const spanY = Math.max(0.01, part.maxY - part.minY);
    const noiseAmt = part.leafNoise ?? 0.0;

    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i);
      const vy = pos.getY(i);
      const vz = pos.getZ(i);
      positions.push(vx, vy, vz);
      normals.push(norm.getX(i), norm.getY(i), norm.getZ(i));

      const t = THREE.MathUtils.clamp((vy - part.minY) / spanY, 0, 1);
      vCol.copy(colBottom).lerp(colTop, Math.pow(t, 0.85));

      if (noiseAmt > 0) {
        // Deterministic per-vertex leaf color variation across crown facets
        const n1 = Math.sin(vx * 3.17 + vy * 2.31 + vz * 4.13);
        const n2 = Math.cos(vx * 5.03 - vz * 3.71 + vy * 1.9);
        vCol.offsetHSL(n1 * noiseAmt * 0.45, n2 * noiseAmt * 0.5, n1 * noiseAmt);
      }

      colors.push(vCol.r, vCol.g, vCol.b);
    }

    if (nonIdx !== part.geo) nonIdx.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return out;
}

// Deterministic pseudo-random helper in [-1, 1]
function hashSigned(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2.0 - 1.0;
}

// Rich South Indian tropical foliage tint palette multiplied against vertex colors
const INSTANCE_LEAF_TINTS = [
  '#f4fbf0', // fresh neem emerald
  '#eef8e3', // sunlit rain-tree lime
  '#e3f0da', // deep banyan jade
  '#f9f6df', // warm golden-olive crown
  '#e6f4ea', // cool eucalyptus green
  '#f3f9e6', // bright monsoon foliage
];

export function Foliage({ foliage, elevation, castShadow }: FoliageProps) {
  const treeRef = useRef<THREE.InstancedMesh>(null);
  const rainTreeRef = useRef<THREE.InstancedMesh>(null);
  const palmRef = useRef<THREE.InstancedMesh>(null);
  const shrubRef = useRef<THREE.InstancedMesh>(null);

  const trees = useMemo(() => foliage.filter((f) => f.kind === 'tree'), [foliage]);
  const rainTrees = useMemo(() => foliage.filter((f) => f.kind === 'rain_tree'), [foliage]);
  const palms = useMemo(() => foliage.filter((f) => f.kind === 'palm'), [foliage]);
  const shrubs = useMemo(() => foliage.filter((f) => f.kind === 'shrub'), [foliage]);
  const hedges = useMemo(
    () => foliage.filter((f) => f.kind === 'hedge' && f.span && f.span.length >= 2),
    [foliage]
  );

  const { treeProto, rainTreeProto, palmProto, shrubProto, hedgeGeo } = useMemo(() => {
    // 1. Asymmetric Neem/Gulmohar Broadleaf Tree (normalized height = 10 m, radius = 3.2 m)
    const trunk = new THREE.CylinderGeometry(0.22, 0.4, 3.2, 5, 1, true);
    trunk.translate(0, 1.6, 0);

    const crownMain = new THREE.IcosahedronGeometry(2.65, 0);
    crownMain.scale(1.15, 0.92, 1.05);
    crownMain.translate(0.15, 5.4, -0.1);

    const crownSide = new THREE.ConeGeometry(2.35, 4.1, 6);
    crownSide.rotateZ(0.12);
    crownSide.translate(-0.55, 6.6, 0.38);

    const crownApex = new THREE.ConeGeometry(1.9, 3.6, 6);
    crownApex.rotateX(-0.09);
    crownApex.translate(0.32, 8.1, -0.22);

    const tProto = buildVertexColoredPrototype([
      { geo: trunk, bottomColor: '#4e3928', topColor: '#6f553e', minY: 0, maxY: 3.2 },
      {
        geo: crownMain,
        bottomColor: '#2b5832',
        topColor: '#569853',
        minY: 3.0,
        maxY: 7.8,
        leafNoise: 0.065,
      },
      {
        geo: crownSide,
        bottomColor: '#316438',
        topColor: '#63a659',
        minY: 4.5,
        maxY: 8.7,
        leafNoise: 0.07,
      },
      {
        geo: crownApex,
        bottomColor: '#3c7340',
        topColor: '#76ba62',
        minY: 6.2,
        maxY: 10.0,
        leafNoise: 0.075,
      },
    ]);
    trunk.dispose();
    crownMain.dispose();
    crownSide.dispose();
    crownApex.dispose();

    // 2. Spreading Thandalam Rain Tree / Umbrella Canopy (normalized height = 12 m, radius = 5.2 m)
    const rTrunk = new THREE.CylinderGeometry(0.3, 0.52, 4.2, 5, 1, true);
    rTrunk.translate(0, 2.1, 0);

    const rLimb1 = new THREE.CylinderGeometry(0.14, 0.24, 3.0, 4, 1, true);
    rLimb1.rotateZ(0.55);
    rLimb1.translate(-0.9, 4.7, 0.2);

    const rLimb2 = new THREE.CylinderGeometry(0.14, 0.24, 3.0, 4, 1, true);
    rLimb2.rotateZ(-0.5);
    rLimb2.rotateY(1.1);
    rLimb2.translate(0.75, 4.8, -0.55);

    const rCanopyLow = new THREE.ConeGeometry(5.1, 3.8, 7);
    rCanopyLow.translate(-0.15, 7.2, 0.15);

    const rCanopyMid = new THREE.ConeGeometry(4.4, 3.6, 7);
    rCanopyMid.rotateY(0.45);
    rCanopyMid.translate(0.35, 9.0, -0.25);

    const rCanopyTop = new THREE.ConeGeometry(3.1, 2.9, 6);
    rCanopyTop.translate(-0.2, 10.6, 0.1);

    const rtProto = buildVertexColoredPrototype([
      { geo: rTrunk, bottomColor: '#463425', topColor: '#684f39', minY: 0, maxY: 4.2 },
      { geo: rLimb1, bottomColor: '#584230', topColor: '#6d543e', minY: 3.4, maxY: 6.0 },
      { geo: rLimb2, bottomColor: '#584230', topColor: '#6d543e', minY: 3.4, maxY: 6.0 },
      {
        geo: rCanopyLow,
        bottomColor: '#254e2c',
        topColor: '#4c8c4a',
        minY: 5.3,
        maxY: 9.1,
        leafNoise: 0.065,
      },
      {
        geo: rCanopyMid,
        bottomColor: '#316337',
        topColor: '#62a655',
        minY: 7.2,
        maxY: 10.8,
        leafNoise: 0.075,
      },
      {
        geo: rCanopyTop,
        bottomColor: '#3e7741',
        topColor: '#7bc063',
        minY: 9.1,
        maxY: 12.0,
        leafNoise: 0.08,
      },
    ]);
    rTrunk.dispose();
    rLimb1.dispose();
    rLimb2.dispose();
    rCanopyLow.dispose();
    rCanopyMid.dispose();
    rCanopyTop.dispose();

    // 3. Tropical Campus Palm (normalized height = 12 m, radius = 3.0 m)
    const pStemLow = new THREE.CylinderGeometry(0.2, 0.32, 5.5, 5, 1, true);
    pStemLow.rotateZ(0.04);
    pStemLow.translate(-0.1, 2.75, 0);

    const pStemTop = new THREE.CylinderGeometry(0.15, 0.21, 5.2, 5, 1, true);
    pStemTop.rotateZ(-0.03);
    pStemTop.translate(-0.14, 8.0, 0);

    const palmParts: ColoredPart[] = [
      { geo: pStemLow, bottomColor: '#6b5a49', topColor: '#86735f', minY: 0, maxY: 5.5 },
      { geo: pStemTop, bottomColor: '#7c6a57', topColor: '#917e69', minY: 5.4, maxY: 10.6 },
    ];
    const frondGeos: THREE.BufferGeometry[] = [pStemLow, pStemTop];

    for (let k = 0; k < 6; k++) {
      const ang = (k / 6) * Math.PI * 2 + (k % 2) * 0.18;
      const frond = new THREE.ConeGeometry(0.62, 3.1, 3);
      frond.scale(1.0, 1.0, 0.28);
      frond.rotateZ(-1.18 - (k % 2) * 0.16);
      frond.rotateY(ang);
      frond.translate(-0.12 + Math.cos(ang) * 1.35, 10.55 - (k % 2) * 0.25, -Math.sin(ang) * 1.35);
      frondGeos.push(frond);
      palmParts.push({
        geo: frond,
        bottomColor: '#356b38',
        topColor: '#75b95b',
        minY: 9.4,
        maxY: 11.8,
        leafNoise: 0.06,
      });
    }
    const pProto = buildVertexColoredPrototype(palmParts);
    frondGeos.forEach((g) => g.dispose());

    // 4. Multi-faceted Garden Shrub (normalized height = 3.0 m, radius = 1.7 m)
    const bushA = new THREE.IcosahedronGeometry(1.45, 0);
    bushA.scale(1.15, 0.85, 1.0);
    bushA.translate(-0.2, 1.2, 0.1);

    const bushB = new THREE.ConeGeometry(1.3, 2.1, 6);
    bushB.translate(0.28, 1.85, -0.15);

    const sProto = buildVertexColoredPrototype([
      {
        geo: bushA,
        bottomColor: '#2d5d34',
        topColor: '#5da157',
        minY: 0.1,
        maxY: 2.5,
        leafNoise: 0.07,
      },
      {
        geo: bushB,
        bottomColor: '#396f3e',
        topColor: '#73b864',
        minY: 0.8,
        maxY: 3.0,
        leafNoise: 0.075,
      },
    ]);
    bushA.dispose();
    bushB.dispose();

    // 5. Extruded hedges along span (if any present)
    const hVerts: number[] = [];
    for (const h of hedges) {
      const pts = h.span!;
      const hw = h.radius;
      const hh = h.height;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        if (len < 0.2) continue;
        const nx = (-dz / len) * hw;
        const nz = (dx / len) * hw;
        const ya = sampleElevation(elevation, ax, az) - 0.1;
        const yb = sampleElevation(elevation, bx, bz) - 0.1;
        hVerts.push(ax + nx, ya, az + nz, bx + nx, yb, bz + nz, bx + nx, yb + hh, bz + nz);
        hVerts.push(ax + nx, ya, az + nz, bx + nx, yb + hh, bz + nz, ax + nx, ya + hh, az + nz);
        hVerts.push(bx - nx, yb, bz - nz, ax - nx, ya, az - nz, ax - nx, ya + hh, az - nz);
        hVerts.push(bx - nx, yb, bz - nz, ax - nx, ya + hh, az - nz, bx - nx, yb + hh, bz - nz);
        hVerts.push(ax + nx, ya + hh, az + nz, bx + nx, yb + hh, bz + nz, bx - nx, yb + hh, bz - nz);
        hVerts.push(ax + nx, ya + hh, az + nz, bx - nx, yb + hh, bz - nz, ax - nx, ya + hh, az - nz);
      }
    }
    const hBuf = new THREE.BufferGeometry();
    hBuf.setAttribute('position', new THREE.Float32BufferAttribute(hVerts, 3));
    hBuf.computeVertexNormals();

    return {
      treeProto: tProto,
      rainTreeProto: rtProto,
      palmProto: pProto,
      shrubProto: sProto,
      hedgeGeo: hBuf,
    };
  }, [hedges, elevation]);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();

    const populateInstances = (
      mesh: THREE.InstancedMesh | null,
      items: FoliageItem[],
      normRadius: number,
      normHeight: number,
      maxTiltRad: number
    ) => {
      if (!mesh || items.length === 0) return;
      items.forEach((f, idx) => {
        const y = sampleElevation(elevation, f.x, f.z) - 0.18;
        const h1 = hashSigned(idx * 3.1 + f.x * 0.19 + f.z * 0.13);
        const h2 = hashSigned(idx * 7.3 - f.x * 0.11 + f.z * 0.29);
        const h3 = hashSigned(idx * 11.7 + f.x * 0.07 - f.z * 0.23);
        const h4 = hashSigned(idx * 17.9 + f.z * 0.37);

        // Non-uniform XZ & Y scale variance so crowns look organic and non-repetitive
        const sx = (f.radius / normRadius) * (1.0 + h1 * 0.22);
        const sz = (f.radius / normRadius) * (1.0 + h2 * 0.22);
        const sy = (f.height / normHeight) * (1.0 + h3 * 0.18);

        // Full 360-deg Y rotation + subtle organic lean
        dummy.position.set(f.x, y, f.z);
        dummy.rotation.set(
          h2 * maxTiltRad,
          (h1 + 1.0) * Math.PI,
          h4 * maxTiltRad
        );
        dummy.scale.set(sx, sy, sz);
        dummy.updateMatrix();
        mesh.setMatrixAt(idx, dummy.matrix);

        // Per-instance tint variation multiplied with per-vertex leaf gradient
        const paletteHex =
          INSTANCE_LEAF_TINTS[Math.abs(Math.floor((h1 + 1) * 97 + idx)) % INSTANCE_LEAF_TINTS.length];
        tint.set(paletteHex).offsetHSL(h3 * 0.032, h2 * 0.08, h4 * 0.065);
        mesh.setColorAt(idx, tint);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };

    populateInstances(treeRef.current, trees, 3.2, 10.0, 0.065);
    populateInstances(rainTreeRef.current, rainTrees, 5.1, 12.0, 0.05);
    populateInstances(palmRef.current, palms, 2.8, 12.0, 0.085);
    populateInstances(shrubRef.current, shrubs, 1.6, 3.0, 0.08);
  }, [trees, rainTrees, palms, shrubs, elevation]);

  return (
    <group name="campus-foliage-group">
      {trees.length > 0 && (
        <instancedMesh
          ref={treeRef}
          args={[treeProto, undefined, trees.length]}
          castShadow={castShadow}
          receiveShadow={castShadow}
        >
          <meshStandardMaterial vertexColors roughness={0.9} metalness={0.0} flatShading />
        </instancedMesh>
      )}

      {rainTrees.length > 0 && (
        <instancedMesh
          ref={rainTreeRef}
          args={[rainTreeProto, undefined, rainTrees.length]}
          castShadow={castShadow}
          receiveShadow={castShadow}
        >
          <meshStandardMaterial vertexColors roughness={0.89} metalness={0.0} flatShading />
        </instancedMesh>
      )}

      {palms.length > 0 && (
        <instancedMesh
          ref={palmRef}
          args={[palmProto, undefined, palms.length]}
          castShadow={castShadow}
          receiveShadow={castShadow}
        >
          <meshStandardMaterial vertexColors roughness={0.86} metalness={0.0} flatShading />
        </instancedMesh>
      )}

      {shrubs.length > 0 && (
        <instancedMesh
          ref={shrubRef}
          args={[shrubProto, undefined, shrubs.length]}
          castShadow={false}
          receiveShadow={castShadow}
        >
          <meshStandardMaterial vertexColors roughness={0.93} metalness={0.0} flatShading />
        </instancedMesh>
      )}

      {hedges.length > 0 && (
        <mesh geometry={hedgeGeo}>
          <meshStandardMaterial color="#487f4f" roughness={0.95} flatShading />
        </mesh>
      )}
    </group>
  );
}
