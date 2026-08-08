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
 *   POST /book-appointment     → book a Creative Copyz calendar appointment
 *   GET  /demo-config/:slug    → JSON config for a demo landing page
 *   GET  /:slug                → serve the niche demo landing page
 */
const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch'); // v2 — CommonJS compatible
const path     = require('path');
const fs       = require('fs');
const db       = require('./db');
// ── Cold email ───────────────────────────────────────────────────────────────
const { runSendLoop }           = require('./cold-email/sendLoop');
const { detectRepliesAndBounces } = require('./cold-email/replyDetector');
const emailPool       = require('./cold-email/pool');
const resolveTimezone = require('./routes/enroll').resolveTimezone; // see below


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


// City abbreviations for slug collision suffix
const CITY_ABBREV = {
  'houston':'hou','dallas':'dfw','dallas-fort worth':'dfw','phoenix':'phx',
  'atlanta':'atl','miami':'mia','orlando':'orl','tampa':'tpa',
  'charlotte':'clt','nashville':'bna','denver':'den','las vegas':'las',
  'san antonio':'sat','austin':'aus','raleigh':'rdu',
  'toronto':'yyz','calgary':'yyc','vancouver':'yvr',
  'sydney':'syd','melbourne':'mel','brisbane':'bne'
};


async function generateSlug(businessName, city) {
  const base = (businessName || 'business')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 24);
  const plain = `${base}-aivoicedemo`;
  if (!(await db.slugTaken(plain))) return plain;
  const abbrev = CITY_ABBREV[(city || '').toLowerCase()]
    || (city || '').toLowerCase().replace(/[^a-z]/g, '').slice(0, 3)
    || 'x';
  const withCity = `${base}-${abbrev}-aivoicedemo`;
  if (!(await db.slugTaken(withCity))) return withCity;
  let n = 2;
  while (await db.slugTaken(`${base}-${abbrev}-${n}-aivoicedemo`)) n++;
  return `${base}-${abbrev}-${n}-aivoicedemo`;
}


const htmlTemplates = {};
function getNicheTemplate(niche) {
  if (!htmlTemplates[niche]) {
    const file = path.join(__dirname, 'templates', `${niche}.html`);
    htmlTemplates[niche] = fs.readFileSync(file, 'utf8');
  }
  return htmlTemplates[niche];
}


// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));


// ============================================================
// NICHE TEMPLATES
// ============================================================
const NICHE_TEMPLATES = {
  restoration: {
    agentName: 'Emma',
    toneBlock: `
TONE AND PERSONA
You are calm, empathetic, and action-oriented. Many callers are panicking due to water, fire, storm, or mold damage.
Your first job is to make them feel that help is already on the way. Speak with quiet confidence.
Never sound rushed or robotic. After a storm event you may be one of many calls arriving at once.
Never let the caller feel they are in a queue or being processed.
INDUSTRY CONTEXT
This business handles both emergency mitigation, which is stopping the damage from getting worse,
and the restoration work that follows, which is putting the property back together.
Typical calls include:
- Water and flood damage: burst or frozen pipe, supply line failure, appliance leak, roof leak, sewage backup
- Storm and disaster damage: wind, hail, hurricane, tornado, fallen trees, flash flooding
- Fire and smoke damage, including soot cleanup and odour removal
- Mold growth, often discovered after a leak that went unaddressed
- Emergency board-up and roof tarping to secure a property
- Emergency water extraction and structural drying
- Contents pack-out, cleaning, and storage
- Commercial and large loss work: offices, retail, multi-unit residential, schools, care facilities
Callers are usually homeowners, but may also be property managers, facility managers, insurance adjusters,
or plumbers and contractors referring a job. Adjust your language accordingly.
What they want to know: can someone come out today, is this covered by insurance, and what happens first.
SAFETY
If a caller mentions sewage, contaminated water, structural damage, or standing water near electrical outlets
or a panel, tell them not to enter the affected area and treat the call as urgent.
KEY POINTS TO COMMUNICATE
- 24/7 emergency response available
- Free damage assessment
- Works directly with insurance companies
- Licensed and certified technicians on call
- Emergency mitigation comes first, extraction, drying, board-up and tarping, then the restoration and rebuild
- Both residential and commercial work handled`,
    openingLine: 'Thank you for calling {businessName}, this is Emma. Are you dealing with an emergency right now?'
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
    openingLine: 'Thank you for calling {businessName}, this is Emma. Are you locked out right now?'
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
    openingLine: 'Thank you for calling {businessName}, this is Emma. Is this an emergency with your pet?'
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
    openingLine: 'Thank you for calling {businessName}, this is Emma. How can I help you today?'
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
    openingLine: 'Thank you for calling {businessName}, this is Emma. Are you broken down right now?'
  }
};


// ============================================================
// NICHE NORMALIZER
// ============================================================
function normalizeNiche(niche) {
  const n = (niche || '').toLowerCase();
  if (n.includes('restoration') || n.includes('disaster mitigation') || n.includes('flood') || n.includes('water damage') || n.includes('fire damage') || n.includes('mold')) return 'restoration';
  if (n.includes('bail'))                                                                                    return 'bailbond';
  if (n.includes('tow'))                                                                                     return 'towing';
  if (n.includes('locksmith') || n.includes('lockout') || n.includes('lock'))                               return 'locksmith';
  if (n.includes('vet') || n.includes('animal') || n.includes('animal hospital') || n.includes('pet'))      return 'vet';
  if (n.includes('funeral') || n.includes('mortuary') || n.includes('cremation'))                           return 'funeral';
  if (n.includes('septic') || n.includes('sewage') || n.includes('drain'))                                  return 'septic';
  if (n.includes('nemt') || n.includes('medical transport') || n.includes('non-emergency'))                 return 'nemt';
  if (n.includes('security') || n.includes('guard'))                                                        return 'security';
  if (n.includes('roadside') || n.includes('breakdown') || n.includes('battery'))                           return 'roadside';
  return 'restoration';
}


