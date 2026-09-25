// models/documentModel.js
import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────
// Rich content blocks
//
// A page's body is a sequence of blocks. Legacy `paragraphs`/`bullets`
// arrays are kept on the schema so old documents still render, but every
// new document writes `blocks`.
//
// Inline formatting lives inside `text` and `items` strings as markdown
// plus two tiny tags the frontend renders after markdown:
//   **bold**  *italic*  __underline__
//   {color:#RRGGBB}…{/color}
//   {size:14}…{/size}
//
// Block types fall into two families:
//
//   Body content         heading, paragraph, bullets, numbered,
//                        quote, code, divider, toc-entry
//
//   Front-matter / layout  text        — freeform styled line
//                          label-value — key: value pair (Student: Jane)
//                          spacer      — vertical gap with a size name
//
// The layout family is what makes cover pages and closings dynamic —
// the architect emits them as an ORDERED list and the order IS the
// layout. See `sanitizeFrontMatterBlocks` in aiController.js.
// ─────────────────────────────────────────────────────────────────────

const runSchema = new mongoose.Schema(
  {
    text: { type: String, default: "" },
    bold: { type: Boolean, default: false },
    italic: { type: Boolean, default: false },
    underline: { type: Boolean, default: false },
    color: { type: String, default: "" },      // "#RRGGBB"
    fontSize: { type: Number, default: null }, // pt
  },
  { _id: false }
);

const blockStyleSchema = new mongoose.Schema(
  {
    color: { type: String, default: "" },
    fontSize: { type: Number, default: null },
    bold: { type: Boolean, default: false },
    italic: { type: Boolean, default: false },
    backgroundColor: { type: String, default: "" },
  },
  { _id: false }
);

const blockSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        // ── body content ────────────────────────────────
        "heading",     // level 1-3
        "paragraph",
        "bullets",     // items[]
        "numbered",    // items[]
        "quote",
        "code",
        "divider",
        "toc-entry",   // used on the TOC / agenda page

        // ── front matter / layout primitives ────────────
        "text",        // freeform styled line
        "label-value", // "Student Name:  Jane Doe"
        "spacer",      // vertical gap, sized sm|md|lg|xl
      ],
      default: "paragraph",
    },

    // ── heading ─────────────────────────────────────────
    // heading depth (1-3). Ignored for other types.
    level: { type: Number, default: null },

    // ── text-like blocks ────────────────────────────────
    // heading / paragraph / quote / code / toc-entry / text
    text: { type: String, default: "" },

    // ── list blocks ─────────────────────────────────────
    // bullets / numbered
    items: { type: [String], default: () => [] },

    // ── label-value ─────────────────────────────────────
    label: { type: String, default: "" },
    value: { type: String, default: "" },

    // ── sizing (text / spacer) ──────────────────────────
    //   text:    sm | md | lg | xl | 2xl
    //   spacer:  sm | md | lg | xl
    // Both share one enum superset so a bad write doesn't throw;
    // the frontend sanitizes per type on read.
    size: {
      type: String,
      enum: ["sm", "md", "lg", "xl", "2xl", ""],
      default: "",
    },
    weight: {
      type: String,
      enum: ["normal", "bold", ""],
      default: "",
    },

    // ── fine-grained inline runs (optional) ─────────────
    // The renderer can prefer these over parsing `text` when present.
    runs: { type: [runSchema], default: () => [] },

    // ── alignment + visual style ────────────────────────
    align: {
      type: String,
      enum: ["left", "center", "right", "justify"],
      default: "left",
    },

    style: { type: blockStyleSchema, default: () => ({}) },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────
const pageSchema = new mongoose.Schema(
  {
    // "cover"     → title slide / doc cover
    // "toc"       → table of contents (documents) / agenda (decks)
    // "section"   → chapter-style page for documents
    // "content"   → regular slide / body page
    // "quote"     → reserved for future templates
    // "closing"   → thank-you slide / doc end
    role: {
      type: String,
      enum: ["cover", "toc", "section", "content", "quote", "closing"],
      default: "content",
    },

    heading: { type: String, default: "" },
    subheading: { type: String, default: "" },

    // Rich content. Every new document writes this.
    blocks: { type: [blockSchema], default: () => [] },

    // LEGACY — kept so old documents still render. New docs leave empty.
    paragraphs: { type: [String], default: () => [] },
    bullets: { type: [String], default: () => [] },

    // Speaker notes (presentations) or footer notes (documents)
    notes: { type: String, default: "" },

    // Freeform per-page layout hints. The architect / frontend may
    // stash anything here (e.g. { columns: 2, coverAlign: "top" }).
    // Kept permissive on purpose — schema is Mixed so we don't need a
    // migration every time we try something new.
    layout: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: true }
);

