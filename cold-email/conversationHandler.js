'use strict';

const pool = require('./pool');
const { sendEmail, getThreadTranscript } = require('./gmail-sender');
const { runPipeline } = require('./aiPipeline');
const { buildDemoForEnrollment } = require('./demoBuilder');

const {
  findOpportunity,
  moveOpportunity,
  OT_PIPELINE,
  OT_UNSUBSCRIBED
} = require('./crmHelpers');

const CALENDAR_LINK = 'https://api.leadconnectorhq.com/widget/bookings/aivoice-onboarding';
const FOLLOWUP_DAYS = 2;
const SEQUENCE_PAUSE_DAYS = 3;   // sequence waits this long after any conversation
const HANDOFF_ALERT_EMAIL = process.env.HANDOFF_ALERT_EMAIL || '';

// CRM helper used by the conversational handler.
// Kept local to avoid a circular dependency with replyDetector.js.
const CRM_API = 'https://services.leadconnectorhq.com';
const CRM_API_KEY = process.env.CRM_API_KEY;
const OT_DEMO_SENT = 'aed1858d-3090-43da-bf3c-3e398795d4da';

async function tagContact(contactId, tag) {
  if (!contactId || !tag || !CRM_API_KEY) {
    console.warn(
      '[conv] tag skipped: missing contactId, tag, or CRM_API_KEY'
    );
    return false;
  }

  try {
    const r = await fetch(
      CRM_API + '/contacts/' + encodeURIComponent(contactId) + '/tags',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + CRM_API_KEY,
          Version: '2021-04-15',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tags: [tag] })
      }
    );

    if (!r.ok) {
      console.error(
        '[conv] tag ' + tag + ' failed (' + r.status + '):',
        await r.text()
      );
      return false;
    }

    return true;
  } catch (e) {
    console.error(
      '[conv] tag ' + tag + ' error:',
      e.message
    );
    return false;
  }
}

// Mailbox personas
const MAILBOX_PERSONAS = {
  'anne@ccopyz.com': {
    fullName: 'Anne Schull',
    title: 'Director of Client Solutions'
  },
  'billy@ccopyz.com': {
    fullName: 'Billy Cooper',
    title: 'Business Development Manager'
  },
  'caitlyn@ccopyz.com': {
    fullName: 'Caitlyn Smoke',
    title: 'Account Executive'
  },
  'claire@creativecopyz.org': {
    fullName: 'Claire Dunphy',
    title: 'Partnership Manager'
  },
  'clint@creativecopyz.org': {
    fullName: 'Clint Mac',
    title: 'Head of Business Development'
  },
  'emily@creativecopyz.org': {
    fullName: 'Emily Hathway',
    title: 'Client Success Manager'
  },
  'glenn@ccopyz.org': {
    fullName: 'Glenn Ponting',
    title: 'AI Solutions Director'
  },
  'hailey@ccopyz.org': {
    fullName: 'Hailey Henz',
    title: 'Account Manager'
  },
  'harry@ccopyz.net': {
    fullName: 'Harry Garrold',
    title: 'Business Development Executive'
  },
  'helen@ccopyz.org': {
    fullName: 'Helen Morgan',
    title: 'Director of Partnerships'
  },
  'james@ccopyz.net': {
    fullName: 'James Walkway',
    title: 'Head of AI Outreach'
  },
  'josh@ccopyz.net': {
    fullName: 'Josh Walker',
    title: 'Account Executive'
  },
  'joshua@cretivecopyz.com': {
    fullName: 'Joshua Speed',
    title: 'Business Development Lead'
  },
  'justin@cretivecopyz.com': {
    fullName: 'Justin Albus',
    title: 'Director of Sales'
  },
  'mike@cretivecopyz.com': {
    fullName: 'Mike Ten',
    title: 'Senior Account Manager'
  },
  'phil@creativecopyz.net': {
    fullName: 'Phil Jazz',
    title: 'Partnership Director'
  },
  'samuel@creativecopyz.net': {
    fullName: 'Samuel Borne',
    title: 'AI Solutions Advisor'
  },
  'vanessa@creativecopyz.net': {
    fullName: 'Vanessa Cruz',
    title: 'Client Relations Manager'
  }
};

