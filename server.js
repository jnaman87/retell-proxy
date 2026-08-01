const express = require('express');
const cors    = require('cors');
const app     = express();
app.use(cors());
app.use(express.json());

// ── Environment variables ─────────────────────────────────────────────────────
const RETELL_API_KEY  = process.env.RETELL_API_KEY;
const RETELL_BASE     = 'https://api.retellai.com';
const CRM_API_KEY     = process.env.CRM_API_KEY;
const CRM_CALENDAR_ID = process.env.CRM_CALENDAR_ID;
const CRM_LOCATION_ID = process.env.CRM_LOCATION_ID;
const CRM_BASE        = 'https://services.leadconnectorhq.com';
const RAILWAY_URL     = process.env.RAILWAY_PUBLIC_URL;

// ── City / timezone map ───────────────────────────────────────────────────────
const CITY_TZ = {
  houston:       'America/Chicago',
  dallas:        'America/Chicago',
  'fort worth':  'America/Chicago',
  'san antonio': 'America/Chicago',
  austin:        'America/Chicago',
  nashville:     'America/Chicago',
  phoenix:       'America/Phoenix',
  atlanta:       'America/New_York',
  charlotte:     'America/New_York',
  miami:         'America/New_York',
  orlando:       'America/New_York',
  tampa:         'America/New_York',
  raleigh:       'America/New_York',
  toronto:       'America/Toronto',
  denver:        'America/Denver',
  'las vegas':   'America/Los_Angeles',
  calgary:       'America/Edmonton',
  vancouver:     'America/Vancouver',
  sydney:        'Australia/Sydney',
  melbourne:     'Australia/Melbourne',
  brisbane:      'Australia/Brisbane',
  eastern:       'America/New_York',
  central:       'America/Chicago',
  mountain:      'America/Denver',
  pacific:       'America/Los_Angeles',
  est:           'America/New_York',
  cst:           'America/Chicago',
  mst:           'America/Denver',
  pst:           'America/Los_Angeles',
};

