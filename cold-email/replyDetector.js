'use strict';
const pool                      = require('./pool');
const { listRecentInbound }     = require('./gmail-sender');
const { handleConversationalReply } = require('./conversationHandler');

const CRM_API     = 'https://services.leadconnectorhq.com';
const CRM_API_KEY = process.env.CRM_API_KEY;
const LOCATION_ID = process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';
const OPENAI_KEY  = process.env.OPENAI_API_KEY;

// Pipelines & stages
const OT_PIPELINE             = 'NxoKeydZvDnkQEM8u6sy';
const OT_REPLY_RECEIVED       = 'ad4c1fd7-e0bf-4101-9e1e-3e04a7ec81e2';
const OT_UNSUB_NOT_INTERESTED = '8c9f1603-53f3-4917-97b0-4a89e6507ce6';
const OT_DEMO_SENT            = 'aed1858d-3090-43da-bf3c-3e398795d4da';

const CV_PIPELINE             = 'Sv3XlTtCmzbGrHrZ3BFL';
const CV_DEMO_SENT            = 'aaedbe52-060f-4d30-a6b3-21b3f8222812';
const CV_REPLY_RECEIVED       = 'fa5d74ec-aa3f-44d7-89f4-0e59c41788b9';
const CV_UNSUB_NOT_INTERESTED = '0c0ed89a-9e9c-4e5a-b9c2-d61c5f2d7416';
// CRM helpers
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
        Call:     { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        Email:    { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        SMS:      { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        WhatsApp: { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        GMB:      { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
        FB:       { status: 'active', message: 'Unsubscribed from AI Voice outreach', code: 'UNSUB' },
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
  if (r && r.ok) console.log(`[detect] DND set for ${contactId}`);
}

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
  const r = await fetch(`${CRM_API}/opportunities/${oppId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ pipelineStageId: stageId }),
  });
  if (!r.ok) console.error('[detect] stage move failed:', r.status, await r.text());
  else console.log(`[detect] stage moved ${oppId} -> ${stageId}`);
}

async function createConversionOpportunity(contactId, companyName) {
  try {
    const r = await fetch(`${CRM_API}/opportunities`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipelineId: CV_PIPELINE, locationId: LOCATION_ID,
        name: `${companyName || 'Lead'} -- AI Voice Demo`,
        pipelineStageId: CV_DEMO_SENT, status: 'open', contactId,
      }),
    });
    const d = await r.json();
    if (!r.ok) { console.error('[detect] cv opp create failed:', r.status, JSON.stringify(d)); return; }
    console.log(`[detect] Conversions opp created for ${companyName}`);
    const oppId = d.opportunity && d.opportunity.id;
    if (oppId) {
      await pool.query('UPDATE enrollments SET conversions_opp_id = $1 WHERE contact_id = $2', [oppId, contactId]);
    }
  } catch (e) {
    console.error('[detect] cv opp error:', e.message);
  }
}
// OpenAI reply classification
async function classifyReply(subject, snippet) {
  if (!OPENAI_KEY) {
    const text = `${subject} ${snippet}`.toLowerCase();
    if (/\b(unsubscribe|remove me|opt out|stop emails|take me off)\b/.test(text)) return 'unsubscribe';
    if (/\b(no thanks|not interested|no thank you|stop|don't contact|leave me alone|not for us)\b/.test(text)) return 'negative';
    if (/\b(yes|interested|sounds good|let's talk|call me|send it|tell me more|book|schedule|want to see)\b/.test(text)) return 'positive';
    return 'neutral';
  }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'Classify the intent of a reply to a cold outreach email about an AI voice receptionist.\nRespond ONLY with JSON: {"intent": "positive"|"negative"|"neutral"|"unsubscribe"}\n- positive: interested, wants demo, wants a call, asks for info\n- negative: not interested, no thanks, stop contacting\n- unsubscribe: explicitly asks to unsubscribe / stop emails\n- neutral: anything else' },
          { role: 'user', content: `Subject: ${subject}\n\nReply: ${snippet}` },
        ],
      }),
    });
    const data = await r.json();
    const raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    const parsed = JSON.parse(raw);
    return ['positive', 'negative', 'neutral', 'unsubscribe'].includes(parsed.intent) ? parsed.intent : 'neutral';
  } catch (e) {
    console.error('[detect] classify error:', e.message);
    return 'neutral';
  }
}

// Demo build trigger
async function buildDemoForEnrollment(enrollment) {
  const PORT = process.env.PORT || 3000;
  const base = `http://localhost:${PORT}`;
  try {
    const r = await fetch(`${base}/create-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        niche: enrollment.niche, businessName: enrollment.company_name,
        city: enrollment.prospect_city, coreServices: enrollment.core_services || '',
        tagline: enrollment.tagline || '', primaryColor: enrollment.primary_color || '',
        secondaryColor: enrollment.secondary_color || '', callerFaqs: enrollment.caller_faqs || '',
        contactId: enrollment.contact_id, email: enrollment.prospect_email,
      }),
    });
    const d = await r.json();
    if (!r.ok || !d.demoUrl) { console.error('[detect] demo build failed:', JSON.stringify(d)); return null; }
    return d.demoUrl;
  } catch (e) {
    console.error('[detect] demo build error:', e.message);
    return null;
  }
}

// Handle positive cold reply (build demo, start warm sequence)
async function handlePositive(enrollment, msg) {
  const { contact_id, prospect_email, company_name } = enrollment;
  if (enrollment.positive_reply_at) {
    console.log(`[detect] duplicate positive reply for ${prospect_email} -- skipping`);
    return;
  }
  const demoUrl = await buildDemoForEnrollment(enrollment);
  if (!demoUrl) { console.error(`[detect] demo build failed for ${prospect_email}`); return; }
  await pool.query(
    `UPDATE enrollments SET positive_reply_at = NOW(), phase = 'warm', step = 0,
     status = 'active', next_send_at = NOW() + INTERVAL '2 minutes', demo_page_url = $2 WHERE id = $1`,
    [enrollment.id, demoUrl]
  );
  await tagContact(contact_id, 'aivoice_demo_sent');
  await addNote(contact_id,
    `Positive reply to cold email.\nReplied to: ${msg.from}\nSubject: ${msg.subject}\n\nReply preview:\n${msg.snippet}\n\nDemo: ${demoUrl}\nEnrolled in warm sequence.`);
  const otOpp = await findOpportunity(contact_id, OT_PIPELINE);
  if (otOpp) await moveOpportunity(otOpp.id, OT_DEMO_SENT);
  const cvOpp = await findOpportunity(contact_id, CV_PIPELINE);
  if (cvOpp) await moveOpportunity(cvOpp.id, CV_DEMO_SENT);
  else await createConversionOpportunity(contact_id, company_name);
  console.log(`[detect] ${prospect_email} -> positive reply, demo built, warm sequence started`);
}

// Handle negative/unsubscribe (all phases)
async function handleNegative(enrollment, msg, isUnsub) {
  const { contact_id, prospect_email, phase } = enrollment;
  await pool.query(`UPDATE enrollments SET status = 'unsubscribed' WHERE id = $1`, [enrollment.id]);
  await tagContact(contact_id, 'aivoice_reply_negative');
  await enableDND(contact_id, 'all');
  await addNote(contact_id,
    `${isUnsub ? 'Unsubscribed' : 'Not interested'} reply to ${phase} email.\nFrom: ${msg.from}\nSubject: ${msg.subject}\n\nReply preview:\n${msg.snippet}`);
  if (phase === 'cold') {
    const opp = await findOpportunity(contact_id, OT_PIPELINE);
    if (opp) await moveOpportunity(opp.id, OT_UNSUB_NOT_INTERESTED);
  } else {
    const cvOpp = await findOpportunity(contact_id, CV_PIPELINE);
    if (cvOpp) await moveOpportunity(cvOpp.id, CV_UNSUB_NOT_INTERESTED);
  }
  console.log(`[detect] ${prospect_email} -> ${isUnsub ? 'unsubscribed' : 'not interested'} (phase: ${phase})`);
}
// Main detection loop
async function detectRepliesAndBounces() {
  console.log('[detect] running reply/bounce detection...');
  try {
    const { rows: mailboxes } = await pool.query('SELECT email FROM mailboxes');

    for (const { email } of mailboxes) {
      try {
        const messages = await listRecentInbound(email, { days: 3, max: 50 });

        for (const msg of messages) {
          // Bounce detection
          if (msg.bounced) {
            const result = await pool.query(
              `UPDATE enrollments SET status = 'bounced'
               WHERE thread_id = $1 AND status NOT IN ('unsubscribed', 'bounced', 'completed')
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
                  addNote(contact_id, `Cold email bounced.\nSending mailbox: ${email}\nProspect: ${prospect_email}\n\nEmail DND enabled.`),
                ]);
              }
            }
            continue;
          }

          // Find enrollment -- includes 'replied' so ongoing conversations keep working
          const { rows: enr } = await pool.query(
            `SELECT * FROM enrollments
             WHERE thread_id = $1
               AND status NOT IN ('unsubscribed', 'bounced', 'completed')
             LIMIT 1`,
            [msg.threadId]
          );
          if (!enr.length) continue;
          const enrollment = enr[0];

          // Warm / ultra_warm: classify first, route to negative handler or conversational AI
          if (enrollment.phase === 'warm' || enrollment.phase === 'ultra_warm') {
            const intent = await classifyReply(msg.subject, msg.snippet);
            console.log(`[detect] ${enrollment.prospect_email} ${enrollment.phase} reply classified: ${intent}`);
            if (intent === 'negative' || intent === 'unsubscribe') {
              await handleNegative(enrollment, msg, intent === 'unsubscribe');
            } else {
              await handleConversationalReply(enrollment, msg);
            }
            continue;
          }

          // Cold: classify and route
          const intent = await classifyReply(msg.subject, msg.snippet);
          console.log(`[detect] ${enrollment.prospect_email} cold reply classified: ${intent}`);

          if (intent === 'unsubscribe') {
            await handleNegative(enrollment, msg, true);
          } else if (intent === 'negative') {
            await handleNegative(enrollment, msg, false);
          } else if (intent === 'positive') {
            await handlePositive(enrollment, msg);
          } else {
            // neutral or ongoing conversation -> conversational AI
            await handleConversationalReply(enrollment, msg);
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
