// /api/users
//
//   GET    /api/users                     → { rows: [...active users], deleted: [{id,name,email}], latest_ms }
//   GET    /api/users?photo=ID            → { photo_data } for one user (used to repair oversized photos)
//   POST   /api/users                     → upsert one user (body = user object)
//                                            Writes for a deleted user are ignored unless body.restore === true
//                                            (only "Add User" sends restore, so stale laptops can't resurrect anyone).
//   DELETE /api/users?id=N[&email=E]      → soft-delete one user (tombstone)
//
// Deletes are soft (deleted = TRUE + updated_at bump) so the change shows up in
// MAX(updated_at) and every polling laptop picks it up.

import { sql, ensureSchema, setCors, readJsonBody } from '../lib/db.js';

const norm = (v) => (v == null ? '' : String(v)).trim().toLowerCase();

// Photos are compressed in the browser to ~20 KB. Anything bigger than this is a
// legacy full-size upload: it is left out of the list response (Vercel caps
// responses at 4.5 MB, so a few of these break the whole user list) and served
// one at a time via GET ?photo=ID so the client can shrink and re-save it.
const LIST_PHOTO_MAX = 300 * 1024;
const WRITE_PHOTO_MAX = 1024 * 1024;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    await ensureSchema();

    if (req.method === 'GET' && req.query.photo) {
      const rows = await sql`SELECT photo_data FROM or_users WHERE id = ${parseInt(req.query.photo)}`;
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).json({ photo_data: rows[0] ? rows[0].photo_data : null });
      return;
    }

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
        SELECT id, name, email, title, permission, status, avatar_color,
               CASE WHEN LENGTH(photo_data) > ${LIST_PHOTO_MAX} THEN NULL ELSE photo_data END AS photo_data,
               (LENGTH(photo_data) > ${LIST_PHOTO_MAX}) AS photo_too_big
        FROM or_users
        WHERE deleted IS NOT TRUE
        ORDER BY id
      `;
      const deleted = await sql`
        SELECT id, name, email FROM or_users WHERE deleted IS TRUE
      `;
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).json({ rows, deleted, latest_ms: maxMs });
      return;
    }

    if (req.method === 'POST') {
      const u = await readJsonBody(req);
      if (!u || !u.id || !u.name) {
        res.status(400).json({ error: 'id and name required' });
        return;
      }
      if (u.photo_data && String(u.photo_data).length > WRITE_PHOTO_MAX) {
        res.status(413).json({ error: 'photo too large — resize before saving' });
        return;
      }
      const id = parseInt(u.id);
      const email = norm(u.email);
      const name = norm(u.name);

      if (u.restore === true) {
        // Explicit add/re-add: clear any tombstones for this person first.
        await sql`
          DELETE FROM or_users
          WHERE deleted IS TRUE
            AND (id = ${id}
                 OR (${email} <> '' AND LOWER(email) = ${email})
                 OR LOWER(name) = ${name})
        `;
      } else {
        // Normal sync write: never resurrect a deleted user.
        const hit = await sql`
          SELECT 1 FROM or_users
          WHERE deleted IS TRUE
            AND (id = ${id}
                 OR (${email} <> '' AND LOWER(email) = ${email})
                 OR LOWER(name) = ${name})
          LIMIT 1
        `;
        if (hit.length) {
          res.status(200).json({ ok: true, skipped: 'deleted' });
          return;
        }
      }

      await sql`
        INSERT INTO or_users (id, name, email, title, permission, status, avatar_color, photo_data, deleted, updated_at)
        VALUES (
          ${id},
          ${u.name},
          ${u.email || null},
          ${u.title || null},
          ${u.permission || 'basic'},
          ${u.status || 'offline'},
          ${u.avatar_color || 'stone'},
          ${u.photo_data || null},
          FALSE,
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          email = EXCLUDED.email,
          title = EXCLUDED.title,
          permission = EXCLUDED.permission,
          status = EXCLUDED.status,
          avatar_color = EXCLUDED.avatar_color,
          -- Never blank a stored photo with an empty sync write; only an explicit
          -- "Remove photo" (clear_photo) can clear it.
          photo_data = CASE WHEN ${u.clear_photo === true} THEN NULL
                            ELSE COALESCE(EXCLUDED.photo_data, or_users.photo_data) END,
          deleted = FALSE,
          updated_at = NOW()
      `;
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      const id = req.query.id ? parseInt(req.query.id) : null;
      const email = norm(req.query.email);
      if (!id && !email) { res.status(400).json({ error: 'id or email required' }); return; }
      await sql`
        UPDATE or_users
        SET deleted = TRUE, status = 'offline', updated_at = NOW()
        WHERE (${id}::int IS NOT NULL AND id = ${id})
           OR (${email} <> '' AND LOWER(email) = ${email})
      `;
      res.status(200).json({ ok: true, deleted: id || email });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[api/users]', e);
    res.status(500).json({ error: e.message || String(e) });
  }
}