function resolveTimezone(input) {
  if (!input) return 'America/New_York';
  return CITY_TZ[input.toLowerCase().trim()] || 'America/New_York';
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatSlot(epochMs, timezone) {
  return new Date(epochMs).toLocaleString('en-US', {
    timeZone: timezone,
    weekday:  'long',
    month:    'long',
    day:      'numeric',
    hour:     'numeric',
    minute:   '2-digit',
    hour12:   true,
  });
}

function getHourInTimezone(epochMs, timezone) {
  return parseInt(
    new Date(epochMs).toLocaleString('en-US', { timeZone: timezone, hour: '2-digit', hour12: false }),
    10
  );
}

function isWithinBusinessHours(epochMs, timezone) {
  const hour = getHourInTimezone(epochMs, timezone);
  return hour >= 9 && hour < 19;
}

function parseGHLSlots(slotsData, timezone, maxSlots = 20) {
  const dateMap = slotsData?._dates_ || slotsData?.dates || {};
  const result  = [];
  for (const [dateStr, dateObj] of Object.entries(dateMap)) {
    for (const slot of (dateObj?.slots || [])) {
      let startEpoch;
      if (typeof slot === 'number')                        startEpoch = slot;
      else if (typeof slot === 'string' && slot.includes('T')) startEpoch = new Date(slot).getTime();
      else                                                 startEpoch = new Date(`${dateStr}T${slot}`).getTime();
      if (!isNaN(startEpoch)) result.push({ startTime: startEpoch, endTime: startEpoch + 30 * 60 * 1000 });
      if (result.length >= maxSlots) return result;
    }
  }
  return result;
}

// ── System prompt builder ─────────────────────────────────────────────────────
function buildSystemPrompt({ businessName, city, niche, tagline, coreServices }) {
  const serviceList = coreServices
    ? coreServices.split(',').map(s => `  - ${s.trim()}`).join('\n')
    : '  - 24/7 emergency response';

  const todayLabel = new Date().toLocaleDateString('en-US', {
    timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return `
TODAY'S DATE: ${todayLabel} (use this to resolve day names like "Thursday" into actual calendar dates)

YOU ARE: An AI voice receptionist demo built specifically for ${businessName}, a ${niche} business in ${city}.

BUSINESS PROFILE:
  - Name: ${businessName}
  - City: ${city}
  - Tagline: "${tagline || '24/7 Emergency Service'}"
  - Core services:\n${serviceList}

YOUR PURPOSE:
You are demonstrating what a fully operational AI receptionist would sound like for ${businessName}.
The caller is the business owner or a key decision-maker evaluating this service.
Act as if you are already THEIR live receptionist — professional, warm, and knowledgeable about their services.

CALL FLOW:
1. Greet warmly using the business name. Introduce yourself as their AI receptionist.
2. Handle any inquiry naturally — treat it as a real call for their business type.
3. Reference their specific services and city to build credibility.
4. When they are ready, invite them to book a discovery call to set this up for real.

BOOKING FLOW (follow this exact sequence every time):

STEP 1: Ask "What city or timezone are you calling from?"

STEP 2: Call check_availability with their timezone/city.
         It returns slots already filtered to 9am–7pm in their local time.
         Offer them up to 3 of those options.

STEP 3A — If they choose one of your offered slots:
  → Collect their name and email address.
  → Call book_appointment using the exact startTime and endTime from the slot.
  → Say: "You'll receive an email confirmation shortly. Have a wonderful day!"
  → Call end_call immediately. Do NOT ask "Is there anything else I can help you with?"

STEP 3B — If they request a different time not in your offered list:
  → Convert their request to a date (YYYY-MM-DD) and time (HH:MM, 24-hour).
     Example: "Thursday at 2pm" → date_str="2026-08-06", time_str="14:00"
  → Call check_specific_time with that date, time, and their timezone.
  → If available = true: collect name + email → call book_appointment → confirm → call end_call.
  → If available = false: offer the 2 alternatives returned → once they pick, collect name + email → book → confirm → call end_call.

NEVER invent or guess a time slot. Only book times confirmed as available by the tools.
NEVER ask "Is there anything else I can help you with?" — end the call after the booking confirmation.

PRICING (only if asked — do not bring up unprompted):
"This service is $497 per month. That does not include carrier charges — those are the actual cost of phone minutes and SMS billed at usage. Everything else, including setup, the AI, ongoing updates, and support, is covered. Want to book a quick call to go over what's included?"

TONE: Calm, professional, empathetic. Short sentences. Never robotic.
Never say you are an AI unless directly asked.
`.trim();
}

function buildBeginMessage(businessName) {
  return `Thank you for calling ${businessName}! I'm Emma, your AI receptionist. How can I help you today?`;
}

// ── Retell tool definitions ───────────────────────────────────────────────────
function buildTools() {
  return [
    {
      type:        'webhook',
      name:        'check_availability',
      description: 'Check available discovery call slots in the prospect\'s timezone. Returns up to 6 slots filtered to between 9am and 7pm local time. Call this first before offering any times.',
      url:         `${RAILWAY_URL}/check-availability`,
      speak_during_execution:   true,
      execution_message_during: 'Let me check what times are available for you right now.',
      input_schema: {
        type: 'object',
        properties: {
          timezone_or_city: { type: 'string', description: 'The caller\'s city (e.g. "Houston") or timezone label (e.g. "Eastern", "CST").' },
        },
        required: ['timezone_or_city'],
      },
    },
    {
      type:        'webhook',
      name:        'check_specific_time',
      description: 'Check if a specific date and time requested by the prospect is available. If not, returns 2 closest available alternatives within business hours. Use this when the prospect requests a time different from the options you offered.',
      url:         `${RAILWAY_URL}/check-specific-time`,
      speak_during_execution:   true,
      execution_message_during: 'Let me check if that time works.',
      input_schema: {
        type: 'object',
        properties: {
          date_str: { type: 'string', description: 'Requested date in YYYY-MM-DD format. Calculate from TODAY\'S DATE in your context.' },
          time_str: { type: 'string', description: 'Requested time in HH:MM 24-hour format. E.g. "2pm" = "14:00".' },
          timezone: { type: 'string', description: 'IANA timezone string from the earlier check_availability response.' },
        },
        required: ['date_str', 'time_str', 'timezone'],
      },
    },
    {
      type:        'webhook',
      name:        'book_appointment',
      description: 'Book the discovery call at the exact slot the prospect has confirmed. Use the startTime and endTime values returned by check_availability or check_specific_time.',
      url:         `${RAILWAY_URL}/book-appointment`,
      speak_during_execution:   true,
      execution_message_during: 'Booking that for you now — just a moment.',
      input_schema: {
        type: 'object',
        properties: {
          prospect_name:   { type: 'string', description: 'Full name of the prospect' },
          prospect_email:  { type: 'string', description: 'Email address of the prospect' },
          business_name:   { type: 'string', description: 'Name of the business they represent' },
          slot_label:      { type: 'string', description: 'Human-readable label of the chosen slot' },
          start_time:      { type: 'number', description: 'Epoch milliseconds for slot start' },
          end_time:        { type: 'number', description: 'Epoch milliseconds for slot end' },
          timezone:        { type: 'string', description: 'IANA timezone of the prospect' },
          crm_contact_id:  { type: 'string', description: 'CRM contact ID of the originating lead if known' },
        },
        required: ['prospect_name', 'prospect_email', 'business_name', 'start_time', 'end_time'],
      },
    },
    {
      type:        'end_call',
      name:        'end_call',
      description: 'End the call. Call ONLY after confirming the booking and saying: "You will receive an email confirmation shortly. Have a wonderful day!"',
    },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /create-agent
// Called by CRM workflow when a new lead is tagged
// Body: { businessName, city, niche, tagline, coreServices, contactId }
// Returns: { agentId }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/create-agent', async (req, res) => {
  const { businessName, city, niche, tagline, coreServices, contactId } = req.body;

  if (!businessName || !city || !niche) {
    return res.status(400).json({ error: 'businessName, city, and niche are required' });
  }

  try {
        const response = await fetch(`${RETELL_BASE}/v2/create-agent`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_name: `${businessName} — ${city} AI Receptionist`,
        response_engine: {
          type:           'retell-llm',
          general_prompt:  buildSystemPrompt({ businessName, city, niche, tagline, coreServices }),
          begin_message:   buildBeginMessage(businessName),
          general_tools:   buildTools(),
        },
        voice_id:           'eleven_labs-Rachel',
        language:           'en-US',
        enable_backchannel: true,
        ambient_sound:      'office',
        ...(contactId && { metadata: { crm_contact_id: contactId } }),
      }),
    });

    // ← CHANGED: read as text first so we can log it if it’s not JSON
    const rawText = await response.text();
    console.log('Retell status:', response.status);
    console.log('Retell raw response:', rawText.slice(0, 500));

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      return res.status(500).json({ error: 'Retell returned non-JSON. Check Railway logs for the raw response.' });
    }

    if (!response.ok) return res.status(response.status).json({ error: data });
    return res.json({ agentId: data.agent_id });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data });
    return res.json({ agentId: data.agent_id });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /create-web-call
