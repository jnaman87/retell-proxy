'use strict';

/**
 * Creative Copyz - Email sequences
 *
 * Structure:
 *   SEQUENCES.cold[niche]      → 5-step cold sequence, each step = { delayDays, variants: [...] }
 *                                (variation picked at random per send). No demo URL, demo is
 *                                built only after a positive reply.
 *   SEQUENCES.warm[niche]      → 3-step warm sequence (per-niche). Sent after a POSITIVE reply,
 *                                demo page already built. Continues in the SAME thread as cold.
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
// WARM - sent after a POSITIVE reply. Demo page is now built.
// Uses the existing per-niche cold emails (which carry the
// demo_page_url). Same thread as cold. 3 emails over 5 days.
// ─────────────────────────────────────────────────────────────
const warm = {
  restoration: [
    {
      subject: (e) => `${e.company_name} after hours`,
      delayDays: 2,
      body: (e, p) => `<p>${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}A ${e.prospect_city} homeowner standing in six inches of water calls three mitigation companies in about ten minutes. First one to actually pick up gets the job, and the rebuild that follows it.</p>
<p>So I built ${e.company_name} a phone line that always picks up. Her name is Emma. She answers as your company, handles the water, fire, storm and mold calls that come in at 1am, pulls real openings off a live calendar, and books the assessment.</p>
<p>It is live for 7 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it. Try to trip it up. You get 5 test calls, 10 minutes each.</p>
<p>Not for you? Reply "no" and I will leave you be.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `the day after a storm`,
      delayDays: 2,
      body: (e, p) => `<p>Fair to assume this is another generic bot. Most of them are. Here is the part that is harder to argue with.</p>
<p>On a normal Tuesday your office handles the phone fine. The day after a storm moves through ${e.prospect_city}, forty people call inside two hours, and there is no version of one receptionist that answers all of them. The overflow is where your large losses go.</p>
<p>This answers every one of them at the same time. No queue, no callback list you work through on Wednesday while somebody else is already drying the building.</p>
<p>It also does not guess. It reads real openings off a live calendar instead of inventing a time, and anything it cannot stand behind on price or arrival it puts to the consultation.</p>
<p>${e.current_pain ? e.current_pain + '\n\n' : ''}The ${e.company_name} line is live for 4 more days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it and ask it something ugly.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `closing this out`,
      body: (e, p) => `<p>Last email from me, I will not chase.</p>
<p>The line I built for ${e.company_name} shuts off in 2 days and the number stops working.</p>
<p>One large loss that rang out this year would have paid for years of this. That is the whole argument.</p>
<p>Two minutes and you will know if it holds up:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Either way, good luck this season.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ],
  bailbond: [
    {
      subject: (e) => `${e.company_name}, 2am`,
      delayDays: 2,
      body: (e, p) => `<p>${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}Nobody calls a bondsman at a calm moment. They are frightened, it is 2am, and they are working down a list of ${e.prospect_city} bondsmen. Second ring and they are on to the next name.</p>
<p>I built ${e.company_name} a line that answers every one of those. Her name is Emma. She stays calm when the caller is not, walks them through how the process generally works, and books them in off a live calendar.</p>
<p>Live for 7 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it the way a scared family member would. 5 test calls, 10 minutes each.</p>
<p>Reply "no" and I am gone.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `it does not give legal advice`,
      delayDays: 2,
      body: (e, p) => `<p>The concern with putting a machine on a bail line is that it says something it should not. Quotes your fee on a specific bond. Promises a release time. Gives legal advice.</p>
<p>It does none of those. It explains the standard ten percent and how the process generally works, and everything past that it hands to a licensed agent instead of guessing.</p>
<p>It also books off a live calendar rather than inventing a time, and it spells the caller's name and email back letter by letter before it confirms anything.</p>
<p>${e.current_pain ? e.current_pain + '\n\n' : ''}Still live for 4 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `shutting the line off`,
      body: (e, p) => `<p>Last email, then I stop.</p>
<p>The ${e.company_name} line expires in 2 days.</p>
<p>Between now and then, a few families in ${e.prospect_city} will call somebody at 2am. They call one number, and if it rings out they call another. That is the whole business.</p>
<p>It is still on until then:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Appreciate the time either way.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ],
  towing: [
    {
      subject: (e) => `${e.company_name} dispatch`,
      delayDays: 2,
      body: (e, p) => `<p>${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}A driver stuck on the shoulder gives you about 60 seconds before they tap the next number. They are not leaving a voicemail.</p>
<p>I built ${e.company_name} a line that answers on the first ring, every time. Her name is Emma. She works out whether it is a tow, a jump, a flat or a lockout, handles the two questions every caller opens with, and books off a live calendar.</p>
<p>Live for 7 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it from your truck. 5 calls, 10 minutes each.</p>
<p>Reply "no" and that is the end of it.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `it does not guess`,
      delayDays: 2,
      body: (e, p) => `<p>Fair if you assumed this was another generic bot. Most of them are.</p>
<p>This one is tuned for tow calls specifically. It moves fast, it does not over-explain, and it knows a lockout is not a flat tire is not a flatbed job.</p>
<p>What it will not do is guess. It reads openings off a live calendar instead of making a time up, and when a caller pushes for an exact ETA or an exact price it does not have, it says so rather than inventing one. Those stay yours to set.</p>
<p>${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `wrapping up`,
      body: (e, p) => `<p>Last one, I promise.</p>
<p>Your demo line goes off in 2 days.</p>
<p>Every ring-out is a call that went to whoever was second on the list. You already know what a night of those costs.</p>
<p>Sixty seconds to hear it for yourself:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Drive safe.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ],
  locksmith: [
    {
      subject: (e) => `${e.company_name} first ring`,
      delayDays: 2,
      body: (e, p) => `<p>${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}Lockout calls are won on the first ring. Somebody is standing next to their car in a ${e.prospect_city} parking garage and they are calling until somebody answers.</p>
<p>I built ${e.company_name} a line that always does. Her name is Emma. She works out whether it is a car, a house or an office, whether it is a lockout or a rekey, and books the visit off a live calendar.</p>
<p>Live for 7 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it and pretend you are locked out. 5 calls, 10 minutes each.</p>
<p>Not for you? Reply "no".</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `it will not quote you a price`,
      delayDays: 2,
      body: (e, p) => `<p>Your customers have been burned by the $19 lockout ad that turns into $250 on arrival. So the fastest way to lose a call is to sound like that.</p>
<p>This one does not quote. It tells callers your pricing is upfront with no hidden fees, then leaves the actual number to your technician instead of inventing one on the phone. Same with arrival times.</p>
<p>It does not invent openings either. It pulls real availability off a live calendar, then spells the caller's name and email back before it books.</p>
<p>${e.current_pain ? e.current_pain + '\n\n' : ''}Your line is live for 4 more days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Try to make it say something dumb.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `last email`,
      body: (e, p) => `<p>The ${e.company_name} demo line expires in 2 days.</p>
<p>The calls you miss do not leave voicemails. They call the next locksmith in ${e.prospect_city} and you never find out it happened.</p>
<p>Last chance to hear how it handles one:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Good luck out there.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ],
  vet: [
    {
      subject: (e) => `${e.company_name} after 10pm`,
      delayDays: 2,
      body: (e, p) => `<p>${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}Somebody in ${e.prospect_city} calls at 11pm because their dog got into something. They are upset and they need a calm voice in under ten seconds.</p>
<p>I built ${e.company_name} a line for exactly those. Her name is Emma. She stays steady while the caller is not, covers what to do on the way in, and books off a live calendar.</p>
<p>Live for 7 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it and give it a hard one. 5 calls, 10 minutes each.</p>
<p>Reply "no" and I will not write again.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `it does not diagnose`,
      delayDays: 2,
      body: (e, p) => `<p>The worry with a machine on a vet line is that it says something clinical it has no business saying. Agreed.</p>
<p>So it does not diagnose. It sticks to safe pre-arrival guidance: keep the animal calm, do not feed them, drive carefully. Anything past that it puts on your team rather than improvising, and it says so plainly.</p>
<p>It also stays calm with someone who is crying, which is the part that wears your techs down at 3am. And it books off a live calendar, reading the caller's email back character by character before it confirms.</p>
<p>${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `last note`,
      body: (e, p) => `<p>Last email from me.</p>
<p>The line I built for ${e.company_name} shuts off in 2 days.</p>
<p>Every overnight call that rings out is a family driving to whichever clinic answered instead. And it is one more 3am call your team did not have to absorb.</p>
<p>Still live until then:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Thanks for the work you do at hours nobody sees.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ],
  funeral: [
    {
      subject: (e) => `${e.company_name} first call`,
      delayDays: 2,
      body: (e, p) => `<p>${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}The first call a family makes is usually within an hour of a death, and it often comes at 3am. Whoever answers sets the tone for everything after.</p>
<p>I built ${e.company_name} a line for those hours. Her name is Emma. She is set to speak slowly and lead with the family before the logistics, then arrange a private consultation with a director rather than pushing anyone through a form.</p>
<p>It is live for 7 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it and hear how it holds the room.</p>
<p>If it is not right for you, a one word reply is plenty.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `on whether it feels human`,
      delayDays: 2,
      body: (e, p) => `<p>The only question that matters here is whether it feels human, and you cannot answer that from an email.</p>
<p>What I can tell you is how it is built. It speaks slowly and it does not rush. It leads with empathy before logistics. It can talk through burial, cremation, memorial and pre-planning at a general level, and the moment the conversation turns to cost or specifics it moves that to a private consultation with your director, where it belongs.</p>
<p>It will not invent anything about your firm. If it does not know, it says so.</p>
<p>${e.current_pain ? e.current_pain + '\n\n' : ''}The line is live for 4 more days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `last note from me`,
      body: (e, p) => `<p>This is the last email I will send.</p>
<p>The line I set up for ${e.company_name} comes down in 2 days.</p>
<p>If it is useful, it is useful. If not, I would rather you say so than wonder. It takes a minute to find out:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Thank you for the time.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ],
  septic: [
    {
      subject: (e) => `${e.company_name} emergency line`,
      delayDays: 2,
      body: (e, p) => `<p>${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}When there is sewage coming up into a shower on a Sunday night, nobody leaves a voicemail. They call every septic company in ${e.prospect_city} until a person answers.</p>
<p>I built ${e.company_name} a line that answers all of them. Her name is Emma. She works out whether it is a backup, a full tank or a drain field problem, keeps it short because nobody wants a conversation at that moment, and books off a live calendar.</p>
<p>Live for 7 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it and throw a messy one at it. 5 calls, 10 minutes each.</p>
<p>Reply "no" if this is not for you.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `it keeps it short`,
      delayDays: 2,
      body: (e, p) => `<p>Reasonable to assume this is another generic bot. Most of them are.</p>
<p>This one is set to be direct on purpose. A sewage call is not the place for a chatty receptionist, so it gets the facts and moves.</p>
<p>It separates a backup from a full tank from a drain field issue. It does not quote a price or a truck time it does not have. And it does not invent an opening: it reads real availability off a live calendar, then confirms the caller's name and email back to them before booking.</p>
<p>${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `last one from me`,
      body: (e, p) => `<p>The ${e.company_name} demo line expires in 2 days.</p>
<p>An emergency backup that you answer usually becomes a customer who calls you every three years. The ones that ring out become somebody else's.</p>
<p>Still on until then:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Appreciate it either way.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ],
  nemt: [
    {
      subject: (e) => `${e.company_name} scheduling line`,
      delayDays: 2,
      body: (e, p) => `<p>${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}Two kinds of people call ${e.company_name}. An 80 year old arranging a dialysis ride who needs things repeated twice, and a discharge planner who needs a pickup soon and will call the next provider if you do not pick up.</p>
<p>I built you a line for both. Her name is Emma. She is set to speak at a measured pace, confirm every detail before moving on, and never rush a booking. She checks real availability before she offers anything.</p>
<p>Live for 7 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it as a nervous patient, then as a rushed coordinator. 5 calls, 10 minutes each.</p>
<p>Reply "no" and I will stop.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `it repeats things back`,
      delayDays: 2,
      body: (e, p) => `<p>The obvious objection is that your callers are elderly and a machine will lose them. It is the right thing to worry about.</p>
<p>So it goes slow deliberately. It confirms details instead of racing through them, and it spells the caller's name back letter by letter and their email back character by character before it books. Someone on a bad phone line gets that twice if they need it.</p>
<p>It also handles being talked over. Interrupt it and it stops, the way a person would, instead of finishing its sentence.</p>
<p>${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `wrapping this up`,
      body: (e, p) => `<p>Last email from me.</p>
<p>Your demo line comes down in 2 days.</p>
<p>A discharge planner who cannot reach you twice stops trying. They do not complain, they just call the other provider from then on. That is how these contracts leak.</p>
<p>Two minutes to hear how it handles one:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Thanks for the time.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ],
  security: [
    {
      subject: (e) => `${e.company_name} inbound`,
      delayDays: 2,
      body: (e, p) => `<p>${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}When a property manager in ${e.prospect_city} calls a security firm, they are already judging you by how the phone gets answered. Usually they are calling because something happened last night, and they are calling three firms.</p>
<p>I built ${e.company_name} a line for those. Her name is Emma. She is consultative rather than pushy, listens to what the site actually needs before proposing anything, and books the site assessment off a live calendar.</p>
<p>Live for 7 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it as a facility director and see how it holds up. 5 calls, 10 minutes each.</p>
<p>Reply "no" and I am done.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `it listens before it pitches`,
      delayDays: 2,
      body: (e, p) => `<p>The first ring is most of the first impression in your business. A property manager who reaches voicemail at 7am has already learned something about how you run.</p>
<p>This one answers like a firm that takes itself seriously. It listens before it proposes anything. It can talk through ongoing coverage, event work, and short notice cover after an incident, and it books the site assessment off a live calendar instead of inventing a time.</p>
<p>What it will not do is quote a rate or promise a start date it cannot stand behind. That stays with you.</p>
<p>${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `closing out`,
      body: (e, p) => `<p>Last email.</p>
<p>The line I built for ${e.company_name} expires in 2 days.</p>
<p>One 30-post contract you did not answer for is more than this costs in a year. That is the entire case, and I will leave it there.</p>
<p>It is live until then:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Good luck with it.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ],
  roadside: [
    {
      subject: (e) => `${e.company_name} roadside line`,
      delayDays: 2,
      body: (e, p) => `<p>${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}Somebody sitting on the shoulder outside ${e.prospect_city} gives you about a minute. They want to hear a voice, and if they do not get one they call the next number.</p>
<p>I built ${e.company_name} a line that answers every time. Her name is Emma. She works out whether it is a jump, a flat, a fuel run, a lockout or a light tow, keeps it short, and books off a live calendar.</p>
<p>Live for 7 days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Call it from the road. 5 calls, 10 minutes each.</p>
<p>Reply "no" and that is the last of me.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `it does not make things up`,
      delayDays: 2,
      body: (e, p) => `<p>Most AI phone tools are one generic bot with your name pasted on. Fair to assume this is that.</p>
<p>This one is set to move fast, because the caller is stranded and possibly somewhere unsafe. It sorts the service type quickly, jump, flat, fuel, lockout or a light tow, and it does not pad the call.</p>
<p>It also does not make things up. No invented ETA, no invented price, no invented appointment slot. It reads real availability off a live calendar and confirms the caller's details back before it books.</p>
<p>${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
    {
      subject: () => `last from me`,
      body: (e, p) => `<p>Last email, then I am out of your inbox.</p>
<p>The ${e.company_name} line goes offline in 2 days.</p>
<p>Every ring-out is a driver who called the next company sixty seconds later. You will never see those in a report, which is what makes them expensive.</p>
<p>One call and you will know:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>Safe roads.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
    },
  ],
};

// ─────────────────────────────────────────────────────────────
// ULTRA WARM - after the demo is TESTED (call > 15s).
// Same thread. 3 emails over 5 days. Resets the 7-day timer.
// ─────────────────────────────────────────────────────────────
const ultra_warm = [
  {
    subject: () => `How was Emma`,
    delayDays: 2,
    body: (e, p) => `<p>Curious what you thought.</p>
<p>You gave Emma a call. Most people are surprised how naturally she handles everything, from fielding questions after-hours to booking jobs on the spot. Anything stand out?</p>
<p>If you're open to it, Naman can walk you through what this looks like inside ${e.company_name}'s operation on a quick 15-min call.</p>
<p>If you'd like to schedule a call with Naman, just reply here and we'll find a time.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
  },
  {
    subject: () => `Still thinking it over`,
    delayDays: 2,
    body: (e, p) => `<p>Still thinking it over. The demo line is still live if you want to try it again:</p>
<p><a href="${e.demo_page_url}">${e.demo_page_url}</a></p>
<p>A couple of things that usually come up:</p>
<p>"Does it actually sound human?" Emma was built for this. She handles the back-and-forth naturally, knows when to escalate, and doesn't drop calls.</p>
<p>"What if it can't answer something?" She captures the lead and flags it. Nothing slips through.</p>
<p>If you're ready to see how this fits ${e.company_name}, reply here and we'll help you schedule a call with Naman.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
  },
  {
    subject: () => `Last one from me`,
    delayDays: 2,
    body: (e, p) => `<p>Closing the loop on ${e.company_name}.</p>
<p>If AI voice is something you'd want to move forward with, you can schedule a call with Naman here:</p>
<p><a href="${process.env.WARM_BOOKING_LINK || ''}">${process.env.WARM_BOOKING_LINK || ''}</a></p>
<p>If the timing's not right, no worries at all. Appreciate you taking the time to try Emma.</p>
<p>Best Regards,<br>
<p>${persona.fullName}<br>
${persona.title} | Creative Copyz</p>`,
  },
];

module.exports = { ultra_warm };
