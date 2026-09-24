// controllers/formAiController.js
//
// Conversational form builder. Four modes: create, edit, collaborators,
// respond. State lives in Mongo.
//
// IMPORTANT: This file does NOT hardcode field types, form types,
// setting keys, or features. Everything comes from
// ../config/formCapabilities.js. To teach the AI about a new form
// feature, add it to that file — no change needed here.
//
// ── Election handling ────────────────────────────────────────────
// Creating an election is CHEAPER than creating a normal form.
// Obvious election requests skip the giant general schema prompt
// entirely and go straight to extractElectionDraft() — a lean,
// purpose-built ~300-token prompt that only knows how to build
// elections. One cheap call, no back-to-back heavy calls, no
// rate-limit trips, no "0 positions" dead screens.

import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import crypto from "crypto";

import Form from "../models/formModel.js";
import FormResponse from "../models/formResponseModel.js";
import FormAiSession from "../models/formAiSessionModel.js";
import User from "../models/userModel.js";
import { groqJSONFast } from "../utils/xamutAI.js";
import { sendEmailSafe } from "../utils/sendMail.js";

import {
  FORM_TYPE_IDS,
  FIELD_TYPES,
  isChoiceType,
  isMediaType,
  isLayoutType,
  SETTINGS_KEYS,
  FEATURES,
  buildSchemaDocForAI,
  coerceToValidation,
  emptyValidation,
} from "../config/formCapabilities.js";

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const genFieldId = () => `f_${crypto.randomBytes(4).toString("hex")}`;
const genOptionId = () => `o_${crypto.randomBytes(3).toString("hex")}`;
const genQuestionId = () => `q_${crypto.randomBytes(3).toString("hex")}`;
const genPositionId = () => `p_${crypto.randomBytes(4).toString("hex")}`;
const genCandidateId = () => `c_${crypto.randomBytes(4).toString("hex")}`;

const httpError = (msg, statusCode = 400) => {
  const err = new Error(msg);
  err.statusCode = statusCode;
  return err;
};

const frontendUrl = () => (process.env.FRONTEND_URL || "").replace(/\/$/, "");

// ─────────────────────────────────────────────────────────────────────
// Sanitizers — driven by the capability registry
// ─────────────────────────────────────────────────────────────────────

const sanitizeFields = (fields) => {
  if (!Array.isArray(fields)) return [];
  return fields.map((f, idx) => {
    const rawType = f?.type;
    const type = FIELD_TYPES[rawType] ? rawType : "short_text";
    const def = FIELD_TYPES[type];

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
      validation: coerceToValidation(type, f.validation),
    };

    if (isChoiceType(type) && Array.isArray(f.options)) {
      field.options = f.options.map((o, i) => ({
        id: typeof o.id === "string" && o.id ? o.id : genOptionId(),
        label: String(o.label ?? `Option ${i + 1}`).slice(0, 200),
        value: String(o.value ?? o.label ?? "").slice(0, 200),
      }));
    }

    const scoringEligible =
      isChoiceType(type) ||
      type === "short_text" ||
      type === "long_text" ||
      type === "yes_no";

    if (scoringEligible && f.scoring) {
      const correct = Array.isArray(f.scoring.correct)
        ? f.scoring.correct
        : f.scoring.correct != null
        ? [f.scoring.correct]
        : [];
      field.scoring = {
        correct: correct.map((c) => String(c).slice(0, 200)).slice(0, 20),
        points: Number(f.scoring.points) || 0,
      };
    }

    return field;
  });
};

// Generic settings sanitizer driven by SETTINGS_KEYS
const sanitizeSettings = (raw = {}) => {
  const out = {};
  for (const [key, spec] of Object.entries(SETTINGS_KEYS)) {
    const v = raw[key];
    if (spec.type === "boolean") {
      out[key] = v == null ? spec.default : !!v;
    } else if (spec.type === "number") {
      const n = Number(v);
      const fallback = spec.default ?? 0;
      let value = Number.isFinite(n) ? n : fallback;
      if (spec.min != null) value = Math.max(spec.min, value);
      if (spec.max != null) value = Math.min(spec.max, value);
      out[key] = value;
    } else if (spec.type === "array") {
      out[key] = Array.isArray(v) ? v : spec.default ?? [];
    } else {
      // string
      out[key] =
        typeof v === "string"
          ? v.slice(0, spec.max || 1000)
          : spec.default ?? "";
    }
  }
  // requestFields: sanitize each entry if present
  if (Array.isArray(raw.requestFields)) {
    out.requestFields = raw.requestFields
      .slice(0, 10)
      .map((rf, idx) => ({
        id: typeof rf.id === "string" && rf.id ? rf.id : genFieldId(),
        label: String(rf.label || `Field ${idx + 1}`).slice(0, 200),
        type: ["short_text", "long_text", "email", "number", "phone", "url", "date"].includes(
          rf.type
        )
          ? rf.type
          : "short_text",
        required: !!rf.required,
        placeholder: String(rf.placeholder || "").slice(0, 200),
        order: typeof rf.order === "number" ? rf.order : idx,
      }));
  } else {
    out.requestFields = [];
  }
  return out;
};

