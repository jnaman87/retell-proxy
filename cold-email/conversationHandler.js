'use strict';
const pool        = require('./pool');
const { sendEmail } = require('./gmail-sender');

const OPENAI_KEY    = process.env.OPENAI_API_KEY;
const CALENDAR_LINK = 'https://api.leadconnectorhq.com/widget/bookings/aivoice-onboarding';
const FOLLOWUP_DAYS = 2;

// Mailbox personas
const MAILBOX_PERSONAS = {
  'anne@ccopyz.com'           : { fullName: 'Anne Schull',    title: 'Director of Client Solutions' },
  'billy@ccopyz.com'          : { fullName: 'Billy Cooper',   title: 'Business Development Manager' },
  'caitlyn@ccopyz.com'        : { fullName: 'Caitlyn Smoke',  title: 'Account Executive' },
  'claire@creativecopyz.org'  : { fullName: 'Claire Dunphy',  title: 'Partnership Manager' },
  'clint@creativecopyz.org'   : { fullName: 'Clint Mac',      title: 'Head of Business Development' },
  'emily@creativecopyz.org'   : { fullName: 'Emily Hathway',  title: 'Client Success Manager' },
  'glenn@ccopyz.org'          : { fullName: 'Glenn Ponting',  title: 'AI Solutions Director' },
  'hailey@ccopyz.org'         : { fullName: 'Hailey Henz',    title: 'Account Manager' },
  'harry@ccopyz.net'          : { fullName: 'Harry Garrold',  title: 'Business Development Executive' },
  'helen@ccopyz.org'          : { fullName: 'Helen Morgan',   title: 'Director of Partnerships' },
  'james@ccopyz.net'          : { fullName: 'James Walkway',  title: 'Head of AI Outreach' },
  'josh@ccopyz.net'           : { fullName: 'Josh Walker',    title: 'Account Executive' },
  'joshua@cretivecopyz.com'   : { fullName: 'Joshua Speed',   title: 'Business Development Lead' },
'justin@cretivecopyz.com'   : { fullName: 'Justin Albus',   title: 'Director of Sales' },
  'mike@cretivecopyz.com'     : { fullName: 'Mike Ten',       title: 'Senior Account Manager' },
  'phil@creativecopyz.net'    : { fullName: 'Phil Jazz',      title: 'Partnership Director' },
  'samuel@creativecopyz.net'  : { fullName: 'Samuel Borne',   title: 'AI Solutions Advisor' },
  'vanessa@creativecopyz.net' : { fullName: 'Vanessa Cruz',   title: 'Client Relations Manager' },
};

function getPersona(mailbox) {
  return MAILBOX_PERSONAS[mailbox] || { fullName: 'Creative Copyz Team', title: 'Account Manager' };
}

// Build OpenAI message history array
function buildMessages(enrollment, systemPrompt, lastUserMsg) {
  const history = Array.isArray(enrollment.conversation_history) ? enrollment.conversation_history : [];
  const recent  = history.slice(-10);
  return [
    { role: 'system', content: systemPrompt },
    ...recent.map(h => ({ role: h.role === 'prospect' ? 'user' : 'assistant', content: h.content })),
    { role: 'user', content: lastUserMsg },
  ];
}

// Call OpenAI and return parsed JSON
async function callOpenAI(messages) {
  const res  = await fetch('https://api.openai.com/v1/chat/completions', {
    method : 'POST',
    headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body   : JSON.stringify({ model: 'gpt-4o-mini', temperature: 0.7, response_format: { type: 'json_object' }, messages }),
  });
  const data = await res.json();
  const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}');
    if (parsed.reply) parsed.reply = parsed.reply.replace(/\\n/g, '\n');
    return parsed;
}