function getPersona(mailbox) {
  return MAILBOX_PERSONAS[mailbox] || {
    fullName: 'Creative Copyz Team',
    title: 'Account Manager'
  };
}


// Send a message in the existing Gmail thread
async function sendInThread(enrollment, subject, body) {
  const persona = getPersona(enrollment.mailbox);

  const sub = subject.startsWith('Re:')
    ? subject
    : 'Re: ' + subject;

  return sendEmail({
    mailbox: enrollment.mailbox,
    fromName: persona.fullName,
    to: enrollment.prospect_email,
    subject: sub,
    body:
      body +
      '<hr style="border:none;border-top:1px solid #eee;margin:20px 0;">' +
      '<p style="color:#999;font-size:11px;margin:0;">' +
      'To stop receiving these emails, reply with "unsubscribe".' +
      '</p>',
    threadId: enrollment.thread_id,
    inReplyTo: enrollment.last_message_id,
    references: enrollment.last_message_id
  });
}

// Post-process AI reply: join lines that break mid-sentence
function cleanReplyFormatting(text) {
  if (!text) {
    return text;
  }

  const lines = text.split('\n');
  const paragraphs = [];
  let buffer = '';

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (buffer) {
        paragraphs.push(buffer);
        buffer = '';
      }
      continue;
    }

    if (buffer) {
      const endsWithPunct = /[.?!]$/.test(buffer.trimEnd());

      if (endsWithPunct) {
        paragraphs.push(buffer);
        buffer = trimmed;
      } else {
        buffer = buffer.trimEnd() + ' ' + trimmed;
      }
    } else {
      buffer = trimmed;
    }
  }

  if (buffer) {
    paragraphs.push(buffer);
  }

  return paragraphs.join('\n\n');
}

function toHtmlEmail(text) {
  const paragraphs = text
    .split('\n\n')
    .map(function (p) {
      return p.replace(/\n/g, '<br>');
    })
    .map(function (p) {
      return '<p style="margin:0 0 14px 0;line-height:1.6;">' +
        p +
        '</p>';
    })
    .join('');

  return '<div style="font-family:Arial,sans-serif;font-size:14px;color:#333;max-width:600px;">' +
    paragraphs +
    '</div>';
}

function getFirstName(name) {
  const value = String(name || '').trim();
  return value ? value.split(/\s+/)[0] : '';
}

function stripAiGreeting(text) {
  return String(text || '')
    .replace(
      /^(?:Hi|Hello|Hey|Dear|Good (?:morning|afternoon|evening))\b(?:[ \t]+[^,\n!]+)?[,!]?\s*/i,
      ''
    )
    .trim()
    .replace(/^./, c => c.toUpperCase());
}

function stripAiSignoff(text) {
  let t = String(text || '').trim();

  t = t.replace(
    /\n\s*(?:Best|Regards|Thanks|Thank you|Cheers|Sincerely),?\s*[\s\S]*$/i,
    ''
  );

  return t.trim();
}

async function addNote(contactId, body) {
  if (!contactId || !CRM_API_KEY) return;
  await fetch(CRM_API + '/contacts/' + encodeURIComponent(contactId) + '/notes', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + CRM_API_KEY,
      Version: '2021-04-15',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ body })
  }).catch(e => console.error('[conv] note failed:', e.message));
}

function signOff(persona) {
  return persona.fullName + '\n' + persona.title + ' | Creative Copyz';
}

function buildEmailHtml(text, persona) {
  const body = cleanReplyFormatting(stripAiGreeting(stripAiSignoff(text)));
  return toHtmlEmail(body + '\n\n' + signOff(persona));
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Thread as plain text, oldest first. Gmail is the source of truth; the stored
// history is the fallback if Gmail can't be read.
async function loadTranscript(enrollment) {
  try {
    const t = await getThreadTranscript(enrollment.mailbox, enrollment.thread_id);
    if (t.length) return t;
  } catch (e) {
    console.error('[conv] transcript read failed for ' + enrollment.prospect_email + ':', e.message);
  }
  const history = Array.isArray(enrollment.conversation_history) ? enrollment.conversation_history : [];
  return history.map(h => ({
    role: h.role === 'prospect' ? 'prospect' : 'us',
    date: h.timestamp || '',
    text: String(h.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  }));
}

// Every prospect message since our last email, so two quick replies are
// answered once, together.
function latestProspectText(transcript, msg) {
  const out = [];
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === 'us') break;
    out.unshift(transcript[i].text);
  }
  const joined = out.filter(Boolean).join('\n\n').trim();
  return joined || String(msg.body || msg.snippet || '').trim();
}

