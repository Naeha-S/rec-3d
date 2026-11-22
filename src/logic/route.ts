import type { CampusData, RouteResult } from '../types';
import { getPolygonCentroid } from './elevation';

interface GraphEdge {
  to: number;
  length: number;
  weight: number;
}

interface BuildingEntrance {
  nodeIdx: number;
  door: [number, number];
}

interface PathGraph {
  nodes: [number, number][];
  adj: GraphEdge[][];
  buildingEntrances: Map<string, BuildingEntrance[]>;
}

const WALK_SPEED_MPS = 1.35;
const SNAP_TOLERANCE_M = 2.8;
const MULTI_ENTRANCE_RADIUS_M = 7.5;
const MAX_BUILDING_CONNECTOR_M = 36.0;

function edgeCost(length: number, slope: number, lit: boolean): number {
  return length * (1 + 0.4 * Math.abs(slope)) * (lit ? 1.0 : 1.15);
}

function projectPointOnSegment(
  px: number,
  pz: number,
  ax: number,
  az: number,
  bx: number,
  bz: number
): { x: number; z: number; dist: number; t: number } {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-8) {
    return { x: ax, z: az, dist: Math.hypot(px - ax, pz - az), t: 0 };
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  const x = ax + t * dx;
  const z = az + t * dz;
  return { x, z, dist: Math.hypot(px - x, pz - z), t };
}

function closestPointOnPolygon(
  px: number,
  pz: number,
  poly: [number, number][]
): { x: number; z: number; dist: number } {
  let bestX = poly[0][0];
  let bestZ = poly[0][1];
  let bestDist = Infinity;

  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const proj = projectPointOnSegment(px, pz, ax, az, bx, bz);
    if (proj.dist < bestDist) {
      bestDist = proj.dist;
      bestX = proj.x;
      bestZ = proj.z;
    }
  }
  return { x: bestX, z: bestZ, dist: bestDist };
}

export function buildPathGraph(campus: CampusData): PathGraph {
  const nodes: [number, number][] = [];
  const adj: GraphEdge[][] = [];

  function getOrAddNode(x: number, z: number): number {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i][0] - x, nodes[i][1] - z) <= SNAP_TOLERANCE_M) {
        return i;
      }
    }
    const idx = nodes.length;
    nodes.push([x, z]);
    adj.push([]);
    return idx;
  }

  function addUndirectedEdge(u: number, v: number, slope: number, lit: boolean) {
    if (u === v) return;
    const length = Math.hypot(nodes[u][0] - nodes[v][0], nodes[u][1] - nodes[v][1]);
    if (length < 0.05) return;
    const weight = edgeCost(length, slope, lit);
    if (!adj[u].some((e) => e.to === v)) {
      adj[u].push({ to: v, length, weight });
    }
    if (!adj[v].some((e) => e.to === u)) {
      adj[v].push({ to: u, length, weight });
    }
  }

  const rawSegments: { ax: number; az: number; bx: number; bz: number; slope: number; lit: boolean }[] = [];
  for (const p of campus.paths) {
    for (let i = 0; i < p.points.length - 1; i++) {
      const [ax, az] = p.points[i];
      const [bx, bz] = p.points[i + 1];
      getOrAddNode(ax, az);
      getOrAddNode(bx, bz);
      rawSegments.push({ ax, az, bx, bz, slope: p.slope, lit: p.lit });
    }
  }

  for (const seg of rawSegments) {
    const splits: { t: number; x: number; z: number }[] = [
      { t: 0, x: seg.ax, z: seg.az },
      { t: 1, x: seg.bx, z: seg.bz },
    ];
    const segLen = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
    const subCount = Math.max(1, Math.ceil(segLen / 12));
    for (let k = 1; k < subCount; k++) {
      const t = k / subCount;
      splits.push({
        t,
        x: seg.ax + (seg.bx - seg.ax) * t,
        z: seg.az + (seg.bz - seg.az) * t,
      });
    }
    for (const [nx, nz] of nodes) {
      const proj = projectPointOnSegment(nx, nz, seg.ax, seg.az, seg.bx, seg.bz);
      if (proj.t > 0.03 && proj.t < 0.97 && proj.dist <= 3.2) {
        splits.push({ t: proj.t, x: nx, z: nz });
      }
    }
    splits.sort((a, b) => a.t - b.t);
    for (let i = 0; i < splits.length - 1; i++) {
      const u = getOrAddNode(splits[i].x, splits[i].z);
      const v = getOrAddNode(splits[i + 1].x, splits[i + 1].z);
      addUndirectedEdge(u, v, seg.slope, seg.lit);
    }
  }

  const pathNodeCount = nodes.length;
  const buildingEntrances = new Map<string, BuildingEntrance[]>();

  // Find every true perimeter entrance node for each building so multi-wing buildings
  // (like B Block facing Aadhi Statue in front AND the courtyard cobblestone path in back)
  // route directly to whichever entrance faces the origin, without cutting through interiors!
  for (const b of campus.buildings) {
    const nearEntrances: BuildingEntrance[] = [];
    let bestFallback: { nodeIdx: number; door: [number, number]; dist: number } | null = null;

    for (let ni = 0; ni < pathNodeCount; ni++) {
      const [nx, nz] = nodes[ni];
      const closest = closestPointOnPolygon(nx, nz, b.polygon);
      if (closest.dist <= MULTI_ENTRANCE_RADIUS_M) {
        nearEntrances.push({ nodeIdx: ni, door: [closest.x, closest.z] });
      }
      if (closest.dist <= MAX_BUILDING_CONNECTOR_M) {
        if (!bestFallback || closest.dist < bestFallback.dist) {
          bestFallback = { nodeIdx: ni, door: [closest.x, closest.z], dist: closest.dist };
        }
      }
    }

    if (nearEntrances.length > 0) {
      buildingEntrances.set(b.id, nearEntrances);
    } else if (bestFallback) {
      buildingEntrances.set(b.id, [{ nodeIdx: bestFallback.nodeIdx, door: bestFallback.door }]);
    } else {
      const [cx, cz] = getPolygonCentroid(b.polygon);
      let nearestIdx = 0;
      let nearestD = Infinity;
      for (let ni = 0; ni < pathNodeCount; ni++) {
        const d = Math.hypot(nodes[ni][0] - cx, nodes[ni][1] - cz);
        if (d < nearestD) {
          nearestD = d;
          nearestIdx = ni;
        }
      }
      buildingEntrances.set(b.id, [{ nodeIdx: nearestIdx, door: [cx, cz] }]);
    }
  }

  return { nodes, adj, buildingEntrances };
}

