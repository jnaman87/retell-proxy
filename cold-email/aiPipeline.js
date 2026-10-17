'use strict';

/**
 * Creative Copyz - AI reply pipeline
 *
 *   1. Router  : reads the whole thread + the new message and decides
 *                reply | handoff | no_reply | negative
 *   2. Drafter : writes a short reply under strict rules
 *   3. Guards  : deterministic checks (greeting, banned phrases, length, links)
 *   4. Critic  : scores the draft 0-100 against the thread
 *
 * Drafter -> guards -> critic loops up to MAX_ATTEMPTS times. If no draft
 * reaches SCORE_THRESHOLD, or the router / critic says a human is needed,
 * the result is a handoff to Naman.
 */

const OPENAI_KEY      = process.env.OPENAI_API_KEY;
const MODEL           = process.env.AI_MODEL || 'gpt-4.1';
const SCORE_THRESHOLD = Number(process.env.AI_SCORE_THRESHOLD || 80);
const MAX_ATTEMPTS    = Number(process.env.AI_MAX_ATTEMPTS || 3);
const MAX_WORDS       = 70;

const CALENDAR_TOKEN = '{{CALENDAR_LINK}}';

// The only facts the AI may state. Anything outside this list goes to Naman.
const FACTS = [
  'Creative Copyz builds custom AI voice receptionists for service businesses.',
  'The receptionist answers calls 24/7, handles after-hours questions, captures caller details, and can book jobs.',
  'If it cannot answer something, it captures the lead and flags it so nothing slips through.',
  'The demo receptionist on the prospect\'s page is called Emma.',
  'Each demo page stays live for 7 days and allows up to 5 test calls.',
  'Next step for an interested prospect is an onboarding call with Naman, booked through the calendar link.',
  'Naman is the technical director at Creative Copyz. On the onboarding call he can answer any questions they have.',
];

const BANNED_PHRASES = [
  'just following up', 'following up', 'just checking in', 'checking in',
  'just curious', 'curious if', 'curious to', 'curious what', 'circling back',
  'touching base', 'touch base', 'just wanted to', 'quick follow', 'friendly reminder',
  'hope this finds you', 'hope you are well', "hope you're well", 'hope you are doing',
  'did you get a chance', 'had a chance', 'have a chance', 'bumping this', 'any update',
  'just a reminder', 'looking forward to helping', 'absolutely!', 'great question',
];

// ─── OpenAI ──────────────────────────────────────────────────────────────────
async function chatJSON({ system, user, temperature = 0 }) {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY not set');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method : 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body   : JSON.stringify({
      model: MODEL,
      temperature,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) {
    throw new Error(`OpenAI ${r.status}: ${JSON.stringify(data.error || data).slice(0, 300)}`);
  }
  const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  return JSON.parse(content || '{}');
}

// ─── Context helpers ─────────────────────────────────────────────────────────
function renderTranscript(transcript, maxChars = 14000) {
  const blocks = (transcript || []).map((m, i) => {
    const who = m.role === 'us' ? 'US (Creative Copyz)' : 'PROSPECT';
    return `[${i + 1}] ${who} | ${m.date || ''}\n${(m.text || '').trim()}`;
  });
  // Keep the most recent messages if the thread is long.
  let out = '';
  for (let i = blocks.length - 1; i >= 0; i--) {
    const next = blocks[i] + '\n\n' + out;
    if (next.length > maxChars) break;
    out = next;
  }
  return out.trim();
}

function countCalendarLinksSent(transcript, calendarLink) {
  return (transcript || []).filter(m => m.role === 'us' && (m.text || '').includes(calendarLink)).length;
}

function factsBlock(ctx) {
  return [
    ...FACTS,
    `Prospect company: ${ctx.companyName || 'unknown'}${ctx.city ? ', ' + ctx.city : ''}.`,
    ctx.demoUrl
      ? `The prospect has ALREADY been sent their demo page: ${ctx.demoUrl}. Never offer to send a demo again.`
      : 'No demo page has been sent yet.',
    ctx.demoTested ? 'The prospect HAS already tested the demo by calling Emma.' : 'The prospect has not tested the demo yet (as far as we know).',
    `The calendar link has been sent ${ctx.calendarLinksSent} time(s) in this thread.`,
  ].map(f => '- ' + f).join('\n');
}

