// routes/whatsappRoutes.js
//
// Route map for the Twilio WhatsApp ISV feature.
//
// Two layers:
//   1. Public webhooks — Twilio POSTs form-urlencoded bodies here with
//      no Xamut auth. Signature is verified inside the controller.
//   2. Everything else — gated on the standard `protect` middleware.
//
// Ordering matters: webhooks MUST be registered before `router.use(protect)`
// or Twilio will get a 401 and retry forever.

import express from "express";
import { protect } from "../middleware/authMiddleware.js";
import {
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
} from "../controllers/whatsappController.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Twilio body parser
//
// Twilio posts `application/x-www-form-urlencoded`, not JSON, so
// `express.json()` won't touch it. We attach a scoped urlencoded
// parser to the webhook routes only — keeps the rest of the app
// free of urlencoded parsing if you don't need it globally.
//
// If you already have a global `express.urlencoded()` in server.js,
// this is redundant but harmless: express skips re-parsing when
// `req._body` is already set.
// ─────────────────────────────────────────────────────────────
const twilioWebhookParser = express.urlencoded({
  extended: false,
  limit: "1mb",
});

// ─────────────────────────────────────────────────────────────
// PUBLIC — Twilio webhooks
//
// No Xamut auth. The controller verifies the Twilio HMAC signature
// (X-Twilio-Signature) before trusting the payload. If
// TWILIO_WEBHOOK_BASE_URL isn't set, verification is skipped — fine
// for local dev, NOT fine for prod.
//
// These endpoints must respond fast (Twilio retries on 5xx), so the
// controllers do the minimum work needed and ack with an empty 200.
// ─────────────────────────────────────────────────────────────
router.post("/webhook/incoming", twilioWebhookParser, webhookIncoming);
router.post("/webhook/status", twilioWebhookParser, webhookStatus);

// ─────────────────────────────────────────────────────────────
// Everything below requires Xamut auth.
// ─────────────────────────────────────────────────────────────
router.use(protect);

// ── Connection lifecycle ─────────────────────────────────────
// Create the user's Twilio subaccount + return the Meta Embedded
// Signup config so the frontend can open the popup.
router.post("/connect/start", startConnect);

// Frontend posts Meta's Embedded Signup payload back here; we hand
// it to Twilio, which attaches the WhatsApp sender to the subaccount.
router.post("/connect/callback", completeConnect);

// Current status of the caller's connection.
router.get("/connection", getConnection);

// Release the sender + clear the row.
router.delete("/connection", disconnect);

// ── Sending ──────────────────────────────────────────────────
// Send a text, media, or template message through the user's
// subaccount.
router.post("/messages/send", sendMessage);

// ── Inbox ────────────────────────────────────────────────────
router.get("/conversations", listConversations);
router.get("/conversations/:id/messages", listConversationMessages);

// ── Templates ────────────────────────────────────────────────
// Approved WhatsApp content templates on the user's WABA.
router.get("/templates", listTemplates);

export default router;