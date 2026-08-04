'use strict';

/**
 * Creative Copyz — demo persistence
 * Replaces the in-memory demoRecords / agentIdToSlug / agentCallCounts objects.
 *
 * Railway: add a Postgres service, DATABASE_URL is injected automatically.
 * Install: npm i pg
 */

const { Pool } = require('pg');

const CONN = process.env.DATABASE_URL || '';

const pool = new Pool({
  connectionString: CONN,
  // Railway internal networking needs no SSL. The public proxy URL does.
  ssl: CONN.includes('railway.internal') ? false : { rejectUnauthorized: false },
  max: 5,
});

const DEMO_LIFE_DAYS = Number(process.env.DEMO_LIFE_DAYS || 7);

// ─── Schema ──────────────────────────────────────────────────────────────────
// Railway's private network takes a moment to come up after a container starts,
// so the first query can fail even when everything is configured correctly.
// Retry with backoff before giving up, otherwise a healthy setup crash-loops.
async function init(attempt = 1) {
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    if (attempt >= 8) throw e;
    console.log(`[db] not ready (${e.code || e.message}), retry ${attempt}/8`);
    await new Promise(r => setTimeout(r, 1000 * attempt));
    return init(attempt + 1);
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS demos (
      slug            TEXT PRIMARY KEY,
      agent_id        TEXT NOT NULL,
      llm_id          TEXT,
      niche           TEXT NOT NULL,
      business_name   TEXT NOT NULL,
      city            TEXT,
      tagline         TEXT,
      core_services   TEXT,
      primary_color   TEXT,
      secondary_color TEXT,
      calls_used      INTEGER     NOT NULL DEFAULT 0,
      max_calls       INTEGER     NOT NULL DEFAULT 5,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ NOT NULL,
      agent_deleted_at TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS demos_agent_id_idx ON demos (agent_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demos_expiry_idx   ON demos (expires_at);`);
  console.log('[db] schema ready');
}

// ─── Slug availability (used by generateSlug) ────────────────────────────────
async function slugTaken(slug) {
  const { rowCount } = await pool.query('SELECT 1 FROM demos WHERE slug = $1', [slug]);
  return rowCount > 0;
}

// ─── Create ──────────────────────────────────────────────────────────────────
async function createDemo(d) {
  const { rows } = await pool.query(
    `INSERT INTO demos
       (slug, agent_id, llm_id, niche, business_name, city, tagline,
        core_services, primary_color, secondary_color, max_calls, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + ($12 || ' days')::interval)
     RETURNING *`,
    [
      d.slug, d.agentId, d.llmId, d.niche, d.businessName, d.city, d.tagline,
      d.coreServices || '', d.primaryColor || '', d.secondaryColor || '',
      d.maxCalls || 5, String(DEMO_LIFE_DAYS),
    ]
  );
  return rows[0];
}

// ─── Read ────────────────────────────────────────────────────────────────────
// Returns null if the slug was never issued.
// Returns { ...row, expired: true } if it exists but has run out of time.
async function getBySlug(slug) {
  const { rows } = await pool.query(
    `SELECT *, (expires_at <= now()) AS expired FROM demos WHERE slug = $1`,
    [slug]
  );
  return rows[0] || null;
}

// ─── Atomic call reservation ─────────────────────────────────────────────────
// Increments only if the demo is live and under the cap, in a single statement.
// Two simultaneous clicks cannot both slip through.
async function reserveCall(agentId) {
  const { rows } = await pool.query(
    `UPDATE demos
        SET calls_used = calls_used + 1
      WHERE agent_id = $1
        AND expires_at > now()
        AND calls_used < max_calls
      RETURNING slug, calls_used, max_calls`,
    [agentId]
  );

  if (rows[0]) return { ok: true, ...rows[0] };

  // Nothing updated. Work out why, so the client gets an accurate message.
  const { rows: check } = await pool.query(
    `SELECT calls_used, max_calls, (expires_at <= now()) AS expired
       FROM demos WHERE agent_id = $1`,
    [agentId]
  );
  if (!check[0])         return { ok: false, reason: 'not_found' };
  if (check[0].expired)  return { ok: false, reason: 'expired' };
  return { ok: false, reason: 'limit_reached', ...check[0] };
}

// Give the call back if Retell rejects it, so a server error does not burn one of the five.
async function releaseCall(agentId) {
  await pool.query(
    `UPDATE demos SET calls_used = GREATEST(calls_used - 1, 0) WHERE agent_id = $1`,
    [agentId]
  );
}

// ─── Cleanup support ─────────────────────────────────────────────────────────
async function listExpiredUndeleted(limit = 50) {
  const { rows } = await pool.query(
    `SELECT slug, agent_id, llm_id
       FROM demos
      WHERE expires_at <= now()
        AND agent_deleted_at IS NULL
      ORDER BY expires_at ASC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

async function markAgentDeleted(slug) {
  await pool.query(`UPDATE demos SET agent_deleted_at = now() WHERE slug = $1`, [slug]);
}

// ─── Stats ───────────────────────────────────────────────────────────────────
async function stats() {
  const { rows } = await pool.query(`
    SELECT
      count(*)                                              AS total,
      count(*) FILTER (WHERE expires_at > now())            AS live,
      count(*) FILTER (WHERE calls_used > 0)                AS called,
      coalesce(sum(calls_used), 0)                          AS calls_total
    FROM demos
  `);
  return rows[0];
}

module.exports = {
  init, slugTaken, createDemo, getBySlug,
  reserveCall, releaseCall,
  listExpiredUndeleted, markAgentDeleted, stats,
  pool,
};
