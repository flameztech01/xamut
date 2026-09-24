// models/formDraftModel.js
import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────
// FormDraft — in-progress answers that haven't been submitted yet.
//
// One row per (form, identity), where identity is:
//   • user       → signed-in Xamut user (preferred)
//   • email      → private-form participant (verified via token)
//   • sessionKey → anonymous visitor (client-generated, in localStorage)
//
// We overwrite the same row on every autosave, so at most one draft
// exists per identity per form. On successful submit, the draft is
// deleted.
// ─────────────────────────────────────────────────────────────────────
const draftSchema = new mongoose.Schema(
  {
    form: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
      required: true,
      index: true,
    },

    // Signed-in user (optional)
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    // Anonymous browser session (optional). Generated client-side,
    // 8–200 chars. Used only for unauthenticated drafts.
    sessionKey: { type: String, default: null, index: true },

    // Cached identity hints so the UI can greet them on return.
    email: { type: String, default: "", lowercase: true, trim: true },
    name: { type: String, default: "" },

    // Shape:
    //   regular forms → { [fieldId]: value }
    //   elections     → { [positionId]: [candidateId, ...] }
    answers: { type: mongoose.Schema.Types.Mixed, default: {} },

    startedAt: { type: Date, default: Date.now },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

// One draft per identity per form. Sparse so rows missing the
// identity column don't collide.
draftSchema.index(
  { form: 1, user: 1 },
  { unique: true, sparse: true }
);
draftSchema.index(
  { form: 1, sessionKey: 1 },
  { unique: true, sparse: true }
);
draftSchema.index(
  { form: 1, email: 1 },
  { unique: true, sparse: true }
);

// Fast lookup for "my pending forms" on the dashboard.
draftSchema.index({ user: 1, updatedAt: -1 });

const FormDraft = mongoose.model("FormDraft", draftSchema);
export default FormDraft;