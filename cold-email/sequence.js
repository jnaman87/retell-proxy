'use strict';

const SEQUENCES = {

  // ── 1. RESTORATION ──────────────────────────────────────────────────────────
  restoration: [
    {
      subject  : (e) => `${e.company_name} after hours`,
      delayDays: 2,
      body: (e) => `${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}A ${e.prospect_city} homeowner standing in six inches of water calls three mitigation companies in about ten minutes. First one to actually pick up gets the job, and the rebuild that follows it.

So I built ${e.company_name} a phone line that always picks up. Her name is Emma. She answers as your company, handles the water, fire, storm and mold calls that come in at 1am, pulls real openings off a live calendar, and books the assessment.

It is live for 7 days:

${e.demo_page_url}

Call it. Try to trip it up. You get 5 test calls, 10 minutes each.

Not for you? Reply "no" and I will leave you be.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `the day after a storm`,
      delayDays: 2,
      body: (e) => `Fair to assume this is another generic bot. Most of them are. Here is the part that is harder to argue with.

On a normal Tuesday your office handles the phone fine. The day after a storm moves through ${e.prospect_city}, forty people call inside two hours, and there is no version of one receptionist that answers all of them. The overflow is where your large losses go.

This answers every one of them at the same time. No queue, no callback list you work through on Wednesday while somebody else is already drying the building.

It also does not guess. It reads real openings off a live calendar instead of inventing a time, and anything it cannot stand behind on price or arrival it puts to the consultation.

${e.current_pain ? e.current_pain + '\n\n' : ''}The ${e.company_name} line is live for 4 more days:

${e.demo_page_url}

Call it and ask it something ugly.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `closing this out`,
      delayDays: null,
      body: (e) => `Last email from me, I will not chase.

The line I built for ${e.company_name} shuts off in 2 days and the number stops working.

One large loss that rang out this year would have paid for years of this. That is the whole argument.

Two minutes and you will know if it holds up:

${e.demo_page_url}

Either way, good luck this season.

Best Regards,
Naman
Director | Creative Copyz`,
    },
  ],

  // ── 2. BAIL BONDS ────────────────────────────────────────────────────────────
  bailbond: [
    {
      subject  : (e) => `${e.company_name}, 2am`,
      delayDays: 2,
      body: (e) => `${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}Nobody calls a bondsman at a calm moment. They are frightened, it is 2am, and they are working down a list of ${e.prospect_city} bondsmen. Second ring and they are on to the next name.

I built ${e.company_name} a line that answers every one of those. Her name is Emma. She stays calm when the caller is not, walks them through how the process generally works, and books them in off a live calendar.

Live for 7 days:

${e.demo_page_url}

Call it the way a scared family member would. 5 test calls, 10 minutes each.

Reply "no" and I am gone.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `it does not give legal advice`,
      delayDays: 2,
      body: (e) => `The concern with putting a machine on a bail line is that it says something it should not. Quotes your fee on a specific bond. Promises a release time. Gives legal advice.

It does none of those. It explains the standard ten percent and how the process generally works, and everything past that it hands to a licensed agent instead of guessing.

It also books off a live calendar rather than inventing a time, and it spells the caller's name and email back letter by letter before it confirms anything. That last part is what most people expect a bot to get wrong.

${e.current_pain ? e.current_pain + '\n\n' : ''}Still live for 4 days:

${e.demo_page_url}

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `shutting the line off`,
      delayDays: null,
      body: (e) => `Last email, then I stop.

The ${e.company_name} line expires in 2 days.

Between now and then, a few families in ${e.prospect_city} will call somebody at 2am. They call one number, and if it rings out they call another. That is the whole business.

It is still on until then:

${e.demo_page_url}

Appreciate the time either way.

Best Regards,
Naman
Director | Creative Copyz`,
    },
  ],

  // ── 3. TOWING ────────────────────────────────────────────────────────────────
  towing: [
    {
      subject  : (e) => `${e.company_name} dispatch`,
      delayDays: 2,
      body: (e) => `${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}A driver stuck on the shoulder gives you about 60 seconds before they tap the next number. They are not leaving a voicemail.

I built ${e.company_name} a line that answers on the first ring, every time. Her name is Emma. She works out whether it is a tow, a jump, a flat or a lockout, handles the two questions every caller opens with, and books off a live calendar.

Live for 7 days:

${e.demo_page_url}

Call it from your truck. 5 calls, 10 minutes each.

Reply "no" and that is the end of it.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `it does not guess`,
      delayDays: 2,
      body: (e) => `Fair if you assumed this was another generic bot. Most of them are.

This one is tuned for tow calls specifically. It moves fast, it does not over-explain, and it knows a lockout is not a flat tire is not a flatbed job.

What it will not do is guess. It reads openings off a live calendar instead of making a time up, and when a caller pushes for an exact ETA or an exact price it does not have, it says so rather than inventing one. Those stay yours to set.

${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:

${e.demo_page_url}

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `wrapping up`,
      delayDays: null,
      body: (e) => `Last one, I promise.

Your demo line goes off in 2 days.

Every ring-out is a call that went to whoever was second on the list. You already know what a night of those costs.

Sixty seconds to hear it for yourself:

${e.demo_page_url}

Drive safe.

Best Regards,
Naman
Director | Creative Copyz`,
    },
  ],

  // ── 4. LOCKSMITH ─────────────────────────────────────────────────────────────
  locksmith: [
    {
      subject  : (e) => `${e.company_name} first ring`,
      delayDays: 2,
      body: (e) => `${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}Lockout calls are won on the first ring. Somebody is standing next to their car in a ${e.prospect_city} parking garage and they are calling until somebody answers.

I built ${e.company_name} a line that always does. Her name is Emma. She works out whether it is a car, a house or an office, whether it is a lockout or a rekey, and books the visit off a live calendar.

Live for 7 days:

${e.demo_page_url}

Call it and pretend you are locked out. 5 calls, 10 minutes each.

Not for you? Reply "no".

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `it will not quote you a price`,
      delayDays: 2,
      body: (e) => `Your customers have been burned by the $19 lockout ad that turns into $250 on arrival. So the fastest way to lose a call is to sound like that.

This one does not quote. It tells callers your pricing is upfront with no hidden fees, then leaves the actual number to your technician instead of inventing one on the phone. Same with arrival times.

It does not invent openings either. It pulls real availability off a live calendar, then spells the caller's name and email back before it books.

${e.current_pain ? e.current_pain + '\n\n' : ''}Your line is live for 4 more days:

${e.demo_page_url}

Try to make it say something dumb.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `last email`,
      delayDays: null,
      body: (e) => `The ${e.company_name} demo line expires in 2 days.

The calls you miss do not leave voicemails. They call the next locksmith in ${e.prospect_city} and you never find out it happened.

Last chance to hear how it handles one:

${e.demo_page_url}

Good luck out there.

Best Regards,
Naman
Director | Creative Copyz`,
    },
  ],

  // ── 5. VET ───────────────────────────────────────────────────────────────────
  vet: [
    {
      subject  : (e) => `${e.company_name} after 10pm`,
      delayDays: 2,
      body: (e) => `${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}Somebody in ${e.prospect_city} calls at 11pm because their dog got into something. They are upset and they need a calm voice in under ten seconds.

I built ${e.company_name} a line for exactly those. Her name is Emma. She stays steady while the caller is not, covers what to do on the way in, and books off a live calendar.

Live for 7 days:

${e.demo_page_url}

Call it and give it a hard one. 5 calls, 10 minutes each.

Reply "no" and I will not write again.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `it does not diagnose`,
      delayDays: 2,
      body: (e) => `The worry with a machine on a vet line is that it says something clinical it has no business saying. Agreed.

So it does not diagnose. It sticks to safe pre-arrival guidance: keep the animal calm, do not feed them, drive carefully. Anything past that it puts on your team rather than improvising, and it says so plainly.

It also stays calm with someone who is crying, which is the part that wears your techs down at 3am. And it books off a live calendar, reading the caller's email back character by character before it confirms.

${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:

${e.demo_page_url}

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `last note`,
      delayDays: null,
      body: (e) => `Last email from me.

The line I built for ${e.company_name} shuts off in 2 days.

Every overnight call that rings out is a family driving to whichever clinic answered instead. And it is one more 3am call your team did not have to absorb.

Still live until then:

${e.demo_page_url}

Thanks for the work you do at hours nobody sees.

Best Regards,
Naman
Director | Creative Copyz`,
    },
  ],

  // ── 6. FUNERAL ───────────────────────────────────────────────────────────────
  funeral: [
    {
      subject  : (e) => `${e.company_name} first call`,
      delayDays: 2,
      body: (e) => `${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}The first call a family makes is usually within an hour of a death, and it often comes at 3am. Whoever answers sets the tone for everything after.

I built ${e.company_name} a line for those hours. Her name is Emma. She is set to speak slowly and lead with the family before the logistics, then arrange a private consultation with a director rather than pushing anyone through a form.

It is live for 7 days:

${e.demo_page_url}

Call it and hear how it holds the room.

If it is not right for you, a one word reply is plenty.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `on whether it feels human`,
      delayDays: 2,
      body: (e) => `The only question that matters here is whether it feels human, and you cannot answer that from an email.

What I can tell you is how it is built. It speaks slowly and it does not rush. It leads with empathy before logistics. It can talk through burial, cremation, memorial and pre-planning at a general level, and the moment the conversation turns to cost or specifics it moves that to a private consultation with your director, where it belongs.

It will not invent anything about your firm. If it does not know, it says so.

${e.current_pain ? e.current_pain + '\n\n' : ''}The line is live for 4 more days:

${e.demo_page_url}

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `last note from me`,
      delayDays: null,
      body: (e) => `This is the last email I will send.

The line I set up for ${e.company_name} comes down in 2 days.

If it is useful, it is useful. If not, I would rather you say so than wonder. It takes a minute to find out:

${e.demo_page_url}

Thank you for the time.

Best Regards,
Naman
Director | Creative Copyz`,
    },
  ],

  // ── 7. SEPTIC ────────────────────────────────────────────────────────────────
  septic: [
    {
      subject  : (e) => `${e.company_name} emergency line`,
      delayDays: 2,
      body: (e) => `${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}When there is sewage coming up into a shower on a Sunday night, nobody leaves a voicemail. They call every septic company in ${e.prospect_city} until a person answers.

I built ${e.company_name} a line that answers all of them. Her name is Emma. She works out whether it is a backup, a full tank or a drain field problem, keeps it short because nobody wants a conversation at that moment, and books off a live calendar.

Live for 7 days:

${e.demo_page_url}

Call it and throw a messy one at it. 5 calls, 10 minutes each.

Reply "no" if this is not for you.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `it keeps it short`,
      delayDays: 2,
      body: (e) => `Reasonable to assume this is another generic bot. Most of them are.

This one is set to be direct on purpose. A sewage call is not the place for a chatty receptionist, so it gets the facts and moves.

It separates a backup from a full tank from a drain field issue. It does not quote a price or a truck time it does not have. And it does not invent an opening: it reads real availability off a live calendar, then confirms the caller's name and email back to them before booking.

${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:

${e.demo_page_url}

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `last one from me`,
      delayDays: null,
      body: (e) => `The ${e.company_name} demo line expires in 2 days.

An emergency backup that you answer usually becomes a customer who calls you every three years. The ones that ring out become somebody else's.

Still on until then:

${e.demo_page_url}

Appreciate it either way.

Best Regards,
Naman
Director | Creative Copyz`,
    },
  ],

  // ── 8. NEMT ──────────────────────────────────────────────────────────────────
  nemt: [
    {
      subject  : (e) => `${e.company_name} scheduling line`,
      delayDays: 2,
      body: (e) => `${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}Two kinds of people call ${e.company_name}. An 80 year old arranging a dialysis ride who needs things repeated twice, and a discharge planner who needs a pickup soon and will call the next provider if you do not pick up.

I built you a line for both. Her name is Emma. She is set to speak at a measured pace, confirm every detail before moving on, and never rush a booking. She checks real availability before she offers anything.

Live for 7 days:

${e.demo_page_url}

Call it as a nervous patient, then as a rushed coordinator. 5 calls, 10 minutes each.

Reply "no" and I will stop.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `it repeats things back`,
      delayDays: 2,
      body: (e) => `The obvious objection is that your callers are elderly and a machine will lose them. It is the right thing to worry about.

So it goes slow deliberately. It confirms details instead of racing through them, and it spells the caller's name back letter by letter and their email back character by character before it books. Someone on a bad phone line gets that twice if they need it.

It also handles being talked over. Interrupt it and it stops, the way a person would, instead of finishing its sentence.

${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:

${e.demo_page_url}

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `wrapping this up`,
      delayDays: null,
      body: (e) => `Last email from me.

Your demo line comes down in 2 days.

A discharge planner who cannot reach you twice stops trying. They do not complain, they just call the other provider from then on. That is how these contracts leak.

Two minutes to hear how it handles one:

${e.demo_page_url}

Thanks for the time.

Best Regards,
Naman
Director | Creative Copyz`,
    },
  ],

  // ── 9. SECURITY ──────────────────────────────────────────────────────────────
  security: [
    {
      subject  : (e) => `${e.company_name} inbound`,
      delayDays: 2,
      body: (e) => `${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}When a property manager in ${e.prospect_city} calls a security firm, they are already judging you by how the phone gets answered. Usually they are calling because something happened last night, and they are calling three firms.

I built ${e.company_name} a line for those. Her name is Emma. She is consultative rather than pushy, listens to what the site actually needs before proposing anything, and books the site assessment off a live calendar.

Live for 7 days:

${e.demo_page_url}

Call it as a facility director and see how it holds up. 5 calls, 10 minutes each.

Reply "no" and I am done.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `it listens before it pitches`,
      delayDays: 2,
      body: (e) => `The first ring is most of the first impression in your business. A property manager who reaches voicemail at 7am has already learned something about how you run.

This one answers like a firm that takes itself seriously. It listens before it proposes anything. It can talk through ongoing coverage, event work, and short notice cover after an incident, and it books the site assessment off a live calendar instead of inventing a time.

What it will not do is quote a rate or promise a start date it cannot stand behind. That stays with you.

${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:

${e.demo_page_url}

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `closing out`,
      delayDays: null,
      body: (e) => `Last email.

The line I built for ${e.company_name} expires in 2 days.

One 30-post contract you did not answer for is more than this costs in a year. That is the entire case, and I will leave it there.

It is live until then:

${e.demo_page_url}

Good luck with it.

Best Regards,
Naman
Director | Creative Copyz`,
    },
  ],

  // ── 10. ROADSIDE ─────────────────────────────────────────────────────────────
  roadside: [
    {
      subject  : (e) => `${e.company_name} roadside line`,
      delayDays: 2,
      body: (e) => `${e.personalisation_hook ? e.personalisation_hook + '\n\n' : ''}Somebody sitting on the shoulder outside ${e.prospect_city} gives you about a minute. They want to hear a voice, and if they do not get one they call the next number.

I built ${e.company_name} a line that answers every time. Her name is Emma. She works out whether it is a jump, a flat, a fuel run, a lockout or a light tow, keeps it short, and books off a live calendar.

Live for 7 days:

${e.demo_page_url}

Call it from the road. 5 calls, 10 minutes each.

Reply "no" and that is the last of me.

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `it does not make things up`,
      delayDays: 2,
      body: (e) => `Most AI phone tools are one generic bot with your name pasted on. Fair to assume this is that.

This one is set to move fast, because the caller is stranded and possibly somewhere unsafe. It sorts the service type quickly, jump, flat, fuel, lockout or a light tow, and it does not pad the call.

It also does not make things up. No invented ETA, no invented price, no invented appointment slot. It reads real availability off a live calendar and confirms the caller's details back before it books.

${e.current_pain ? e.current_pain + '\n\n' : ''}Live for 4 more days:

${e.demo_page_url}

Best Regards,
Naman
Director | Creative Copyz`,
    },
    {
      subject  : () => `last from me`,
      delayDays: null,
      body: (e) => `Last email, then I am out of your inbox.

The ${e.company_name} line goes offline in 2 days.

Every ring-out is a driver who called the next company sixty seconds later. You will never see those in a report, which is what makes them expensive.

One call and you will know:

${e.demo_page_url}

Safe roads.

Best Regards,
Naman
Director | Creative Copyz`,
    },
  ],

};

module.exports = SEQUENCES;
