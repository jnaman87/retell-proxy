'use strict';

const pool = require('./pool');
const { listRecentInbound } = require('./gmail-sender');
const { handleConversationalReply } = require('./conversationHandler');

const {
  findOpportunity,
  moveOpportunity,
  createConversionOpportunity,
  OT_PIPELINE,
  OT_REPLY_RECEIVED,
  OT_UNSUBSCRIBED,
  OT_NO_REPLIES,
  OT_DEMO_SENT,
  CV_PIPELINE,
  CV_DEMO_SENT,
  CV_DEMO_TESTED,
  CV_DEMO_EXPIRED,
  CV_UNSUBSCRIBED,
  CV_CALL_BOOKED,
  CV_NO_SHOW,
  CV_CLOSED_WON
} = require('./crmHelpers');

const CRM_API = 'https://services.leadconnectorhq.com';
const CRM_API_KEY = process.env.CRM_API_KEY;
const LOCATION_ID =
  process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';

const OPENAI_KEY = process.env.OPENAI_API_KEY;

// CRM helpers
async function tagContact(contactId, tag) {
  if (!contactId || !tag || !CRM_API_KEY) {
    console.error(
      '[detect] tag skipped: missing contactId, tag, or CRM_API_KEY'
    );
    return false;
  }

  try {
    const r = await fetch(
      `${CRM_API}/contacts/${encodeURIComponent(contactId)}/tags`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CRM_API_KEY}`,
          Version: '2021-04-15',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tags: [tag] }),
      }
    );

    const responseText = await r.text();

    if (!r.ok) {
      console.error(
        `[detect] tag ${tag} failed for ${contactId}: ${r.status} ${responseText}`
      );
      return false;
    }

    console.log(
      `[detect] tag applied: ${tag} -> ${contactId}`
    );

    return true;
  } catch (e) {
    console.error(
      `[detect] tag ${tag} request failed for ${contactId}:`,
      e.message
    );
    return false;
  }
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

// OpenAI reply classification
async function classifyReply(subject, snippet) {
  if (!OPENAI_KEY) {
    const text = `${subject} ${snippet}`.toLowerCase();
    if (/\b(unsubscribe|remove me|opt out|stop emails|take me off)\b/.test(text)) return 'unsubscribe';
    if (/\b(no thanks|not interested|no thank you|stop|don't contact|leave me alone|not for us)\b/.test(text)) return 'negative';
    if (/\b(yes|interested|sounds good|call me|send it|book|schedule|want to see)\b/.test(text)) return 'positive';
    return 'neutral';
  }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini', temperature: 0, response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `Classify the intent of a reply to a cold outreach email about an AI voice receptionist.
Respond ONLY with JSON: {"intent": "positive"|"negative"|"neutral"|"unsubscribe"}
- positive: explicit interest, explicit request for the demo, or explicit request to move forward/book a call
- negative: not interested, no thanks, stop contacting
- unsubscribe: explicitly asks to unsubscribe / stop emails
- neutral: questions or information requests that do not explicitly express interest or permission to proceed, including pricing questions such as "How much would it cost?"
Important: asking about cost, features, setup, or how it works is NOT by itself an agreement to receive a demo.` },,
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

// Handle positive cold reply (record interest, then let conversational AI obtain explicit demo permission)
async function handlePositive(enrollment, msg) {
  const { contact_id, prospect_email } = enrollment;
  if (enrollment.positive_reply_at) {
    console.log(`[detect] duplicate positive reply for ${prospect_email} -- skipping`);
    return;
  }

  // Store reply in history, mark positive_reply_at — do NOT build demo yet
  const updatedHistory = [
    ...(Array.isArray(enrollment.conversation_history) ? enrollment.conversation_history : []),
    { role: 'prospect', content: 'Subject: ' + msg.subject + '\n' + msg.snippet,
      timestamp: new Date().toISOString(), phase: 'cold', msgId: msg.id }
  ];
  await pool.query(
  `UPDATE enrollments SET
     positive_reply_at = NOW(),
     conversation_history = $2::jsonb
   WHERE id = $1`,
  [enrollment.id, JSON.stringify(updatedHistory)]
);

  // CRM — tag + move to Reply Received (not Demo Sent)
  await tagContact(contact_id, 'aivoice_reply_received');
  await addNote(contact_id,
    `Positive reply to cold email.\nFrom: ${msg.from}\nSubject: ${msg.subject}\n\nReply:\n${msg.snippet}`
  );
  const otOpp = await findOpportunity(contact_id, OT_PIPELINE);
  if (otOpp) await moveOpportunity(otOpp.id, OT_REPLY_RECEIVED);

  // Hand off to conversational AI — cold phase must obtain explicit demo permission before any demo is built
  await handleConversationalReply({ ...enrollment, conversation_history: updatedHistory }, msg);
  console.log(`[detect] ${prospect_email} -> positive cold reply, conversational AI engaged`);
}

// Handle negative/unsubscribe (all phases)
await pool.query(`UPDATE enrollments SET status = 'unsubscribed' WHERE id = $1`, [enrollment.id]);
  await tagContact(contact_id, 'aivoice_reply_negative');
  await enableDND(contact_id, 'all');
  await addNote(contact_id,
    `${isUnsub ? 'Unsubscribed' : 'Not interested'} reply to ${phase} email.\nFrom: ${msg.from}\nSubject: ${msg.subject}\n\nReply preview:\n${msg.snippet}`);
  if (phase === 'cold') {
    const opp = await findOpportunity(contact_id, OT_PIPELINE);
    if (opp) await moveOpportunity(opp.id, OT_UNSUBSCRIBED);
  } else {
    const cvOpp = await findOpportunity(contact_id, CV_PIPELINE);
    if (cvOpp) await moveOpportunity(cvOpp.id, CV_UNSUBSCRIBED);
  }
  console.log(`[detect] ${prospect_email} -> ${isUnsub ? 'unsubscribed' : 'not interested'} (phase: ${phase})`);
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
              `UPDATE enrollments
 SET status = 'bounced'
 WHERE thread_id = $1
   AND status NOT IN ('unsubscribed', 'bounced', 'completed', 'booked')
 RETURNING contact_id, prospect_email`
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
   AND status NOT IN ('unsubscribed', 'bounced', 'completed', 'booked')
 LIMIT 1`,
            [msg.threadId]
          );
          if (!enr.length) continue;
          let enrollment = enr[0];

const claim = await pool.query(
  `UPDATE enrollments
      SET last_inbound_message_id = $1
    WHERE id = $2
      AND (last_inbound_message_id IS DISTINCT FROM $1)
    RETURNING *`,
  [msg.id, enrollment.id]
);

if (!claim.rows.length) {
  console.log(
    `[detect] ${enrollment.prospect_email} -- inbound message ${msg.id} already processed, skipping`
  );
  continue;
}

enrollment = claim.rows[0];
          const msgTs     = msg.internalDate ? Number(msg.internalDate) : msg.date ? new Date(msg.date).getTime() : null;
const enrolledTs = enrollment.enrolled_at ? new Date(enrollment.enrolled_at).getTime() : null;
if (msgTs && enrolledTs && msgTs < enrolledTs) {
  console.log(`[detect] ${enrollment.prospect_email} -- message predates enrollment, skipping`);
  continue;
}
          // Dedup: skip if this Gmail message was already processed
          const processedIds = new Set((enrollment.conversation_history || []).filter(h => h.role === 'prospect' && h.msgId).map(h => h.msgId));
const lastProspect = (enrollment.conversation_history || []).slice().reverse().find(h => h.role === 'prospect');
const currentContent = 'Subject: ' + msg.subject + '\n' + msg.snippet;
if (processedIds.has(msg.id) || (lastProspect && lastProspect.content === currentContent)) {
  console.log('[detect] ' + enrollment.prospect_email + ' -- duplicate message, skipping');
  continue;
}

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
  const otOpp = await findOpportunity(
    enrollment.contact_id,
    OT_PIPELINE
  );

  if (otOpp) {
    await moveOpportunity(
      otOpp.id,
      OT_REPLY_RECEIVED
    );
  } else {
    console.error(
      `[detect] No outbound opportunity found for ${enrollment.contact_id} on neutral reply`
    );
  }

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

module.exports = {
  detectRepliesAndBounces,
  tagContact,

  // Re-export these for any other files that may already use them.
  findOpportunity,
  moveOpportunity,
  createConversionOpportunity,

  OT_PIPELINE,
  OT_UNSUBSCRIBED,

  CV_PIPELINE,
  CV_UNSUBSCRIBED
};
