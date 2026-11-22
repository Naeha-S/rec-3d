import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

interface PostFXProps {
  effectiveQuality: 'low' | 'medium' | 'high';
  nightFactor: number;
}

/**
 * Architectural-model EffectComposer + UnrealBloomPass pipeline scaled by detected quality:
 * - 'low': Disabled (component returns null; R3F renders directly at native speed)
 * - 'medium': 0.5x bloom buffer, 0x MSAA target for smooth mid-range mobile FPS
 * - 'high': 0.85x bloom buffer + 4x MSAA HalfFloat render target for crisp architectural edges
 */
export function PostFX({ effectiveQuality, nightFactor }: PostFXProps) {
  const { gl, scene, camera, size } = useThree();

  const { composer, bloomPass } = useMemo(() => {
    const pixelRatio = gl.getPixelRatio();
    const rtWidth = Math.max(1, Math.floor(size.width * pixelRatio));
    const rtHeight = Math.max(1, Math.floor(size.height * pixelRatio));

    const maxSamples = gl.capabilities.maxSamples ?? 0;
    const samples = effectiveQuality === 'high' ? Math.min(4, maxSamples) : 0;

    const renderTarget = new THREE.WebGLRenderTarget(rtWidth, rtHeight, {
      type: THREE.HalfFloatType,
      samples,
    });

    const effectComposer = new EffectComposer(gl, renderTarget);
    effectComposer.setPixelRatio(pixelRatio);
    effectComposer.setSize(size.width, size.height);

    const renderPass = new RenderPass(scene, camera);
    effectComposer.addPass(renderPass);

    const bloomScale = effectiveQuality === 'high' ? 0.85 : 0.5;
    const bloomRes = new THREE.Vector2(
      Math.max(64, Math.floor(size.width * bloomScale)),
      Math.max(64, Math.floor(size.height * bloomScale))
    );
    // Subtle architectural sun-glint by day; warm window/lamp/signage glow at night
    const unrealBloom = new UnrealBloomPass(bloomRes, 0.2, 0.42, 0.86);
    effectComposer.addPass(unrealBloom);

    const outputPass = new OutputPass();
    effectComposer.addPass(outputPass);

    return { composer: effectComposer, bloomPass: unrealBloom };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, effectiveQuality]);

  useEffect(() => {
    const pixelRatio = gl.getPixelRatio();
    composer.setPixelRatio(pixelRatio);
    composer.setSize(size.width, size.height);
    const bloomScale = effectiveQuality === 'high' ? 0.85 : 0.5;
    bloomPass.resolution.set(
      Math.max(64, Math.floor(size.width * bloomScale)),
      Math.max(64, Math.floor(size.height * bloomScale))
    );
  }, [composer, bloomPass, gl, size.width, size.height, effectiveQuality]);

  // Modulate bloom threshold/strength smoothly between daylight architectural sheen & night glow
  useEffect(() => {
    const qualityMult = effectiveQuality === 'high' ? 1.0 : 0.78;
    bloomPass.strength = (0.17 + nightFactor * 0.34) * qualityMult;
    bloomPass.radius = 0.38 + nightFactor * 0.18;
    bloomPass.threshold = 0.88 - nightFactor * 0.28;
  }, [bloomPass, nightFactor, effectiveQuality]);

  useEffect(() => {
    gl.info.autoReset = false;
    return () => {
      gl.info.autoReset = true;
      composer.dispose();
    };
  }, [composer, gl]);

  useFrame((_, delta) => {
    gl.info.reset();
    composer.render(delta);
  }, 1);

  return null;
}
