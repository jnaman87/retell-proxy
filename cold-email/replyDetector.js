'use strict';
const pool                  = require('./pool');
const { listRecentInbound } = require('./gmail-sender');

async function detectRepliesAndBounces() {
  try {
    const { rows: mailboxes } = await pool.query(`SELECT email FROM mailboxes`);

    for (const { email } of mailboxes) {
      try {
        const messages = await listRecentInbound(email, { days: 3, max: 50 });

        for (const msg of messages) {
          if (msg.bounced) {
            await pool.query(
              `UPDATE enrollments SET status = 'bounced'
               WHERE thread_id = $1 AND status = 'active'`,
              [msg.threadId]
            );
          } else {
            await pool.query(
              `UPDATE enrollments SET status = 'replied'
               WHERE thread_id = $1 AND status = 'active'`,
              [msg.threadId]
            );
          }
        }
      } catch (err) {
        console.error(`[detect] failed for ${email}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[detect] query error:', err.message);
  }
}

module.exports = { detectRepliesAndBounces };
