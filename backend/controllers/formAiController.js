// controllers/formAiController.js
//
// Conversational form builder. Four modes: create, edit, collaborators,
// respond. State lives in Mongo so a slow turn or a page reload doesn't
// lose the thread.
//
// This file exports both the HTTP handlers (for the standalone form-ai
// API) AND the core helpers (startFormSessionCore, answerQuestionCore,
// publicSession) so aiController can drive the same flow from inside
// chat without duplicating any logic.

import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import crypto from "crypto";

import Form from "../models/formModel.js";
import FormResponse from "../models/formResponseModel.js";
import FormAiSession from "../models/formAiSessionModel.js";
import User from "../models/userModel.js";
import { groqJSONFast } from "../utils/xamutAI.js";
import { sendEmailSafe } from "../utils/sendMail.js";

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const genFieldId = () => `f_${crypto.randomBytes(4).toString("hex")}`;
const genOptionId = () => `o_${crypto.randomBytes(3).toString("hex")}`;
const genQuestionId = () => `q_${crypto.randomBytes(3).toString("hex")}`;

const httpError = (msg, statusCode = 400) => {
  const err = new Error(msg);
  err.statusCode = statusCode;
  return err;
};

const frontendUrl = () => (process.env.FRONTEND_URL || "").replace(/\/$/, "");

// ─────────────────────────────────────────────────────────────────────
// Field / settings sanitizers — same as before
// ─────────────────────────────────────────────────────────────────────
const FIELD_TYPES = new Set([
  "short_text", "long_text", "email", "number", "date", "time",
  "url", "phone", "radio", "checkbox", "dropdown", "multi_select",
  "rating", "scale", "yes_no", "file", "section",
]);

const CHOICE_TYPES = new Set(["radio", "checkbox", "dropdown", "multi_select"]);

const sanitizeFields = (fields) => {
  if (!Array.isArray(fields)) return [];
  return fields.map((f, idx) => {
    const type = FIELD_TYPES.has(f?.type) ? f.type : "short_text";
    const field = {
      id: typeof f.id === "string" && f.id ? f.id : genFieldId(),
      type,
      label: String(f.label || `Question ${idx + 1}`).slice(0, 300),
      description: String(f.description || "").slice(0, 500),
      placeholder: String(f.placeholder || "").slice(0, 200),
      required: !!f.required,
      order: typeof f.order === "number" ? f.order : idx,
      options: [],
      scoring: { correct: [], points: 0 },
      validation: { min: null, max: null, minLength: null, maxLength: null, pattern: null },
    };

    if (CHOICE_TYPES.has(type) && Array.isArray(f.options)) {
      field.options = f.options.map((o, i) => ({
        id: typeof o.id === "string" && o.id ? o.id : genOptionId(),
        label: String(o.label ?? `Option ${i + 1}`).slice(0, 200),
        value: String(o.value ?? o.label ?? "").slice(0, 200),
      }));
    }

    const scoringEligible = [
      "radio", "checkbox", "dropdown", "multi_select",
      "short_text", "long_text", "yes_no",
    ].includes(type);

    if (scoringEligible && f.scoring) {
      const correct = Array.isArray(f.scoring.correct)
        ? f.scoring.correct
        : f.scoring.correct != null ? [f.scoring.correct] : [];
      field.scoring = {
        correct: correct.map((c) => String(c).slice(0, 200)).slice(0, 20),
        points: Number(f.scoring.points) || 0,
      };
    }

    if (f.validation) {
      const v = f.validation;
      field.validation = {
        min: Number.isFinite(Number(v.min)) ? Number(v.min) : null,
        max: Number.isFinite(Number(v.max)) ? Number(v.max) : null,
        minLength: Number.isFinite(Number(v.minLength)) ? Number(v.minLength) : null,
        maxLength: Number.isFinite(Number(v.maxLength)) ? Number(v.maxLength) : null,
        pattern: typeof v.pattern === "string" ? v.pattern.slice(0, 300) : null,
      };
    }

    return field;
  });
};

const sanitizeSettings = (s = {}) => ({
  collectEmail: !!s.collectEmail,
  allowMultipleSubmissions: !!s.allowMultipleSubmissions,
  shuffleQuestions: !!s.shuffleQuestions,
  showProgressBar: s.showProgressBar !== false,
  confirmationMessage:
    typeof s.confirmationMessage === "string"
      ? s.confirmationMessage.slice(0, 1000)
      : "Thanks, your response has been recorded.",
  successRedirectUrl:
    typeof s.successRedirectUrl === "string" ? s.successRedirectUrl.slice(0, 500) : "",
  theme: typeof s.theme === "string" ? s.theme.slice(0, 50) : "default",
  primaryColor: typeof s.primaryColor === "string" ? s.primaryColor.slice(0, 20) : "",
  showScoreImmediately: !!s.showScoreImmediately,
  passPercentage: Number.isFinite(Number(s.passPercentage))
    ? Math.max(0, Math.min(100, Number(s.passPercentage)))
    : 0,
});

