'use strict';

const pool = require('./pool');
const { sendEmail } = require('./gmail-sender');
const { buildDemoForEnrollment } = require('./demoBuilder');

const {
  findOpportunity,
  moveOpportunity,
  createConversionOpportunity,
  OT_PIPELINE,
  OT_UNSUBSCRIBED,
} = require('./replyDetector');

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const CALENDAR_LINK = 'https://api.leadconnectorhq.com/widget/bookings/aivoice-onboarding';
const FOLLOWUP_DAYS = 2;

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

// Build OpenAI message history array
function buildMessages(enrollment, systemPrompt, lastUserMsg) {
  const history = Array.isArray(enrollment.conversation_history)
    ? enrollment.conversation_history
    : [];

  const recent = history.slice(-10);

  return [
    {
      role: 'system',
      content: systemPrompt
    },
    ...recent.map(function (h) {
      return {
        role: h.role === 'prospect' ? 'user' : 'assistant',
        content: h.content
      };
    }),
    {
      role: 'user',
      content: lastUserMsg
    }
  ];
}

// Call OpenAI and return parsed JSON
async function callOpenAI(messages) {
  const res = await fetch(
    'https://api.openai.com/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + OPENAI_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.7,
        response_format: {
          type: 'json_object'
        },
        messages: messages
      })
    }
  );

  const data = await res.json();

  const parsed = JSON.parse(
    data.choices &&
    data.choices[0] &&
    data.choices[0].message &&
    data.choices[0].message.content
      ? data.choices[0].message.content
      : '{}'
  );

  if (parsed.reply) {
    parsed.reply = parsed.reply.replace(/\\n/g, '\n');
  }

  return parsed;
}

// System prompt for replying to an incoming message
function replySystemPrompt(enrollment, persona) {
  const firstName =
    ((enrollment.prospect_name || '').split(' ')[0] || 'there').trim();

  const demoLine = enrollment.demo_page_url
    ? 'A personalised AI Voice Receptionist demo has been built: ' +
      enrollment.demo_page_url
    : 'No demo has been built yet.';

  return [
    'You are ' + persona.fullName + ', ' + persona.title +
      ' at Creative Copyz (an AI solutions agency).',
    'Replying to a business owner who received outreach about an AI Voice Receptionist.',
    '',
    'PRIMARY GOAL DEPENDS ON THE LEAD\'S CURRENT SEQUENCE PHASE:',
    '- cold: get the prospect to explicitly agree to receive their personalised demo link. Do NOT try to book an onboarding call at this stage.',
    '- warm: get the prospect to test the personalised demo that has been shared. Do NOT push for an onboarding call unless they have already tested or clearly want to move forward.',
    '- ultra_warm: help the prospect schedule an AI Voice Receptionist Onboarding Call with Naman.',
    '- Current phase: ' + (enrollment.phase || 'cold'),
    '',
    'STRICT RULES:',
    '- NEVER use em dashes in any form',
    '- Do not generate a greeting or salutation. The application adds the greeting.',
    '- Do not generate a sign-off, closing, sender name, job title, or company signature. The application adds the signature.',
    '- Body: 2 to 4 sentences, no filler phrases',
    'CLASSIFICATION:',
'- positive: the prospect explicitly agrees to receive the demo or explicitly asks you to send, share, show, or provide the demo or demo link.',
'- neutral: the prospect asks a question, requests information, expresses curiosity, or responds without explicitly agreeing to receive the demo.',
'- negative: the prospect says they are not interested, asks to stop receiving emails, unsubscribes, opts out, or otherwise clearly rejects further outreach.',
'- Never treat a question as positive merely because it contains words like "interesting", "sounds good", "cost", or "how much".',
'- A demo is created ONLY for positive replies.',
'- A neutral reply MUST NOT create a demo.',
'- A negative reply MUST NOT create a demo or send any further email.',
    '- warm phase: focus on getting the prospect to try/test the personalised demo already shared. Do NOT push for an onboarding call merely because they ask questions.',
    '- ultra_warm phase: if the prospect wants to move forward, talk, schedule, or asks for next steps, set sendCalLink to true.',
'- ultra_warm phase: if conv_status is calendar_sent, do NOT set sendCalLink to true unless the prospect explicitly asks for the calendar link again.',
    '- Whenever a call is mentioned, it must be framed as a call with Naman, never as a call with you/the email persona.',
    '- Do not repeat the calendar link if they already have it unless they ask',
    '- cold phase, neutral reply: answer the prospect’s question clearly, then end by asking for explicit permission to send a tailored AI Voice Receptionist demo link for their business.',
'- The cold-phase CTA must be about sending the tailored demo link or letting them test the tailored receptionist. Do not end with a generic offer for more information, more details, or a call.',
'- A prospect becomes positive only when they explicitly agree to receive, see, test, or be sent that demo.',
    '- warm phase: end with an open-ended question that encourages them to test the demo or tell you what they think after testing it.',
    '- ultra_warm phase: end with an open-ended question that moves toward scheduling a call with Naman.',
    '- Do not say that a demo has been prepared, created, generated, built, sent, or is ready unless the application provides a demo URL.',
    '- If no demo URL is provided, do not claim that the prospect has been sent a demo.',
    '- Never break a sentence across multiple lines. Only start a new paragraph after a full stop, question mark, or exclamation mark.',
    '',
    'CONTEXT:',
    '- Company: ' + (enrollment.company_name || 'their business') +
      ' (' + (enrollment.niche || '') + ')',
    '- City: ' + (enrollment.prospect_city || ''),
    '- ' + demoLine,
    '- The application, not the AI, is the final authority on whether a demo should be created.',
    '',
    'Respond ONLY with valid JSON. Do not include markdown, code fences, or any text outside the JSON object.',
'The JSON must contain exactly these fields:',
'{"classification":"positive","reply":"full email body without greeting or signature","sendCalLink":false}',
'"classification" must be exactly one of: "positive", "neutral", "negative".',
'"reply" must contain the actual email body.',
'"sendCalLink" must be a boolean: true or false, never a string.'
  ].join('\n');
}

