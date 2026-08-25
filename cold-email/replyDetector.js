'use strict';
const pool                  = require('./pool');
const { listRecentInbound } = require('./gmail-sender');

const CRM_API     = 'https://services.leadconnectorhq.com';
const CRM_API_KEY = process.env.CRM_API_KEY;
const LOCATION_ID = process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';
const OPENAI_KEY  = process.env.OPENAI_API_KEY;

// ─── Pipelines & stages ────────────────────────────────────────
// Outbound Tracking
const OT_PIPELINE             = 'NxoKeydZvDnkQEM8u6sy';
const OT_REPLY_RECEIVED       = 'ad4c1fd7-e0bf-4101-9e1e-3e04a7ec81e2';
const OT_UNSUB_NOT_INTERESTED = '8c9f1603-53f3-4917-97b0-4a89e6507ce6';
const OT_DEMO_SENT            = 'aed1858d-3090-43da-bf3c-3e398795d4da';

// Conversations
const CV_PIPELINE       = 'Sv3XlTtCmzbGrHrZ3BFL';
const CV_DEMO_SENT      = 'aaedbe52-060f-4d30-a6b3-21b3f8222812';
const CV_REPLY_RECEIVED = 'fa5d74ec-aa3f-44d7-89f4-0e59c41788b9';

// ─── CRM helpers ───────────────────────────────────────────────
async function tagContact(contactId, tag) {
  await fetch(`${CRM_API}/contacts/${contactId}/tags`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags: [tag] }),
  }).catch(e => console.error('[detect] tag failed:', e.message));
}

