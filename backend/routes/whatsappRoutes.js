// routes/whatsappRoutes.js
import express from "express";
import {
  webhookXamutIncoming,
  webhookXamutStatus,
  createLinkCode,
  listXamutSessions,
  listXamutSessionMessages,
  manualReply,
  archiveXamutSession,
} from "../controllers/whatsappController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

// Twilio webhooks — must be PUBLIC.
router.post("/webhook/xamut", webhookXamutIncoming);
router.post("/webhook/xamut/status", webhookXamutStatus);

// Authenticated endpoints (dashboard / link-code generation).
router.post("/xamut/link-code", protect, createLinkCode);
router.get("/xamut/sessions", protect, listXamutSessions);
router.get("/xamut/sessions/:id/messages", protect, listXamutSessionMessages);
router.post("/xamut/sessions/:id/reply", protect, manualReply);
router.delete("/xamut/sessions/:id", protect, archiveXamutSession);

export default router;