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
 *   POST /book-appointment     → book a Hexona Systems calendar appointment
 */

const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch'); // v2 — CommonJS compatible

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Environment ──────────────────────────────────────────────────────────────
const RETELL_API_KEY     = process.env.RETELL_API_KEY;
const CRM_API_KEY        = process.env.CRM_API_KEY;
const CRM_CALENDAR_ID    = process.env.CRM_CALENDAR_ID;
const CRM_LOCATION_ID    = process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';
const RAILWAY_PUBLIC_URL = process.env.RAILWAY_PUBLIC_URL;

const RETELL  = 'https://api.retellai.com';
const CRM_API = 'https://services.leadconnectorhq.com';

// ─── Per-agent call counter — 5 calls max per demo ───────────────────────────
const agentCallCounts = {};

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());

// ============================================================
// NICHE TEMPLATES
// One entry per niche. agentName is the voice persona name.
// toneBlock is injected verbatim into the system prompt.
// openingLine is the exact first sentence the agent speaks.
// ============================================================

const NICHE_TEMPLATES = {
  restoration: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are calm, empathetic, and action-oriented. Many callers are panicking due to water, fire, or mold damage.
Your first job is to make them feel that help is already on the way. Speak with quiet confidence.
Never sound rushed or robotic.

INDUSTRY CONTEXT
Callers typically have water or flood damage (burst pipe, storm, appliance leak), fire or smoke damage,
or a mold problem. They want to know: can someone come today, is it covered by insurance, what happens first.

KEY POINTS TO COMMUNICATE
- 24/7 emergency response available
- Free damage assessment
- Works directly with insurance companies
- Licensed and certified technicians on call`,
    openingLine: 'Thank you for calling {businessName}, this is Emma. Are you dealing with an emergency right now, or how can I help you today?'
  },

  bailbond: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are confident, no-nonsense, and fast-moving. Callers are stressed and often emotional.
They want someone out of jail as quickly as possible. Be direct, gather the facts, and keep moving.

INDUSTRY CONTEXT
Callers need to bail out a family member or friend, or want to know how the process works.
Common questions: how much does it cost, how long does it take, what do I need to bring.

KEY POINTS TO COMMUNICATE
- 24/7 service, fast response
- Typically 10% of the bail amount is required
- Completely confidential and professional
- Works with local jails and courts`,
    openingLine: 'Thank you for calling {businessName}, this is Emma. How can I help you right now?'
  },

  towing: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are efficient, reassuring, and quick. Callers are stranded and just want help as fast as possible.
Get the information you need, confirm that help is coming, and let them go.

INDUSTRY CONTEXT
Callers need emergency towing after a breakdown or accident, roadside assistance (flat tire, dead battery, lockout),
or vehicle transport. They want to know: how fast can you get here, and what does it cost.

KEY POINTS TO COMMUNICATE
- Fast response times, 24/7 availability
- Flat rates, no hidden fees
- GPS dispatching to their exact location
- All vehicle types handled`,
    openingLine: 'Thank you for calling {businessName}, this is Emma. Are you in need of a tow right now?'
  },

  locksmith: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are calm, confident, and fast-moving. Being locked out is stressful.
Make the caller feel the problem is already being solved from the moment they hear your voice.

INDUSTRY CONTEXT
Callers are locked out of their car, home, or office. Some need a lock change or rekeying.
They want to know: how fast can you come, and what is the price.

KEY POINTS TO COMMUNICATE
- Fast arrival, 24/7 service
- Upfront pricing, no hidden fees
- Licensed and insured locksmiths
- All lock types and vehicle makes handled`,
    openingLine: 'Thank you for calling {businessName}, this is Emma. Are you locked out right now, or how can I help?'
  },

  vet: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are calm, caring, and professional. The caller may be panicking about their pet.
Keep your voice steady, reassure them that they have reached the right place, and guide them clearly.

INDUSTRY CONTEXT
Callers have a pet showing signs of injury or illness, suspected poisoning, or post-surgery concerns.
They want to know: can we come in now, what should we do while we drive there.

