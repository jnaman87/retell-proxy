'use strict';
const pool          = require('./pool');
const { sendEmail } = require('./gmail-sender');
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

// ─── Send loop ─────────────────────────────────────────────────
async function runSendLoop() {
  if (loopRunning) {
    console.log('[loop] previous run still in progress, skipping');
    return;
  }
  loopRunning = true;

  try {
    const due = await pool.query(
      `SELECT * FROM enrollments
       WHERE status IN ('active', 'awaiting_no_reply')
         AND next_send_at <= NOW()
       ORDER BY next_send_at ASC
       LIMIT 6`
    );

    for (const enrollment of due.rows) {
      if (enrollment.status === 'awaiting_no_reply') {
        await finaliseNoReply(enrollment);
        continue;
      }

      if (!isInSendWindow(enrollment.prospect_tz)) continue;

      const template = resolveTemplate(enrollment.phase, enrollment.niche, enrollment.step);

      if (!template) {
        await pool.query(
          `UPDATE enrollments SET status = 'completed' WHERE id = $1`,
          [enrollment.id]
        );
        continue;
      }

      // ── Mailbox selection ──────────────────────────────────
      let mailbox;
      if (enrollment.phase === 'warm' || enrollment.phase === 'ultra_warm') {
        mailbox = enrollment.mailbox;
        if (!mailbox) {
          console.log(`[loop] ${enrollment.phase} enrollment ${enrollment.id} has no mailbox assigned — skipping`);
          continue;
        }
      } else if (enrollment.step === 0) {
        if (capHitIST === todayIST()) {
          console.log('[loop] daily cap exhausted for today, skipping new lead');
          continue;
        }
        mailbox = await pickMailbox();
        if (!mailbox) {
          capHitIST = todayIST();
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
      const body    = template.body(e, persona)
        + '\n\n---\nTo stop receiving these emails, simply reply with "unsubscribe".';

      try {
        const result = await sendEmail({
          mailbox,
          fromName  : persona.fullName,
          to        : enrollment.prospect_email,
          subject,
          body,
          threadId  : enrollment.thread_id,
          inReplyTo : enrollment.last_message_id,
          references: enrollment.last_message_id,
        });

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
          : (isDone ? 'NULL' : `NOW() + $6::INTERVAL`);

        await pool.query(
          `UPDATE enrollments SET
             step            = $1,
             mailbox         = $2,
             thread_id       = COALESCE(thread_id, $3),
             last_message_id = $4,
             last_sent_at    = NOW(),
             next_send_at    = ${newNext},
             status          = $5
           WHERE id = $7`,
          [nextStep, mailbox, result.threadId, result.messageId,
           newStatus, delayInterval, enrollment.id]
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
        console.error(`[loop] send failed for ${enrollment.prospect_email}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[loop] query error:', err.message);
  } finally {
    loopRunning = false;
  }
}

module.exports = { runSendLoop };
