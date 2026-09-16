// controllers/documentController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Document from "../models/documentModel.js";

const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET /api/ai/documents?type=presentation&limit=30
export const listDocuments = asyncHandler(async (req, res) => {
  const { type, limit = 50 } = req.query;
  const filter = { user: req.user._id };
  if (type === "document" || type === "presentation") filter.type = type;

  const docs = await Document.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 50, 100))
    .lean();

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
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    })),
  });
});

// GET /api/ai/documents/:id
export const getDocument = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid document id.");
  }
  const doc = await Document.findOne({ _id: id, user: req.user._id });
  if (!doc) {
    res.status(404);
    throw new Error("Document not found.");
  }
  res.status(200).json({ success: true, document: doc });
});

// PUT /api/ai/documents/:id — update title, subtitle, theme, or replace pages
export const updateDocument = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { title, subtitle, theme, pages } = req.body || {};
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid document id.");
  }

  const doc = await Document.findOne({ _id: id, user: req.user._id });
  if (!doc) {
    res.status(404);
    throw new Error("Document not found.");
  }

  if (typeof title === "string") doc.title = title.slice(0, 200);
  if (typeof subtitle === "string") doc.subtitle = subtitle.slice(0, 300);
  if (theme && typeof theme === "object") {
    doc.theme = { ...doc.theme.toObject?.() || doc.theme, ...theme };
  }
  if (Array.isArray(pages)) doc.pages = pages;

  await doc.save();
  res.status(200).json({ success: true, document: doc });
});

// DELETE /api/ai/documents/:id
export const deleteDocument = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid document id.");
  }
  const deleted = await Document.findOneAndDelete({ _id: id, user: req.user._id });
  if (!deleted) {
    res.status(404);
    throw new Error("Document not found.");
  }
  res.status(200).json({ success: true, message: "Document deleted." });
});