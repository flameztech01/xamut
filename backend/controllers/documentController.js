// controllers/documentController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Document from "../models/documentModel.js";

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ─────────────────────────────────────────────────────────────
// Block type registry
//
// `text`, `label-value`, `spacer` are the front-matter / layout
// primitives the architect phase can emit. Everything else is
// body content.
// ─────────────────────────────────────────────────────────────
const BLOCK_TYPES = new Set([
  "heading",
  "paragraph",
  "bullets",
  "numbered",
  "quote",
  "code",
  "divider",
  "toc-entry",
  // Front-matter / layout primitives
  "text",
  "label-value",
  "spacer",
]);

const TEXT_SIZES = new Set(["sm", "md", "lg", "xl", "2xl"]);
const SPACER_SIZES = new Set(["sm", "md", "lg", "xl"]);
const ALIGN_VALUES = new Set(["left", "center", "right", "justify"]);
const WEIGHT_VALUES = new Set(["normal", "bold"]);

const HEX = /^#[0-9a-fA-F]{6}$/;

// ─────────────────────────────────────────────────────────────
// Logging helpers
// ─────────────────────────────────────────────────────────────
const TAG = "[docController]";

const logReq = (fn, req) =>
  console.log(
    `${TAG} ${fn} → ${req.method} ${req.originalUrl} user=${req.user?._id || "anon"} params=${JSON.stringify(req.params)}`
  );

const logOk = (fn, extra = "") =>
  console.log(`${TAG} ${fn} ✓ ${extra}`);

const logErr = (fn, err, extra = {}) => {
  console.error(`${TAG} ${fn} ✗ ${err?.name || "Error"}: ${err?.message}`);
  if (Object.keys(extra).length) {
    console.error(`${TAG} ${fn} context:`, extra);
  }
  if (err?.stack) {
    console.error(`${TAG} ${fn} stack:\n${err.stack}`);
  }
  if (err?.errors) {
    for (const [path, e] of Object.entries(err.errors)) {
      console.error(`${TAG} ${fn} field "${path}": ${e.message}`);
    }
  }
};

// ─────────────────────────────────────────────────────────────
// Sanitizers
// ─────────────────────────────────────────────────────────────
const sanitizeStyle = (s) => {
  if (!s || typeof s !== "object") return null;
  const out = {};
  if (typeof s.color === "string" && HEX.test(s.color)) out.color = s.color;
  if (typeof s.backgroundColor === "string" && HEX.test(s.backgroundColor))
    out.backgroundColor = s.backgroundColor;
  if (Number.isFinite(+s.fontSize))
    out.fontSize = Math.min(Math.max(+s.fontSize, 8), 32);
  if (typeof s.bold === "boolean") out.bold = s.bold;
  if (typeof s.italic === "boolean") out.italic = s.italic;
  return Object.keys(out).length ? out : null;
};

const sanitizeSingleBlock = (b) => {
  if (!b || typeof b !== "object") return null;

  const type = BLOCK_TYPES.has(b.type) ? b.type : "paragraph";
  const out = { type };

  // ── type-specific fields ─────────────────────────────────
  if (type === "heading") {
    out.level = Math.min(Math.max(Number(b.level) || 2, 1), 3);
    out.text = typeof b.text === "string" ? b.text.slice(0, 500) : "";
  } else if (type === "bullets" || type === "numbered") {
    out.items = Array.isArray(b.items)
      ? b.items.slice(0, 80).map((i) => String(i).slice(0, 800))
      : [];
  } else if (type === "divider") {
    // no fields
  } else if (type === "spacer") {
    out.size = SPACER_SIZES.has(b.size) ? b.size : "md";
  } else if (type === "label-value") {
    out.label = typeof b.label === "string" ? b.label.slice(0, 80) : "";
    out.value = typeof b.value === "string" ? b.value.slice(0, 300) : "";
  } else if (type === "text") {
    out.text = typeof b.text === "string" ? b.text.slice(0, 12000) : "";
    if (TEXT_SIZES.has(b.size)) out.size = b.size;
    if (WEIGHT_VALUES.has(b.weight)) out.weight = b.weight;
  } else {
    // paragraph, quote, code, toc-entry
    out.text = typeof b.text === "string" ? b.text.slice(0, 12000) : "";
  }

  // ── generic fields (skipped on spacer / divider) ─────────
  if (type !== "spacer" && type !== "divider") {
    if (ALIGN_VALUES.has(b.align)) out.align = b.align;

    const style = sanitizeStyle(b.style);
    if (style) out.style = style;

    // Carry legacy font-size hint on text blocks through style, so
    // the frontmatter renderer can read it.
    if (type === "text" && Number.isFinite(+b.fontSize)) {
      out.style = {
        ...(out.style || {}),
        fontSize: Math.min(Math.max(+b.fontSize, 8), 32),
      };
    }
  }

  return out;
};

