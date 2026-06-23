// /api/checkins
//
//   GET    /api/checkins              → { rows: [...] }   (supports If-Modified-Since)
//   POST   /api/checkins               → insert one check-in (body = checkin object)
//   DELETE /api/checkins?id=N         → delete one check-in row

import { sql, ensureSchema, setCors, readJsonBody } from '../lib/db.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const [{ max_ts } = { max_ts: null }] = await sql`
        SELECT MAX(created_at)::text AS max_ts FROM or_checkins
      `;
      const ims = req.headers['if-modified-since'];
      if (ims && max_ts && new Date(ims).getTime() >= new Date(max_ts).getTime()) {
        res.status(304).end();
        return;
      }
      const rows = await sql`
        SELECT id, user_id, user_name,
               timestamp::text AS timestamp,
               is_on_time, pt_date
        FROM or_checkins
        ORDER BY timestamp DESC
        LIMIT 5000
      `;
      if (max_ts) res.setHeader('Last-Modified', new Date(max_ts).toUTCString());
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).json({ rows });
      return;
    }

    if (req.method === 'POST') {
      const c = await readJsonBody(req);
      if (!c || !c.timestamp) {
        res.status(400).json({ error: 'timestamp required' });
        return;
      }
      const userId = c.user_id != null ? parseInt(c.user_id) : null;
      const row = await sql`
        INSERT INTO or_checkins (user_id, user_name, timestamp, is_on_time, pt_date)
        VALUES (
          ${userId},
          ${c.user_name || null},
          ${c.timestamp},
          ${c.is_on_time === undefined ? null : !!c.is_on_time},
          ${c.pt_date || null}
        )
        RETURNING id
      `;
      res.status(200).json({ ok: true, id: row[0]?.id });
      return;
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) { res.status(400).json({ error: 'id required' }); return; }
      await sql`DELETE FROM or_checkins WHERE id = ${parseInt(id)}`;
      res.status(200).json({ ok: true, deleted: parseInt(id) });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[api/checkins]', e);
    res.status(500).json({ error: e.message || String(e) });
  }
}
