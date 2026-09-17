// utils/sendMail.js
//
// Resend-backed email service. The rest of the codebase calls
// sendEmail({ to, subject, html, text?, from?, replyTo? }) and doesn't
// need to know or care which provider is behind it.
//
// Env vars:
//   RESEND_API_KEY  — required, get it from https://resend.com/api-keys
//   EMAIL_FROM      — required, e.g. "Xamut <no-reply@xamut.com>"
//                     The domain has to be verified in Resend first.
//   EMAIL_REPLY_TO  — optional, drops into reply_to on every send.

import { Resend } from "resend";

let _client = null;
let _clientKey = null;

const getClient = () => {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error(
      "RESEND_API_KEY is not set. Add it to your .env and restart the server."
    );
  }
  // Rebuild the client if the key changes (useful in dev when you
  // flip between keys without a full restart).
  if (!_client || _clientKey !== key) {
    _client = new Resend(key);
    _clientKey = key;
  }
  return _client;
};

const getFrom = () =>
  process.env.EMAIL_FROM || "Xamut <no-reply@xamut.com>";

// ─────────────────────────────────────────────────────────────────────
// Core send
// ─────────────────────────────────────────────────────────────────────
export async function sendEmail({
  to,
  subject,
  html,
  text,
  from,
  replyTo,
  cc,
  bcc,
  headers,
}) {
  if (!to) throw new Error("sendEmail: 'to' is required.");
  if (!subject) throw new Error("sendEmail: 'subject' is required.");
  if (!html && !text) {
    throw new Error("sendEmail: one of 'html' or 'text' is required.");
  }

  // Resend accepts a string or an array of strings for these.
  const normalize = (v) => {
    if (!v) return undefined;
    if (Array.isArray(v)) return v.filter(Boolean);
    return v;
  };

  const payload = {
    from: from || getFrom(),
    to: normalize(to),
    subject,
    html: html || undefined,
    text: text || undefined,
    reply_to: replyTo || process.env.EMAIL_REPLY_TO || undefined,
    cc: normalize(cc),
    bcc: normalize(bcc),
    headers: headers || undefined,
  };

  try {
    const res = await getClient().emails.send(payload);
    if (res?.error) {
      // Resend returns { data, error } even on 2xx for some soft
      // failures. Surface it the same way as a thrown error so callers
      // have one code path.
      const err = new Error(
        res.error?.message || "Resend returned an error."
      );
      err.provider = "resend";
      err.detail = res.error;
      throw err;
    }
    return res?.data || { id: null };
  } catch (err) {
    // Network failures, invalid keys, rate limits. Log and rethrow so
    // callers that want to handle failure can. Callers that don't
    // (fire-and-forget emails) just catch and move on.
    console.error("❌ Resend send failed:", err.message);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Fire-and-forget wrapper.
// Useful for invite emails that shouldn't block a request. Swallows
// errors and logs them. Returns null on failure.
// ─────────────────────────────────────────────────────────────────────
export async function sendEmailSafe(args) {
  try {
    return await sendEmail(args);
  } catch (err) {
    console.warn("⚠️ sendEmailSafe swallowed:", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Optional helper if you want a "test the config" endpoint.
// ─────────────────────────────────────────────────────────────────────
export async function verifyEmailConfig() {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, reason: "RESEND_API_KEY is not set." };
  const from = getFrom();
  if (!from || !/@/.test(from)) {
    return { ok: false, reason: "EMAIL_FROM is not set or invalid." };
  }
  return { ok: true, from };
}

export default { sendEmail, sendEmailSafe, verifyEmailConfig };