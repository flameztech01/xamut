// models/conversationModel.js
import mongoose from "mongoose";

const attachmentSchema = new mongoose.Schema(
  {
    // "image"              → user-uploaded image
    // "document"           → user-uploaded pdf/docx/txt
    // "url"                → reserved (paste-a-link flows)
    // "generated-document" → AI-written doc/ppt, references Document._id
    // "clip-job"           → Groq clipper job, references ClipJob._id
    type: {
      type: String,
      enum: [
        "image",
        "document",
        "url",
        "generated-document",
        "clip-job",
      ],
      required: true,
    },

    // For user uploads (image / document / url)
    url: { type: String, default: "" },
    name: { type: String, default: "" },
    mimeType: { type: String, default: "" },
    extractedText: { type: String, default: "" },

    // For generated documents (type === "generated-document")
    documentId: { type: String, default: "" },
    documentType: {
      type: String,
      enum: ["document", "presentation", ""],
      default: "",
    },
    title: { type: String, default: "" },
    pageCount: { type: Number, default: 0 },
    templateId: { type: String, default: "" },

    // For clip jobs (type === "clip-job")
    jobId: { type: String, default: "" },
    provider: { type: String, default: "" },
    sourceUrl: { type: String, default: "" },
    requestedClips: { type: Number, default: 0 },
  },
  { _id: false }
);

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant", "system", "tool"],
      required: true,
    },
    content: { type: String, default: "" },
    attachments: { type: [attachmentSchema], default: [] },
    toolCalls: { type: mongoose.Schema.Types.Mixed, default: null },
    model: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const conversationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    title: { type: String, default: "New chat", trim: true, maxlength: 120 },

    agent: {
      type: String,
      enum: ["chat", "coding", "assignment", "research"],
      default: "chat",
    },

    customInstructions: { type: String, default: "", maxlength: 8000 },
    context: { type: String, default: "", maxlength: 4000 },

    messages: { type: [messageSchema], default: [] },

    lastMessageAt: { type: Date, default: Date.now },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

conversationSchema.index({ user: 1, lastMessageAt: -1 });

const Conversation = mongoose.model("Conversation", conversationSchema);
export default Conversation;