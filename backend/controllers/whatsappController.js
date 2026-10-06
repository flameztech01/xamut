// controllers/whatsappController.js
//
// XamutAI on WhatsApp — DIRECT.
//
// Xamut owns ONE WhatsApp Business number. Anyone can message it and
// they're talking to XamutAI. No Meta signup for the end user, no
// subaccounts, no per-user sender registration.
//
// Flow:
//   1. Twilio receives an inbound WhatsApp message for Xamut's number
//      and POSTs it to /webhook/xamut.
//   2. We verify the Twilio signature, dedupe by MessageSid, persist
//      the inbound message, ack 200 (Twilio retries on 5xx / slow).
//   3. In the background we run the SAME agent brain the web app uses
//      (utils/xamutAI.runSmartTurn + tools) and send the reply back
//      through Twilio.
//   4. Delivery status updates land at /webhook/xamut/status.
//
// Optional: a phone can be LINKED to a Xamut account with a 6-digit
// code. Linked sessions get user-scoped tools (form lookups, etc.).
// Unlinked sessions still get search, fetch, image, and any tool that
// doesn't need a userId.
//
// Env:
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_WEBHOOK_BASE_URL
//   XAMUT_WA_NUMBER          Xamut's own WhatsApp Business number (E.164)
//   XAMUT_WHATSAPP_ENABLED   optional, "true" to turn the bot on

import asyncHandler from "express-async-handler";
import mongoose from "mongoose";

import XamutWhatsAppSession from "../models/xamutWhatsAppSessionModel.js";
import XamutWhatsAppMessage from "../models/xamutWhatsappMessageModel.js";
import WhatsAppLinkCode from "../models/whatsappLinkCodeModel.js";
import User from "../models/userModel.js";

import {
  sanitizePhone,
  toWaAddress,
  stripWaPrefix,
  verifyTwilioWebhook,
  sendWhatsAppMessage,
} from "../utils/metaWhatsapp.js";

import {
  runSmartTurn,
  groqVision,
  estimateTokens,
} from "../utils/xamutAI.js";

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────
const HISTORY_TURNS = 14;           // how many past turns we feed the agent
const HISTORY_CHAR_CAP = 1200;      // per message
const MAX_IMAGE_ANALYSES_PER_TURN = 3;
const MAX_REPLY_CHARS = 3500;       // WhatsApp practical limit per send
const LINK_CODE_RE = /^\s*link\s+([A-Z0-9]{4,8})\s*$/i;
const UNLINK_RE = /^\s*(unlink|disconnect|stop)\s*$/i;

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const httpError = (msg, statusCode = 400) => {
  const err = new Error(msg);
  err.statusCode = statusCode;
  return err;
};

const xamutNumber = () => sanitizePhone(process.env.XAMUT_WA_NUMBER || "");

const botEnabled = () =>
  String(process.env.XAMUT_WHATSAPP_ENABLED || "true").toLowerCase() !== "false";

