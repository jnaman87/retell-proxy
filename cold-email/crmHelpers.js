'use strict';

const pool = require('./pool');

const CRM_API = 'https://services.leadconnectorhq.com';
const CRM_API_KEY = process.env.CRM_API_KEY;
const LOCATION_ID =
  process.env.CRM_LOCATION_ID || 'dImqkGzlWhmVksSXL1WY';

// Outbound pipeline
const OT_PIPELINE = 'NxoKeydZvDnkQEM8u6sy';
const OT_BOUNCED = '5d0a6be7-0dff-4bf2-91c3-a8ecc270bda0';
const OT_REPLY_RECEIVED = 'ad4c1fd7-e0bf-4101-9e1e-3e04a7ec81e2';
const OT_UNSUBSCRIBED = '8c9f1603-53f3-4917-97b0-4a89e6507ce6';
const OT_NO_REPLIES = 'cc480a05-61e8-482b-b0c2-430986b64826';
const OT_DEMO_SENT = 'aed1858d-3090-43da-bf3c-3e398795d4da';

// Conversions pipeline
const CV_PIPELINE = 'Sv3XlTtCmzbGrHrZ3BFL';
const CV_DEMO_SENT = 'aaedbe52-060f-4d30-a6b3-21b3f8222812';
const CV_DEMO_TESTED = '1a42d192-dc15-4dd0-bd68-f7fef2842dd0';
const CV_DEMO_EXPIRED = '66ed8785-791e-442a-ba47-ceaae2315ccd';
const CV_UNSUBSCRIBED = '0c0ed89a-9e9c-4e5a-b9c2-d61c5f2d7416';
const CV_REPLY_RECEIVED = 'fa5d74ec-aa3f-44d7-89f4-0e59c41788b9';
const CV_CALL_BOOKED = '3c225fbe-d97d-41ad-ba0e-0c6ede8b4a98';
const CV_NO_SHOW = '50e8d59a-14a2-429d-9121-cb539f567e7a';
const CV_CLOSED_WON = 'b6371df8-ec81-49ee-9fd8-0e1c4daefa30';

async function findOpportunity(contactId, pipelineId) {
  if (!CRM_API_KEY) {
    console.error(
      '[crm] opportunity search skipped: missing CRM_API_KEY'
    );
    return null;
  }

  if (!LOCATION_ID) {
    console.error(
      '[crm] opportunity search skipped: missing CRM_LOCATION_ID'
    );
    return null;
  }

  try {
    const params = new URLSearchParams({
      locationId: LOCATION_ID,
      contactId: contactId,
      pipelineId: pipelineId,
      status: 'all',
      limit: '20',
      page: '1'
    });

    const r = await fetch(
      `${CRM_API}/opportunities/search?${params.toString()}`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CRM_API_KEY}`,
          Version: 'v3',
          Accept: 'application/json'
        }
      }
    );

    const responseText = await r.text();

    if (!r.ok) {
      console.error(
        `[crm] opportunity search failed (${r.status}):`,
        responseText
      );
      return null;
    }

    let data = {};

    try {
      data = responseText
        ? JSON.parse(responseText)
        : {};
    } catch (e) {
      console.error(
        '[crm] opportunity search returned invalid JSON'
      );
      return null;
    }

    return data.opportunities?.[0] || null;
  } catch (e) {
    console.error(
      '[crm] opportunity search error:',
      e.message
    );
    return null;
  }
}

async function moveOpportunity(oppId, stageId) {
  if (!oppId) {
    return;
  }

  const r = await fetch(
    `${CRM_API}/opportunities/${oppId}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CRM_API_KEY}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pipelineStageId: stageId
      })
    }
  );

  if (!r.ok) {
    console.error(
      '[crm] stage move failed:',
      r.status,
      await r.text()
    );
  } else {
    console.log(
      `[crm] stage moved ${oppId} -> ${stageId}`
    );
  }
}

async function createConversionOpportunity(
  contactId,
  companyName
) {
  try {
    const existing = await pool.query(
      `SELECT conversions_opp_id
       FROM enrollments
       WHERE contact_id = $1
         AND conversions_opp_id IS NOT NULL
       LIMIT 1`,
      [contactId]
    );

    if (existing.rows[0]?.conversions_opp_id) {
      console.log(
        `[crm] Conversions opp already exists for ${contactId}: ${existing.rows[0].conversions_opp_id}`
      );

      return existing.rows[0].conversions_opp_id;
    }

    const r = await fetch(
      `${CRM_API}/opportunities`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${CRM_API_KEY}`,
          Version: '2021-07-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          pipelineId: CV_PIPELINE,
          locationId: LOCATION_ID,
          name: `${companyName || 'Lead'} -- AI Voice Demo`,
          pipelineStageId: CV_DEMO_SENT,
          status: 'open',
          contactId
        })
      }
    );

    const d = await r.json();

    if (!r.ok) {
      console.error(
        '[crm] cv opp create failed:',
        r.status,
        JSON.stringify(d)
      );
      return null;
    }

    const oppId = d.opportunity?.id;

    if (!oppId) {
      console.error(
        '[crm] cv opp created but no opportunity ID returned:',
        JSON.stringify(d)
      );
      return null;
    }

    await pool.query(
      `UPDATE enrollments
       SET conversions_opp_id = $1
       WHERE contact_id = $2`,
      [oppId, contactId]
    );

    console.log(
      `[crm] Conversions opp created: ${oppId} for ${companyName}`
    );

    return oppId;
  } catch (e) {
    console.error(
      '[crm] cv opp error:',
      e.message
    );
    return null;
  }
}

module.exports = {
  findOpportunity,
  moveOpportunity,
  createConversionOpportunity,

  OT_PIPELINE,
  OT_REPLY_RECEIVED,
  OT_UNSUBSCRIBED,
  OT_NO_REPLIES,
  OT_DEMO_SENT,

  CV_PIPELINE,
  CV_DEMO_SENT,
  CV_DEMO_TESTED,
  CV_DEMO_EXPIRED,
  CV_UNSUBSCRIBED,
  CV_REPLY_RECEIVED,
  CV_CALL_BOOKED,
  CV_NO_SHOW,
  CV_CLOSED_WON
};
