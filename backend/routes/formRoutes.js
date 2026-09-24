// routes/formRoutes.js
import express from "express";
import multer from "multer";
import jwt from "jsonwebtoken";
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

import { protect } from "../middleware/authMiddleware.js";
import User from "../models/userModel.js";

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
  uploadFormMediaEditor,

  addCollaborator,
  listCollaborators,
  removeCollaborator,
  updateCollaboratorRole,
  resendCollaboratorInvite,

  addParticipants,
  listParticipants,
  removeParticipant,
  resendParticipantCredentials,

  requestAccess,
  listAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
  bulkReviewAccessRequests,

  saveDraft,
  getDraft,
  clearDraft,
  listMyPendingForms,

  getPublicForm,
  participantLogin,
  uploadFormMedia,
  submitResponse,
  getPublicElectionResults,
  getOwnerElectionResults,

  listResponses,
  getResponse,
  deleteResponse,
  getStats,
  getLeaderboard,
  exportResponses,
} from "../controllers/formController.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// optionalAuth — attaches req.user if a valid Xamut JWT is present,
// otherwise lets the request continue as anonymous. Used for the
// draft endpoints so both signed-in and anonymous visitors can
// autosave in-progress answers.
// ─────────────────────────────────────────────────────────────
const optionalAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || "";
    if (header.toLowerCase().startsWith("bearer ")) {
      const token = header.slice(7).trim();
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Only treat it as a Xamut user token (not a participant token).
      // Participant tokens carry `purpose: "form-participant"`.
      if (!decoded?.purpose && decoded?.id) {
        const user = await User.findById(decoded.id).select("-password");
        if (user) req.user = user;
      }
    }
  } catch {
    // Silently ignore — anonymous fallback.
  }
  next();
};

// ─────────────────────────────────────────────────────────────
// Cloudinary configuration
// ─────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.API_KEY,
  api_secret: process.env.API_SECRET,
});

// ─────────────────────────────────────────────────────────────
// Storage #1 — Form cover photos (owner upload, one per form)
// ─────────────────────────────────────────────────────────────
const coverStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "form_covers",
    allowed_formats: ["jpg", "png", "jpeg", "webp"],
    transformation: [
      { width: 1600, height: 900, crop: "limit" },
      { quality: "auto:good" },
    ],
  },
});
const uploadCover = multer({
  storage: coverStorage,
  limits: { fileSize: 8 * 1024 * 1024 },
});

// ─────────────────────────────────────────────────────────────
// Storage #2 — Respondent media (image / document answers)
// ─────────────────────────────────────────────────────────────
const mediaStorage = new CloudinaryStorage({
  cloudinary,
  params: async (_req, file) => {
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
        ? [
            { width: 2000, height: 2000, crop: "limit" },
            { quality: "auto:good" },
          ]
        : undefined,
    };
  },
});
const uploadMedia = multer({
  storage: mediaStorage,
  limits: { fileSize: 15 * 1024 * 1024 },
});

// ─────────────────────────────────────────────────────────────
// Storage #3 — Editor media (candidate photos for elections,
// position banners, etc.). Same Cloudinary folder family as
// respondent media, but a different route + folder so it's clear
// what belongs to whom.
// ─────────────────────────────────────────────────────────────
const editorMediaStorage = new CloudinaryStorage({
  cloudinary,
  params: async (_req, file) => {
    const isImage = (file.mimetype || "").startsWith("image/");
    return {
      folder: isImage
        ? "form_media/editor/images"
        : "form_media/editor/files",
      resource_type: "auto",
      allowed_formats: isImage
        ? ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"]
        : ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "csv"],
      transformation: isImage
        ? [
            { width: 1600, height: 1600, crop: "limit" },
            { quality: "auto:good" },
          ]
        : undefined,
    };
  },
});
const uploadEditorMedia = multer({
  storage: editorMediaStorage,
  limits: { fileSize: 12 * 1024 * 1024 },
});

// Optional connectivity check
cloudinary.api
  .ping()
  .then(() => console.log("✅ Cloudinary connected successfully (forms)"))
  .catch((err) =>
    console.error("❌ Cloudinary connection failed (forms):", err.message)
  );

// ═════════════════════════════════════════════════════════════
// PUBLIC / RESPONDENT ROUTES  (no Xamut auth)
// ═════════════════════════════════════════════════════════════

router.get("/public/:slug", getPublicForm);
router.post("/public/:slug/login", participantLogin);

// Access requests — anyone can ask for a password to a private form.
// Owner-defined requestFields are validated against settings.
router.post("/public/:slug/request-access", requestAccess);

// Respondent media upload
router.post(
  "/public/:slug/upload",
  uploadMedia.single("file"),
  uploadFormMedia
);

// Drafts — save-in-progress answers. optionalAuth attaches req.user
// when present so the draft is tied to the account; otherwise it
// falls back to `sessionKey` (client-generated) or participant token.
router
  .route("/public/:slug/draft")
  .post(optionalAuth, saveDraft)
  .get(optionalAuth, getDraft)
  .delete(optionalAuth, clearDraft);

// Submit
router.post("/public/:slug/submit", submitResponse);

// Election live results — requires a resultsToken (issued only on
// successful vote submit). Anonymous request without token → 401.
router.get("/public/:slug/results", getPublicElectionResults);

// ═════════════════════════════════════════════════════════════
// EVERYTHING BELOW REQUIRES XAMUT AUTH
// ═════════════════════════════════════════════════════════════
router.use(protect);

// ─────────────────────────────────────────────────────────────
// Draft dashboard — "my pending forms".
// MUST come before "/:id" so "drafts" isn't parsed as an id.
// ─────────────────────────────────────────────────────────────
router.get("/drafts/pending", listMyPendingForms);

// ─────────────────────────────────────────────────────────────
// Form CRUD
// ─────────────────────────────────────────────────────────────
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
// Cover photo
// ─────────────────────────────────────────────────────────────
router.post(
  "/:id/cover",
  uploadCover.single("coverPhoto"),
  uploadFormCoverPhoto
);
router.delete("/:id/cover", removeFormCoverPhoto);

// ─────────────────────────────────────────────────────────────
// Editor media upload — candidate photos for elections, etc.
// ─────────────────────────────────────────────────────────────
router.post(
  "/:id/media",
  uploadEditorMedia.single("file"),
  uploadFormMediaEditor
);

// ─────────────────────────────────────────────────────────────
// Collaborators
// ─────────────────────────────────────────────────────────────
router
  .route("/:id/collaborators")
  .post(addCollaborator)
  .get(listCollaborators);

router.post("/:id/collaborators/:email/resend", resendCollaboratorInvite);

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
// Access requests (owner/collaborator view + review)
// ─────────────────────────────────────────────────────────────
router.get("/:id/access-requests", listAccessRequests);
router.post(
  "/:id/access-requests/:requestId/approve",
  approveAccessRequest
);
router.post(
  "/:id/access-requests/:requestId/reject",
  rejectAccessRequest
);
router.post("/:id/access-requests/bulk", bulkReviewAccessRequests);

// ─────────────────────────────────────────────────────────────
// Election results (owner/collaborator — always allowed,
// independent of settings.showLiveResults)
// ─────────────────────────────────────────────────────────────
router.get("/:id/election-results", getOwnerElectionResults);

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