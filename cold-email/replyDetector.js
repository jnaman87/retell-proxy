'use strict';

const pool = require('./pool');
const { listInboxIds, getSender, getInboundMessage } = require('./gmail-sender');
const { handleConversationalReply } = require('./conversationHandler');

const {
  findOpportunity,
  moveOpportunity,
  createConversionOpportunity,
  OT_PIPELINE,
  OT_BOUNCED,
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

// Keyword fallback, used when OpenAI is unavailable or errors
function keywordClassify(subject, snippet) {
  const text = `${subject} ${snippet}`.toLowerCase();
  if (/\b(unsubscribe|remove me|opt out|stop emails|take me off)\b/.test(text)) return 'unsubscribe';
  if (/\b(no thanks|not interested|no thank you|stop|don't contact|leave me alone|not for us|piss off|go away|f[u*]+c?k|fck|stfu)\b/.test(text) || text.includes('🖕')) return 'negative';
  if (/\b(yes|interested|sounds good|call me|send it|book|schedule|want to see)\b/.test(text)) return 'positive';
  return 'neutral';
}
// OpenAI reply classification
async function classifyReply(subject, snippet) {
   if (!OPENAI_KEY) return keywordClassify(subject, snippet);
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
Important: asking about cost, features, setup, or how it works is NOT by itself an agreement to receive a demo.` },
          { role: 'user', content: `Subject: ${subject}\n\nReply: ${snippet}` },
        ],
      }),
    });
    const data = await r.json();
        if (!r.ok || data.error) {
      console.error('[detect] classify API error:', r.status, JSON.stringify(data.error || data));
      return keywordClassify(subject, snippet);
    }
    const raw = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '{}';
    const parsed = JSON.parse(raw);
    return ['positive', 'negative', 'neutral', 'unsubscribe'].includes(parsed.intent) ? parsed.intent : 'neutral';
  } catch (e) {
    console.error('[detect] classify error:', e.message);
        return keywordClassify(subject, snippet);
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
    { role: 'prospect', content: msg.body,
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
    `Positive reply to cold email.\nFrom: ${msg.from}\nSubject: ${msg.subject}\n\nReply:\n${msg.body}`
  );
  const otOpp = await findOpportunity(contact_id, OT_PIPELINE);
  if (otOpp) await moveOpportunity(otOpp.id, OT_REPLY_RECEIVED);

  // Hand off to conversational AI — cold phase must obtain explicit demo permission before any demo is built
  await handleConversationalReply({ ...enrollment, conversation_history: updatedHistory }, msg);
  console.log(`[detect] ${prospect_email} -> positive cold reply, conversational AI engaged`);
}

// Handle negative/unsubscribe (all phases)
async function handleNegative(enrollment, msg, isUnsub) {
  const { contact_id, prospect_email, phase } = enrollment;

  await pool.query(
    `UPDATE enrollments SET status = 'unsubscribed' WHERE id = $1`,
    [enrollment.id]
  );

  await tagContact(contact_id, 'aivoice_reply_negative');
  await enableDND(contact_id, 'all');

  await addNote(
    contact_id,
    `${isUnsub ? 'Unsubscribed' : 'Not interested'} reply to ${phase} email.\nFrom: ${msg.from}\nSubject: ${msg.subject}\n\nReply:\n${msg.body}`
  );

  if (phase === 'cold') {
    const opp = await findOpportunity(contact_id, OT_PIPELINE);

    if (opp) {
      await moveOpportunity(opp.id, OT_UNSUBSCRIBED);
    }
  }

  console.log(
    `[detect] ${prospect_email} -> ${isUnsub ? 'unsubscribed' : 'not interested'} (phase: ${phase})`
  );
}
// Main detection loop
// Last run times, shown on the reply audit page.
const detectorStatus = { lastStartedAt: null, lastFinishedAt: null, lastError: null };

// Sorts an auto-reply into one of three GHL tags.
function autoReplyKind(msg) {
  const text = `${msg.subject || ''}\n${msg.body || msg.snippet || ''}`.toLowerCase();
  if (/permanently closed|no longer in business|out of business|ceased (operations|trading)|(has|have) (permanently )?closed (its|our) doors|(clinic|business|office|company|shop) (is|has) (now )?(permanently )?closed|closed (for good|permanently)/.test(text)) {
    return 'closed';
  }
  if (/no longer (with|at|employed|working|works)|(has|have) left (the|our) (company|business|team)|no longer (active|monitored|in use|checked)|(not|isn't|is not) (being )?monitored|email (address )?(has )?changed|new (email|e-mail) address|update (your |our )?(contact|e-?mail)|please (direct|send|forward|email|contact) .{0,60}@/.test(text)) {
    return 'wrongemail';
  }
  return 'outofoffice';
}
const AUTO_REPLY_TAGS = {
  closed     : 'aivoice_autoreply_closed',
  wrongemail : 'aivoice_autoreply_wrongemail',
  outofoffice: 'aivoice_autoreply_outofoffice',
};

// ─── "Please email X instead" auto-replies ──────────────────────────────────
const GENERIC_INBOXES = new Set(['info', 'office', 'contact', 'admin', 'support', 'sales', 'hello', 'hi', 'team',
  'service', 'services', 'reception', 'frontdesk', 'front', 'mail', 'email', 'help', 'billing', 'accounts',
  'inquiries', 'enquiries', 'inquiry', 'booking', 'bookings', 'dispatch', 'customerservice', 'care', 'main']);

// Finds the address the auto-reply points to. Ignores the sender's own address,
// our sending domains and no-reply addresses.
async function findRedirectAddress(msg, enrollment) {
  const text = `${msg.subject || ''}\n${msg.body || msg.snippet || ''}`;
  const found = (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map(e => e.toLowerCase());
  const { rows } = await pool.query('SELECT email FROM mailboxes');
  const ourDomains = new Set(rows.map(r => r.email.split('@')[1].toLowerCase()));
  const sender = String(msg.from || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  const skip = new Set([String(enrollment.prospect_email || '').toLowerCase(), sender ? sender[0].toLowerCase() : '']);
  return found.find(e =>
    !skip.has(e) &&
    !ourDomains.has(e.split('@')[1]) &&
    !/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)/.test(e)
  ) || null;
}

// First name from an address like mike@ or mary.smith@, or null for shared
// inboxes (info@, office@, or one named after the company).
function nameFromAddress(email, companyName) {
  const local = email.split('@')[0].toLowerCase();
  const first = (local.match(/^([a-z]{2,15})(?:[._-][a-z]+)?$/) || [])[1];
  if (!first || GENERIC_INBOXES.has(first)) return null;
  if (String(companyName || '').toLowerCase().split(/[^a-z]+/).includes(first)) return null;
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// Points the lead at the new address and restarts the cold sequence from
// step 1, in a fresh thread. Updates the GHL contact too.
// Returns false if there's no usable address (the caller then stops the lead).
async function redirectToNewAddress(enrollment, msg) {
  const newEmail = await findRedirectAddress(msg, enrollment);
  if (!newEmail) return false;

  const { rows: dupes } = await pool.query(
    'SELECT id FROM enrollments WHERE lower(prospect_email) = $1 AND id <> $2 LIMIT 1',
    [newEmail, enrollment.id]
  );
  if (dupes.length) {
    console.log(`[detect] ${newEmail} is already enrolled (id ${dupes[0].id}), not restarting ${enrollment.id}`);
    return false;
  }

  const personName = nameFromAddress(newEmail, enrollment.company_name);
  await pool.query(
    `UPDATE enrollments SET
       prospect_email = $2,
       prospect_name = $3,
       phase = 'cold', step = 0, status = 'active',
       thread_id = NULL, last_message_id = NULL, mailbox = NULL, last_sent_at = NULL,
       conversation_history = '[]'::jsonb, conv_status = NULL, conv_followup_at = NULL,
       calendar_sent_at = NULL, positive_reply_at = NULL, demo_page_url = NULL,
       demo_tested_at = NULL, ultra_warm_pending_at = NULL,
       next_send_at = NOW()
     WHERE id = $1`,
    [enrollment.id, newEmail, personName || enrollment.company_name || '']
  );

  if (enrollment.contact_id && CRM_API_KEY) {
    const update = { email: newEmail };
    if (personName) update.firstName = personName;
    try {
      const r = await fetch(`${CRM_API}/contacts/${encodeURIComponent(enrollment.contact_id)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });
      if (!r.ok) console.error(`[detect] GHL email update failed (${r.status}):`, await r.text());
    } catch (e) {
      console.error('[detect] GHL email update error:', e.message);
    }
  }

  console.log(`[detect] ${enrollment.prospect_email} -> redirected to ${newEmail}, cold sequence restarted`);
  return true;
}

