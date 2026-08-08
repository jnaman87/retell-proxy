'use strict';
const pool                  = require('./pool');
const { listRecentInbound } = require('./gmail-sender');

const CRM_API     = 'https://services.leadconnectorhq.com';
const CRM_API_KEY = process.env.CRM_API_KEY;
const LOCATION_ID = process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';

const PIPELINE_ID          = 'Sv3XlTtCmzbGrHrZ3BFL';
const STAGE_REPLY_RECEIVED = 'fa5d74ec-aa3f-44d7-89f4-0e59c41788b9';

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

async function createOpportunity(contactId, prospectEmail, companyName) {
  try {
    const r = await fetch(`${CRM_API}/opportunities`, {
      method  : 'POST',
      headers : {
        Authorization  : `Bearer ${CRM_API_KEY}`,
        Version        : '2021-07-28',
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({
        pipelineId      : PIPELINE_ID,
        locationId      : LOCATION_ID,
        name            : `${companyName || prospectEmail} — AI Voice Reply`,
        pipelineStageId : STAGE_REPLY_RECEIVED,
        status          : 'open',
        contactId,
      }),
    });
    const d = await r.json();
    if (!r.ok) {
      console.error('[detect] opportunity create failed:', JSON.stringify(d));
    } else {
      console.log(`[detect] ✅ opportunity created → Reply Received for ${prospectEmail}`);
    }
  } catch (e) {
    console.error('[detect] opportunity error:', e.message);
  }
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
               RETURNING contact_id, prospect_email, company_name`,
              [msg.threadId]
            );

            if (result.rows.length > 0) {
              const { contact_id, prospect_email, company_name } = result.rows[0];
              console.log(`[detect] reply from ${prospect_email} → ${email}`);

              if (contact_id) {
                // Run tag, opportunity, and note in parallel
                await Promise.all([
                  tagContact(contact_id, 'aivoice_reply_received'),
                  createOpportunity(contact_id, prospect_email, company_name),
                  addNote(contact_id,
                    `Cold email reply received.\n` +
                    `Replied to mailbox: ${email}\n` +
                    `From: ${msg.from}\n` +
                    `Subject: ${msg.subject}\n\n` +
                    `Reply preview:\n${msg.snippet}`
                  ),
                ]);
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