const sanitizeBlocks = (blocks) => {
  if (!Array.isArray(blocks)) return null;
  const cleaned = blocks
    .slice(0, 400)
    .map(sanitizeSingleBlock)
    .filter(Boolean);
  return cleaned.length ? cleaned : [];
};

const sanitizeFontSettings = (fs) => {
  if (!fs || typeof fs !== "object") return null;
  const out = {};
  if (Number.isFinite(+fs.bodyFontSize))
    out.bodyFontSize = Math.min(Math.max(+fs.bodyFontSize, 8), 32);
  if (Number.isFinite(+fs.headingFontSize))
    out.headingFontSize = Math.min(Math.max(+fs.headingFontSize, 10), 40);
  if (Number.isFinite(+fs.lineSpacing))
    out.lineSpacing = Math.min(Math.max(+fs.lineSpacing, 1), 3);
  if (typeof fs.fontFamily === "string")
    out.fontFamily = fs.fontFamily.slice(0, 60);
  return Object.keys(out).length ? out : null;
};

// Serialize a page for the update route. `layout` is preserved as-is
// when it's a plain object; blocks go through sanitizeBlocks.
const sanitizePage = (p) => {
  if (!p || typeof p !== "object") return null;
  const page = {
    role: p.role,
    heading: typeof p.heading === "string" ? p.heading.slice(0, 500) : "",
    subheading:
      typeof p.subheading === "string" ? p.subheading.slice(0, 500) : "",
    paragraphs: Array.isArray(p.paragraphs)
      ? p.paragraphs.slice(0, 100).map((x) => String(x).slice(0, 12000))
      : [],
    bullets: Array.isArray(p.bullets)
      ? p.bullets.slice(0, 100).map((x) => String(x).slice(0, 800))
      : [],
    notes: typeof p.notes === "string" ? p.notes.slice(0, 4000) : "",
  };
  if (Array.isArray(p.blocks)) page.blocks = sanitizeBlocks(p.blocks);
  if (p.layout && typeof p.layout === "object") page.layout = p.layout;
  return page;
};

