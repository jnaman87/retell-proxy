'use strict';

module.exports = [
  {
    // Step 0 — First touch
    subject   : 'Quick question about your after-hours calls',
    delayDays : 3,
    body: (e) => {
      const first = (e.prospect_name || '').split(' ')[0] || 'there';
      return `Hi ${first},

I came across your business and noticed you handle emergency calls around the clock — that's a tough operation to staff consistently.

We built a voice AI receptionist that handles after-hours intake calls the way your team would: confirms the job, captures the address, and books the appointment — without needing a human on the line.

Worth a 2-minute listen? I can send over a demo call recording tailored to your business.

Naman
Creative Copyz`;
    },
  },
  {
    // Step 1 — Follow-up (Day 3)
    subject   : null,
    delayDays : 4,
    body: (e) => {
      const first = (e.prospect_name || '').split(' ')[0] || 'there';
      return `Hey ${first},

Just bumping this up — the demo takes under 2 minutes and shows the full booking flow end to end.

Happy to tailor it specifically to your service area if that's helpful.

Naman`;
    },
  },
  {
    // Step 2 — Final touch (Day 7)
    subject   : null,
    delayDays : null, // sequence ends after this
    body: (e) => {
      const first = (e.prospect_name || '').split(' ')[0] || 'there';
      const city  = e.prospect_city ? ` in ${e.prospect_city}` : '';
      return `Hi ${first},

Last one from me — I'll leave it here if the timing isn't right.

If you ever want to see what a fully automated after-hours receptionist looks like for your operations${city}, just reply and I'll get it set up.

Naman
Creative Copyz`;
    },
  },
];
