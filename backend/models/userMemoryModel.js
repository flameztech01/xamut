// models/userMemoryModel.js
//
// Long-term memory about a user, extracted from conversations.
// Each memory is a single atomic fact or preference with an importance
// score so we can rank the most relevant ones into the system prompt.

import mongoose from "mongoose";

const userMemorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // "identity"  → name, location, role, school
    // "preference" → response style, tone, language
    // "interest"  → hobbies, favourites, fandoms
    // "project"   → things they're working on
    // "fact"      → anything else worth remembering
    category: {
      type: String,
      enum: ["identity", "preference", "interest", "project", "fact"],
      default: "fact",
    },
    // Short human-readable statement, e.g. "Their name is Samuel"
    text: { type: String, required: true, trim: true, maxlength: 300 },
    // 0..1 — higher = more likely to be loaded into every prompt
    importance: { type: Number, default: 0.5, min: 0, max: 1 },
    // Which conversation produced this memory (for provenance)
    source: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
    lastReferencedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Unique per (user, category, text) so we don't duplicate the same fact
userMemorySchema.index(
  { user: 1, category: 1, text: 1 },
  { unique: true }
);
userMemorySchema.index({ user: 1, importance: -1, updatedAt: -1 });

const UserMemory = mongoose.model("UserMemory", userMemorySchema);
export default UserMemory;