// ============================================================
// SYSTEM PROMPT BUILDER
// ✅ FIX 2: Added Creative Copyz pronunciation
// ✅ FIX 3: coreServices & callerFaqs now have instructive sections
// ============================================================
function buildSystemPrompt({ niche, businessName, city, coreServices, tagline, callerFaqs }) {
  const key      = normalizeNiche(niche);
  const template = NICHE_TEMPLATES[key] || NICHE_TEMPLATES.restoration;
  const today    = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const opening = template.openingLine.replace('{businessName}', businessName);


  // ✅ FIX 3: Build dedicated personalisation sections only when data exists
  const servicesSection = coreServices ? `
## WHAT ${businessName.toUpperCase()} SPECIFICALLY OFFERS
The following is the actual service list for ${businessName}. Use this whenever a caller asks what you do,
what you cover, whether you handle a specific job type, or what sets you apart.
Do NOT give generic industry answers — always draw from this list first:
${coreServices}


If a caller asks about something not on this list, say it is a great question and that the real version
of this agent would know the full answer. Do not make up services.
` : '';


  const faqSection = callerFaqs ? `
## HOW TO HANDLE THE MOST COMMON CALLER QUESTIONS
The following are the real questions callers most frequently ask ${businessName}.
For each of these, give a specific, confident answer — do not deflect with generic phrases.
Use the business name and city to make answers feel personal and local:
${callerFaqs}


For any question NOT listed here, use your niche knowledge to give a helpful answer,
but never invent specific facts (prices, staff, response times) about ${businessName}.
` : '';


      return `
# AI VOICE RECEPTIONIST DEMO
Business being demoed: ${businessName}
City: ${city}
Today's date: ${today}


## WHAT THIS IS
You are Emma, an AI voice receptionist demo built by Creative Copies.
You are showing ${businessName} exactly what their own AI receptionist would sound like.
You are NOT the real receptionist for ${businessName} and you cannot dispatch their team,
book their services, or make any real commitments on their behalf.


## IDENTITY
Your name is Emma. You speak as if you are the receptionist for ${businessName} in ${city}.
${tagline ? `Their tagline: "${tagline}"` : ''}


${servicesSection}
${faqSection}


## OPENING LINE
When the call connects, say exactly:
"${opening}"


${template.toneBlock}


## WHAT YOU DO IN THIS DEMO
1. Answer questions about what ${businessName} does and how they help customers in ${city}
2. Handle the conversation the way a real receptionist for ${businessName} would
3. When the caller tries to take action, end the demo cleanly and offer to book a setup call


## ONE QUESTION AT A TIME - ABSOLUTE RULE
Never ask two questions in one turn. Ask one, wait for the answer, then ask the next.
Never join two questions with "and" or "or".
This applies everywhere, including intake and the booking flow.
Wrong: "Can I get your first and last name?"
Wrong: "What is your name, and what is the best email for you?"
Right: "What is your first name?" then, after they answer, "And your last name?"
If you notice you are about to ask a second question, stop and ask only the first.


## DEMO BOUNDARY - CRITICAL
You cannot book real service appointments for ${businessName}.
You cannot dispatch a team, confirm a job, or make real commitments on their behalf.
The moment a caller tries to do any of the following, go to ENDING THE DEMO below:
- Book an appointment or service call
- Schedule an inspection, pickup, consultation, or transport
- Get a quote or estimate confirmed
- Have someone dispatched to their location
- Speak to the owner or a technician
- Anything that would require ${businessName}'s team to act
This is not a failure. It is the natural end of the demo.


## ENDING THE DEMO AND OFFERING THE SETUP CALL
Stop role-playing and be transparent. In your own words, cover these four points in order:
1. That is where the demo ends. You are Emma, an AI voice agent Creative Copies built
   to show ${businessName} what this would sound like on their own calls.
2. A real version would go further: taking the booking properly and working with the
   systems ${businessName} already uses.
3. Offer a short call with the team, so they can work out exactly what needs to be added
   to make this agent truly theirs.
4. Ask whether they would like you to check some times. ONE question. Then stop and wait.
Speak it naturally in a few sentences. Never read this section aloud as a list.


Here is the right length and tone. Adapt it, do not repeat it word for word:
"That is actually where the demo stops. I am Emma, an AI agent Creative Copies built to
show you what this would sound like on your own lines. A real version would take that
booking properly and work with the systems you already use. I can set up a quick call
with the Creative Copies team so they can work out exactly what needs adding to make me work for ${businessName}.
Would you like me to check some times?"


If they say no, thank them warmly and end the call. Do not push.
If they say yes, go to the booking flow.
If a tool fails twice in a row, stop retrying. Say you will have the team email
them to arrange a time, thank them, and end the call.


## BOOKING FLOW
Follow these steps in order. ONE question per turn, every time.
Never skip a step. Never check availability before you know their timezone.


STEP 1 - WHERE THEY ARE BASED
Before touching the calendar, ask where they are calling from:
"Before I check times, whereabouts are you based?"
Do not ask for their timezone directly. Most people do not know it offhand.
If they volunteer one ("I'm on Eastern"), use it and move on.
Work out the IANA timezone from what they say:
- New York, Boston, Philadelphia, Atlanta, Miami, Orlando, Tampa, Charlotte,
  Raleigh, Toronto, and most of Florida and the US east coast: America/New_York
- Chicago, Dallas, Houston, Austin, San Antonio, Nashville, Minneapolis,
  New Orleans, Winnipeg: America/Chicago
- Denver, Salt Lake City, Albuquerque, Calgary: America/Denver
- Phoenix and most of Arizona: America/Phoenix
- Los Angeles, San Francisco, Seattle, Portland, San Diego, Las Vegas,
  Vancouver: America/Los_Angeles
- Sydney, Melbourne, Canberra: Australia/Sydney
- Brisbane: Australia/Brisbane
- London: Europe/London
If they name a city you are unsure about, ask which state or country it is in.
Never guess a timezone. Never assume the caller is in the same place as the
business you have been role-playing.


STEP 2 - WHICH DAY
Ask: "And what day suits you best?"
Convert their answer to a date. Today's date is given at the top of this prompt.
"Tomorrow" means the day after today's date.


STEP 3 - CHECK AVAILABILITY
Only now, call the check_availability tool with BOTH the date and the timezone
you worked out in step 1. Never guess or invent times.
Once you call the tool, DO NOT wait for the caller to speak.
The tool will return available slots \u2014 speak them out immediately when you have them.


STEP 3b - IF THERE ARE NO OPENINGS IN THE NEXT 2 DAYS
If check_availability says there are no openings during regular hours, do not
keep checking other dates. Switch to taking their details so the team can reach
out instead. Same rules apply: ONE question per turn, and every spell-back is
mandatory.
 
3b-1  PREFERRED TIME
      The tool response already asked what time of day suits them.
      Wait for their answer: morning, afternoon, evening, or something specific.
 
3b-2  FIRST NAME
      Ask: "And what is your first name?"
      Spell it back letter by letter: "That is J-O-H-N, is that right?"
      MANDATORY. Keep correcting until they confirm.
 
3b-3  LAST NAME
      Only after the first name is confirmed. Ask: "And your last name?"
      Spell it back letter by letter. MANDATORY.
 
3b-4  EMAIL
      Ask: "And the best email for the team to reach you on?"
      Read the whole address back one character at a time, following the same
      email rules as STEP 7 below, including saying "double" for any letter that
      appears twice in a row. MANDATORY.
 
3b-5  SEND IT
      Call request_followup with firstName, lastName, email, preferredTime, and
      the timezone you established in step 1.
      Once it responds, say your closing line and call end_call.
 
Do not skip the name or the email in this path. Without them the team has no way
to reach the caller and the whole conversation is wasted.


STEP 4 - OFFER SLOTS AND LOCK ONE IN
One slot available: "I have [day] at [time]. Does that work for you?"
Several available: "I have [time 1], [time 2], or [time 3]. Which suits you best?"
Wait for them to confirm a specific time before asking anything else.
Do not ask for their name until a time is agreed.


STEP 5 - FIRST NAME
Ask: "What is your first name?"
Then spell it back letter by letter: "That is J-O-H-N, is that right?"
MANDATORY. Never skip the spell-back, no matter how common or obvious the name sounds.
If they correct you, spell it back again with the correction and keep going until confirmed.


STEP 6 - LAST NAME
Only after the first name is confirmed.
Ask: "And your last name?"
Then spell it back letter by letter: "S-M-I-T-H, correct?"
MANDATORY. Same correction loop.


STEP 7 - EMAIL
Ask: "What is the best email for your confirmation?"


Read it back one character at a time. This is the single most error-prone moment
in the call, so slow down and follow these rules exactly:


- Say every character separately, including the part before the @.
- If the SAME LETTER APPEARS TWICE IN A ROW, say it as "double" plus the letter.
  "ccopyz" is "double C, O, P, Y, Z". Never say it once. Never merge them.
- Say "at" for @ and "dot" for the full stop.
- Never pronounce any part of the address as a word. "gmail" is
  "G-M-A-I-L", not "gmail".
- Numbers are said individually: "2 4" not "twenty four".


Example: anne@ccopyz.net is read back as
"A, N, N, E, at, double C, O, P, Y, Z, dot, N, E, T. Is that right?"


MANDATORY. Never skip this because the address sounds ordinary.
If they correct any part, read the WHOLE address back again from the start,
and keep going until they confirm it is right.


STEP 8 - BOOK AND CLOSE
Use the book_appointment tool with firstName, lastName, email, the chosen
startTime, and the same timezone you established in step 1.
Once it confirms, say:
"You are all set for [day] at [time]. A confirmation is on its way to your email, and
the team will be in touch before the call."
End the call naturally. Do NOT say "Is there anything else I can help you with?"


## SPEAKING STYLE
- Speak naturally, like a warm and capable human receptionist
- Use natural fillers occasionally: "Sure", "Of course", "Absolutely", "Got it"
- Keep responses short. This is a phone call, not an email
- One question per turn, always
- Never read out long lists. Summarise and offer to elaborate
- If asked something specific about ${businessName} that you do not know:
  "That is a great question, and exactly the kind of thing the real version would know
   for your business. That detail gets built in during setup."


## ENDING THE CALL - USE THE end_call TOOL
You have an end_call tool. Nothing hangs up unless you call it.


Say your closing sentence first, then call end_call in the same turn.
Never call it before speaking, or the caller hears silence and a disconnect.


Call end_call after any of these, and do not ask another question first:
- book_appointment came back confirmed and you have read the confirmation out
- request_followup came back and you have thanked them
- the caller says they are not interested, or declines the setup call
- the caller says goodbye, thanks you, or otherwise signals they are done
- a tool has failed twice and you have told them the team will email them


Do not wait for the caller to hang up. Do not say "is there anything else".
Once the reason for the call is resolved, close warmly and end it.


## GUARDRAILS
- Never mention or compare competitor companies
- Never make up specific facts about ${businessName}: prices, staff names, response times
- Never promise that ${businessName} will do anything. You are a demo, not their staff
- Never ask two questions in one turn
- Never skip the spell-back on a name or an email
- Never check the calendar before you know where the caller is based
- Stay in character as Emma until the demo ends, then be straightforward about being a demo
- Never merge a doubled letter when spelling. Say "double C", not "C"
- After the demo ends you are still warm and helpful, just now booking for Creative Copies
`.trim();
}


