const ultra_warm = [
  {
    subject: () => `How was Emma`,
    delayDays: 2,
    body: (e, p) => `<p>Curious what you thought.</p>
<p>You gave Emma a call. Most people are surprised how naturally she handles everything, from fielding questions after-hours to booking jobs on the spot. Anything stand out?</p>
<p>If you're open to it, Naman can walk you through what this looks like inside ${e.company_name}'s operation on a quick 15-min call.</p>
<p>If you'd like to schedule a call with Naman, just reply here and we'll find a time.</p>
<p>Best Regards,<br>
${p.full_name}<br>
${p.title || 'Head of Business Development'} | Creative Copyz</p>`,
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
${p.full_name}<br>
${p.title || 'Head of Business Development'} | Creative Copyz</p>`,
  },
  {
    subject: () => `Last one from me`,
    delayDays: 2,
    body: (e, p) => `<p>Closing the loop on ${e.company_name}.</p>
<p>If AI voice is something you'd want to move forward with, you can schedule a call with Naman here:</p>
<p><a href="${process.env.WARM_BOOKING_LINK || ''}">${process.env.WARM_BOOKING_LINK || ''}</a></p>
<p>If the timing's not right, no worries at all. Appreciate you taking the time to try Emma.</p>
<p>Best Regards,<br>
${p.full_name}<br>
${p.title || 'Head of Business Development'} | Creative Copyz</p>`,
  },
];

module.exports = { ultra_warm };
