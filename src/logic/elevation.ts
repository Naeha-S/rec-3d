import type { ElevationData } from '../types';

/**
 * Fast bilinear height lookup on the centered 5 m elevation grid.
 * Grid (0,0) in world space sits at the centre of the grid:
 *   x in [-halfW, +halfW], z in [-halfD, +halfD].
 */
export function getElevationBounds(elev: ElevationData) {
  const rows = elev.grid.length;
  const cols = elev.grid[0]?.length ?? 1;
  const width = (cols - 1) * elev.cell;
  const depth = (rows - 1) * elev.cell;
  return {
    rows,
    cols,
    width,
    depth,
    minX: -width * 0.5,
    minZ: -depth * 0.5,
  };
}

export function sampleElevation(elev: ElevationData, x: number, z: number): number {
  const { rows, cols, minX, minZ } = getElevationBounds(elev);
  if (rows < 2 || cols < 2) {
    return elev.grid[0]?.[0] ?? 0;
  }
  const u = Math.max(0, Math.min(cols - 1.0001, (x - minX) / elev.cell));
  const v = Math.max(0, Math.min(rows - 1.0001, (z - minZ) / elev.cell));
  const c0 = Math.floor(u);
  const r0 = Math.floor(v);
  const du = u - c0;
  const dv = v - r0;

  const g = elev.grid;
  const h00 = g[r0][c0];
  const h10 = g[r0][c0 + 1];
  const h01 = g[r0 + 1][c0];
  const h11 = g[r0 + 1][c0 + 1];

  return (
    (1 - du) * (1 - dv) * h00 +
    du * (1 - dv) * h10 +
    (1 - du) * dv * h01 +
    du * dv * h11
  );
}

export function getPolygonCentroid(poly: [number, number][]): [number, number] {
  if (poly.length === 0) return [0, 0];
  let sx = 0;
  let sz = 0;
  for (const [x, z] of poly) {
    sx += x;
    sz += z;
  }
  return [sx / poly.length, sz / poly.length];
}
