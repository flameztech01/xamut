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
//
// Behaviour notes (v2):
//   • The AI drafts by default. It only asks questions when the prompt
//     is genuinely under-specified, and it may ask at most MAX_QUESTIONS
//     across a whole session.
//   • Questions are dynamic. Their options reference the user's actual
//     request, never a generic menu of "survey / quiz / form" defaults.
//   • The AI fills in EVERYTHING when drafting: validation, options,
//     scoring, required flags, placeholders. Drafts come out publish-ready.
//   • Media fields: `image` for photos, `document` for PDFs/CVs/etc,
//     `file` only when the user wants "any file" and hasn't narrowed it.

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
// Field / settings sanitizers
// ─────────────────────────────────────────────────────────────────────
const FIELD_TYPES = new Set([
  "short_text", "long_text", "email", "number", "date", "time",
  "url", "phone", "radio", "checkbox", "dropdown", "multi_select",
  "rating", "scale", "yes_no",
  "file", "image", "document",
  "section",
]);

const CHOICE_TYPES = new Set(["radio", "checkbox", "dropdown", "multi_select"]);

// Media fields collect uploaded files. They need `maxFiles` set so the
// editor and the respondent UI know how many attachments to allow.
const MEDIA_TYPES = new Set(["file", "image", "document"]);