// ─── toolArgs helper ──────────────────────────────────────────────────────────
function toolArgs(req, label) {
  const b = req.body || {};
  const found = b.args || b.arguments || b.parameters || b.function_arguments || {};
  const args  = (found && typeof found === 'object' && Object.keys(found).length) ? found : b;
  console.log(`[${label}] envelope keys: ${Object.keys(b).join(', ')} | args: ${JSON.stringify(args)}`);
  return args;
}


// ─── Request logger ───────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});


// ─── Guard missing env vars ───────────────────────────────────────────────────
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
      DATABASE_URL       : process.env.DATABASE_URL ? '✅ set' : '❌ MISSING',
      RETELL_API_KEY     : RETELL_API_KEY     ? '✅ set' : '❌ MISSING',
      CRM_API_KEY        : CRM_API_KEY        ? '✅ set' : '❌ MISSING',
      CRM_CALENDAR_ID    : CRM_CALENDAR_ID    ? '✅ set' : '❌ MISSING',
      CRM_LOCATION_ID    : CRM_LOCATION_ID,
      RAILWAY_PUBLIC_URL : RAILWAY_PUBLIC_URL ? 'SET'    : 'MISSING — required for booking tools',
    },
  });
});


// ─── Campaign stats ───────────────────────────────────────────────────────────
app.get('/stats', async (_req, res) => {
  try {
    return res.json(await db.stats());
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});


app.use(require('./routes/enroll'));


const cleanBusinessName = (name) => (name || '')
  // Strip legal entity suffixes (LLC, Inc, Corp, etc.)
  .replace(/[,.]?\s*(LLC|L\.L\.C\.|Inc\.?|Incorporated|Corp\.?|Corporation|Ltd\.?|Limited|Co\.?|Company|Pvt\.?\s*Ltd\.?|LLP|LP|PLLC|PA|PC)\s*\.?$/gi, '')
  // Strip trailing " Group" (e.g. "Smith Restoration Group" → "Smith Restoration")
  .replace(/\s+Group\s*$/gi, '')
  // Strip "of [City]" suffix (e.g. "Premier Plumbing of Houston" → "Premier Plumbing")
  .replace(/\s+of\s+[A-Za-z][A-Za-z\s]{0,30}$/gi, '')
  // Strip " - [City]" suffix (e.g. "Elite Towing - Dallas" → "Elite Towing")
  // Uses " - " with spaces around dash to avoid stripping hyphenated brand names
  .replace(/\s+-\s+[A-Za-z][A-Za-z\s]{0,30}$/g, '')
  // Normalize whitespace
  .replace(/\s{2,}/g, ' ')
  .trim();


// ── CRM custom field write-back ───────────────────────────────────────────────
// GHL's basic Webhook action cannot map a response back onto the contact, so the
// server writes the fields itself. Field IDs are looked up once by name and
// cached, which means the workflow never has to know an ID.
let crmFieldMap = null;


async function getCrmFieldMap() {
  if (crmFieldMap) return crmFieldMap;
  try {
    const r = await fetch(
      `${CRM_API}/locations/${CRM_LOCATION_ID}/customFields`,
      { headers: { Authorization: `Bearer ${CRM_API_KEY}`, Version: '2021-07-28' } }
    );
    const d = await r.json();
    if (!r.ok) {
      console.error('[crm-fields] lookup failed:', JSON.stringify(d));
      return {};
    }
    crmFieldMap = {};
    for (const f of (d.customFields || d.customField || [])) {
      if (f.name) crmFieldMap[f.name.trim().toLowerCase()] = f.id;
      if (f.fieldKey) crmFieldMap[String(f.fieldKey).toLowerCase()] = f.id;
    }
    console.log(`[crm-fields] cached ${Object.keys(crmFieldMap).length} field keys`);
    return crmFieldMap;
  } catch (e) {
    console.error('[crm-fields] lookup error:', e.message);
    return {};
  }
}


// values: { "Voice AI Agent ID": "agent_...", "Demo Page URL": "https://..." }
// Field names must match the CRM exactly, case-insensitively.
async function updateContactFields(contactId, values) {
  if (!contactId) {
    console.warn('[crm-update] no contactId, skipping write-back');
    return false;
  }


  const map = await getCrmFieldMap();
  const customFields = [];
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === '') continue;
    const id = map[name.trim().toLowerCase()];
    if (!id) { console.warn(`[crm-update] no field named "${name}" in this location`); continue; }
    customFields.push({ id, value: String(value) });
  }


  if (!customFields.length) {
    console.warn('[crm-update] nothing to write');
    return false;
  }


  try {
    const r = await fetch(`${CRM_API}/contacts/${contactId}`, {
      method  : 'PUT',
      headers : {
        Authorization  : `Bearer ${CRM_API_KEY}`,
        Version        : '2021-07-28',
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({ customFields }),
    });
    if (!r.ok) {
      console.error(`[crm-update] failed (${r.status}):`, await r.text());
      return false;
    }
    console.log(`[crm-update] ✅ ${customFields.length} field(s) written to ${contactId}`);
    return true;
  } catch (e) {
    console.error('[crm-update] error:', e.message);
    return false;
  }
}


