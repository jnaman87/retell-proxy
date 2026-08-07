'use strict';

/**
 * Creative Copyz — Gmail sender
 *
 * Sends cold sequence email through the mailboxes themselves, via the Gmail
 * API with domain-wide delegation. Mail leaves Google's IPs, so the warmup
 * already built on these mailboxes applies.
 *
 * Install: npm i google-auth-library
 *
 * Env:
 *   GOOGLE_SA_<TENANT>  JSON service account key, one per Workspace tenant.
 *                       TENANT is the domain with dots and dashes replaced by
 *                       underscores and uppercased, e.g.
 *                       getcreativecopyz.com -> GOOGLE_SA_GETCREATIVECOPYZ_COM
 */

const { JWT } = require('google-auth-library');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

// One JWT client per mailbox, cached. Tokens refresh themselves.
const clients = {};

function tenantEnvKey(mailbox) {
  const domain = mailbox.split('@')[1] || '';
  return 'GOOGLE_SA_' + domain.replace(/[.-]/g, '_').toUpperCase();
}

function getClient(mailbox) {
  if (clients[mailbox]) return clients[mailbox];

  const envKey = tenantEnvKey(mailbox);
  const rawKey = process.env[envKey];
  if (!rawKey) throw new Error(`No service account key in ${envKey} for ${mailbox}`);

  let key;
  try {
    key = JSON.parse(rawKey);
  } catch (e) {
    throw new Error(`${envKey} is not valid JSON: ${e.message}`);
  }

  clients[mailbox] = new JWT({
    email  : key.client_email,
    key    : key.private_key,
    scopes : SCOPES,
    subject: mailbox,          // impersonate this mailbox
  });
  return clients[mailbox];
}

async function gmailFetch(mailbox, path, options = {}) {
  const client = getClient(mailbox);
  const { token } = await client.getAccessToken();

  const r = await fetch(`${GMAIL}${path}`, {
    ...options,
    headers: {
      Authorization  : `Bearer ${token}`,
      'Content-Type' : 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await r.text();
  if (!r.ok) throw new Error(`Gmail ${path} failed (${r.status}): ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

// ─── MIME ────────────────────────────────────────────────────────────────────
// Plain text only. No HTML alternative, no images, no tracking pixel. Anything
// else raises the spam score and contradicts the "a person typed this" framing.

function encodeHeader(value) {
  // RFC 2047 encode only when the header contains non-ASCII, so ordinary
  // subjects stay human-readable in the raw message.
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildMime({ fromName, fromEmail, to, subject, body, inReplyTo, references }) {
  const headers = [
    `From: ${encodeHeader(fromName)} <${fromEmail}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];

  // Threading. Both headers are needed: In-Reply-To for direct parentage,
  // References for the full chain. Without them Gmail may split the thread
  // even when threadId is supplied.
  if (inReplyTo)  headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);

  return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + body, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Send one email.
 * Pass threadId + inReplyTo + references for follow-ups so they land in the
 * same conversation as the first touch.
 *
 * Returns { id, threadId, messageId } where messageId is the RFC822
 * Message-ID header, which the NEXT follow-up needs.
 */
async function sendEmail({
  mailbox, fromName, to, subject, body,
  threadId = null, inReplyTo = null, references = null,
}) {
  const raw = buildMime({
    fromName, fromEmail: mailbox, to, subject, body, inReplyTo, references,
  });

  const payload = threadId ? { raw, threadId } : { raw };

  const sent = await gmailFetch(mailbox, '/messages/send', {
    method: 'POST',
    body  : JSON.stringify(payload),
  });

  // Read back the Message-ID Gmail assigned. Needed to thread the next email.
  const meta = await gmailFetch(
    mailbox,
    `/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`
  );
  const hdr = (meta.payload && meta.payload.headers || [])
    .find(h => h.name.toLowerCase() === 'message-id');

  console.log(`[gmail] sent via ${mailbox} -> ${to} | thread ${sent.threadId}`);

  return {
    id        : sent.id,
    threadId  : sent.threadId,
    messageId : hdr ? hdr.value : null,
  };
}

// ─── Inbound ─────────────────────────────────────────────────────────────────
/**
 * Recent inbox activity for one mailbox. One API call plus one per message.
 * Match threadId against your active enrollments to detect replies, and check
 * `bounced` to catch delivery failures.
 */
async function listRecentInbound(mailbox, { days = 3, max = 50 } = {}) {
  const q    = encodeURIComponent(`in:inbox newer_than:${days}d`);
  const list = await gmailFetch(mailbox, `/messages?q=${q}&maxResults=${max}`);
  if (!list.messages || !list.messages.length) return [];

  const out = [];
  for (const m of list.messages) {
    try {
      const msg = await gmailFetch(
        mailbox,
        `/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`
      );
      const headers = (msg.payload && msg.payload.headers) || [];
      const get = n => {
        const h = headers.find(x => x.name.toLowerCase() === n);
        return h ? h.value : '';
      };
      const from = get('from').toLowerCase();

      out.push({
        id       : msg.id,
        threadId : msg.threadId,
        from,
        subject  : get('subject'),
        snippet  : msg.snippet || '',
        // Delivery failures come back from the postmaster, not the prospect.
        bounced  : /mailer-daemon|postmaster/.test(from),
      });
    } catch (e) {
      console.error(`[gmail] metadata read failed for ${m.id}: ${e.message}`);
    }
  }
  return out;
}

// ─── Preflight ───────────────────────────────────────────────────────────────
// Run once after setup. Proves delegation works for every mailbox before you
// discover a broken one mid-campaign.
async function verifyMailbox(mailbox) {
  try {
    const p = await gmailFetch(mailbox, '/profile?fields=emailAddress,messagesTotal');
    console.log(`[gmail] ✅ ${mailbox} ok (${p.messagesTotal} messages)`);
    return true;
  } catch (e) {
    console.error(`[gmail] ❌ ${mailbox}: ${e.message}`);
    return false;
  }
}

async function verifyAll(mailboxes) {
  const results = {};
  for (const m of mailboxes) results[m] = await verifyMailbox(m);
  const ok = Object.values(results).filter(Boolean).length;
  console.log(`[gmail] ${ok}/${mailboxes.length} mailboxes reachable`);
  return results;
}

module.exports = { sendEmail, listRecentInbound, verifyMailbox, verifyAll };
