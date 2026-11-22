import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import type { LightingState } from '../logic/solar';

interface SkyProps {
  lighting: LightingState;
  shadowsEnabled: boolean;
}

const SKY_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  varying vec3 vWorldPos;
  void main() {
    float h = clamp(normalize(vWorldPos).y, 0.0, 1.0);
    float curve = pow(h, 0.58);
    vec3 col = mix(uHorizon, uZenith, curve);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * PLAN.md §5.1: "One directional sun + hemisphere fill. Sun from a solar formula at campus
 * lat/lon, slider 5→23 h, nine interpolated keyframes for sky, sun colour, intensity,
 * ambient, exposure. Night: emissive ramp, lamps on, stars as Points. Shadows at high
 * quality only, 1024, tight ortho frustum."
 */
export function Sky({ lighting, shadowsEnabled }: SkyProps) {
  const { gl, scene } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null);

  const skyUniforms = useMemo(
    () => ({
      uZenith: { value: new THREE.Color(lighting.skyZenith) },
      uHorizon: { value: new THREE.Color(lighting.skyHorizon) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Sync tone mapping exposure & scene fog smoothly
  useEffect(() => {
    gl.toneMappingExposure = lighting.exposure;
    skyUniforms.uZenith.value.set(lighting.skyZenith);
    skyUniforms.uHorizon.value.set(lighting.skyHorizon);
    if (scene.fog instanceof THREE.Fog) {
      scene.fog.color.set(lighting.fogColor);
    }
  }, [gl, scene, lighting, skyUniforms]);

  // Deterministic hemispherical starfield as THREE.Points
  const starGeo = useMemo(() => {
    const count = 550;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = ((i * 73 + 19) % count) / count;
      const v = (Math.sin(i * 12.9898) * 0.5 + 0.5) * 0.86 + 0.12;
      const theta = u * Math.PI * 2 + i * 2.39996;
      const phi = Math.acos(v);
      const r = 880;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  return (
    <group name="campus-sky-and-lights">
      <fog attach="fog" args={[lighting.fogColor, 460, 1280]} />

      {/* Sky dome */}
      <mesh scale={[1050, 1050, 1050]}>
        <sphereGeometry args={[1, 20, 14]} />
        <shaderMaterial
          side={THREE.BackSide}
          depthWrite={false}
          uniforms={skyUniforms}
          vertexShader={SKY_VERTEX_SHADER}
          fragmentShader={SKY_FRAGMENT_SHADER}
        />
      </mesh>

      {/* Stars as THREE.Points at night */}
      {lighting.starOpacity > 0.02 && (
        <points geometry={starGeo}>
          <pointsMaterial
            color="#e2e8f0"
            size={2.4}
            sizeAttenuation={false}
            transparent
            opacity={lighting.starOpacity}
            depthWrite={false}
          />
        </points>
      )}

      {/* Hemisphere ambient fill */}
      <hemisphereLight
        args={[lighting.hemiSkyColor, lighting.hemiGroundColor, lighting.hemiIntensity]}
      />

      {/* Directional sun with tight 1024 ortho shadow frustum at high quality only */}
      <directionalLight
        ref={sunRef}
        position={lighting.sunPosition}
        color={lighting.sunColor}
        intensity={lighting.sunIntensity}
        castShadow={shadowsEnabled}
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-near={40}
        shadow-camera-far={760}
        shadow-camera-left={-275}
        shadow-camera-right={275}
        shadow-camera-top={265}
        shadow-camera-bottom={-265}
        shadow-bias={-0.0006}
      />
    </group>
  );
}
