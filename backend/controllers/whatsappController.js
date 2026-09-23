// controllers/whatsappController.js
//
// WhatsApp messaging via Twilio, single-master-account architecture.
//
// Flow:
//   1. User signs up on Xamut.
//   2. /connect/start    → return Meta Embedded Signup config (no
//                          Twilio subaccount is created — everyone
//                          shares the master account).
//   3. Frontend opens Meta Embedded Signup with the config we return.
//   4. User completes the popup (links their WhatsApp Business number).
//   5. /connect/callback → hand Meta's code to Twilio; sender gets
//                          registered on the master account, and
//                          conn.senderSid is what ties it to this user.
//   6. From here, /messages/send sends via the master account
//      (from = this user's registered number), and Twilio's incoming
//      webhook lands at /webhook/incoming so we can route the reply
//      to the right user (by matching the To number) and store it.
//
// All Twilio / phone / signature logic lives in utils/twilioWhatsApp.js.
// This file owns DB writes and HTTP response shaping only.

import asyncHandler from "express-async-handler";
import mongoose from "mongoose";

import WhatsAppConnection from "../models/whatsappConnectionModel.js";
import WhatsAppConversation from "../models/whatsappConversationModel.js";
import WhatsAppMessage from "../models/whatsappMessageModel.js";

import {
  sanitizePhone,
  toWaAddress,
  stripWaPrefix,
  releaseSender,
  registerSenderFromEmbeddedSignup,
  verifyTwilioWebhook,
  listContentTemplates,
  sendWhatsAppMessage,
} from "../utils/metaWhatsapp.js";

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const httpError = (msg, statusCode = 400) => {
  const err = new Error(msg);
  err.statusCode = statusCode;
  return err;
};

// ─────────────────────────────────────────────────────────────────────
// CONNECTION — START
//
// POST /api/whatsapp/connect/start
//
// No Twilio subaccount is created here anymore — every user's sender
// lives on the master account. This just returns the config the
// frontend needs to open Meta's Embedded Signup popup. Idempotent —
// calling it when already connected just returns the current state.
// ─────────────────────────────────────────────────────────────────────
export const startConnect = asyncHandler(async (req, res) => {
  let conn = await WhatsAppConnection.findOne({ user: req.user._id });

  if (conn && conn.status === "connected" && conn.senderSid) {
    return res.status(200).json({
      success: true,
      alreadyConnected: true,
      connection: {
        phoneNumber: conn.phoneNumber,
        displayName: conn.displayName,
        status: conn.status,
        connectedAt: conn.connectedAt,
      },
    });
  }

  if (!conn) {
    conn = new WhatsAppConnection({ user: req.user._id });
  }
  conn.status = "pending_signup";
  await conn.save();

  res.status(200).json({
    success: true,
    alreadyConnected: false,
    config: {
      fbAppId: process.env.META_APP_ID,
      configId: process.env.META_WA_EMBEDDED_CONFIG_ID,
      graphApiVersion: process.env.META_GRAPH_VERSION || "v26.0",
      userEmail: req.user.email || "",
    },
  });
});

