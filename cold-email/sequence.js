'use strict';

const SEQUENCES = {

  // ═══════════════════════════════════════════════════════════════════════════
  // RESTORATION
  // ═══════════════════════════════════════════════════════════════════════════
  restoration: [
    {
      delayDays: 2,
      subject: (e) => `Quick question for ${e.company_name}`,
      body: (e, persona) => `Hi,

I put together an AI voice receptionist demo specifically for ${e.company_name} — it answers calls the way your team would, handles emergency intake, and captures job details around the clock.

You can hear it here: ${e.demo_page_url}

Most restoration companies lose jobs after hours when no one picks up. This fixes that without adding headcount.

Worth a listen?

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Re: Quick question for ${e.company_name}`,
      body: (e, persona) => `Hi,

Following up on my last note.

The demo I built for ${e.company_name} handles the calls that slip through — water damage emergencies at 2am, storm surge volume, callers who hang up the moment they hit voicemail.

It qualifies the job, captures contact details, and flags urgency. Same quality every time, regardless of hour.

${e.demo_page_url}

Happy to walk you through how it works if that's easier.

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Last note — ${e.company_name}`,
      body: (e, persona) => `Hi,

One last message.

The AI demo I built for ${e.company_name} handles emergency calls, captures job details, and never misses a lead — even at 3am during a storm.

If the timing isn't right, no worries at all. The demo is live for a few more days if you'd like to check it out: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // BAIL BOND
  // ═══════════════════════════════════════════════════════════════════════════
  bailbond: [
    {
      delayDays: 2,
      subject: (e) => `Built a demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

I put together an AI receptionist demo for ${e.company_name} — it handles inbound calls the way your team would, day or night, without missing a beat.

Families calling at 2am don't want voicemail. This answers, gathers the details, and keeps them moving.

Take a listen: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Re: demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

Following up on the demo I sent over for ${e.company_name}.

Bail bond calls are time-sensitive — every minute someone sits in a cell is a minute a competitor could answer instead. The AI handles intake instantly, 24/7, and routes urgent cases correctly.

Still live here: ${e.demo_page_url}

Worth 90 seconds of your time.

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Final note — ${e.company_name}`,
      body: (e, persona) => `Hi,

Last one from me.

The demo I built for ${e.company_name} shows exactly how an AI receptionist handles your after-hours calls — no missed leads, no voicemail drop-offs.

If the timing works: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // TOWING
  // ═══════════════════════════════════════════════════════════════════════════
  towing: [
    {
      delayDays: 2,
      subject: (e) => `AI demo built for ${e.company_name}`,
      body: (e, persona) => `Hi,

I built an AI voice receptionist demo for ${e.company_name} — it answers calls, gets the location, and dispatches without anyone lifting a finger.

Stranded callers don't wait. If they hit voicemail, they call the next company.

Hear it here: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Re: AI demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

Checking back on the demo I put together for ${e.company_name}.

It handles call surge during bad weather, late-night breakdowns, and calls that come in while your drivers are already out. Answers in seconds, captures what you need, keeps the job moving.

Demo: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Last note — ${e.company_name}`,
      body: (e, persona) => `Hi,

Last message from me.

The demo I built for ${e.company_name} is still live if you want to hear how AI handles towing dispatch calls: ${e.demo_page_url}

No voicemail. No missed jobs.

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // LOCKSMITH
  // ═══════════════════════════════════════════════════════════════════════════
  locksmith: [
    {
      delayDays: 2,
      subject: (e) => `Quick demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

I put together an AI receptionist demo for ${e.company_name} — it answers lockout calls, gets the address, confirms the job, and keeps the caller calm while your tech is on the way.

Locked-out callers call the first number that answers. Make sure that's you.

Demo: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Re: demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

Following up on the AI demo I built for ${e.company_name}.

It handles after-hours lockouts, car lockouts, commercial calls — whatever comes in. Answers instantly, no hold music, no voicemail. The caller stays on the line and the job gets logged.

${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Last note — ${e.company_name}`,
      body: (e, persona) => `Hi,

One last follow-up.

The demo for ${e.company_name} shows how AI handles lockout calls at any hour: ${e.demo_page_url}

Happy to walk through how it would work for your setup if that's helpful.

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // VET
  // ═══════════════════════════════════════════════════════════════════════════
  vet: [
    {
      delayDays: 2,
      subject: (e) => `After-hours demo built for ${e.company_name}`,
      body: (e, persona) => `Hi,

I built an AI voice receptionist demo for ${e.company_name} — it handles emergency calls with the calm, reassuring tone a pet owner needs at 2am.

It gathers the details, explains what to do on the way in, and keeps the caller focused. No hold music. No voicemail.

Hear it: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Re: demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

Following up on the demo I put together for ${e.company_name}.

A panicked pet owner calling at 3am needs an immediate answer, not voicemail. The AI handles it — stays calm, asks the right questions, and keeps them moving toward your clinic.

Demo: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Last follow-up — ${e.company_name}`,
      body: (e, persona) => `Hi,

Last one from me.

The demo I built for ${e.company_name} shows how AI handles emergency vet calls around the clock: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // FUNERAL
  // ═══════════════════════════════════════════════════════════════════════════
  funeral: [
    {
      delayDays: 2,
      subject: (e) => `A demo built for ${e.company_name}`,
      body: (e, persona) => `Hi,

I built an AI receptionist demo for ${e.company_name} — designed with the tone and care that families expect when they call in one of their hardest moments.

Compassionate, unhurried, and always available.

You can hear it here: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Re: demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

Following up on the demo I put together for ${e.company_name}.

Families calling a funeral home at any hour need to feel heard immediately — not sent to voicemail. The AI handles that first moment with warmth and professionalism, 24/7.

Demo: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Last note — ${e.company_name}`,
      body: (e, persona) => `Hi,

One last follow-up.

If you'd like to hear how AI can handle your after-hours calls with the right tone: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // SEPTIC
  // ═══════════════════════════════════════════════════════════════════════════
  septic: [
    {
      delayDays: 2,
      subject: (e) => `Emergency call handling for ${e.company_name}`,
      body: (e, persona) => `Hi,

I built an AI receptionist demo for ${e.company_name} — it handles emergency septic calls, gets the details fast, and keeps the caller calm while your crew gets dispatched.

Sewage emergencies don't wait for business hours.

Demo: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Re: demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

Following up on the AI demo I put together for ${e.company_name}.

It handles the midnight backup call, the panicked homeowner, the commercial site manager — answers immediately, gets what's needed, keeps things moving. No voicemail, no delays.

${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Last follow-up — ${e.company_name}`,
      body: (e, persona) => `Hi,

Last note from me.

The demo for ${e.company_name} shows how AI handles emergency septic calls 24/7: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // NEMT
  // ═══════════════════════════════════════════════════════════════════════════
  nemt: [
    {
      delayDays: 2,
      subject: (e) => `Scheduling demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

I built an AI receptionist demo for ${e.company_name} — it handles ride booking calls with the patience and clarity your passengers need.

It confirms trip details, vehicle requirements, and handles insurance questions without putting anyone on hold.

Hear it: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Re: demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

Following up on the demo I put together for ${e.company_name}.

NEMT scheduling calls are repetitive and time-consuming. The AI handles them consistently — confirms pick-up details, vehicle type, insurance — so your team focuses on dispatch, not intake.

Demo: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Last note — ${e.company_name}`,
      body: (e, persona) => `Hi,

One last follow-up.

The demo I built for ${e.company_name} shows how AI handles NEMT scheduling calls around the clock: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // SECURITY
  // ═══════════════════════════════════════════════════════════════════════════
  security: [
    {
      delayDays: 2,
      subject: (e) => `Quick demo built for ${e.company_name}`,
      body: (e, persona) => `Hi,

I put together an AI receptionist demo for ${e.company_name} — it handles inbound enquiries for coverage, site assessments, and event security with a professional, consultative tone.

It qualifies the lead and sets the stage for your team to close.

Demo: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Re: demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

Following up on the AI demo I built for ${e.company_name}.

It handles the after-hours call from a business owner who just had an incident and needs coverage fast — answers professionally, gathers site details, and gets the right information to your team.

${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Last follow-up — ${e.company_name}`,
      body: (e, persona) => `Hi,

Last one from me.

The demo for ${e.company_name} is still live if you'd like to hear how AI handles your inbound security enquiries: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
  ],

  // ═══════════════════════════════════════════════════════════════════════════
  // ROADSIDE
  // ═══════════════════════════════════════════════════════════════════════════
  roadside: [
    {
      delayDays: 2,
      subject: (e) => `AI demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

I built an AI receptionist demo for ${e.company_name} — it handles stranded motorist calls fast, gets the location, confirms the job, and dispatches without delay.

Every second a caller waits is a second they might call someone else.

Demo: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Re: demo for ${e.company_name}`,
      body: (e, persona) => `Hi,

Checking back on the AI demo I put together for ${e.company_name}.

It handles the flat tire call, the dead battery, the car lockout — answers immediately, gets what's needed, and keeps the job moving. Works at 2am the same as 2pm.

${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
    {
      delayDays: 2,
      subject: (e) => `Last note — ${e.company_name}`,
      body: (e, persona) => `Hi,

Last follow-up from me.

The AI demo I built for ${e.company_name} handles roadside assistance calls 24/7 — no voicemail, no missed jobs: ${e.demo_page_url}

${persona.fullName}
${persona.title} | Creative Copyz`,
    },
  ],

};

module.exports = SEQUENCES;