function appendHistory(enrollment, entries) {
  const history = Array.isArray(enrollment.conversation_history) ? enrollment.conversation_history : [];
  return [...history, ...entries].slice(-40);
}

function replySubject(msg, transcript) {
  const subject = (msg && msg.subject) ||
    (transcript.length && transcript[transcript.length - 1].subject) || 'our conversation';
  return subject.startsWith('Re:') ? subject : 'Re: ' + subject;
}

// ─── Human handoff ───────────────────────────────────────────────────────────
const HANDOFF_NOTICE =
  "Thanks for this. I've passed our conversation to Naman, our director, and he'll take it from here personally. " +
  'Expect a reply from him in this thread soon.';

async function alertNaman(enrollment, { headline, reason, summary, latestText, transcript, attempts }) {
  if (!HANDOFF_ALERT_EMAIL) {
    console.error('[handoff] HANDOFF_ALERT_EMAIL is not set, alert not emailed for ' + enrollment.prospect_email);
    return;
  }

  const recent = (transcript || []).slice(-6).map(m =>
    '<p style="margin:0 0 10px 0;"><b>' + (m.role === 'us' ? 'Us' : 'Prospect') + '</b> ' +
    escapeHtml(m.date || '') + '<br>' + escapeHtml(m.text || '').replace(/\n/g, '<br>') + '</p>'
  ).join('');

  const drafts = (attempts || []).filter(a => a.draft).map(a =>
    '<li>Score ' + a.score + ': ' + escapeHtml(a.draft) +
    (a.issues && a.issues.length ? '<br><i>' + escapeHtml(a.issues.join('; ')) + '</i>' : '') + '</li>'
  ).join('');

  const html =
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222;max-width:680px;">' +
    '<h2 style="margin:0 0 12px 0;">' + escapeHtml(headline) + '</h2>' +
    '<p><b>Prospect:</b> ' + escapeHtml(enrollment.prospect_name || '') + ' &lt;' + escapeHtml(enrollment.prospect_email) + '&gt;<br>' +
    '<b>Company:</b> ' + escapeHtml(enrollment.company_name || '') + (enrollment.prospect_city ? ', ' + escapeHtml(enrollment.prospect_city) : '') + '<br>' +
    '<b>Phase:</b> ' + escapeHtml(enrollment.phase || '') + '<br>' +
    '<b>Reply from mailbox:</b> ' + escapeHtml(enrollment.mailbox) + '<br>' +
    (enrollment.demo_page_url ? '<b>Demo:</b> ' + escapeHtml(enrollment.demo_page_url) + '<br>' : '') +
    '<b>Enrollment id:</b> ' + enrollment.id + '</p>' +
    '<p><b>Why:</b> ' + escapeHtml(reason || '') + '</p>' +
    (summary ? '<p><b>Where they stand:</b> ' + escapeHtml(summary) + '</p>' : '') +
    '<p><b>Their latest message:</b><br>' + escapeHtml(latestText || '').replace(/\n/g, '<br>') + '</p>' +
    (drafts ? '<p><b>Rejected AI drafts:</b></p><ul>' + drafts + '</ul>' : '') +
    '<hr><p><b>Recent thread:</b></p>' + recent +
    '<hr><p style="color:#666;font-size:12px;">All automated emails to this lead are paused. ' +
    'Reply to them from ' + escapeHtml(enrollment.mailbox) + ' in the same thread. To hand the lead back to the AI, run:<br>' +
    "<code>UPDATE enrollments SET status = 'active', conv_status = 'active' WHERE id = " + enrollment.id + ';</code></p>' +
    '</div>';

  try {
    await sendEmail({
      mailbox: enrollment.mailbox,
      fromName: 'Creative Copyz Alerts',
      to: HANDOFF_ALERT_EMAIL,
      subject: '[Handoff] ' + (enrollment.company_name || enrollment.prospect_email) + ': ' + (headline || 'needs you'),
      body: html
    });
    console.log('[handoff] alert emailed for ' + enrollment.prospect_email);
  } catch (e) {
    console.error('[handoff] alert email failed for ' + enrollment.prospect_email + ':', e.message);
  }
}

