// /api/users
//
//   GET    /api/users               → { rows: [...] }
//   POST   /api/users                → upsert one user (body = user object)
//   DELETE /api/users?id=N          → delete one user

import { sql, ensureSchema, setCors, readJsonBody } from '../lib/db.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      const [{ max_ms } = { max_ms: null }] = await sql`
        SELECT (EXTRACT(EPOCH FROM MAX(updated_at)) * 1000)::bigint AS max_ms FROM or_users
      `;
      const maxMs = max_ms != null ? Number(max_ms) : 0;
      const since = req.query.since ? Number(req.query.since) : null;
      if (since != null && maxMs && maxMs <= since) {
        res.setHeader('Cache-Control', 'no-cache');
        res.status(200).json({ rows: null, latest_ms: maxMs, unchanged: true });
        return;
      }
      const rows = await sql`
        SELECT id, name, email, title, permission, status, avatar_color, photo_data
        FROM or_users
        ORDER BY id
      `;
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).json({ rows, latest_ms: maxMs });
      return;
    }

    if (req.method === 'POST') {
      const u = await readJsonBody(req);
      if (!u || !u.id || !u.name) {
        res.status(400).json({ error: 'id and name required' });
        return;
      }
      await sql`
        INSERT INTO or_users (id, name, email, title, permission, status, avatar_color, photo_data, updated_at)
        VALUES (
          ${parseInt(u.id)},
          ${u.name},
          ${u.email || null},
          ${u.title || null},
          ${u.permission || 'basic'},
          ${u.status || 'offline'},
          ${u.avatar_color || 'stone'},
          ${u.photo_data || null},
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          title = EXCLUDED.title,
          permission = EXCLUDED.permission,
          status = EXCLUDED.status,
          avatar_color = EXCLUDED.avatar_color,
          photo_data = EXCLUDED.photo_data,
          updated_at = NOW()
      `;
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) { res.status(400).json({ error: 'id required' }); return; }
      await sql`DELETE FROM or_users WHERE id = ${parseInt(id)}`;
      res.status(200).json({ ok: true, deleted: parseInt(id) });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[api/users]', e);
    res.status(500).json({ error: e.message || String(e) });
  }
}