// ── orderPalette ───────────────────────────────────────────────────────────────
// The template uses secondary for the page background (--b0) and primary for the
// button fill, orb and glows. Two rules follow from that:
//   1. The darker of the two colours must be the secondary.
//   2. Primary must be light enough for the dark button text to be readable,
//      since .button is color: var(--b0) on background: var(--p).
// Scraped brand colours arrive in any order, so normalise here rather than
// trusting whatever the CRM happened to store.
function relLuminance(hex) {
  const h = String(hex || '').replace(/^#/, '');
  const c = [0, 2, 4].map(i => {
    let v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}


function lightenHex(hex, t) {
  const h = String(hex || '').replace(/^#/, '');
  return [0, 2, 4]
    .map(i => Math.round(parseInt(h.slice(i, i + 2), 16) * (1 - t) + 255 * t))
    .map(v => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}


function orderPalette(primary, secondary) {
  const clean = (hex, fallback) => {
    const v = String(hex || '').replace(/[^a-fA-F0-9]/g, '');
    const e = v.length === 3 ? v.split('').map(c => c + c).join('') : v;
    return /^[a-fA-F0-9]{6}$/.test(e) ? e.toUpperCase() : fallback;
  };


  let p = clean(primary, '2563EB');
  let s = clean(secondary, '1E3A8A');


  // Darker colour goes to the background slot.
  if (relLuminance(p) < relLuminance(s)) { const t = p; p = s; s = t; }


  // Keep the button legible: dark text needs a reasonably light fill.
  let guard = 0;
  while (relLuminance(p) < 0.30 && guard++ < 12) p = lightenHex(p, 0.18);


  return { primary: p, secondary: s };
}


// ── computePalette ─────────────────────────────────────────────────────────────
// Server-side mirror of the template's applyPalette() function.
// Pre-computes the full set of CSS custom properties (--p, --s, --b0…--bd)
// from just two input hex colours, using the exact same mixing formula.
// This lets the server inject correct colours directly into <head> as inline
// style properties — so the page renders the right palette before any JS runs.
// Feed it the output of orderPalette, not the raw stored values.
function computePalette(primaryHex, secondaryHex) {
  function parseHex(hex) {
    const v = String(hex || '').replace(/[^a-fA-F0-9]/g, '');
    const e = v.length === 3 ? v.split('').map(c => c + c).join('') : v;
    return /^[a-fA-F0-9]{6}$/.test(e) ? e.toUpperCase() : '2563EB';
  }
  function toArr(h) {
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  function mix(a, b, t) { return a.map((v,i) => Math.round(v*(1-t) + b[i]*t)); }
  function rgb(c)      { return 'rgb('  + c.join(',') + ')'; }
  function rgba(c, a)  { return 'rgba(' + c.join(',') + ',' + a + ')'; }


  const pHex = parseHex(primaryHex),  sHex = parseHex(secondaryHex);
  const p    = toArr(pHex),           s    = toArr(sHex);
  const B    = [0,0,0],               W    = [255,255,255];


  return {
    '--p' : '#' + pHex,
    '--s' : '#' + sHex,
    '--b0': rgb(mix(s, B, .45)),
    '--b1': '#' + sHex,
    '--b2': rgb(mix(s, W, .06)),
    '--b3': rgb(mix(s, W, .12)),
    '--gl': rgba(p, .35),
    '--gs': rgba(p, .12),
    '--bd': rgba(p, .20),
    '--t' : '#F0F0F0',
    '--tm': 'rgba(240,240,240,.44)',
    '--td': 'rgba(240,240,240,.20)',
  };
}
// ─────────────────────────────────────────────────────────────────────────────
// POST /create-agent
// ─────────────────────────────────────────────────────────────────────────────
app.post('/create-agent', async (req, res) => {
  try {
    const raw = { ...(req.body || {}), ...((req.body && req.body.customData) || {}) };
    const pick = (...keys) => {
      for (const k of keys) {
        const v = raw[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
        if (v != null && typeof v !== 'string') return v;
      }
      return '';
    };


    const niche          = pick('niche', 'Primary Business Type')       || 'restoration';
    const rawName        = pick('businessName', 'company_name')         || 'Your Business';
    const city           = pick('city', 'City')                         || 'your area';
    const coreServices   = pick('coreServices', 'Core Services');
    const tagline        = pick('tagline', 'Business Tagline');
    const callerFaqs     = pick('callerFaqs', 'Caller FAQs');
    const contactId = pick('contactId', 'contact_id', 'id', 'Contact Id', 'contactID');
    const primaryColor   = pick(
      'primaryColor',   'primary_color',
      'Brand Primary Color',   'brand_primary_color',   'brandPrimaryColor',
      'Primary Color',         'primary',               'color_primary',
      'brand_color',           'brandColor',
    );
    const secondaryColor = pick(
      'secondaryColor', 'secondary_color',
      'Brand Secondary Color', 'brand_secondary_color', 'brandSecondaryColor',
      'Secondary Color',       'secondary',             'color_secondary',
      'brand_secondary',       'brandSecondary',
    );


    console.log(`[create-agent] niche="${niche}" business="${rawName}" city="${city}"`);
    console.log(`[create-agent] coreServices="${coreServices}" callerFaqs="${callerFaqs}"`);
    console.log(`[create-agent] 🎨 primaryColor="${primaryColor}" secondaryColor="${secondaryColor}"`);
    console.log(`[create-agent] 📦 raw keys: ${Object.keys(raw).join(', ')}`);


    const businessName     = cleanBusinessName(rawName);
    const systemPrompt     = buildSystemPrompt({ niche, businessName, city, coreServices, tagline, callerFaqs });
    const nicheLabel       = normalizeNiche(niche);
    const agentDisplayName = `[${nicheLabel}] ${businessName} - ${city}`;
    const openingLine = (NICHE_TEMPLATES[nicheLabel] || NICHE_TEMPLATES.restoration)
      .openingLine.replace('{businessName}', businessName);


    const RAILWAY_URL = process.env.RAILWAY_PUBLIC_URL;
    const RETELL_KEY  = process.env.RETELL_API_KEY;
    const VOICE_ID    = process.env.RETELL_VOICE_ID || 'retell-Cimo';


    // ── STEP 1: Create Retell LLM ────────────────────────────────────────────
    const llmRes = await fetch('https://api.retellai.com/create-retell-llm', {
      method  : 'POST',
      headers : { 'Authorization': `Bearer ${RETELL_KEY}`, 'Content-Type': 'application/json' },
      body    : JSON.stringify({
        model                 : 'gpt-4.1',
        model_high_priority   : true,
        model_temperature     : 0,
        tool_call_strict_mode : true,
        begin_message         : openingLine,
        general_prompt        : systemPrompt,
        general_tools: [
  {
    type                         : 'custom',
    name                         : 'check_availability',
    description                  : 'Check available appointment slots. Call this whenever the caller wants to book or asks about available times. After calling this tool, speak the result immediately — do not wait for the caller to say anything.',
    speak_during_execution       : true,
    speak_after_execution        : true,
    execution_message_description: 'Tell the caller you are checking available times for them, e.g. "Let me check what times we have available for you."',
    url                          : `${RAILWAY_URL}/retell-tools/check-availability`,
    parameters: {
      type      : 'object',
      properties: {
        date: {
          type       : 'string',
          description: 'The calendar date to check, formatted as YYYY-MM-DD.'
        },
        timezone: {
          type       : 'string',
          description: 'IANA timezone derived from the location the caller gave you, e.g. America/New_York, America/Chicago, America/Denver, America/Phoenix, America/Los_Angeles. Never guess. Ask where they are based first if you do not know.'
        }
      },
      required: ['date', 'timezone']
    }
  },
  {
    type                         : 'custom',
    name                         : 'book_appointment',
    description                  : 'Book a confirmed appointment slot. Only call this after the caller has confirmed their first name, last name, email, and chosen time slot.',
    speak_during_execution       : true,
    speak_after_execution        : true,
    execution_message_description: 'Tell the caller you are booking that slot now, e.g. "Perfect, booking that for you now."',
    url                          : `${RAILWAY_URL}/retell-tools/book-appointment`,
    parameters: {
      type      : 'object',
      properties: {
        firstName: { type: 'string', description: "Caller's first name, confirmed and spelled back" },
        lastName : { type: 'string', description: "Caller's last name, confirmed and spelled back" },
        email    : { type: 'string', description: "Caller's email address, confirmed character by character" },
        startTime: { type: 'string', description: 'ISO 8601 datetime string of the selected slot, e.g. 2026-08-10T14:00:00-05:00' },
        timezone : { type: 'string', description: 'IANA timezone of the caller, e.g. America/New_York' }
      },
      required: ['firstName', 'lastName', 'email', 'startTime']
    }
  },
  {
    type                         : 'custom',
    name                         : 'request_followup',
    description                  : "Call this tool ONLY when check_availability has said there are no openings in the next 2 days, AND you have collected the caller's first name, last name, email and preferred time of day. The team uses these to reach out and arrange a time.",
    speak_during_execution       : true,
    speak_after_execution        : true,
    execution_message_description: 'Tell the caller you are passing their details to the team, e.g. "Perfect, let me get that over to the team now."',
    url                          : `${RAILWAY_URL}/retell-tools/request-followup`,
    parameters: {
      type      : 'object',
      properties: {
        firstName    : { type: 'string', description: "Caller's first name, confirmed and spelled back" },
        lastName     : { type: 'string', description: "Caller's last name, confirmed and spelled back" },
        email        : { type: 'string', description: "Caller's email address, confirmed character by character" },
        preferredTime: { type: 'string', description: 'The time of day the caller prefers for a follow-up call, e.g. "mornings", "after 5pm", "weekday afternoons".' },
        timezone     : { type: 'string', description: 'IANA timezone of the caller, e.g. America/New_York' }
      },
      required: ['firstName', 'lastName', 'email', 'preferredTime']
    }
  },
          {
    type        : 'end_call',
    name        : 'end_call',
    description : 'Hang up the call. Call this immediately after a booking is confirmed, after a follow-up time has been noted, or when the caller says they are not interested. Always say your closing line first, then call this.'
  }
]
      })
    });


    if (!llmRes.ok) {
      const err = await llmRes.text();
      throw new Error(`LLM creation failed: ${err}`);
    }
    const llmData = await llmRes.json();


    // ── STEP 2: Create Retell Agent ──────────────────────────────────────────
    const agentRes = await fetch('https://api.retellai.com/create-agent', {
      method  : 'POST',
      headers : { 'Authorization': `Bearer ${RETELL_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_engine: {
          type   : 'retell-llm',
          llm_id : llmData.llm_id
        },
        agent_name               : agentDisplayName,
        voice_id                 : VOICE_ID,
        language                 : 'en-US',
        responsiveness           : 1,
        interruption_sensitivity : 1,
        enable_backchannel       : true,
        backchannel_frequency    : 0.8,
        backchannel_words        : ['got it', 'sure', 'okay', 'absolutely'],
        ambient_sound            : 'coffee-shop',
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
    const slug      = await generateSlug(businessName, city);
    const DEMO_BASE = process.env.DEMO_BASE_URL || 'https://demo.creativecopyz.com';
    const demoUrl   = `${DEMO_BASE}/${slug}`;


    await db.createDemo({
      slug,
      agentId        : agentData.agent_id,
      llmId          : llmData.llm_id,
      niche          : nicheLabel,
      businessName,
      city,
      tagline,
      coreServices,
      primaryColor,
      secondaryColor,
      contactId,
      maxCalls       : 5
    });


    console.log(`[create-agent] ✅ ${slug} → ${agentData.agent_id}`);

    // ── Enroll in cold email sequence ──────────────────────────────────────────
const prospectEmail = pick('email', 'Email', 'contact_email');
if (prospectEmail) {
  emailPool.query(
    `INSERT INTO enrollments
       (contact_id, prospect_email, prospect_name, prospect_city, prospect_tz,
        niche, company_name, demo_page_url, personalisation_hook, current_pain)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (prospect_email) DO NOTHING`,
    [
      contactId,
      prospectEmail.toLowerCase().trim(),
      businessName,
      city,
      resolveTimezone(city),
      nicheLabel,
      businessName,
      demoUrl,
      pick('personalisation_hook', 'Personalisation Hook') || '',
      pick('current_pain', 'Current Pain')                 || '',
    ]
  ).catch(e => console.error('[enroll] insert failed:', e.message));
  console.log(`[enroll] ✅ queued ${prospectEmail} (${nicheLabel})`);
}

    // Write straight back to the contact. Not awaited on the critical path:
    // a CRM hiccup should not fail an agent that was created successfully.
    updateContactFields(contactId, {
      'Voice AI Agent ID' : agentData.agent_id,
      'Demo Page URL'     : demoUrl,
      'Website Scraped'   : 'Yes',
    }).catch(() => {});
    return res.json({
      success   : true,
      agentId   : agentData.agent_id,
      llmId     : llmData.llm_id,
      agentName : agentDisplayName,
      demoUrl,
      slug
    });
  } catch (error) {
    console.error('create-agent error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /create-web-call
// ─────────────────────────────────────────────────────────────────────────────
app.post('/create-web-call', async (req, res) => {
  if (!guardEnv('RETELL_API_KEY', res)) return;
  const { agentId, metadata = {} } = req.body;
  if (!agentId) {
    return res.status(400).json({ error: 'agentId is required' });
  }


  let reservation;
  try {
    reservation = await db.reserveCall(agentId);
  } catch (e) {
    console.error('[create-web-call] DB error:', e.message);
    return res.status(500).json({ error: 'Storage unavailable' });
  }


  if (!reservation.ok) {
    const messages = {
      not_found     : 'This demo is no longer available.',
      expired       : 'This demo has expired.',
      limit_reached : 'This demo has reached its 5-call limit.',
    };
    console.log(`[create-web-call] Blocked ${agentId}: ${reservation.reason}`);
    return res.status(429).json({
      limitReached : reservation.reason === 'limit_reached',
      expired      : reservation.reason === 'expired',
      error        : messages[reservation.reason] || 'This demo is not available.',
    });
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
      await db.releaseCall(agentId).catch(() => {});
      return res.status(retellRes.status).json({ error: 'Web call creation failed', details: data });
    }
    console.log(`[create-web-call] Agent ${agentId} — ${reservation.calls_used}/${reservation.max_calls} calls used`);
    console.log(`[create-web-call] ✅ Call created — id: ${data.call_id}`);
    return res.json({
      success     : true,
      accessToken : data.access_token,
      callId      : data.call_id,
    });
  } catch (e) {
    await db.releaseCall(agentId).catch(() => {});
    console.error('[create-web-call] Exception:', e.message);
    return res.status(500).json({ error: 'Exception', message: e.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /check-availability  (direct HTTP endpoint — not the Retell webhook)
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
// POST /book-appointment  (direct HTTP endpoint — not the Retell webhook)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/book-appointment', async (req, res) => {
  if (!guardEnv('CRM_API_KEY', res))     return;
  if (!guardEnv('CRM_CALENDAR_ID', res)) return;
  const {
    firstName, lastName, email,
    phone     = '',
    startTime, endTime,
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
//    The calendar's own settings already restrict hours. The old filter caused
//    Emma to call the tool twice with identical args when a caller asked for
//    early/evening slots, always getting the same "no regular hours" reply.
//    Now all calendar-available slots are returned so Emma answers correctly
//    on the first tool call.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/retell-tools/check-availability', async (req, res) => {
  const body     = req.body || {};
  const args     = toolArgs(req, 'check-availability');
  const timezone = args.timezone || 'America/New_York';
  const agentId  = body.agent_id || ''; // Retell sends this — used by request_followup later


  let date = args.date;
  if (!date) {
    const t = new Date(Date.now() + 86400000);
    date = t.toISOString().split('T')[0];
    console.warn(`[check-availability] no date supplied, defaulting to ${date}`);
  }


  // Returns true if a slot falls between 9am and 7pm in the caller's timezone
  function is9to7(slotTime) {
    const h = parseInt(
      new Date(slotTime).toLocaleTimeString('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
      }).split(':')[0],
      10
    );
    return h >= 9 && h < 19;
  }


  function fmtSlots(slots, dateStr) {
    const times = slots.slice(0, 3).map(s =>
      new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone })
    ).join(', ');
    return slots.length === 1
      ? `On ${dateStr} I have one opening at ${times}. Does that work for you?`
      : `On ${dateStr} I have openings at ${times}. Which of those works best for you?`;
  }


  try {
    // Fetch a 2-day window in one API call
    const day2 = (() => {
      const d = new Date(date + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + 1);
      return d.toISOString().split('T')[0];
    })();
    const endDate = (() => {
      const d = new Date(date + 'T12:00:00Z');
      d.setUTCDate(d.getUTCDate() + 2);
      return d.toISOString().split('T')[0];
    })();


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


    const raw1    = (data[date]  && Array.isArray(data[date].slots))  ? data[date].slots  : [];
    const raw2    = (data[day2]  && Array.isArray(data[day2].slots))  ? data[day2].slots  : [];
    const slots1  = raw1.filter(is9to7);
    const slots2  = raw2.filter(is9to7);


    // ── Day 1 has daytime slots ───────────────────────────────────────────────
    if (slots1.length > 0) {
      const d1Str = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      return res.json({ result: fmtSlots(slots1, d1Str) });
    }


    // ── Day 2 has daytime slots ───────────────────────────────────────────────
    if (slots2.length > 0) {
      const d1Name = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long' });
      const d2Str  = new Date(day2  + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
      const times  = slots2.slice(0, 3).map(s =>
        new Date(s).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone })
      ).join(', ');
      const result = slots2.length === 1
        ? `I don't have anything on ${d1Name} during regular hours, but I do have an opening on ${d2Str} at ${times}. Would that work for you?`
        : `I don't have openings on ${d1Name} during regular hours, but on ${d2Str} I have slots at ${times}. Would any of those work?`;
      return res.json({ result });
    }


    // ── No daytime slots in either day — hand off to followup ────────────────
    console.log(`[check-availability] No 9-7 slots found for ${date} or ${day2} | agentId: ${agentId}`);
    return res.json({
      result: `It looks like we don't have any openings in the next couple of days during regular hours. Not a problem at all — someone from the Creative Copies team will reach out to set up a time that works for you. Just so they know when to call, what time of day generally works best for you — morning, afternoon, or evening?`
    });


  } catch (e) {
    console.error('[retell-tools/check-availability] Exception:', e.message);
    return res.json({ result: "I'm having trouble with the calendar right now. Let me have someone reach out to confirm a time." });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// RETELL TOOL WEBHOOK — POST /retell-tools/request-followup
// Called when check_availability finds no 9am–7pm slots in the next 2 days.
// Logs the caller's preferred time, tags them aivoice_followup in Hexona Systems,
// and adds a note with their preferred contact window.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/retell-tools/request-followup', async (req, res) => {
  const body    = req.body || {};
  const args    = toolArgs(req, 'request-followup');
  const agentId = body.agent_id || (body.call && body.call.agent_id) || '';
 
  const firstName     = String(args.firstName || '').trim();
  const lastName      = String(args.lastName  || '').trim();
  const email         = String(args.email     || '').trim().toLowerCase();
  const preferredTime = String(args.preferredTime || args.preferred_time || 'not specified').trim();
  const timezone      = args.timezone || 'America/New_York';
 
  const missing = [];
  if (!firstName) missing.push('first name');
  if (!lastName)  missing.push('last name');
  if (!email)     missing.push('email address');
  if (missing.length) {
    console.warn(`[request-followup] missing ${missing.join(', ')}`);
    return res.json({
      result: `I still need your ${missing.join(' and ')} so the team knows how to reach you. Could you share that?`
    });
  }
 
  console.log(`[request-followup] ${firstName} ${lastName} <${email}> prefers "${preferredTime}" (${timezone}) | agentId=${agentId || '(none)'}`);
 
  // Which demo this came from. Enrichment only — the contact is resolved by
  // email below, so a missing agent id no longer breaks the whole flow.
  let demoLabel = '';
  if (agentId) {
    try {
      const d = await db.getByAgentId(agentId);
      if (d) demoLabel = ` | Demo: ${d.business_name} (${d.slug})`;
    } catch (e) {
      console.error('[request-followup] demo lookup failed:', e.message);
    }
  }
 
  try {
    // ── Upsert by email. Matches an existing contact in this location and
    //    updates it, rather than creating a duplicate card.
    const upsertBody = { locationId: CRM_LOCATION_ID, firstName, lastName, email };
    const upsertRes = await fetch(`${CRM_API}/contacts/upsert`, {
      method  : 'POST',
      headers : {
        Authorization  : `Bearer ${CRM_API_KEY}`,
        Version        : '2021-07-28',
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify(upsertBody),
    });
    const upsertData = await upsertRes.json();
 
    if (!upsertRes.ok || !(upsertData.contact && upsertData.contact.id)) {
      console.error('[request-followup] upsert failed:', JSON.stringify(upsertData));
      return res.json({
        result: `Thanks ${firstName}. I have made a note of that and someone from the team will be in touch shortly.`
      });
    }
 
    const contactId = upsertData.contact.id;
    const isNew     = upsertData.new === true;
    console.log(`[request-followup] contact ${isNew ? 'created' : 'matched'} — id: ${contactId}`);
 
    // ── Tag
    await fetch(`${CRM_API}/contacts/${contactId}/tags`, {
      method  : 'POST',
      headers : {
        Authorization  : `Bearer ${CRM_API_KEY}`,
        Version        : '2021-04-15',
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify({ tags: ['aivoice_followup'] }),
    }).then(r => console.log(`[request-followup] tag ${r.ok ? 'added' : 'FAILED ' + r.status}`))
      .catch(e => console.error('[request-followup] tag error:', e.message));
 
    // ── Note
    const noteBody = {
      body: `AI Voice Demo follow-up. No calendar openings were available during the call. `
          + `Caller: ${firstName} ${lastName} <${email}>. `
          + `Preferred contact time: ${preferredTime} (${timezone}).${demoLabel}`
    };
    if (process.env.CRM_USER_ID) noteBody.userId = process.env.CRM_USER_ID;
 
    await fetch(`${CRM_API}/contacts/${contactId}/notes`, {
      method  : 'POST',
      headers : {
        Authorization  : `Bearer ${CRM_API_KEY}`,
        Version        : '2021-04-15',
        'Content-Type' : 'application/json',
      },
      body: JSON.stringify(noteBody),
    }).then(r => console.log(`[request-followup] note ${r.ok ? 'added' : 'FAILED ' + r.status}`))
      .catch(e => console.error('[request-followup] note error:', e.message));
 
    return res.json({
      result: `Perfect, thanks ${firstName}. I have passed your details to the team and someone will reach out on ${preferredTime} to lock in a time. Thanks so much for your time today.`
    });
 
  } catch (e) {
    console.error('[request-followup] Exception:', e.message);
    return res.json({
      result: `Thanks ${firstName}. Someone from the team will be in touch to arrange a time.`
    });
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// RETELL TOOL WEBHOOK — POST /retell-tools/book-appointment
// ─────────────────────────────────────────────────────────────────────────────
app.post('/retell-tools/book-appointment', async (req, res) => {
  const args = toolArgs(req, 'book-appointment');
  const { firstName, lastName, email, phone = '', startTime, timezone = 'America/New_York' } = args;


  const missing = [];
  if (!firstName) missing.push('first name');
  if (!lastName)  missing.push('last name');
  if (!email)     missing.push('email address');
  if (!startTime) missing.push('the appointment time');
  if (missing.length) {
    return res.json({
      result   : `I still need your ${missing.join(' and ')} to complete the booking. Could you share that?`,
      end_call : false,
    });
  }


  try {
    // ── STEP 1: Upsert contact ────────────────────────────────────────
    const contactBody = { locationId: CRM_LOCATION_ID, firstName, lastName, email };
    if (phone) contactBody.phone = phone;


    console.log('[retell-tools/book-appointment] Upserting contact:', JSON.stringify(contactBody));


    const contactRes = await fetch(`${CRM_API}/contacts/upsert`, {
      method  : 'POST',
      headers : {
        Authorization  : `Bearer ${CRM_API_KEY}`,
        Version        : '2021-07-28',
        'Content-Type' : 'application/json',
      },
      body : JSON.stringify(contactBody),
    });


    const contactData = await contactRes.json();


    if (!contactRes.ok) {
      console.error('[retell-tools/book-appointment] Contact upsert failed:', JSON.stringify(contactData));
      return res.json({
        result   : "I ran into an issue completing the booking. Please use the 'Book a Discovery Call' button on the page to lock in your spot.",
      });
    }


    const contactId = contactData.contact?.id;
    if (!contactId) {
      console.error('[retell-tools/book-appointment] No contactId in upsert response:', JSON.stringify(contactData));
      return res.json({
        result   : "I ran into an issue completing the booking. Please use the 'Book a Discovery Call' button on the page to lock in your spot.",
      });
    }


    console.log(`[retell-tools/book-appointment] Contact ready — id: ${contactId}`);


    // ── STEP 2: Book the appointment using contactId ──────────────────────
    const endTime = (() => {
      const d = new Date(startTime);
      d.setMinutes(d.getMinutes() + 30);
      return d.toISOString();
    })();


    const apptPayload = {
      calendarId : CRM_CALENDAR_ID,
      locationId : CRM_LOCATION_ID,
      contactId,
      startTime,
      endTime,
    };


    console.log('[retell-tools/book-appointment] Appointment payload:', JSON.stringify(apptPayload, null, 2));


    const crmRes = await fetch(`${CRM_API}/calendars/events/appointments`, {
      method  : 'POST',
      headers : {
        Authorization  : `Bearer ${CRM_API_KEY}`,
        Version        : '2021-04-15',
        'Content-Type' : 'application/json',
      },
      body : JSON.stringify(apptPayload),
    });


    const data = await crmRes.json();


    if (!crmRes.ok) {
      console.error('[retell-tools/book-appointment] Appointment failed:', JSON.stringify(data, null, 2));
      return res.json({
        result   : "I ran into an issue completing the booking. Please use the 'Book a Discovery Call' button on the page to lock in your spot.",
      });
    }


    const timeStr = new Date(startTime).toLocaleString('en-US', {
      weekday : 'long', month: 'long', day: 'numeric',
      hour    : 'numeric', minute: '2-digit', hour12: true, timeZone: timezone,
    });


    console.log(`[retell-tools/book-appointment] ✅ Booked — id: ${data.id || data.appointmentId}`);
    // Stop cold email sequence if this email is enrolled
    emailPool.query(
      `UPDATE enrollments SET status = 'completed'
       WHERE prospect_email = $1 AND status = 'active'`,
      [email.toLowerCase().trim()]
    ).then(r => {
      if (r.rowCount > 0) console.log(`[book-appointment] ✅ cold email stopped for ${email}`);
    }).catch(e => console.error('[book-appointment] email stop failed:', e.message));
    return res.json({
      result   : `You're all booked, ${firstName}! Your discovery call is confirmed for ${timeStr}. The confirmation is on its way to ${email}, and the team will be in touch before the call.`,
    });


  } catch (e) {
    console.error('[retell-tools/book-appointment] Exception:', e.message);
    return res.json({
      result   : "Something went wrong on my end. Please use the 'Book a Discovery Call' button on the page and we'll get you sorted.",
    });
  }
});
// ─────────────────────────────────────────────────────────────────────────────
// GET /demo-config/:slug
// ─────────────────────────────────────────────────────────────────────────────
const NICHE_DEFAULT_TAGLINES = {
  restoration : 'Emergency response for water, fire, and storm damage — 24/7.',
  bailbond    : 'Fast, confidential bail bond service — day or night.',
  towing      : 'Fast towing and roadside help, whenever you need it.',
  locksmith   : 'Locked out? We are on the way.',
  vet         : '24-hour emergency care for your pet.',
  funeral     : 'Compassionate care for your family, around the clock.',
  septic      : '24/7 emergency septic and drain service.',
  nemt        : 'Reliable, on-time medical transportation.',
  security    : 'Professional security coverage for your site.',
  roadside    : 'Stranded? Help is on the way.'
};


app.get('/demo-config/:slug', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const r = await db.getBySlug(req.params.slug);
    if (!r)        return res.status(404).json({ error: 'Not found' });
    if (r.expired) return res.status(410).json({ error: 'Expired' });
    return res.json({
      agentId        : r.agent_id,
      niche          : r.niche,
      businessName   : r.business_name,
      city           : r.city,
      tagline        : r.tagline || NICHE_DEFAULT_TAGLINES[r.niche] || 'AI-powered voice reception, built for your business.',
      primaryColor   : '#' + orderPalette(r.primary_color, r.secondary_color).primary,
      secondaryColor : '#' + orderPalette(r.primary_color, r.secondary_color).secondary,
      created        : new Date(r.created_at).getTime(),
      expiresAt      : new Date(r.expires_at).getTime(),
      callsUsed      : r.calls_used,
      maxCalls       : r.max_calls
    });
  } catch (e) {
    console.error('[demo-config] Exception:', e.message);
    return res.status(500).json({ error: 'Storage unavailable' });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /:slug — serves the demo landing page
//
// ✅ FIX 4 (corrected for this template):
//   The template uses --p, --s, --b0–--b3, --gl, --gs, --bd — NOT --primary-color.
//   All these are computed by applyPalette() in the template's own <head> script.
//
//   Strategy:
//   1. Compute the full palette server-side (same formula as applyPalette).
//   2. Inject it as INLINE JS setProperty calls BEFORE the template's own scripts.
//      Inline style properties always win over stylesheet :root rules, so this
//      ensures the correct palette is visible from the very first paint.
//   3. Set window.DEMO_CONFIG with non-empty primaryColor / secondaryColor.
//      The template's own applyPalette() reads from DEMO_CONFIG and will apply
//      the same values again — no conflict.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/:slug([a-z0-9][a-z0-9-]{2,59})', async (req, res, next) => {
  const { slug } = req.params;
  const API_PREFIXES = [
    'demo-config','create-agent','create-web-call',
    'book-appointment','check-availability','check-specific-time',
    'Delete-agent','retell-tools','stats', ‘webhook’
  ];
  if (API_PREFIXES.some(p => slug.startsWith(p))) return next();


  const EXPIRED_PAGE = '<!doctype html><html><body><h2 style="font-family:sans-serif;padding:40px">This demo has expired or does not exist.</h2></body></html>';


  let r;
  try {
    r = await db.getBySlug(slug);
  } catch (e) {
    console.error('[slug] Exception:', e.message);
    return res.status(500).send('Temporarily unavailable');
  }
  if (!r || r.expired) return res.status(r ? 410 : 404).send(EXPIRED_PAGE);


  let html;
  try { html = getNicheTemplate(r.niche); }
  catch (e) { return res.status(500).send('Template error'); }


  // ── Palette ────────────────────────────────────────────────────────
  // Use the stored hex values. Fall back to the same defaults as the
  // template (2563EB / 1E3A8A) so DEMO_CONFIG.primaryColor is NEVER
  // an empty string — an empty string causes the template's applyPalette
  // to also fall through to its own defaults, making colours unreachable.
  const ordered = orderPalette(r.primary_color, r.secondary_color);
  const pHex    = ordered.primary;
  const sHex    = ordered.secondary;
  const palette = computePalette(pHex, sHex);
  console.log(`[slug] ${slug} palette: stored p=${r.primary_color} s=${r.secondary_color} -> serving p=#${pHex} s=#${sHex}`);


  // Build an inline-JS snippet that calls setProperty() on <html> immediately.
  // setProperty() on element.style has the highest specificity possible and
  // cannot be beaten by any stylesheet rule — including the template's
  // hardcoded :root block which would otherwise win over an injected <style>.
  const paletteJs = Object.entries(palette)
    .map(([k, v]) => `d.style.setProperty(${JSON.stringify(k)},${JSON.stringify(v)})`)
    .join(';');


  // ── DEMO_CONFIG ─────────────────────────────────────────────────────
  const demoConfig = {
    slug,
    agentId        : r.agent_id,
    businessName   : r.business_name,
    city           : r.city,
    tagline        : r.tagline || NICHE_DEFAULT_TAGLINES[r.niche] || 'AI-powered voice reception, built for your business.',
    // Always provide a valid (non-empty) hex so applyPalette() in the
    // template never falls back to its own hardcoded default.
    primaryColor   : '#' + pHex,
    secondaryColor : '#' + sHex,
    created        : new Date(r.created_at).getTime(),
    expiresAt      : new Date(r.expires_at).getTime(),
    callsUsed      : r.calls_used,
    maxCalls       : r.max_calls,
    focus          : 'full-service',
  };


  // Injection goes at the very top of <head> so:
  //   • window.DEMO_CONFIG is set before any template script reads it
  //   • Palette is applied as inline styles (highest priority) before paint
  const injected = `<script>
(function(){
  window.DEMO_CONFIG=${JSON.stringify(demoConfig)};
  var d=document.documentElement;
  ${paletteJs};
})();
<\/script>`;


  html = html.replace('<head>', '<head>' + injected);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /delete-agent
// ─────────────────────────────────────────────────────────────────────────────
app.post('/delete-agent', async (req, res) => {
  const b = req.body || {};
  const raw  = { ...b, ...(b.customData || {}) };
  const pick = (...keys) => {
    for (const k of keys) {
      const v = raw[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  let agentId = pick('agentId', 'agent_id', 'voiceagent', 'Voice AI Agent ID');
  let llmId   = pick('llmId', 'llm_id', 'Voice AI LLM ID');
  let slug    = pick('slug');
  const demoUrl = pick('demoUrl', 'Demo Page URL');
  if (!slug && demoUrl) {
    const m = demoUrl.match(/\/([a-z0-9][a-z0-9-]{2,59})\/?$/i);
    if (m) slug = m[1];
  }
  if (slug) {
    try {
      const r = await db.getBySlug(slug);
      if (r) { agentId = agentId || r.agent_id; llmId = llmId || r.llm_id; }
    } catch (e) { console.error('[delete-agent] lookup failed:', e.message); }
  }
  if (!agentId && !slug) {
    console.log('[delete-agent] nothing to delete for contact:', raw.contact_id || '(unknown)');
    return res.json({ success: true, noop: true, message: 'No demo exists for this contact. Nothing to delete.' });
  }
  if (!agentId) {
    console.error(`[delete-agent] 400 | slug "${slug}" not found in database`);
    return res.status(400).json({
      error : 'agentId is required',
      slug  : slug || null,
      hint  : 'Send {"agentId":"agent_..."} or {"slug":"..."} that exists in the demos table'
    });
  }
  const RETELL_KEY = process.env.RETELL_API_KEY;
  let agentDeleted = false;
  let llmDeleted   = false;
  try {
    const agentRes = await fetch(`${RETELL}/delete-agent/${agentId}`, {
      method  : 'DELETE',
      headers : { 'Authorization': `Bearer ${RETELL_KEY}` },
    });
    if (agentRes.status === 404) {
      console.warn(`[delete-agent] 404 for ${agentId} — already deleted, or the id is wrong`);
    }
    if (agentRes.ok || agentRes.status === 404) {
      agentDeleted = true;
      if (slug) await db.markAgentDeleted(slug).catch(() => {});
      console.log(`[delete-agent] ✅ Agent deleted: ${agentId}`);
    } else {
      const err = await agentRes.text();
      console.error(`[delete-agent] Agent delete failed (${agentRes.status}): ${err}`);
    }
    if (llmId) {
      const llmRes = await fetch(`${RETELL}/delete-retell-llm/${llmId}`, {
        method  : 'DELETE',
        headers : { 'Authorization': `Bearer ${RETELL_KEY}` },
      });
      if (llmRes.ok || llmRes.status === 404) {
        llmDeleted = true;
        console.log(`[delete-agent] ✅ LLM deleted: ${llmId}`);
      } else {
        const err = await llmRes.text();
        console.error(`[delete-agent] LLM delete failed (${llmRes.status}): ${err}`);
      }
    }
    return res.json({ success: true, agentDeleted, llmDeleted });
  } catch (e) {
    console.error('[delete-agent] Exception:', e.message);
    return res.status(500).json({ success: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /webhook/call-booked
// Called from CRM workflow when a contact books a call.
// Stops cold email sequence so no more emails go out to that contact.
// Body: { "email": "prospect@email.com" }   ← preferred
//    or { "contactId": "abc123" }            ← fallback
// ─────────────────────────────────────────────────────────────────────────────
app.post('/webhook/call-booked', async (req, res) => {
  const raw      = { ...(req.body || {}), ...((req.body && req.body.customData) || {}) };
  const email    = (raw.email || raw.Email || raw.prospect_email || '').toLowerCase().trim();
  const contactId = raw.contactId || raw.contact_id || raw.id || '';

  if (!email && !contactId) {
    return res.status(400).json({ error: 'email or contactId required' });
  }

  try {
    let result;
    if (email) {
      result = await emailPool.query(
        `UPDATE enrollments SET status = 'completed'
         WHERE prospect_email = $1 AND status = 'active'
         RETURNING prospect_email`,
        [email]
      );
    } else {
      result = await emailPool.query(
        `UPDATE enrollments SET status = 'completed'
         WHERE contact_id = $1 AND status = 'active'
         RETURNING prospect_email`,
        [contactId]
      );
    }

    if (result.rows.length > 0) {
      console.log(`[call-booked] ✅ emails stopped for ${result.rows[0].prospect_email}`);
      return res.json({ success: true, stopped: result.rows[0].prospect_email });
    } else {
      console.log(`[call-booked] no active enrollment found for ${email || contactId}`);
      return res.json({ success: true, stopped: null, note: 'No active enrollment found' });
    }
  } catch (e) {
    console.error('[call-booked] error:', e.message);
    return res.status(500).json({ error: e.message });
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


// ─────────────────────────────────────────────────────────────────────────────
// EXPIRY SWEEP
// ─────────────────────────────────────────────────────────────────────────────
async function sweepExpired() {
  try {
    const rows = await db.listExpiredUndeleted(50);
    if (!rows.length) return;
    console.log(`[sweep] ${rows.length} expired demo(s) to tear down`);
    for (const r of rows) {
      const aRes = await fetch(`${RETELL}/delete-agent/${r.agent_id}`, {
        method  : 'DELETE',
        headers : { Authorization: `Bearer ${RETELL_API_KEY}` },
      }).catch(e => ({ ok: false, status: 0, _err: e.message }));
      if (!aRes.ok && aRes.status !== 404) {
        console.error(`[sweep] agent delete failed for ${r.slug} (${aRes.status})`);
        continue;
      }
      if (r.llm_id) {
        const lRes = await fetch(`${RETELL}/delete-retell-llm/${r.llm_id}`, {
          method  : 'DELETE',
          headers : { Authorization: `Bearer ${RETELL_API_KEY}` },
        }).catch(e => ({ ok: false, status: 0, _err: e.message }));
        if (!lRes.ok && lRes.status !== 404) {
          console.error(`[sweep] llm delete failed for ${r.slug} (${lRes.status})`);
        }
      }
      await db.markAgentDeleted(r.slug);
      console.log(`[sweep] torn down ${r.slug}`);
    }
  } catch (e) {
    console.error('[sweep] error:', e.message);
  }
}
setInterval(sweepExpired, 60 * 60 * 1000);
setTimeout(sweepExpired, 30_000);


// ─── Boot ─────────────────────────────────────────────────────────────────────
db.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log('\n=== Creative Copyz Voice AI Proxy ===');
      console.log('Port              : ' + PORT);
      console.log('DATABASE_URL      : ' + (process.env.DATABASE_URL ? 'SET' : 'MISSING — add a Postgres service in Railway'));
      console.log('RETELL_API_KEY    : ' + (RETELL_API_KEY    ? 'SET' : 'MISSING — set in Railway env vars'));
      console.log('CRM_API_KEY       : ' + (CRM_API_KEY       ? 'SET' : 'MISSING — set in Railway env vars'));
      console.log('CRM_CALENDAR_ID   : ' + (CRM_CALENDAR_ID   ? 'SET' : 'MISSING — set in Railway env vars'));
      console.log('CRM_LOCATION_ID   : ' + CRM_LOCATION_ID);
      console.log('RAILWAY_PUBLIC_URL: ' + (RAILWAY_PUBLIC_URL || '(not set — optional)'));
      console.log('=====================================\n');
    });
    // ── Cold email loops ──────────────────────────────────────────────────────
const saKeys = Object.keys(process.env).filter(k => k.startsWith('GOOGLE_SA_'));
console.log('[cold-email] SA keys found:', saKeys.length ? saKeys.join(', ') : '(none)');

if (saKeys.length > 0) {
  setInterval(runSendLoop, 2 * 60 * 1000);
  setInterval(detectRepliesAndBounces, 20 * 60 * 1000);
  runSendLoop();
  detectRepliesAndBounces();
  console.log('[cold-email] Send loop and reply detector started ✅');
} else {
  console.log('[cold-email] Gmail env vars not set — loops not started');
}
  })
  .catch(e => {
    console.error('[boot] database init failed:', e.message);
    process.exit(1);
  });