// ─────────────────────────────────────────────────────────────────────
// The schema spec fed to the AI
// ─────────────────────────────────────────────────────────────────────
const FORM_SCHEMA_SPEC = `
A Form document has this shape:

{
  "title": "string",
  "description": "string",
  "type": "form" | "quiz" | "survey" | "feedback" | "attendance",
  "visibility": "public" | "private",
  "fields": [ Field, ... ],
  "settings": Settings,
  "isMultipage": boolean
}

A Field is:
{
  "id": "f_xxxxxxxx",
  "type": one of:
      short_text | long_text | email | number | date | time | url |
      phone | radio | checkbox | dropdown | multi_select |
      rating | scale | yes_no | file | section,
  "label": "string",
  "description": "string",
  "placeholder": "string",
  "required": boolean,
  "order": number,
  "options": [
    { "id": "o_xxxx", "label": "string", "value": "string" }
  ],
  "validation": {
    "min": number | null,
    "max": number | null,
    "minLength": number | null,
    "maxLength": number | null,
    "pattern": string | null
  },
  "scoring": {
    "correct": ["value", ...],
    "points": number
  }
}

A Settings is:
{
  "collectEmail": boolean,
  "allowMultipleSubmissions": boolean,
  "shuffleQuestions": boolean,
  "showProgressBar": boolean,
  "confirmationMessage": "string",
  "successRedirectUrl": "string",
  "showScoreImmediately": boolean,
  "passPercentage": number
}

Rules for fields:
- A "section" is a divider. It has a label and description but no options, no required flag, no validation, no scoring.
- Every radio/checkbox/dropdown/multi_select must have at least two options with stable ids and non-empty values.
- For quizzes, populate scoring.correct with the correct option.value(s) and set points.
- Keep labels short and human. Avoid duplicating the description into the label.
`;

