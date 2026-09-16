'use strict';

// Builds a prospect-specific Retell demo through the existing /create-agent route.
// Kept separate from replyDetector/conversationHandler to avoid circular requires.

async function buildDemoForEnrollment(enrollment) {
  if (enrollment.demo_page_url) {
    console.log(`[demo] Existing demo for ${enrollment.prospect_email}: ${enrollment.demo_page_url}`);
    return enrollment.demo_page_url;
  }

  const PORT = process.env.PORT || 3000;
  const base = process.env.RAILWAY_PUBLIC_URL || `http://127.0.0.1:${PORT}`;

  try {
    const r = await fetch(`${base}/create-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        niche: enrollment.niche,
        businessName: enrollment.company_name,
        city: enrollment.prospect_city,
        coreServices: enrollment.core_services || '',
        tagline: enrollment.tagline || '',
        primaryColor: enrollment.primary_color || '',
        secondaryColor: enrollment.secondary_color || '',
        callerFaqs: enrollment.caller_faqs || '',
        contactId: enrollment.contact_id,
        email: enrollment.prospect_email,
      }),
    });

    const raw = await r.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch {}

    if (!r.ok || !data.demoUrl) {
      throw new Error(`demo build failed (${r.status}): ${raw || 'empty response'}`);
    }

    console.log(`[demo] Built ${data.demoUrl} for ${enrollment.prospect_email}`);
    return data.demoUrl;
  } catch (e) {
    console.error(`[demo] Build error for ${enrollment.prospect_email}:`, e.message);
    return null;
  }
}

module.exports = { buildDemoForEnrollment };