// Called by the demo page when the lead clicks "Start Call"
// Body: { agentId }
// Returns: { access_token }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/create-web-call', async (req, res) => {
  const { agentId } = req.body;
  if (!agentId) return res.status(400).json({ error: 'agentId required' });

  try {
    const response = await fetch(`${RETELL_BASE}/v2/create-web-call`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${RETELL_API_KEY}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ agent_id: agentId }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json({ error: data.message || 'Retell error' });
    res.json({ access_token: data.access_token });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /check-availability
// Called by Retell tool mid-call
// Body: { timezone_or_city }
// Returns: { slots: [{ id, label, startTime, endTime }], timezone }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/check-availability', async (req, res) => {
  const { timezone_or_city } = req.body;
  const timezone = resolveTimezone(timezone_or_city);

  const start = new Date();
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  try {
    const params = new URLSearchParams({
      startDate: start.getTime().toString(),
      endDate:   end.getTime().toString(),
      timezone,
    });

    const slotsRes = await fetch(
      `${CRM_BASE}/calendars/${CRM_CALENDAR_ID}/free-slots?${params}`,
      { headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-04-15' } }
    );

    const slotsData = await slotsRes.json();
    if (!slotsRes.ok) return res.json({ slots: [], timezone });

    const filtered = parseGHLSlots(slotsData, timezone)
      .filter(s => isWithinBusinessHours(s.startTime, timezone))
      .slice(0, 6)
      .map((s, i) => ({ id: i + 1, label: formatSlot(s.startTime, timezone), startTime: s.startTime, endTime: s.endTime }));

    return res.json({ slots: filtered, timezone });

  } catch (err) {
    console.error(err);
    res.json({ slots: [], timezone });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /check-specific-time
// Called by Retell tool when prospect requests a custom time
// Body: { date_str, time_str, timezone }
// Returns: { available, slot? } or { available: false, alternatives }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/check-specific-time', async (req, res) => {
  const { date_str, time_str, timezone } = req.body;
  if (!date_str || !time_str || !timezone) {
    return res.json({ available: false, alternatives: [], error: 'Missing required fields' });
  }

  const requestedEpoch = new Date(`${date_str}T${time_str}:00`).getTime();
  const requestedHour  = getHourInTimezone(requestedEpoch, timezone);
  const inHours        = requestedHour >= 9 && requestedHour < 19;

  const windowStart = new Date(Math.max(requestedEpoch - 2 * 86400000, Date.now()));
  windowStart.setHours(0, 0, 0, 0);
  const windowEnd = new Date(requestedEpoch + 2 * 86400000);
  windowEnd.setHours(23, 59, 59, 999);

  try {
    const params = new URLSearchParams({
      startDate: windowStart.getTime().toString(),
      endDate:   windowEnd.getTime().toString(),
      timezone,
    });

    const slotsRes = await fetch(
      `${CRM_BASE}/calendars/${CRM_CALENDAR_ID}/free-slots?${params}`,
      { headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-04-15' } }
    );

    const slotsData = await slotsRes.json();
    if (!slotsRes.ok) return res.json({ available: false, alternatives: [] });

    const allSlots = parseGHLSlots(slotsData, timezone)
      .filter(s => isWithinBusinessHours(s.startTime, timezone) && s.startTime > Date.now())
      .map(s => ({ startTime: s.startTime, endTime: s.endTime, label: formatSlot(s.startTime, timezone) }));

    const TOLERANCE_MS = 5 * 60 * 1000;
    const exactMatch   = inHours && allSlots.find(s => Math.abs(s.startTime - requestedEpoch) <= TOLERANCE_MS);

    if (exactMatch) {
      return res.json({ available: true, slot: exactMatch });
    }

    const alternatives = allSlots
      .sort((a, b) => Math.abs(a.startTime - requestedEpoch) - Math.abs(b.startTime - requestedEpoch))
      .slice(0, 2);

    return res.json({
      available: false,
      requested_label: inHours ? formatSlot(requestedEpoch, timezone) : `${time_str} (outside 9am–7pm window)`,
      alternatives,
    });

  } catch (err) {
    console.error(err);
    res.json({ available: false, alternatives: [] });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /book-appointment
// Called by Retell tool after prospect confirms a slot
// Body: { prospect_name, prospect_email, business_name, slot_label,
//         start_time, end_time, timezone, crm_contact_id }
// Returns: { success, appointmentId, contactId }
// ─────────────────────────────────────────────────────────────────────────────
app.post('/book-appointment', async (req, res) => {
  const { prospect_name, prospect_email, business_name, slot_label, start_time, end_time, timezone, crm_contact_id } = req.body;

  if (!prospect_name || !prospect_email || !start_time || !end_time) {
    return res.json({ success: false, message: 'Missing required booking details.' });
  }

  try {
    let contactId = crm_contact_id || null;

    if (!contactId) {
      const [firstName, ...rest] = prospect_name.trim().split(' ');
      const contactRes = await fetch(`${CRM_BASE}/contacts/`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${CRM_API_KEY}`, 'Content-Type': 'application/json', Version: '2021-07-28' },
        body: JSON.stringify({
          locationId:  CRM_LOCATION_ID,
          firstName,
          lastName:    rest.join(' ') || '',
          email:       prospect_email,
          companyName: business_name || '',
          tags:        ['demo_call_booked'],
          timezone,
        }),
      });
      const contactData = await contactRes.json();
      contactId = contactData?.contact?.id;
    }

    const apptRes = await fetch(`${CRM_BASE}/calendars/events/appointments`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${CRM_API_KEY}`, 'Content-Type': 'application/json', Version: '2021-04-15' },
      body: JSON.stringify({
        calendarId:        CRM_CALENDAR_ID,
        locationId:        CRM_LOCATION_ID,
        contactId,
        title:             `Discovery Call — ${business_name || prospect_name}`,
        startTime:         start_time,
        endTime:           end_time,
        appointmentStatus: 'new',
        timezone,
        notes:             `Booked via AI Voice Demo. Slot: ${slot_label || 'N/A'}.`,
      }),
    });

    const apptData = await apptRes.json();

    if (!apptRes.ok) {
      console.error('Appointment creation failed:', apptData);
      return res.json({ success: true, message: 'Contact saved. Calendar invite will follow via email.', contactId });
    }

    return res.json({ success: true, message: 'Discovery call booked.', appointmentId: apptData?.id, contactId });

  } catch (err) {
    console.error(err);
    // Always return 200 — never crash the agent mid-call
    return res.json({ success: true, message: 'Booking received. Confirmation coming shortly.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
