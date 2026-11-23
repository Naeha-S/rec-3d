interface StatsPayload {
  type?: 'visit' | 'interaction';
  event?: string;
}

const memoryStore = {
  visits: 0,
  interactions: 0,
  byEvent: {} as Record<string, number>,
};

async function kvCommand(args: (string | number)[]): Promise<unknown> {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { result?: unknown };
  return data.result ?? null;
}

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const hasKV = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

  if (req.method === 'POST') {
    let body: StatsPayload = {};
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    } catch {
      body = {};
    }

    const type = body.type === 'interaction' ? 'interaction' : 'visit';
    const eventName = typeof body.event === 'string' && body.event.trim() ? body.event.trim().slice(0, 64) : null;

    if (hasKV) {
      if (type === 'visit') {
        await kvCommand(['INCR', 'rec3d:visits']);
      } else {
        await kvCommand(['INCR', 'rec3d:interactions']);
        if (eventName) {
          await kvCommand(['HINCRBY', 'rec3d:events', eventName, 1]);
        }
      }
      return res.status(200).json({ ok: true, storage: 'upstash-kv' });
    }

    if (type === 'visit') {
      memoryStore.visits += 1;
    } else {
      memoryStore.interactions += 1;
      if (eventName) {
        memoryStore.byEvent[eventName] = (memoryStore.byEvent[eventName] ?? 0) + 1;
      }
    }
    return res.status(200).json({ ok: true, storage: 'in-memory' });
  }

  if (req.method === 'GET') {
    if (hasKV) {
      const [visitsRaw, interactionsRaw, eventsRaw] = await Promise.all([
        kvCommand(['GET', 'rec3d:visits']),
        kvCommand(['GET', 'rec3d:interactions']),
        kvCommand(['HGETALL', 'rec3d:events']),
      ]);

      const byEvent: Record<string, number> = {};
      if (Array.isArray(eventsRaw)) {
        for (let i = 0; i < eventsRaw.length; i += 2) {
          const k = String(eventsRaw[i]);
          const v = Number(eventsRaw[i + 1]) || 0;
          byEvent[k] = v;
        }
      }

      return res.status(200).json({
        visits: Number(visitsRaw) || 0,
        interactions: Number(interactionsRaw) || 0,
        byEvent,
        storage: 'upstash-kv',
      });
    }

    return res.status(200).json({
      visits: memoryStore.visits,
      interactions: memoryStore.interactions,
      byEvent: memoryStore.byEvent,
      storage: 'in-memory',
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