// System prompt for replying to an incoming message
function replySystemPrompt(enrollment, persona) {
  const firstName = ((enrollment.prospect_name || '').split(' ')[0] || 'there').trim();
  const demoLine  = enrollment.demo_page_url
    ? 'A personalised AI Voice Receptionist demo has been built: ' + enrollment.demo_page_url
    : 'No demo has been built yet.';
  return [
    'You are ' + persona.fullName + ', ' + persona.title + ' at Creative Copyz (an AI solutions agency).',
    'Replying to a business owner who received outreach about an AI Voice Receptionist.',
    '',
    'YOUR SINGLE GOAL: book an AI Voice Receptionist Onboarding Call.',
    '',
    'STRICT RULES:',
    '- NEVER use em dashes in any form',
    '- Salutation must be exactly: Hi ' + firstName + ',',
    '- Sign-off must be exactly: ' + persona.fullName + '\n' + persona.title + ' | Creative Copyz',
    '- Body: 2 to 4 sentences, no filler phrases',
    '- If the prospect agrees to a call or asks to book, set sendCalLink to true and include this link naturally: ' + CALENDAR_LINK,
    '- Do not repeat the link if they already have it unless they ask',
    '- Always end your reply with an open-ended question -- invite them to book the onboarding call, ask about their current setup, their biggest challenge answering calls, or what they would like to know more about.',
    '- Never break a sentence across multiple lines. Only start a new paragraph after a full stop, question mark, or exclamation mark. Do not insert a line break mid-sentence.',
    '',
    'CONTEXT:',
    '- Company: ' + (enrollment.company_name || 'their business') + ' (' + (enrollment.niche || '') + ')',
    '- City: ' + (enrollment.prospect_city || ''),
    '- ' + demoLine,
    '',
    'Respond ONLY with valid JSON: {"reply": "full email text", "sendCalLink": true or false}',
  ].join('\n');
     }

// System prompt for follow-up after calendar link sent
function followUpSystemPrompt(enrollment, persona) {
  const firstName = ((enrollment.prospect_name || '').split(' ')[0] || 'there').trim();
  return [
    'You are ' + persona.fullName + ', ' + persona.title + ' at Creative Copyz.',
    'You sent a booking link for an AI Voice Receptionist Onboarding Call but have not heard back.',
    'Write a brief friendly follow-up nudge. Include the booking link naturally.',
    '',
    'STRICT RULES:',
    '- NEVER use em dashes in any form',
    '- Salutation must be exactly: Hi ' + firstName + ',',
    '- Sign-off must be exactly: ' + persona.fullName + '\n' + persona.title + ' | Creative Copyz',
    '- Body: 2 to 3 sentences maximum',
    '- Include booking link: ' + CALENDAR_LINK,
    '- Always end your reply with an open-ended question -- invite them to confirm the booking, ask if a different time works, or if they have any questions.',
    '- Never break a sentence across multiple lines. Only start a new paragraph after a full stop, question mark, or exclamation mark.',
    '',
    'Respond ONLY with valid JSON: {"reply": "full email text"}',
  ].join('\n');
}

// Send a message in the existing Gmail thread
async function sendInThread(enrollment, subject, body) {
  const persona = getPersona(enrollment.mailbox);
  const sub     = subject.startsWith('Re:') ? subject : 'Re: ' + subject;
  return sendEmail({
    mailbox  : enrollment.mailbox,
    fromName : persona.fullName,
    to       : enrollment.prospect_email,
    subject  : sub,
    body     : body + '\n\n---\nTo stop receiving these emails, simply reply with "unsubscribe".',
    threadId : enrollment.thread_id,
    inReplyTo: enrollment.last_message_id,
    references: enrollment.last_message_id,
  });
}

