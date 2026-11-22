export type BuildingCategory = 'academic' | 'admin' | 'hostel' | 'service' | 'gate' | 'sports';
export type RoofKind = 'flat' | 'gable' | 'shed';
export type BuildingStyle =
  | 'standard'
  | 'main_block'
  | 'shed_hall'
  | 'pavilion_cafe'
  | 'open_cafe'
  | 'sixth_sense_garden'
  | 'maggi_kiosk'
  | 'idea_factory'
  | 'dominos'
  | 'rec_cafe'
  | 'b_block'
  | 'skybridge'
  | 'steps'
  | 'arch'
  | 'monument'
  | 'fountain'
  | 'pool_enclosure';
export type PathKind = 'road' | 'service' | 'footway' | 'cobblestone';
export type PropKind = 'bench' | 'trash_can';
export type AreaKind = 'lawn' | 'paved' | 'pitch' | 'parking' | 'water';
export type FoliageKind = 'tree' | 'rain_tree' | 'palm' | 'shrub' | 'hedge';
export type QualityMode = 'auto' | 'low' | 'high';

export interface CampusMeta {
  name: string;
  origin: [number, number]; // [lon, lat]
  north_deg: number;
  units: 'metres';
  generated: string;
}

export interface Building {
  id: string;
  name: string;
  cat: BuildingCategory;
  polygon: [number, number][];
  levels: number;
  height_m: number;
  roof: RoofKind;
  style: BuildingStyle;
  sign_text?: string;
  rooms: string[];
  verified: boolean;
}

export interface CampusPath {
  id: string;
  kind: PathKind;
  points: [number, number][];
  width: number;
  slope: number;
  lit: boolean;
}

export interface CampusArea {
  id: string;
  kind: AreaKind;
  polygon: [number, number][];
}

export interface FoliageItem {
  id: string;
  kind: FoliageKind;
  x: number;
  z: number;
  radius: number;
  height: number;
  span?: [number, number][];
}

export interface LampItem {
  x: number;
  z: number;
  height: number;
}

export interface CampusPropItem {
  kind: PropKind;
  x: number;
  z: number;
  angle: number;
}

export interface ElevationData {
  cell: number;
  min: number;
  max: number;
  grid: number[][];
}

export interface CampusData {
  meta: CampusMeta;
  buildings: Building[];
  paths: CampusPath[];
  areas: CampusArea[];
  foliage: FoliageItem[];
  lamps: LampItem[];
  props: CampusPropItem[];
  elevation: ElevationData;
}

export interface SearchHit {
  kind: 'building' | 'room';
  building: Building;
  matchedRoom?: string;
  score: number;
}

export interface RouteResult {
  ok: boolean;
  fromId: string;
  toId: string;
  points: [number, number][];
  distanceM: number;
  minutes: number;
  reason?: string;
}

export interface TourStop {
  index: number;
  buildingId: string;
  title: string;
  badge: string;
  summary: string;
  tip: string;
  distance?: number;
  azimuthDeg?: number;
}
