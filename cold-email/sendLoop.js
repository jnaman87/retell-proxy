'use strict';
const pool          = require('./pool');
const { sendEmail } = require('./gmail-sender');
const { sendConvFollowUp } = require('./conversationHandler');
const SEQUENCES     = require('./sequence');

// ─── Mailbox personas ──────────────────────────────────────────
const MAILBOX_PERSONAS = {
  'anne@ccopyz.com'           : { fullName: 'Anne Schull',    title: 'Director of Client Solutions' },
  'billy@ccopyz.com'   : { fullName: 'Billy Cooper',   title: 'Business Development Manager' },
  'caitlyn@ccopyz.com' : { fullName: 'Caitlyn Smoke',  title: 'Account Executive' },
  'claire@creativecopyz.org'   : { fullName: 'Claire Dunphy',  title: 'Partnership Manager' },
  'clint@creativecopyz.org'          : { fullName: 'Clint Mac',      title: 'Head of Business Development' },
  'emily@creativecopyz.org'    : { fullName: 'Emily Hathway',  title: 'Client Success Manager' },
  'glenn@ccopyz.org'          : { fullName: 'Glenn Ponting',  title: 'AI Solutions Director' },
  'hailey@ccopyz.org'   : { fullName: 'Hailey Henz',    title: 'Account Manager' },
  'harry@ccopyz.net'          : { fullName: 'Harry Garrold',  title: 'Business Development Executive' },
  'helen@ccopyz.org'          : { fullName: 'Helen Morgan',   title: 'Director of Partnerships' },
  'james@ccopyz.net'   : { fullName: 'James Walkway',  title: 'Head of AI Outreach' },
  'josh@ccopyz.net'           : { fullName: 'Josh Walker',    title: 'Account Executive' },
  'joshua@cretivecopyz.com'  : { fullName: 'Joshua Speed',   title: 'Business Development Lead' },
  'justin@cretivecopyz.com'         : { fullName: 'Justin Albus',   title: 'Director of Sales' },
  'mike@cretivecopyz.com'           : { fullName: 'Mike Ten',       title: 'Senior Account Manager' },
  'phil@creativecopyz.net'    : { fullName: 'Phil Jazz',      title: 'Partnership Director' },
  'samuel@creativecopyz.net'         : { fullName: 'Samuel Borne',   title: 'AI Solutions Advisor' },
  'vanessa@creativecopyz.net' : { fullName: 'Vanessa Cruz',   title: 'Client Relations Manager' },
};

function getPersona(mailbox) {
  return MAILBOX_PERSONAS[mailbox] || { fullName: 'Creative Copyz Team', title: 'Account Manager' };
}

async function tagContact(contactId, tag) {
  const CRM_API = 'https://services.leadconnectorhq.com';
  const CRM_API_KEY = process.env.CRM_API_KEY;

  const res = await fetch(`${CRM_API}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${CRM_API_KEY}`,
      Version: '2021-04-15',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tags: [tag] }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`CRM tag failed (${res.status}): ${text}`);
  }
}

