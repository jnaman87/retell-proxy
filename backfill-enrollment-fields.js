'use strict';

/*
 * One-time enrollment-field backfill.
 *
 * Safe by default: without --apply it only reports what would change.
 * It never overwrites a non-empty database field.
 * It excludes every lead with a demo URL and targets only active cold leads.
 *
 * Required environment variables:
 *   DATABASE_URL
 *   CRM_API_KEY
 * Optional:
 *   CRM_LOCATION_ID (defaults to the Creative Copyz location)
 *
 * Usage:
 *   node backfill-enrollment-fields.js
 *   node backfill-enrollment-fields.js --apply
 */

const { Pool } = require('pg');

const APPLY = process.argv.includes('--apply');
const DATABASE_URL = process.env.DATABASE_URL || '';
const CRM_API_KEY = process.env.CRM_API_KEY || '';
const CRM_LOCATION_ID = process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';
const CRM_API = 'https://services.leadconnectorhq.com';

if (!DATABASE_URL || !CRM_API_KEY) {
  console.error('DATABASE_URL and CRM_API_KEY must both be set.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL.includes('railway.internal')
    ? false
    : { rejectUnauthorized: false }
});

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === '';
}

function text(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    return text(value.value ?? value.fieldValue ?? value.text ?? '');
  }
  return String(value).trim();
}

async function ghl(path) {
  const response = await fetch(CRM_API + path, {
    headers: {
      Authorization: 'Bearer ' + CRM_API_KEY,
      Version: '2021-07-28',
      Accept: 'application/json'
    }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function getFieldNameById() {
  const body = await ghl(`/locations/${encodeURIComponent(CRM_LOCATION_ID)}/customFields`);
  const fields = body.customFields || body.customField || [];
  const byId = new Map();

  for (const field of fields) {
    if (!field.id) continue;
    byId.set(String(field.id), field.name || field.fieldKey || '');
  }
  return byId;
}

function contactValues(contact, fieldNameById) {
  const values = Object.create(null);
  const add = (key, value) => {
    const normalizedKey = String(key || '').trim().toLowerCase();
    const normalizedValue = text(value);
    if (normalizedKey && normalizedValue) values[normalizedKey] = normalizedValue;
  };

  for (const [key, value] of Object.entries(contact || {})) {
    if (!['customFields', 'custom_fields'].includes(key)) add(key, value);
  }

  const customFields = contact.customFields || contact.custom_fields || [];
  if (Array.isArray(customFields)) {
    for (const field of customFields) {
      const name = field.name || field.fieldName || field.fieldKey || fieldNameById.get(String(field.id));
      add(name, field.value ?? field.fieldValue ?? field);
    }
  } else if (customFields && typeof customFields === 'object') {
    for (const [idOrName, value] of Object.entries(customFields)) {
      add(fieldNameById.get(String(idOrName)) || idOrName, value);
    }
  }

  return values;
}

function firstValue(values, ...keys) {
  for (const key of keys) {
    const value = values[String(key).toLowerCase()];
    if (!isBlank(value)) return value;
  }
  return '';
}

async function main() {
  const fieldNameById = await getFieldNameById();
  const { rows } = await pool.query(
    `SELECT id, contact_id, prospect_email,
            personalisation_hook, current_pain, core_services,
            tagline, caller_faqs, primary_color, secondary_color
       FROM enrollments
      WHERE status = 'active'
        AND phase = 'cold'
        AND COALESCE(BTRIM(demo_page_url), '') = ''
      ORDER BY id`
  );

  console.log(`[backfill] ${APPLY ? 'APPLY' : 'DRY RUN'}: ${rows.length} eligible lead(s)`);

  let changed = 0;
  let skipped = 0;
  let failed = 0;

  for (const enrollment of rows) {
    if (isBlank(enrollment.contact_id)) {
      console.warn(`[backfill] id=${enrollment.id}: skipped (no contact_id)`);
      skipped++;
      continue;
    }

    try {
      const body = await ghl(`/contacts/${encodeURIComponent(enrollment.contact_id)}`);
      const values = contactValues(body.contact || body, fieldNameById);

      const incoming = {
        personalisation_hook: firstValue(values, 'Personalisation Hook', 'Personalization Hook', 'personalisation_hook', 'personalisationHook'),
        current_pain: firstValue(values, 'Current Pain', 'current_pain', 'currentPain'),
        core_services: firstValue(values, 'Core Services', 'core_services', 'coreServices'),
        tagline: firstValue(values, 'Business Tagline', 'tagline'),
        caller_faqs: firstValue(values, 'Caller FAQs', 'caller_faqs', 'callerFaqs'),
        primary_color: firstValue(values, 'Brand Primary Color', 'Primary Color', 'primary_color', 'primaryColor'),
        secondary_color: firstValue(values, 'Brand Secondary Color', 'Secondary Color', 'secondary_color', 'secondaryColor')
      };

      const updates = Object.entries(incoming).filter(([column, value]) =>
        isBlank(enrollment[column]) && !isBlank(value)
      );

      if (!updates.length) {
        console.log(`[backfill] id=${enrollment.id} ${enrollment.prospect_email}: no blank fields to fill`);
        skipped++;
        continue;
      }

      const fieldList = updates.map(([column]) => column).join(', ');
      console.log(`[backfill] id=${enrollment.id} ${enrollment.prospect_email}: ${fieldList}`);

      if (APPLY) {
        const assignments = updates.map(([column], index) => `${column} = $${index + 1}`);
        const params = updates.map(([, value]) => value);
        params.push(enrollment.id);

        await pool.query(
          `UPDATE enrollments
              SET ${assignments.join(', ')}
            WHERE id = $${params.length}`,
          params
        );
      }
      changed++;
    } catch (error) {
      failed++;
      console.error(`[backfill] id=${enrollment.id} failed: ${error.message}`);
    }
  }

  console.log(`[backfill] complete: ${changed} ${APPLY ? 'updated' : 'would update'}, ${skipped} unchanged/skipped, ${failed} failed`);
}

main()
  .catch(error => {
    console.error('[backfill] fatal:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
