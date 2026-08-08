'use strict';
const pool                  = require('./pool');
const { listRecentInbound } = require('./gmail-sender');

const CRM_API     = 'https://services.leadconnectorhq.com';
const CRM_API_KEY = process.env.CRM_API_KEY;
const LOCATION_ID = process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';

const PIPELINE_ID          = 'Sv3XlTtCmzbGrHrZ3BFL';
const STAGE_REPLY_RECEIVED = 'fa5d74ec-aa3f-44d7-89f4-0e59c41788b9';

// ─── CRM helpers ─────────────────────────────────────────────────────────────

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

// channels: 'all' → DND every channel (unsubscribe)
//           ['Email'] → DND that channel only (bounce)
async function enableDND(contactId, channels) {
  let body;

  if (channels === 'all') {
    body = {
      dnd: true,
      dndSettings: {
        Call     : { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        Email    : { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        SMS      : { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        WhatsApp : { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        GMB      : { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        FB       : { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
      },
    };
  } else {
    body = {
      dndSettings: Object.fromEntries(
        channels.map(ch => [ch, { status: 'active', message: 'Bounced email address', code: 'BOUNCE' }])
      ),
    };
  }

  const r = await fetch(`${CRM_API}/contacts/${contactId}`, {
    method  : 'PUT',
    headers : {
      Authorization  : `Bearer ${CRM_API_KEY}`,
      Version        : '2021-07-28',
      'Content-Type' : 'application/json',
    },
    body: JSON.stringify(body),
  }).catch(e => console.error('[detect] DND failed:', e.message));

  if (r && r.ok) {
    console.log(`[detect] ✅ DND set (${channels === 'all' ? 'all channels' : channels.join(',')}) for ${contactId}`);
  }
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

// ─── Main loop ────────────────────────────────────────────────────────────────

async function detectRepliesAndBounces() {
  try {
    const { rows: mailboxes } = await pool.query(`SELECT email FROM mailboxes`);

    for (const { email } of mailboxes) {
      try {
        const messages = await listRecentInbound(email, { days: 3, max: 50 });

        for (const msg of messages) {

          // ── BOUNCE ────────────────────────────────────────────────────────
          if (msg.bounced) {
            const result = await pool.query(
              `UPDATE enrollments SET status = 'bounced'
               WHERE thread_id = $1 AND status = 'active'
               RETURNING contact_id, prospect_email`,
              [msg.threadId]
            );
            if (result.rows.length > 0) {
              const { contact_id, prospect_email } = result.rows[0];
              console.log(`[detect] bounce for ${prospect_email}`);
              if (contact_id) {
                await Promise.all([
                  tagContact(contact_id, 'aivoice_bounced'),
                  enableDND(contact_id, ['Email']),
                  addNote(contact_id,
                    `Cold email bounced.\n` +
                    `Sending mailbox: ${email}\n` +
                    `Prospect email: ${prospect_email}\n\n` +
                    `Email DND enabled. Verify this address before re-contacting.`
                  ),
                ]);
              }
            }
            continue;
          }

          // ── UNSUBSCRIBE ───────────────────────────────────────────────────
          const isUnsub = /\bunsubscribe\b/i.test(
            (msg.snippet || '') + ' ' + (msg.subject || '')
          );

          if (isUnsub) {
            const result = await pool.query(
              `UPDATE enrollments SET status = 'unsubscribed'
               WHERE thread_id = $1 AND status = 'active'
               RETURNING contact_id, prospect_email`,
              [msg.threadId]
            );
            if (result.rows.length > 0) {
              const { contact_id, prospect_email } = result.rows[0];
              console.log(`[detect] unsubscribe from ${prospect_email}`);
              if (contact_id) {
                await Promise.all([
                  tagContact(contact_id, 'aivoice_unsubscribed'),
                  enableDND(contact_id, 'all'),
                ]);
              }
            }
            continue;
          }

          // ── REPLY (anything else — including "not interested") ────────────
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

      } catch (err) {
        console.error(`[detect] failed for ${email}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[detect] query error:', err.message);
  }
}

module.exports = { detectRepliesAndBounces };
