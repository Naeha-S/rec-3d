import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { ElevationData, LampItem } from '../types';
import { sampleElevation } from '../logic/elevation';

interface LampsProps {
  lamps: LampItem[];
  elevation: ElevationData;
  nightFactor: number;
  lowQuality: boolean;
}

/**
 * PLAN.md §5.1: "Lamps: post + emissive head, PointLight on every third, no shadows."
 */
export function Lamps({ lamps, elevation, nightFactor, lowQuality }: LampsProps) {
  const postRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);

  const { postGeo, headGeo, lampWorldCoords } = useMemo(() => {
    const pGeo = new THREE.CylinderGeometry(0.11, 0.16, 1.0, 6, 1, true);
    pGeo.translate(0, 0.5, 0);

    const hGeo = new THREE.IcosahedronGeometry(0.42, 0);

    const coords = lamps.map((l) => {
      const groundY = sampleElevation(elevation, l.x, l.z);
      return { x: l.x, groundY, topY: groundY + l.height, z: l.z, height: l.height };
    });

    return { postGeo: pGeo, headGeo: hGeo, lampWorldCoords: coords };
  }, [lamps, elevation]);

  useEffect(() => {
    const dummy = new THREE.Object3D();
    if (postRef.current && headRef.current) {
      lampWorldCoords.forEach((c, idx) => {
        dummy.position.set(c.x, c.groundY - 0.1, c.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, c.height, 1);
        dummy.updateMatrix();
        postRef.current!.setMatrixAt(idx, dummy.matrix);

        dummy.position.set(c.x, c.topY, c.z);
        dummy.scale.set(1, 0.75, 1);
        dummy.updateMatrix();
        headRef.current!.setMatrixAt(idx, dummy.matrix);
      });
      postRef.current.instanceMatrix.needsUpdate = true;
      headRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [lampWorldCoords]);

  const pointLightCoords = useMemo(() => {
    // PointLight on every third lamp
    const stride = lowQuality ? 6 : 3;
    return lampWorldCoords.filter((_, idx) => idx % stride === 0);
  }, [lampWorldCoords, lowQuality]);

  const lampsActive = nightFactor > 0.15;

  return (
    <group name="campus-lamps-group">
      {lamps.length > 0 && (
        <>
          <instancedMesh ref={postRef} args={[postGeo, undefined, lamps.length]}>
            <meshStandardMaterial color="#475569" roughness={0.65} metalness={0.35} flatShading />
          </instancedMesh>

          <instancedMesh ref={headRef} args={[headGeo, undefined, lamps.length]}>
            <meshStandardMaterial
              color={lampsActive ? '#fff3c4' : '#dce4ea'}
              emissive="#ffcf70"
              emissiveIntensity={lampsActive ? 0.6 + nightFactor * 2.4 : 0.04}
              roughness={0.3}
            />
          </instancedMesh>
        </>
      )}

      {lampsActive &&
        pointLightCoords.map((c, i) => (
          <pointLight
            key={i}
            position={[c.x, c.topY - 0.3, c.z]}
            color="#ffcb7d"
            intensity={nightFactor * 16}
            distance={44}
            decay={2}
            castShadow={false}
          />
        ))}
    </group>
  );
}
