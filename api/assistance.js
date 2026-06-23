// /api/assistance
//
//   GET    /api/assistance               → { rows: [...] }   (active only)
//   POST   /api/assistance                → insert one offer  (body = { user_id, user_name, message })
//   DELETE /api/assistance?id=N          → mark resolved

import { sql, ensureSchema, setCors, readJsonBody } from '../lib/db.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const [{ max_ms } = { max_ms: null }] = await sql`
        SELECT (EXTRACT(EPOCH FROM MAX(GREATEST(created_at, COALESCE(resolved_at, created_at)))) * 1000)::bigint AS max_ms FROM or_assistance
      `;
      const maxMs = max_ms != null ? Number(max_ms) : 0;
      const since = req.query.since ? Number(req.query.since) : null;
      if (since != null && maxMs && maxMs <= since) {
        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).json({ rows: null, latest_ms: maxMs, unchanged: true });
        return;
      }
      const rows = await sql`
        SELECT id, user_id, user_name, message,
               created_at::text AS created_at
        FROM or_assistance
        WHERE resolved = FALSE
        ORDER BY created_at DESC
        LIMIT 200
      `;
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).json({ rows, latest_ms: maxMs });
      return;
    }

    if (req.method === 'POST') {
      const a = await readJsonBody(req);
      const row = await sql`
        INSERT INTO or_assistance (user_id, user_name, message)
        VALUES (
          ${a.user_id != null ? parseInt(a.user_id) : null},
          ${a.user_name || null},
          ${a.message || null}
        )
        RETURNING id
      `;
      res.status(200).json({ ok: true, id: row[0]?.id });
      return;
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) { res.status(400).json({ error: 'id required' }); return; }
      await sql`UPDATE or_assistance SET resolved = TRUE, resolved_at = NOW() WHERE id = ${parseInt(id)}`;
      res.status(200).json({ ok: true, resolved: parseInt(id) });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[api/assistance]', e);
    res.status(500).json({ error: e.message || String(e) });
  }
}
