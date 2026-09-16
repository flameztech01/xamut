// models/documentModel.js
import mongoose from "mongoose";

const pageSchema = new mongoose.Schema(
  {
    // "cover"     → title slide / doc cover
    // "section"   → chapter-style page for documents
    // "content"   → regular slide / body page
    // "quote"     → reserved for future templates
    // "closing"   → thank-you slide / doc end
    role: {
      type: String,
      enum: ["cover", "section", "content", "quote", "closing"],
      default: "content",
    },
    heading: { type: String, default: "" },
    subheading: { type: String, default: "" },
    paragraphs: { type: [String], default: [] },
    bullets: { type: [String], default: [] },
    // Speaker notes (presentations) or footer notes (documents)
    notes: { type: String, default: "" },
  },
  { _id: true }
);

const themeSchema = new mongoose.Schema(
  {
    // Must match a key in the frontend's PdfDesigns / PptDesigns map
    templateId: { type: String, default: "formal-academic" },

    // 6-char hex, no leading "#"
    primaryColor: { type: String, default: "2E7D32" },
    secondaryColor: { type: String, default: "FFFFFF" },
    accentColor: { type: String, default: "C9A227" },
    textColor: { type: String, default: "1A1A1A" },
    backgroundColor: { type: String, default: "FFFFFF" },

    fontFamily: { type: String, default: "Calibri" },
  },
  { _id: false }
);

const documentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Set when the doc was generated from a chat turn
    conversation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },

    // "document"  → PDF-style prose document
    // "presentation" → slide deck
    type: {
      type: String,
      enum: ["document", "presentation"],
      required: true,
    },

    title: { type: String, default: "Untitled" },
    subtitle: { type: String, default: "" },
    author: { type: String, default: "Xamut" },
    companyName: { type: String, default: "" },

    pages: { type: [pageSchema], default: [] },
    theme: { type: themeSchema, default: () => ({}) },

    // The user message that triggered generation (for audit / "regenerate")
    sourcePrompt: { type: String, default: "" },

    status: {
      type: String,
      enum: ["draft", "ready", "failed"],
      default: "ready",
    },
    failureReason: { type: String, default: "" },
  },
  { timestamps: true }
);

documentSchema.index({ user: 1, createdAt: -1 });

// Lightweight shape for list endpoints (GET /api/ai/documents)
documentSchema.methods.toSummary = function () {
  return {
    _id: this._id,
    type: this.type,
    title: this.title,
    subtitle: this.subtitle,
    templateId: this.theme?.templateId,
    primaryColor: this.theme?.primaryColor,
    pageCount: this.pages?.length || 0,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

const Document = mongoose.model("Document", documentSchema);
export default Document;