async function handoffToNaman(enrollment, msg, transcript, latestText, result) {
  const persona = getPersona(enrollment.mailbox);
  const alreadyHandedOff = enrollment.status === 'handoff';
  let sendResult = null;

  // Tell the prospect once. Later messages in a handed-off thread only alert Naman.
  if (!alreadyHandedOff) {
    try {
      sendResult = await sendInThread(enrollment, replySubject(msg, transcript), buildEmailHtml(HANDOFF_NOTICE, persona));
    } catch (e) {
      console.error('[handoff] notice send failed for ' + enrollment.prospect_email + ':', e.message);
    }
  }

  const history = appendHistory(enrollment, [
    { role: 'prospect', content: latestText, timestamp: new Date().toISOString(), phase: enrollment.phase, msgId: msg.id },
    ...(sendResult ? [{ role: 'assistant', content: HANDOFF_NOTICE, timestamp: new Date().toISOString(), type: 'handoff' }] : [])
  ]);

  await pool.query(
    `UPDATE enrollments
        SET status = 'handoff',
            conv_status = 'human_handoff',
            handoff_at = COALESCE(handoff_at, NOW()),
            handoff_reason = $2,
            ultra_warm_pending_at = NULL,
            conversation_history = $3::jsonb,
            last_message_id = COALESCE($4, last_message_id),
            last_conv_at = NOW()
      WHERE id = $1`,
    [enrollment.id, result.reason || '', JSON.stringify(history), sendResult ? sendResult.messageId : null]
  );

  if (!alreadyHandedOff) {
    await tagContact(enrollment.contact_id, 'aivoice_human_handoff');
    await addNote(enrollment.contact_id,
      'AI handed this conversation to Naman.\nReason: ' + (result.reason || '') +
      (result.summary ? '\nSummary: ' + result.summary : '') +
      '\n\nLatest message:\n' + latestText);
  }

  await alertNaman(enrollment, {
    headline: alreadyHandedOff ? 'New message in a thread you own' : 'Prospect needs you',
    reason: alreadyHandedOff ? 'The prospect wrote again after the handoff.' : result.reason,
    summary: result.summary,
    latestText,
    transcript,
    attempts: result.attempts
  });

  console.log('[handoff] ' + enrollment.prospect_email + ' -> handed to Naman (' + (result.reason || '') + ')');
}