async function moveToDemoTested(enrollment) {
  const CRM_API = 'https://services.leadconnectorhq.com';
  const CRM_API_KEY = process.env.CRM_API_KEY;
  const LOCATION_ID = process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';

  // AI Voice Receptionist Conversions pipeline
  const PIPELINE_ID = 'Sv3XlTtCmzbGrHrZ3BFL';

  // Demo Tested stage
  const STAGE_DEMO_TESTED = '1a42d192-dc15-4dd0-bd68-f7fef2842dd0';

  const searchRes = await fetch(
    `${CRM_API}/opportunities/search?location_id=${LOCATION_ID}&contact_id=${encodeURIComponent(enrollment.contact_id)}&pipeline_id=${PIPELINE_ID}`,
    {
      headers: {
        Authorization: `Bearer ${CRM_API_KEY}`,
        Version: '2021-07-28',
      },
    }
  );

  if (!searchRes.ok) {
    const text = await searchRes.text();
    throw new Error(`CRM opportunity search failed (${searchRes.status}): ${text}`);
  }

  const searchData = await searchRes.json();
  const opps = searchData.opportunities || [];

  if (!opps.length) {
    throw new Error(`No Conversions opportunity found for contact ${enrollment.contact_id}`);
  }

  const opportunity = opps[0];

  const updateRes = await fetch(
    `${CRM_API}/opportunities/${opportunity.id}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CRM_API_KEY}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pipelineStageId: STAGE_DEMO_TESTED,
      }),
    }
  );

  if (!updateRes.ok) {
    const text = await updateRes.text();
    throw new Error(`CRM stage update failed (${updateRes.status}): ${text}`);
  }
}

// ─── Drip gap ──────────────────────────────────────────────────
const DRIP_DELAY_MS = 3 * 60 * 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── IST date helper ───────────────────────────────────────────
const IST_DATE_SQL = `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE`;

function todayIST() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
}

// ─── Field sanitizer ───────────────────────────────────────────
function sanitizeField(value) {
  if (value === null || value === undefined) return '';
  const v = String(value).trim();
  if (!v) return '';
  if (/^(none|n\/a|no\s|not\s|nothing|unavailable)/i.test(v)) return '';
  return v;
}

// ─── Concurrency guard ─────────────────────────────────────────
let loopRunning = false;

// ─── Daily cap tracker ─────────────────────────────────────────
let capHitIST = null;

// ─── Mailbox picker (cold only; cap 10 new leads/mailbox/day) ──
async function pickMailbox() {
  const row = await pool.query(
    `SELECT email FROM mailboxes
     WHERE daily_reset_at < ${IST_DATE_SQL}
        OR daily_count < 10
     ORDER BY last_sent_at NULLS FIRST
     LIMIT 1`
  );
  return row.rows[0]?.email || null;
}

// ─── Timezone gate ─────────────────────────────────────────────
function isInSendWindow(ianaTimezone) {
  try {
    const local = new Date(new Date().toLocaleString('en-US', { timeZone: ianaTimezone }));
    const hour  = local.getHours();
    return hour >= 8 && hour < 18;
  } catch {
    return false;
  }
}

// ─── Sequence + variation resolution ───────────────────────────
// cold[niche][step]  → { delayDays, variants: [...] } → pick a random variant
// warm[niche][step]  → { delayDays, subject, body }
// ultra_warm[step]   → { delayDays, subject, body }
function resolveTemplate(phase, niche, stepIndex) {
  let seq;
  if (phase === 'ultra_warm') {
    seq = SEQUENCES.ultra_warm;
  } else {
    seq = (SEQUENCES[phase] && SEQUENCES[phase][niche]) || SEQUENCES.cold.restoration;
  }
  const step = seq[stepIndex];
  if (!step) return null;

  if (Array.isArray(step.variants) && step.variants.length) {
    const variant = step.variants[Math.floor(Math.random() * step.variants.length)];
    return { delayDays: step.delayDays, subject: variant.subject, body: variant.body };
  }
  return { delayDays: step.delayDays, subject: step.subject, body: step.body };
}

// ─── No-reply timer: cold finished, no reply by day 11 ─────────
async function finaliseNoReply(enrollment) {
  const CRM_API     = 'https://services.leadconnectorhq.com';
  const CRM_API_KEY = process.env.CRM_API_KEY;
  const LOCATION_ID = process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';
  const PIPELINE_ID = 'NxoKeydZvDnkQEM8u6sy';
  const STAGE_NO_REPLY = 'cc480a05-61e8-482b-b0c2-430986b64826';

  try {
    await fetch(`${CRM_API}/contacts/${enrollment.contact_id}/tags`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: ['aivoice_no_response'] }),
    }).catch(e => console.error('[no-reply] tag failed:', e.message));

    const searchRes = await fetch(
      `${CRM_API}/opportunities/search?location_id=${LOCATION_ID}&contact_id=${enrollment.contact_id}&pipeline_id=${PIPELINE_ID}`,
      { headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28' } }
    );
    const searchData = await searchRes.json();
    const opps = searchData.opportunities || [];
    if (opps.length) {
      await fetch(`${CRM_API}/opportunities/${opps[0].id}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineStageId: STAGE_NO_REPLY }),
      }).catch(e => console.error('[no-reply] stage move failed:', e.message));
    }

    await pool.query(`UPDATE enrollments SET status = 'completed' WHERE id = $1`, [enrollment.id]);
    console.log(`[no-reply] ${enrollment.prospect_email} → No Replies (no response after 5 cold emails)`);
  } catch (e) {
    console.error('[no-reply] error:', e.message);
  }
}

