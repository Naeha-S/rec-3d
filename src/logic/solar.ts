import * as THREE from 'three';

export interface LightingState {
  hour: number;
  sunDirection: [number, number, number];
  sunPosition: [number, number, number];
  sunAltitudeDeg: number;
  sunAzimuthDeg: number;
  skyZenith: string;
  skyHorizon: string;
  fogColor: string;
  sunColor: string;
  sunIntensity: number;
  hemiSkyColor: string;
  hemiGroundColor: string;
  hemiIntensity: number;
  exposure: number;
  nightFactor: number;
  starOpacity: number;
}

interface Keyframe {
  h: number;
  skyZenith: string;
  skyHorizon: string;
  fogColor: string;
  sunColor: string;
  sunIntensity: number;
  hemiSkyColor: string;
  hemiGroundColor: string;
  hemiIntensity: number;
  exposure: number;
  nightFactor: number;
  starOpacity: number;
}

/**
 * Nine interpolated lighting keyframes from 05:00 to 23:00 (PLAN.md §5.1).
 * Carefully balanced for ACESFilmicToneMapping so Dawn, Noon, Golden Hour,
 * and Night render with crisp contrast and zero exposure blowout.
 */
const KEYFRAMES: Keyframe[] = [
  {
    h: 5.0,
    skyZenith: '#0b162c',
    skyHorizon: '#1c2f4a',
    fogColor: '#192942',
    sunColor: '#6f8ec4',
    sunIntensity: 0.14,
    hemiSkyColor: '#36537d',
    hemiGroundColor: '#1a2421',
    hemiIntensity: 0.42,
    exposure: 0.95,
    nightFactor: 0.92,
    starOpacity: 0.85,
  },
  {
    h: 6.25, // Dawn
    skyZenith: '#355c8a',
    skyHorizon: '#f2b085',
    fogColor: '#dfbaa2',
    sunColor: '#ffae73',
    sunIntensity: 1.05,
    hemiSkyColor: '#9dbbd9',
    hemiGroundColor: '#566353',
    hemiIntensity: 0.62,
    exposure: 0.94,
    nightFactor: 0.35,
    starOpacity: 0.12,
  },
  {
    h: 7.75, // Early Morning
    skyZenith: '#4b86be',
    skyHorizon: '#d7e9f2',
    fogColor: '#d5e5ec',
    sunColor: '#ffe3bd',
    sunIntensity: 1.55,
    hemiSkyColor: '#cbe3f5',
    hemiGroundColor: '#6d7f69',
    hemiIntensity: 0.72,
    exposure: 0.92,
    nightFactor: 0.04,
    starOpacity: 0.0,
  },
  {
    h: 10.0, // Mid-Morning
    skyZenith: '#3f82c4',
    skyHorizon: '#cce6f4',
    fogColor: '#d2e6f0',
    sunColor: '#fff5e4',
    sunIntensity: 1.85,
    hemiSkyColor: '#d9eefc',
    hemiGroundColor: '#788b73',
    hemiIntensity: 0.78,
    exposure: 0.88,
    nightFactor: 0.0,
    starOpacity: 0.0,
  },
  {
    h: 12.5, // Noon (calibrated against blowout)
    skyZenith: '#387cc2',
    skyHorizon: '#cde7f5',
    fogColor: '#d4e9f3',
    sunColor: '#fffaf0',
    sunIntensity: 1.92,
    hemiSkyColor: '#e2f2fc',
    hemiGroundColor: '#7e9178',
    hemiIntensity: 0.8,
    exposure: 0.84,
    nightFactor: 0.0,
    starOpacity: 0.0,
  },
  {
    h: 15.5, // Afternoon
    skyZenith: '#4180be',
    skyHorizon: '#d9e8ef',
    fogColor: '#dce8ed',
    sunColor: '#ffeed2',
    sunIntensity: 1.72,
    hemiSkyColor: '#d4e8f7',
    hemiGroundColor: '#76876f',
    hemiIntensity: 0.74,
    exposure: 0.88,
    nightFactor: 0.0,
    starOpacity: 0.0,
  },
  {
    h: 17.4, // Golden Hour / Dusk
    skyZenith: '#385785',
    skyHorizon: '#f29e6d',
    fogColor: '#dfb094',
    sunColor: '#ff9857',
    sunIntensity: 1.18,
    hemiSkyColor: '#a9b9d4',
    hemiGroundColor: '#586153',
    hemiIntensity: 0.62,
    exposure: 0.94,
    nightFactor: 0.42,
    starOpacity: 0.15,
  },
  {
    h: 18.6, // Civil/Nautical Twilight
    skyZenith: '#162747',
    skyHorizon: '#4c597d',
    fogColor: '#283652',
    sunColor: '#7d94c7',
    sunIntensity: 0.22,
    hemiSkyColor: '#4a6491',
    hemiGroundColor: '#242f2b',
    hemiIntensity: 0.48,
    exposure: 0.98,
    nightFactor: 0.88,
    starOpacity: 0.72,
  },
  {
    h: 23.0, // Deep Night
    skyZenith: '#081122',
    skyHorizon: '#162640',
    fogColor: '#121f35',
    sunColor: '#6b88bd',
    sunIntensity: 0.14,
    hemiSkyColor: '#35507a',
    hemiGroundColor: '#1b2421',
    hemiIntensity: 0.42,
    exposure: 1.0,
    nightFactor: 1.0,
    starOpacity: 1.0,
  },
];

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();