// Election positions sanitizer — driven by FEATURES.positions
const sanitizePositions = (positions) => {
  if (!Array.isArray(positions)) return [];
  return positions.map((p, idx) => {
    const maxSel = Number.isFinite(Number(p.maxSelections))
      ? Math.max(1, Math.min(20, Number(p.maxSelections)))
      : 1;
    return {
      id: typeof p.id === "string" && p.id ? p.id : genPositionId(),
      title: String(p.title || `Position ${idx + 1}`).slice(0, 200),
      description: String(p.description || "").slice(0, 1000),
      maxSelections: maxSel,
      required: p.required !== false,
      order: typeof p.order === "number" ? p.order : idx,
      candidates: Array.isArray(p.candidates)
        ? p.candidates.map((c, i) => ({
            id: typeof c.id === "string" && c.id ? c.id : genCandidateId(),
            name: String(c.name || "").slice(0, 200),
            bio: String(c.bio || "").slice(0, 2000),
            manifesto: String(c.manifesto || "").slice(0, 5000),
            photoUrl: String(c.photoUrl || "").slice(0, 1000),
            slogan: String(c.slogan || "").slice(0, 200),
            metadata:
              c.metadata && typeof c.metadata === "object" ? c.metadata : {},
            order: typeof c.order === "number" ? c.order : i,
          }))
        : [],
    };
  });
};

// ─────────────────────────────────────────────────────────────────────
// The schema spec — generated from the registry, not hardcoded.
// ─────────────────────────────────────────────────────────────────────
const FORM_SCHEMA_SPEC = buildSchemaDocForAI();

// ─────────────────────────────────────────────────────────────────────
// ELECTION FAST PATH
//
// The general form-building prompt is huge — it has to teach the
// model every field type, feature, setting, plus the shape of a
// position and a worked example. Small models lose the "positions"
// tail when they have to hold all of that at once, and the failure
// mode is type="election" with positions:[].
//
// Fix: for obvious election requests on a fresh create, skip the
// giant prompt entirely and call a lean, purpose-built extractor.
// One cheap call, no back-to-back heavy calls, no rate-limit trips.
// ─────────────────────────────────────────────────────────────────────

const ELECTION_INTENT_RE =
  /\b(election|elect|vote|voting|voter|ballot|candidate|candidates|position|president|chairman|chairperson|treasurer|secretary|governor|senator|mayor|captain|leader|running mate|contest)\b/i;

