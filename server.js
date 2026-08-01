'use strict';

/**
 * Creative Copyz — AI Voice Receptionist Proxy
 * Deploy on Railway | Requires Node 18+
 *
 * Endpoints:
 *   GET  /                     → health check + env status
 *   POST /create-agent         → create Retell LLM + Agent (2-step)
 *   POST /create-web-call      → create Retell web call token
 *   GET  /check-availability   → fetch free calendar slots
 *   GET  /check-specific-time  → check if a specific slot is free
 *   POST /book-appointment     → book a GHL calendar appointment
 */

const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch'); // v2 — CommonJS compatible

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Environment ──────────────────────────────────────────────────────────────
const RETELL_API_KEY    = process.env.RETELL_API_KEY;
const CRM_API_KEY       = process.env.CRM_API_KEY;
const CRM_CALENDAR_ID   = process.env.CRM_CALENDAR_ID;
const CRM_LOCATION_ID   = process.env.CRM_LOCATION_ID   || 'dImqkGzlWhmVksSXL1WY';
const RAILWAY_PUBLIC_URL = process.env.RAILWAY_PUBLIC_URL;

const RETELL  = 'https://api.retellai.com';
const CRM_API = 'https://services.leadconnectorhq.com';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());

// Request logger
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Helper: guard missing env vars ───────────────────────────────────────────
function guardEnv(varName, res) {
  if (!process.env[varName] && varName !== 'CRM_LOCATION_ID') {
    res.status(500).json({ error: `Server misconfiguration: ${varName} is not set` });
    return false;
  }
  return true;
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    service : 'Creative Copyz — Voice AI Proxy',
    status  : 'ok',
    ts      : new Date().toISOString(),
    config  : {
      RETELL_API_KEY     : RETELL_API_KEY     ? '✅ set' : '❌ MISSING',
      CRM_API_KEY        : CRM_API_KEY        ? '✅ set' : '❌ MISSING',
      CRM_CALENDAR_ID    : CRM_CALENDAR_ID    ? '✅ set' : '❌ MISSING',
      CRM_LOCATION_ID    : CRM_LOCATION_ID,
      RAILWAY_PUBLIC_URL : RAILWAY_PUBLIC_URL || '(not set — optional)',
    },
  });
});