// Messages already checked and found to be from non-prospects (warm-up, newsletters).
// Remembered so each run only looks at new mail.
const seenNonProspect = new Set();
function rememberNonProspect(id) {
  seenNonProspect.add(id);
  if (seenNonProspect.size > 50000) seenNonProspect.delete(seenNonProspect.values().next().value);
}

// Finds the inbox messages worth processing in one mailbox:
//  1. replies in a thread we started (includes bounces), and
//  2. emails from an enrolled prospect that started a NEW thread.
// Everything else (warm-up traffic etc.) is skipped without downloading it.
async function collectInbound(mailbox) {
  const candidates = await listInboxIds(mailbox, { days: 3, maxIds: 500 });
  if (!candidates.length) return [];

  const threadIds = [...new Set(candidates.map(c => c.threadId))];
  const { rows: known } = await pool.query(
    'SELECT thread_id FROM enrollments WHERE thread_id = ANY($1::text[])', [threadIds]
  );
  const knownThreads = new Set(known.map(r => r.thread_id));

  const wanted = candidates.filter(c => knownThreads.has(c.threadId));
  const unknown = candidates.filter(c => !knownThreads.has(c.threadId) && !seenNonProspect.has(c.id));

  // Who sent the unknown-thread emails? (light requests, 10 at a time)
  const senders = [];
  for (let i = 0; i < unknown.length; i += 10) {
    const chunk = await Promise.all(unknown.slice(i, i + 10).map(c =>
      getSender(mailbox, c.id).catch(() => null)));
    senders.push(...chunk.filter(Boolean));
  }
  if (senders.length) {
    const { rows: matches } = await pool.query(
      `SELECT id, lower(prospect_email) AS email FROM enrollments
        WHERE lower(prospect_email) = ANY($1::text[])
          AND status NOT IN ('unsubscribed', 'bounced', 'stopped', 'handoff')`,
      [[...new Set(senders.map(x => x.from))]]
    );
    const byEmail = new Map(matches.map(r => [r.email, r.id]));
    for (const x of senders) {
      if (byEmail.has(x.from)) wanted.push({ id: x.id, threadId: x.threadId, matchedEnrollmentId: byEmail.get(x.from) });
      else rememberNonProspect(x.id);
    }
  }

  const out = [];
  for (let i = 0; i < wanted.length; i += 10) {
    const chunk = await Promise.all(wanted.slice(i, i + 10).map(async w => {
      try {
        const msg = await getInboundMessage(mailbox, w.id);
        if (msg.from.includes(mailbox.toLowerCase())) return null;
        if (w.matchedEnrollmentId) msg.matchedEnrollmentId = w.matchedEnrollmentId;
        return msg;
      } catch (e) {
        console.error(`[gmail] message read failed for ${w.id} in ${mailbox}: ${e.message}`);
        return null;
      }
    }));
    out.push(...chunk.filter(Boolean));
  }
  return out;
}