async function processPendingUltraWarm() {
  const { rows } = await pool.query(
    `SELECT id, prospect_email
       FROM enrollments
      WHERE phase = 'warm'
        AND status = 'active'
        AND ultra_warm_pending_at IS NOT NULL
        AND ultra_warm_pending_at <= NOW()
      ORDER BY ultra_warm_pending_at
      LIMIT 10`
  );

  for (const enrollment of rows) {
    console.log(
  `[ultra_warm] processing 10-minute check → ${enrollment.prospect_email}`
);
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const { rows: freshRows } = await client.query(
        `SELECT id, phase, status
           FROM enrollments
          WHERE id = $1
          FOR UPDATE`,
        [enrollment.id]
      );

      if (!freshRows.length) {
        await client.query('ROLLBACK');
        continue;
      }

      const fresh = freshRows[0];

      // Only continue if the lead is STILL active after the 10-minute wait.
      if (fresh.phase !== 'warm' || fresh.status !== 'active') {
        await client.query(
          `UPDATE enrollments
              SET ultra_warm_pending_at = NULL
            WHERE id = $1`,
          [fresh.id]
        );

        await client.query('COMMIT');
        continue;
      }

      // 10 minutes elapsed and status is still active:
      // transition to ultra-warm and make step 0 immediately due.
      await client.query('COMMIT');

console.log(
  `[ultra_warm] ⏱️ 10-minute wait complete → ${enrollment.prospect_email}`
);

try {
  // 1. Tag contact as tested
  await tagContact(
    enrollment.contact_id,
    'aivoice_agent_tested'
  );

  console.log(
    `[CRM] ✅ aivoice_agent_tested tag applied → ${enrollment.prospect_email}`
  );

  // 2. Move opportunity to Demo Tested
  await moveToDemoTested(enrollment);

  console.log(
    `[CRM] ✅ opportunity moved to Demo Tested → ${enrollment.prospect_email}`
  );

  // 3. Only AFTER CRM succeeds, enter ultra-warm
  await pool.query(
    `UPDATE enrollments
        SET phase = 'ultra_warm',
            step = 0,
            next_send_at = NOW()
      WHERE id = $1
        AND phase = 'warm'
        AND status = 'active'`,
    [enrollment.id]
  );

  console.log(
    `[ultra_warm] → phase changed to ultra_warm → ${enrollment.prospect_email}`
  );

  // 4. Immediately process the first ultra-warm email
  await runSendLoop(true);

} catch (crmErr) {
  console.error(
    `[CRM] ❌ Demo Tested update failed for ${enrollment.prospect_email}:`,
    crmErr.message
  );
}

    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) {}

      console.error(
        `[ultra_warm] pending transition failed for ${enrollment.prospect_email}:`,
        err.message
      );
    } finally {
      client.release();
    }
  }
}