// System prompt for follow-up after calendar link sent
function followUpSystemPrompt(enrollment, persona) {
  return [
    'You are ' + persona.fullName + ', ' + persona.title + ' at Creative Copyz.',
    'You sent a booking link for an AI Voice Receptionist Onboarding Call with Naman but have not heard back.',
    'Write a brief friendly follow-up nudge. Include the booking link naturally.',
    '',
    'STRICT RULES:',
    '- NEVER use em dashes in any form',
    '- Do not generate a greeting or salutation. The application adds the greeting.',
    '- Do not generate a sign-off, closing, sender name, job title, or company signature. The application adds the signature.',
    '- Body: 2 to 3 sentences maximum',
    '- Include booking link: ' + CALENDAR_LINK,
    '- Always frame the booking as a call with Naman.',
    '- End with an open-ended question inviting them to confirm the call with Naman, ask if a different time works, or ask if they have any questions.',
    '- Never break a sentence across multiple lines.',
    '',
    'Respond ONLY with valid JSON:',
    '{"reply":"full email body without greeting or signature"}'
  ].join('\n');
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
      /^(?:Hi|Hello|Hey|Dear)\s+[^,\n]+,?\s*/i,
      ''
    )
    .trim();
}

function stripAiSignoff(text) {
  let t = String(text || '').trim();

  t = t.replace(
    /\n\s*(?:Best|Regards|Thanks|Thank you|Cheers|Sincerely),?\s*[\s\S]*$/i,
    ''
  );

  return t.trim();
}