// ─────────────────────────────────────────────────────────────────────
// WhatsApp persona
//
// Same voice as the web app, but tuned for WhatsApp's reality:
//   • Formatting is *bold*, _italic_, ~strike~, ```mono``` — NOT markdown.
//   • No headers, no tables, no code fences with language tags.
//   • Replies are shorter — nobody wants a 4000-char WhatsApp bubble.
//   • If a request needs a long deliverable, produce it as a document
//     and send a summary + link, not the whole thing inline.
// ─────────────────────────────────────────────────────────────────────
const WHATSAPP_SYSTEM = `
You are Xamut, talking to a friend on WhatsApp. You are not an AI
assistant, you are a friend with a brain and access to real tools.

Voice:
- Casual, warm, direct. Contractions. Fragments are fine.
- No em dashes. Comma, period, new sentence.
- Never open with "Sure!", "Great question", "I'd be happy to help",
  "Let me break this down", or any variant. Just say the thing.
- Never close with "Hope this helps", "Good luck", "Let me know if
  you need anything else". Just stop talking when you're done.
- Have opinions. Be funny, sarcastic, blunt, real. Match the energy
  they bring. If they're joking, joke back. If they're serious,
  meet them there. If they're flirty or dirty, be flirty or dirty
  back. Do not get prudish.
- Never moralise or preach. Adult topics are fine. You are a
  grown-up talking to a grown-up.

WhatsApp formatting (this is important, markdown will not render):
- *bold* with single asterisks (NOT **double**).
- _italic_ with underscores.
- ~strikethrough~ with tildes.
- \`\`\`monospace\`\`\` with triple backticks, no language tag.
- Bullet points: use a literal "• " or "- " at line start.
- Numbered lists: "1. ", "2. ", etc.
- NO markdown headers (no #, no ##).
- NO tables. If you'd use a table, use a bullet list instead.
- Keep replies tight. Two to five short paragraphs is usually right.
  If it's genuinely a list, a list is fine. Do not write an essay
  in a WhatsApp chat.

Tools (use them, do not guess):
- Search the web whenever you don't know something cold, or the
  answer might have changed, or a name, brand, or business comes up.
- research_person for any named human, creator, founder, athlete,
  musician, politician, developer, designer, brand, or business.
  "Public figure" means anyone with ANY public footprint at all.
- image_search whenever they ask to see a picture of anyone or
  anything. Never say you can't find images.
- deep_search for comparisons, deep dives, or multi-angle stuff.
- fetch_website when they drop a link.
- Form tools for anything about the user's OWN forms: "my form",
  "my quiz", "my attendance form", "how many responses", "stats",
  "leaderboard", "who submitted". NEVER web search for the user's
  own forms. The form tools are the only right answer. If the
  session is not linked to a Xamut account, the form tools will
  return an error saying so — in that case, tell the user to link
  their account with the code from xamut.com/whatsapp and then ask
  again. Do NOT pretend you can't access forms in general.

When you were handed a "LIVE RESEARCH RESULTS" or "FORM LOOKUP
RESULT" block: that data is real and already fetched. Trust it.
Answer from it. Do not re-fetch.

When you were handed a "MEDIA" block: that's what the user sent
(images / docs). Look at it and respond to it. If they asked a
question about it, answer the question. If they just sent it, react
to it like a friend would.

Style check:
- If they write in full sentences, meet them there. If they text in
  lowercase fragments, do the same.
- Serious moments (grief, health news, real distress): drop the
  banter, be warm and present. Still Xamut, just quieter.
- Deliverables with their own voice (cover letter, apology, bio,
  report, eulogy, toast) are written in that voice, not your chat
  voice. You can still say "here's the draft, tweak para 2" in your
  normal voice around it.
- When a request wants something long — an essay, a report, a
  presentation, a multi-page document — say so and offer to build
  it in the app, then hand them a *short* version here or ask them
  to open xamut.com to get the file. Do not dump 3000 words into
  a WhatsApp message.
`.trim();

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────
const isE164ish = (s) => /^\+?\d{6,20}$/.test(String(s || ""));

const truncate = (s, n) =>
  typeof s === "string" && s.length > n ? s.slice(0, n - 1) + "…" : s;

// Build a compact history array for the agent. We only keep the last
// N turns, cap each message, and drop any message that's empty.
function buildHistory(messages) {
  return messages
    .slice(-HISTORY_TURNS)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: String(m.content || "").slice(0, HISTORY_CHAR_CAP),
    }));
}