async function detectRepliesAndBounces() {
  detectorStatus.lastStartedAt = new Date().toISOString();
  console.log('[detect] running reply/bounce detection...');
  try {
    const { rows: mailboxes } = await pool.query('SELECT email FROM mailboxes');

    for (const { email } of mailboxes) {
      try {
        const all = await collectInbound(email);

        // Bounces are handled per message. For real replies, keep only the newest
        // message per thread: the AI reads the full thread, so it answers every
        // unanswered message at once instead of once per message.
        const newestByThread = new Map();
        for (const m of all) {
          if (m.bounced) continue;
          const key = m.matchedEnrollmentId ? 'enr:' + m.matchedEnrollmentId : m.threadId;
          const prev = newestByThread.get(key);
          if (!prev || (m.internalDate || 0) > (prev.internalDate || 0)) newestByThread.set(key, m);
        }
        const messages = all.filter(m => m.bounced ||
          newestByThread.get(m.matchedEnrollmentId ? 'enr:' + m.matchedEnrollmentId : m.threadId) === m);

        for (const msg of messages) {
         try {
          msg.body = msg.body || msg.snippet || '';
          // Bounce detection
          if (msg.bounced) {
            const result = await pool.query(
              `UPDATE enrollments
 SET status = 'bounced'
 WHERE thread_id = $1
   AND status NOT IN ('unsubscribed', 'bounced', 'stopped', 'handoff')
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
      addNote(
        contact_id,
        `Cold email bounced.
Sending mailbox: ${email}
Prospect: ${prospect_email}

Email DND enabled.`
      ),
    ]);

    // Move the Outbound Tracking opportunity to Bounced
    const otOpp = await findOpportunity(contact_id, OT_PIPELINE);

    if (otOpp) {
      await moveOpportunity(otOpp.id, OT_BOUNCED);

      console.log(
        `[detect] ${prospect_email} -> Outbound Tracking: Bounced`
      );
    } else {
      console.error(
        `[detect] No outbound opportunity found for ${contact_id} on bounce`
      );
    }
  }
}
            continue;
          }

          // Find active enrollment so ongoing conversations keep working
          // Matched by thread, or by sender address when they started a new thread.
          const { rows: enr } = await pool.query(
            `SELECT * FROM enrollments
 WHERE ${msg.matchedEnrollmentId ? 'id = $1' : 'thread_id = $1'}
   AND status NOT IN ('unsubscribed', 'bounced', 'stopped', 'handoff')
 LIMIT 1`,
            [msg.matchedEnrollmentId || msg.threadId]
          );
          if (!enr.length) continue;
          let enrollment = enr[0];

const msgTsClaim = msg.internalDate || Date.now();
const claim = await pool.query(
  `UPDATE enrollments
      SET last_inbound_message_id = $1,
          last_inbound_at = $3
    WHERE id = $2
      AND last_inbound_message_id IS DISTINCT FROM $1
      AND (last_inbound_at IS NULL OR last_inbound_at < $3)
    RETURNING *`,
  [msg.id, enrollment.id, msgTsClaim]
);

if (!claim.rows.length) {
  console.log(
    `[detect] ${enrollment.prospect_email} -- inbound message ${msg.id} already processed or older than the last one, skipping`
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
const currentContent = 'Subject: ' + msg.subject + '\n' + msg.body;
if (processedIds.has(msg.id) || (lastProspect && lastProspect.content === currentContent)) {
  console.log('[detect] ' + enrollment.prospect_email + ' -- duplicate message, skipping');
  continue;
}

          // Auto-replies: tag the contact by type. A closed business or a dead
          // address stops all further emails; out-of-office leaves the sequence running.
          if (msg.autoReply) {
            const kind = autoReplyKind(msg);
            console.log(`[detect] ${enrollment.prospect_email} -- auto-reply (${kind}): ${msg.subject}`);
            if (enrollment.contact_id) await tagContact(enrollment.contact_id, AUTO_REPLY_TAGS[kind]);
            // "Please email X instead": switch to X and start over.
            if (kind === 'wrongemail' && await redirectToNewAddress(enrollment, msg)) continue;
            if (kind === 'closed' || kind === 'wrongemail') {
              await pool.query(
                `UPDATE enrollments SET status = 'stopped', ultra_warm_pending_at = NULL WHERE id = $1`,
                [enrollment.id]
              );
            }
            continue;
          }

          // Booked leads belong to Naman: honour opt-outs, otherwise hand straight to him.
          if (enrollment.status === 'booked') {
            const intent = await classifyReply(msg.subject, msg.body);
            if (intent === 'unsubscribe') await handleNegative(enrollment, msg, true);
            else await handleConversationalReply(enrollment, msg);
            continue;
          }

          // Warm / ultra_warm: classify first, route to negative handler or conversational AI
          if (enrollment.phase === 'warm' || enrollment.phase === 'ultra_warm') {
            const intent = await classifyReply(msg.subject, msg.body);
            console.log(`[detect] ${enrollment.prospect_email} ${enrollment.phase} reply classified: ${intent}`);
            if (intent === 'negative' || intent === 'unsubscribe') {
  await handleNegative(enrollment, msg, intent === 'unsubscribe');
} else {

  await handleConversationalReply(enrollment, msg);
}
            continue;
          }

          // Cold: classify and route
          const intent = await classifyReply(msg.subject, msg.body);
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
         } catch (msgErr) {
          // One bad message must not stop the rest of this mailbox being processed.
          console.error(`[detect] message ${msg.id} in ${email} failed:`, msgErr.message);
         }
        }
      } catch (err) {
        console.error(`[detect] failed for ${email}:`, err.message);
      }
    }
  } catch (err) {
    detectorStatus.lastError = err.message;
    console.error('[detect] query error:', err.message);
  }
  detectorStatus.lastFinishedAt = new Date().toISOString();
}

module.exports = {
  detectRepliesAndBounces,
  autoReplyKind,
  nameFromAddress,
  detectorStatus,
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