// ─────────────────────────────────────────────────────────────────────
// Theme
// ─────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────
// Font settings — drives A4 page math and PDF export
//
// Defaults are the "student assignment" preset: 12pt body, 1.5 spacing,
// Calibri. At these settings a full A4 page holds ~335 words of prose.
// The controller computes word budgets from this via A4_WORDS_PER_PAGE.
// ─────────────────────────────────────────────────────────────────────
const fontSettingsSchema = new mongoose.Schema(
  {
    bodyFontSize: { type: Number, default: 12, min: 8, max: 32 },
    headingFontSize: { type: Number, default: 16, min: 10, max: 40 },
    fontFamily: { type: String, default: "Calibri" },
    // 1.0 = single, 1.5 = one-and-a-half, 2.0 = double
    lineSpacing: { type: Number, default: 1.5, min: 1, max: 3 },
  },
  { _id: false }
);

// ─────────────────────────────────────────────────────────────────────
// Document
// ─────────────────────────────────────────────────────────────────────
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

    // "document"     → PDF-style prose document
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

    // What kind of document the architect decided this is.
    // Purely descriptive — the renderer doesn't switch on it, but the
    // UI can ("Essay", "Letter", "Report", "Notes", ...).
    kind: { type: String, default: "" },

    pages: { type: [pageSchema], default: () => [] },
    theme: { type: themeSchema, default: () => ({}) },
    fontSettings: { type: fontSettingsSchema, default: () => ({}) },

    // Target page count the user asked for (documents). null = derived
    // from length bucket at generation time and not enforced afterward.
    pageCount: { type: Number, default: null, min: 1, max: 60 },

    // Layout toggles. Now these are the FINAL decisions the architect
    // made (or the user forced). true means the doc actually has a
    // cover / TOC page; false means it doesn't.
    includeCoverPage: { type: Boolean, default: false },
    includeTableOfContents: { type: Boolean, default: false },

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

// ─────────────────────────────────────────────────────────────────────
// toSummary — lightweight shape for list endpoints
// ─────────────────────────────────────────────────────────────────────
documentSchema.methods.toSummary = function () {
  return {
    _id: this._id,
    type: this.type,
    kind: this.kind || "",
    title: this.title,
    subtitle: this.subtitle,
    templateId: this.theme?.templateId,
    primaryColor: this.theme?.primaryColor,
    pageCount: this.pages?.length || 0,
    targetPages: this.pageCount || null,
    fontSettings: this.fontSettings
      ? {
          bodyFontSize: this.fontSettings.bodyFontSize,
          headingFontSize: this.fontSettings.headingFontSize,
          fontFamily: this.fontSettings.fontFamily,
          lineSpacing: this.fontSettings.lineSpacing,
        }
      : null,
    includeCoverPage: this.includeCoverPage === true,
    includeTableOfContents: this.includeTableOfContents === true,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

// ─────────────────────────────────────────────────────────────────────
// summaryShape — same shape, but for `.lean()` results
// (Mongoose methods don't run on lean docs, so listDocuments in the
// controller builds its own object. This is here for reuse.)
// ─────────────────────────────────────────────────────────────────────
documentSchema.statics.summaryShape = function (d) {
  return {
    _id: d._id,
    type: d.type,
    kind: d.kind || "",
    title: d.title,
    subtitle: d.subtitle,
    templateId: d.theme?.templateId,
    primaryColor: d.theme?.primaryColor,
    pageCount: d.pages?.length || 0,
    targetPages: d.pageCount || null,
    fontSettings: d.fontSettings || null,
    includeCoverPage: d.includeCoverPage === true,
    includeTableOfContents: d.includeTableOfContents === true,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
};

// ─────────────────────────────────────────────────────────────────────
// Model registration guard
//
// Without this, a dev-server HMR reload re-imports this file and
// mongoose.model("Document", schema) throws "Cannot overwrite model
// once compiled", which turns every request into a 500 until the
// process restarts. Reuse the compiled model if it already exists.
// ─────────────────────────────────────────────────────────────────────
const Document =
  mongoose.models.Document || mongoose.model("Document", documentSchema);

export default Document;