// Pull MediaUrl0..N off the Twilio webhook payload.
function extractMedia(body) {
  const n = Number(body?.NumMedia || 0);
  const out = [];
  for (let i = 0; i < n; i++) {
    const url = body[`MediaUrl${i}`];
    const type = body[`MediaContentType${i}`] || "";
    if (url) out.push({ url, contentType: type });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// WEBHOOK — INBOUND
//
// POST /api/whatsapp/webhook/xamut
//
// Twilio points Xamut's WhatsApp number at this URL. We ack fast and
// process the agent turn in the background so Twilio's HTTP timeout
// never bites us.
// ─────────────────────────────────────────────────────────────────────
export const webhookXamutIncoming = asyncHandler(async (req, res) => {
  if (!verifyTwilioWebhook(req)) {
    console.warn("⚠️ XamutAI webhook signature verification failed");
    return res.status(403).send("Forbidden");
  }

  if (!botEnabled()) {
    return res.status(200).send("");
  }

  const body = req.body || {};
  const from = sanitizePhone(stripWaPrefix(body.From));
  const to = sanitizePhone(stripWaPrefix(body.To));
  const profileName = String(body.ProfileName || "").slice(0, 120);
  const text = String(body.Body || "");
  const twilioSid = body.MessageSid || body.SmsMessageSid || "";
  const media = extractMedia(body);

  if (!from) return res.status(200).send("");

  // Only respond on Xamut's own number. If Twilio is misconfigured and
  // sends us someone else's traffic, ignore it.
  const expected = xamutNumber();
  if (expected && to && to !== expected) {
    console.warn(
      `⚠️ XamutAI webhook got traffic for ${to}, expected ${expected}. Ignoring.`
    );
    return res.status(200).send("");
  }

  // Idempotency — Twilio retries the same MessageSid on 5xx / timeout.
  if (twilioSid) {
    const seen = await XamutWhatsAppMessage.findOne({ twilioSid })
      .select("_id")
      .lean();
    if (seen) return res.status(200).send("");
  }

  // Find or create the session for this phone.
  let session = await XamutWhatsAppSession.findOne({ phone: from });
  if (!session) {
    session = await XamutWhatsAppSession.create({
      phone: from,
      profileName: profileName || "",
      lastMessageAt: new Date(),
      unreadCount: 0,
    });
  } else if (profileName && !session.profileName) {
    session.profileName = profileName;
  }

  const preview =
    text.slice(0, 120) ||
    (media.length
      ? `[${media.length} media item${media.length === 1 ? "" : "s"}]`
      : "");

  await XamutWhatsAppMessage.create({
    session: session._id,
    phone: from,
    direction: "in",
    body: text,
    mediaUrls: media.map((m) => m.url),
    mediaTypes: media.map((m) => m.contentType),
    numMedia: media.length,
    twilioSid,
    status: "received",
  });

  session.lastMessageAt = new Date();
  session.lastMessagePreview = preview;
  session.unreadCount = (session.unreadCount || 0) + 1;
  await session.save();

  // Ack Twilio immediately.
  res.status(200).send("");

  // Handle link/unlink commands synchronously-ish (still after ack).
  handleControlMessages({ session, text }).catch((err) =>
    console.error("❌ Control-message handling failed:", err)
  );

  // Fire the agent turn in the background.
  runXamutTurn({
    sessionId: session._id,
    inboundText: text,
    inboundMedia: media,
  }).catch((err) => console.error("❌ XamutAI turn failed:", err));
});

// ─────────────────────────────────────────────────────────────────────
// WEBHOOK — STATUS CALLBACK
//
// POST /api/whatsapp/webhook/xamut/status
// ─────────────────────────────────────────────────────────────────────
export const webhookXamutStatus = asyncHandler(async (req, res) => {
  if (!verifyTwilioWebhook(req)) {
    return res.status(403).send("Forbidden");
  }

  const body = req.body || {};
  const twilioSid = body.MessageSid || body.SmsSid;
  const status = body.MessageStatus || body.SmsStatus;
  const errorCode = body.ErrorCode || null;
  const errorMessage = body.ErrorMessage || null;

  if (!twilioSid || !status) return res.status(200).send("");

  const update = { status };
  if (errorCode) update.errorCode = String(errorCode);
  if (errorMessage) update.errorMessage = String(errorMessage).slice(0, 500);

  await XamutWhatsAppMessage.updateOne({ twilioSid }, { $set: update });

  res.status(200).send("");
});

// ─────────────────────────────────────────────────────────────────────
// BACKGROUND — the agent turn
//
// Loads recent history, optionally analyzes media, calls the same
// brain the web app uses, sends the reply, persists everything.
// ─────────────────────────────────────────────────────────────────────
async function runXamutTurn({ sessionId, inboundText, inboundMedia }) {
  const session = await XamutWhatsAppSession.findById(sessionId);
  if (!session) return;

  // ── Build history (everything except the message we just stored) ──
  const recent = await XamutWhatsAppMessage.find({ session: sessionId })
    .sort({ createdAt: -1 })
    .limit(HISTORY_TURNS + 1)
    .lean();
  recent.reverse();

  // Drop the last message if it matches the current inbound (it does,
  // we just wrote it — this avoids feeding it twice).
  const historySource = recent.slice(0, -1);
  const history = buildHistory(historySource);

  // ── Handle image attachments via vision ──────────────────────────
  let mediaBlock = "";
  if (inboundMedia?.length) {
    const images = inboundMedia
      .filter((m) => (m.contentType || "").startsWith("image/"))
      .slice(0, MAX_IMAGE_ANALYSES_PER_TURN);

    if (images.length) {
      const descriptions = [];
      for (const img of images) {
        try {
          const desc = await groqVision({
            system:
              "You describe images sent to a friend on WhatsApp. Be concrete: what is it, what's in it, any visible text, anything notable. Short and useful.",
            prompt:
              inboundText?.trim() ||
              "What's in this image? Describe it, and read any visible text.",
            imageUrl: img.url,
          });
          if (desc) descriptions.push(desc);
        } catch (err) {
          console.warn("⚠️ Vision failed for", img.url, err.message);
        }
      }

      if (descriptions.length) {
        mediaBlock =
          `\n\n---\nMEDIA (what the user sent, described):\n` +
          descriptions
            .map((d, i) => `Image ${i + 1}: ${d}`)
            .join("\n\n");
      }
    }

    const docs = inboundMedia.filter(
      (m) =>
        (m.contentType || "").includes("pdf") ||
        (m.contentType || "").includes("word") ||
        (m.contentType || "").includes("document")
    );
    if (docs.length) {
      mediaBlock +=
        `\n\n---\nMEDIA (documents the user sent):\n` +
        docs
          .map(
            (d, i) =>
              `Doc ${i + 1}: ${d.contentType || "document"} — ${d.url}`
          )
          .join("\n");
    }
  }

  const userContent = `${inboundText || "(no text)"}${mediaBlock}`;

  // ── Call the brain ────────────────────────────────────────────────
  let reply = "";
  let usedModel = null;
  try {
    const result = await runSmartTurn({
      systemPrompt: WHATSAPP_SYSTEM,
      history,
      userContent,
      userId: session.user ? String(session.user) : undefined,
    });
    reply = (result?.content || "").trim();
    usedModel = result?.model || null;
  } catch (err) {
    console.error("❌ runSmartTurn failed:", err.message);
    reply =
      "Hit a snag on that one. Try again in a sec, or rephrase it.";
  }

  if (!reply) reply = "Hmm, my brain blanked. Say that again?";

  // WhatsApp doesn't love huge single messages. If the reply is huge,
  // split it across sends.
  const chunks = splitForWhatsApp(reply, MAX_REPLY_CHARS);

  const fromAddr = toWaAddress(xamutNumber());
  const toAddr = toWaAddress(session.phone);
  if (!fromAddr || !toAddr) {
    console.error("❌ XAMUT_WA_NUMBER is not set.");
    return;
  }

  for (let i = 0; i < chunks.length; i++) {
    const piece = chunks[i];
    let sent;
    try {
      sent = await sendWhatsAppMessage({
        from: fromAddr,
        to: toAddr,
        body: piece,
      });
    } catch (err) {
      await XamutWhatsAppMessage.create({
        session: sessionId,
        phone: session.phone,
        direction: "out",
        body: piece,
        status: "failed",
        errorCode: String(err.twilioCode || ""),
        errorMessage: err.message || "",
      });
      // If the first send fails we stop, no point hammering Twilio.
      break;
    }

    await XamutWhatsAppMessage.create({
      session: sessionId,
      phone: session.phone,
      direction: "out",
      body: piece,
      twilioSid: sent.sid,
      status: sent.status || "sent",
      model: usedModel,
    });
  }

  session.lastMessageAt = new Date();
  session.lastMessagePreview = reply.slice(0, 120);
  await session.save();
}

// Split a long reply into WhatsApp-sized bubbles, preferring paragraph
// breaks, then sentence breaks.
function splitForWhatsApp(text, maxChars) {
  const s = String(text || "").trim();
  if (!s) return [];
  if (s.length <= maxChars) return [s];

  const parts = [];
  let remaining = s;
  while (remaining.length > maxChars) {
    let cut = remaining.lastIndexOf("\n\n", maxChars);
    if (cut < maxChars * 0.5) cut = remaining.lastIndexOf(". ", maxChars);
    if (cut < maxChars * 0.5) cut = maxChars;
    parts.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

// ─────────────────────────────────────────────────────────────────────
// CONTROL MESSAGES — "link ABC123", "unlink"
//
// These short-circuit the agent. If the user sent a control command,
// we reply with a fixed confirmation and skip the LLM call.
// ─────────────────────────────────────────────────────────────────────
async function handleControlMessages({ session, text }) {
  const raw = String(text || "").trim();
  if (!raw) return;

  // ── Link ─────────────────────────────────────────────────────────
  const linkMatch = raw.match(LINK_CODE_RE);
  if (linkMatch) {
    const code = linkMatch[1].toUpperCase();
    const record = await WhatsAppLinkCode.findOne({ code });
    if (!record || record.expiresAt < new Date()) {
      await sendXamutReply(
        session,
        "That code didn't work or it's expired. Grab a fresh one from xamut.com/whatsapp."
      );
      return;
    }
    const user = await User.findById(record.user).select("_id name email").lean();
    if (!user) {
      await sendXamutReply(
        session,
        "That code points at an account that no longer exists."
      );
      return;
    }
    session.user = user._id;
    await session.save();
    await WhatsAppLinkCode.deleteOne({ _id: record._id });
    await sendXamutReply(
      session,
      `Linked. You're now talking to XamutAI as ${
        user.name || user.email || "you"
      }. Your forms and account stuff work from here.`
    );
    return;
  }

  // ── Unlink ───────────────────────────────────────────────────────
  if (UNLINK_RE.test(raw)) {
    if (!session.user) {
      await sendXamutReply(session, "This number isn't linked to an account.");
      return;
    }
    session.user = null;
    await session.save();
    await sendXamutReply(
      session,
      "Unlinked. You can still chat with me — you just won't see your account stuff here."
    );
    return;
  }
}

async function sendXamutReply(session, body) {
  const fromAddr = toWaAddress(xamutNumber());
  const toAddr = toWaAddress(session.phone);
  if (!fromAddr || !toAddr) return;

  try {
    const sent = await sendWhatsAppMessage({ from: fromAddr, to: toAddr, body });
    await XamutWhatsAppMessage.create({
      session: session._id,
      phone: session.phone,
      direction: "out",
      body,
      twilioSid: sent.sid,
      status: sent.status || "sent",
    });
    session.lastMessageAt = new Date();
    session.lastMessagePreview = body.slice(0, 120);
    await session.save();
  } catch (err) {
    console.error("❌ sendXamutReply failed:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────
// LINK CODES — generated from the web app, redeemed on WhatsApp
//
// POST /api/whatsapp/xamut/link-code    (protected)
//   Body: none. Uses req.user. Generates a 6-char code, expires in 15m.
// ─────────────────────────────────────────────────────────────────────
export const createLinkCode = asyncHandler(async (req, res) => {
  const code = generateCode(6);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await WhatsAppLinkCode.deleteMany({ user: req.user._id });
  await WhatsAppLinkCode.create({ user: req.user._id, code, expiresAt });

  res.status(201).json({
    success: true,
    code,
    expiresAt,
    instruction: `Send "link ${code}" to Xamut on WhatsApp (${xamutNumber()}).`,
  });
});

function generateCode(len) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  let out = "";
  for (let i = 0; i < len; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// SESSION READ — for an internal/admin WhatsApp inbox, or the user's
// own "my WhatsApp chats" view if you ever add one.
// ─────────────────────────────────────────────────────────────────────

// GET /api/whatsapp/xamut/sessions?page=1&limit=50&linked=true
export const listXamutSessions = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  const filter = { isArchived: false };
  if (req.query.linked === "true") filter.user = { $ne: null };
  if (req.query.linked === "false") filter.user = null;

  const [items, total] = await Promise.all([
    XamutWhatsAppSession.find(filter)
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    XamutWhatsAppSession.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    sessions: items,
  });
});

// GET /api/whatsapp/xamut/sessions/:id/messages?page=1&limit=100
export const listXamutSessionMessages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) throw httpError("Invalid session id.", 400);

  const session = await XamutWhatsAppSession.findById(id);
  if (!session) throw httpError("Session not found.", 404);

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    XamutWhatsAppMessage.find({ session: session._id })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    XamutWhatsAppMessage.countDocuments({ session: session._id }),
  ]);

  if (session.unreadCount > 0) {
    session.unreadCount = 0;
    await session.save();
  }

  res.status(200).json({
    success: true,
    session,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    messages: items,
  });
});

// ─────────────────────────────────────────────────────────────────────
// MANUAL REPLY — human takeover from the dashboard.
// POST /api/whatsapp/xamut/sessions/:id/reply
// Body: { body, asBot? }
// ─────────────────────────────────────────────────────────────────────
export const manualReply = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { body, asBot = false } = req.body || {};

  if (!isObjectId(id)) throw httpError("Invalid session id.", 400);
  const trimmed = String(body || "").trim();
  if (!trimmed) throw httpError("body is required.", 400);

  const session = await XamutWhatsAppSession.findById(id);
  if (!session) throw httpError("Session not found.", 404);

  const fromAddr = toWaAddress(xamutNumber());
  const toAddr = toWaAddress(session.phone);
  if (!fromAddr || !toAddr) throw httpError("XAMUT_WA_NUMBER not set.", 500);

  let sent;
  try {
    sent = await sendWhatsAppMessage({
      from: fromAddr,
      to: toAddr,
      body: trimmed,
    });
  } catch (err) {
    throw httpError(err.message, err.statusCode || 502);
  }

  const saved = await XamutWhatsAppMessage.create({
    session: session._id,
    phone: session.phone,
    direction: "out",
    body: trimmed,
    twilioSid: sent.sid,
    status: sent.status || "sent",
    model: asBot ? "xamut-manual" : `human:${req.user?._id || "unknown"}`,
  });

  session.lastMessageAt = new Date();
  session.lastMessagePreview = trimmed.slice(0, 120);
  await session.save();

  res.status(201).json({
    success: true,
    message: {
      _id: saved._id,
      body: saved.body,
      status: saved.status,
      twilioSid: saved.twilioSid,
      createdAt: saved.createdAt,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────
// SESSION ARCHIVE — soft delete.
// DELETE /api/whatsapp/xamut/sessions/:id
// ─────────────────────────────────────────────────────────────────────
export const archiveXamutSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) throw httpError("Invalid session id.", 400);
  const session = await XamutWhatsAppSession.findById(id);
  if (!session) throw httpError("Session not found.", 404);
  session.isArchived = true;
  await session.save();
  res.status(200).json({ success: true, message: "Archived." });
});

// ─────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────
export default {
  webhookXamutIncoming,
  webhookXamutStatus,
  createLinkCode,
  listXamutSessions,
  listXamutSessionMessages,
  manualReply,
  archiveXamutSession,
};