function phaseGoal(phase) {
  if (phase === 'cold') return 'Get explicit permission to send their personalised demo page. Do not push a call yet.';
  if (phase === 'warm') return 'Get them to test the demo page they already have.';
  return 'Get them onto an onboarding call with Naman.';
}

// ─── 1. Router ───────────────────────────────────────────────────────────────
const ROUTER_SYSTEM = `You triage replies in a sales email thread for Creative Copyz, an agency selling AI voice receptionists.
Read the WHOLE thread, then decide what happens with the prospect's newest message.

Decisions:
- "handoff": a human (Naman, the technical director) must take over. Choose this when ANY of these are true:
  * they ask for a phone call, ask to be called or texted, or share a phone number
  * they ask about pricing, cost, packages, contracts, terms, discounts, or payment
  * they propose a specific day or time, or ask us to pick a time (we cannot book on their behalf)
  * they say they want to buy, sign up, or move forward, and the calendar link has already been sent at least once
  * they ask something that cannot be answered from the FACTS list
  * they seem confused, frustrated, annoyed, or are correcting us
  * the thread already looks repetitive or confusing from their side
  * a wrong or generic reply could cost us this deal
- "reply": a short automated reply can genuinely move things forward using only the FACTS list.
- "no_reply": nothing needs answering (e.g. "thanks", "ok", "got it" when nothing is pending, out-of-office or auto-replies).
- "negative": they are not interested, ask to stop, unsubscribe, or are hostile.

When unsure between "reply" and "handoff", choose "handoff".

Also return:
- "wants_demo": true ONLY if the demo has not been sent yet and they explicitly agree to receive or see it.
- "calendar_link_ok": true only if sharing the booking link is the right next step AND it has not been sent yet, or they explicitly asked for it.

Respond ONLY with JSON:
{"decision":"reply|handoff|no_reply|negative","reason":"one sentence","summary":"one or two sentences on where this prospect stands","wants_demo":false,"calendar_link_ok":false}`;

async function routeMessage(ctx) {
  const user = [
    `PHASE: ${ctx.phase} (goal: ${phaseGoal(ctx.phase)})`,
    '',
    'FACTS:',
    factsBlock(ctx),
    '',
    'THREAD (oldest first):',
    renderTranscript(ctx.transcript),
    '',
    'NEWEST PROSPECT MESSAGE:',
    ctx.latestText,
  ].join('\n');

  const out = await chatJSON({ system: ROUTER_SYSTEM, user });
  const valid = ['reply', 'handoff', 'no_reply', 'negative'];
  return {
    decision        : valid.includes(out.decision) ? out.decision : 'handoff',
    reason          : String(out.reason || ''),
    summary         : String(out.summary || ''),
    wantsDemo       : out.wants_demo === true && !ctx.demoUrl,
    calendarLinkOk  : out.calendar_link_ok === true,
  };
}

// ─── 2. Drafter ──────────────────────────────────────────────────────────────
function drafterSystem(ctx, allowCalendar) {
  return `You are ${ctx.persona.fullName}, ${ctx.persona.title} at Creative Copyz, replying in an email thread.

GOAL FOR THIS PHASE: ${phaseGoal(ctx.phase)}

HOW TO WRITE:
- Start directly with the message. Never open with a greeting, "Hi", "Hey", "Hello", or their name.
- Answer exactly what they just said first. Reply to them, not to a script.
- Keep it short: 1 to 3 sentences, under ${MAX_WORDS} words. Shorter is better when they wrote something short.
- Plain, calm, human tone. No hype, no exclamation marks, no "Absolutely".
- At most one question, and only if it moves things forward.
- Never use these or similar salesy phrases: just following up, checking in, just curious, circling back, touching base, did you get a chance, hope you're well.
- Never repeat something already said in the thread (offers, links, explanations) unless they asked for it.
- Only state things from the FACTS list. Never invent prices, features, timelines, integrations, or promises.
- Any call is with Naman, never with you. When inviting them to a call, introduce him as our technical director who can answer any questions they have, for example: "a quick call with Naman, our technical director, so he can answer any questions you have".
- Never use em dashes.
- No sign-off, name, or signature. The application adds it.
${allowCalendar
  ? `- If inviting them to book, write the placeholder ${CALENDAR_TOKEN} where the booking link goes.`
  : '- Do not include any links. Do not include the booking link.'}

FACTS:
${factsBlock(ctx)}

Respond ONLY with JSON: {"reply":"the email body"}`;
}