KEY POINTS TO COMMUNICATE
- Emergency care available now, veterinarians on staff around the clock
- What to do before arriving: keep the animal calm, do not feed them, drive carefully
- All species and breeds seen`,
    openingLine: 'Thank you for calling {businessName}, this is Emma. Is this an emergency with your pet, or how can I help you today?'
  },

  funeral: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are compassionate, unhurried, and gentle. The caller has likely just lost someone or is planning ahead.
Speak softly and slowly. Never rush. Lead with empathy before logistics.

INDUSTRY CONTEXT
Callers are families with an immediate need following a death, individuals planning arrangements in advance,
or people asking about cremation versus burial options.
They want to know: can someone help us now, what are our options, what does it cost.

KEY POINTS TO COMMUNICATE
- Available 24/7, including for immediate needs
- Full range of services: burial, cremation, memorial, pre-planning
- Compassionate and personalised service
- Arrangements can be discussed in a private consultation`,
    openingLine: 'Thank you for reaching {businessName}, this is Emma. How can I be of help to you today?'
  },

  septic: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are direct, practical, and calm. Sewage issues are urgent. Get the facts quickly and move to dispatch.
Do not over-explain. The caller wants to know help is coming.

INDUSTRY CONTEXT
Callers have sewage backing up into their home or business, a full or overflowing tank, or drain field problems.
They want to know: can someone come today, how fast, and what does it cost.

KEY POINTS TO COMMUNICATE
- 24/7 emergency response, immediate dispatch available
- Emergency pumping, drain cleaning, and system repair
- Licensed technicians, upfront pricing`,
    openingLine: 'Thank you for calling {businessName}, this is Emma. Are you dealing with a septic emergency right now?'
  },

  nemt: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are patient, clear, and well-organised. Many callers are elderly or are caregivers and may need extra time.
Speak at a measured pace, confirm details carefully, and never rush through booking.

INDUSTRY CONTEXT
Callers need rides to and from dialysis, chemotherapy, or clinic appointments, hospital discharge transportation,
or wheelchair and stretcher-accessible vehicle bookings.
They want to know: are you available on my date, do you have the right vehicle, do you accept my insurance.

KEY POINTS TO COMMUNICATE
- Reliable, on-time medical transport
- Wheelchair and mobility-accessible vehicles available
- Professional, trained drivers
- Advance booking available, scheduling line open 24/7`,
    openingLine: 'Thank you for calling {businessName}, this is Emma. How can I help you schedule your transportation today?'
  },

  security: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are professional, measured, and consultative. Business owners calling about security want to feel
they are dealing with a serious and capable company. Be confident without being aggressive.
Listen to their needs before proposing anything.

INDUSTRY CONTEXT
Callers are business owners or property managers needing ongoing coverage, event organisers needing
temporary security, or companies seeking immediate coverage after an incident.
They want to know: can you cover my site, how quickly, and what does it cost.

KEY POINTS TO COMMUNICATE
- Licensed, vetted, uniformed security officers
- 24/7 coverage available for commercial, retail, events, and construction sites
- Site assessments available before signing any contract
- Flexible short-term and long-term contracts`,
    openingLine: 'Thank you for calling {businessName}, this is Emma. Are you looking for security coverage, or how can I help you today?'
  },

  roadside: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are fast, calm, and action-oriented. The caller is stranded and possibly in an unsafe location.
Get the key details quickly, confirm help is on the way, and let them go.

INDUSTRY CONTEXT
Callers need a jump start for a dead battery, a flat tire change, emergency fuel delivery,
vehicle lockout assistance, or light towing.
They want to know: how fast can you get here, and what does it cost.

KEY POINTS TO COMMUNICATE
- Fast dispatch, 24/7 availability
- Flat and transparent pricing
- All vehicle types covered
- GPS-based dispatch for fast arrival`,
    openingLine: 'Thank you for calling {businessName}, this is Emma. Are you broken down right now? Let me get help on the way.'
  }
};

// ============================================================
// NICHE NORMALIZER
// Maps any incoming niche string to a template key.
// ============================================================

function normalizeNiche(niche) {
  const n = (niche || '').toLowerCase();
  if (n.includes('restoration') || n.includes('flood') || n.includes('water damage') || n.includes('fire damage') || n.includes('mold')) return 'restoration';
  if (n.includes('bail'))                                                                      return 'bailbond';
  if (n.includes('tow'))                                                                       return 'towing';
  if (n.includes('locksmith') || n.includes('lockout') || n.includes('lock'))                 return 'locksmith';
  if (n.includes('vet') || n.includes('animal') || n.includes('pet'))                         return 'vet';
  if (n.includes('funeral') || n.includes('mortuary') || n.includes('cremation'))             return 'funeral';
  if (n.includes('septic') || n.includes('sewage') || n.includes('drain'))                    return 'septic';
  if (n.includes('nemt') || n.includes('medical transport') || n.includes('non-emergency'))   return 'nemt';
  if (n.includes('security') || n.includes('guard'))                                          return 'security';
  if (n.includes('roadside') || n.includes('breakdown') || n.includes('battery'))             return 'roadside';
  return 'restoration'; // fallback
}

