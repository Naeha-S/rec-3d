import { z } from 'zod';
import type { Building, CampusData } from '../types';

const Point2DSchema = z.tuple([z.number().finite(), z.number().finite()]);

const BuildingStyleSchema = z.enum([
  'standard',
  'main_block',
  'shed_hall',
  'pavilion_cafe',
  'open_cafe',
  'sixth_sense_garden',
  'maggi_kiosk',
  'idea_factory',
  'dominos',
  'rec_cafe',
  'b_block',
  'skybridge',
  'steps',
  'arch',
  'monument',
  'fountain',
  'pool_enclosure',
]);

const RawBuildingSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    cat: z.enum(['academic', 'admin', 'hostel', 'service', 'gate', 'sports']),
    polygon: z.array(Point2DSchema).optional(),
    x: z.number().finite().optional(),
    z: z.number().finite().optional(),
    levels: z.number().int().min(1).max(25),
    height_m: z.number().positive().max(120).optional(),
    roof: z.enum(['flat', 'gable', 'shed']),
    style: BuildingStyleSchema.optional(),
    sign_text: z.string().optional(),
    rooms: z.array(z.string()).default([]),
    verified: z.boolean().default(false),
  })
  .superRefine((b, ctx) => {
    if (b.verified && (!b.polygon || b.polygon.length < 3)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['polygon'],
        message: `Verified building "${b.id}" (${b.name}) is missing a valid polygon (>= 3 vertices).`,
      });
    }
  });

const CampusSchema = z.object({
  meta: z.object({
    name: z.string().min(1),
    origin: z.tuple([z.number().finite(), z.number().finite()]),
    north_deg: z.number().finite(),
    units: z.literal('metres'),
    generated: z.string().min(4),
  }),
  buildings: z.array(RawBuildingSchema).min(1),
  paths: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(['road', 'service', 'footway', 'cobblestone']),
      points: z.array(Point2DSchema).min(2),
      width: z.number().positive(),
      slope: z.number().min(0),
      lit: z.boolean(),
    })
  ),
  areas: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(['lawn', 'paved', 'pitch', 'parking', 'water']),
      polygon: z.array(Point2DSchema).min(3),
    })
  ),
  foliage: z.array(
    z.object({
      id: z.string().min(1),
      kind: z.enum(['tree', 'rain_tree', 'palm', 'shrub', 'hedge']),
      x: z.number().finite(),
      z: z.number().finite(),
      radius: z.number().positive(),
      height: z.number().positive(),
      span: z.array(Point2DSchema).optional(),
    })
  ),
  lamps: z.array(
    z.object({
      x: z.number().finite(),
      z: z.number().finite(),
      height: z.number().positive(),
    })
  ),
  props: z
    .array(
      z.object({
        kind: z.enum(['bench', 'trash_can']),
        x: z.number().finite(),
        z: z.number().finite(),
        angle: z.number().finite(),
      })
    )
    .default([]),
  elevation: z
    .object({
      cell: z.number().positive(),
      min: z.number().finite(),
      max: z.number().finite(),
      grid: z.array(z.array(z.number().finite()).min(2)).min(2),
    })
    .superRefine((elev, ctx) => {
      const cols = elev.grid[0].length;
      elev.grid.forEach((row, idx) => {
        if (row.length !== cols) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['grid', idx],
            message: `Elevation grid row ${idx} has ${row.length} columns, expected ${cols}.`,
          });
        }
      });
    }),
});

export class CampusLoadError extends Error {
  public readonly kind: 'not-found' | 'network' | 'validation';
  public readonly details: string[];

  constructor(kind: 'not-found' | 'network' | 'validation', message: string, details: string[] = []) {
    super(message);
    this.name = 'CampusLoadError';
    this.kind = kind;
    this.details = details;
  }
}

function normalizeBuildings(rawBuildings: z.infer<typeof RawBuildingSchema>[]): Building[] {
  return rawBuildings.map((b, idx) => {
    const heightM = b.height_m ?? Number((b.levels * 3.2).toFixed(1));
    const style = b.style ?? 'standard';
    if (b.polygon && b.polygon.length >= 3) {
      return {
        id: b.id,
        name: b.name,
        cat: b.cat,
        polygon: b.polygon,
        levels: b.levels,
        height_m: heightM,
        roof: b.roof,
        style,
        sign_text: b.sign_text,
        rooms: b.rooms,
        verified: b.verified,
      };
    }
    const halfW = 6 + b.levels * 2.2;
    const halfD = 5 + b.levels * 1.6;
    const cx = b.x ?? (idx % 5) * 28;
    const cz = b.z ?? Math.floor(idx / 5) * 28;
    return {
      id: b.id,
      name: b.name,
      cat: b.cat,
      polygon: [
        [cx - halfW, cz - halfD],
        [cx + halfW, cz - halfD],
        [cx + halfW, cz + halfD],
        [cx - halfW, cz + halfD],
      ],
      levels: b.levels,
      height_m: heightM,
      roof: b.roof,
      style,
      sign_text: b.sign_text,
      rooms: b.rooms,
      verified: false,
    };
  });
}

export function validateCampusJson(raw: unknown): CampusData {
  const parsed = CampusSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => {
      const pathStr = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${pathStr}: ${issue.message}`;
    });
    throw new CampusLoadError(
      'validation',
      `campus.json failed data contract validation (${details.length} issue${
        details.length === 1 ? '' : 's'
      }): ${details[0]}`,
      details
    );
  }

  return {
    ...parsed.data,
    buildings: normalizeBuildings(parsed.data.buildings),
  };
}

export async function loadCampusData(
  onProgress?: (fraction: number, stage: string) => void
): Promise<CampusData> {
  const url = `${import.meta.env.BASE_URL}campus.json`;
  onProgress?.(0.08, 'Connecting to campus dataset…');

  let resp: Response;
  try {
    resp = await fetch(url, { cache: 'no-cache' });
  } catch (err) {
    throw new CampusLoadError(
      'network',
      'Unable to reach campus.json. Check your offline cache or connection.',
      [err instanceof Error ? err.message : String(err)]
    );
  }

  if (resp.status === 404) {
    throw new CampusLoadError(
      'not-found',
      `campus.json not found (HTTP 404 at ${url}).`,
      ['Run `python3 scripts/project.py` to generate public/campus.json before serving.']
    );
  }

  if (!resp.ok) {
    throw new CampusLoadError('network', `Failed to load campus.json (HTTP ${resp.status}).`, [
      resp.statusText || `HTTP status ${resp.status}`,
    ]);
  }

  const contentLength = Number(resp.headers.get('content-length') ?? 0);
  let jsonText = '';

  if (resp.body && contentLength > 0) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        jsonText += decoder.decode(value, { stream: true });
        const dlFrac = Math.min(1, received / contentLength);
        onProgress?.(0.1 + dlFrac * 0.62, 'Downloading campus geometry…');
      }
    }
    jsonText += decoder.decode();
  } else {
    onProgress?.(0.45, 'Reading campus geometry…');
    jsonText = await resp.text();
  }

  onProgress?.(0.78, 'Validating schema & building footprints…');
  let rawObj: unknown;
  try {
    rawObj = JSON.parse(jsonText);
  } catch (err) {
    throw new CampusLoadError('validation', 'campus.json is not valid JSON.', [
      err instanceof Error ? err.message : String(err),
    ]);
  }

  const validated = validateCampusJson(rawObj);
  onProgress?.(0.95, 'Constructing 3D architectural model…');
  return validated;
}
