// models/whatsappMessageModel.js
//
// One row per individual message, inbound or outbound.
//
// Outbound rows are created twice on failure:
//   1. As a "queued" placeholder if you ever add optimistic UI.
//   2. As a "failed" row when Twilio rejects the send — so the thread
//      still shows what the user tried to say.
//
// `twilioSid` is the join key between us and Twilio. The status
// webhook looks up rows by this field and flips `status`.

import mongoose from "mongoose";

const whatsappMessageSchema = new mongoose.Schema(
  {
    // Owner — same as conversation.user. Denormalised so the API can
    // filter by user without touching the conversation.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WhatsAppConversation",
      required: true,
      index: true,
    },

    // ── Direction & parties ─────────────────────────────────────
    // "in"  → contact messaged the user
    // "out" → user messaged the contact
    direction: {
      type: String,
      enum: ["in", "out"],
      required: true,
    },
    from: { type: String, required: true }, // bare E.164
    to: { type: String, required: true },   // bare E.164

    // ── Content ─────────────────────────────────────────────────
    body: { type: String, default: "", maxlength: 4096 },
    // Cloudinary / Twilio-hosted media URLs. Populated from
    // MediaUrl0..N on inbound, or from the `mediaUrls` body on outbound.
    mediaUrls: { type: [String], default: [] },
    numMedia: { type: Number, default: 0, min: 0 },

    // ── Twilio linkage ──────────────────────────────────────────
    twilioSid: {
      type: String,
      default: null,
      index: true,
    },

    // Twilio's status string, kept as free-form because Twilio has
    // more values than are documented on any one page.
    //   in:  "received"
    //   out: "queued" | "sent" | "delivered" | "read" | "failed" | "undelivered"
    status: { type: String, default: "queued" },

    // Populated when the status webhook reports a failure.
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null, maxlength: 1000 },

    // If this was a template send, we remember which template was used
    // so the UI can render it specially (and so analytics can report
    // template utilisation per user later).
    templateSid: { type: String, default: null },
  },
  { timestamps: true }
);

// Thread view — oldest first within a conversation.
whatsappMessageSchema.index({ conversation: 1, createdAt: 1 });

// Webhook status updates — find the row by Twilio's SID.
whatsappMessageSchema.index({ twilioSid: 1 }, { sparse: true });

const WhatsAppMessage = mongoose.model(
  "WhatsAppMessage",
  whatsappMessageSchema
);

export default WhatsAppMessage;