// ============================================================
// SYSTEM PROMPT BUILDER
// Combines niche template with business-specific details.
// ============================================================

function buildSystemPrompt({ niche, businessName, city, coreServices, tagline }) {
  const key      = normalizeNiche(niche);
  const template = NICHE_TEMPLATES[key] || NICHE_TEMPLATES.restoration;
  const today    = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const opening = template.openingLine.replace('{businessName}', businessName);

  return `
# AI VOICE RECEPTIONIST
Business: ${businessName}
City: ${city}
Today's date: ${today}

## IDENTITY
Your name is ${template.agentName}. You are the AI voice receptionist for ${businessName} in ${city}.
${tagline      ? `Their tagline: "${tagline}"`           : ''}
${coreServices ? `Their core services: ${coreServices}` : ''}

## OPENING LINE
When the call connects, say exactly:
"${opening}"

${template.toneBlock}

## WHAT YOU CAN DO FOR CALLERS
1. Answer questions about ${businessName}'s services in ${city}
2. Check appointment or consultation availability
3. Book a discovery call
4. Provide general guidance on what to expect

## BOOKING FLOW
Follow these steps in order every time a caller wants to book.

STEP 1 - CHECK AVAILABILITY
Use the check_availability tool. Never guess or invent times.

STEP 2 - OFFER SLOTS
If only one slot is available, say: "I have [day] at [time] available. Does that work for you?"
If multiple slots are available, offer up to three: "I have a few options. [time 1], [time 2], or [time 3]. Which works best for you?"

STEP 3 - GET THEIR NAME
Ask: "What name should I put this under?"
Get their first name and last name separately if needed.
Spell it back letter by letter: "Let me confirm, that is [J-O-H-N S-M-I-T-H]. Is that right?"

STEP 4 - GET THEIR EMAIL
Ask: "And what is the best email address for your confirmation?"
Spell it back: "So that is [j-o-h-n at g-m-a-i-l dot com]. Is that correct?"

STEP 5 - BOOK AND CLOSE
Use the book_appointment tool with their firstName, lastName, email, and the selected startTime.
Once confirmed, say:
"Perfect. You are all set for [day] at [time]. You will receive an email confirmation shortly."
End the call naturally. Do NOT say "Is there anything else I can help you with?"

## SPEAKING STYLE
- Speak naturally, like a warm and capable human receptionist
- Use natural fillers occasionally: "Sure", "Of course", "Absolutely", "Got it"
- Keep responses concise. This is a phone call
- Never read out long lists. Summarise and offer to elaborate
- If you do not know something specific about the business, say:
  "That is a great question. I would want to make sure you get the right answer.
   The best thing is to bring that up during your consultation."

## PRICING (only if asked about the AI receptionist service)
The AI receptionist service starts at $497 per month. Direct the caller to book a discovery call.

## GUARDRAILS
- Never mention or compare competitor companies
- Never make up information about ${businessName}
- Never promise specific response times or pricing unless you know them for certain
- Always stay in character as ${template.agentName}, the receptionist for ${businessName}
`.trim();
}