// ─── Main: handle an incoming reply ──────────────────────────────────────────
async function handleConversationalReply(enrollment, msg) {
  const persona = getPersona(enrollment.mailbox);

  try {
    const transcript = await loadTranscript(enrollment);
    const latestText = latestProspectText(transcript, msg);

    // A thread Naman owns never gets an AI reply.
    if (enrollment.status === 'handoff') {
      await handoffToNaman(enrollment, msg, transcript, latestText, { reason: 'Prospect wrote again after handoff.' });
      return;
    }

    // Leads who already booked a call with Naman go straight to him.
    if (enrollment.status === 'booked') {
      await handoffToNaman(enrollment, msg, transcript, latestText, {
        reason: 'This lead has already booked a call and has written in again.'
      });
      return;
    }

    const result = await runPipeline({
      phase: enrollment.phase || 'cold',
      persona,
      prospectName: enrollment.prospect_name,
      companyName: enrollment.company_name,
      city: enrollment.prospect_city,
      demoUrl: enrollment.demo_page_url || null,
      demoTested: Boolean(enrollment.demo_tested_at),
      calendarLink: CALENDAR_LINK,
      transcript,
      latestText
    });

    if (result.action === 'negative') {
      await handleNegativeReply(enrollment, msg, latestText);
      return;
    }

    if (result.action === 'handoff') {
      await handoffToNaman(enrollment, msg, transcript, latestText, result);
      return;
    }

    if (result.action === 'no_reply') {
      const history = appendHistory(enrollment, [
        { role: 'prospect', content: latestText, timestamp: new Date().toISOString(), phase: enrollment.phase, msgId: msg.id }
      ]);
      await pool.query(
        'UPDATE enrollments SET conversation_history = $1::jsonb, last_conv_at = NOW() WHERE id = $2',
        [JSON.stringify(history), enrollment.id]
      );
      console.log('[conv] ' + enrollment.prospect_email + ' -> no reply needed (' + result.reason + ')');
      return;
    }

    // ── Cold lead explicitly asked for the demo ──────────────────────────────
    let replyText;
    let demoWasSent = false;
    let demoUrl = enrollment.demo_page_url || null;

    if (result.action === 'send_demo') {
      try {
        demoUrl = await buildDemoForEnrollment(enrollment);
        if (!demoUrl) throw new Error('No demo URL returned');
        demoWasSent = true;
      } catch (err) {
        console.error('[conv] demo creation failed for ' + enrollment.prospect_email + ':', err.message);
        await handoffToNaman(enrollment, msg, transcript, latestText, {
          reason: 'Prospect asked for the demo but the demo build failed: ' + err.message,
          summary: result.summary
        });
        return;
      }
      replyText =
        'Here it is, built for ' + (enrollment.company_name || 'your business') + ': ' + demoUrl +
        '\n\nYou can call Emma straight from the page and hear how she handles your calls.';
    } else {
      replyText = result.text;
    }

    const html = buildEmailHtml(replyText, persona);
    let sendResult;
    try {
      sendResult = await sendInThread(enrollment, replySubject(msg, transcript), html);
    } catch (e) {
      console.error('[conv] send failed for ' + enrollment.prospect_email + ':', e.message);
      return;
    }

    await tagContact(enrollment.contact_id, 'aivoice_reply_received');

    if (demoWasSent) {
      await tagContact(enrollment.contact_id, 'aivoice_demo_sent');
      const outboundOpp = await findOpportunity(enrollment.contact_id, OT_PIPELINE);
      if (outboundOpp) await moveOpportunity(outboundOpp.id, OT_DEMO_SENT);
      else console.error('[conv] No outbound opportunity found for ' + enrollment.contact_id + ' when demo was sent');
    }

    const history = appendHistory(enrollment, [
      { role: 'prospect', content: latestText, timestamp: new Date().toISOString(), phase: enrollment.phase, msgId: msg.id },
      { role: 'assistant', content: replyText, timestamp: new Date().toISOString(), phase: enrollment.phase, score: result.score || null }
    ]);

    const calendarSent = Boolean(result.includesCalendar);

    // Demo sent = cold -> warm, warm sequence starts in 2 days.
    // Any other reply pauses the sequence so emails don't talk over the conversation.
    await pool.query(
      `UPDATE enrollments SET
         status = 'active',
         phase = CASE WHEN $2 THEN 'warm' ELSE phase END,
         step = CASE WHEN $2 THEN 0 ELSE step END,
         demo_page_url = CASE WHEN $2 THEN $3 ELSE demo_page_url END,
         next_send_at = CASE
           WHEN $2 THEN NOW() + INTERVAL '2 days'
           WHEN next_send_at IS NULL THEN NULL
           ELSE GREATEST(next_send_at, NOW() + INTERVAL '${SEQUENCE_PAUSE_DAYS} days')
         END,
         conversation_history = $4::jsonb,
         conv_status = CASE WHEN $5 THEN 'calendar_sent' ELSE COALESCE(NULLIF(conv_status, 'human_handoff'), 'active') END,
         calendar_sent_at = CASE WHEN $5 THEN NOW() ELSE calendar_sent_at END,
         conv_followup_at = CASE WHEN $5 THEN NOW() + INTERVAL '${FOLLOWUP_DAYS} days' ELSE conv_followup_at END,
         last_message_id = $6,
         last_conv_at = NOW()
       WHERE id = $1`,
      [enrollment.id, demoWasSent, demoUrl, JSON.stringify(history), calendarSent, sendResult.messageId]
    );

    console.log('[conv] ' + enrollment.prospect_email + ' -> replied' +
      (result.score ? ' (score ' + result.score + ')' : '') +
      (demoWasSent ? ' -> warm, demo sent' : '') +
      (calendarSent ? ' -> calendar link sent' : ''));
  } catch (e) {
    console.error('[conv] error while handling reply for ' + enrollment.prospect_email + ':', e.message);
  }
}