// ─────────────────────────────────────────────────────────────
// GET /api/ai/documents?type=presentation&limit=30
// ─────────────────────────────────────────────────────────────
export const listDocuments = asyncHandler(async (req, res) => {
  logReq("listDocuments", req);
  const { type, limit = 50 } = req.query;
  const filter = { user: req.user._id };
  if (type === "document" || type === "presentation") filter.type = type;

  let docs;
  try {
    docs = await Document.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(Number(limit) || 50, 100))
      .lean();
  } catch (err) {
    logErr("listDocuments", err, { filter });
    res.status(500);
    throw new Error(`Failed to list documents: ${err.message}`);
  }

  logOk("listDocuments", `count=${docs.length}`);

  res.status(200).json({
    success: true,
    documents: docs.map((d) => ({
      _id: d._id,
      type: d.type,
      title: d.title,
      subtitle: d.subtitle,
      templateId: d.theme?.templateId,
      primaryColor: d.theme?.primaryColor,
      pageCount: d.pages?.length || 0,
      targetPages: d.pageCount || null,
      fontSettings: d.fontSettings || null,
      includeCoverPage: d.includeCoverPage !== false,
      includeTableOfContents: d.includeTableOfContents !== false,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/ai/documents/:id
// ─────────────────────────────────────────────────────────────
export const getDocument = asyncHandler(async (req, res) => {
  logReq("getDocument", req);
  const raw = req.params.id;
  const id = String(raw || "").trim();

  console.log(`${TAG} getDocument → raw id =`, JSON.stringify(raw));
  console.log(`${TAG} getDocument → trimmed id =`, JSON.stringify(id));

  if (!isObjectId(id)) {
    console.warn(`${TAG} getDocument → invalid ObjectId:`, id);
    res.status(400);
    throw new Error("Invalid document id.");
  }

  let doc;
  try {
    doc = await Document.findOne({ _id: id, user: req.user._id });
  } catch (err) {
    logErr("getDocument", err, {
      id,
      userId: String(req.user?._id),
      url: req.originalUrl,
    });
    res.status(500);
    throw new Error(`Failed to load document: ${err.message}`);
  }

  if (!doc) {
    console.warn(
      `${TAG} getDocument → not found for _id=${id} user=${req.user._id}`
    );
    res.status(404);
    throw new Error("Document not found.");
  }

  const blocksTotal =
    doc.pages?.reduce((n, p) => n + (p.blocks?.length || 0), 0) || 0;

  logOk(
    "getDocument",
    `title="${doc.title}" pages=${doc.pages?.length || 0} blocks=${blocksTotal} type=${doc.type}`
  );

  try {
    const payload = doc.toObject ? doc.toObject() : doc;
    res.status(200).json({ success: true, document: payload });
  } catch (err) {
    logErr("getDocument.serialize", err, { id });
    res.status(500);
    throw new Error(`Failed to serialize document: ${err.message}`);
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/ai/documents/:id
//
// Accepts: title, subtitle, theme, fontSettings, pages,
//          includeCoverPage, includeTableOfContents, pageCount
//
// Every page may include `blocks` (rich) and `layout` (freeform).
// Legacy `paragraphs` / `bullets` are still accepted.
// ─────────────────────────────────────────────────────────────
export const updateDocument = asyncHandler(async (req, res) => {
  logReq("updateDocument", req);
  const { id } = req.params;
  const {
    title, subtitle, theme, pages, fontSettings,
    includeCoverPage, includeTableOfContents, pageCount,
  } = req.body || {};

  if (!isObjectId(id)) {
    console.warn(`${TAG} updateDocument → invalid ObjectId:`, id);
    res.status(400);
    throw new Error("Invalid document id.");
  }

  console.log(
    `${TAG} updateDocument → patch keys:`,
    Object.keys(req.body || {})
  );

  let doc;
  try {
    doc = await Document.findOne({ _id: id, user: req.user._id });
  } catch (err) {
    logErr("updateDocument.fetch", err, { id });
    res.status(500);
    throw new Error(`Failed to load document: ${err.message}`);
  }

  if (!doc) {
    res.status(404);
    throw new Error("Document not found.");
  }

  try {
    if (typeof title === "string") doc.title = title.slice(0, 200);
    if (typeof subtitle === "string") doc.subtitle = subtitle.slice(0, 300);

    if (theme && typeof theme === "object") {
      const base = doc.theme?.toObject?.() || doc.theme || {};
      doc.theme = { ...base, ...theme };
    }

    if (fontSettings && typeof fontSettings === "object") {
      const clean = sanitizeFontSettings(fontSettings);
      if (clean) {
        const base =
          doc.fontSettings?.toObject?.() || doc.fontSettings || {};
        doc.fontSettings = { ...base, ...clean };
      }
    }

    if (typeof includeCoverPage === "boolean")
      doc.includeCoverPage = includeCoverPage;
    if (typeof includeTableOfContents === "boolean")
      doc.includeTableOfContents = includeTableOfContents;
    if (Number.isFinite(+pageCount))
      doc.pageCount = Math.min(Math.max(+pageCount, 1), 60);

    if (Array.isArray(pages)) {
      console.log(
        `${TAG} updateDocument → replacing ${pages.length} page(s)`
      );
      doc.pages = pages
        .slice(0, 60)
        .map(sanitizePage)
        .filter(Boolean);
    }

    await doc.save();
    logOk("updateDocument", `_id=${doc._id}`);
  } catch (err) {
    logErr("updateDocument.save", err, { id });
    res.status(500);
    throw new Error(`Failed to save document: ${err.message}`);
  }

  res.status(200).json({ success: true, document: doc });
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/ai/documents/:id
// ─────────────────────────────────────────────────────────────
export const deleteDocument = asyncHandler(async (req, res) => {
  logReq("deleteDocument", req);
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid document id.");
  }

  let deleted;
  try {
    deleted = await Document.findOneAndDelete({
      _id: id,
      user: req.user._id,
    });
  } catch (err) {
    logErr("deleteDocument", err, { id });
    res.status(500);
    throw new Error(`Failed to delete document: ${err.message}`);
  }

  if (!deleted) {
    res.status(404);
    throw new Error("Document not found.");
  }

  logOk("deleteDocument", `_id=${id}`);
  res.status(200).json({ success: true, message: "Document deleted." });
});

export default {
  listDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
};