// Post-process AI reply: join lines that break mid-sentence
function cleanReplyFormatting(text) {
    if (!text) return text;
    const lines = text.split('\n');
    const result = []; let buffer = '';
    for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { if (buffer) { result.push(buffer); buffer = ''; } result.push(''); continue; }
          if (buffer) {
                  if (/[.?!]$/.test(buffer.trimEnd())) { result.push(buffer); buffer = trimmed; }
                  else { buffer = buffer.trimEnd() + ' ' + trimmed; }
                } else { buffer = trimmed; }
    }
    if (buffer) result.push(buffer);
    while (result.length && !result[result.length - 1]) result.pop();
    return result.join('\n');
}
// Main: handle an incoming reply conversationally
async function handleConversationalReply(enrollment, msg) {
  const persona  = getPersona(enrollment.mailbox);
  const history  = Array.isArray(enrollment.conversation_history) ? enrollment.conversation_history : [];
  const withIncoming = [
    ...history,
    { role: 'prospect', content: 'Subject: ' + msg.subject + '\n' + msg.snippet, timestamp: new Date().toISOString(), phase: enrollment.phase , msgId: msg.id },
  ];
  let aiResult;
  try {
    const system   = replySystemPrompt({ ...enrollment, conversation_history: withIncoming }, persona);
    const messages = buildMessages({ ...enrollment, conversation_history: withIncoming }, system, 'Subject: ' + msg.subject + '\n\n' + msg.snippet);
    const parsed   = await callOpenAI(messages);
    aiResult = { reply: parsed.reply || null, sendCalLink: Boolean(parsed.sendCalLink) };
  } catch (e) {
    console.error('[conv] OpenAI error for ' + enrollment.prospect_email + ':', e.message);
    return;
  }
  if (!aiResult.reply) { console.error('[conv] empty reply for ' + enrollment.prospect_email); return; }
  const cleanReply = cleanReplyFormatting(aiResult.reply);
  let sendResult;
  try {
    sendResult = await sendInThread(enrollment, msg.subject, cleanReply); 
  } catch (e) {
    console.error('[conv] send failed for ' + enrollment.prospect_email + ':', e.message);
    return;
  }
  const finalHistory = [
    ...withIncoming,
  { role: 'assistant', content: cleanReply, timestamp: new Date().toISOString(), phase: enrollment.phase },  ];
  const newConvStatus = aiResult.sendCalLink ? 'calendar_sent' : 'active';
  await pool.query(
    'UPDATE enrollments SET status = $1, conversation_history = $2::jsonb, conv_status = $3,' +
    ' calendar_sent_at = CASE WHEN $4 THEN NOW() ELSE calendar_sent_at END,' +
    ' last_message_id = $5, last_conv_at = NOW(),' +
    ' conv_followup_at = CASE WHEN $4 THEN NOW() + INTERVAL \'' + FOLLOWUP_DAYS + ' days\' ELSE conv_followup_at END' +
    ' WHERE id = $6',
    ['replied', JSON.stringify(finalHistory), newConvStatus, aiResult.sendCalLink, sendResult.messageId, enrollment.id]
  );
  console.log('[conv] ' + enrollment.prospect_email + ' -> replied (' + newConvStatus + ')');
}

// Periodic: send follow-up when no reply after calendar link sent
async function sendConvFollowUp(enrollment) {
  const persona = getPersona(enrollment.mailbox);
  let replyText;
  try {
    const system   = followUpSystemPrompt(enrollment, persona);
    const messages = buildMessages(enrollment, system, '[no reply since calendar link sent — send follow-up]');
    const parsed   = await callOpenAI(messages);
    replyText = parsed.reply || null;
  } catch (e) {
    console.error('[conv] followup error for ' + enrollment.prospect_email + ':', e.message);
    return;
  }
  if (!replyText) return;
  const cleanFollowUp = cleanReplyFormatting(replyText);
  const history     = Array.isArray(enrollment.conversation_history) ? enrollment.conversation_history : [];
  const lastSubject = history.filter(h => h.role === 'prospect').slice(-1)[0]?.content?.split('\n')[0]?.replace('Subject: ', '') || 'our conversation';
  let sendResult;
  try {
    sendResult = await sendInThread(enrollment, lastSubject, cleanFollowUp); 
  } catch (e) {
    console.error('[conv] followup send failed for ' + enrollment.prospect_email + ':', e.message);
    return;
  }
  const updatedHistory = [
    ...history,
  { role: 'assistant', content: cleanFollowUp, timestamp: new Date().toISOString(), type: 'followup' },  ];
  await pool.query(
    'UPDATE enrollments SET conversation_history = $1::jsonb, last_message_id = $2,' +
    ' last_conv_at = NOW(), conv_followup_at = NOW() + INTERVAL \'' + FOLLOWUP_DAYS + ' days\' WHERE id = $3',
    [JSON.stringify(updatedHistory), sendResult.messageId, enrollment.id]
  );
  console.log('[conv] ' + enrollment.prospect_email + ' -> follow-up sent, next in ' + FOLLOWUP_DAYS + ' days');
}

module.exports = { handleConversationalReply, sendConvFollowUp };
