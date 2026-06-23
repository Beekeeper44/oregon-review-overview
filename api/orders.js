// /api/orders
//
//   GET    /api/orders                      → { rows: [...], latest_updated_at: "..." }
//                                             Supports If-Modified-Since header for cheap 304s.
//   POST   /api/orders                      → upsert one row (body = row object)
//   DELETE /api/orders?id=ROW_ID            → delete one row
//   DELETE /api/orders?all=1                → delete every row (Reset button)

import { sql, ensureSchema, setCors, readJsonBody } from '../lib/db.js';

export default async function handler(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  try {
    await ensureSchema();

    if (req.method === 'GET') {
      // Find the most recent update — used for change detection on the client
      const [{ max_ts } = { max_ts: null }] = await sql`
        SELECT MAX(updated_at)::text AS max_ts FROM or_orders
      `;

      // If client sent If-Modified-Since and nothing has changed since then,
      // return 304 to skip the body payload. This cuts polling cost dramatically.
      const ims = req.headers['if-modified-since'];
      if (ims && max_ts && new Date(ims).getTime() >= new Date(max_ts).getTime()) {
        res.status(304).end();
        return;
      }

      const rows = await sql`
        SELECT id, order_num, released, bin, bin_color,
               reviewer_user_id, reviewer_name, total_cards, reviewed_cards,
               notes, start_time, end_time, break_time, created_at,
               updated_at::text AS updated_at
        FROM or_orders
        ORDER BY created_at DESC NULLS LAST
        LIMIT 2000
      `;
      if (max_ts) res.setHeader('Last-Modified', new Date(max_ts).toUTCString());
      res.setHeader('Cache-Control', 'no-cache');
      res.status(200).json({ rows, latest_updated_at: max_ts });
      return;
    }

    if (req.method === 'POST') {
      const row = await readJsonBody(req);
      if (!row || !row.id) {
        res.status(400).json({ error: 'row.id required' });
        return;
      }
      // Coerce numeric fields — clients sometimes send strings
      const totalCards = row.total_cards != null && row.total_cards !== '' ? parseInt(row.total_cards) : null;
      const reviewedCards = row.reviewed_cards != null && row.reviewed_cards !== '' ? parseInt(row.reviewed_cards) : null;
      const reviewerUserId = row.reviewer_user_id != null && row.reviewer_user_id !== '' ? parseInt(row.reviewer_user_id) : null;
      const createdAt = row.created_at != null ? Number(row.created_at) : Date.now();

      await sql`
        INSERT INTO or_orders (
          id, order_num, released, bin, bin_color,
          reviewer_user_id, reviewer_name, total_cards, reviewed_cards,
          notes, start_time, end_time, break_time, created_at, updated_at
        ) VALUES (
          ${String(row.id)},
          ${row.order_num || null},
          ${!!row.released},
          ${row.bin || null},
          ${row.bin_color || 'none'},
          ${reviewerUserId},
          ${row.reviewer_name || null},
          ${totalCards},
          ${reviewedCards},
          ${row.notes || null},
          ${row.start_time || null},
          ${row.end_time || null},
          ${row.break_time || '0'},
          ${createdAt},
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          order_num = EXCLUDED.order_num,
          released = EXCLUDED.released,
          bin = EXCLUDED.bin,
          bin_color = EXCLUDED.bin_color,
          reviewer_user_id = EXCLUDED.reviewer_user_id,
          reviewer_name = EXCLUDED.reviewer_name,
          total_cards = EXCLUDED.total_cards,
          reviewed_cards = EXCLUDED.reviewed_cards,
          notes = EXCLUDED.notes,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          break_time = EXCLUDED.break_time,
          updated_at = NOW()
      `;
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'DELETE') {
      if (req.query.all === '1' || req.query.all === 'true') {
        await sql`DELETE FROM or_orders`;
        res.status(200).json({ ok: true, deleted: 'all' });
        return;
      }
      const id = req.query.id;
      if (!id) { res.status(400).json({ error: 'id required' }); return; }
      await sql`DELETE FROM or_orders WHERE id = ${String(id)}`;
      res.status(200).json({ ok: true, deleted: id });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error('[api/orders]', e);
    res.status(500).json({ error: e.message || String(e) });
  }
}