// ─── System prompt builder ────────────────────────────────────────────────────
function buildSystemPrompt({ bizName, city, focus, tagline, coreServices, niche }) {
  const today = new Date().toLocaleDateString('en-US', {
    weekday : 'long',
    year    : 'numeric',
    month   : 'long',
    day     : 'numeric',
  });

  const bn = bizName      || 'the business';
  const ct = city         || 'your area';
  const ni = niche        || 'emergency services';
  const fo = focus        || ni;
  const tg = tagline      || 'Always ready when you need us most';
  const cs = coreServices || '24/7 emergency response, rapid dispatch, on-site support';

  return `You are Emma, an AI voice receptionist demo built for ${bn} — a ${ni} company serving ${ct}.

Today's date is ${today}.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS PROFILE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Business Name : ${bn}
City / Market : ${ct}
Niche         : ${ni}
Specialty     : ${fo}
Tagline       : "${tg}"
Core Services : ${cs}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
YOUR ROLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are an AI demo showing ${bn} what an always-on AI receptionist would sound like for their business.
You handle inbound calls professionally, answer questions about the business, and guide serious
prospects to book a discovery call. You are NOT a real employee — you are demonstrating the technology.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PERSONALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• Warm, calm, confident — never robotic, never rushed
• Industry-fluent — use terminology natural to ${ni}
• Steady under pressure — emergency callers need a composed voice, not panic
• Concise — give the caller what they need and move things forward

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CALL FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OPENING (always start with):
"Thank you for calling ${bn}, this is Emma. How can I help you today?"

DURING THE CALL:
1. Listen and identify what the caller needs
2. Emergency / service request → acknowledge urgency, confirm you're capturing details and escalating
3. General inquiry → answer helpfully using the business profile above
4. Prospect / business owner asking about the AI service → move to booking flow (see below)

PRICING (only if asked about the AI receptionist service):
• $497 per month — month-to-month, no long-term contracts
• Covers full setup, voice customisation, calendar integration, and ongoing support
• Standard carrier charges apply for any outbound calls (varies by usage volume)
• Do NOT negotiate or discount pricing on this call

BOOKING A DISCOVERY CALL:
If the prospect (business owner or decision-maker) wants to learn more or get started:
→ Say: "Fantastic! On this demo page there's a 'Book a Discovery Call' button — just click it
   and you can grab a time that works for you. It only takes about a minute."
→ IMPORTANT: Do NOT try to collect their availability yourself. Always direct them to the button on the page.

WHAT YOU NEVER DO:
• Process payments or collect card information
• Make guarantees about real emergency response times (this is a demo)
• Fabricate information not included in the business profile above
• Say "As an AI..." or break the demo immersion unnecessarily

CLOSING:
When the conversation reaches a natural end —
→ Thank them warmly
→ Remind them: "The 'Book a Discovery Call' button is right there on the page whenever you're ready."
→ Sign off: "Have a wonderful day — and remember, your business never has to miss another call."
→ End the call gracefully.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TONE GUARDRAILS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Professional, warm, confident
✅ Emergency-ready — steady, reassuring voice under pressure
✅ Solution-focused — move conversations forward
❌ Never condescending or scripted-sounding
❌ Never flustered or over-apologetic`;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /create-agent
//
// Body (all optional except where noted):
//   bizName      {string}  — business name
//   city         {string}  — city / market
//   niche        {string}  — industry niche (e.g. "Towing Companies")
//   focus        {string}  — specialty focus within niche
//   tagline      {string}  — business tagline
//   coreServices {string}  — comma-separated core services
//   voiceId      {string}  — Retell voice ID (default: "retell-Cimo")
//
// Returns: { success, agentId, llmId, agentName }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/create-agent', async (req, res) => {
  if (!guardEnv('RETELL_API_KEY', res)) return;

  const {
    bizName      = '',
    city         = '',
    focus        = '',
    tagline      = '',
    coreServices = '',
    niche        = '',
    voiceId      = 'retell-Cimo', // ← swap this from your Retell dashboard after first test
  } = req.body;

  const systemPrompt = buildSystemPrompt({ bizName, city, focus, tagline, coreServices, niche });
  const beginMessage = `Thank you for calling ${bizName || 'us'}, this is Emma. How can I help you today?`;

  // ── STEP 1: Create Retell LLM ─────────────────────────────────────────────
  console.log('[create-agent] Step 1: Creating Retell LLM…');

  let llmId, llmWsUrl;

  try {
    const llmBody = {
      model          : 'gpt-4o',
      general_prompt : systemPrompt,
      begin_message  : beginMessage,
      general_tools  : [{ type: 'end_call', name: 'end_call' }],
    };

    console.log('[create-agent] LLM payload:', JSON.stringify(llmBody, null, 2));

    const llmRes  = await fetch(`${RETELL}/create-retell-llm`, {
      method  : 'POST',
      headers : {
        Authorization  : `Bearer ${RETELL_API_KEY}`,
        'Content-Type' : 'application/json',
      },
      body : JSON.stringify(llmBody),
    });

    const llmData = await llmRes.json();
    console.log(`[create-agent] LLM response (${llmRes.status}):`, JSON.stringify(llmData, null, 2));

    if (!llmRes.ok) {
      return res.status(llmRes.status).json({ error: 'LLM creation failed', details: llmData });
    }

    llmId    = llmData.llm_id;
    llmWsUrl = llmData.llm_websocket_url;
    console.log(`[create-agent] ✅ LLM created — id: ${llmId}, wsUrl: ${llmWsUrl}`);

  } catch (e) {
    console.error('[create-agent] LLM exception:', e.message);
    return res.status(500).json({ error: 'LLM creation threw an exception', message: e.message });
  }

  // ── STEP 2: Create Retell Agent ───────────────────────────────────────────
  console.log('[create-agent] Step 2: Creating Retell Agent…');

  try {
    const agentBody = {
  response_engine : {
    type   : 'retell-llm',
    llm_id : llmId,
  },
  voice_id                  : voiceId,
  agent_name                : `${bizName || 'Demo'} — Emma (AI Receptionist)`,
  language                  : 'en-US',
  enable_backchannel        : true,
  normalize_for_speech      : true,
  end_call_after_silence_ms : 30000,
  max_call_duration_ms      : 1800000,
  boosted_keywords          : [
    'emergency', 'urgent', 'dispatch', 'available', 'help',
    ...(niche ? [niche] : []),
  ],
};

    console.log('[create-agent] Agent payload:', JSON.stringify(agentBody, null, 2));

    const agentRes  = await fetch(`${RETELL}/create-agent`, {
      method  : 'POST',
      headers : {
        Authorization  : `Bearer ${RETELL_API_KEY}`,
        'Content-Type' : 'application/json',
      },
      body : JSON.stringify(agentBody),
    });

    const agentData = await agentRes.json();
    console.log(`[create-agent] Agent response (${agentRes.status}):`, JSON.stringify(agentData, null, 2));

    if (!agentRes.ok) {
      return res.status(agentRes.status).json({ error: 'Agent creation failed', details: agentData });
    }

    const agentId = agentData.agent_id;
    console.log(`[create-agent] ✅ Agent created — id: ${agentId}`);

    return res.json({
      success   : true,
      agentId,
      llmId,
      agentName : agentData.agent_name,
    });

  } catch (e) {
    console.error('[create-agent] Agent exception:', e.message);
    return res.status(500).json({ error: 'Agent creation threw an exception', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /create-web-call
//
// Body:
//   agentId  {string} REQUIRED — Retell agent_id
//   metadata {object} optional — pass-through metadata
//
// Returns: { success, accessToken, callId }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/create-web-call', async (req, res) => {
  if (!guardEnv('RETELL_API_KEY', res)) return;

  const { agentId, metadata = {} } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }

  try {
    const body = { agent_id: agentId, metadata };
    console.log('[create-web-call] Payload:', JSON.stringify(body, null, 2));

    const retellRes = await fetch(`${RETELL}/v2/create-web-call`, {
      method  : 'POST',
      headers : {
        Authorization  : `Bearer ${RETELL_API_KEY}`,
        'Content-Type' : 'application/json',
      },
      body : JSON.stringify(body),
    });

    const data = await retellRes.json();
    console.log(`[create-web-call] Response (${retellRes.status}):`, JSON.stringify(data, null, 2));

    if (!retellRes.ok) {
      return res.status(retellRes.status).json({ error: 'Web call creation failed', details: data });
    }

    console.log(`[create-web-call] ✅ Call created — id: ${data.call_id}`);
    return res.json({
      success     : true,
      accessToken : data.access_token,
      callId      : data.call_id,
    });

  } catch (e) {
    console.error('[create-web-call] Exception:', e.message);
    return res.status(500).json({ error: 'Exception', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /check-availability
//
// Query params:
//   startDate {YYYY-MM-DD} REQUIRED
//   endDate   {YYYY-MM-DD} REQUIRED
//   timezone  {IANA string} optional — default: America/New_York
//
// Returns: { success, slots: [{ date, startTime, endTime, ... }] }
// ─────────────────────────────────────────────────────────────────────────────
app.get('/check-availability', async (req, res) => {
  if (!guardEnv('CRM_API_KEY', res))     return;
  if (!guardEnv('CRM_CALENDAR_ID', res)) return;

  const { startDate, endDate, timezone = 'America/New_York' } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
  }

  try {
    const url = `${CRM_API}/calendars/${CRM_CALENDAR_ID}/free-slots` +
      `?startDate=${encodeURIComponent(startDate)}` +
      `&endDate=${encodeURIComponent(endDate)}` +
      `&timezone=${encodeURIComponent(timezone)}`;

    const crmRes = await fetch(url, {
      headers : {
        Authorization : `Bearer ${CRM_API_KEY}`,
        Version       : '2021-04-15',
      },
    });

    const data = await crmRes.json();
    console.log(`[check-availability] Response (${crmRes.status}):`, JSON.stringify(data, null, 2));

    if (!crmRes.ok) {
      return res.status(crmRes.status).json({ error: 'Availability check failed', details: data });
    }

    // Flatten all days into a single slots array
    const slots = [];
    for (const [date, daySlots] of Object.entries(data.slots || {})) {
      if (Array.isArray(daySlots)) {
        daySlots.forEach(s => slots.push({ date, ...s }));
      }
    }

    return res.json({ success: true, slots, raw: data });

  } catch (e) {
    console.error('[check-availability] Exception:', e.message);
    return res.status(500).json({ error: 'Exception', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /check-specific-time
//
// Query params:
//   date     {YYYY-MM-DD} REQUIRED
//   time     {HH:MM}      REQUIRED  — 24-hr format in the given timezone
//   timezone {IANA string} optional — default: America/New_York
//
// Returns: { success, available: bool, slot: object|null, date, time, timezone }
// ─────────────────────────────────────────────────────────────────────────────
app.get('/check-specific-time', async (req, res) => {
  if (!guardEnv('CRM_API_KEY', res))     return;
  if (!guardEnv('CRM_CALENDAR_ID', res)) return;

  const { date, time, timezone = 'America/New_York' } = req.query;

  if (!date || !time) {
    return res.status(400).json({ error: 'date (YYYY-MM-DD) and time (HH:MM 24hr) are required' });
  }

  try {
    // Fetch the requested day + next day (endDate is exclusive in GHL API)
    const nextDay = new Date(`${date}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const endDate = nextDay.toISOString().split('T')[0];

    const url = `${CRM_API}/calendars/${CRM_CALENDAR_ID}/free-slots` +
      `?startDate=${encodeURIComponent(date)}` +
      `&endDate=${encodeURIComponent(endDate)}` +
      `&timezone=${encodeURIComponent(timezone)}`;

    const crmRes = await fetch(url, {
      headers : {
        Authorization : `Bearer ${CRM_API_KEY}`,
        Version       : '2021-04-15',
      },
    });

    const data = await crmRes.json();

    if (!crmRes.ok) {
      return res.status(crmRes.status).json({ error: 'Slot check failed', details: data });
    }

    const daySlots  = (data.slots || {})[date] || [];
    const requested = time.slice(0, 5); // normalise to HH:MM

    const match = daySlots.find(slot => {
      if (!slot.startTime) return false;
      // GHL can return ISO strings or bare HH:MM — handle both
      const raw = slot.startTime;
      const slotHHMM = raw.length > 5
        ? new Date(raw).toLocaleTimeString('en-GB', {
            hour     : '2-digit',
            minute   : '2-digit',
            hour12   : false,
            timeZone : timezone,
          })
        : raw.slice(0, 5);
      return slotHHMM === requested;
    });

    return res.json({
      success   : true,
      available : !!match,
      slot      : match || null,
      date,
      time      : requested,
      timezone,
    });

  } catch (e) {
    console.error('[check-specific-time] Exception:', e.message);
    return res.status(500).json({ error: 'Exception', message: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /book-appointment
//
// Body:
//   firstName {string} REQUIRED
//   lastName  {string} REQUIRED
//   email     {string} REQUIRED
//   startTime {ISO 8601 string} REQUIRED  — e.g. "2026-08-10T14:00:00-05:00"
//   phone     {string} optional
//   endTime   {ISO 8601 string} optional  — defaults to startTime + 30 min
//   timezone  {IANA string} optional      — default: America/New_York
//   notes     {string} optional
//
// Returns: { success, appointmentId, startTime, endTime, contactId }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/book-appointment', async (req, res) => {
  if (!guardEnv('CRM_API_KEY', res))     return;
  if (!guardEnv('CRM_CALENDAR_ID', res)) return;

  const {
    firstName,
    lastName,
    email,
    phone     = '',
    startTime,
    endTime,
    timezone  = 'America/New_York',
    notes     = '',
  } = req.body;

  // Validate required fields
  const missing = [];
  if (!firstName) missing.push('firstName');
  if (!lastName)  missing.push('lastName');
  if (!email)     missing.push('email');
  if (!startTime) missing.push('startTime');

  if (missing.length) {
    return res.status(400).json({ error: 'Missing required fields', missing });
  }

  // Resolve endTime — default: startTime + 30 min
  const resolvedEndTime = endTime || (() => {
    const d = new Date(startTime);
    d.setMinutes(d.getMinutes() + 30);
    return d.toISOString();
  })();

  const payload = {
    calendarId  : CRM_CALENDAR_ID,
    locationId  : CRM_LOCATION_ID,
    contactInfo : { firstName, lastName, email, phone, timezone },
    startTime,
    endTime     : resolvedEndTime,
    notes,
  };

  console.log('[book-appointment] Payload:', JSON.stringify(payload, null, 2));

  try {
    const crmRes = await fetch(`${CRM_API}/calendars/events/appointments`, {
      method  : 'POST',
      headers : {
        Authorization  : `Bearer ${CRM_API_KEY}`,
        Version        : '2021-04-15',
        'Content-Type' : 'application/json',
      },
      body : JSON.stringify(payload),
    });

    const data = await crmRes.json();
    console.log(`[book-appointment] Response (${crmRes.status}):`, JSON.stringify(data, null, 2));

    if (!crmRes.ok) {
      return res.status(crmRes.status).json({ error: 'Booking failed', details: data });
    }

    const appointmentId = data.id || data.appointmentId;
    console.log(`[book-appointment] ✅ Booked — id: ${appointmentId}`);

    return res.json({
      success       : true,
      appointmentId,
      startTime     : data.startTime,
      endTime       : data.endTime,
      contactId     : data.contactId,
    });

  } catch (e) {
    console.error('[book-appointment] Exception:', e.message);
    return res.status(500).json({ error: 'Exception', message: e.message });
  }
});

// ─── 404 catch-all ────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ─── Unhandled error handler ──────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('[UNHANDLED ERROR]', err);
  res.status(500).json({ error: 'Unexpected server error', message: err.message });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n=== Creative Copyz Voice AI Proxy ===');
  console.log('Port              : ' + PORT);
  console.log('RETELL_API_KEY    : ' + (RETELL_API_KEY    ? 'SET' : 'MISSING - set in Railway env vars'));
  console.log('CRM_API_KEY       : ' + (CRM_API_KEY       ? 'SET' : 'MISSING - set in Railway env vars'));
  console.log('CRM_CALENDAR_ID   : ' + (CRM_CALENDAR_ID   ? 'SET' : 'MISSING - set in Railway env vars'));
  console.log('CRM_LOCATION_ID   : ' + CRM_LOCATION_ID);
  console.log('RAILWAY_PUBLIC_URL: ' + (RAILWAY_PUBLIC_URL || '(not set - optional)'));
  console.log('=====================================\n');
});
