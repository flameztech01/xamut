// models/formAiSessionModel.js
import mongoose from "mongoose";

const aiMessageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      required: true,
    },
    content: { type: String, default: "" },
    // For assistant messages that carry a question or a draft, we stash
    // the structured payload here so the frontend doesn't have to parse
    // the text back out.
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const pendingQuestionSchema = new mongoose.Schema(
  {
    id: { type: String, default: "" },
    text: { type: String, default: "" },
    helper: { type: String, default: "" },
    options: [
      {
        _id: false,
        id: { type: String, default: "" },
        label: { type: String, default: "" },
        value: { type: String, default: "" },
        // If true, this option means "let me describe it" and the
        // frontend should show a text field.
        isOther: { type: Boolean, default: false },
      },
    ],
    allowOther: { type: Boolean, default: true },
    otherLabel: { type: String, default: "Other (type your own)" },
    otherPlaceholder: { type: String, default: "" },
    multiSelect: { type: Boolean, default: false },
    minSelections: { type: Number, default: 0 },
    maxSelections: { type: Number, default: 0 },
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    mode: {
      type: String,
      enum: ["create", "edit", "collaborators", "respond"],
      default: "create",
    },

    status: {
      type: String,
      enum: ["collecting", "previewing", "done", "cancelled", "error"],
      default: "collecting",
    },

    // For edit / collaborators / respond
    targetFormId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
      default: null,
    },
    // For respond mode, the set of responses the AI is going to email.
    targetResponseIds: {
      type: [mongoose.Schema.Types.ObjectId],
      default: [],
    },

    // The original prompt that kicked this off.
    initialPrompt: { type: String, default: "" },

    messages: { type: [aiMessageSchema], default: [] },

    // When mode === "create", the AI proposes a draft here. When
    // mode === "edit", this holds the proposed new version of the
    // existing form so the user can preview before confirming.
    draft: {
      title: { type: String, default: "" },
      description: { type: String, default: "" },
      type: { type: String, default: "form" },
      visibility: { type: String, default: "public" },
      fields: { type: Array, default: [] },
      settings: { type: Object, default: {} },
      isMultipage: { type: Boolean, default: false },
    },

    // For collaborators mode, the proposed changes
    draftCollaborators: [
      {
        _id: false,
        email: { type: String, default: "" },
        role: { type: String, default: "editor" },
        name: { type: String, default: "" },
        exists: { type: Boolean, default: false },
      },
    ],

    // For respond mode, the proposed emails
    draftEmails: {
      subject: { type: String, default: "" },
      bodyTemplate: { type: String, default: "" },
      // Optional per-recipient overrides
      overrides: [
        {
          _id: false,
          email: { type: String, default: "" },
          subject: { type: String, default: "" },
          body: { type: String, default: "" },
        },
      ],
      recipients: [
        {
          _id: false,
          responseId: { type: String, default: "" },
          email: { type: String, default: "" },
          name: { type: String, default: "" },
          previewSubject: { type: String, default: "" },
          previewBody: { type: String, default: "" },
        },
      ],
    },

    // Current outstanding question, if any
    pendingQuestion: { type: pendingQuestionSchema, default: null },

    // Ready for the user to confirm
    awaitingConfirm: { type: Boolean, default: false },

    // Guard against the AI looping forever asking questions.
    questionCount: { type: Number, default: 0 },

    createdFormId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
      default: null,
    },

    // Result summary for respond mode
    sendResult: {
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

// Auto-expire sessions after 24h so we don't accumulate garbage.
sessionSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

sessionSchema.index({ user: 1, updatedAt: -1 });

const FormAiSession = mongoose.model("FormAiSession", sessionSchema);
export default FormAiSession;