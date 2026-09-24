// models/formModel.js
import mongoose from "mongoose";
import {
  FIELD_TYPE_IDS,
  FORM_TYPE_IDS,
} from "../config/formCapabilities.js";

// ─────────────────────────────────────────────────────────────────────
// Field schema — regular forms / quizzes
//
// The `type` enum reads from the capability registry, so a new field
// type added to config/formCapabilities.js is instantly accepted here
// without touching this file.
// ─────────────────────────────────────────────────────────────────────
const fieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: FIELD_TYPE_IDS,
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
      maxFiles: { type: Number, default: null },
    },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────
// Election candidate — one person contesting a position
// ─────────────────────────────────────────────────────────────────────
const candidateSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // stable id, e.g. "c_a1b2c3"
    name: { type: String, required: true, maxlength: 200 },
    bio: { type: String, default: "", maxlength: 2000 },
    manifesto: { type: String, default: "", maxlength: 5000 },
    photoUrl: { type: String, default: "" }, // Cloudinary URL
    slogan: { type: String, default: "", maxlength: 200 },
    // Open-ended slot for anything else (class, dept, CGPA, etc.)
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────
// Election position — e.g. "President", "Director of Socials"
//
// A single election form can have 1..N positions. Each position has its
// own candidate list, its own maxSelections (1 = pick one, >1 = pick up
// to N), and its own required flag.
// ─────────────────────────────────────────────────────────────────────
const positionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true }, // e.g. "p_a1b2c3"
    title: { type: String, required: true, maxlength: 200 },
    description: { type: String, default: "", maxlength: 1000 },
    maxSelections: { type: Number, default: 1, min: 1, max: 20 },
    required: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    candidates: { type: [candidateSchema], default: [] },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────
// Collaborator — a Xamut user granted access to view/edit the form.
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
// Pending collaborator — invited by email, no Xamut account yet.
// ─────────────────────────────────────────────────────────────────────
const pendingCollaboratorSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
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
// Participant — invited directly to a private form (no Xamut account).
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
// Access request — someone asking for a password to a private form.
//
// Flow:
//   1. Visitor submits email (+ any owner-defined extraInfo fields).
//   2. Owner approves (→ participant created, credentials emailed) or
//      rejects (→ polite email with optional reason).
// ─────────────────────────────────────────────────────────────────────
const participantRequestSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    name: { type: String, default: "", maxlength: 120 },
    // Free-form note the visitor can attach ("I'm in your 300L class")
    note: { type: String, default: "", maxlength: 500 },
    // Answers to owner-defined requestFields (matric no, dept, etc.)
    extraInfo: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date, default: null },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewNote: { type: String, default: "", maxlength: 500 },
  },
  { _id: true }
);

// ─────────────────────────────────────────────────────────────────────
// Request field — what the owner wants collected with each request.
// e.g. { label: "Matric Number", type: "short_text", required: true }
//
// This is intentionally a NARROW subset of field types — only simple
// text-like inputs make sense as an access-request field (you don't
// want a visitor uploading a file or answering a linear scale just to
// ask for a password). Kept explicit rather than derived from the
// registry so a future "ranking" or "signature" field type doesn't
// leak into this list by accident.
// ─────────────────────────────────────────────────────────────────────
const requestFieldSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    label: { type: String, required: true, maxlength: 200 },
    type: {
      type: String,
      enum: ["short_text", "long_text", "email", "number", "phone", "url", "date"],
      default: "short_text",
    },
    required: { type: Boolean, default: false },
    placeholder: { type: String, default: "", maxlength: 200 },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────
const settingsSchema = new mongoose.Schema(
  {
    // ── General ────────────────────────────────────────────────────
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

    // ── Quiz ───────────────────────────────────────────────────────
    showScoreImmediately: { type: Boolean, default: false },
    passPercentage: { type: Number, default: 0 },

    // ── Private-form access requests ──────────────────────────────
    allowAccessRequests: { type: Boolean, default: false },
    autoApproveAccess: { type: Boolean, default: false },
    requestFields: { type: [requestFieldSchema], default: [] },

    // ── Election ──────────────────────────────────────────────────
    shufflePositions: { type: Boolean, default: false },
    allowAbstain: { type: Boolean, default: false },
    showLiveResults: { type: Boolean, default: false },
    requireAllPositions: { type: Boolean, default: true },
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
    coverPhoto: { type: String, default: "" },

    // "election" triggers positions-based flow instead of fields.
    // Enum reads from the registry — adding a form type there makes
    // it acceptable here without editing this file.
    type: {
      type: String,
      enum: FORM_TYPE_IDS,
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

    // ── Regular forms / quizzes ───────────────────────────────────
    fields: { type: [fieldSchema], default: [] },

    // ── Elections ─────────────────────────────────────────────────
    positions: { type: [positionSchema], default: [] },

    settings: { type: settingsSchema, default: () => ({}) },

    collaborators: { type: [collaboratorSchema], default: [] },
    pendingCollaborators: { type: [pendingCollaboratorSchema], default: [] },
    participants: { type: [participantSchema], default: [] },
    participantRequests: { type: [participantRequestSchema], default: [] },

    responseCount: { type: Number, default: 0 },

    isMultipage: { type: Boolean, default: false },

    // ── Timing window ─────────────────────────────────────────────
    startAt: { type: Date, default: null },
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
formSchema.index({ "participantRequests.email": 1 });
formSchema.index({ "participantRequests.status": 1 });

const Form = mongoose.model("Form", formSchema);
export default Form;