async function addNote(contactId, body) {
  await fetch(`${CRM_API}/contacts/${contactId}/notes`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-04-15', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  }).catch(e => console.error('[detect] note failed:', e.message));
}

async function enableDND(contactId, channels) {
  let body;
  if (channels === 'all') {
    body = {
      dnd: true,
      dndSettings: {
        Call:      { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        Email:     { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        SMS:       { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        WhatsApp:  { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        GMB:       { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        FB:        { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
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
    method: 'PUT',
    headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(e => console.error('[detect] DND failed:', e.message));
  if (r && r.ok) console.log(`[detect] ✅ DND set (${channels === 'all' ? 'all channels' : channels.join(',')}) for ${contactId}`);
}

// Find the first opportunity for a contact in a given pipeline.
async function findOpportunity(contactId, pipelineId) {
  try {
    const r = await fetch(
      `${CRM_API}/opportunities/search?location_id=${LOCATION_ID}&contact_id=${contactId}&pipeline_id=${pipelineId}`,
      { headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28' } }
    );
    const d = await r.json();
    return (d.opportunities && d.opportunities[0]) || null;
  } catch (e) {
    console.error('[detect] opp search error:', e.message);
    return null;
  }
}

async function moveOpportunity(oppId, stageId) {
  if (!oppId) return;
  await fetch(`${CRM_API}/opportunities/${oppId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ stageId }),
  }).catch(e => console.error('[detect] stage move failed:', e.message));
}

// Create a Conversations opportunity (used at Demo Sent).
async function createConversationOpportunity(contactId, companyName) {
  try {
    const r = await fetch(`${CRM_API}/opportunities`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipelineId: CV_PIPELINE,
        locationId: LOCATION_ID,
        name: `${companyName || 'Lead'} — AI Voice Demo`,
        pipelineStageId: CV_DEMO_SENT,
        status: 'open',
        contactId,
      }),
    });
    if (!r.ok) console.error('[detect] conversation opp create failed:', await r.text());
    else console.log(`[detect] ✅ Conversations opportunity created → Demo Sent for ${companyName}`);
  } catch (e) {
    console.error('[detect] conversation opp error:', e.message);
  }
}

// ─── OpenAI reply classification ───────────────────────────────
// Returns one of: 'positive' | 'negative' | 'neutral' | 'unsubscribe'
async function classifyReply(subject, snippet) {
  if (!OPENAI_KEY) {
    const text = `${subject} ${snippet}`.toLowerCase();
    if (/\b(unsubscribe|remove me|opt out|stop emails|take me off)\b/.test(text)) return 'unsubscribe';
    if (/\b(no thanks|not interested|no thank you|stop|don't contact|leave me alone|not for us|no, thanks)\b/.test(text)) return 'negative';
    if (/\b(yes|interested|sounds good|let's talk|call me|send it|tell me more|book|schedule|want to see|great|awesome|perfect)\b/.test(text)) return 'positive';
    return 'neutral';
  }

  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You classify email replies from a business owner who received a cold outreach email about an AI voice receptionist demo.\nClassify the intent into exactly one of:\n- "positive": interested, wants to see the demo, wants more info, wants a call, asks for the page/link, engaged positively\n- "negative": not interested, no thanks, not for us, stop contacting, don't want it\n- "unsubscribe": explicitly asks to unsubscribe / stop emails / remove from list\n- "neutral": anything else — a question, a vague reply, an out-of-office, a comment, or unclear\nRespond ONLY with JSON: {"intent": "positive"|"negative"|"neutral"|"unsubscribe"}`,
          },
          { role: 'user', content: `Subject: ${subject}\n\nReply: ${snippet}` },
        ],
      }),
    });
    const data = await r.json();
    const intent = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    try {
      const parsed = JSON.parse(intent);
      return ['positive', 'negative', 'neutral', 'unsubscribe'].includes(parsed.intent) ? parsed.intent : 'neutral';
    } catch {
      return 'neutral';
    }
  } catch (e) {
    console.error('[detect] classify error:', e.message);
    return 'neutral';
  }
}

// ─── Demo build trigger (positive cold reply) ──────────────────
async function buildDemoForEnrollment(enrollment) {
  const PORT = process.env.PORT || 3000;
  const base = `http://localhost:${PORT}`;
  try {
    const r = await fetch(`${base}/create-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        niche:          enrollment.niche,
        businessName:   enrollment.company_name,
        city:           enrollment.prospect_city,
        coreServices:   enrollment.core_services   || '',
        tagline:        enrollment.tagline          || '',
        primaryColor:   enrollment.primary_color   || '',
        secondaryColor: enrollment.secondary_color || '',
        callerFaqs:     enrollment.caller_faqs     || '',
        contactId:      enrollment.contact_id,
        email:          enrollment.prospect_email,
      }),
    });
    const d = await r.json();
    if (!r.ok || !d.demoUrl) {
      console.error('[detect] demo build failed:', JSON.stringify(d));
      return null;
    }
    return d.demoUrl;
  } catch (e) {
    console.error('[detect] demo build error:', e.message);
    return null;
  }
}

// ─── Handle a positive cold reply ──────────────────────────────
async function handlePositive(enrollment, msg) {
  const { contact_id, prospect_email, company_name } = enrollment;

  // Duplicate guard: only build once
  if (enrollment.positive_reply_at) {
    console.log(`[detect] duplicate positive reply for ${prospect_email} — skipping build`);
    return;
  }

  // Build the demo FIRST — before touching phase, so the send loop
  // never sees a warm enrollment without a demo URL.
  const demoUrl = await buildDemoForEnrollment(enrollment);
  if (!demoUrl) {
    console.error(`[detect] demo build failed for ${prospect_email} — skipping warm transition`);
    return;
  }

  // Single atomic update: phase + demo URL together
  await pool.query(
    `UPDATE enrollments
     SET positive_reply_at = NOW(), phase = 'warm', step = 0,
         status = 'active', next_send_at = NOW() + INTERVAL '2 minutes',
         demo_page_url = $2
     WHERE id = $1`,
    [enrollment.id, demoUrl]
  );

  // Tag + note + pipeline moves
  await tagContact(contact_id, 'aivoice_demo_sent');
  await addNote(contact_id,
    `Positive reply to cold email.\n` +
    `Replied to: ${msg.from}\nSubject: ${msg.subject}\n\n` +
    `Reply preview:\n${msg.snippet}\n\n` +
    `Demo built: ${demoUrl}\nEnrolled in warm sequence.`);

  // Outbound Tracking → Demo Sent
  const otOpp = await findOpportunity(contact_id, OT_PIPELINE);
  if (otOpp) await moveOpportunity(otOpp.id, OT_DEMO_SENT);

  // Conversations → Demo Sent (create if missing)
  const cvOpp = await findOpportunity(contact_id, CV_PIPELINE);
  if (cvOpp) await moveOpportunity(cvOpp.id, CV_DEMO_SENT);
  else await createConversationOpportunity(contact_id, company_name);

  console.log(`[detect] ✅ ${prospect_email} → positive reply, demo built, warm sequence started`);
}

// ─── Handle negative / unsubscribe cold reply ──────────────────
async function handleNegative(enrollment, msg, isUnsub) {
  const { contact_id, prospect_email } = enrollment;
  await pool.query(`UPDATE enrollments SET status = 'unsubscribed' WHERE id = $1`, [enrollment.id]);
  await tagContact(contact_id, 'aivoice_reply_negative');
  await enableDND(contact_id, 'all');
  await addNote(contact_id,
    `${isUnsub ? 'Unsubscribed' : 'Not interested'} reply to cold email.\n` +
    `From: ${msg.from}\nSubject: ${msg.subject}\n\nReply preview:\n${msg.snippet}`);
  const opp = await findOpportunity(contact_id, OT_PIPELINE);
  if (opp) await moveOpportunity(opp.id, OT_UNSUB_NOT_INTERESTED);
  console.log(`[detect] ${prospect_email} → ${isUnsub ? 'unsubscribed' : 'not interested'}`);
}

// ─── Handle neutral cold reply ─────────────────────────────────
async function handleNeutral(enrollment, msg) {
  const { contact_id, prospect_email } = enrollment;
  await pool.query(`UPDATE enrollments SET status = 'replied' WHERE id = $1`, [enrollment.id]);
  await tagContact(contact_id, 'aivoice_reply_other');
  await addNote(contact_id,
    `Neutral reply to cold email.\n` +
    `From: ${msg.from}\nSubject: ${msg.subject}\n\nReply preview:\n${msg.snippet}`);
  const opp = await findOpportunity(contact_id, OT_PIPELINE);
  if (opp) await moveOpportunity(opp.id, OT_REPLY_RECEIVED);
  console.log(`[detect] ${prospect_email} → neutral reply (Reply Received)`);
}

// ─── Handle warm / ultra_warm reply ────────────────────────────
async function handleWarmReply(enrollment, msg) {
  const { contact_id, prospect_email } = enrollment;
  await pool.query(`UPDATE enrollments SET status = 'replied' WHERE id = $1`, [enrollment.id]);
  await addNote(contact_id,
    `Reply to ${enrollment.phase} sequence.\n` +
    `From: ${msg.from}\nSubject: ${msg.subject}\n\nReply preview:\n${msg.snippet}`);
  const opp = await findOpportunity(contact_id, CV_PIPELINE);
  if (opp) await moveOpportunity(opp.id, CV_REPLY_RECEIVED);
  console.log(`[detect] ${prospect_email} → reply in ${enrollment.phase} (Conversations: Reply Received)`);
}

// ─── Main loop ─────────────────────────────────────────────────
async function detectRepliesAndBounces() {
  try {
    const { rows: mailboxes } = await pool.query(`SELECT email FROM mailboxes`);

    for (const { email } of mailboxes) {
      try {
        const messages = await listRecentInbound(email, { days: 3, max: 50 });

        for (const msg of messages) {
          // ── BOUNCE ─────────────────────────────────────────
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
                    `Cold email bounced.\nSending mailbox: ${email}\nProspect email: ${prospect_email}\n\nEmail DND enabled.`),
                ]);
              }
            }
            continue;
          }

          // ── Find the enrollment by thread ──────────────────
          const { rows: enr } = await pool.query(
            `SELECT * FROM enrollments WHERE thread_id = $1 AND status IN ('active','awaiting_no_reply') LIMIT 1`,
            [msg.threadId]
          );
          if (!enr.length) continue;
          const enrollment = enr[0];

          // ── Warm / ultra_warm thread → Conversations Reply Received ──
          if (enrollment.phase === 'warm' || enrollment.phase === 'ultra_warm') {
            await handleWarmReply(enrollment, msg);
            continue;
          }

          // ── Cold thread → classify ──
          const intent = await classifyReply(msg.subject, msg.snippet);
          console.log(`[detect] ${enrollment.prospect_email} reply classified: ${intent}`);

          if (intent === 'unsubscribe') {
            await handleNegative(enrollment, msg, true);
          } else if (intent === 'negative') {
            await handleNegative(enrollment, msg, false);
          } else if (intent === 'positive') {
            await handlePositive(enrollment, msg);
          } else {
            await handleNeutral(enrollment, msg);
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