async function draftReply(ctx, allowCalendar, feedback) {
  const user = [
    'THREAD (oldest first):',
    renderTranscript(ctx.transcript),
    '',
    'NEWEST PROSPECT MESSAGE (reply to this):',
    ctx.latestText,
    feedback
      ? `\nYOUR PREVIOUS DRAFT WAS REJECTED. Fix these problems:\n- ${feedback.join('\n- ')}`
      : '',
  ].join('\n');

  const out = await chatJSON({ system: drafterSystem(ctx, allowCalendar), user, temperature: 0.4 });
  return String(out.reply || '').replace(/\\n/g, '\n').trim();
}

// ─── 3. Deterministic guards ─────────────────────────────────────────────────
function guardIssues(draft, ctx, allowCalendar) {
  const issues = [];
  const text = String(draft || '').trim();
  const lower = text.toLowerCase();

  if (!text) issues.push('The reply is empty.');
  if (/^(hi|hey|hello|dear|good (morning|afternoon|evening))\b/i.test(text)) {
    issues.push('Starts with a greeting. Start directly with the message.');
  }
  const firstName = (ctx.prospectName || '').trim().split(/\s+/)[0];
  if (firstName && firstName.length > 1 && lower.startsWith(firstName.toLowerCase())) {
    issues.push("Starts with the prospect's name. Start directly with the message.");
  }
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) issues.push(`Uses the banned phrase "${phrase}".`);
  }
  if (/[—–]/.test(text)) issues.push('Contains an em or en dash.');
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) issues.push(`Too long (${words} words). Keep it under ${MAX_WORDS}.`);
  if (/[$£€]\s?\d|\b\d+\s?(usd|dollars|per month|\/mo|a month)\b/i.test(text)) {
    issues.push('Mentions a price. Pricing must be handled by Naman.');
  }
  if (/https?:\/\//i.test(text)) issues.push('Contains a raw link. Links are not allowed in this reply.');
  if (text.includes(CALENDAR_TOKEN) && !allowCalendar) issues.push('Includes the booking link when it is not allowed.');
  if (ctx.demoUrl && /\b(send|share|get)\b.{0,40}\b(demo|link)\b/i.test(text) && /\?/.test(text)) {
    issues.push('Offers to send a demo that has already been sent.');
  }
  if (/\b(sign[- ]?off|best regards|kind regards|cheers,)\b/i.test(text)) issues.push('Contains a sign-off.');
  return issues;
}

// ─── 4. Critic ───────────────────────────────────────────────────────────────
const CRITIC_SYSTEM = `You review a draft email reply before it is sent to a sales prospect. Be strict.
Score it 0 to 100 for how confident you are that sending it is the right move. Start at 100 and deduct:
- Does not directly address what the prospect just said: -40
- Repeats an offer, link, or explanation already in the thread: -30
- States anything not supported by the FACTS: -40
- Sounds salesy, scripted, or pushy (follow-up filler, hype): -25
- Longer than needed for what they wrote: -15
- Contradicts or ignores something earlier in the thread: -30
- Could confuse the prospect: -30
Also set "should_handoff" to true if this situation really needs a human (pricing, phone call request,
scheduling a specific time, confusion, or a question outside the FACTS), regardless of the draft quality.

Respond ONLY with JSON: {"score":0,"issues":["specific problem", "..."],"should_handoff":false}`;

