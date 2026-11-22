import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type {
  Building,
  BuildingCategory,
  CampusData,
  QualityMode,
  RouteResult,
} from '../types';
import type { LightingState } from '../logic/solar';
import { getPolygonCentroid, sampleElevation } from '../logic/elevation';
import { Ground } from './Ground';
import { Buildings } from './Buildings';
import { Windows } from './Windows';
import { Foliage } from './Foliage';
import { Lamps } from './Lamps';
import { Paths } from './Paths';
import { Sky } from './Sky';
import { PostFX } from './PostFX';
import { CampusProps } from './Props';

export interface FlyRequest {
  seq: number;
  target: [number, number, number];
  distance: number;
  azimuthDeg?: number;
  polarDeg?: number;
}

interface CampusSceneProps {
  campus: CampusData;
  lighting: LightingState;
  quality: QualityMode;
  effectiveQuality: 'low' | 'medium' | 'high';
  reducedMotion: boolean;
  showLabels: boolean;
  selectedId: string | null;
  hoveredBuilding: Building | null;
  activeCategory: BuildingCategory | 'all';
  route: RouteResult | null;
  flyRequest: FlyRequest | null;
  onHover: (building: Building | null, screenPos?: { x: number; y: number }) => void;
  onSelect: (building: Building) => void;
  onClearSelection: () => void;
}

interface CameraControllerProps {
  flyRequest: FlyRequest | null;
  reducedMotion: boolean;
  buildings: Building[];
  elevation: CampusData['elevation'];
  labelRefs: React.MutableRefObject<Map<string, HTMLButtonElement>>;
  showLabels: boolean;
  selectedId: string | null;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function CameraAndLabelSync({
  flyRequest,
  reducedMotion,
  buildings,
  elevation,
  labelRefs,
  showLabels,
  selectedId,
}: CameraControllerProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera, gl, scene } = useThree();

  const animRef = useRef<{
    active: boolean;
    elapsed: number;
    duration: number;
    fromDist: number;
    toDist: number;
    fromAz: number;
    deltaAz: number;
    fromPolar: number;
    toPolar: number;
    fromTarget: THREE.Vector3;
    toTarget: THREE.Vector3;
  }>({
    active: false,
    elapsed: 0,
    duration: 1.2,
    fromDist: 300,
    toDist: 300,
    fromAz: 0,
    deltaAz: 0,
    fromPolar: 0.85,
    toPolar: 0.85,
    fromTarget: new THREE.Vector3(),
    toTarget: new THREE.Vector3(),
  });

