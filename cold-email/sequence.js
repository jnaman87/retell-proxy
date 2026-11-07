'use strict';

/**
 * Creative Copyz - Email sequences
 *
 * Structure:
 *   SEQUENCES.cold[niche]      → 5-step cold sequence, each step = { delayDays, variants: [...] }
 *                                (variation picked at random per send). No demo URL, demo is
 *                                built only after a positive reply.
 *   SEQUENCES.warm[niche]      → 3-step warm sequence (per-niche). Sent after a POSITIVE reply,
 *                                demo page already built. Written as follow-ups inside the existing
 *                                thread (no re-pitch). Subject is set to "Re: <thread subject>" by sendLoop.js.
 *   SEQUENCES.ultra_warm       → 3-step sequence sent after the demo is TESTED (call > 15s).
 *                                Continues in the same thread.
 *
 * All emails skip the greeting and go straight to the body.
 */

// ─── Niche word-map for the shared cold sequence ───────────────
const COLD_NICHE_WORDS = {
  restoration: { service: 'water, fire, or storm damage help', scenario: 'after hours' },
  bailbond:    { service: 'a bail bond in a hurry',            scenario: 'at 2am' },
  towing:      { service: 'a tow or a jump start',             scenario: 'on the shoulder' },
  locksmith:   { service: 'a lockout',                         scenario: 'in a parking garage' },
  vet:         { service: 'emergency care for a pet',          scenario: 'late at night' },
  funeral:     { service: 'help after a loss',                 scenario: 'at 3am' },
  septic:      { service: 'an emergency septic backup',        scenario: 'on a Sunday night' },
  nemt:        { service: 'a medical ride',                    scenario: 'at pickup time' },
  security:    { service: 'site security coverage',            scenario: 'after an incident' },
  roadside:    { service: 'a jump, flat or lockout',           scenario: 'on the roadside' },
};