async function moveOpportunityToUnsubscribed(contactId) {
  if (!contactId) {
    return false;
  }

  try {
    const opportunity = await findOpportunity(
      contactId,
      OT_PIPELINE
    );

    if (!opportunity) {
      console.warn(
        '[conv] no outbound opportunity found for ' + contactId
      );
      return false;
    }

    await moveOpportunity(
      opportunity.id,
      OT_UNSUBSCRIBED
    );

    return true;
  } catch (e) {
    console.error(
      '[conv] opportunity stage error:',
      e.message
    );
    return false;
  }
}

async function handleNegativeReply(enrollment, msg, text) {
  const t = String(text || '').toLowerCase();

  await tagContact(
    enrollment.contact_id,
    'aivoice_reply_negative'
  );

  if (/\b(unsubscribe|opt out|opt-out|remove me|stop emailing|stop contacting|take me off)\b/.test(t)) {
    await tagContact(
      enrollment.contact_id,
      'aivoice_reply_negative'
    );

    await setContactDnd(enrollment.contact_id);
  }

  await moveOpportunityToUnsubscribed(enrollment.contact_id);

  await pool.query(
    'UPDATE enrollments SET status = $1, conv_status = $2, last_conv_at = NOW() WHERE id = $3',
    [
      'stopped',
      'negative',
      enrollment.id
    ]
  );

  console.log(
    '[conv] ' +
    enrollment.prospect_email +
    ' -> negative, outbound stopped'
  );
}

async function setContactDnd(contactId) {
  if (!contactId || !CRM_API_KEY) {
    return false;
  }

  try {
    const r = await fetch(
      CRM_API + '/contacts/' + encodeURIComponent(contactId),
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer ' + CRM_API_KEY,
          Version: '2021-04-15',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          dnd: true
        })
      }
    );

    if (!r.ok) {
      console.error(
        '[conv] DND failed (' + r.status + '):',
        await r.text()
      );
      return false;
    }

    return true;
  } catch (e) {
    console.error('[conv] DND error:', e.message);
    return false;
  }
}

// Periodic: one nudge, only when nothing else is going out to this lead.
// Fixed wording, so it can never drift into "just following up" filler.
async function sendConvFollowUp(enrollment) {
  const persona = getPersona(enrollment.mailbox);
  const text =
    'Here is the link to grab a time with Naman whenever suits: ' + CALENDAR_LINK +
    '\n\nHe will walk you through how this would run for ' + (enrollment.company_name || 'your business') + '.';

  const transcript = await loadTranscript(enrollment);
  const subject = (transcript.find(m => m.subject) || {}).subject || (enrollment.company_name || 'our conversation');

  let sendResult;
  try {
    sendResult = await sendInThread(enrollment, subject, buildEmailHtml(text, persona));
  } catch (e) {
    console.error('[conv] nudge send failed for ' + enrollment.prospect_email + ':', e.message);
    return;
  }

  const history = appendHistory(enrollment, [
    { role: 'assistant', content: text, timestamp: new Date().toISOString(), type: 'followup' }
  ]);

  await pool.query(
    `UPDATE enrollments SET
       conversation_history = $1::jsonb,
       last_message_id = $2,
       last_conv_at = NOW(),
       conv_status = 'calendar_nudged',
       conv_followup_at = NULL
     WHERE id = $3`,
    [JSON.stringify(history), sendResult.messageId, enrollment.id]
  );

  console.log('[conv] ' + enrollment.prospect_email + ' -> single calendar nudge sent');
}

module.exports = {
  handleConversationalReply,
  sendConvFollowUp,
  getPersona,
  // exported for tests
  latestProspectText,
  buildEmailHtml
};