// ─────────────────────────────────────────────────────────────────────
// The core AI call
// ─────────────────────────────────────────────────────────────────────
export async function askFormAi({
  mode,
  userPrompt,
  history = [],
  targetForm = null,
  targetResponses = [],
  questionCount = 0,
  forceReady = false,
}) {
  const MAX_QUESTIONS = 5;

  const modeBlocks = {
    create: `
MODE: CREATE A NEW FORM

You help users design a form from scratch. Your job is to either:
  (a) ask ONE clarifying question with tappable options, if you still
      need information to build a good form, or
  (b) produce the full draft form, if you already know enough.

Ask at most ${MAX_QUESTIONS} questions total. The user has already been
asked ${questionCount}. If you have any doubt at all about what kind of
form they want, ask. Better to ask than to guess wrong.

If the user's message already gives you enough information to build a
solid form (topic, what info to collect, who it's for), produce the
draft immediately. Don't ask questions you can answer yourself.

Good questions when you genuinely need info:
- What type of form is this? (survey, quiz, feedback, attendance, general)
- Who is filling it? (general public, invited people, students, employees)
- How long should it be? (short, medium, long)
- Should answers be scored? (yes quiz / no plain form)

Only ask about things that MATTER for the shape of the form. Never ask
for something you can infer. Never ask more than one question at a time.

When you're ready to draft, return kind="draft".
`,
    edit: `
MODE: EDIT AN EXISTING FORM

The user has an existing form (see the JSON below). They've described a
change. Apply the change to fields, settings, title, description, or
type, and return the FULL updated form as a draft. Do NOT return just a
diff. Do NOT drop fields the user didn't ask to remove. Preserve
existing field ids when editing in place so prior responses stay
attached to the right question.
`,
    collaborators: `
MODE: ADD COLLABORATORS

The user has a form (see below) and wants to add people as collaborators.
Extract each email address and role (editor or viewer). Default to
"editor" if role isn't stated. Return kind="collaborators".
`,
    respond: `
MODE: COMPOSE EMAILS TO RESPONDENTS

The user has a form and wants to send emails to some or all people who
filled it out. See the responses below. Compose ONE email template
personalized per recipient with these placeholders:

  {{name}}  {{email}}  {{score}}  {{maxScore}}  {{percentage}}
  {{passed}}  {{duration}}  {{submittedAt}}

Return kind="emails".
`,
  };

  const schemaHints = {
    create: `
Return STRICT JSON, one of:

{
  "kind": "question",
  "question": {
    "id": "q_xxx",
    "text": "What kind of form is this?",
    "helper": "optional short explanation",
    "options": [
      { "id": "o_1", "label": "Survey", "value": "survey" },
      { "id": "o_2", "label": "Quiz", "value": "quiz" }
    ],
    "allowOther": true,
    "otherLabel": "Something else",
    "otherPlaceholder": "Describe the form type",
    "multiSelect": false
  }
}

or

{
  "kind": "draft",
  "draft": { ... full form per schema above ... },
  "reasoning": "one short sentence on what you built"
}

Rules for questions:
- Exactly one question.
- 3 to 5 concrete options, each with a clear short label.
- Set allowOther=true unless the options are exhaustive beyond doubt.
- For binary choices, allowOther=false.
- For "pick any that apply", multiSelect=true.
`,
    edit: `
Return STRICT JSON, one of:

{
  "kind": "question",
  "question": { ... same shape as create ... }
}

or

{
  "kind": "draft",
  "draft": { ... the FULL updated form ... },
  "changeSummary": "one short sentence on what changed"
}
`,
    collaborators: `
Return STRICT JSON:

{
  "kind": "collaborators",
  "collaborators": [
    { "email": "a@b.com", "role": "editor", "name": "" }
  ],
  "notes": "one short sentence on what you're adding"
}

or, if the message doesn't contain usable emails:

{
  "kind": "question",
  "question": {
    "id": "q_xxx",
    "text": "Paste the emails to add",
    "options": [
      { "id": "o_1", "label": "Enter emails", "value": "__other__", "isOther": true }
    ],
    "allowOther": true,
    "otherLabel": "Enter emails",
    "otherPlaceholder": "alice@x.com, bob@y.com",
    "multiSelect": false
  }
}
`,
    respond: `
Return STRICT JSON:

{
  "kind": "emails",
  "subject": "string with placeholders",
  "body": "string with placeholders",
  "recipients": [
    {
      "responseId": "...",
      "email": "a@b.com",
      "name": "Alice",
      "previewSubject": "the rendered subject for this recipient",
      "previewBody": "the rendered body for this recipient"
    }
  ],
  "notes": "one short sentence about the tone/audience"
}
`,
  };

  const targetBlocks = [];
  if (targetForm) {
    targetBlocks.push(
      `Target form (JSON):\n${JSON.stringify(
        {
          _id: String(targetForm._id),
          title: targetForm.title,
          description: targetForm.description,
          type: targetForm.type,
          visibility: targetForm.visibility,
          fields: targetForm.fields,
          settings: targetForm.settings,
        },
        null,
        2
      ).slice(0, 14000)}`
    );
  }

  if (mode === "respond" && targetResponses.length) {
    const compact = targetResponses.slice(0, 200).map((r) => ({
      _id: String(r._id),
      email: r.respondentEmail,
      name: r.respondentName,
      submittedAt: r.submittedAt,
      durationSeconds: r.durationSeconds,
      totalScore: r.totalScore,
      maxScore: r.maxScore,
      percentage: r.percentage,
      passed: r.passed,
    }));
    targetBlocks.push(
      `Responses to consider (first ${compact.length} of ${targetResponses.length}):\n${JSON.stringify(compact, null, 2).slice(0, 12000)}`
    );
  }

  const system = `
You are the AI engine behind a form builder. You help users design,
edit, and use forms. You speak in short, direct sentences.

${modeBlocks[mode] || modeBlocks.create}

${FORM_SCHEMA_SPEC}

${schemaHints[mode] || schemaHints.create}

Hard rules:
- Return ONLY the JSON object. No markdown, no code fences, no commentary.
- Question ids and option ids must be unique.
- Use the exact "kind" values spelled above.
- Never invent form fields the user didn't ask about unless they're
  universally expected (title, description). Do not pad.
- Never include scoring unless the user's context is clearly a quiz.
`.trim();

  const historyMessages = history
    .slice(-14)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content || "" }));

  const userBlock = [
    targetBlocks.join("\n\n"),
    forceReady
      ? "USER SAYS: stop asking, use your judgement, produce the draft now."
      : "",
    `User message:\n${userPrompt}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await groqJSONFast({
    messages: [
      { role: "system", content: system },
      ...historyMessages,
      { role: "user", content: userBlock },
    ],
    temperature: 0.4,
    maxTokens: 3000,
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Normalizers
// ─────────────────────────────────────────────────────────────────────
export const normalizeQuestion = (q) => {
  if (!q) return null;
  const options = Array.isArray(q.options)
    ? q.options.slice(0, 6).map((o) => ({
        id: String(o.id || genOptionId()),
        label: String(o.label || o.value || "").slice(0, 200),
        value: String(o.value || o.label || "").slice(0, 200),
        isOther: !!o.isOther,
      }))
    : [];
  const allowOther = q.allowOther !== false;
  return {
    id: String(q.id || genQuestionId()),
    text: String(q.text || "Pick an option").slice(0, 300),
    helper: String(q.helper || "").slice(0, 300),
    options,
    allowOther,
    otherLabel: String(q.otherLabel || "Other").slice(0, 80),
    otherPlaceholder: String(q.otherPlaceholder || "Type your answer").slice(0, 200),
    multiSelect: !!q.multiSelect,
    minSelections: Number.isFinite(Number(q.minSelections)) ? Number(q.minSelections) : 0,
    maxSelections: Number.isFinite(Number(q.maxSelections)) ? Number(q.maxSelections) : 0,
  };
};

export const normalizeDraft = (d = {}) => ({
  title: String(d.title || "Untitled form").slice(0, 200),
  description: String(d.description || "").slice(0, 2000),
  type: ["form", "quiz", "survey", "feedback", "attendance"].includes(d.type)
    ? d.type
    : "form",
  visibility: d.visibility === "private" ? "private" : "public",
  fields: sanitizeFields(d.fields),
  settings: sanitizeSettings(d.settings || {}),
  isMultipage: !!d.isMultipage,
});

export const normalizeCollaborators = (list = []) =>
  list
    .filter((c) => c && typeof c.email === "string" && /@/.test(c.email))
    .map((c) => ({
      email: c.email.trim().toLowerCase(),
      role: c.role === "viewer" ? "viewer" : "editor",
      name: String(c.name || "").slice(0, 120),
      exists: false,
    }));

// ─────────────────────────────────────────────────────────────────────
// Public session shape
// ─────────────────────────────────────────────────────────────────────
export function publicSession(session) {
  const s = session.toObject ? session.toObject() : session;
  return {
    _id: s._id,
    mode: s.mode,
    status: s.status,
    initialPrompt: s.initialPrompt,
    targetFormId: s.targetFormId,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    questionCount: s.questionCount,
    awaitingConfirm: s.awaitingConfirm,
    createdFormId: s.createdFormId,
    messages: (s.messages || []).map((m) => ({
      role: m.role,
      content: m.content,
      meta: m.meta,
      createdAt: m.createdAt,
    })),
    pendingQuestion: s.pendingQuestion || null,
    draft: s.draft || null,
    draftCollaborators: s.draftCollaborators || [],
    draftEmails: s.draftEmails || null,
    sendResult: s.sendResult || null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Core: apply the AI's response to the session state
// ─────────────────────────────────────────────────────────────────────
async function applyAiResult({ session, ai, targetResponses = [] }) {
  if (!ai || typeof ai !== "object") {
    session.status = "error";
    await session.save();
    throw httpError("AI returned an unreadable response.", 502);
  }

  if (ai.kind === "question") {
    const q = normalizeQuestion(ai.question);
    if (!q) {
      session.status = "error";
      await session.save();
      throw httpError("AI sent an empty question.", 502);
    }
    session.questionCount = (session.questionCount || 0) + 1;
    session.pendingQuestion = q;
    session.awaitingConfirm = false;
    session.messages.push({
      role: "assistant",
      content: q.text,
      meta: { kind: "question", question: q },
    });
    await session.save();
    return publicSession(session);
  }

  if (ai.kind === "draft") {
    const draft = normalizeDraft(ai.draft || {});
    session.draft = draft;
    session.pendingQuestion = null;
    session.awaitingConfirm = true;
    session.status = "previewing";
    session.messages.push({
      role: "assistant",
      content: ai.reasoning || ai.changeSummary || "Here's a draft.",
      meta: { kind: "draft", changeSummary: ai.changeSummary || ai.reasoning || "" },
    });
    await session.save();
    return publicSession(session);
  }

  if (ai.kind === "collaborators") {
    const list = normalizeCollaborators(ai.collaborators || []);
    if (list.length) {
      const emails = list.map((c) => c.email);
      const users = await User.find({ email: { $in: emails } })
        .select("email")
        .lean();
      const existing = new Set(users.map((u) => u.email.toLowerCase()));
      for (const c of list) c.exists = existing.has(c.email);
    }
    session.draftCollaborators = list;
    session.pendingQuestion = null;
    session.awaitingConfirm = true;
    session.status = "previewing";
    session.messages.push({
      role: "assistant",
      content: ai.notes || `Ready to add ${list.length} collaborator(s).`,
      meta: { kind: "collaborators", count: list.length },
    });
    await session.save();
    return publicSession(session);
  }

  if (ai.kind === "emails") {
    const subject = String(ai.subject || "").slice(0, 200);
    const body = String(ai.body || "").slice(0, 8000);
    const recipients = [];
    const renderTemplate = (tpl, vars) =>
      String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
        vars[k] == null ? "" : String(vars[k])
      );
    const buildVars = (r) => ({
      name: r.respondentName || (r.respondentEmail ? r.respondentEmail.split("@")[0] : "there"),
      email: r.respondentEmail || "",
      score: r.totalScore ?? "",
      maxScore: r.maxScore ?? "",
      percentage: r.percentage ?? "",
      passed:
        r.passed === true ? "passed" : r.passed === false ? "did not pass" : "",
      duration: r.durationSeconds ? `${r.durationSeconds}s` : "",
      submittedAt: r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : "",
    });

    for (const r of targetResponses) {
      const vars = buildVars(r);
      recipients.push({
        responseId: String(r._id),
        email: r.respondentEmail || "",
        name: r.respondentName || "",
        previewSubject: renderTemplate(subject, vars),
        previewBody: renderTemplate(body, vars),
      });
    }

    session.draftEmails = { subject, bodyTemplate: body, overrides: [], recipients };
    session.pendingQuestion = null;
    session.awaitingConfirm = true;
    session.status = "previewing";
    session.messages.push({
      role: "assistant",
      content: ai.notes || `Ready to email ${recipients.length} people.`,
      meta: { kind: "emails", count: recipients.length },
    });
    await session.save();
    return publicSession(session);
  }

  session.status = "error";
  await session.save();
  throw httpError(`AI returned unknown kind "${ai.kind}".`, 502);
}

// ─────────────────────────────────────────────────────────────────────
// CORE: start a session and get the first AI response
//
// Used by both the HTTP handler and aiController. Returns the public
// session snapshot. Throws on validation errors.
// ─────────────────────────────────────────────────────────────────────
export async function startFormSessionCore({
  userId,
  prompt,
  mode = "create",
  formId = null,
  responseIds = [],
  forceReady = false,
}) {
  const trimmed = String(prompt || "").trim();
  if (!trimmed) throw httpError("prompt is required.", 400);
  if (!["create", "edit", "collaborators", "respond"].includes(mode)) {
    throw httpError(`Unknown mode "${mode}".`, 400);
  }

  let targetForm = null;
  if (mode !== "create") {
    if (!formId || !isObjectId(formId)) {
      throw httpError("formId is required for this mode.", 400);
    }
    targetForm = await Form.findById(formId);
    if (!targetForm) throw httpError("Target form not found.", 404);

    const owned = String(targetForm.owner) === String(userId);
    const collab = targetForm.collaborators.some(
      (c) => String(c.user) === String(userId) && c.role === "editor"
    );
    if (!owned && !collab) {
      throw httpError("You don't have edit access to that form.", 403);
    }
  }

  let targetResponses = [];
  if (mode === "respond") {
    const filter = { form: targetForm._id };
    if (Array.isArray(responseIds) && responseIds.length) {
      filter._id = {
        $in: responseIds.filter(isObjectId).map((x) => new mongoose.Types.ObjectId(x)),
      };
    }
    targetResponses = await FormResponse.find(filter)
      .sort({ submittedAt: -1 })
      .limit(500)
      .lean();
    if (!targetResponses.length) {
      throw httpError("This form has no responses to email.", 400);
    }
  }

  const session = await FormAiSession.create({
    user: userId,
    mode,
    status: "collecting",
    targetFormId: targetForm?._id || null,
    initialPrompt: trimmed,
    targetResponseIds: targetResponses.map((r) => r._id),
  });

  session.messages.push({ role: "user", content: trimmed });

  const ai = await askFormAi({
    mode,
    userPrompt: trimmed,
    history: session.messages,
    targetForm,
    targetResponses,
    questionCount: 0,
    forceReady: !!forceReady,
  });

  return await applyAiResult({ session, ai, targetResponses });
}

// ─────────────────────────────────────────────────────────────────────
// CORE: answer the current pending question
// ─────────────────────────────────────────────────────────────────────
const answerToUserText = (question, answer) => {
  if (!answer) return "(no answer)";
  const parts = [];
  const pickedIds = Array.isArray(answer.optionIds)
    ? answer.optionIds
    : answer.optionId ? [answer.optionId] : [];
  const pickedLabels = [];
  for (const id of pickedIds) {
    const opt = question.options.find((o) => o.id === id);
    if (!opt) continue;
    if (opt.isOther) continue;
    pickedLabels.push(opt.label);
  }
  if (pickedLabels.length) parts.push(pickedLabels.join(", "));
  const other = String(answer.otherText || "").trim();
  if (other) parts.push(other);
  if (answer.skip) parts.push("(skip, use your judgement)");
  return parts.join(" — ") || "(no answer)";
};

export async function answerQuestionCore({ userId, sessionId, answer }) {
  if (!isObjectId(sessionId)) throw httpError("Invalid session id.", 400);
  const session = await FormAiSession.findOne({ _id: sessionId, user: userId });
  if (!session) throw httpError("Session not found.", 404);

  if (session.status !== "collecting") {
    throw httpError("This session is no longer collecting answers.", 409);
  }
  if (!session.pendingQuestion) {
    throw httpError("There's no outstanding question to answer.", 409);
  }

  const userText = answerToUserText(session.pendingQuestion, answer);
  session.messages.push({ role: "user", content: userText, meta: { answer: true } });
  session.pendingQuestion = null;

  let targetForm = null;
  let targetResponses = [];
  if (session.targetFormId) targetForm = await Form.findById(session.targetFormId);
  if (session.mode === "respond" && session.targetResponseIds.length) {
    targetResponses = await FormResponse.find({
      _id: { $in: session.targetResponseIds },
    }).lean();
  }

  const ai = await askFormAi({
    mode: session.mode,
    userPrompt: userText,
    history: session.messages,
    targetForm,
    targetResponses,
    questionCount: session.questionCount,
  });

  return await applyAiResult({ session, ai, targetResponses });
}

// ─────────────────────────────────────────────────────────────────────
// CORE: regenerate draft from free-text feedback
// ─────────────────────────────────────────────────────────────────────
export async function regenerateDraftCore({ userId, sessionId, feedback }) {
  if (!isObjectId(sessionId)) throw httpError("Invalid session id.", 400);
  const session = await FormAiSession.findOne({ _id: sessionId, user: userId });
  if (!session) throw httpError("Session not found.", 404);

  const trimmed = String(feedback || "").trim();
  if (!trimmed) throw httpError("feedback is required.", 400);

  session.messages.push({ role: "user", content: trimmed });
  session.awaitingConfirm = false;
  session.status = "collecting";

  let targetForm = null;
  let targetResponses = [];
  if (session.targetFormId) targetForm = await Form.findById(session.targetFormId);
  if (session.mode === "respond" && session.targetResponseIds.length) {
    targetResponses = await FormResponse.find({
      _id: { $in: session.targetResponseIds },
    }).lean();
  }

  const ai = await askFormAi({
    mode: session.mode,
    userPrompt: trimmed,
    history: session.messages,
    targetForm,
    targetResponses,
    questionCount: session.questionCount,
  });

  return await applyAiResult({ session, ai, targetResponses });
}

// ─────────────────────────────────────────────────────────────────────
// CORE: confirm and apply
// ─────────────────────────────────────────────────────────────────────
export async function confirmSessionCore({ userId, sessionId, overrides = {} }) {
  if (!isObjectId(sessionId)) throw httpError("Invalid session id.", 400);
  const session = await FormAiSession.findOne({ _id: sessionId, user: userId });
  if (!session) throw httpError("Session not found.", 404);

  if (session.status === "done") {
    return { session: publicSession(session), result: { alreadyDone: true } };
  }
  if (session.status === "cancelled") {
    throw httpError("This session was cancelled.", 409);
  }

  let result = {};

  if (session.mode === "create") {
    const draft = { ...(session.draft.toObject?.() || session.draft), ...overrides };
    const clean = normalizeDraft(draft);
    if (!clean.fields.length) {
      throw httpError("The draft has no fields. Add at least one before saving.", 400);
    }

    const form = await Form.create({
      owner: userId,
      title: clean.title,
      description: clean.description,
      type: clean.type,
      visibility: clean.visibility,
      status: "draft",
      slug: crypto.randomBytes(6).toString("hex"),
      fields: clean.fields,
      settings: clean.settings,
      isMultipage: clean.isMultipage,
      sourceConversation: null,
    });

    session.createdFormId = form._id;
    session.status = "done";
    session.awaitingConfirm = false;

    result = {
      form: {
        _id: form._id,
        slug: form.slug,
        title: form.title,
        status: form.status,
        publicUrl: `${frontendUrl()}/forms/${form.slug}`,
        editUrl: `/forms/${form._id}/edit`,
      },
    };
  } else if (session.mode === "edit") {
    const form = await Form.findById(session.targetFormId);
    if (!form) throw httpError("Target form not found.", 404);

    const draft = { ...(session.draft.toObject?.() || session.draft), ...overrides };
    const clean = normalizeDraft(draft);

    form.title = clean.title;
    form.description = clean.description;
    form.type = clean.type;
    form.visibility = clean.visibility;
    form.fields = clean.fields;
    form.settings = clean.settings;
    form.isMultipage = clean.isMultipage;
    await form.save();

    session.status = "done";
    session.awaitingConfirm = false;

    result = {
      form: {
        _id: form._id,
        slug: form.slug,
        title: form.title,
        publicUrl: `${frontendUrl()}/forms/${form.slug}`,
      },
    };
  } else if (session.mode === "collaborators") {
    const form = await Form.findById(session.targetFormId);
    if (!form) throw httpError("Target form not found.", 404);

    const list = normalizeCollaborators(session.draftCollaborators || []);
    const added = [];
    const failed = [];

    for (const c of list) {
      const user = await User.findOne({ email: c.email });
      if (!user) {
        failed.push({ email: c.email, reason: "No Xamut account." });
        continue;
      }
      if (String(user._id) === String(form.owner)) {
        failed.push({ email: c.email, reason: "Already the owner." });
        continue;
      }
      const existing = form.collaborators.find(
        (x) => String(x.user) === String(user._id)
      );
      if (existing) {
        existing.role = c.role;
        added.push({ email: c.email, role: c.role, updated: true });
      } else {
        form.collaborators.push({ user: user._id, role: c.role, addedAt: new Date() });
        added.push({ email: c.email, role: c.role, updated: false });
      }
    }

    await form.save();
    session.status = "done";
    session.awaitingConfirm = false;
    result = { added, failed };
  } else if (session.mode === "respond") {
    const form = await Form.findById(session.targetFormId);
    if (!form) throw httpError("Target form not found.", 404);

    const responses = await FormResponse.find({
      _id: { $in: session.targetResponseIds },
    }).lean();

    const subject = String(overrides.subject || session.draftEmails.subject || "").slice(0, 200);
    const bodyTpl = String(overrides.body || session.draftEmails.bodyTemplate || "");

    if (!subject || !bodyTpl) throw httpError("Subject and body are required to send.", 400);

    const overridesMap = new Map();
    for (const o of session.draftEmails.overrides || []) {
      overridesMap.set(String(o.email).toLowerCase(), o);
    }

    const renderTemplate = (tpl, vars) =>
      String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
        vars[k] == null ? "" : String(vars[k])
      );

    let sent = 0;
    let failed = 0;

    for (const r of responses) {
      if (!r.respondentEmail) {
        failed++;
        continue;
      }
      const vars = {
        name: r.respondentName || r.respondentEmail.split("@")[0],
        email: r.respondentEmail,
        score: r.totalScore ?? "",
        maxScore: r.maxScore ?? "",
        percentage: r.percentage ?? "",
        passed: r.passed === true ? "passed" : r.passed === false ? "did not pass" : "",
        duration: r.durationSeconds ? `${r.durationSeconds}s` : "",
        submittedAt: r.submittedAt ? new Date(r.submittedAt).toLocaleDateString() : "",
      };
      const ov = overridesMap.get(r.respondentEmail.toLowerCase());
      const finalSubject = ov?.subject || renderTemplate(subject, vars);
      const finalBody = ov?.body || renderTemplate(bodyTpl, vars);

      try {
        await sendEmailSafe({
          to: r.respondentEmail,
          subject: finalSubject,
          text: finalBody,
        });
        sent++;
      } catch {
        failed++;
      }
    }

    session.status = "done";
    session.awaitingConfirm = false;
    session.sendResult = {
      sent,
      failed,
      skipped: session.targetResponseIds.length - responses.length,
    };
    result = { sendResult: session.sendResult };
  }

  await session.save();
  return { session: publicSession(session), result };
}

// ─────────────────────────────────────────────────────────────────────
// CORE: patch draft manually
// ─────────────────────────────────────────────────────────────────────
export async function patchDraftCore({ userId, sessionId, patch = {} }) {
  if (!isObjectId(sessionId)) throw httpError("Invalid session id.", 400);
  const session = await FormAiSession.findOne({ _id: sessionId, user: userId });
  if (!session) throw httpError("Session not found.", 404);

  if (session.mode === "create" || session.mode === "edit") {
    const draft = session.draft || {};
    if (typeof patch.title === "string") draft.title = patch.title.slice(0, 200);
    if (typeof patch.description === "string") draft.description = patch.description.slice(0, 2000);
    if (typeof patch.type === "string" && ["form", "quiz", "survey", "feedback", "attendance"].includes(patch.type)) {
      draft.type = patch.type;
    }
    if (patch.visibility === "public" || patch.visibility === "private") {
      draft.visibility = patch.visibility;
    }
    if (Array.isArray(patch.fields)) draft.fields = sanitizeFields(patch.fields);
    if (patch.settings && typeof patch.settings === "object") {
      draft.settings = sanitizeSettings({ ...(draft.settings || {}), ...patch.settings });
    }
    if (typeof patch.isMultipage === "boolean") draft.isMultipage = patch.isMultipage;
    session.draft = draft;
  }

  if (session.mode === "collaborators" && Array.isArray(patch.collaborators)) {
    session.draftCollaborators = normalizeCollaborators(patch.collaborators);
  }

  if (session.mode === "respond" && patch.emails) {
    if (typeof patch.emails.subject === "string") {
      session.draftEmails.subject = patch.emails.subject.slice(0, 200);
    }
    if (typeof patch.emails.body === "string") {
      session.draftEmails.bodyTemplate = patch.emails.body.slice(0, 8000);
    }
  }

  await session.save();
  return publicSession(session);
}

// ─────────────────────────────────────────────────────────────────────
// CORE: cancel
// ─────────────────────────────────────────────────────────────────────
export async function cancelSessionCore({ userId, sessionId }) {
  if (!isObjectId(sessionId)) throw httpError("Invalid session id.", 400);
  const session = await FormAiSession.findOne({ _id: sessionId, user: userId });
  if (!session) throw httpError("Session not found.", 404);
  session.status = "cancelled";
  session.pendingQuestion = null;
  session.awaitingConfirm = false;
  await session.save();
  return publicSession(session);
}

// ─────────────────────────────────────────────────────────────────────
// HTTP HANDLERS — thin wrappers around the core functions
// ─────────────────────────────────────────────────────────────────────
export const startSession = asyncHandler(async (req, res) => {
  const { prompt = "", mode = "create", formId, responseIds = [], forceReady = false } = req.body || {};
  const session = await startFormSessionCore({
    userId: req.user._id,
    prompt,
    mode,
    formId,
    responseIds,
    forceReady,
  });
  res.status(201).json({ success: true, session });
});

export const answerQuestion = asyncHandler(async (req, res) => {
  const { sessionId, answer } = req.body || {};
  const session = await answerQuestionCore({
    userId: req.user._id,
    sessionId,
    answer,
  });
  res.status(200).json({ success: true, session });
});

export const regenerateDraft = asyncHandler(async (req, res) => {
  const { sessionId, feedback = "" } = req.body || {};
  const session = await regenerateDraftCore({
    userId: req.user._id,
    sessionId,
    feedback,
  });
  res.status(200).json({ success: true, session });
});

export const patchDraft = asyncHandler(async (req, res) => {
  const { sessionId, patch = {} } = req.body || {};
  const session = await patchDraftCore({
    userId: req.user._id,
    sessionId,
    patch,
  });
  res.status(200).json({ success: true, session });
});

export const confirmSession = asyncHandler(async (req, res) => {
  const { sessionId, overrides = {} } = req.body || {};
  const { session, result } = await confirmSessionCore({
    userId: req.user._id,
    sessionId,
    overrides,
  });
  res.status(200).json({ success: true, session, result });
});

export const cancelSession = asyncHandler(async (req, res) => {
  const { sessionId } = req.body || {};
  const session = await cancelSessionCore({ userId: req.user._id, sessionId });
  res.status(200).json({ success: true, session });
});

export const getSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    res.status(400);
    throw new Error("Invalid session id.");
  }
  const session = await FormAiSession.findOne({ _id: id, user: req.user._id });
  if (!session) {
    res.status(404);
    throw new Error("Session not found.");
  }
  res.status(200).json({ success: true, session: publicSession(session) });
});

export const listSessions = asyncHandler(async (req, res) => {
  const list = await FormAiSession.find({ user: req.user._id })
    .sort({ updatedAt: -1 })
    .limit(30)
    .select("mode status initialPrompt targetFormId createdFormId createdAt updatedAt")
    .lean();
  res.status(200).json({ success: true, sessions: list });
});

export default {
  startSession,
  answerQuestion,
  regenerateDraft,
  patchDraft,
  confirmSession,
  cancelSession,
  getSession,
  listSessions,
};