function hasExplicitDemoPermission(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  return (
    /\b(send|share|give|show|provide|forward)\b.{0,100}\b(the\s+)?(demo|link|demo link|demonstration)\b/.test(t) ||
    /\b(the\s+)?(demo|demo link|demonstration)\b.{0,100}\b(send|share|give|show|provide|forward)\b/.test(t) ||
    /\b(i('| )?d|i would|i want|i'd like|i would like|please)\b.{0,100}\b(test|try|see|check out|look at)\b.{0,100}\b(the\s+)?(demo|link|demo link|it)\b/.test(t) ||
    /\b(yes|yeah|yep|sure|okay|ok|absolutely|definitely|sounds good|please do|go ahead)\b.{0,100}\b(send|share|give|show|provide|forward)\b/.test(t)
  );
}

function hasNegativeReply(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  return (
    /\b(not interested|no thanks|no thank you|don't contact|do not contact|stop contacting|stop emailing|remove me|unsubscribe|opt out|opt-out|take me off|leave me alone|not for me|pass on this|no longer interested)\b/.test(t)
  );
}

function hasGenericAffirmation(text) {
  const t = String(text || '')
    .toLowerCase()
    .trim();

  return /^(yes|yeah|yep|sure|okay|ok|absolutely|definitely|sounds good|that sounds good|please do|go ahead|i'd like that|id like that|yes please)[.!]?$/.test(t);
}

function classifyProspectReply(text) {
  const t = String(text || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  if (hasNegativeReply(t)) {
    return 'negative';
  }

  if (
    hasExplicitDemoPermission(t) ||
    hasGenericAffirmation(t)
  ) {
    return 'positive';
  }

  return 'neutral';
}

// Main: handle an incoming reply conversationally
async function handleConversationalReply(enrollment, msg) {

  const persona = getPersona(enrollment.mailbox);

  const history = Array.isArray(enrollment.conversation_history)
    ? enrollment.conversation_history
    : [];

  const withIncoming = [
    ...history,
    {
      role: 'prospect',
      content: 'Subject: ' + msg.subject + '\n' + msg.snippet,
      timestamp: new Date().toISOString(),
      phase: enrollment.phase,
      msgId: msg.id
    }
  ];
  if (
  enrollment.phase === 'ultra_warm' &&
  enrollment.conv_status === 'calendar_sent'
) {
  console.log(
    `[conv] ${enrollment.prospect_email} already received calendar link -- conversational reply only`
  );
}

  let aiResult;

  try {
    const system = replySystemPrompt(
      {
        ...enrollment,
        conversation_history: withIncoming
      },
      persona
    );

    const messages = buildMessages(
      {
        ...enrollment,
        conversation_history: withIncoming
      },
      system,
      'Subject: ' + msg.subject + '\n\n' + msg.snippet
    );

    const parsed = await callOpenAI(messages);

const validClassifications = ['positive', 'neutral', 'negative'];

const aiClassification =
  validClassifications.includes(parsed.classification)
    ? parsed.classification
    : 'neutral';

const classification =
  hasGenericAffirmation(msg.snippet || '')
    ? 'positive'
    : aiClassification;

if (classification === 'negative') {
  await handleNegativeReply(
    enrollment,
    msg,
    msg.snippet || ''
  );

  return;
}

    const guardedBuildDemo =
  enrollment.phase === 'cold' &&
  classification === 'positive';

    aiResult = {
  reply: parsed.reply || null,
  buildDemo: guardedBuildDemo,
  sendCalLink: Boolean(parsed.sendCalLink),
  classification
};

  if (!aiResult.reply) {
    console.error(
      '[conv] empty reply for ' +
      enrollment.prospect_email
    );
    return;
  }

  // Demo creation happens BEFORE the final email is constructed.
  let demoUrl = enrollment.demo_page_url || null;
  let demoWasSent = false;

  if (
    enrollment.phase === 'cold' &&
    aiResult.buildDemo
  ) {
    try {
      demoUrl = await buildDemoForEnrollment(enrollment);

      if (!demoUrl) {
        throw new Error('No demo URL returned');
      }

      await pool.query(
        'UPDATE enrollments SET demo_page_url = $1 WHERE id = $2',
        [
          demoUrl,
          enrollment.id
        ]
      );

      demoWasSent = true;
    } catch (err) {
      console.error(
        '[conv] demo creation failed for ' +
        enrollment.prospect_email +
        ':',
        err.message
      );

      demoWasSent = false;
      demoUrl = enrollment.demo_page_url || null;
    }
  }

  // Application owns the greeting and signature.
  // Strip anything GPT may have generated first.
  let replyText = stripAiSignoff(aiResult.reply);
  if (enrollment.phase === 'ultra_warm' && aiResult.sendCalLink) {
  replyText =
    `Absolutely! Let's schedule an onboarding call with Naman. ` +
    `You can choose a convenient time here: ${CALENDAR_LINK}. ` +
    `Looking forward to helping you get started!`;
}
  replyText = stripAiGreeting(replyText);

  // If the demo was successfully created, completely override the AI
  // response so the email contains the real URL.
  if (
  classification === 'positive' &&
  demoWasSent &&
  demoUrl
) {
  replyText =
  'Absolutely. Here is a tailored AI Voice Receptionist page for ' +
  (enrollment.company_name || 'your business') +
  ': ' +
  demoUrl +
  '\n\n' +
  'It shows how it could support your business, and you can test the demo agent directly on the page.';
} else if (!demoUrl) {
    // Prevent the AI from falsely claiming that a demo was created or sent.
    replyText = replyText
      .replace(
        /\b(?:I've|I have)\s+(?:prepared|created|built|generated|made|sent|shared)\s+(?:your|the)\s+(?:personalised|personalized)?\s*(?:AI Voice Receptionist\s+)?demo\b[.!]?/gi,
        ''
      )
      .replace(
        /\b(?:your|the)\s+(?:personalised|personalized)?\s*(?:AI Voice Receptionist\s+)?demo\s+(?:is|has been)\s+(?:ready|prepared|created|built|generated|available)\b[.!]?/gi,
        ''
      )
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  const firstName = getFirstName(
    enrollment.prospect_name
  );

  // Add exactly one deterministic greeting.
  if (firstName) {
    replyText =
      'Hi ' +
      firstName +
      ',\n\n' +
      replyText;
  }

  // Add exactly one deterministic signature.
  const signOff =
    persona.fullName +
    '\n' +
    persona.title +
    ' | Creative Copyz';

  const cleanReply = toHtmlEmail(
    cleanReplyFormatting(
      replyText
    ) +
    '\n\n' +
    signOff
  );

  let sendResult;

  try {
    sendResult = await sendInThread(
      enrollment,
      msg.subject,
      cleanReply
    );
  } catch (e) {
    console.error(
      '[conv] send failed for ' +
      enrollment.prospect_email +
      ':',
      e.message
    );
    return;
  }

  await tagContact(
  enrollment.contact_id,
  'aivoice_reply_received'
);

  // Only tag the demo as sent after the email containing the demo URL
  // was successfully handed off to Gmail.
  if (
  demoWasSent &&
  typeof demoUrl === 'string' &&
  /^https?:\/\//i.test(demoUrl)
) {
  const contactId = enrollment.contact_id;

  // Contact tag
  await tagContact(
    contactId,
    'aivoice_demo_sent'
  );

  // Pipeline I → Demo Sent
  const outboundOpp = await findOpportunity(
    contactId,
    OT_PIPELINE
  );

  if (outboundOpp) {
    await moveOpportunity(
      outboundOpp.id,
      OT_DEMO_SENT
    );
  } else {
    console.error(
      `[conv] No outbound opportunity found for ${contactId} when demo was sent`
    );
  }

  // Pipeline II → create new opportunity at Demo Sent
  await createConversionOpportunity(
    contactId,
    enrollment.company_name
  );
}

  const finalHistory = [
    ...withIncoming,
    {
      role: 'assistant',
      content: cleanReply,
      timestamp: new Date().toISOString(),
      phase: enrollment.phase
    }
  ];

  const newConvStatus =
    aiResult.sendCalLink
      ? 'calendar_sent'
      : 'active';

  // Sending the demo is the cold -> warm transition.
  // Delay the first warm-sequence email.
  const nextPhase = demoWasSent
    ? 'warm'
    : enrollment.phase;

  const nextStatus = demoWasSent
    ? 'active'
    : 'replied';

  await pool.query(
    'UPDATE enrollments SET status = $1, phase = $2, ' +
    'step = CASE WHEN $3 THEN 0 ELSE step END, ' +
    'demo_page_url = CASE WHEN $3 THEN $4 ELSE demo_page_url END, ' +
    'next_send_at = CASE WHEN $3 THEN NOW() + INTERVAL \'2 days\' ELSE next_send_at END, ' +
    'conversation_history = $5::jsonb, ' +
    'conv_status = $6, ' +
    'calendar_sent_at = CASE WHEN $7 THEN NOW() ELSE calendar_sent_at END, ' +
    'last_message_id = $8, ' +
    'last_conv_at = NOW(), ' +
    'conv_followup_at = CASE WHEN $7 THEN NOW() + INTERVAL \'' +
    FOLLOWUP_DAYS +
    ' days\' ELSE conv_followup_at END ' +
    'WHERE id = $9',
    [
      nextStatus,
      nextPhase,
      demoWasSent,
      demoUrl,
      JSON.stringify(finalHistory),
      newConvStatus,
      aiResult.sendCalLink,
      sendResult.messageId,
      enrollment.id
    ]
  );

  console.log(
    '[conv] ' +
    enrollment.prospect_email +
    ' -> replied (' +
    newConvStatus +
    ')' +
    (demoWasSent ? ' -> warm, demo sent' : '')
  );
} catch (e) {
    console.error(
      '[conv] error while handling reply for ' +
        enrollment.prospect_email +
        ':',
      e.message
    );
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


// Periodic: send follow-up when no reply after calendar link sent
async function sendConvFollowUp(enrollment) {
  const persona = getPersona(enrollment.mailbox);

  let replyText;

  try {
    const system = followUpSystemPrompt(
      enrollment,
      persona
    );

    const messages = buildMessages(
      enrollment,
      system,
      '[no reply since calendar link sent - send follow-up]'
    );

    const parsed = await callOpenAI(messages);

    replyText = parsed.reply || null;
  } catch (e) {
    console.error(
      '[conv] followup error for ' +
      enrollment.prospect_email +
      ':',
      e.message
    );
    return;
  }

  if (!replyText) {
    return;
  }

  // Keep greeting/signature deterministic here too.
  replyText = stripAiSignoff(replyText);
  replyText = stripAiGreeting(replyText);

  const firstName = getFirstName(
    enrollment.prospect_name
  );

  if (firstName) {
    replyText =
      'Hi ' +
      firstName +
      ',\n\n' +
      replyText;
  }

  const signOff =
    persona.fullName +
    '\n' +
    persona.title +
    ' | Creative Copyz';

  const cleanFollowUp = toHtmlEmail(
    cleanReplyFormatting(
      replyText
    ) +
    '\n\n' +
    signOff
  );

  const history = Array.isArray(
    enrollment.conversation_history
  )
    ? enrollment.conversation_history
    : [];

  const lastSubject =
    history
      .filter(function (h) {
        return h.role === 'prospect';
      })
      .slice(-1)[0]
      ?.content
      ?.split('\n')[0]
      ?.replace('Subject: ', '') ||
    'our conversation';

  let sendResult;

  try {
    sendResult = await sendInThread(
      enrollment,
      lastSubject,
      cleanFollowUp
    );
  } catch (e) {
    console.error(
      '[conv] followup send failed for ' +
      enrollment.prospect_email +
      ':',
      e.message
    );
    return;
  }

  const updatedHistory = [
    ...history,
    {
      role: 'assistant',
      content: cleanFollowUp,
      timestamp: new Date().toISOString(),
      type: 'followup'
    }
  ];

  await pool.query(
    'UPDATE enrollments SET ' +
    'conversation_history = $1::jsonb, ' +
    'last_message_id = $2, ' +
    'last_conv_at = NOW(), ' +
    'conv_followup_at = NOW() + INTERVAL \'' +
    FOLLOWUP_DAYS +
    ' days\' ' +
    'WHERE id = $3',
    [
      JSON.stringify(updatedHistory),
      sendResult.messageId,
      enrollment.id
    ]
  );

  console.log(
    '[conv] ' +
    enrollment.prospect_email +
    ' -> follow-up sent, next in ' +
    FOLLOWUP_DAYS +
    ' days'
  );
}

module.exports = {
  handleConversationalReply,
  sendConvFollowUp,
  getPersona
};
