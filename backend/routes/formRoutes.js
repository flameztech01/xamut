// routes/formRoutes.js
import express from "express";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

import { protect } from "../middleware/authMiddleware.js";
import {
  createForm,
  listForms,
  getForm,
  updateForm,
  deleteForm,
  duplicateForm,
  publishForm,
  closeForm,

  uploadFormCoverPhoto,
  removeFormCoverPhoto,

  addCollaborator,
  listCollaborators,
  removeCollaborator,
  updateCollaboratorRole,
  resendCollaboratorInvite,

  addParticipants,
  listParticipants,
  removeParticipant,
  resendParticipantCredentials,

  getPublicForm,
  participantLogin,
  uploadFormMedia,
  submitResponse,

  listResponses,
  getResponse,
  deleteResponse,
  getStats,
  getLeaderboard,
  exportResponses,
} from "../controllers/formController.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Cloudinary configuration (same env vars as userRoutes)
// ─────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// ─────────────────────────────────────────────────────────────
// Storage #1 — Form cover photos (owner upload, one per form)
// Stored at form_covers/<cloudinary auto-id>
// ─────────────────────────────────────────────────────────────
const coverStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "form_covers",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [
      // Wide banner-ish crop, capped so we don't store gigantic files.
      { width: 1600, height: 900, crop: "limit" },
      { quality: "auto:good" },
    ],
  },
});
const uploadCover = multer({
  storage: coverStorage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
});

// ─────────────────────────────────────────────────────────────
// Storage #2 — Respondent media (image / document answers)
// Images go to form_media/images, docs go to form_media/documents.
// `resource_type: "auto"` lets Cloudinary handle both.
// ─────────────────────────────────────────────────────────────
const mediaStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isImage = (file.mimetype || "").startsWith("image/");
    return {
      folder: isImage ? "form_media/images" : "form_media/documents",
      resource_type: "auto",
      allowed_formats: isImage
        ? ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]
        : [
            "pdf",
            "doc",
            "docx",
            "xls",
            "xlsx",
            "ppt",
            "pptx",
            "txt",
            "csv",
            "zip",
          ],
      transformation: isImage
        ? [{ width: 2000, height: 2000, crop: "limit" }, { quality: "auto:good" }]
        : undefined,
    };
  },
});
const uploadMedia = multer({
  storage: mediaStorage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// Optional connectivity check — same behaviour as userRoutes
cloudinary.api
  .ping()
  .then(() => console.log("✅ Cloudinary connected successfully (forms)"))
  .catch((err) =>
    console.error("❌ Cloudinary connection failed (forms):", err.message)
  );

// ─────────────────────────────────────────────────────────────
// Public / respondent routes
// No Xamut auth. Private forms gate on a participant token sent
// as `Authorization: Bearer <token>` or `?t=<token>`.
// ─────────────────────────────────────────────────────────────
router.get("/public/:slug", getPublicForm);
router.post("/public/:slug/login", participantLogin);

// Respondent uploads an image/document; returns the Cloudinary URL
// the client then stuffs into the answer payload. `file` is the
// multipart field name.
router.post(
  "/public/:slug/upload",
  uploadMedia.single("file"),
  uploadFormMedia
);

router.post("/public/:slug/submit", submitResponse);

// ─────────────────────────────────────────────────────────────
// Everything below requires Xamut auth.
// ─────────────────────────────────────────────────────────────
router.use(protect);

// Form CRUD
router.route("/").post(createForm).get(listForms);
router
  .route("/:id")
  .get(getForm)
  .put(updateForm)
  .delete(deleteForm);

router.post("/:id/duplicate", duplicateForm);
router.post("/:id/publish", publishForm);
router.post("/:id/close", closeForm);

// ─────────────────────────────────────────────────────────────
// Cover photo (Cloudinary) — owner/editor only
// ─────────────────────────────────────────────────────────────
router.post(
  "/:id/cover",
  uploadCover.single("coverPhoto"),
  uploadFormCoverPhoto
);
router.delete("/:id/cover", removeFormCoverPhoto);

// ─────────────────────────────────────────────────────────────
// Collaborators (Xamut users, edit/view)
// ─────────────────────────────────────────────────────────────
router
  .route("/:id/collaborators")
  .post(addCollaborator)
  .get(listCollaborators);

// Resend invite to a pending collaborator (keyed on email so it
// works before they've signed up)
router.post(
  "/:id/collaborators/:email/resend",
  resendCollaboratorInvite
);

router
  .route("/:id/collaborators/:userId")
  .put(updateCollaboratorRole)
  .delete(removeCollaborator);

// ─────────────────────────────────────────────────────────────
// Participants (private-form fillers, no account needed)
// ─────────────────────────────────────────────────────────────
router
  .route("/:id/participants")
  .post(addParticipants)
  .get(listParticipants);

router
  .route("/:id/participants/:participantId")
  .delete(removeParticipant);

router.post(
  "/:id/participants/:participantId/resend",
  resendParticipantCredentials
);

// ─────────────────────────────────────────────────────────────
// Responses
// ─────────────────────────────────────────────────────────────
router.route("/:id/responses").get(listResponses);
router
  .route("/:id/responses/:responseId")
  .get(getResponse)
  .delete(deleteResponse);

// ─────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────
router.get("/:id/stats", getStats);
router.get("/:id/leaderboard", getLeaderboard);
router.get("/:id/export", exportResponses);

export default router;