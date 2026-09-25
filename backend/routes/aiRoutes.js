// routes/aiRoutes.js
import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import { protect } from "../middleware/authMiddleware.js";

import {
  uploadAttachment,
  uploadImageAttachment,
  sendMessage,
  sendMessageStream,
  listConversations,
  getConversation,
  createConversation,
  updateConversation,
  deleteConversation,
  searchWeb,
  analyzeWebsite,
  analyzeImage,
  generateDocument,
  generatePresentation,
  getResolvedModels,
} from "../controllers/aiController.js";

import {
  listDocuments,
  getDocument,
  updateDocument,
  deleteDocument,
} from "../controllers/documentController.js";

const router = express.Router();

// ---------- Cloudinary ----------
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// ---------- Multer storages ----------
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "xamut/ai/images",
    allowed_formats: ["jpg", "png", "jpeg", "webp", "gif"],
    transformation: [{ width: 1600, height: 1600, crop: "limit" }],
  },
});
const imageUpload = multer({ storage: imageStorage });

const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

cloudinary.api
  .ping()
  .then(() => console.log("✅ Cloudinary connected successfully"))
  .catch((err) =>
    console.error("❌ Cloudinary connection failed:", err.message)
  );

// =============================================
//             PROTECTED ROUTES
// =============================================

// ─── Uploads ─────────────────────────────────────────────────
router.post(
  "/upload",
  protect,
  attachmentUpload.single("file"),
  uploadAttachment
);

router.post(
  "/upload/image",
  protect,
  imageUpload.single("file"),
  uploadImageAttachment
);

// ─── Chat ────────────────────────────────────────────────────
router.post("/chat", protect, sendMessage);
router.post("/chat/stream", protect, sendMessageStream);

// ─── Conversations ───────────────────────────────────────────
router
  .route("/conversations")
  .get(protect, listConversations)
  .post(protect, createConversation);

router
  .route("/conversations/:id")
  .get(protect, getConversation)
  .put(protect, updateConversation)
  .delete(protect, deleteConversation);

// ─── Documents ───────────────────────────────────────────────
// @route   GET /api/ai/documents        → list user's documents
// @route   GET /api/ai/documents/:id    → fetch one
// @route   PUT /api/ai/documents/:id    → update (theme, fontSettings, pages, meta)
// @route   DELETE /api/ai/documents/:id
router.get("/documents", protect, listDocuments);

router
  .route("/documents/:id")
  .get(protect, getDocument)
  .put(protect, updateDocument)
  .delete(protect, deleteDocument);

// ─── Tools ───────────────────────────────────────────────────
router.post("/tools/search", protect, searchWeb);
router.post("/tools/website", protect, analyzeWebsite);
router.post("/analyze/image", protect, analyzeImage);

// ─── Direct generators ───────────────────────────────────────
router.post("/generate/document", protect, generateDocument);
router.post("/generate/presentation", protect, generatePresentation);

// ─── Diagnostics ─────────────────────────────────────────────
router.get("/models", protect, getResolvedModels);

export default router;