  const labelAnchors = useMemo(() => {
    return [...buildings]
      .map((b) => {
        const [cx, rawCz] = getPolygonCentroid(b.polygon);
        const cz =
          b.id === 'workshop-lab-2'
            ? rawCz - 18
            : b.id === 'workshop-lab-1'
            ? rawCz + 18
            : rawCz;
        const y = sampleElevation(elevation, cx, cz) + b.height_m + 3.0;
        const shortLen = b.name.split('·')[0].trim().length;
        return {
          id: b.id,
          vec: new THREE.Vector3(cx, y, cz),
          heightM: b.height_m,
          levels: b.levels,
          cat: b.cat,
          estHalfW: Math.max(26, shortLen * 2.6 + 6),
        };
      })
      .sort((a, b) => b.heightM - a.heightM);
  }, [buildings, elevation]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__REC_RENDER_STATS__ = () => ({
      triangles: gl.info.render.triangles,
      calls: gl.info.render.calls,
      geometries: gl.info.memory.geometries,
      sceneChildren: scene.children.length,
    });
  }, [gl, scene]);

  useEffect(() => {
    if (!flyRequest || !controlsRef.current) return;
    const controls = controlsRef.current;

    const [tx, ty, tz] = flyRequest.target;
    const toTarget = new THREE.Vector3(tx, ty, tz);

    const currentOffset = camera.position.clone().sub(controls.target);
    const fromDist = Math.max(24, currentOffset.length());
    const fromAz = Math.atan2(currentOffset.x, currentOffset.z);
    const fromPolar = Math.acos(THREE.MathUtils.clamp(currentOffset.y / fromDist, -1, 1));

    const toAz =
      flyRequest.azimuthDeg !== undefined
        ? THREE.MathUtils.degToRad(flyRequest.azimuthDeg)
        : fromAz;
    let deltaAz = toAz - fromAz;
    while (deltaAz > Math.PI) deltaAz -= Math.PI * 2;
    while (deltaAz < -Math.PI) deltaAz += Math.PI * 2;

    const toPolar = THREE.MathUtils.degToRad(flyRequest.polarDeg ?? 50);
    const toDist = THREE.MathUtils.clamp(flyRequest.distance, 24, 780);

    if (reducedMotion) {
      const sinP = Math.sin(toPolar);
      camera.position.set(
        tx + toDist * sinP * Math.sin(toAz),
        ty + toDist * Math.cos(toPolar),
        tz + toDist * sinP * Math.cos(toAz)
      );
      controls.target.copy(toTarget);
      controls.update();
      animRef.current.active = false;
      return;
    }

    animRef.current = {
      active: true,
      elapsed: 0,
      duration: 1.2,
      fromDist,
      toDist,
      fromAz,
      deltaAz,
      fromPolar,
      toPolar,
      fromTarget: controls.target.clone(),
      toTarget,
    };
  }, [flyRequest, reducedMotion, camera]);

  const projVec = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (controls) {
      if (animRef.current.active) {
        animRef.current.elapsed += Math.min(delta, 0.05);
        const rawT = Math.min(1, animRef.current.elapsed / animRef.current.duration);
        const eased = easeOutCubic(rawT);

        controls.enableDamping = false;
        controls.target.lerpVectors(animRef.current.fromTarget, animRef.current.toTarget, eased);
        const dist = THREE.MathUtils.lerp(animRef.current.fromDist, animRef.current.toDist, eased);
        const polar = THREE.MathUtils.lerp(animRef.current.fromPolar, animRef.current.toPolar, eased);
        const az = animRef.current.fromAz + animRef.current.deltaAz * eased;
        const sinP = Math.sin(polar);

        camera.position.set(
          controls.target.x + dist * sinP * Math.sin(az),
          controls.target.y + dist * Math.cos(polar),
          controls.target.z + dist * sinP * Math.cos(az)
        );
        controls.update();
        camera.updateMatrixWorld();

        if (rawT >= 1) {
          animRef.current.active = false;
          controls.enableDamping = !reducedMotion;
        }
      } else {
        controls.enableDamping = !reducedMotion;
        controls.target.x = THREE.MathUtils.clamp(controls.target.x, -360, 320);
        controls.target.z = THREE.MathUtils.clamp(controls.target.z, -400, 240);
        controls.target.y = THREE.MathUtils.clamp(controls.target.y, -2, 34);
        controls.update();
        camera.updateMatrixWorld();
      }
    }

    if (!showLabels) return;
    const w = gl.domElement.clientWidth;
    const h = gl.domElement.clientHeight;
    const camPos = camera.position;
    const placedBoxes: [number, number, number, number][] = [];

    const ordered = selectedId
      ? [
          ...labelAnchors.filter((a) => a.id === selectedId),
          ...labelAnchors.filter((a) => a.id !== selectedId),
        ]
      : labelAnchors;

    for (const anchor of ordered) {
      const el = labelRefs.current.get(anchor.id);
      if (!el) continue;

      const isSelected = anchor.id === selectedId;
      const distToCam = camPos.distanceTo(anchor.vec);
      const isMinorKiosk = anchor.heightM <= 4.3 && anchor.cat === 'service';
      if (!isSelected && isMinorKiosk && distToCam > 275) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }

      projVec.copy(anchor.vec).project(camera);
      if (projVec.z > 1 || projVec.z < -1) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }

      const sx = (projVec.x * 0.5 + 0.5) * w;
      const sy = (-projVec.y * 0.5 + 0.5) * h;

      const topSafe = isSelected ? 16 : 64;
      const bottomSafe = isSelected ? h - 20 : h - 92;
      if (sx < 24 || sx > w - 24 || sy < topSafe || sy > bottomSafe) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }

      const x0 = sx - anchor.estHalfW;
      const x1 = sx + anchor.estHalfW;
      const y0 = sy - 20;
      const y1 = sy + 1;

      let collides = false;
      if (!isSelected) {
        for (let i = 0; i < placedBoxes.length; i++) {
          const [bx0, by0, bx1, by1] = placedBoxes[i];
          if (x0 < bx1 && x1 > bx0 && y0 < by1 && y1 > by0) {
            collides = true;
            break;
          }
        }
      }

      if (collides) {
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
        continue;
      }

      placedBoxes.push([x0, y0, x1, y1]);
      el.style.opacity = '1';
      el.style.pointerEvents = 'auto';
      el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enablePan
      screenSpacePanning={false}
      enableDamping={!reducedMotion}
      dampingFactor={0.075}
      minDistance={24}
      maxDistance={780}
      minPolarAngle={0.14}
      maxPolarAngle={Math.PI * 0.475}
      rotateSpeed={0.75}
      panSpeed={0.85}
      zoomSpeed={0.95}
      onStart={() => {
        animRef.current.active = false;
      }}
    />
  );
}

