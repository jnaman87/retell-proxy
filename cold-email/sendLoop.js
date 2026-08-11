'use strict';
const pool          = require('./pool');
const { sendEmail } = require('./gmail-sender');
const SEQUENCES     = require('./sequence');

// ─── Mailbox personas ─────────────────────────────────────────────────────────
const MAILBOX_PERSONAS = {
  'anne@ccopyz.net'           : { fullName: 'Anne Schull',    title: 'Director of Client Solutions' },
  'billy@creativecopyz.org'   : { fullName: 'Billy Cooper',   title: 'Business Development Manager' },
  'caitlyn@creativecopyz.net' : { fullName: 'Caitlyn Smoke',  title: 'Account Executive' },
  'claire@cretivecopyz.com'   : { fullName: 'Claire Dunphy',  title: 'Partnership Manager' },
  'clint@ccopyz.com'          : { fullName: 'Clint Mac',      title: 'Head of Business Development' },
  'emily@cretivecopyz.com'    : { fullName: 'Emily Hathway',  title: 'Client Success Manager' },
  'glenn@ccopyz.net'          : { fullName: 'Glenn Ponting',  title: 'AI Solutions Director' },
  'hailey@cretivecopyz.com'   : { fullName: 'Hailey Henz',    title: 'Account Manager' },
  'harry@ccopyz.org'          : { fullName: 'Harry Garrold',  title: 'Business Development Executive' },
  'helen@ccopyz.com'          : { fullName: 'Helen Morgan',   title: 'Director of Partnerships' },
  'james@creativecopyz.net'   : { fullName: 'James Walkway',  title: 'Head of AI Outreach' },
  'josh@ccopyz.org'           : { fullName: 'Josh Walker',    title: 'Account Executive' },
  'joshua@creativecopyz.net'  : { fullName: 'Joshua Speed',   title: 'Business Development Lead' },
  'justin@ccopyz.net'         : { fullName: 'Justin Albus',   title: 'Director of Sales' },
  'mike@ccopyz.org'           : { fullName: 'Mike Ten',       title: 'Senior Account Manager' },
  'phil@creativecopyz.org'    : { fullName: 'Phil Jazz',      title: 'Partnership Director' },
  'samuel@ccopyz.com'         : { fullName: 'Samuel Borne',   title: 'AI Solutions Advisor' },
  'vanessa@creativecopyz.org' : { fullName: 'Vanessa Cruz',   title: 'Client Relations Manager' },
};

function getPersona(mailbox) {
  return MAILBOX_PERSONAS[mailbox] || { fullName: 'Creative Copyz Team', title: 'Account Manager' };
}

// ─── 3-minute drip gap between sends ─────────────────────────────────────────
const DRIP_DELAY_MS = 3 * 60 * 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── IST date helper (resets at midnight IST) ─────────────────────────────────
const IST_DATE_SQL = `(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE`;

// ─── Concurrency guard ────────────────────────────────────────────────────────
let loopRunning = false;

// ─── Mailbox picker ───────────────────────────────────────────────────────────
async function pickMailbox() {
  const row = await pool.query(
    `SELECT email FROM mailboxes
     WHERE daily_reset_at < ${IST_DATE_SQL}
        OR daily_count < 2
     ORDER BY last_sent_at NULLS FIRST
     LIMIT 1`
  );
  return row.rows[0]?.email || null;
}

// ─── Timezone gate ────────────────────────────────────────────────────────────
function isInSendWindow(ianaTimezone) {
  try {
    const local = new Date(new Date().toLocaleString('en-US', { timeZone: ianaTimezone }));
    const hour  = local.getHours();
    return hour >= 8 && hour < 17;
  } catch {
    return false;
  }
}

// ─── Send loop ────────────────────────────────────────────────────────────────
async function runSendLoop() {
  if (loopRunning) {
    console.log('[loop] previous run still in progress, skipping');
    return;
  }
  loopRunning = true;

  try {
    const due = await pool.query(
      `SELECT * FROM enrollments
       WHERE status = 'active'
         AND next_send_at <= NOW()
       ORDER BY next_send_at ASC
       LIMIT 20`
    );

    for (const enrollment of due.rows) {
     if (!isInSendWindow(enrollment.prospect_tz)) continue;

      const nicheSeq = SEQUENCES[enrollment.niche] || SEQUENCES.restoration;
      const template = nicheSeq[enrollment.step];

      if (!template) {
        await pool.query(
          `UPDATE enrollments SET status = 'completed' WHERE id = $1`,
          [enrollment.id]
        );
        continue;
      }

      const mailbox = enrollment.step === 0
        ? await pickMailbox()
        : enrollment.mailbox;

      if (!mailbox) {
        console.log('[loop] no mailbox available (daily cap reached for all)');
        continue;
      }

      const persona = getPersona(mailbox);
      const subject = template.subject(enrollment);
      const body    = template.body(enrollment, persona)
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

        const nextStep      = enrollment.step + 1;
        const isDone        = nextStep >= nicheSeq.length;
        const rawDelay      = String(template.delayDays || 3);
        const delayInterval = /[a-zA-Z]/.test(rawDelay) ? rawDelay : `${rawDelay} days`;

        await pool.query(
          `UPDATE enrollments SET
             step            = $1,
             mailbox         = $2,
             thread_id       = COALESCE(thread_id, $3),
             last_message_id = $4,
             last_sent_at    = NOW(),
             next_send_at    = CASE WHEN $5 THEN NULL
                                    ELSE NOW() + $6::INTERVAL END,
             status          = CASE WHEN $5 THEN 'completed' ELSE 'active' END
           WHERE id = $7`,
          [nextStep, mailbox, result.threadId, result.messageId,
           isDone, delayInterval, enrollment.id]
        );

        if (enrollment.step === 0) {
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

        console.log(`[loop] ✅ step ${enrollment.step} sent to ${enrollment.prospect_email} via ${mailbox}`);

        // ── 3-minute drip gap after every successful send ────────────────────
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