async function critiqueReply(ctx, draft) {
  const user = [
    'FACTS:',
    factsBlock(ctx),
    '',
    'THREAD (oldest first):',
    renderTranscript(ctx.transcript),
    '',
    'NEWEST PROSPECT MESSAGE:',
    ctx.latestText,
    '',
    'DRAFT REPLY:',
    draft,
  ].join('\n');

  const out = await chatJSON({ system: CRITIC_SYSTEM, user });
  const score = Math.max(0, Math.min(100, Number(out.score) || 0));
  return {
    score,
    issues       : Array.isArray(out.issues) ? out.issues.map(String).slice(0, 6) : [],
    shouldHandoff: out.should_handoff === true,
  };
}

// ─── Orchestration ───────────────────────────────────────────────────────────
// ctx: { phase, persona, prospectName, companyName, city, demoUrl, demoTested,
//        calendarLink, transcript, latestText }
async function runPipeline(ctx) {
  ctx.calendarLinksSent = countCalendarLinksSent(ctx.transcript, ctx.calendarLink);

  let route;
  try {
    route = await routeMessage(ctx);
  } catch (e) {
    console.error('[ai] router failed:', e.message);
    return { action: 'handoff', reason: `Router error: ${e.message}`, summary: '', attempts: [] };
  }
  console.log(`[ai] router -> ${route.decision} | ${route.reason}`);

  if (route.decision === 'negative') return { action: 'negative', reason: route.reason };
  if (route.decision === 'no_reply') return { action: 'no_reply', reason: route.reason };
  if (route.decision === 'handoff') {
    return { action: 'handoff', reason: route.reason, summary: route.summary, attempts: [] };
  }
  if (ctx.phase === 'cold' && route.wantsDemo) {
    return { action: 'send_demo', reason: route.reason, summary: route.summary };
  }

  const allowCalendar = route.calendarLinkOk;
  const attempts = [];
  let feedback = null;

  for (let i = 1; i <= MAX_ATTEMPTS; i++) {
    let draft;
    try {
      draft = await draftReply(ctx, allowCalendar, feedback);
    } catch (e) {
      console.error(`[ai] drafter failed (attempt ${i}):`, e.message);
      attempts.push({ attempt: i, draft: '', score: 0, issues: [e.message] });
      continue;
    }

    const guards = guardIssues(draft, ctx, allowCalendar);
    if (guards.length) {
      console.log(`[ai] attempt ${i} failed guards: ${guards.join(' | ')}`);
      attempts.push({ attempt: i, draft, score: 0, issues: guards });
      feedback = guards;
      continue;
    }

    let review;
    try {
      review = await critiqueReply(ctx, draft);
    } catch (e) {
      console.error(`[ai] critic failed (attempt ${i}):`, e.message);
      attempts.push({ attempt: i, draft, score: 0, issues: [e.message] });
      continue;
    }
    console.log(`[ai] attempt ${i} score ${review.score}${review.shouldHandoff ? ' (critic wants handoff)' : ''}`);
    attempts.push({ attempt: i, draft, score: review.score, issues: review.issues });

    if (review.shouldHandoff) {
      return {
        action : 'handoff',
        reason : `Reviewer flagged this for a human: ${review.issues.join('; ') || route.reason}`,
        summary: route.summary,
        attempts,
      };
    }
    if (review.score >= SCORE_THRESHOLD) {
      const text = allowCalendar
        ? draft.split(CALENDAR_TOKEN).join(ctx.calendarLink)
        : draft;
      return {
        action        : 'reply',
        text,
        score         : review.score,
        includesCalendar: allowCalendar && draft.includes(CALENDAR_TOKEN),
        summary       : route.summary,
        attempts,
      };
    }
    feedback = review.issues.length ? review.issues : ['Score too low. Make it shorter and more directly responsive.'];
  }

  return {
    action : 'handoff',
    reason : `No draft reached a score of ${SCORE_THRESHOLD} in ${MAX_ATTEMPTS} attempts.`,
    summary: route.summary,
    attempts,
  };
}

module.exports = {
  runPipeline,
  // exported for tests
  guardIssues, renderTranscript, countCalendarLinksSent, CALENDAR_TOKEN, SCORE_THRESHOLD, MAX_ATTEMPTS,
};
