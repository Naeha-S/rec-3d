import type { Building, SearchHit } from '../types';

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMatch(haystackNorm: string, queryNorm: string, tokens: string[]): number {
  if (!queryNorm) return 0;
  if (haystackNorm === queryNorm) return 120;
  if (haystackNorm.startsWith(queryNorm)) return 95;
  if (haystackNorm.includes(` ${queryNorm}`)) return 85;
  if (haystackNorm.includes(queryNorm)) return 72;

  let matchedTokens = 0;
  let score = 0;
  const words = haystackNorm.split(' ');
  for (const tok of tokens) {
    if (words.some((w) => w === tok)) {
      matchedTokens++;
      score += 28;
    } else if (words.some((w) => w.startsWith(tok))) {
      matchedTokens++;
      score += 20;
    } else if (haystackNorm.includes(tok)) {
      matchedTokens++;
      score += 12;
    }
  }

  return matchedTokens === tokens.length ? score : 0;
}

export function searchCampus(buildings: Building[], rawQuery: string, limit = 10): SearchHit[] {
  const queryNorm = normalize(rawQuery);
  if (!queryNorm) return [];
  const tokens = queryNorm.split(' ').filter(Boolean);

  const hits: SearchHit[] = [];

  for (const building of buildings) {
    const bNorm = normalize(`${building.name} ${building.id} ${building.cat}`);
    const bScore = scoreMatch(bNorm, queryNorm, tokens);

    let bestRoom: string | undefined;
    let bestRoomScore = 0;
    for (const room of building.rooms) {
      const rNorm = normalize(room);
      const combinedNorm = `${rNorm} ${bNorm}`;
      const directRoomScore = scoreMatch(rNorm, queryNorm, tokens);
      const crossScore = directRoomScore > 0 ? directRoomScore + 8 : scoreMatch(combinedNorm, queryNorm, tokens);
      if (crossScore > bestRoomScore) {
        bestRoomScore = crossScore;
        bestRoom = room;
      }
    }

    if (bestRoomScore > bScore && bestRoom) {
      hits.push({
        kind: 'room',
        building,
        matchedRoom: bestRoom,
        score: bestRoomScore,
      });
    } else if (bScore > 0) {
      hits.push({
        kind: 'building',
        building,
        score: bScore,
      });
    }
  }

  hits.sort((a, b) => b.score - a.score || a.building.name.localeCompare(b.building.name));
  return hits.slice(0, limit);
}
