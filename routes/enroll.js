'use strict';
const express = require('express');
const pool    = require('../cold-email/pool');
const router  = express.Router();

const CITY_TZ = {
  'new york'      : 'America/New_York',
  'boston'        : 'America/New_York',
  'miami'         : 'America/New_York',
  'orlando'       : 'America/New_York',
  'atlanta'       : 'America/New_York',
  'charlotte'     : 'America/New_York',
  'toronto'       : 'America/New_York',
  'chicago'       : 'America/Chicago',
  'dallas'        : 'America/Chicago',
  'houston'       : 'America/Chicago',
  'austin'        : 'America/Chicago',
  'san antonio'   : 'America/Chicago',
  'nashville'     : 'America/Chicago',
  'denver'        : 'America/Denver',
  'calgary'       : 'America/Denver',
  'salt lake city': 'America/Denver',
  'phoenix'       : 'America/Phoenix',
  'los angeles'   : 'America/Los_Angeles',
  'seattle'       : 'America/Los_Angeles',
  'san francisco' : 'America/Los_Angeles',
  'las vegas'     : 'America/Los_Angeles',
  'portland'      : 'America/Los_Angeles',
  'vancouver'     : 'America/Los_Angeles',
  'sydney'        : 'Australia/Sydney',
  'melbourne'     : 'Australia/Sydney',
  'brisbane'      : 'Australia/Brisbane',
};

function resolveTimezone(city = '') {
  return CITY_TZ[city.toLowerCase().trim()] || 'America/Chicago';
}

router.post('/enroll', async (req, res) => {
  const {
    contact_id, email, name, city,
    niche, company_name, demo_page_url,
    personalisation_hook, current_pain,
  } = req.body;

  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    const tz = resolveTimezone(city);
    await pool.query(
      `INSERT INTO enrollments
         (contact_id, prospect_email, prospect_name, prospect_city, prospect_tz,
          niche, company_name, demo_page_url, personalisation_hook, current_pain)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (prospect_email) DO NOTHING`,
      [contact_id, email.toLowerCase().trim(), name, city, tz,
       niche, company_name, demo_page_url, personalisation_hook, current_pain]
    );
    console.log(`[enroll] ✅ ${email} (${niche}) enrolled`);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[enroll] DB error:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.resolveTimezone = resolveTimezone;