export function findRoute(
  graph: PathGraph,
  fromId: string,
  toId: string
): RouteResult {
  const starts = graph.buildingEntrances.get(fromId);
  const goals = graph.buildingEntrances.get(toId);

  if (!starts || starts.length === 0 || !goals || goals.length === 0) {
    return {
      ok: false,
      fromId,
      toId,
      points: [],
      distanceM: 0,
      minutes: 0,
      reason: 'Selected origin or destination is not connected to the path network.',
    };
  }

  if (fromId === toId) {
    return {
      ok: true,
      fromId,
      toId,
      points: [starts[0].door],
      distanceM: 0,
      minutes: 0,
    };
  }

  const goalByNode = new Map<number, [number, number]>();
  for (const g of goals) {
    goalByNode.set(g.nodeIdx, g.door);
  }

  const startDoorByNode = new Map<number, [number, number]>();
  const n = graph.nodes.length;
  const gScore = new Float64Array(n).fill(Infinity);
  const fScore = new Float64Array(n).fill(Infinity);
  const cameFrom = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const openSet = new Set<number>();

  const heuristic = (u: number) => {
    const [ux, uz] = graph.nodes[u];
    let bestH = Infinity;
    for (const g of goals) {
      const d = Math.hypot(ux - g.door[0], uz - g.door[1]);
      if (d < bestH) bestH = d;
    }
    return bestH;
  };

  for (const s of starts) {
    const d0 = Math.hypot(graph.nodes[s.nodeIdx][0] - s.door[0], graph.nodes[s.nodeIdx][1] - s.door[1]);
    if (d0 < gScore[s.nodeIdx]) {
      gScore[s.nodeIdx] = d0;
      fScore[s.nodeIdx] = d0 + heuristic(s.nodeIdx);
      startDoorByNode.set(s.nodeIdx, s.door);
      openSet.add(s.nodeIdx);
    }
  }

  while (openSet.size > 0) {
    let current = -1;
    let bestF = Infinity;
    for (const candidate of openSet) {
      if (fScore[candidate] < bestF) {
        bestF = fScore[candidate];
        current = candidate;
      }
    }
    if (current === -1) break;

    const goalDoor = goalByNode.get(current);
    if (goalDoor) {
      const idxChain: number[] = [];
      let cur = current;
      while (cur !== -1) {
        idxChain.push(cur);
        cur = cameFrom[cur];
      }
      idxChain.reverse();

      const firstNode = idxChain[0];
      const startDoor = startDoorByNode.get(firstNode) ?? graph.nodes[firstNode];
      const points: [number, number][] = [startDoor];
      for (const idx of idxChain) {
        const pt = graph.nodes[idx];
        const prev = points[points.length - 1];
        if (Math.hypot(pt[0] - prev[0], pt[1] - prev[1]) > 0.35) {
          points.push(pt);
        }
      }
      const last = points[points.length - 1];
      if (Math.hypot(goalDoor[0] - last[0], goalDoor[1] - last[1]) > 0.35) {
        points.push(goalDoor);
      }

      let distanceM = 0;
      for (let i = 1; i < points.length; i++) {
        distanceM += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      }

      const minutes = Math.max(1, Math.round(distanceM / WALK_SPEED_MPS / 60));
      return {
        ok: true,
        fromId,
        toId,
        points,
        distanceM: Math.round(distanceM),
        minutes,
      };
    }

    openSet.delete(current);
    closed[current] = 1;

    for (const edge of graph.adj[current]) {
      if (closed[edge.to]) continue;
      const tentative = gScore[current] + edge.weight;
      if (tentative < gScore[edge.to]) {
        cameFrom[edge.to] = current;
        gScore[edge.to] = tentative;
        fScore[edge.to] = tentative + heuristic(edge.to);
        openSet.add(edge.to);
      }
    }
  }

  return {
    ok: false,
    fromId,
    toId,
    points: [],
    distanceM: 0,
    minutes: 0,
    reason: 'No connected pedestrian route found between these two locations.',
  };
}