// ─────────────────────────────────────────────────────────────────────
// CONNECTION — CALLBACK
//
// POST /api/whatsapp/connect/callback
// Body: { code, wabaId, phoneNumberId, businessId?, displayName? }
// ─────────────────────────────────────────────────────────────────────
export const completeConnect = asyncHandler(async (req, res) => {
  const { code, wabaId, phoneNumberId, businessId, displayName } =
    req.body || {};

  if (!code || !wabaId || !phoneNumberId) {
    throw httpError(
      "Missing embedded signup payload (code, wabaId, phoneNumberId).",
      400
    );
  }

  let conn = await WhatsAppConnection.findOne({ user: req.user._id });
  if (!conn) {
    throw httpError("Call /connect/start before completing the popup.", 409);
  }

  let sender;
  try {
    sender = await registerSenderFromEmbeddedSignup({
      code,
      wabaId,
      phoneNumberId,
      businessId,
    });
  } catch (err) {
    console.error(
      "❌ Twilio sender registration failed:",
      err.message,
      err.twilio || ""
    );
    throw httpError(
      err.message || "Twilio couldn't register your WhatsApp number.",
      err.statusCode || 502
    );
  }

  conn.senderSid = sender.senderSid;
  conn.wabaId = wabaId;
  conn.phoneNumberId = phoneNumberId;
  conn.businessId = businessId || null;
  conn.phoneNumber = sender.phoneNumber || conn.phoneNumber;
  conn.displayName = displayName || sender.displayName || null;
  conn.qualityRating = sender.qualityRating;
  conn.messagingLimitTier = sender.messagingLimitTier;
  conn.status = "connected";
  conn.connectedAt = new Date();
  await conn.save();

  console.log(
    `✅ WhatsApp connected for ${req.user._id}: ${conn.phoneNumber} (${conn.senderSid})`
  );

  res.status(200).json({
    success: true,
    connection: {
      _id: conn._id,
      status: conn.status,
      phoneNumber: conn.phoneNumber,
      displayName: conn.displayName,
      wabaId: conn.wabaId,
      phoneNumberId: conn.phoneNumberId,
      senderSid: conn.senderSid,
      connectedAt: conn.connectedAt,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────
// CONNECTION — READ
// GET /api/whatsapp/connection
// ─────────────────────────────────────────────────────────────────────
export const getConnection = asyncHandler(async (req, res) => {
  const conn = await WhatsAppConnection.findOne({ user: req.user._id });
  if (!conn) {
    return res.status(200).json({ success: true, connection: null });
  }
  res.status(200).json({
    success: true,
    connection: {
      _id: conn._id,
      status: conn.status,
      phoneNumber: conn.phoneNumber,
      displayName: conn.displayName,
      wabaId: conn.wabaId,
      phoneNumberId: conn.phoneNumberId,
      senderSid: conn.senderSid,
      qualityRating: conn.qualityRating,
      messagingLimitTier: conn.messagingLimitTier,
      connectedAt: conn.connectedAt,
      createdAt: conn.createdAt,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────
// CONNECTION — DISCONNECT
// DELETE /api/whatsapp/connection
// ─────────────────────────────────────────────────────────────────────
export const disconnect = asyncHandler(async (req, res) => {
  const conn = await WhatsAppConnection.findOne({ user: req.user._id });
  if (!conn) {
    return res.status(200).json({ success: true, message: "Not connected." });
  }

  if (conn.senderSid) {
    const result = await releaseSender(conn.senderSid);
    if (!result.released && result.reason !== "no-sid") {
      console.warn(
        "⚠️ Twilio sender release failed:",
        result.reason,
        result.detail || ""
      );
    }
  }

  conn.status = "disconnected";
  conn.senderSid = null;
  conn.phoneNumber = null;
  conn.phoneNumberId = null;
  conn.wabaId = null;
  conn.disconnectedAt = new Date();
  await conn.save();

  res.status(200).json({ success: true, message: "Disconnected." });
});

// ─────────────────────────────────────────────────────────────────────
// MESSAGES — SEND
//
// POST /api/whatsapp/messages/send
// Body: { to, body, mediaUrls?[], templateSid? }
// ─────────────────────────────────────────────────────────────────────
export const sendMessage = asyncHandler(async (req, res) => {
  const { to, body, mediaUrls, templateSid } = req.body || {};

  const cleanTo = sanitizePhone(to);
  if (!cleanTo) throw httpError("Recipient phone number is required.", 400);
  if (!body?.trim() && !mediaUrls?.length && !templateSid) {
    throw httpError("Provide a message body, media, or a template.", 400);
  }

  const conn = await WhatsAppConnection.findOne({ user: req.user._id });
  if (!conn || conn.status !== "connected" || !conn.phoneNumber) {
    throw httpError("Connect your WhatsApp number before sending messages.", 409);
  }

  const from = toWaAddress(conn.phoneNumber);

  // Ensure we have a conversation row (for the thread + unread counts).
  let conversation = await WhatsAppConversation.findOne({
    user: req.user._id,
    contactPhone: cleanTo,
  });
  if (!conversation) {
    conversation = await WhatsAppConversation.create({
      user: req.user._id,
      contactPhone: cleanTo,
      contactName: "",
      lastMessageAt: new Date(),
      lastMessagePreview: "",
      unreadCount: 0,
    });
  }

  let twilioMessage;
  try {
    twilioMessage = await sendWhatsAppMessage({
      from,
      to: toWaAddress(cleanTo),
      body,
      mediaUrls,
      templateSid,
    });
  } catch (err) {
    // Persist the failed attempt so the UI can show it.
    await WhatsAppMessage.create({
      user: req.user._id,
      conversation: conversation._id,
      direction: "out",
      from: stripWaPrefix(from),
      to: cleanTo,
      body: body?.trim() || "",
      mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : [],
      status: "failed",
      errorCode: String(err.twilioCode || ""),
      errorMessage: err.message || "",
      templateSid: templateSid || null,
      numMedia: Array.isArray(mediaUrls) ? mediaUrls.length : 0,
    });

    throw httpError(err.message, err.statusCode || 502);
  }

  const saved = await WhatsAppMessage.create({
    user: req.user._id,
    conversation: conversation._id,
    direction: "out",
    from: stripWaPrefix(from),
    to: cleanTo,
    body: body?.trim() || "",
    mediaUrls: Array.isArray(mediaUrls) ? mediaUrls : [],
    twilioSid: twilioMessage.sid,
    status: twilioMessage.status || "sent",
    templateSid: templateSid || null,
    numMedia: Array.isArray(mediaUrls) ? mediaUrls.length : 0,
  });

  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview =
    (body || "").slice(0, 120) || (mediaUrls?.length ? "[media]" : "");
  await conversation.save();

  conn.lastOutboundAt = new Date();
  await conn.save();

  res.status(201).json({
    success: true,
    message: {
      _id: saved._id,
      direction: saved.direction,
      body: saved.body,
      mediaUrls: saved.mediaUrls,
      status: saved.status,
      twilioSid: saved.twilioSid,
      createdAt: saved.createdAt,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────
// CONVERSATIONS — LIST
// GET /api/whatsapp/conversations?page=1&limit=50
// ─────────────────────────────────────────────────────────────────────
export const listConversations = asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  const filter = { user: req.user._id, isArchived: false };

  const [items, total] = await Promise.all([
    WhatsAppConversation.find(filter)
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    WhatsAppConversation.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    conversations: items,
  });
});

// ─────────────────────────────────────────────────────────────────────
// CONVERSATIONS — MESSAGES
// GET /api/whatsapp/conversations/:id/messages?page=1&limit=100
// ─────────────────────────────────────────────────────────────────────
export const listConversationMessages = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) throw httpError("Invalid conversation id.", 400);

  const conversation = await WhatsAppConversation.findOne({
    _id: id,
    user: req.user._id,
  });
  if (!conversation) throw httpError("Conversation not found.", 404);

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 100));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    WhatsAppMessage.find({ conversation: conversation._id })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    WhatsAppMessage.countDocuments({ conversation: conversation._id }),
  ]);

  if (conversation.unreadCount > 0) {
    conversation.unreadCount = 0;
    await conversation.save();
  }

  res.status(200).json({
    success: true,
    conversation,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    messages: items,
  });
});

// ─────────────────────────────────────────────────────────────────────
// WEBHOOK — INCOMING MESSAGE
//
// POST /api/whatsapp/webhook/incoming
//
// Must respond 200 fast — Twilio retries on 5xx.
// ─────────────────────────────────────────────────────────────────────
export const webhookIncoming = asyncHandler(async (req, res) => {
  if (!verifyTwilioWebhook(req)) {
    console.warn("⚠️ WhatsApp webhook signature verification failed");
    return res.status(403).send("Forbidden");
  }

  const body = req.body || {};
  const fromRaw = stripWaPrefix(body.From);
  const toRaw = stripWaPrefix(body.To);
  const profileName = body.ProfileName || "";
  const text = body.Body || "";
  const numMedia = Number(body.NumMedia || 0);
  const twilioSid = body.MessageSid || body.SmsMessageSid || "";

  if (!toRaw) return res.status(200).send("");

  const conn = await WhatsAppConnection.findOne({
    phoneNumber: sanitizePhone(toRaw),
    status: "connected",
  });

  if (!conn) {
    console.warn(`⚠️ Webhook for unknown number: ${toRaw}`);
    return res.status(200).send("");
  }

  const mediaUrls = [];
  for (let i = 0; i < numMedia; i++) {
    const u = body[`MediaUrl${i}`];
    if (u) mediaUrls.push(u);
  }

  let conversation = await WhatsAppConversation.findOne({
    user: conn.user,
    contactPhone: sanitizePhone(fromRaw),
  });

  if (!conversation) {
    conversation = await WhatsAppConversation.create({
      user: conn.user,
      contactPhone: sanitizePhone(fromRaw),
      contactName: profileName || "",
      lastMessageAt: new Date(),
      lastMessagePreview: text.slice(0, 120) || (mediaUrls.length ? "[media]" : ""),
      unreadCount: 0,
    });
  } else {
    if (profileName && !conversation.contactName) {
      conversation.contactName = profileName;
    }
    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview =
      text.slice(0, 120) || (mediaUrls.length ? "[media]" : "");
  }
  conversation.unreadCount = (conversation.unreadCount || 0) + 1;
  await conversation.save();

  await WhatsAppMessage.create({
    user: conn.user,
    conversation: conversation._id,
    direction: "in",
    from: sanitizePhone(fromRaw),
    to: sanitizePhone(toRaw),
    body: text,
    mediaUrls,
    twilioSid,
    status: "received",
    numMedia,
  });

  conn.lastInboundAt = new Date();
  await conn.save();

  res.status(200).send("");
});

// ─────────────────────────────────────────────────────────────────────
// WEBHOOK — STATUS CALLBACK
// POST /api/whatsapp/webhook/status
// ─────────────────────────────────────────────────────────────────────
export const webhookStatus = asyncHandler(async (req, res) => {
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
  if (errorMessage) update.errorMessage = errorMessage;

  await WhatsAppMessage.updateOne({ twilioSid }, { $set: update });

  res.status(200).send("");
});

// ─────────────────────────────────────────────────────────────────────
// TEMPLATES — LIST
// GET /api/whatsapp/templates
// ─────────────────────────────────────────────────────────────────────
export const listTemplates = asyncHandler(async (req, res) => {
  const conn = await WhatsAppConnection.findOne({ user: req.user._id });
  if (!conn || conn.status !== "connected") {
    throw httpError("Connect your WhatsApp number first.", 409);
  }

  try {
    const templates = await listContentTemplates();
    res.status(200).json({ success: true, templates });
  } catch (err) {
    console.error("❌ Template list failed:", err.message);
    throw httpError("Couldn't load templates from Twilio.", 502);
  }
});

// ─────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────
export default {
  startConnect,
  completeConnect,
  getConnection,
  disconnect,
  sendMessage,
  listConversations,
  listConversationMessages,
  webhookIncoming,
  webhookStatus,
  listTemplates,
};