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
      contact_id      TEXT,
      calls_used      INTEGER     NOT NULL DEFAULT 0,
      max_calls       INTEGER     NOT NULL DEFAULT 5,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at      TIMESTAMPTZ NOT NULL,
      agent_deleted_at TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS demos_agent_id_idx ON demos (agent_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS demos_expiry_idx   ON demos (expires_at);`);
  await pool.query(`ALTER TABLE demos ADD COLUMN IF NOT EXISTS contact_id TEXT`)
  .catch(e => console.warn('[db] contact_id migration skipped:', e.message));
  await pool.query(`ALTER TABLE demos ADD COLUMN IF NOT EXISTS secondary_color TEXT`)
  .catch(e => console.warn('[db] secondary_color migration skipped:', e.message));
  await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS phase TEXT DEFAULT 'cold'`).catch(e => console.warn('[db] phase migration skipped:', e.message));
  await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS core_services TEXT`).catch(e => console.warn('[db] core_services migration skipped:', e.message));
  await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS tagline TEXT`).catch(e => console.warn('[db] tagline migration skipped:', e.message));
  await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS primary_color TEXT`).catch(e => console.warn('[db] primary_color migration skipped:', e.message));
  await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS secondary_color TEXT`).catch(e => console.warn('[db] secondary_color migration skipped:', e.message));
  await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS caller_faqs TEXT`).catch(e => console.warn('[db] caller_faqs migration skipped:', e.message));
    await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS conversation_history JSONB DEFAULT '[]'::jsonb`).catch(e => console.warn('[db] conversation_history migration skipped:', e.message));
  await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS conv_status TEXT`).catch(e => console.warn('[db] conv_status migration skipped:', e.message));
  await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS calendar_sent_at TIMESTAMPTZ`).catch(e => console.warn('[db] calendar_sent_at migration skipped:', e.message));
  await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS last_conv_at TIMESTAMPTZ`).catch(e => console.warn('[db] last_conv_at migration skipped:', e.message));
  await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS conv_followup_at TIMESTAMPTZ`).catch(e => console.warn('[db] conv_followup_at migration skipped:', e.message));
  await pool.query(
  `ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS ultra_warm_pending_at TIMESTAMPTZ`
).catch(e => console.warn('[db] ultra_warm_pending_at migration skipped:', e.message));
  console.log('[db] schema ready');
  await pool.query(
  `ALTER TABLE enrollments
   ADD COLUMN IF NOT EXISTS positive_reply_at TIMESTAMPTZ`
).catch(e => console.warn('[db] positive_reply_at migration skipped:', e.message));

await pool.query(
  `ALTER TABLE enrollments
   ADD COLUMN IF NOT EXISTS demo_tested_at TIMESTAMPTZ`
).catch(e => console.warn('[db] demo_tested_at migration skipped:', e.message));

  // AI reply pipeline + human handoff
  for (const col of [
    'last_inbound_message_id TEXT',
    'last_inbound_at BIGINT',
    'handoff_at TIMESTAMPTZ',
    'handoff_reason TEXT',
  ]) {
    await pool.query(`ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS ${col}`)
      .catch(e => console.warn(`[db] ${col} migration skipped:`, e.message));
  }

}

// ─── Slug availability (used by generateSlug) ────────────────────────────────
async function slugTaken(slug) {
  const { rowCount } = await pool.query('SELECT 1 FROM demos WHERE slug = $1', [slug]);
  return rowCount > 0;
}

// ─── Create ──────────────────────────────────────────────────────────────────
async function createDemo(d) {
  const expiresAt = new Date(Date.now() + DEMO_LIFE_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    `INSERT INTO demos
       (slug, agent_id, llm_id, niche, business_name, city, tagline,
        core_services, primary_color, secondary_color, contact_id, max_calls, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      d.slug,
      d.agentId,
      d.llmId,
      d.niche,
      d.businessName,
      d.city,
      d.tagline,
      d.coreServices   || '',
      d.primaryColor   || '',
      d.secondaryColor || '',
      d.contactId      || null,
      d.maxCalls       || 5,
      expiresAt,
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
// ─── Read by agent ID (used by /retell-tools/request-followup) ───────────────
async function getByAgentId(agentId) {
  const { rows } = await pool.query(
    `SELECT *, (expires_at <= now()) AS expired FROM demos WHERE agent_id = $1`,
    [agentId]
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
  init, slugTaken, createDemo, getBySlug, getByAgentId,
  reserveCall, releaseCall,
  listExpiredUndeleted, markAgentDeleted, stats,
  pool, enroll,
};


async function enroll({
  contactId,
  email,
  name,
  city,
  tz,
  niche,
  companyName,
  hook,
  pain,
  services,
  tagline,
  callerFaqs,
  primaryColor,
  secondaryColor
}) {
  const existing = await pool.query(
    `SELECT id
       FROM enrollments
      WHERE prospect_email = $1
        AND status NOT IN ('completed', 'unsubscribed', 'bounced')`,
    [email]
  );

  if (existing.rows.length > 0) {
    return {
      duplicate: true,
      enrollmentId: existing.rows[0].id
    };
  }

  const result = await pool.query(
    `INSERT INTO enrollments
      (
        contact_id,
        prospect_email,
        prospect_name,
        prospect_city,
        prospect_tz,
        niche,
        company_name,
        personalisation_hook,
        current_pain,
        core_services,
        tagline,
        caller_faqs,
        primary_color,
        secondary_color,
        phase,
        step,
        status,
        next_send_at,
        enrolled_at,
        conversation_history
      )
     VALUES
      (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        'cold', 0, 'active', NOW(), NOW(), '[]'::jsonb
      )
     RETURNING id`,
    [
      contactId,
      email,
      name,
      city,
      tz,
      niche,
      companyName,
      hook,
      pain,
      services,
      tagline,
      callerFaqs,
      primaryColor,
      secondaryColor
    ]
  );

  return {
    duplicate: false,
    enrollmentId: result.rows[0].id
  };
}
