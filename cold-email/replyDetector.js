'use strict';
const pool                  = require('./pool');
const { listRecentInbound } = require('./gmail-sender');

const CRM_API     = 'https://services.leadconnectorhq.com';
const CRM_API_KEY = process.env.CRM_API_KEY;

async function tagContact(contactId, tag) {
  await fetch(`${CRM_API}/contacts/${contactId}/tags`, {
    method  : 'POST',
    headers : {
      Authorization  : `Bearer ${CRM_API_KEY}`,
      Version        : '2021-04-15',
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify({ tags: [tag] }),
  }).catch(e => console.error('[detect] tag failed:', e.message));
}

async function addNote(contactId, body) {
  await fetch(`${CRM_API}/contacts/${contactId}/notes`, {
    method  : 'POST',
    headers : {
      Authorization  : `Bearer ${CRM_API_KEY}`,
      Version        : '2021-04-15',
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify({ body }),
  }).catch(e => console.error('[detect] note failed:', e.message));
}

async function detectRepliesAndBounces() {
  try {
    const { rows: mailboxes } = await pool.query(`SELECT email FROM mailboxes`);

    for (const { email } of mailboxes) {
      try {
        const messages = await listRecentInbound(email, { days: 3, max: 50 });

        for (const msg of messages) {
          if (msg.bounced) {
            const result = await pool.query(
              `UPDATE enrollments SET status = 'bounced'
               WHERE thread_id = $1 AND status = 'active'
               RETURNING contact_id, prospect_email`,
              [msg.threadId]
            );
            if (result.rows.length > 0) {
              console.log(`[detect] bounce for ${result.rows[0].prospect_email}`);
            }

          } else {
            const result = await pool.query(
              `UPDATE enrollments SET status = 'replied'
               WHERE thread_id = $1 AND status = 'active'
               RETURNING contact_id, prospect_email`,
              [msg.threadId]
            );

            if (result.rows.length > 0) {
              const { contact_id, prospect_email } = result.rows[0];
              console.log(`[detect] reply from ${prospect_email} → ${email}`);

              if (contact_id) {
                await tagContact(contact_id, 'aivoice_reply_received');

                const noteText =
                  `Cold email reply received.\n` +
                  `Replied to mailbox: ${email}\n` +
                  `From: ${msg.from}\n` +
                  `Subject: ${msg.subject}\n\n` +
                  `Reply preview:\n${msg.snippet}`;

                await addNote(contact_id, noteText);
              }
            }
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