const sanitizeFields = (fields) => {
  if (!Array.isArray(fields)) return [];
  return fields.map((f, idx) => {
    const type = FIELD_TYPES.has(f?.type) ? f.type : "short_text";
    const isMedia = MEDIA_TYPES.has(type);

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
      validation: {
        min: null,
        max: null,
        minLength: null,
        maxLength: null,
        pattern: null,
        // Only meaningful for file / image / document. Defaults to 1.
        maxFiles: isMedia ? 1 : null,
      },
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
        maxFiles: isMedia
          ? Number.isFinite(Number(v.maxFiles))
            ? Math.min(10, Math.max(1, Number(v.maxFiles)))
            : 1
          : null,
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
      rating | scale | yes_no |
      file | image | document |
      section,
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
    "pattern": string | null,
    "maxFiles": number | null
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
- A "section" is a divider. It has a label and description but no
  options, no required flag, no validation, no scoring.
- Every choice field (radio / checkbox / dropdown / multi_select) must
  have at least two options, with stable ids and non-empty, lowercase,
  space-free values (use snake_case or kebab-case).
- For quizzes, populate scoring.correct with the correct option.value(s)
  and set points per question (default 1 per question).
- Text fields MUST have sensible minLength and maxLength. Never leave
  both null.
- Number, rating, and scale fields MUST have min and max set. Rating
  defaults 1-5, scale defaults 1-10, plain numbers are context-specific.
- Email, URL, and phone fields do not need min/max.
- Labels must be short and human. Never duplicate the label text into
  the description. Never use placeholders like "Question 1" or
  "Option A" unless the user explicitly asked for filler.
- Every field in a draft must be publish-ready. Real content, real
  validation, real options.

Media fields (file | image | document) — read this carefully:
- "image"   → collect photos, pictures, screenshots, selfies, product
              shots, artwork, posters, receipts photographed, etc.
              Set validation.maxFiles (1 for a single upload, up to 10).
- "document"→ collect PDFs, Word docs, CVs, résumés, spreadsheets,
              slide decks, essays, invoices, contracts, ID scans, etc.
              Set validation.maxFiles (1 for a single upload, up to 10).
- "file"    → generic catch-all. Only use when the user asked for
              "any file" and hasn't narrowed it down. Set maxFiles.
- Media fields have NO options, NO scoring, NO min/max/minLength/
  maxLength. Only validation.maxFiles matters.
- Add a short, helpful description so respondents know what to upload
  and any size/format expectations (e.g. "PDF only, max 5MB").

Settings notes:
- "successRedirectUrl" is where respondents go after submitting. Use
  it when the user mentions a WhatsApp group, Telegram channel, a
  thank-you page, a website, or any post-submission destination.
- "confirmationMessage" is shown briefly before any redirect, so keep
  it short and warm.
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
  const MAX_QUESTIONS = 3;
  const questionsLeft = Math.max(0, MAX_QUESTIONS - questionCount);

  const modeBlocks = {
    create: `
MODE: CREATE A NEW FORM

You build forms. You are not running an interview. The user's first
message is almost always enough to build something good.

DEFAULT BEHAVIOUR:
- If the message gives you ANY signal about the form's purpose, topic,
  type, audience, or content, produce the full draft IMMEDIATELY.
- Fill in every detail yourself: title, description, field labels,
  placeholders, required flags, validation (min, max, minLength,
  maxLength, maxFiles for media fields), options for choice fields,
  scoring for quizzes, confirmation message, settings. Everything.
- Drafts must be publish-ready. No placeholder text. No "TBD". No
  "Question 1" labels.

WHEN TO ASK (the escape hatch, not the default):
- Only when the request is so vague you'd be inventing the entire
  form from nothing (e.g. "make me a form" with literally nothing
  else, or "set up something for the thing").
- You may ask up to ${MAX_QUESTIONS} questions total across this
  session. You have already asked ${questionCount}. You have
  ${questionsLeft} left.
- Never ask more than one question per turn.
- Once ${questionsLeft} reaches 0, you MUST produce the draft. No
  more questions.

WHAT NOT TO ASK ABOUT (already known or inferable):
- Type — infer from context. "Exam" → quiz. "RSVP" → form. "Feedback
  on the workshop" → feedback. Do not ask "what type of form is this?"
  when the answer is sitting in the sentence.
- Audience — infer from context. "My students" → students. "The team"
  → team members. Do not ask.
- Topic — it's in the message. Do not ask for it back.
- Anything you were already told in a previous turn of this session.

MEDIA FIELDS — use them when the content calls for them:
- If the request is about collecting photos (photos of a product, a
  recipe, a selfie, an artwork, a screenshot, a receipt), use type
  "image".
- If the request is about collecting documents (a CV, a résumé, an
  application form, an assignment, an invoice, an essay, a PDF), use
  type "document".
- Use "file" only when the user wants "any file" and hasn't narrowed
  it down.
- Set validation.maxFiles (1 for one upload, more if they want
  several). Add a short description telling the respondent what to
  attach (e.g. "PDF only, one file, max 5MB").

DO NOT ASK ABOUT:
- Cover photo. The user adds that from the editor after the form
  exists. You cannot upload it. Do not ask.
- Redirect URL. Do not ask about it either — the app handles that
  in a follow-up message after you draft. If the user's original
  request ALREADY mentions a destination (WhatsApp group, Telegram,
  thank-you page, website), set settings.successRedirectUrl directly
  in the draft. Otherwise leave it empty.

QUESTION QUALITY (when you do ask):
- Questions must be specific to THIS request. If the user said "sign-up
  sheet for the team BBQ", a good question is "What info should each
  person provide? (name only / name + dietary / name + dietary + guests
  / all of that plus phone)". A bad question is "What type of form is
  this?".
- Options must be concrete and tailored, 3-5 of them, with a real
  "other" escape.
- Never re-ask for information already given.

Tone: a competent colleague who hears "sign-up sheet for the BBQ" and
just makes one. Not a wizard asking what a sign-up sheet is.
`,
    edit: `
MODE: EDIT AN EXISTING FORM

The user has an existing form (see the JSON below). They've described a
change. Apply it and return the FULL updated form as a draft.

RULES:
- Return the full form, not a diff.
- Preserve existing field ids when editing in place so prior responses
  stay attached to the right question.
- Do not drop fields the user didn't ask to remove.
- Any new field must be fully specified the same way a create draft is
  (validation, options, required flag, placeholder, etc). This includes
  media fields: set validation.maxFiles and a good description.
- If the user asks to add a redirect URL, set settings.successRedirectUrl.
- Ask a clarifying question ONLY if the request is genuinely ambiguous
  and you cannot pick a sensible default (e.g. "change the colors" with
  no colors named). At most one question, and only if you have
  questions left this session.
- You have ${questionsLeft} clarifying question(s) left this session.
- Once ${questionsLeft} reaches 0, you MUST draft with your best
  interpretation. Pick a sensible default and note it in changeSummary.
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
Return STRICT JSON. Two possible shapes.

DRAFT (this is what you return ~90% of the time):

{
  "kind": "draft",
  "draft": { ...full form per schema above... },
  "reasoning": "one short sentence on what you built"
}

QUESTION (only when the request is genuinely too vague to draft, and
only while you still have questions left):

{
  "kind": "question",
  "question": {
    "id": "q_xxx",
    "text": "specific question referencing their actual request",
    "helper": "optional one-line explanation",
    "options": [
      { "id": "o_1", "label": "Concrete option A", "value": "a" },
      { "id": "o_2", "label": "Concrete option B", "value": "b" }
    ],
    "allowOther": true,
    "otherLabel": "Something else",
    "otherPlaceholder": "Describe it",
    "multiSelect": false
  }
}

Draft rules — apply to every single draft:
- Title: short, real, taken from the user's request.
- Description: one sentence on what the form is for.
- Fields: usually 4-10 depending on complexity. Do not pad. Do not
  under-build either — a real exam has real questions.
- Every field MUST have: label, description (optional), placeholder
  (for text inputs), required flag, and full validation.
- Text fields: set minLength and maxLength (names 1-80, paragraphs
  10-2000, etc). Never leave both null.
- Number / rating / scale: set min and max. Rating 1-5. Scale 1-10.
  Number is context-specific (e.g. age 0-120).
- Choice fields: 3-6 options with clean lowercase values
  (snake_case or kebab-case, no spaces).
- Media fields (file / image / document): set validation.maxFiles
  (1 for one upload, up to 10 if they want several), write a clear
  description telling the respondent what to attach.
- Quiz scoring: populate scoring.correct with the correct
  option.value(s) and set points (default 1 per question).
- Required: true for essential fields, false for clearly optional ones.
- Settings: set sensible defaults — collectEmail if the form collects
  contact info, allowMultipleSubmissions false for exams, true for
  feedback, showProgressBar true for forms with 5+ fields,
  showScoreImmediately true for quizzes, passPercentage 60 for quizzes
  unless the user specified one. If the user mentioned a destination
  for after submission (WhatsApp group, Telegram, website, thank-you
  page), set settings.successRedirectUrl to that URL.

Question rules — apply to every question:
- Exactly one question.
- 3-5 concrete options, each referencing the user's actual request.
- Set allowOther=true unless the options are exhaustive beyond doubt.
- Never ask about type, audience, or topic — infer them.
- Never ask about cover photos or redirect URLs — those are handled
  by the app after the draft.
`,
    edit: `
Return STRICT JSON, one of:

{
  "kind": "draft",
  "draft": { ...the FULL updated form... },
  "changeSummary": "one short sentence on what changed"
}

or, ONLY if the change is genuinely ambiguous AND you still have
questions left:

{
  "kind": "question",
  "question": { ...same shape as create... }
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

You are biased toward action. Your default is to BUILD, not to ask.
Users who wanted an interview would say so. When in doubt, draft.

${modeBlocks[mode] || modeBlocks.create}

${FORM_SCHEMA_SPEC}

${schemaHints[mode] || schemaHints.create}

Hard rules:
- Return ONLY the JSON object. No markdown, no code fences, no commentary.
- Question ids and option ids must be unique.
- Use the exact "kind" values spelled above.
- Never invent form fields the user didn't ask about unless they're
  universally expected (title, description) or clearly implied by the
  form's purpose (a "name" field on an RSVP, a "score" on a quiz).
- Never include scoring unless the context is clearly a quiz or exam.
- Never ask a question when questionsLeft is 0. Draft instead.
`.trim();

  const historyMessages = history
    .slice(-14)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content || "" }));

  const userBlock = [
    targetBlocks.join("\n\n"),
    forceReady || questionsLeft === 0
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
    maxTokens: 4000,
  });

  // Safety net — if the model asks a question anyway but we've hit the
  // cap, force one more turn with an explicit draft demand.
  if (
    (questionsLeft === 0 || forceReady) &&
    result &&
    result.kind === "question"
  ) {
    const retry = await groqJSONFast({
      messages: [
        { role: "system", content: system },
        ...historyMessages,
        { role: "user", content: userBlock },
        {
          role: "assistant",
          content: JSON.stringify(result),
        },
        {
          role: "user",
          content:
            "You've used all your clarifying questions. Produce the draft now with your best judgement. Return only the JSON draft object.",
        },
      ],
      temperature: 0.4,
      maxTokens: 4000,
    });
    if (retry && retry.kind === "draft") return retry;
  }

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

    const mediaCount = (form.fields || []).filter((f) =>
      ["file", "image", "document"].includes(f.type)
    ).length;

    result = {
      form: {
        _id: form._id,
        slug: form.slug,
        title: form.title,
        status: form.status,
        publicUrl: `${frontendUrl()}/forms/${form.slug}`,
        editUrl: `/forms/${form._id}/edit`,
      },
      hints: {
        canAddCoverPhoto: !form.coverPhoto,
        hasRedirect: !!form.settings?.successRedirectUrl,
        redirectUrl: form.settings?.successRedirectUrl || "",
        mediaFieldsCount: mediaCount,
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

    const mediaCount = (form.fields || []).filter((f) =>
      ["file", "image", "document"].includes(f.type)
    ).length;

    result = {
      form: {
        _id: form._id,
        slug: form.slug,
        title: form.title,
        publicUrl: `${frontendUrl()}/forms/${form.slug}`,
      },
      hints: {
        canAddCoverPhoto: !form.coverPhoto,
        hasRedirect: !!form.settings?.successRedirectUrl,
        redirectUrl: form.settings?.successRedirectUrl || "",
        mediaFieldsCount: mediaCount,
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