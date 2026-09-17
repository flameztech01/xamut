// routes/formAiRoutes.js
import express from "express";
import {
  startSession,
  answerQuestion,
  regenerateDraft,
  patchDraft,
  confirmSession,
  getSession,
  cancelSession,
  listSessions,
} from "../controllers/formAiController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Every endpoint here requires Xamut auth. The AI is tied to the
// logged-in user's forms and responses.
router.use(protect);

router.post("/start", startSession);
router.post("/answer", answerQuestion);
router.post("/regenerate", regenerateDraft);
router.post("/patch-draft", patchDraft);
router.post("/confirm", confirmSession);
router.post("/cancel", cancelSession);
router.get("/session/:id", getSession);
router.get("/sessions", listSessions);

export default router;