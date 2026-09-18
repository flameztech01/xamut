// routes/formRoutes.js
import express from "express";
import {
  createForm,
  listForms,
  getForm,
  updateForm,
  deleteForm,
  duplicateForm,
  publishForm,
  closeForm,

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
  submitResponse,

  listResponses,
  getResponse,
  deleteResponse,
  getStats,
  getLeaderboard,
  exportResponses,
} from "../controllers/formController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// ─────────────────────────────────────────────────────────────
// Public / respondent routes
// No Xamut auth. Private forms gate on a participant token sent
// as `Authorization: Bearer <token>` or `?t=<token>`.
// ─────────────────────────────────────────────────────────────
router.get("/public/:slug", getPublicForm);
router.post("/public/:slug/login", participantLogin);
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

// Collaborators (Xamut users, edit/view)
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

// Participants (private-form fillers, no account needed)
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

// Responses
router.route("/:id/responses").get(listResponses);
router
  .route("/:id/responses/:responseId")
  .get(getResponse)
  .delete(deleteResponse);

// Analytics
router.get("/:id/stats", getStats);
router.get("/:id/leaderboard", getLeaderboard);
router.get("/:id/export", exportResponses);

export default router;