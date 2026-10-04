'use strict';

const { JWT } = require('google-auth-library');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

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
    subject: mailbox,
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

function encodeHeader(value) {
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
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];

  if (inReplyTo)  headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);

  return Buffer.from(headers.join('\r\n') + '\r\n\r\n' + body, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendEmail({
  mailbox, fromName, to, subject, body,
  threadId = null, inReplyTo = null, references = null,
}) {
  const raw = buildMime({
    fromName, fromEmail: mailbox, to, subject, body, inReplyTo, references,
  });

  const payload = threadId ? { raw, threadId } : { raw };

  let sent;
  try {
    sent = await gmailFetch(mailbox, '/messages/send', {
      method: 'POST',
      body  : JSON.stringify(payload),
    });
  } catch (err) {
    // ── Thread no longer exists — retry as a fresh standalone email ──────────
    if (err.message.includes('(404)') && threadId) {
      console.warn(`[gmail] thread ${threadId} not found — retrying as fresh email to ${to}`);
      const freshRaw = buildMime({
        fromName, fromEmail: mailbox, to, subject, body,
        // intentionally no inReplyTo / references
      });
      sent = await gmailFetch(mailbox, '/messages/send', {
        method: 'POST',
        body  : JSON.stringify({ raw: freshRaw }),
      });
    } else {
      throw err; // any other error bubbles up as normal
    }
  }

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
  id           : msg.id,
  threadId     : msg.threadId,
  from,
  subject      : get('subject'),
  snippet      : msg.snippet || '',
  bounced      : /mailer-daemon|postmaster/.test(from),
  internalDate : msg.internalDate ? Number(msg.internalDate) : null,
});
    } catch (e) {
            console.error(`[gmail] metadata read failed for ${m.id} in ${mailbox}: ${e.message}`);
    }
  }
  return out;
}

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
