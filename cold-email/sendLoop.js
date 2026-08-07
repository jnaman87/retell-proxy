'use strict';
const pool          = require('./pool');
const { sendEmail } = require('./gmail-sender');
const SEQUENCES     = require('./sequence');

async function pickMailbox() {
  const row = await pool.query(
    `SELECT email FROM mailboxes
     ORDER BY last_sent_at NULLS FIRST
     LIMIT 1`
  );
  return row.rows[0]?.email || null;
}

function isInSendWindow(ianaTimezone) {
  try {
    const hour = parseInt(
      new Date().toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ianaTimezone,
      }).split(':')[0],
      10
    );
    return hour >= 8 && hour < 17;
  } catch {
    return false;
  }
}

async function runSendLoop() {
  try {
    const due = await pool.query(
      `SELECT * FROM enrollments
       WHERE status = 'active'
         AND next_send_at <= NOW()
       ORDER BY next_send_at ASC
       LIMIT 20`
    );

    for (const enrollment of due.rows) {
      // Timezone gate — skip if outside 8am–5pm prospect local time
      if (!isInSendWindow(enrollment.prospect_tz)) continue;

      // Get niche sequence and step template
      const nicheSeq = SEQUENCES[enrollment.niche] || SEQUENCES.restoration;
      const template = nicheSeq[enrollment.step];
      if (!template) {
        await pool.query(
          `UPDATE enrollments SET status = 'completed' WHERE id = $1`,
          [enrollment.id]
        );
        continue;
      }

      // Pick LRU mailbox
      const mailbox = await pickMailbox();
      if (!mailbox) continue;

      const subject = template.subject(enrollment);

      try {
        const result = await sendEmail({
          mailbox,
          fromName  : 'Naman from Creative Copyz',
          to        : enrollment.prospect_email,
          subject,
          body      : template.body(enrollment),
          threadId  : enrollment.thread_id,
          inReplyTo : enrollment.last_message_id,
          references: enrollment.last_message_id,
        });

        const nextStep = enrollment.step + 1;
        const isDone   = nextStep >= nicheSeq.length;

        await pool.query(
          `UPDATE enrollments SET
             step            = $1,
             mailbox         = $2,
             thread_id       = COALESCE(thread_id, $3),
             last_message_id = $4,
             last_sent_at    = NOW(),
             next_send_at    = CASE WHEN $5 THEN NULL
                                    ELSE NOW() + ($6 || ' days')::INTERVAL END,
             status          = CASE WHEN $5 THEN 'completed' ELSE 'active' END
           WHERE id = $7`,
          [nextStep, mailbox, result.threadId, result.messageId,
           isDone, String(template.delayDays || 3), enrollment.id]
        );

        await pool.query(
          `UPDATE mailboxes SET last_sent_at = NOW() WHERE email = $1`,
          [mailbox]
        );

      } catch (err) {
        console.error(`[loop] send failed for ${enrollment.prospect_email}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[loop] query error:', err.message);
  }
}

module.exports = { runSendLoop };
