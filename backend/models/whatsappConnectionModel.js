// models/whatsappConnectionModel.js
//
// One row per Xamut user who has connected a WhatsApp number.
//
// In the Twilio ISV model we never let a user hand us their own Twilio
// credentials. Instead:
//   • We create one Twilio SUBACCOUNT per user (subaccountSid / token).
//   • We attach a WhatsApp SENDER to that subaccount via Meta Embedded
//     Signup (senderSid / phoneNumber / wabaId / phoneNumberId).
//
// All outbound sends go through the subaccount; all inbound webhooks
// resolve back to a user by matching `phoneNumber` on this row.
//
// `subaccountAuthToken` is sensitive — never return it from any API.
// The only places that need it are the sub-client factory in
// utils/twilioWhatsApp.js and any future server-side task.

import mongoose from "mongoose";

const whatsappConnectionSchema = new mongoose.Schema(
  {
    // ── Ownership ────────────────────────────────────────────────
    // One connection per user. `unique` at the index level.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // ── Twilio side ──────────────────────────────────────────────
    // The subaccount we spun up for this user.
    subaccountSid: {
      type: String,
      default: null,
    },
    // Kept server-side only. Never exposed over the API.
    subaccountAuthToken: {
      type: String,
      default: null,
    },

    // ── Meta / WhatsApp side ─────────────────────────────────────
    // The WhatsApp sender registered on the subaccount.
    senderSid: {
      type: String,
      default: null,
      index: true,
    },
    // E.164, e.g. "+2348012345678". This is what we match webhooks on.
    phoneNumber: {
      type: String,
      default: null,
    },
    // Human-readable profile name (as shown by WhatsApp).
    displayName: {
      type: String,
      default: "",
      maxlength: 200,
    },
    // Meta identifiers captured during Embedded Signup.
    wabaId: { type: String, default: null },
    phoneNumberId: { type: String, default: null },
    businessId: { type: String, default: null },

    // ── Meta-reported quality metadata ───────────────────────────
    // e.g. "GREEN" | "YELLOW" | "RED"
    qualityRating: { type: String, default: null },
    // e.g. "TIER_1K" | "TIER_10K" | "TIER_100K" | "TIER_UNLIMITED"
    messagingLimitTier: { type: String, default: null },

    // ── Lifecycle ────────────────────────────────────────────────
    status: {
      type: String,
      enum: ["pending_signup", "connected", "disconnected"],
      default: "pending_signup",
      index: true,
    },
    connectedAt: { type: Date, default: null },
    disconnectedAt: { type: Date, default: null },

    // ── Activity ─────────────────────────────────────────────────
    lastInboundAt: { type: Date, default: null },
    lastOutboundAt: { type: Date, default: null },

    // Set true once Twilio has successfully hit our webhook for this
    // number at least once. Useful as a "fully wired" signal for the UI.
    webhookVerified: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// One connection per user.
whatsappConnectionSchema.index({ user: 1 }, { unique: true });

// Webhook resolution — look up by phone number, filter by status.
whatsappConnectionSchema.index({ phoneNumber: 1, status: 1 });

const WhatsAppConnection = mongoose.model(
  "WhatsAppConnection",
  whatsappConnectionSchema
);

export default WhatsAppConnection;