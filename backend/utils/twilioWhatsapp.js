// utils/twilioWhatsApp.js
//
// Twilio WhatsApp helpers for Xamut.
//
// All users share the master Twilio account. Each user's WhatsApp
// number is registered as a Sender under the master account via
// Meta Embedded Signup — no subaccounts involved. This sidesteps
// Twilio's subaccount cap (which trial accounts hit almost
// immediately) and is simpler: one account, many senders.
//
// Responsibilities:
//   • Master client factory
//   • Meta Embedded Signup exchange (code + wabaId + phoneNumberId → sender)
//   • Phone number normalisation (E.164, "whatsapp:" prefix handling)
//   • Webhook signature verification
//   • Content (template) listing
//   • sendWhatsAppMessage() — single place every outbound send goes through
//
// Env vars used here:
//   TWILIO_ACCOUNT_SID            master account SID
//   TWILIO_AUTH_TOKEN             master auth token
//   TWILIO_WEBHOOK_BASE_URL       public https URL, for signature verification
//
// Nothing else in this file reaches into Mongo or Express — it's pure
// transport. The controller owns DB writes and HTTP response shaping.

import twilio from "twilio";

// ─────────────────────────────────────────────────────────────────────
// Config guard
// ─────────────────────────────────────────────────────────────────────
const hasMasterCreds = () =>
  Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);

const assertMasterCreds = () => {
  if (!hasMasterCreds()) {
    const err = new Error(
      "Twilio master credentials missing. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN."
    );
    err.statusCode = 500;
    throw err;
  }
};

// ─────────────────────────────────────────────────────────────────────
// Client
// ─────────────────────────────────────────────────────────────────────
export const masterClient = () => {
  assertMasterCreds();
  return twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
};

// ─────────────────────────────────────────────────────────────────────
// Phone number helpers
//
// Twilio speaks E.164 with a "whatsapp:" channel prefix on both sides.
// Our DB stores the bare E.164. These are the only two conversions we
// need, exposed as a matched pair so nothing drifts.
// ─────────────────────────────────────────────────────────────────────
export const sanitizePhone = (raw) => {
  const s = String(raw || "").trim();
  if (!s) return "";
  const hasPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  return hasPlus ? `+${digits}` : digits;
};

export const toWaAddress = (phone) => {
  const clean = sanitizePhone(phone);
  if (!clean) return "";
  return `whatsapp:${clean.startsWith("+") ? clean : "+" + clean}`;
};

export const stripWaPrefix = (addr) =>
  String(addr || "").replace(/^whatsapp:/i, "");

// ─────────────────────────────────────────────────────────────────────
// Sender lifecycle
// ─────────────────────────────────────────────────────────────────────

// Best-effort release of a WhatsApp sender from Twilio. Used when a
// user disconnects so the number can be re-registered elsewhere.
// Never throws — the caller logs and moves on.
export const releaseSender = async (senderSid) => {
  if (!senderSid) return { released: false, reason: "no-sid" };
  try {
    const auth = Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString("base64");

    const res = await fetch(
      `https://messaging.twilio.com/v2/Channels/Senders/${senderSid}`,
      {
        method: "DELETE",
        headers: { Authorization: `Basic ${auth}` },
      }
    );

    if (!res.ok && res.status !== 404) {
      const body = await res.text().catch(() => "");
      return {
        released: false,
        reason: `twilio-${res.status}`,
        detail: body.slice(0, 300),
      };
    }
    return { released: true };
  } catch (err) {
    return { released: false, reason: "network", detail: err.message };
  }
};