function lerpHex(a: string, b: string, t: number): string {
  _c1.set(a);
  _c2.set(b);
  _c1.lerp(_c2, t);
  return `#${_c1.getHexString()}`;
}

function lerpNum(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Spencer/NOAA solar position formula at campus [lon, lat] in IST (UTC+5:30).
 * Coordinate convention: +X = East, -Z = North, +Y = Up.
 */
export function computeLightingState(
  hourInput: number,
  originLonLat: [number, number],
  dateStr = '2026-11-22'
): LightingState {
  const hour = Math.max(5, Math.min(23, hourInput));
  const [lonDeg, latDeg] = originLonLat;

  // Day of year from generated date (fallback DOY 326 = Nov 22)
  let doy = 326;
  const parsed = Date.parse(dateStr);
  if (!Number.isNaN(parsed)) {
    const dt = new Date(parsed);
    const start = new Date(Date.UTC(dt.getUTCFullYear(), 0, 0));
    doy = Math.floor((dt.getTime() - start.getTime()) / 86_400_000);
  }

  const gamma = ((2 * Math.PI) / 365) * (doy - 1 + (hour - 12) / 24);
  const eqTimeMin =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const declRad =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const tzOffsetHours = 5.5; // Asia/Kolkata (IST)
  const timeOffsetMin = eqTimeMin + 4 * lonDeg - 60 * tzOffsetHours;
  const trueSolarMin = hour * 60 + timeOffsetMin;
  const hourAngleRad = THREE.MathUtils.degToRad(trueSolarMin / 4 - 180);
  const latRad = THREE.MathUtils.degToRad(latDeg);

  const sinAlt =
    Math.sin(latRad) * Math.sin(declRad) +
    Math.cos(latRad) * Math.cos(declRad) * Math.cos(hourAngleRad);
  const altRad = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

  // Azimuth measured clockwise from North (0 = North = -Z, 90 = East = +X)
  const yAz = -Math.sin(hourAngleRad) * Math.cos(declRad);
  const xAz =
    Math.sin(declRad) * Math.cos(latRad) -
    Math.cos(declRad) * Math.sin(latRad) * Math.cos(hourAngleRad);
  let azRad = Math.atan2(yAz, xAz);
  if (azRad < 0) azRad += Math.PI * 2;

  // At night, keep a gentle elevated moon-fill direction so terrain relief stays readable
  const effectiveAlt = altRad > 0.06 ? altRad : THREE.MathUtils.degToRad(34);
  const effectiveAz = altRad > 0.06 ? azRad : THREE.MathUtils.degToRad(142);

  const cosAlt = Math.cos(effectiveAlt);
  const dx = Math.sin(effectiveAz) * cosAlt; // East (+X)
  const dy = Math.sin(effectiveAlt); // Up (+Y)
  const dz = -Math.cos(effectiveAz) * cosAlt; // North is -Z
  const sunDist = 340;

  // Find bounding keyframes
  let k0 = KEYFRAMES[0];
  let k1 = KEYFRAMES[KEYFRAMES.length - 1];
  for (let i = 0; i < KEYFRAMES.length - 1; i++) {
    if (hour >= KEYFRAMES[i].h && hour <= KEYFRAMES[i + 1].h) {
      k0 = KEYFRAMES[i];
      k1 = KEYFRAMES[i + 1];
      break;
    }
  }
  const span = Math.max(0.001, k1.h - k0.h);
  const rawT = Math.max(0, Math.min(1, (hour - k0.h) / span));
  // Smoothstep for natural transitions
  const t = rawT * rawT * (3 - 2 * rawT);

  return {
    hour,
    sunDirection: [dx, dy, dz],
    sunPosition: [dx * sunDist, dy * sunDist, dz * sunDist],
    sunAltitudeDeg: THREE.MathUtils.radToDeg(altRad),
    sunAzimuthDeg: THREE.MathUtils.radToDeg(azRad),
    skyZenith: lerpHex(k0.skyZenith, k1.skyZenith, t),
    skyHorizon: lerpHex(k0.skyHorizon, k1.skyHorizon, t),
    fogColor: lerpHex(k0.fogColor, k1.fogColor, t),
    sunColor: lerpHex(k0.sunColor, k1.sunColor, t),
    sunIntensity: lerpNum(k0.sunIntensity, k1.sunIntensity, t),
    hemiSkyColor: lerpHex(k0.hemiSkyColor, k1.hemiSkyColor, t),
    hemiGroundColor: lerpHex(k0.hemiGroundColor, k1.hemiGroundColor, t),
    hemiIntensity: lerpNum(k0.hemiIntensity, k1.hemiIntensity, t),
    exposure: lerpNum(k0.exposure, k1.exposure, t),
    nightFactor: lerpNum(k0.nightFactor, k1.nightFactor, t),
    starOpacity: lerpNum(k0.starOpacity, k1.starOpacity, t),
  };
}

export function formatHourLabel(hour: number): string {
  const whole = Math.floor(hour);
  const mins = Math.round((hour - whole) * 60);
  const hh = mins === 60 ? whole + 1 : whole;
  const mm = mins === 60 ? 0 : mins;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
