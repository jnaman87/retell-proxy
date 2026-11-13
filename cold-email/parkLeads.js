'use strict';

/**
 * One-time "park": takes every lead that is part-way through the COLD sequence
 * (has had at least email 1, has not replied) out of it, so it gets no more
 * follow-ups. Leads still waiting for email 1 stay queued as new leads.
 *
 *   status        -> 'parked' (the send loop never picks it up)
 *   GHL           -> deal moved to the "Caught in warmups (To be re-targeted later)"
 *                    stage. No tags are added.
 *
 * Parked leads are still watched by the reply detector: if one replies to an
 * earlier email, it is handled like any other reply.
 * Warm / ultra-warm (demo) leads and leads in a conversation are not touched.
 */

const pool = require('./pool');
const { findOpportunity, moveOpportunity, OT_PIPELINE } = require('./crmHelpers');

const CRM_API = 'https://services.leadconnectorhq.com';
const CRM_API_KEY = process.env.CRM_API_KEY;
const LOCATION_ID = process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';
const STAGE_NAME = /caught\s+in\s+warm-?ups?/i;

const TO_PARK = `phase = 'cold' AND status IN ('active', 'awaiting_no_reply') AND step > 0 AND conv_status IS NULL`;

const progress = { running: false, total: 0, done: 0, moved: 0, noDeal: 0, errors: 0, startedAt: null, finishedAt: null };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function findStage() {
  const r = await fetch(`${CRM_API}/opportunities/pipelines?locationId=${encodeURIComponent(LOCATION_ID)}`, {
    headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28', Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`GHL pipelines request failed (${r.status})`);
  const data = await r.json();
  const pipe = (data.pipelines || []).find(p => p.id === OT_PIPELINE);
  if (!pipe) return null;
  const stage = (pipe.stages || []).find(s => STAGE_NAME.test(s.name || ''));
  return stage ? { id: stage.id, name: stage.name, pipeline: pipe.name } : null;
}

// Moves every parked lead's deal in GHL. Safe to run again.
async function syncGhl(stage) {
  const { rows } = await pool.query(
    `SELECT id, contact_id, prospect_email FROM enrollments WHERE status = 'parked' AND contact_id IS NOT NULL ORDER BY id`);
  Object.assign(progress, { running: true, total: rows.length, done: 0, moved: 0, noDeal: 0, errors: 0,
    startedAt: new Date().toISOString(), finishedAt: null });
  for (const e of rows) {
    try {
      const opp = await findOpportunity(e.contact_id, OT_PIPELINE);
      if (opp && opp.id) {
        if (opp.pipelineStageId !== stage.id) await moveOpportunity(opp.id, stage.id);
        progress.moved++;
      } else {
        progress.noDeal++;
      }
    } catch (err) {
      progress.errors++;
      console.error(`[park] ${e.prospect_email}: ${err.message}`);
    }
    progress.done++;
    await sleep(300);   // stays well under GHL's rate limit
  }
  progress.running = false;
  progress.finishedAt = new Date().toISOString();
  console.log(`[park] GHL done: ${progress.moved} deals moved, ${progress.noDeal} without a deal, ${progress.errors} errors`);
}

async function parkLeads({ confirm }){
  const stage = await findStage();
  const { rows: byStep } = await pool.query(
    `SELECT step, status, count(*)::int AS leads FROM enrollments WHERE ${TO_PARK} GROUP BY 1, 2 ORDER BY 1, 2`);
  const toPark = byStep.reduce((n, r) => n + r.leads, 0);
  const { rows: [{ n: stayNew }] } = await pool.query(
    `SELECT count(*)::int AS n FROM enrollments WHERE phase = 'cold' AND status = 'active' AND step = 0`);
  const { rows: [{ n: alreadyParked }] } = await pool.query(
    `SELECT count(*)::int AS n FROM enrollments WHERE status = 'parked'`);

  const summary = {
    stage: stage || 'NOT FOUND: create a stage named "Caught in warmups (To be re-targeted later)" in the Outbound pipeline',
    willPark: toPark, byStep, alreadyParked,
    staysAsNewLeads: stayNew,
    ghlSync: progress,
  };
  if (!confirm) return { dryRun: true, note: 'Nothing changed. Add &confirm=yes to park these leads.', ...summary };
  if (!stage) return { error: 'Stage not found, nothing changed.', ...summary };
  if (progress.running) return { error: 'A GHL sync is already running. Reload without confirm to watch progress.', ...summary };

  const { rowCount } = await pool.query(
    `UPDATE enrollments SET status = 'parked', next_send_at = NULL WHERE ${TO_PARK}`);
  console.log(`[park] ${rowCount} leads parked`);
  syncGhl(stage).catch(err => { progress.running = false; console.error('[park] GHL sync failed:', err.message); });
  return { parkedNow: rowCount, note: 'Leads parked. GHL stage moves are running in the background; reload this link without confirm to watch progress.', ...summary, alreadyParked: alreadyParked + rowCount };
}

module.exports = { parkLeads };
