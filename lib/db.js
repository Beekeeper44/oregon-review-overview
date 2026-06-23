// Shared Neon Postgres client + one-time table bootstrap.
//
// Every API route imports `sql` from here. The first call to any route
// runs `ensureSchema()` which CREATEs the five tables if they don't
// already exist. No manual SQL needed in the Neon dashboard.
//
// Env var required:
//   POSTGRES_URL — the Neon "pooled" connection string

import { neon } from '@neondatabase/serverless';

if (!process.env.POSTGRES_URL) {
  console.warn('[db] POSTGRES_URL is not set — database calls will fail');
}

export const sql = neon(process.env.POSTGRES_URL || '');

let schemaReady = null;
export async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    // users — same shape as Supabase users table
    await sql`
      CREATE TABLE IF NOT EXISTS or_users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        title TEXT,
        permission TEXT DEFAULT 'basic',
        status TEXT DEFAULT 'offline',
        avatar_color TEXT DEFAULT 'stone',
        photo_data TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // orders — one row per sheet row
    await sql`
      CREATE TABLE IF NOT EXISTS or_orders (
        id TEXT PRIMARY KEY,
        order_num TEXT,
        released BOOLEAN DEFAULT FALSE,
        bin TEXT,
        bin_color TEXT DEFAULT 'none',
        reviewer_user_id INTEGER,
        reviewer_name TEXT,
        total_cards INTEGER,
        reviewed_cards INTEGER,
        notes TEXT,
        start_time TEXT,
        end_time TEXT,
        break_time TEXT DEFAULT '0',
        created_at BIGINT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS or_orders_created_idx ON or_orders (created_at DESC)`;

    // check_ins
    await sql`
      CREATE TABLE IF NOT EXISTS or_checkins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        user_name TEXT,
        timestamp TIMESTAMPTZ NOT NULL,
        is_on_time BOOLEAN,
        pt_date TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS or_checkins_ts_idx ON or_checkins (timestamp DESC)`;

    // logo — single-row table keyed on id=1
    await sql`
      CREATE TABLE IF NOT EXISTS or_logo (
        id INTEGER PRIMARY KEY,
        data TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // assistance requests — graders can flag they need help
    await sql`
      CREATE TABLE IF NOT EXISTS or_assistance (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        user_name TEXT,
        message TEXT,
        resolved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS or_assistance_active_idx ON or_assistance (resolved, created_at DESC)`;

    return true;
  })();
  return schemaReady;
}

// Common helpers
export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, If-Modified-Since');
}

export async function readJsonBody(req) {
  if (req.body) {
    // Vercel parses JSON automatically when Content-Type is application/json
    if (typeof req.body === 'object') return req.body;
    if (typeof req.body === 'string') {
      try { return JSON.parse(req.body); } catch (e) { return {}; }
    }
  }
  // Fallback: read stream
  return await new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { resolve({}); }
    });
  });
}