// Pull a rough title out of the prompt for the fallback case where
// the extractor fails. Best-effort — the user can rename later.
function deriveElectionTitle(prompt) {
  const firstLine = String(prompt || "")
    .split(/\n/)[0]
    .trim();
  if (!firstLine) return "Election";
  const cleaned = firstLine
    .replace(
      /^(i\s+need|i\s+want|make|create|build|give\s+me|set\s+up)\s+(me\s+)?(an?\s+)?/i,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Election";
  const capped =
    cleaned.length > 60 ? cleaned.slice(0, 57) + "..." : cleaned;
  return capped[0].toUpperCase() + capped.slice(1);
}

// Best-effort candidate name extraction for the fallback case.
// Looks for a line with commas/and whose parts start with capitals.
function guessCandidateNames(prompt) {
  const lines = String(prompt || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (!/,/.test(line) && !/\band\b/i.test(line)) continue;
    if (/^(i\s+need|i\s+want|make|create|build|give|set)/i.test(line) && !/,/.test(line))
      continue;

    const cleaned = line
      .replace(/\b(are|is)\s+(the\s+)?candidates?\b.*$/i, "")
      .replace(/\bcandidates?\s*[:–-]\s*/i, "")
      .trim();

    const parts = cleaned
      .split(/\s*,\s*|\s+and\s+/i)
      .map((p) => p.trim())
      .filter((p) => p.length >= 2 && p.length < 60 && /^[A-Z]/.test(p));

    if (parts.length >= 2) return parts;
  }
  return [];
}

// Best-effort position title extraction for the fallback case.
function guessPositionTitle(prompt) {
  const m = String(prompt || "").match(
    /\b(president|chairman|chairperson|chair|secretary|treasurer|governor|senator|mayor|captain|leader|director|prefect)\b/i
  );
  if (!m) return "Position 1";
  const w = m[1].toLowerCase();
  return w[0].toUpperCase() + w.slice(1);
}

// Build a minimal but valid election draft when the extractor fails.
// Always has one position with at least one candidate, so the panel
// shows something creatable and the user isn't stuck on a dead screen.
function buildPlaceholderElectionDraft(userPrompt) {
  const title = guessPositionTitle(userPrompt);
  const names = guessCandidateNames(userPrompt);
  const candidates =
    names.length > 0
      ? names.map((n, i) => ({
          id: genCandidateId(),
          name: n,
          bio: "",
          manifesto: "",
          photoUrl: "",
          slogan: "",
          order: i,
        }))
      : [
          {
            id: genCandidateId(),
            name: "",
            bio: "",
            manifesto: "",
            photoUrl: "",
            slogan: "",
            order: 0,
          },
        ];

  return {
    title: deriveElectionTitle(userPrompt),
    description: "",
    type: "election",
    visibility: "public",
    fields: [],
    positions: [
      {
        id: genPositionId(),
        title,
        description: "",
        maxSelections: 1,
        required: true,
        order: 0,
        candidates,
      },
    ],
    settings: {},
    isMultipage: false,
    startAt: null,
    expiresAt: null,
  };
}

// Lean election extractor. Only knows how to build elections. Fits
// in a few hundred tokens, so it can't get lost.
async function extractElectionDraft({ userPrompt, history = [] }) {
  const historyLines = history
    .slice(-6)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map(
      (m) =>
        `${m.role.toUpperCase()}: ${String(m.content || "").slice(0, 400)}`
    )
    .join("\n");

  const system = `You build election forms. Given a user's request, return ONE JSON object with EXACTLY this shape:

{
  "title": "string (short, human, e.g. 'NACCOS President Election')",
  "description": "string (one short line, e.g. 'Vote for the next NACCOS President.')",
  "positions": [
    {
      "id": "string starting with p_",
      "title": "string (e.g. 'President')",
      "description": "string (can be \\"\\")",
      "maxSelections": 1,
      "required": true,
      "order": 0,
      "candidates": [
        { "id": "string starting with c_", "name": "string", "order": 0 }
      ]
    }
  ]
}

ABSOLUTE RULES (breaking any of these fails the task):
1. "positions" MUST be a NON-EMPTY array. Never [].
2. Every position MUST have "candidates" as a NON-EMPTY array.
3. If the user names any candidates, use those EXACT names, EXACT spelling. One candidate object per name.
4. Never invent candidate names. If none were given, use one candidate with name "".
5. If the user names a single role ("president", "chairman"), produce ONE position with that title.
6. If the user names multiple roles, produce ONE position per role.
7. maxSelections is 1 unless the user explicitly says "pick N" or "vote for N".

Return ONLY the JSON object. No markdown. No commentary.`;

  const user = [
    historyLines ? `Recent conversation:\n${historyLines}\n` : "",
    `User request:\n${userPrompt}`,
  ]
    .filter(Boolean)
    .join("\n");

  const result = await groqJSONFast({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.1,
    maxTokens: 1500,
  });

  return result;
}

function positionsAreGood(positions) {
  if (!Array.isArray(positions) || positions.length === 0) return false;
  return positions.every(
    (p) => Array.isArray(p.candidates) && p.candidates.length > 0
  );
}

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
  // ── Fast path: obvious election create ────────────────────────
  // Skip the giant general schema prompt. Call the lean extractor
  // once. If it works, done. If it fails, hand back a minimal
  // placeholder so the user still has something creatable —
  // NEVER fire a second heavy model call in this branch.
  if (mode === "create" && ELECTION_INTENT_RE.test(userPrompt)) {
    let extracted = null;
    try {
      extracted = await extractElectionDraft({ userPrompt, history });
    } catch (err) {
      console.warn(
        "⚠️ Election extractor threw, using placeholder:",
        err.message
      );
    }

    if (positionsAreGood(extracted?.positions)) {
      console.log(
        `✅ Election fast path — ${extracted.positions.length} position(s).`
      );
      return {
        kind: "draft",
        draft: {
          title: extracted.title || deriveElectionTitle(userPrompt),
          description: extracted.description || "",
          type: "election",
          visibility: "public",
          fields: [],
          positions: extracted.positions,
          settings: {},
          isMultipage: false,
          startAt: null,
          expiresAt: null,
        },
        reasoning: "Election draft",
      };
    }

    console.warn(
      "⚠️ Election extractor returned no positions — using placeholder draft."
    );
    return {
      kind: "draft",
      draft: buildPlaceholderElectionDraft(userPrompt),
      reasoning: "Election draft (placeholder — edit to finish)",
    };
  }

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
- Fill in every detail yourself. The schema spec below lists every
  field type, every feature, every setting. Use them.
- Drafts must be publish-ready. No placeholder text. No "TBD".

WHEN TO ASK (the escape hatch, not the default):
- Only when the request is so vague you'd be inventing the entire
  form from nothing.
- Up to ${MAX_QUESTIONS} questions total. You've asked ${questionCount}.
  You have ${questionsLeft} left.
- Never ask more than one per turn.
- Once ${questionsLeft} reaches 0, draft no matter what.

WHAT NOT TO ASK ABOUT:
- Type, audience, or topic — infer them.
- Anything you were already told in a previous turn.
- Cover photo. The user adds that from the editor afterwards.
- Redirect URL, unless the user didn't already give one. The app asks
  about it after the draft.

MEDIA FIELDS: the schema spec lists "image", "document" and "file".
Use them when the request calls for them.

Tone: a competent colleague. Not a wizard.
`,
    edit: `
MODE: EDIT AN EXISTING FORM

Apply the user's change and return the FULL updated form as a draft.

RULES:
- Return the full form, not a diff.
- Preserve existing ids (fields, positions, candidates) so responses
  stay attached.
- Do not drop anything the user didn't ask to remove.
- Any new field or position must be fully specified.
- Ask a question ONLY if the change is genuinely ambiguous. You have
  ${questionsLeft} question(s) left this session.
- Once ${questionsLeft} reaches 0, draft with your best interpretation.
- If the target form is type="election", the updated draft must still
  have type="election" and a non-empty "positions" array.
`,
    collaborators: `
MODE: ADD COLLABORATORS

The user has a form (see below) and wants to add people as
collaborators. Extract each email and role (editor or viewer). Default
to "editor". Return kind="collaborators".
`,
    respond: `
MODE: COMPOSE EMAILS TO RESPONDENTS

The user has a form and wants to email some or all respondents.
Compose ONE template with placeholders:
  {{name}} {{email}} {{score}} {{maxScore}} {{percentage}}
  {{passed}} {{duration}} {{submittedAt}}
Return kind="emails".
`,
  };

  const schemaHints = {
    create: `
Return STRICT JSON. Two shapes.

DRAFT (return this ~90% of the time):
{
  "kind": "draft",
  "draft": { ...full form per schema spec... },
  "reasoning": "one short sentence"
}

QUESTION (only when the request is too vague to draft, and only while
questionsLeft > 0):
{
  "kind": "question",
  "question": {
    "id": "q_xxx",
    "text": "specific question referencing their actual request",
    "helper": "optional one-line explanation",
    "options": [
      { "id": "o_1", "label": "Concrete option A", "value": "a" }
    ],
    "allowOther": true,
    "otherPlaceholder": "Describe it",
    "multiSelect": false
  }
}
`,
    edit: `
Return STRICT JSON, one of:
{
  "kind": "draft",
  "draft": { ...the FULL updated form... },
  "changeSummary": "one short sentence"
}
or, only if genuinely ambiguous AND questionsLeft > 0:
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
  "notes": "one short sentence"
}
Or, if no usable emails:
{
  "kind": "question",
  "question": {
    "id": "q_xxx",
    "text": "Paste the emails to add",
    "options": [],
    "allowOther": true,
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
    { "responseId": "...", "email": "a@b.com", "name": "Alice" }
  ],
  "notes": "one short sentence"
}
`,
  };

  const targetBlocks = [];
  if (targetForm) {
    // Serialize the form in a way that automatically includes any new
    // registry-driven fields (positions, startAt, expiresAt, everything).
    const projected = {
      _id: String(targetForm._id),
      title: targetForm.title,
      description: targetForm.description,
      type: targetForm.type,
      visibility: targetForm.visibility,
      fields: targetForm.fields,
      positions: targetForm.positions,
      startAt: targetForm.startAt,
      expiresAt: targetForm.expiresAt,
      settings: targetForm.settings,
    };
    targetBlocks.push(
      `Target form (JSON):\n${JSON.stringify(projected, null, 2).slice(0, 16000)}`
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

${modeBlocks[mode] || modeBlocks.create}

${FORM_SCHEMA_SPEC}

${schemaHints[mode] || schemaHints.create}

Hard rules:
- Return ONLY the JSON object. No markdown, no code fences, no commentary.
- Question ids, option ids, position ids, candidate ids must be unique.
- Use the exact "kind" values above.
- Never ask a question when questionsLeft is 0. Draft instead.
- Never include scoring unless the context is clearly a quiz.
- Never invent real people as candidates. Empty names are fine.
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

  // Safety net — if the model asked anyway when it shouldn't have,
  // force one more turn demanding a draft.
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
        { role: "assistant", content: JSON.stringify(result) },
        {
          role: "user",
          content:
            "You've used all your clarifying questions. Produce the draft now. Return only the JSON draft object.",
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
  return {
    id: String(q.id || genQuestionId()),
    text: String(q.text || "Pick an option").slice(0, 300),
    helper: String(q.helper || "").slice(0, 300),
    options,
    allowOther: q.allowOther !== false,
    otherLabel: String(q.otherLabel || "Other").slice(0, 80),
    otherPlaceholder: String(q.otherPlaceholder || "Type your answer").slice(0, 200),
    multiSelect: !!q.multiSelect,
  };
};

export const normalizeDraft = (d = {}) => {
  // Registry-driven: only accept form types the registry declares.
  const type = FORM_TYPE_IDS.includes(d.type) ? d.type : "form";
  const isElection = type === "election";

  return {
    title: String(d.title || "Untitled form").slice(0, 200),
    description: String(d.description || "").slice(0, 2000),
    type,
    visibility: d.visibility === "private" ? "private" : "public",
    // Fields only for non-election forms
    fields: isElection ? [] : sanitizeFields(d.fields),
    // Positions only for election forms
    positions: isElection ? sanitizePositions(d.positions) : [],
    settings: sanitizeSettings(d.settings || {}),
    isMultipage: !!d.isMultipage,
    // Timing — passthrough, normalizer keeps values as ISO or null
    startAt: d.startAt ? new Date(d.startAt).toISOString() : null,
    expiresAt: d.expiresAt ? new Date(d.expiresAt).toISOString() : null,
  };
};

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
// Core: apply the AI's response
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
      meta: {
        kind: "draft",
        changeSummary: ai.changeSummary || ai.reasoning || "",
      },
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
    const renderTemplate = (tpl, vars) =>
      String(tpl || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) =>
        vars[k] == null ? "" : String(vars[k])
      );
    const buildVars = (r) => ({
      name:
        r.respondentName ||
        (r.respondentEmail ? r.respondentEmail.split("@")[0] : "there"),
      email: r.respondentEmail || "",
      score: r.totalScore ?? "",
      maxScore: r.maxScore ?? "",
      percentage: r.percentage ?? "",
      passed:
        r.passed === true
          ? "passed"
          : r.passed === false
          ? "did not pass"
          : "",
      duration: r.durationSeconds ? `${r.durationSeconds}s` : "",
      submittedAt: r.submittedAt
        ? new Date(r.submittedAt).toLocaleDateString()
        : "",
    });

    const recipients = targetResponses.map((r) => {
      const vars = buildVars(r);
      return {
        responseId: String(r._id),
        email: r.respondentEmail || "",
        name: r.respondentName || "",
        previewSubject: renderTemplate(subject, vars),
        previewBody: renderTemplate(body, vars),
      };
    });

    session.draftEmails = {
      subject,
      bodyTemplate: body,
      overrides: [],
      recipients,
    };
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
// CORE: start session
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
        $in: responseIds
          .filter(isObjectId)
          .map((x) => new mongoose.Types.ObjectId(x)),
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
// CORE: answer current pending question
// ─────────────────────────────────────────────────────────────────────
const answerToUserText = (question, answer) => {
  if (!answer) return "(no answer)";
  const parts = [];
  const pickedIds = Array.isArray(answer.optionIds)
    ? answer.optionIds
    : answer.optionId
    ? [answer.optionId]
    : [];
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
  const session = await FormAiSession.findOne({
    _id: sessionId,
    user: userId,
  });
  if (!session) throw httpError("Session not found.", 404);
  if (session.status !== "collecting") {
    throw httpError("This session is no longer collecting answers.", 409);
  }
  if (!session.pendingQuestion) {
    throw httpError("There's no outstanding question to answer.", 409);
  }

  const userText = answerToUserText(session.pendingQuestion, answer);
  session.messages.push({
    role: "user",
    content: userText,
    meta: { answer: true },
  });
  session.pendingQuestion = null;

  let targetForm = null;
  let targetResponses = [];
  if (session.targetFormId)
    targetForm = await Form.findById(session.targetFormId);
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
// CORE: regenerate draft from feedback
// ─────────────────────────────────────────────────────────────────────
export async function regenerateDraftCore({ userId, sessionId, feedback }) {
  if (!isObjectId(sessionId)) throw httpError("Invalid session id.", 400);
  const session = await FormAiSession.findOne({
    _id: sessionId,
    user: userId,
  });
  if (!session) throw httpError("Session not found.", 404);

  const trimmed = String(feedback || "").trim();
  if (!trimmed) throw httpError("feedback is required.", 400);

  session.messages.push({ role: "user", content: trimmed });
  session.awaitingConfirm = false;
  session.status = "collecting";

  let targetForm = null;
  let targetResponses = [];
  if (session.targetFormId)
    targetForm = await Form.findById(session.targetFormId);
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
export async function confirmSessionCore({
  userId,
  sessionId,
  overrides = {},
}) {
  if (!isObjectId(sessionId)) throw httpError("Invalid session id.", 400);
  const session = await FormAiSession.findOne({
    _id: sessionId,
    user: userId,
  });
  if (!session) throw httpError("Session not found.", 404);

  if (session.status === "done") {
    return {
      session: publicSession(session),
      result: { alreadyDone: true },
    };
  }
  if (session.status === "cancelled") {
    throw httpError("This session was cancelled.", 409);
  }

  let result = {};

  if (session.mode === "create") {
    const draft = {
      ...(session.draft.toObject?.() || session.draft),
      ...overrides,
    };
    const clean = normalizeDraft(draft);
    const isElection = clean.type === "election";

    if (isElection && !clean.positions.length) {
      throw httpError(
        "An election needs at least one position before saving.",
        400
      );
    }
    if (!isElection && !clean.fields.length) {
      throw httpError(
        "The draft has no fields. Add at least one before saving.",
        400
      );
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
      positions: clean.positions,
      settings: clean.settings,
      isMultipage: clean.isMultipage,
      startAt: clean.startAt,
      expiresAt: clean.expiresAt,
      sourceConversation: null,
    });

    session.createdFormId = form._id;
    session.status = "done";
    session.awaitingConfirm = false;

    const mediaCount = (form.fields || []).filter((f) =>
      isMediaType(f.type)
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
        positionsCount: isElection ? (form.positions || []).length : 0,
        isElection,
      },
    };
  } else if (session.mode === "edit") {
    const form = await Form.findById(session.targetFormId);
    if (!form) throw httpError("Target form not found.", 404);

    const draft = {
      ...(session.draft.toObject?.() || session.draft),
      ...overrides,
    };
    const clean = normalizeDraft(draft);
    const isElection = clean.type === "election";

    form.title = clean.title;
    form.description = clean.description;
    form.type = clean.type;
    form.visibility = clean.visibility;
    form.fields = isElection ? [] : clean.fields;
    form.positions = isElection ? clean.positions : [];
    form.settings = clean.settings;
    form.isMultipage = clean.isMultipage;
    form.startAt = clean.startAt;
    form.expiresAt = clean.expiresAt;
    await form.save();

    session.status = "done";
    session.awaitingConfirm = false;

    const mediaCount = (form.fields || []).filter((f) =>
      isMediaType(f.type)
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
        positionsCount: isElection ? (form.positions || []).length : 0,
        isElection,
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
        form.collaborators.push({
          user: user._id,
          role: c.role,
          addedAt: new Date(),
        });
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

    const subject = String(
      overrides.subject || session.draftEmails.subject || ""
    ).slice(0, 200);
    const bodyTpl = String(
      overrides.body || session.draftEmails.bodyTemplate || ""
    );
    if (!subject || !bodyTpl) {
      throw httpError("Subject and body are required to send.", 400);
    }

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
        passed:
          r.passed === true
            ? "passed"
            : r.passed === false
            ? "did not pass"
            : "",
        duration: r.durationSeconds ? `${r.durationSeconds}s` : "",
        submittedAt: r.submittedAt
          ? new Date(r.submittedAt).toLocaleDateString()
          : "",
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
  const session = await FormAiSession.findOne({
    _id: sessionId,
    user: userId,
  });
  if (!session) throw httpError("Session not found.", 404);

  if (session.mode === "create" || session.mode === "edit") {
    const draft = session.draft || {};
    if (typeof patch.title === "string") draft.title = patch.title.slice(0, 200);
    if (typeof patch.description === "string")
      draft.description = patch.description.slice(0, 2000);
    if (typeof patch.type === "string" && FORM_TYPE_IDS.includes(patch.type))
      draft.type = patch.type;
    if (patch.visibility === "public" || patch.visibility === "private")
      draft.visibility = patch.visibility;
    if (Array.isArray(patch.fields)) draft.fields = sanitizeFields(patch.fields);
    if (Array.isArray(patch.positions))
      draft.positions = sanitizePositions(patch.positions);
    if (patch.settings && typeof patch.settings === "object") {
      draft.settings = sanitizeSettings({
        ...(draft.settings || {}),
        ...patch.settings,
      });
    }
    if (typeof patch.isMultipage === "boolean")
      draft.isMultipage = patch.isMultipage;
    if (patch.startAt === null) draft.startAt = null;
    else if (patch.startAt)
      draft.startAt = new Date(patch.startAt).toISOString();
    if (patch.expiresAt === null) draft.expiresAt = null;
    else if (patch.expiresAt)
      draft.expiresAt = new Date(patch.expiresAt).toISOString();

    session.draft = draft;
  }

  if (session.mode === "collaborators" && Array.isArray(patch.collaborators)) {
    session.draftCollaborators = normalizeCollaborators(patch.collaborators);
  }

  if (session.mode === "respond" && patch.emails) {
    if (typeof patch.emails.subject === "string")
      session.draftEmails.subject = patch.emails.subject.slice(0, 200);
    if (typeof patch.emails.body === "string")
      session.draftEmails.bodyTemplate = patch.emails.body.slice(0, 8000);
  }

  await session.save();
  return publicSession(session);
}

// ─────────────────────────────────────────────────────────────────────
// CORE: cancel
// ─────────────────────────────────────────────────────────────────────
export async function cancelSessionCore({ userId, sessionId }) {
  if (!isObjectId(sessionId)) throw httpError("Invalid session id.", 400);
  const session = await FormAiSession.findOne({
    _id: sessionId,
    user: userId,
  });
  if (!session) throw httpError("Session not found.", 404);
  session.status = "cancelled";
  session.pendingQuestion = null;
  session.awaitingConfirm = false;
  await session.save();
  return publicSession(session);
}

// ─────────────────────────────────────────────────────────────────────
// HTTP handlers
// ─────────────────────────────────────────────────────────────────────
export const startSession = asyncHandler(async (req, res) => {
  const {
    prompt = "",
    mode = "create",
    formId,
    responseIds = [],
    forceReady = false,
  } = req.body || {};
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
  const session = await cancelSessionCore({
    userId: req.user._id,
    sessionId,
  });
  res.status(200).json({ success: true, session });
});

export const getSession = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) throw new Error("Invalid session id.");
  const session = await FormAiSession.findOne({
    _id: id,
    user: req.user._id,
  });
  if (!session) throw new Error("Session not found.");
  res.status(200).json({ success: true, session: publicSession(session) });
});

export const listSessions = asyncHandler(async (req, res) => {
  const list = await FormAiSession.find({ user: req.user._id })
    .sort({ updatedAt: -1 })
    .limit(30)
    .select(
      "mode status initialPrompt targetFormId createdFormId createdAt updatedAt"
    )
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