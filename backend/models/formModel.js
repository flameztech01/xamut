// models/formModel.js
import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────
// Field schema
//
// One entry per question. Types are open-ended enough to cover Google
// Forms-style basics and quizzes. `scoring` is only used for quiz-type
// forms. `section` is a layout-only divider with no answer.
// ─────────────────────────────────────────────────────────────────────
const fieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // stable id, sent by client
    type: {
      type: String,
      enum: [
        "short_text",
        "long_text",
        "email",
        "number",
        "date",
        "time",
        "url",
        "phone",
        "radio",
        "checkbox",
        "dropdown",
        "multi_select",
        "rating",
        "scale",
        "yes_no",
        "file",
        "section",
      ],
      default: "short_text",
    },
    label: { type: String, default: "", maxlength: 300 },
    description: { type: String, default: "", maxlength: 500 },
    placeholder: { type: String, default: "", maxlength: 200 },
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },

    options: [
      {
        _id: false,
        id: { type: String, required: true },
        label: { type: String, default: "" },
        value: { type: String, default: "" },
      },
    ],

    // Quiz scoring
    scoring: {
      correct: { type: [String], default: [] },
      points: { type: Number, default: 0 },
    },

    validation: {
      min: { type: Number, default: null },
      max: { type: Number, default: null },
      minLength: { type: Number, default: null },
      maxLength: { type: Number, default: null },
      pattern: { type: String, default: null },
    },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────
// Collaborator — a Xamut user granted access to view/edit the form and
// its responses. Must already have a Xamut account.
// ─────────────────────────────────────────────────────────────────────
const collaboratorSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["editor", "viewer"],
      default: "editor",
    },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────
// Pending collaborator — someone invited by email who does not have a
// Xamut account yet. When they sign up with this email, the invite is
// claimed and moved into `collaborators`.
// ─────────────────────────────────────────────────────────────────────
const pendingCollaboratorSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    name: { type: String, default: "", maxlength: 120 },
    role: {
      type: String,
      enum: ["editor", "viewer"],
      default: "editor",
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    invitedAt: { type: Date, default: Date.now },
    lastInvitedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────
// Participant — someone invited to fill a *private* form. Does NOT need
// a Xamut account. Each one gets a unique password sent by email. Not
// to be confused with collaborators.
// ─────────────────────────────────────────────────────────────────────
const participantSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: "" },
    passwordHash: { type: String, required: true },
    invitedAt: { type: Date, default: Date.now },
    lastInvitedAt: { type: Date, default: Date.now },
    completed: { type: Boolean, default: false },
    submittedAt: { type: Date, default: null },
    submissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FormResponse",
      default: null,
    },
  },
  { _id: true }
);

// ─────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────
const settingsSchema = new mongoose.Schema(
  {
    collectEmail: { type: Boolean, default: false },
    allowMultipleSubmissions: { type: Boolean, default: false },
    shuffleQuestions: { type: Boolean, default: false },
    showProgressBar: { type: Boolean, default: true },
    confirmationMessage: {
      type: String,
      default: "Thanks, your response has been recorded.",
      maxlength: 1000,
    },
    successRedirectUrl: { type: String, default: "" },
    theme: { type: String, default: "default" },
    primaryColor: { type: String, default: "" },
    // Quiz-specific
    showScoreImmediately: { type: Boolean, default: false },
    passPercentage: { type: Number, default: 0 },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────
// Form
// ─────────────────────────────────────────────────────────────────────
const formSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "Untitled form", maxlength: 200 },
    description: { type: String, default: "", maxlength: 2000 },

    // "form" is the default. "quiz" enables scoring. The rest are
    // mostly cosmetic hints the UI can use.
    type: {
      type: String,
      enum: ["form", "quiz", "survey", "feedback", "attendance"],
      default: "form",
    },

    visibility: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },

    status: {
      type: String,
      enum: ["draft", "open", "closed"],
      default: "draft",
      index: true,
    },

    slug: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    fields: { type: [fieldSchema], default: [] },
    settings: { type: settingsSchema, default: () => ({}) },

    collaborators: { type: [collaboratorSchema], default: [] },
    pendingCollaborators: { type: [pendingCollaboratorSchema], default: [] },
    participants: { type: [participantSchema], default: [] },

    responseCount: { type: Number, default: 0 },

    // Multi-page forms
    isMultipage: { type: Boolean, default: false },

    expiresAt: { type: Date, default: null },
    publishedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },

    sourceConversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
  },
  { timestamps: true }
);

formSchema.index({ owner: 1, updatedAt: -1 });
formSchema.index({ "collaborators.user": 1, updatedAt: -1 });
formSchema.index({ "pendingCollaborators.email": 1 });

const Form = mongoose.model("Form", formSchema);
export default Form;