export function CampusScene({
  campus,
  lighting,
  effectiveQuality,
  reducedMotion,
  showLabels,
  selectedId,
  hoveredBuilding,
  activeCategory,
  route,
  flyRequest,
  onHover,
  onSelect,
  onClearSelection,
}: CampusSceneProps) {
  const labelRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const dpr: [number, number] =
    effectiveQuality === 'low' ? [1, 1] : [1, 1.75];
  const shadowsEnabled = effectiveQuality === 'high';

  useEffect(() => {
    document.body.style.cursor = hoveredBuilding ? 'pointer' : 'grab';
    return () => {
      document.body.style.cursor = 'default';
    };
  }, [hoveredBuilding]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <Canvas
        shadows={shadowsEnabled}
        dpr={dpr}
        gl={{
          antialias: effectiveQuality !== 'low',
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          preserveDrawingBuffer: true,
        }}
        camera={{
          fov: 44,
          near: 1.5,
          far: 2400,
          position: [28, 220, 265],
        }}
        onPointerMissed={() => onClearSelection()}
      >
        <Sky lighting={lighting} shadowsEnabled={shadowsEnabled} />

        <Ground
          elevation={campus.elevation}
          areas={campus.areas}
          paths={campus.paths}
          receiveShadow={shadowsEnabled}
        />

        <Paths
          paths={campus.paths}
          elevation={campus.elevation}
          route={route}
        />

        <Buildings
          buildings={campus.buildings}
          elevation={campus.elevation}
          selectedId={selectedId}
          hoveredId={hoveredBuilding?.id ?? null}
          activeCategory={activeCategory}
          castShadow={shadowsEnabled}
          nightFactor={lighting.nightFactor}
          onHover={onHover}
          onSelect={onSelect}
        />

        <Windows
          buildings={campus.buildings}
          elevation={campus.elevation}
          nightFactor={lighting.nightFactor}
        />

        <Foliage
          foliage={campus.foliage}
          elevation={campus.elevation}
          castShadow={shadowsEnabled}
        />

        <Lamps
          lamps={campus.lamps}
          elevation={campus.elevation}
          nightFactor={lighting.nightFactor}
          lowQuality={effectiveQuality === 'low'}
        />

        <CampusProps
          items={campus.props}
          elevation={campus.elevation}
          castShadow={shadowsEnabled}
        />

        <CameraAndLabelSync
          flyRequest={flyRequest}
          reducedMotion={reducedMotion}
          buildings={campus.buildings}
          elevation={campus.elevation}
          labelRefs={labelRefs}
          showLabels={showLabels}
          selectedId={selectedId}
        />

        {effectiveQuality !== 'low' && (
          <PostFX effectiveQuality={effectiveQuality} nightFactor={lighting.nightFactor} />
        )}
      </Canvas>

      {showLabels && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden z-10"
        >
          {campus.buildings.map((b) => {
            if (b.id === 'white-stairs') return null;
            const isSelected = selectedId === b.id;
            const isDimmed = activeCategory !== 'all' && b.cat !== activeCategory;
            if (isDimmed && !isSelected) return null;

            const shortLabel = b.name.split('·')[0].trim();
            return (
              <button
                key={b.id}
                type="button"
                tabIndex={-1}
                ref={(el) => {
                  if (el) labelRefs.current.set(b.id, el);
                  else labelRefs.current.delete(b.id);
                }}
                onClick={() => onSelect(b)}
                style={{ opacity: 0, left: 0, top: 0 }}
                className={`absolute select-none whitespace-nowrap rounded-[3px] px-1.5 py-0.5 text-[10.5px] font-medium tracking-tight border shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-colors ${
                  isSelected
                    ? 'bg-zinc-900 text-white border-zinc-950 z-20'
                    : !b.verified
                    ? 'bg-zinc-200/85 text-zinc-500 border-zinc-400/40 italic'
                    : 'bg-[#fafaf9]/92 text-zinc-800 border-zinc-900/14 hover:bg-white'
                }`}
              >
                {shortLabel}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