// ─── Request logger ───────────────────────────────────────────────────────────
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
      RAILWAY_PUBLIC_URL : RAILWAY_PUBLIC_URL ? 'SET'    : 'MISSING — required for booking tools',
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /create-agent
//
// Expected body:
//   niche:        string  (e.g. "funeral", "roadside", "septic")
//   businessName: string  (e.g. "Smith Funeral Home")
//   city:         string  (e.g. "Houston")
//   coreServices: string  (scraped from website, optional)
//   tagline:      string  (scraped from website, optional)
//
// Returns: { success: true, agentId, llmId, agentName }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/create-agent', async (req, res) => {
  try {
    const {
      niche        = 'restoration',
      businessName = 'Your Business',
      city         = 'your area',
      coreServices = '',
      tagline      = ''
    } = req.body;

    const systemPrompt     = buildSystemPrompt({ niche, businessName, city, coreServices, tagline });
    const nicheLabel       = normalizeNiche(niche);
    const agentDisplayName = `[${nicheLabel}] ${businessName} - ${city}`;

    const RAILWAY_URL = process.env.RAILWAY_PUBLIC_URL;
    const RETELL_KEY  = process.env.RETELL_API_KEY;
    const VOICE_ID    = process.env.RETELL_VOICE_ID || 'retell-Cimo';

    // ── STEP 1: Create Retell LLM ──────────────────────────────────────────
    const llmRes = await fetch('https://api.retellai.com/create-retell-llm', {
      method  : 'POST',
      headers : { 'Authorization': `Bearer ${RETELL_KEY}`, 'Content-Type': 'application/json' },
      body    : JSON.stringify({
        model          : 'gpt-4o',
        general_prompt : systemPrompt,
        general_tools  : [
          {
            type                         : 'external',
            name                         : 'check_availability',
            description                  : 'Check available appointment slots. Call this whenever the caller wants to book or asks about available times.',
            speak_during_execution       : true,
            speak_after_execution        : false,
            execution_message_description: 'Let me check availability for you...',
            url                          : `${RAILWAY_URL}/retell-tools/check-availability`,
            parameters: {
              type      : 'object',
              properties: {
                date: {
                  type       : 'string',
                  description: 'The calendar date to check, formatted as YYYY-MM-DD. Use the date the caller mentioned, or the next business day if they did not specify.'
                },
                timezone: {
                  type       : 'string',
                  description: 'IANA timezone of the caller, e.g. America/New_York. Default to America/New_York if unknown.'
                }
              },
              required: ['date']
            }
          },
          {
            type                         : 'external',
            name                         : 'book_appointment',
            description                  : 'Book a confirmed appointment slot. Only call this after the caller has confirmed their first name, last name, email, and chosen time slot.',
            speak_during_execution       : true,
            speak_after_execution        : false,
            execution_message_description: 'Booking that for you now...',
            url                          : `${RAILWAY_URL}/retell-tools/book-appointment`,
            parameters: {
              type      : 'object',
              properties: {
                firstName: {
                  type       : 'string',
                  description: "Caller's first name, confirmed and spelled back"
                },
                lastName: {
                  type       : 'string',
                  description: "Caller's last name, confirmed and spelled back"
                },
                email: {
                  type       : 'string',
                  description: "Caller's email address, confirmed character by character"
                },
                startTime: {
                  type       : 'string',
                  description: 'ISO 8601 datetime string of the selected slot, e.g. 2026-08-10T14:00:00-05:00'
                },
                timezone: {
                  type       : 'string',
                  description: 'IANA timezone of the caller, e.g. America/New_York'
                }
              },
              required: ['firstName', 'lastName', 'email', 'startTime']
            }
          }
        ]
      })
    });

    if (!llmRes.ok) {
      const err = await llmRes.text();
      throw new Error(`LLM creation failed: ${err}`);
    }
    const llmData = await llmRes.json();

    // ── STEP 2: Create Retell Agent ────────────────────────────────────────
    const agentRes = await fetch('https://api.retellai.com/create-agent', {
      method  : 'POST',
      headers : { 'Authorization': `Bearer ${RETELL_KEY}`, 'Content-Type': 'application/json' },
      body    : JSON.stringify({
        llm_websocket_url        : llmData.llm_websocket_url,
        agent_name               : agentDisplayName,
        voice_id                 : VOICE_ID,
        language                 : 'en-US',
        responsiveness           : 1,
        interruption_sensitivity : 1,
        enable_backchannel       : true,
        backchannel_frequency    : 0.8,
        backchannel_words        : ['got it', 'sure', 'okay', 'absolutely'],
        ambient_sound            : 'office',
        ambient_sound_volume     : 0.1,
        reminder_trigger_ms      : 10000,
        reminder_max_count       : 2
      })
    });

    if (!agentRes.ok) {
      const err = await agentRes.text();
      throw new Error(`Agent creation failed: ${err}`);
    }
    const agentData = await agentRes.json();

    return res.json({
      success   : true,
      agentId   : agentData.agent_id,
      llmId     : llmData.llm_id,
      agentName : agentDisplayName
    });

  } catch (error) {
    console.error('create-agent error:', error.message);
    res.status(500).json({ success: false, error: error.message });
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

  const count = agentCallCounts[agentId] || 0;
  if (count >= 5) {
    console.log(`[create-web-call] Limit reached for agent ${agentId} — ${count}/5 calls used`);
    return res.status(429).json({ limitReached: true, error: 'This demo has reached its 5-call limit.' });
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

    agentCallCounts[agentId] = count + 1;
    console.log(`[create-web-call] Agent ${agentId} — ${agentCallCounts[agentId]}/5 calls used`);
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
// Returns: { success, slots: [{ date, startTime }] }
// ─────────────────────────────────────────────────────────────────────────────
app.get('/check-availability', async (req, res) => {
  if (!guardEnv('CRM_API_KEY', res))     return;
  if (!guardEnv('CRM_CALENDAR_ID', res)) return;

  const { startDate, endDate, timezone = 'America/New_York' } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
  }

  try {
    const startTs = new Date(startDate).getTime();
    const endTs   = new Date(endDate).getTime();

    const url = `${CRM_API}/calendars/${CRM_CALENDAR_ID}/free-slots` +
      `?startDate=${startTs}&endDate=${endTs}&timezone=${encodeURIComponent(timezone)}`;

    const crmRes = await fetch(url, {
      headers : { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-04-15' },
    });

    const data = await crmRes.json();
    console.log(`[check-availability] Response (${crmRes.status}):`, JSON.stringify(data, null, 2));

    if (!crmRes.ok) {
      return res.status(crmRes.status).json({ error: 'Availability check failed', details: data });
    }

    const slots = [];
    for (const [key, value] of Object.entries(data || {})) {
      if (key === 'traceId') continue;
      if (value && Array.isArray(value.slots)) {
        value.slots.forEach(slotTime => slots.push({ date: key, startTime: slotTime }));
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
    const nextDay = new Date(`${date}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const endDate = nextDay.toISOString().split('T')[0];

    const startTs = new Date(date).getTime();
    const endTs   = new Date(endDate).getTime();

    const url = `${CRM_API}/calendars/${CRM_CALENDAR_ID}/free-slots` +
      `?startDate=${startTs}&endDate=${endTs}&timezone=${encodeURIComponent(timezone)}`;

    const crmRes = await fetch(url, {
      headers : { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-04-15' },
    });

    const data = await crmRes.json();

    if (!crmRes.ok) {
      return res.status(crmRes.status).json({ error: 'Slot check failed', details: data });
    }

    const dayData   = data[date];
    const daySlots  = (dayData && Array.isArray(dayData.slots)) ? dayData.slots : [];
    const requested = time.slice(0, 5);

    const match = daySlots.find(slotTime => {
      const slotHHMM = new Date(slotTime).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
      });
      return slotHHMM === requested;
    });

    return res.json({
      success   : true,
      available : !!match,
      slot      : match ? { startTime: match } : null,
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
//   firstName {string}     REQUIRED
//   lastName  {string}     REQUIRED
//   email     {string}     REQUIRED
//   startTime {ISO 8601}   REQUIRED
//   phone     {string}     optional
//   endTime   {ISO 8601}   optional — defaults to startTime + 30 min
//   timezone  {IANA string} optional — default: America/New_York
//   notes     {string}     optional
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

  const missing = [];
  if (!firstName) missing.push('firstName');
  if (!lastName)  missing.push('lastName');
  if (!email)     missing.push('email');
  if (!startTime) missing.push('startTime');

  if (missing.length) {
    return res.status(400).json({ error: 'Missing required fields', missing });
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// RETELL TOOL WEBHOOK — POST /retell-tools/check-availability
// Called by Retell LLM during a live call when agent needs available slots.
// Body from Retell: { call_id, name, arguments: { date, timezone } }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/retell-tools/check-availability', async (req, res) => {
  const args     = req.body.arguments || {};
  const date     = args.date;
  const timezone = args.timezone || 'America/New_York';

  if (!date) {
    return res.json({ result: "I couldn't determine the date. Could you tell me which day you had in mind?" });
  }

  try {
    const nextDay = new Date(`${date}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const endDate = nextDay.toISOString().split('T')[0];

    const startTs = new Date(date).getTime();
    const endTs   = new Date(endDate).getTime();

    const url = `${CRM_API}/calendars/${CRM_CALENDAR_ID}/free-slots` +
      `?startDate=${startTs}&endDate=${endTs}&timezone=${encodeURIComponent(timezone)}`;

    const crmRes = await fetch(url, {
      headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-04-15' },
    });
    const data = await crmRes.json();

    if (!crmRes.ok) {
      return res.json({ result: "I'm having trouble pulling up the calendar right now. Let me have someone follow up with you directly." });
    }

    const dayData  = data[date];
    const allSlots = (dayData && Array.isArray(dayData.slots)) ? dayData.slots : [];

    // Filter to 9 AM – 7 PM in caller's timezone for proactive suggestions
    const daySlots = allSlots.filter(slotTime => {
      const timeStr = new Date(slotTime).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
      });
      const hour = parseInt(timeStr.split(':')[0], 10);
      return hour >= 9 && hour < 19;
    });

    if (daySlots.length === 0 && allSlots.length > 0) {
      const dateStr = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      return res.json({ result: `I don't have any openings during regular hours on ${dateStr}. Would you like me to check another day, or would an early morning or evening slot work for you?` });
    }

    if (daySlots.length === 0) {
      const dateStr = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      return res.json({ result: `Unfortunately there are no openings on ${dateStr}. Would you like me to check another day?` });
    }

    const formatted = daySlots.slice(0, 5).map(slotTime =>
      new Date(slotTime).toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
      })
    ).join(', ');

    const dateStr   = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    const slotCount = daySlots.slice(0, 5).length;
    const result    = slotCount === 1
      ? `On ${dateStr} I have one opening at ${formatted}. Does that work for you?`
      : `On ${dateStr} I have openings at: ${formatted}. Which of those works best for you?`;

    return res.json({ result });

  } catch (e) {
    console.error('[retell-tools/check-availability] Exception:', e.message);
    return res.json({ result: "I'm having trouble with the calendar right now. Let me have someone reach out to confirm a time." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// RETELL TOOL WEBHOOK — POST /retell-tools/book-appointment
// Called by Retell LLM during a live call to book the confirmed slot.
// Body from Retell: { call_id, name, arguments: { firstName, lastName, email, startTime, timezone } }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/retell-tools/book-appointment', async (req, res) => {
  const args = req.body.arguments || {};
  const { firstName, lastName, email, phone = '', startTime, timezone = 'America/New_York' } = args;

  const missing = [];
  if (!firstName) missing.push('first name');
  if (!lastName)  missing.push('last name');
  if (!email)     missing.push('email address');
  if (!startTime) missing.push('the appointment time');

  if (missing.length) {
    return res.json({ result: `I still need your ${missing.join(' and ')} to complete the booking. Could you share that?` });
  }

  try {
    const endTime = (() => {
      const d = new Date(startTime);
      d.setMinutes(d.getMinutes() + 30);
      return d.toISOString();
    })();

    const payload = {
      calendarId  : CRM_CALENDAR_ID,
      locationId  : CRM_LOCATION_ID,
      contactInfo : { firstName, lastName, email, phone, timezone },
      startTime,
      endTime,
    };

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

    if (!crmRes.ok) {
      console.error('[retell-tools/book-appointment] Hexona Systems error:', JSON.stringify(data, null, 2));
      return res.json({ result: "I ran into an issue completing the booking. Please use the 'Book a Discovery Call' button on the page to lock in your spot." });
    }

    const timeStr = new Date(startTime).toLocaleString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
    });

    return res.json({
      result: `You're all booked, ${firstName}! Your discovery call is confirmed for ${timeStr}. A confirmation will be sent to ${email}. We're looking forward to speaking with you!`,
    });

  } catch (e) {
    console.error('[retell-tools/book-appointment] Exception:', e.message);
    return res.json({ result: "Something went wrong on my end. Please use the 'Book a Discovery Call' button on the page and we'll get you sorted." });
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
  console.log('RETELL_API_KEY    : ' + (RETELL_API_KEY    ? 'SET' : 'MISSING — set in Railway env vars'));
  console.log('CRM_API_KEY       : ' + (CRM_API_KEY       ? 'SET' : 'MISSING — set in Railway env vars'));
  console.log('CRM_CALENDAR_ID   : ' + (CRM_CALENDAR_ID   ? 'SET' : 'MISSING — set in Railway env vars'));
  console.log('CRM_LOCATION_ID   : ' + CRM_LOCATION_ID);
  console.log('RAILWAY_PUBLIC_URL: ' + (RAILWAY_PUBLIC_URL || '(not set — optional)'));
  console.log('=====================================\n');
});