function buildColdSequence(words) {
  const service  = words.service;
  const scenario = words.scenario;
  return [
    {
      delayDays: 2,
      variants: [
        {
          subject: (e) => `I built your receptionist, ${e.prospect_name}`,
          body: (e, persona) => `<p>I did something a little backwards.</p>
<p>Instead of asking if ${e.company_name} wants an AI receptionist, my team built one for ${e.company_name}.<br>
It knows your services, your city, and how you want calls handled.</p>
<p>I put it on a page where you can call it yourself and hear exactly how it handles a real scenario.<br>
No meeting required, no call with me, just the page.</p>
<p>It stays live for 7 days, up to 5 test calls.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>
<p>P.S. We built it before I ever emailed you.</p>`,
        },
        {
          subject: (e) => `${e.company_name} already has a receptionist`,
          body: (e, persona) => `<p>You already have a receptionist.</p>
<p>The problem is they clock out.</p>
<p>So I had my team build one that doesn't, trained on ${e.company_name}'s services, your city, and how you actually want calls handled.</p>
<p>I put it on its own page so you can call it and test it yourself, no meeting needed.</p>
<p>It's live for 7 days, up to 5 test calls.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
        {
          subject: (e) => `I skipped the usual first step`,
          body: (e, persona) => `<p>Most agencies would ask if ${e.company_name} wants an AI receptionist, then pitch you on what it might sound like.</p>
<p>I skipped that part.</p>
<p>My team already built one, trained on your services, your city, and how you handle calls.</p>
<p>It's sitting on a page right now, ready for you to call it yourself.</p>
<p>No meeting, no sales call, just the page.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
        {
          subject: (e) => `This isn't a proposal`,
          body: (e, persona) => `<p>I'm not here to pitch ${e.company_name} on an idea.</p>
<p>The receptionist already exists.</p>
<p>It's trained on your services, your city, and how calls should be handled, and it's sitting on a page waiting for you to call it.</p>
<p>No meeting required.</p>
<p>7 days, 5 test calls, then it's gone.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
        {
          subject: (e) => `Built first, asked second`,
          body: (e, persona) => `<p>Normally you'd hear a pitch before anything gets built.</p>
<p>I did it backwards for ${e.company_name}.</p>
<p>The AI receptionist is already live, trained on your services and your city, sitting on its own page ready for a test call.</p>
<p>No meeting with me required, just click and try it.</p>
<p>It's up for 7 days, 5 calls max.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
      ],
    },
    {
      delayDays: 2,
      variants: [
        {
          subject: (e) => `Your phone has a new employee`,
          body: (e, persona) => `<p>There's a slightly strange part of what we do.</p>
<p>We build the receptionist before the conversation.</p>
<p>So I had one built for ${e.company_name} using your services, your city, and your business details.</p>
<p>I put it on a page where you can call it directly, no phone number to dial, no meeting with me.</p>
<p>Try asking it something your receptionist would actually hear ${scenario}.</p>
<p>It's live for 7 days, 5 test calls, then we take it down.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
        {
          subject: (e) => `You can hear it before we ever talk`,
          body: (e, persona) => `<p>I usually explain what we do before anyone hears it.</p>
<p>This time I'm doing the opposite.</p>
<p>${e.company_name}'s AI receptionist is already built and sitting on its own page, trained on your services, your city, and your details.</p>
<p>Click in, call it, and see what it does with a real question.</p>
<p>No meeting required.</p>
<p>7 days, 5 test calls.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
        {
          subject: (e) => `I built this without asking first`,
          body: (e, persona) => `<p>I had my team build ${e.company_name} a working AI receptionist before we ever spoke.</p>
<p>It's live on its own page right now, trained on your city and your services.</p>
<p>You can call it directly from there, no meeting, no phone number to track down.</p>
<p>It stays up for 7 days, 5 test calls.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
      ],
    },
    {
      delayDays: 2,
      variants: [
        {
          subject: (e) => `What happens at 2:17am?`,
          body: (e, persona) => `<p>Someone calls ${e.company_name} at 2:17am.</p>
<p>They need ${service}.</p>
<p>Nobody picks up.</p>
<p>They call the next number.</p>
<p>That's the entire problem we built Creative Copyz around.</p>
<p>Our AI receptionist answers immediately, handles the intake, and gets the caller moving toward a booking.</p>
<p>I already built one for ${e.company_name} and put it on its own page, no meeting required to test it.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
        {
          subject: (e) => `The call you never hear about`,
          body: (e, persona) => `<p>The calls that hurt ${e.company_name} most are the ones nobody on your team ever hears.</p>
<p>Someone calls after hours, gets silence, and dials the next business on the list.</p>
<p>I built an AI receptionist for ${e.company_name} that answers every time, day or night, and put it on its own page so you can test exactly how it handles that situation.</p>
<p>No meeting needed.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
        {
          subject: (e) => `Nights and weekends still count`,
          body: (e, persona) => `<p>Emergencies don't check the clock, but a lot of receptionists do.</p>
<p>I built ${e.company_name} an AI receptionist that's on regardless of the hour, and put it on its own page so you can hear how it handles an after-hours call yourself.</p>
<p>No meeting required, just the page.</p>
<p>Want to see yours?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
      ],
    },
    {
      delayDays: 2,
      variants: [
        {
          subject: (e) => `Maybe this isn't for you`,
          body: (e, persona) => `<p>Maybe ${e.company_name} already has after-hours calls handled perfectly.</p>
<p>If so, genuinely, you can ignore me.</p>
<p>But if calls still come in when the team is asleep, driving, on another job, or already helping someone else...</p>
<p>I built a live AI receptionist specifically for ${e.company_name} and put it on its own page so you can test it yourself.</p>
<p>No commitment, no meeting.</p>
<p>5 calls, 7 days.</p>
<p>If it's not useful, nothing happens.</p>
<p>Want me to send you the page?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
        {
          subject: (e) => `Ignore this if you're covered`,
          body: (e, persona) => `<p>If every call to ${e.company_name} gets picked up, day or night, this email isn't for you.</p>
<p>Feel free to skip it.</p>
<p>If that's not quite true, I built an AI receptionist for ${e.company_name} and put it on its own page so you can see what it does with an after-hours call.</p>
<p>No meeting, no pressure.</p>
<p>Want me to send you the page?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
        {
          subject: (e) => `No pressure either way`,
          body: (e, persona) => `<p>This isn't a push to get ${e.company_name} on a call with me.</p>
<p>It's just a page.</p>
<p>The AI receptionist I built for you is sitting there, ready to test, no meeting required.</p>
<p>If it's not useful, close the tab and that's the end of it.</p>
<p>Want me to send you the page?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
      ],
    },
    {
      delayDays: 2,
      variants: [
        {
          subject: (e) => `Taking this down Friday`,
          body: (e, persona) => `<p>Last note from me.</p>
<p>The ${e.company_name} receptionist page I built is coming down Friday.</p>
<p>It was only meant to stay live for 7 days anyway.</p>
<p>You've still got up to 5 test calls if you want to hear how it handles ${service} ${scenario}.</p>
<p>No meeting required, just the page.</p>
<p>If you want it, I'll send it over.</p>
<p>If not, no problem.</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>
<p>P.S. I'd rather you test it for 60 seconds than listen to me explain AI for 10 minutes.</p>`,
        },
        {
          subject: (e) => `The page expires in 7 days`,
          body: (e, persona) => `<p>Quick heads up.</p>
<p>The AI receptionist I built for ${e.company_name} only stays live for 7 days, and that window is almost up.</p>
<p>After that, the page and the 5 test calls go with it.</p>
<p>No meeting required if you want to try it before it's gone.</p>
<p>Want me to send you the page?</p>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
        },
      ],
    },
  ];
}

const cold = {};
for (const [niche, words] of Object.entries(COLD_NICHE_WORDS)) {
  cold[niche] = buildColdSequence(words);
}

// ─────────────────────────────────────────────────────────────
// WARM - sent after a POSITIVE reply. Demo page is already built and
// the lead has already been talking to us in this thread.
//
// These are written as the NEXT MESSAGE in an existing conversation,
// not as a fresh pitch:
//   - no re-introduction, no re-explaining what the receptionist is
//   - no personalisation hook opener (that is a cold-email device)
//   - short, plain, one small ask
// The subject line is replaced with "Re: <original thread subject>" in
// sendLoop.js, so these arrive inside the existing thread. The subject
// below is only the fallback if the thread cannot be read.
// 3 emails over 5 days. Edit the text in WARM_NICHE_WORDS to tune a niche.
// ─────────────────────────────────────────────────────────────
const WARM_NICHE_WORDS = {
  restoration: {
    tryIt:  'Call it like a homeowner with water coming through the ceiling.',
    worry:  'The usual question is whether it will make up prices or arrival times. It will not. It reads real openings off a live calendar, and anything it cannot stand behind on price or arrival goes to the consultation.',
    signoff:'Good luck this season.',
  },
  bailbond: {
    tryIt:  'Call it the way a scared family member would at 2am.',
    worry:  'The usual worry is that it says something it should not. It does not quote a fee on a specific bond, promise a release time or give legal advice. It explains the standard ten percent and how the process generally works, then hands everything else to a licensed agent.',
    signoff:'Appreciate the time either way.',
  },
  towing: {
    tryIt:  'Call it from your truck and pretend you are stranded on the shoulder.',
    worry:  'The usual question is whether it will promise an ETA or price it cannot keep. It will not. It reads openings off a live calendar, and when a caller pushes for an exact ETA or price it does not have, it says so. Those stay yours to set.',
    signoff:'Drive safe.',
  },
  locksmith: {
    tryIt:  'Call it and pretend you are locked out of your car.',
    worry:  'The usual question is about pricing. It does not quote. It tells callers your pricing is upfront with no hidden fees, then leaves the actual number to your technician. Same with arrival times.',
    signoff:'Good luck out there.',
  },
  vet: {
    tryIt:  'Call it as someone whose dog got into something at 11pm.',
    worry:  'The usual worry is that it says something clinical. It does not diagnose. It sticks to safe pre-arrival guidance: keep the animal calm, do not feed them, drive carefully. Anything past that goes to your team.',
    signoff:'Thanks for the work you do at hours nobody sees.',
  },
  funeral: {
    tryIt:  'Call it and listen to how it handles a first call from a family.',
    worry:  'The real question is whether it feels human, and you can only answer that by hearing it. It speaks slowly, leads with the family before the logistics, and moves cost and specifics to a private consultation with your director. It will not invent anything about your firm.',
    signoff:'Thank you for the time.',
  },
  septic: {
    tryIt:  'Call it and throw a messy backup at it.',
    worry:  'It is direct on purpose, because nobody wants a chatty receptionist during a sewage backup. It separates a backup from a full tank from a drain field issue, does not quote a price or truck time it does not have, and books off a live calendar.',
    signoff:'Appreciate it either way.',
  },
  nemt: {
    tryIt:  'Call it once as a nervous patient and once as a rushed discharge planner.',
    worry:  'The usual worry is that it will lose elderly callers. It goes slow deliberately, confirms each detail, spells the name and email back before it books, and stops when you talk over it.',
    signoff:'Thanks for the time.',
  },
  security: {
    tryIt:  'Call it as a property manager who needs coverage after an incident.',
    worry:  'It listens before it pitches, then books the site assessment off a live calendar. It will not quote a rate or promise a start date it cannot stand behind. That stays with you.',
    signoff:'Good luck with it.',
  },
  roadside: {
    tryIt:  'Call it from the road and pretend your car will not start.',
    worry:  'It does not make things up. No invented ETA, no invented price, no invented appointment slot. It reads real availability off a live calendar and confirms the caller\'s details back before it books.',
    signoff:'Safe roads.',
  },
};

function buildWarmSequence(words) {
  return [
    {
      // Day ~2 after the demo went out. Gentle bump, nothing re-explained.
      subject: (e) => `Re: ${e.company_name}`,
      delayDays: 2,
      body: (e, persona) => `<p>Bumping this back to the top of your inbox in case it got buried.</p>
<p>The line I built for ${e.company_name} is still live:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>${words.tryIt} It takes about a minute.</p>
<p>If you have questions, or want anything changed, reply here and I will sort it.</p>
<p>Best Regards,<br>
${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      // Day ~4. Ask what is in the way, answer the one niche objection.
      subject: (e) => `Re: ${e.company_name}`,
      delayDays: 2,
      body: (e, persona) => `<p>Wanted to check in on this. If something is holding you back from trying it, tell me what and I will answer it or fix it.</p>
<p>${words.worry}</p>
<p>Your line is live for 4 more days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Best Regards,<br>
${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      // Day ~6. Close the loop politely.
      subject: (e) => `Re: ${e.company_name}`,
      body: (e, persona) => `<p>Closing the loop on this one.</p>
<p>The line I built for ${e.company_name} comes down in 2 days and the number stops working.</p>
<p>If it is not a fit, or the timing is off, a one word reply is plenty and I will stop. If you would still like to hear it first:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>${words.signoff}</p>
<p>Best Regards,<br>
${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ];
}

const warm = {};
for (const [niche, words] of Object.entries(WARM_NICHE_WORDS)) {
  warm[niche] = buildWarmSequence(words);
}

// ─────────────────────────────────────────────────────────────
// ULTRA WARM - after the demo is TESTED (call > 15s).
// Same thread. 3 emails over 5 days. Resets the 7-day timer.
// ─────────────────────────────────────────────────────────────
const ultra_warm = [
  {
    subject: () => `How was Emma`,
    delayDays: 2,
    body: (e, persona) => `<p>Curious what you thought.</p>
<p>You gave Emma a call. Most people are surprised how naturally she handles everything, from fielding questions after-hours to booking jobs on the spot. Anything stand out?</p>
<p>If you're open to it, Naman can walk you through what this looks like inside ${e.company_name}'s operation on a quick 15-min call.</p>
<p>If you'd like to schedule a call with Naman, just reply here and we'll find a time.</p>
<p>Best Regards,<br>
${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
  },
  {
    subject: () => `Still thinking it over`,
    delayDays: 2,
    body: (e, persona) => `<p>Still thinking it over. The demo line is still live if you want to try it again:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>A couple of things that usually come up:</p>
<p>"Does it actually sound human?" Emma was built for this. She handles the back-and-forth naturally, knows when to escalate, and doesn't drop calls.</p>
<p>"What if it can't answer something?" She captures the lead and flags it. Nothing slips through.</p>
<p>If you're ready to see how this fits ${e.company_name}, reply here and we'll help you schedule a call with Naman.</p>
<p>Best Regards,<br>
${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
  },
  {
    subject: () => `Last one from me`,
    delayDays: 2,
    body: (e, persona) => `<p>Closing the loop on ${e.company_name}.</p>
<p>If AI voice is something you'd want to move forward with, you can schedule a call with Naman here:</p>
<p><a href="${process.env.WARM_BOOKING_LINK || ''}">${process.env.WARM_BOOKING_LINK || ''}</a></p>
<p>If the timing's not right, no worries at all. Appreciate you taking the time to try Emma.</p>
<p>Best Regards,<br>
${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
  },
];

module.exports = {
  cold,
  warm,
  ultra_warm,
};
