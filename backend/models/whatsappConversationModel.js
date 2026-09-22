// models/whatsappConversationModel.js
//
// One row per (user, contact) thread. A conversation is created lazily:
//   • The first time the user sends a message to a new phone number.
//   • The first time an inbound webhook arrives from an unknown number.
//
// We keep a denormalised `lastMessagePreview` and `unreadCount` so the
// inbox list renders without a join or an aggregate against
// WhatsAppMessage.

import mongoose from "mongoose";

const whatsappConversationSchema = new mongoose.Schema(
  {
    // Owner of this conversation (the Xamut user whose number is linked).
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // The other party — bare E.164, no "whatsapp:" prefix, no spaces.
    contactPhone: {
      type: String,
      required: true,
    },

    // Best-effort name from WhatsApp's `ProfileName` field on inbound
    // messages. Empty until we hear from them at least once.
    contactName: {
      type: String,
      default: "",
      maxlength: 200,
    },

    // ── Denormalised list-view fields ────────────────────────────
    lastMessageAt: { type: Date, default: Date.now },
    lastMessagePreview: { type: String, default: "", maxlength: 300 },
    unreadCount: { type: Number, default: 0, min: 0 },

    // Users can hide a thread without deleting the message history.
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One conversation per (user, contact) pair — the write path upserts on
// this exact pair.
whatsappConversationSchema.index(
  { user: 1, contactPhone: 1 },
  { unique: true }
);

// Inbox list — newest first per user.
whatsappConversationSchema.index({ user: 1, lastMessageAt: -1 });

const WhatsAppConversation = mongoose.model(
  "WhatsAppConversation",
  whatsappConversationSchema
);

export default WhatsAppConversation;