// ─────────────────────────────────────────────────────────────────────
// Meta Embedded Signup exchange
//
// Frontend hands us the code + wabaId + phoneNumberId. We POST them to
// Twilio's Senders API which does the OAuth dance with Meta on our
// behalf and attaches the WhatsApp sender to the MASTER account.
// senderSid on the resulting connection row is what tags a sender to
// a specific Xamut user — there's no subaccount boundary anymore.
//
// Returns a normalised object:
//   { senderSid, phoneNumber, displayName, qualityRating, messagingLimitTier, raw }
// Callers should treat every field except `raw` as best-effort.
// ─────────────────────────────────────────────────────────────────────
export const registerSenderFromEmbeddedSignup = async ({
  code,
  wabaId,
  phoneNumberId,
  businessId,
}) => {
  assertMasterCreds();

  if (!code || !wabaId || !phoneNumberId) {
    const err = new Error(
      "Missing embedded signup payload (code, wabaId, phoneNumberId)."
    );
    err.statusCode = 400;
    throw err;
  }

  const auth = Buffer.from(
    `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
  ).toString("base64");

  const params = new URLSearchParams({
    SignupPayload: JSON.stringify({
      code,
      wabaId,
      phoneNumberId,
      businessId: businessId || undefined,
    }),
    AccountSid: process.env.TWILIO_ACCOUNT_SID,
  });

  let json;
  let status;
  try {
    const res = await fetch("https://messaging.twilio.com/v2/Channels/Senders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    status = res.status;
    json = await res.json().catch(() => ({}));
  } catch (err) {
    const e = new Error(`Could not reach Twilio: ${err.message}`);
    e.statusCode = 502;
    throw e;
  }

  if (status < 200 || status >= 300) {
    const e = new Error(
      json?.message ||
        `Twilio rejected the sender registration (HTTP ${status}).`
    );
    e.statusCode = 502;
    e.twilio = json;
    throw e;
  }

  // Field names on Twilio's response vary across API versions — be
  // tolerant so the controller never has to care.
  const senderSid =
    json.sid || json.sender_sid || json.senderSid || null;
  const phoneNumber =
    json.phone_number || json.phoneNumber || json.sender_id || null;
  const displayName =
    json.profile_name || json.displayName || json.friendly_name || null;

  return {
    senderSid,
    phoneNumber: phoneNumber ? sanitizePhone(phoneNumber) : null,
    displayName,
    qualityRating: json.quality_rating || null,
    messagingLimitTier: json.messaging_limit_tier || null,
    raw: json,
  };
};

// ─────────────────────────────────────────────────────────────────────
// Webhook signature verification
//
// Twilio signs every inbound webhook request with HMAC-SHA1 over the
// full URL + sorted form params, using the account's auth token. If
// TWILIO_WEBHOOK_BASE_URL isn't set we treat this as dev and skip —
// fine locally, NOT fine in prod.
// ─────────────────────────────────────────────────────────────────────
export const verifyTwilioWebhook = (req) => {
  const base = process.env.TWILIO_WEBHOOK_BASE_URL;
  if (!base) return true;

  const signature = req.headers["x-twilio-signature"];
  if (!signature) return false;

  const url = `${base.replace(/\/$/, "")}${req.originalUrl}`;

  try {
    return twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      signature,
      url,
      req.body
    );
  } catch (err) {
    console.warn("⚠️ Twilio signature verification error:", err.message);
    return false;
  }
};

// ─────────────────────────────────────────────────────────────────────
// Content (WhatsApp template) listing
//
// Templates live on the Twilio Content API, on the master account.
// We expose just enough for the frontend to render a picker.
//
// NOTE: Content API templates aren't scoped per-sender in a way this
// endpoint filters — if you need per-user template isolation later,
// tag templates by naming convention or maintain your own mapping in
// Mongo. For now this returns everything visible on the account.
// ─────────────────────────────────────────────────────────────────────
export const listContentTemplates = async (limit = 200) => {
  const client = masterClient();
  const contents = await client.content.v1.contents.list({ limit });
  return contents.map((c) => ({
    sid: c.sid,
    friendlyName: c.friendlyName,
    language: c.language,
    types: c.types,
    dateCreated: c.dateCreated,
  }));
};

// ─────────────────────────────────────────────────────────────────────
// Sending
//
// One entry point for every outbound message. Returns the raw Twilio
// message object on success. Throws on failure with a normalised
// error whose `statusCode` the controller can pass through, and whose
// `isTwentyFourHourWindow` flag tells the caller whether the failure
// was the WhatsApp customer service window closing.
// ─────────────────────────────────────────────────────────────────────
export const sendWhatsAppMessage = async ({ from, to, body, mediaUrls, templateSid }) => {
  const client = masterClient();

  const payload = {
    from,
    to,
    body: body?.trim() || undefined,
  };

  if (Array.isArray(mediaUrls) && mediaUrls.length) {
    payload.mediaUrl = mediaUrls.slice(0, 10); // Twilio caps at 10
  }

  if (templateSid) {
    payload.contentSid = templateSid;
  }

  try {
    return await client.messages.create(payload);
  } catch (err) {
    const isTwentyFourHourWindow = /outside the 24 hour|24-hour/i.test(
      err.message || ""
    );
    const wrapped = new Error(
      isTwentyFourHourWindow
        ? "The 24-hour reply window has closed. Send an approved template instead."
        : err.message || "Twilio couldn't send the message."
    );
    wrapped.statusCode = err.status || 502;
    wrapped.twilioCode = err.code || null;
    wrapped.isTwentyFourHourWindow = isTwentyFourHourWindow;
    throw wrapped;
  }
};

// Re-export a small config surface so callers don't hit process.env
// directly for the bits that matter at runtime.
export const twilioConfig = {
  get hasMaster() {
    return hasMasterCreds();
  },
  get accountSid() {
    return process.env.TWILIO_ACCOUNT_SID || null;
  },
  get webhookBaseUrl() {
    return process.env.TWILIO_WEBHOOK_BASE_URL || null;
  },
};

export default {
  masterClient,
  sanitizePhone,
  toWaAddress,
  stripWaPrefix,
  releaseSender,
  registerSenderFromEmbeddedSignup,
  verifyTwilioWebhook,
  listContentTemplates,
  sendWhatsAppMessage,
  twilioConfig,
};