// ─── Send loop ─────────────────────────────────────────────────
async function runSendLoop(skipPendingUltraWarm = false) {
  if (!skipPendingUltraWarm) {
    await processPendingUltraWarm();
  }

  if (loopRunning) return;
  loopRunning = true;

  try {
    // Only fetch candidate IDs here. Every candidate is re-checked under a
    // PostgreSQL advisory lock before it can be sent. The old loopRunning flag
    // only protected one Node process; multiple Railway processes could all
    // select the same due enrollment and send it.
    const due = await pool.query(
      `SELECT id
         FROM enrollments
        WHERE status IN ('active', 'awaiting_no_reply')
          AND next_send_at <= NOW()
        ORDER BY next_send_at ASC
        LIMIT 6`
    );

    for (const candidate of due.rows) {
      const client = await pool.connect();

      try {
        await client.query('BEGIN');

        // Database-wide lock: protects the same enrollment across separate
        // Railway instances/processes, not just within this Node process.
        await client.query(
          `SELECT pg_advisory_xact_lock(hashtext($1))`,
          [`creativecopyz:send:${candidate.id}`]
        );

        const freshResult = await client.query(
          `SELECT * FROM enrollments
            WHERE id = $1
              AND status IN ('active', 'awaiting_no_reply')
              AND next_send_at <= NOW()
            FOR UPDATE`,
          [candidate.id]
        );

        if (!freshResult.rows.length) {
          await client.query('ROLLBACK');
          client.release();
          continue;
        }

        const enrollment = freshResult.rows[0];

        if (enrollment.status === 'awaiting_no_reply') {
          await client.query('COMMIT');
          client.release();
          await finaliseNoReply(enrollment);
          continue;
        }

        if (!isInSendWindow(enrollment.prospect_tz)) {
          await client.query('ROLLBACK');
          client.release();
          continue;
        }

        const template = resolveTemplate(enrollment.phase, enrollment.niche, enrollment.step);

        if (!template) {
          await client.query(
            `UPDATE enrollments SET status = 'completed' WHERE id = $1`,
            [enrollment.id]
          );
          await client.query('COMMIT');
          client.release();
          continue;
        }

        // ── Mailbox selection ──────────────────────────────────
        let mailbox;
        if (enrollment.phase === 'warm' || enrollment.phase === 'ultra_warm') {
          mailbox = enrollment.mailbox;
          if (!mailbox) {
            await client.query('ROLLBACK');
            client.release();
            console.log(`[loop] ${enrollment.phase} enrollment ${enrollment.id} has no mailbox assigned — skipping`);
            continue;
          }
        } else if (enrollment.step === 0) {
          if (capHitIST === todayIST()) {
            await client.query('ROLLBACK');
            client.release();
            console.log('[loop] daily cap exhausted for today, skipping new lead');
            continue;
          }
          mailbox = await pickMailbox();
          if (!mailbox) {
            capHitIST = todayIST();
            await client.query('ROLLBACK');
            client.release();
            console.log('[loop] no mailbox available — daily cap reached, will retry tomorrow at midnight IST');
            continue;
          }
        } else {
          mailbox = enrollment.mailbox;
        }

        const persona = getPersona(mailbox);
        const e = {
          ...enrollment,
          personalisation_hook: sanitizeField(enrollment.personalisation_hook),
          current_pain:         sanitizeField(enrollment.current_pain),
        };

        const subject = template.subject(e);
        const body = template.body(e, persona)
          + '\n\n---\nTo stop receiving these emails, simply reply with "unsubscribe".';

        const nextStep = enrollment.step + 1;
        const seqLen = enrollment.phase === 'ultra_warm'
          ? SEQUENCES.ultra_warm.length
          : (SEQUENCES[enrollment.phase] && SEQUENCES[enrollment.phase][enrollment.niche] || SEQUENCES.cold.restoration).length;
        const isDone = nextStep >= seqLen;
        const rawDelay = String(template.delayDays || 3);
        const delayInterval = /[a-zA-Z]/.test(rawDelay) ? rawDelay : `${rawDelay} days`;

        const isColdDone = enrollment.phase === 'cold' && isDone;
const newStatus = isColdDone ? 'awaiting_no_reply' : (isDone ? 'completed' : 'active');

const newNext = isColdDone
  ? `NOW() + '3 days'::interval`
  : (isDone ? 'NULL' : `NOW() + $4::INTERVAL`);

// IMPORTANT: claim/advance the sequence BEFORE calling Gmail, then
// commit that claim. This makes the send path idempotent across
// multiple processes. The old code sent first and only advanced step
// afterward, so any concurrent process (or a post-send DB failure)
// could send the same step again.
await client.query(
  `UPDATE enrollments SET
     step            = $1,
     mailbox         = $2,
     next_send_at    = ${newNext},
     status          = $3
   WHERE id = $5`,
  [
    nextStep,
    mailbox,
    newStatus,
    delayInterval,
    enrollment.id
  ]
);

        await client.query('COMMIT');
        client.release();

        let result;
        try {
          result = await sendEmail({
            mailbox,
            fromName  : persona.fullName,
            to        : enrollment.prospect_email,
            subject,
            body,
            threadId  : enrollment.thread_id,
            inReplyTo : enrollment.last_message_id,
            references: enrollment.last_message_id,
          });
        } catch (sendErr) {
          // The sequence step was already claimed. Put this enrollment back
          // on the failed step so a transient Gmail failure can be retried,
          // without making concurrent processes eligible for the same send.
          await pool.query(
            `UPDATE enrollments
                SET step = $1,
                    next_send_at = NOW() + INTERVAL '5 minutes',
                    status = 'active'
              WHERE id = $2
                AND step = $3`,
            [enrollment.step, enrollment.id, nextStep]
          ).catch(e => console.error('[loop] failed to release send claim:', e.message));

          throw sendErr;
        }

        // Gmail accepted the message. Persist the returned Gmail IDs and the
        // actual send timestamp. The sequence step has already advanced, so a
        // failure here cannot make the same step eligible for another send.
        const threadId = result?.threadId || enrollment.thread_id || null;
const messageId = result?.messageId || null;

await pool.query(
  `UPDATE enrollments SET
     thread_id       = COALESCE(thread_id, $2::text),
     last_message_id = $3::text,
     last_sent_at    = NOW()
   WHERE id = $1`,
  [enrollment.id, threadId, messageId]
);

        if (enrollment.step === 0 && enrollment.phase === 'cold') {
          await pool.query(
            `UPDATE mailboxes SET
               last_sent_at   = NOW(),
               daily_count    = CASE WHEN daily_reset_at < ${IST_DATE_SQL} THEN 1
                                     ELSE daily_count + 1 END,
               daily_reset_at = ${IST_DATE_SQL}
             WHERE email = $1`,
            [mailbox]
          );
        } else {
          await pool.query(
            `UPDATE mailboxes SET last_sent_at = NOW() WHERE email = $1`,
            [mailbox]
          );
        }

        console.log(`[loop] ✅ step ${enrollment.step} sent to ${enrollment.prospect_email} via ${mailbox} (${enrollment.phase})`);
        console.log('[loop] waiting 3 min before next send...');
        await sleep(DRIP_DELAY_MS);

      } catch (err) {
        // The client may already have been released after the pre-send claim.
        // We only ROLLBACK if this transaction is still active.
        try {
          await client.query('ROLLBACK');
        } catch (_) {}
        try {
          client.release();
        } catch (_) {}

        console.error(`[loop] send failed for candidate ${candidate.id}:`, err.message);
      }
    }

    // Conversation follow-ups: nudge leads who got calendar link but haven't replied or booked
    const convDue = await pool.query(
      `SELECT * FROM enrollments
       WHERE conv_status = 'calendar_sent'
         AND conv_followup_at <= NOW()
         AND status NOT IN ('unsubscribed', 'bounced', 'completed')
       LIMIT 3`
    );
    for (const enrollment of convDue.rows) {
      if (!isInSendWindow(enrollment.prospect_tz)) continue;
      console.log(`[loop] conv follow-up -> ${enrollment.prospect_email}`);
      await sendConvFollowUp(enrollment);
      await sleep(DRIP_DELAY_MS);
    }
  } catch (err) {
    console.error('[loop] query error:', err.message);
  } finally {
    loopRunning = false;
  }
}
module.exports = { runSendLoop };
