// /api/logo
//
//   GET   /api/logo  → { data: "data:image/..." | null }
//   POST  /api/logo  → set the logo (body = { data: "data:image/..." })

import { sql, ensureSchema, setCors, readJsonBody } from '../lib/db.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const rows = await sql`SELECT data FROM or_logo WHERE id = 1 LIMIT 1`;
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).json({ data: rows[0]?.data || null });
      return;
    }

    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      await sql`
        INSERT INTO or_logo (id, data, updated_at) VALUES (1, ${body?.data || null}, NOW())
        ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `;
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[api/logo]', e);
    res.status(500).json({ error: e.message || String(e) });
  }
}
