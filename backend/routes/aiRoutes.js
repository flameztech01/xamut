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
  startClipJobController,
  getClipJobStatus,
  listClipJobs,
  getResolvedModels,
} from "../controllers/aiController.js";

const router = express.Router();

// ---------- Cloudinary Configuration ---------- (same pattern as userRoutes)
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// ---------- Multer storages ----------

// 1) Images — direct to Cloudinary
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "xamut/ai/images",
    allowed_formats: ["jpg", "png", "jpeg", "webp", "gif"],
    transformation: [{ width: 1600, height: 1600, crop: "limit" }],
  },
});
const imageUpload = multer({ storage: imageStorage });

// 2) Mixed attachments (image OR pdf/docx/txt) — need the raw buffer for
//    text extraction, so this path uses memory storage and the controller
//    pushes the buffer to Cloudinary itself.
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

// Optional: verify Cloudinary connection
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
// @route   POST /api/ai/upload
// @desc    Upload an image OR a document (pdf / docx / txt) for the AI
// @access  Private
router.post(
  "/upload",
  protect,
  attachmentUpload.single("file"),
  uploadAttachment
);

// @route   POST /api/ai/upload/image
// @desc    Upload an image straight to Cloudinary (no text extraction)
// @access  Private
router.post(
  "/upload/image",
  protect,
  imageUpload.single("file"),
  uploadImageAttachment
);

// ─── Chat ────────────────────────────────────────────────────
// @route   POST /api/ai/chat
// @desc    Send a message — runs the selected agent (with tools, vision,
//          and intent-driven document/presentation/clip generation)
// @access  Private
router.post("/chat", protect, sendMessage);

// @route   POST /api/ai/chat/stream
// @desc    Same as /chat but streams Server-Sent Events as the turn runs,
//          so the client can render live status ("Searching the web…").
//          Frame shapes:
//            { type: "status", text }
//            { type: "done",  conversationId, title, agent, reply }
//            { type: "error", message }
// @access  Private
router.post("/chat/stream", protect, sendMessageStream);

// ─── Conversations ───────────────────────────────────────────
// @route   GET  /api/ai/conversations
// @route   POST /api/ai/conversations
router
  .route("/conversations")
  .get(protect, listConversations)
  .post(protect, createConversation);

// @route   GET    /api/ai/conversations/:id
// @route   PUT    /api/ai/conversations/:id
// @route   DELETE /api/ai/conversations/:id
router
  .route("/conversations/:id")
  .get(protect, getConversation)
  .put(protect, updateConversation)
  .delete(protect, deleteConversation);

// ─── Clips ───────────────────────────────────────────────────
// Order matters: /clips (list) must be registered before /clips/:id,
// otherwise Express would treat GET /clips as a lookup for id="list".
//
// @route   GET  /api/ai/clips
// @route   POST /api/ai/clips
router
  .route("/clips")
  .get(protect, listClipJobs)
  .post(protect, startClipJobController);

// @route   GET /api/ai/clips/:id
router.get("/clips/:id", protect, getClipJobStatus);

// ─── Tools ───────────────────────────────────────────────────
// @route   POST /api/ai/tools/search
// @desc    Direct web search (no conversation)
// @access  Private
router.post("/tools/search", protect, searchWeb);

// @route   POST /api/ai/tools/website
// @desc    Fetch a URL + summarize it
// @access  Private
router.post("/tools/website", protect, analyzeWebsite);

// @route   POST /api/ai/analyze/image
// @desc    Vision analysis of an image URL
// @access  Private
router.post("/analyze/image", protect, analyzeImage);

// ─── Direct generators ───────────────────────────────────────
// @route   POST /api/ai/generate/document
// @route   POST /api/ai/generate/presentation
// Both create a Document row and return its summary.
router.post("/generate/document", protect, generateDocument);
router.post("/generate/presentation", protect, generatePresentation);

// ─── Diagnostics ─────────────────────────────────────────────
// @route   GET /api/ai/models
// @desc    Which Groq text + vision models resolved for this key
// @access  Private
router.get("/models", protect, getResolvedModels);

export default router;