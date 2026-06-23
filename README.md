# OR Review

Arena Club's Oregon Review worksheet — Vercel + Neon Postgres deployment.

This is the **public** version: no sign-in required, anyone with the link can use it. Designed for internal use only — don't share the URL outside Arena Club.

## Architecture

- **Frontend**: single static page at `/public/index.html` (was previously the Supabase-backed `orders.html`)
- **Backend**: Vercel serverless functions in `/api/*` that talk to a Neon Postgres database
- **Live sync**: 1-second polling with `If-Modified-Since` headers so unchanged data returns `304 Not Modified` (cheap)

## Required environment variable

In Vercel project settings → Environment Variables, add:

| Name | Value |
|---|---|
| `POSTGRES_URL` | Your Neon **pooled** connection string. Looks like `postgresql://<user>:<pass>@<host>-pooler.<region>.aws.neon.tech/<db>?sslmode=require` |

Get this from your Neon dashboard → your project → Connection Details → **Pooled connection** checkbox is on → copy.

## API routes

| Route | Methods | Purpose |
|---|---|---|
| `/api/orders` | GET, POST, DELETE | Sheet rows. GET supports `If-Modified-Since`. `DELETE ?all=1` clears everything. |
| `/api/checkins` | GET, POST, DELETE | Daily check-ins. GET supports `If-Modified-Since`. |
| `/api/users` | GET, POST, DELETE | Team member records. GET supports `If-Modified-Since`. |
| `/api/logo` | GET, POST | Single-row logo image (base64). |
| `/api/assistance` | GET, POST, DELETE | Open assistance requests. `DELETE` marks resolved. |

## Database tables

All tables are auto-created on first API call — no manual SQL needed.

- `or_users` — team members
- `or_orders` — sheet rows
- `or_checkins` — daily check-ins
- `or_logo` — single-row logo storage (id=1)
- `or_assistance` — assistance offers

## Cost notes

1-second polling at scale: with ~10 graders open all day, expect
~250k+ DB queries per day. Neon free tier (190 compute-hours/month)
will run out fast — plan to upgrade to **Neon Launch ($19/mo)**.
Vercel Hobby is 100k invocations/day which may also exceed; plan
for **Vercel Pro ($20/mo)** if needed.

If costs become an issue, change the polling interval in
`public/index.html` — search for `1000)` in `startBackgroundPolling`,
`startCheckinPolling`, `startAssistancePolling` and bump to `3000` or
`5000`.

## Deploying

This repo follows the same pattern as `orders-check`. Upload to GitHub via the web UI, connect Vercel to the repo, set `POSTGRES_URL`, and deploy.
