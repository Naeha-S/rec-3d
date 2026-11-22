import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { CampusPropItem, ElevationData } from '../types';
import { sampleElevation } from '../logic/elevation';

interface PropsMeshProps {
  items: CampusPropItem[];
  elevation: ElevationData;
  castShadow: boolean;
}

function pushColoredGeom(
  verts: number[],
  norms: number[],
  cols: number[],
  geom: THREE.BufferGeometry,
  hex: string
) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const c = new THREE.Color(hex);
  for (let i = 0; i < pos.count; i++) {
    verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    norms.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    cols.push(c.r, c.g, c.b);
  }
  if (g !== geom) g.dispose();
}

/**
 * Instanced campus street furniture:
 * - Benches: warm teak wood seat & backrest + cast-iron legs (facing local +Z)
 * - Trash Cans: campus cylindrical dustbins with dark rim & dome hood
 */
export function CampusProps({ items, elevation, castShadow }: PropsMeshProps) {
  const benchRef = useRef<THREE.InstancedMesh>(null);
  const binRef = useRef<THREE.InstancedMesh>(null);

  const benches = useMemo(() => items.filter((p) => p.kind === 'bench'), [items]);
  const bins = useMemo(() => items.filter((p) => p.kind === 'trash_can'), [items]);

  const { benchGeo, binGeo } = useMemo(() => {
    // 1. Bench prototype (~2.3 m wide for architectural legibility)
    const bv: number[] = [];
    const bn: number[] = [];
    const bc: number[] = [];

    const seat = new THREE.BoxGeometry(2.3, 0.14, 0.68);
    seat.translate(0, 0.56, 0.05);
    pushColoredGeom(bv, bn, bc, seat, '#a86838');
    seat.dispose();

    const back = new THREE.BoxGeometry(2.3, 0.52, 0.12);
    back.rotateX(-0.14);
    back.translate(0, 0.92, -0.24);
    pushColoredGeom(bv, bn, bc, back, '#b57340');
    back.dispose();

    for (const lx of [-0.92, 0.92]) {
      const leg = new THREE.BoxGeometry(0.14, 0.58, 0.62);
      leg.translate(lx, 0.29, 0.02);
      pushColoredGeom(bv, bn, bc, leg, '#27272a');
      leg.dispose();
    }

    const bGeo = new THREE.BufferGeometry();
    bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bv, 3));
    bGeo.setAttribute('normal', new THREE.Float32BufferAttribute(bn, 3));
    bGeo.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));

    // 2. Trash Can prototype (distinctive campus dustbin with rim)
    const tv: number[] = [];
    const tn: number[] = [];
    const tc: number[] = [];

    const body = new THREE.CylinderGeometry(0.42, 0.34, 0.98, 6);
    body.translate(0, 0.49, 0);
    pushColoredGeom(tv, tn, tc, body, '#f8fafc'); // tinted per-instance (green / blue / yellow)
    body.dispose();

    const lid = new THREE.CylinderGeometry(0.45, 0.45, 0.14, 6);
    lid.translate(0, 1.03, 0);
    pushColoredGeom(tv, tn, tc, lid, '#27272a');
    lid.dispose();

    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.Float32BufferAttribute(tv, 3));
    tGeo.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3));
    tGeo.setAttribute('color', new THREE.Float32BufferAttribute(tc, 3));

    return { benchGeo: bGeo, binGeo: tGeo };
  }, []);

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    if (benchRef.current && benches.length > 0) {
      benches.forEach((b, i) => {
        const y = sampleElevation(elevation, b.x, b.z);
        dummy.position.set(b.x, y, b.z);
        dummy.rotation.set(0, b.angle, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        benchRef.current!.setMatrixAt(i, dummy.matrix);
      });
      benchRef.current.instanceMatrix.needsUpdate = true;
      benchRef.current.computeBoundingSphere();
    }

    if (binRef.current && bins.length > 0) {
      const binColors = [
        new THREE.Color('#2f855a'), // green biodegradable bin
        new THREE.Color('#2b6cb0'), // blue recyclable bin
        new THREE.Color('#eab308'), // yellow garden bin (like 6th Sense Garden photo!)
      ];
      bins.forEach((t, i) => {
        const y = sampleElevation(elevation, t.x, t.z);
        dummy.position.set(t.x, y, t.z);
        dummy.rotation.set(0, (i * 1.1) % (Math.PI * 2), 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        binRef.current!.setMatrixAt(i, dummy.matrix);
        binRef.current!.setColorAt(i, binColors[i % binColors.length]);
      });
      binRef.current.instanceMatrix.needsUpdate = true;
      if (binRef.current.instanceColor) binRef.current.instanceColor.needsUpdate = true;
      binRef.current.computeBoundingSphere();
    }
  }, [benches, bins, elevation]);

  return (
    <group name="campus-street-props">
      {benches.length > 0 && (
        <instancedMesh
          ref={benchRef}
          args={[benchGeo, undefined, benches.length]}
          castShadow={castShadow}
          receiveShadow={castShadow}
        >
          <meshStandardMaterial vertexColors roughness={0.86} metalness={0.08} flatShading />
        </instancedMesh>
      )}
      {bins.length > 0 && (
        <instancedMesh
          ref={binRef}
          args={[binGeo, undefined, bins.length]}
          castShadow={castShadow}
        >
          <meshStandardMaterial vertexColors roughness={0.78} metalness={0.05} flatShading />
        </instancedMesh>
      )}
    </group>
  );
}
