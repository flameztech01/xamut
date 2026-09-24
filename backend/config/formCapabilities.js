// config/formCapabilities.js
//
// Single source of truth for what forms can do.
//
// ADD A NEW FEATURE HERE. Mongoose schemas, the form controller,
// the form AI, and the chat intent classifier all read from this
// file and adapt automatically. Do not hardcode anything downstream
// that this file already declares.

// ═════════════════════════════════════════════════════════════════════
// FORM TYPES
// ═════════════════════════════════════════════════════════════════════
export const FORM_TYPES = {
  form: {
    label: "Form",
    hint: "generic fill-in form for collecting any kind of info",
    signalWords: ["form", "sheet", "intake", "RSVP", "sign-up", "registration"],
    asksQuestions: true,
    hasScoring: false,
    hasPositions: false,
  },
  quiz: {
    label: "Quiz",
    hint: "scored questions with right/wrong answers",
    signalWords: ["quiz", "exam", "test", "assessment", "practice test"],
    asksQuestions: true,
    hasScoring: true,
    hasPositions: false,
  },
  survey: {
    label: "Survey",
    hint: "opinions and feedback at scale",
    signalWords: ["survey", "poll of opinion", "questionnaire"],
    asksQuestions: true,
    hasScoring: false,
    hasPositions: false,
  },
  feedback: {
    label: "Feedback",
    hint: "reviews, ratings, comments about a thing",
    signalWords: ["feedback", "review", "rating form"],
    asksQuestions: true,
    hasScoring: false,
    hasPositions: false,
  },
  attendance: {
    label: "Attendance",
    hint: "track who showed up to an event",
    signalWords: ["attendance", "roll call", "check-in"],
    asksQuestions: true,
    hasScoring: false,
    hasPositions: false,
  },
  election: {
    label: "Election",
    hint:
      "voters pick candidates for one or more positions (President, DOS, etc). No right/wrong answers, no scoring.",
    signalWords: [
      "election",
      "vote",
      "voting",
      "ballot",
      "poll to elect",
      "choose a president",
      "pick candidates",
      "position",
      "candidate",
    ],
    asksQuestions: false, // uses positions, not fields
    hasScoring: false,
    hasPositions: true,
  },
};

// ═════════════════════════════════════════════════════════════════════
// FIELD TYPES
// ═════════════════════════════════════════════════════════════════════
export const FIELD_TYPES = {
  // ── text ──────────────────────────────────────────────────────
  short_text: {
    label: "Short answer",
    category: "text",
    answerShape: "string",
    validationKeys: ["minLength", "maxLength"],
    ai: {
      useWhen: "short single-line answers like names, IDs, titles",
      examplePlaceholder: "Your answer",
      defaultValidation: { minLength: 1, maxLength: 200 },
    },
  },
  long_text: {
    label: "Paragraph",
    category: "text",
    answerShape: "string",
    validationKeys: ["minLength", "maxLength"],
    ai: {
      useWhen: "essay-style answers, reasons, descriptions",
      examplePlaceholder: "Your answer",
      defaultValidation: { minLength: 10, maxLength: 2000 },
    },
  },
  email: {
    label: "Email",
    category: "text",
    answerShape: "string",
    validationKeys: [],
    ai: {
      useWhen: "collecting email addresses",
      examplePlaceholder: "you@example.com",
      defaultValidation: {},
    },
  },
  phone: {
    label: "Phone",
    category: "text",
    answerShape: "string",
    validationKeys: [],
    ai: {
      useWhen: "collecting phone numbers",
      examplePlaceholder: "+234 800 000 0000",
      defaultValidation: {},
    },
  },
  url: {
    label: "URL",
    category: "text",
    answerShape: "string",
    validationKeys: [],
    ai: {
      useWhen: "collecting links (portfolios, websites, socials)",
      examplePlaceholder: "https://…",
      defaultValidation: {},
    },
  },
  number: {
    label: "Number",
    category: "number",
    answerShape: "number",
    validationKeys: ["min", "max"],
    ai: {
      useWhen: "numeric answers like age, quantity, marks",
      examplePlaceholder: "0",
      defaultValidation: { min: 0, max: 120 },
    },
  },

  // ── choice ────────────────────────────────────────────────────
  radio: {
    label: "Multiple choice",
    category: "choice",
    answerShape: "string",
    validationKeys: [],
    ai: {
      useWhen: "pick exactly one from a short list",
      defaultValidation: {},
      minOptions: 2,
      maxOptions: 8,
    },
  },
  checkbox: {
    label: "Checkboxes",
    category: "choice",
    answerShape: "string[]",
    validationKeys: [],
    ai: {
      useWhen: "pick any number from a list",
      defaultValidation: {},
      minOptions: 2,
      maxOptions: 10,
    },
  },
  dropdown: {
    label: "Dropdown",
    category: "choice",
    answerShape: "string",
    validationKeys: [],
    ai: {
      useWhen: "pick one from a longer list (5+) where a dropdown saves space",
      defaultValidation: {},
      minOptions: 3,
      maxOptions: 20,
    },
  },
  multi_select: {
    label: "Multi-select",
    category: "choice",
    answerShape: "string[]",
    validationKeys: [],
    ai: {
      useWhen: "same as checkbox but presented as a compact multi-pick list",
      defaultValidation: {},
      minOptions: 3,
      maxOptions: 15,
    },
  },
  yes_no: {
    label: "Yes / No",
    category: "choice",
    answerShape: "boolean",
    validationKeys: [],
    ai: {
      useWhen: "binary questions (do you agree, will you attend)",
      defaultValidation: {},
    },
  },
  rating: {
    label: "Rating",
    category: "scale",
    answerShape: "number",
    validationKeys: ["min", "max"],
    ai: {
      useWhen: "star rating, usually 1-5",
      defaultValidation: { min: 1, max: 5 },
    },
  },
  scale: {
    label: "Linear scale",
    category: "scale",
    answerShape: "number",
    validationKeys: ["min", "max"],
    ai: {
      useWhen: "numeric slider / scale, usually 1-10",
      defaultValidation: { min: 1, max: 10 },
    },
  },

  // ── date & time ───────────────────────────────────────────────
  date: {
    label: "Date",
    category: "date",
    answerShape: "string",
    validationKeys: [],
    ai: { useWhen: "calendar date", defaultValidation: {} },
  },
  time: {
    label: "Time",
    category: "date",
    answerShape: "string",
    validationKeys: [],
    ai: { useWhen: "clock time", defaultValidation: {} },
  },

  // ── media ─────────────────────────────────────────────────────
  image: {
    label: "Image upload",
    category: "media",
    answerShape: "url | url[]",
    validationKeys: ["maxFiles"],
    ai: {
      useWhen:
        "respondent uploads a photo, picture, screenshot, selfie, poster, receipt photo, artwork",
      examplePlaceholder: "",
      defaultValidation: { maxFiles: 1 },
      mediaDescriptionHint:
        "JPG, PNG or WEBP. Say what kind of photo you want and any size limit.",
    },
  },
  document: {
    label: "Document upload",
    category: "media",
    answerShape: "url | url[]",
    validationKeys: ["maxFiles"],
    ai: {
      useWhen:
        "respondent uploads a PDF, CV, résumé, essay, spreadsheet, slide deck, ID scan, invoice, contract",
      defaultValidation: { maxFiles: 1 },
      mediaDescriptionHint:
        "PDF, DOC, XLS, PPT or ZIP. Say what to attach and any size limit.",
    },
  },
  file: {
    label: "Any file",
    category: "media",
    answerShape: "url | url[]",
    validationKeys: ["maxFiles"],
    ai: {
      useWhen: "generic 'any file' — use only when the request didn't narrow it down",
      defaultValidation: { maxFiles: 1 },
      mediaDescriptionHint: "Any file. Say what to upload and any size limit.",
    },
  },

  // ── layout ────────────────────────────────────────────────────
  section: {
    label: "Section header",
    category: "layout",
    answerShape: "null",
    validationKeys: [],
    ai: {
      useWhen: "divider with a title and description, no answer",
      defaultValidation: {},
      layoutOnly: true,
    },
  },
};

// Convenience sets derived from FIELD_TYPES — do not hardcode these.
export const FIELD_TYPES_BY_CATEGORY = Object.entries(FIELD_TYPES).reduce(
  (acc, [id, def]) => {
    (acc[def.category] ||= []).push(id);
    return acc;
  },
  {}
);

export const CHOICE_FIELD_TYPES = new Set(FIELD_TYPES_BY_CATEGORY.choice || []);
export const MEDIA_FIELD_TYPES = new Set(FIELD_TYPES_BY_CATEGORY.media || []);
export const LAYOUT_FIELD_TYPES = new Set(FIELD_TYPES_BY_CATEGORY.layout || []);
export const ALL_FIELD_TYPE_IDS = Object.keys(FIELD_TYPES);

export const isChoiceType = (t) => CHOICE_FIELD_TYPES.has(t);
export const isMediaType = (t) => MEDIA_FIELD_TYPES.has(t);
export const isLayoutType = (t) => LAYOUT_FIELD_TYPES.has(t);

// ═════════════════════════════════════════════════════════════════════
// FEATURES
//
// Capabilities that live on the FORM document itself (not on fields).
// ═════════════════════════════════════════════════════════════════════
export const FEATURES = {
  positions: {
    label: "Election positions",
    description:
      "Used only on form.type='election'. An array of positions, each with its own title, description, maxSelections, required flag, and a list of candidates (name, bio, manifesto, slogan, photoUrl, metadata).",
    // The `paths` block documents where each value lives for the
    // sanitizer and for the human reading this file. The nested shape
    // is rendered into the AI schema doc by renderSchemaObject().
    paths: {
      array: "positions",
      idKey: "id",
      items: {
        id: "string, prefix p_ (e.g. \"p_abc123\")",
        title: "string, up to 200 chars",
        description: "string, up to 1000 chars",
        maxSelections: "number, 1-20 (how many candidates a voter can pick)",
        required: "boolean",
        order: "number",
        candidates: {
          __array: true,
          items: {
            id: "string, prefix c_ (e.g. \"c_abc123\")",
            name: "string",
            bio: "string",
            manifesto: "string",
            photoUrl: "string (URL — leave empty, owner uploads separately)",
            slogan: "string",
            metadata: "free-form object",
            order: "number",
          },
        },
      },
    },
    ai: {
      when:
        "user asks for an election, vote, ballot, or 'pick candidates'",
      minItems: 1,
      examples: [
        "One position (President) with 3 candidates",
        "Three positions (President, VP, DOS) each with their own candidates",
      ],
      notes:
        "Never guess candidate names. If the user hasn't listed candidates, draft the position structure with placeholder candidate objects (name: '') and let them fill them in.",
    },
  },
  timing: {
    label: "Start / end window",
    description:
      "Optional time window on any form. Before startAt → 'not started yet'. After expiresAt → 'ended'. Automatic, no cron needed.",
    paths: { startAt: "Date | null", expiresAt: "Date | null" },
    ai: {
      when:
        "user mentions a deadline, an opening date, 'starts on X', 'ends on Y', 'closes Friday'",
      notes:
        "Convert relative dates to ISO strings. If only an end date is given, set startAt=null. If only a start date is given, set expiresAt=null.",
    },
  },
  accessRequests: {
    label: "Access requests (private forms)",
    description:
      "Only for visibility='private'. Visitors can request a password instead of you inviting them. Optional auto-approve, and optional extra fields the visitor must fill in (matric number, department, etc).",
    paths: {
      "settings.allowAccessRequests": "boolean",
      "settings.autoApproveAccess": "boolean",
      "settings.requestFields":
        "array of { id, label, type, required, placeholder, order }",
    },
    ai: {
      when:
        "user says 'people should ask me for a password', 'let them request access', 'ask for matric number when they request'",
      notes:
        "Only applies when visibility='private'. Request field type is one of short_text, long_text, email, number, phone, url, date.",
    },
  },
  drafts: {
    label: "Draft autosave",
    description:
      "Respondents' in-progress answers are saved automatically. Anonymous visitors get a session key; logged-in users get the draft tied to their account. Submitting clears the draft.",
    paths: {},
    ai: {
      when: "always on — nothing to configure",
      notes: "Not a form field; do not include it in drafts.",
    },
  },
  quizScoring: {
    label: "Quiz scoring",
    description:
      "Only for form.type='quiz'. Each field can carry scoring.correct (list of correct option values) and scoring.points. settings.passPercentage sets the pass threshold.",
    paths: {
      "field.scoring.correct": "string[]",
      "field.scoring.points": "number",
      "settings.showScoreImmediately": "boolean",
      "settings.passPercentage": "number 0-100",
    },
    ai: {
      when: "user asks for a quiz, exam, test, or explicitly asks for scoring",
      notes:
        "Only populate scoring for choice/text/yes_no fields. Never for media or layout fields.",
    },
  },
  coverPhoto: {
    label: "Cover photo",
    description:
      "Banner image at the top of the public form. Uploaded from the editor via a separate endpoint, NOT something the AI can set.",
    paths: { coverPhoto: "string (URL, read-only for AI)" },
    ai: {
      when: "n/a",
      notes:
        "The AI cannot upload a cover photo. If the user asks, tell them to do it from the editor after the form is created.",
    },
  },
  redirect: {
    label: "Post-submit redirect",
    description:
      "Where the respondent goes after submitting. WhatsApp group, Telegram, website, thank-you page.",
    paths: { "settings.successRedirectUrl": "string (URL)" },
    ai: {
      when:
        "user mentions 'send them to my WhatsApp group', 'redirect to X after submit', 'take them to this link'",
      notes: "Only set if the URL is explicit. Never invent one.",
    },
  },
};

// ═════════════════════════════════════════════════════════════════════
// SETTINGS KEYS
// ═════════════════════════════════════════════════════════════════════
export const SETTINGS_KEYS = {
  collectEmail: { type: "boolean", default: false, ai: "set true when the form needs contact info" },
  allowMultipleSubmissions: { type: "boolean", default: false, ai: "set true for feedback, false for exams" },
  shuffleQuestions: { type: "boolean", default: false, ai: "set true to randomize order" },
  showProgressBar: { type: "boolean", default: true, ai: "set true for forms with 5+ fields" },
  confirmationMessage: { type: "string", max: 1000, default: "Thanks, your response has been recorded.", ai: "short and warm" },
  successRedirectUrl: { type: "string", default: "", ai: "set from FEATURES.redirect when user names a URL" },
  theme: { type: "string", default: "default", ai: "usually leave 'default'" },
  primaryColor: { type: "string", default: "" },
  showScoreImmediately: { type: "boolean", default: false, ai: "quiz only" },
  passPercentage: { type: "number", min: 0, max: 100, default: 0, ai: "quiz only" },
  // Private-form access requests
  allowAccessRequests: { type: "boolean", default: false, ai: "private only" },
  autoApproveAccess: { type: "boolean", default: false, ai: "private only" },
  requestFields: { type: "array", default: [], ai: "private only; see FEATURES.accessRequests" },
  // Election
  shufflePositions: { type: "boolean", default: false, ai: "election only" },
  allowAbstain: { type: "boolean", default: false, ai: "election only" },
  showLiveResults: { type: "boolean", default: false, ai: "election only" },
  requireAllPositions: { type: "boolean", default: true, ai: "election only" },
};

// ═════════════════════════════════════════════════════════════════════
// AI PROMPT GENERATORS
// ═════════════════════════════════════════════════════════════════════

const listValidation = (keys) => {
  if (!keys || !keys.length) return "none";
  return keys.map((k) => `"${k}"`).join(", ");
};

const typeLines = () =>
  Object.entries(FORM_TYPES)
    .map(([id, t]) => `  "${id}" — ${t.hint}`)
    .join("\n");

const fieldTypeLines = () =>
  Object.entries(FIELD_TYPES)
    .map(([id, def]) => {
      const flags = [];
      if (def.category === "choice") flags.push("choice");
      if (def.category === "media") flags.push("media");
      if (def.category === "layout") flags.push("layout");
      const when = def.ai?.useWhen ? ` → ${def.ai.useWhen}` : "";
      const valid = def.validationKeys?.length
        ? ` [validation: ${listValidation(def.validationKeys)}]`
        : "";
      const tags = flags.length ? ` (${flags.join(", ")})` : "";
      return `  "${id}"${tags}${when}${valid}`;
    })
    .join("\n");

const featureBlocks = () => {
  const blocks = [];
  for (const [key, f] of Object.entries(FEATURES)) {
    // positions gets its own dedicated block below — skip it here so
    // we don't render the same info twice.
    if (key === "positions") continue;
    if (!f.ai?.when || f.ai.when === "n/a" || f.ai.when === "always on — nothing to configure") {
      continue;
    }
    const lines = [
      `─ ${f.label} ─`,
      `When: ${f.ai.when}`,
      f.description,
    ];
    if (f.ai.notes) lines.push(`Note: ${f.ai.notes}`);
    if (f.ai.examples?.length) {
      lines.push("Examples:");
      for (const ex of f.ai.examples) lines.push(`  • ${ex}`);
    }
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
};

const settingsLines = () =>
  Object.entries(SETTINGS_KEYS)
    .map(([k, def]) => {
      const type =
        def.type === "number"
          ? `number${def.min != null || def.max != null ? ` (${def.min ?? "-∞"}..${def.max ?? "∞"})` : ""}`
          : def.type;
      const hint = def.ai ? ` → ${def.ai}` : "";
      return `  "${k}": ${type}${hint}`;
    })
    .join("\n");

// Render a nested registry object into a TypeScript-ish JSON shape.
// An object value with __array:true is rendered as [ ...items ].
const renderSchemaObject = (obj, indent = 1) => {
  const pad = "  ".repeat(indent);
  const entries = Object.entries(obj || {}).filter(([, v]) => v != null);
  return entries
    .map(([key, val], i) => {
      const comma = i === entries.length - 1 ? "" : ",";
      if (typeof val === "string") {
        return `${pad}"${key}": ${val}${comma}`;
      }
      if (val.__array && val.items) {
        const inner = renderSchemaObject(val.items, indent + 1);
        return `${pad}"${key}": [\n${inner}\n${pad}]${comma}`;
      }
      if (typeof val === "object") {
        const inner = renderSchemaObject(val, indent + 1);
        return `${pad}"${key}": {\n${inner}\n${pad}}${comma}`;
      }
      return `${pad}"${key}": ${JSON.stringify(val)}${comma}`;
    })
    .join("\n");
};

/**
 * The complete schema spec the AI reads when drafting.
 * Regenerate on every boot. Never hardcode a copy of this.
 */
export function buildSchemaDocForAI() {
  const positionShape = FEATURES.positions?.paths?.items;
  const positionBlock = positionShape
    ? `
A Position is (ONLY when type='election'):

{
${renderSchemaObject(positionShape, 1)}
}

Rules for positions:
- ONLY used when type='election'. Never mix positions and fields.
- If type='election', positions MUST be non-empty and fields MUST be [].
- Every position MUST have at least one candidate.
- If the user named candidates, use those EXACT names.
- If they didn't, leave candidate name as "" — never invent a real person.
- maxSelections=1 means pick one candidate. maxSelections>1 means pick up to N.
- If the user says "President" (singular role), produce ONE position
  with that title and the candidates they listed.
`
    : "";

  const workedExample = `
WORKED EXAMPLE — a request like "election form for NACCOS President,
Gadon Jeremiah, Chison Jacob and Jeffery Benson are the candidates"
must produce EXACTLY this shape:

{
  "title": "NACCOS President Election",
  "description": "Vote for the next NACCOS President.",
  "type": "election",
  "visibility": "public",
  "fields": [],
  "positions": [
    {
      "id": "p_abc123",
      "title": "President",
      "description": "",
      "maxSelections": 1,
      "required": true,
      "order": 0,
      "candidates": [
        { "id": "c_a1b2c3", "name": "Gadon Jeremiah", "bio": "", "manifesto": "", "photoUrl": "", "slogan": "", "order": 0 },
        { "id": "c_d4e5f6", "name": "Chison Jacob", "bio": "", "manifesto": "", "photoUrl": "", "slogan": "", "order": 1 },
        { "id": "c_g7h8i9", "name": "Jeffery Benson", "bio": "", "manifesto": "", "photoUrl": "", "slogan": "", "order": 2 }
      ]
    }
  ],
  "startAt": null,
  "expiresAt": null,
  "settings": {},
  "isMultipage": false
}

If you ever produce type='election' with "positions": [], you have
failed the task. Never do that.
`;

  return `
A Form document has this shape:

{
  "title": "string",
  "description": "string",
  "type": one of:
${typeLines()},
  "visibility": "public" | "private",
  "fields": [ Field, ... ],      // for non-election types
  "positions": [ Position, ... ], // for type='election'
  "startAt": ISO date or null,
  "expiresAt": ISO date or null,
  "settings": Settings,
  "isMultipage": boolean
}

A Field is:
{
  "id": "f_xxxxxxxx",
  "type": one of:
${fieldTypeLines()},
  "label": "string",
  "description": "string",
  "placeholder": "string",
  "required": boolean,
  "order": number,
  "options": [{ "id": "o_xxxx", "label": "string", "value": "string" }],
  "validation": { ... see per-type hints above ... },
  "scoring": { "correct": ["value", ...], "points": number }
}

Rules for fields:
- "section" is a divider: label and description only, no options, no
  required flag, no validation, no scoring.
- Every choice field must have at least two options, with stable ids
  and non-empty, lowercase, space-free values (snake_case or kebab-case).
- For quizzes, populate scoring.correct with the correct option.value(s)
  and set points (default 1 per question).
- Text fields MUST have sensible minLength and maxLength.
- Number / rating / scale MUST have min and max. Rating 1-5, scale 1-10.
- Media fields have NO options, NO scoring, NO min/max/minLength/maxLength.
  Only validation.maxFiles matters. Add a short, helpful description so
  respondents know what to upload.
- Labels must be short and human. Never duplicate the label into the
  description. Never use "Question 1" / "Option A" filler.
- Every field in a draft must be publish-ready.

${positionBlock}

${Object.entries(FEATURES)
  .filter(
    ([key, f]) =>
      key !== "positions" && f.paths && Object.keys(f.paths).length
  )
  .map(([, f]) => {
    const pathLines = Object.entries(f.paths)
      .map(
        ([p, t]) =>
          `  "${p}" — ${typeof t === "string" ? t : "see description"}`
      )
      .join("\n");
    return `${f.label}:\n${pathLines}\n${f.description}`;
  })
  .join("\n\n")}

Settings:
${settingsLines()}

Feature guidance (use these when the user's request triggers them):
${featureBlocks()}

${workedExample}
`.trim();
}

/**
 * One-liner list of feature signals for the intent classifier.
 */
export function buildIntentFeatureList() {
  const formTypeLines = Object.entries(FORM_TYPES)
    .map(([id, t]) => {
      const words = t.signalWords.map((w) => `"${w}"`).join(", ");
      return `  ${id}: ${words}`;
    })
    .join("\n");

  const featureLines = Object.entries(FEATURES)
    .filter(([, f]) => f.ai?.when && f.ai.when !== "n/a" && !f.ai.when.startsWith("always on"))
    .map(([key, f]) => `  ${key}: ${f.ai.when}`)
    .join("\n");

  return `
Form types and their trigger words:
${formTypeLines}

Feature signals (mention in the request → set the corresponding key):
${featureLines}

When a form-type word appears AND a retrieval marker ("my", "stats",
"how many", "show me", "list") appears, it's a lookup, not a creation.
`;
}

// ═════════════════════════════════════════════════════════════════════
// Enum value exports
// ═════════════════════════════════════════════════════════════════════
export const FORM_TYPE_IDS = Object.keys(FORM_TYPES);
export const FIELD_TYPE_IDS = ALL_FIELD_TYPE_IDS;
export const SETTINGS_KEY_IDS = Object.keys(SETTINGS_KEYS);

// ═════════════════════════════════════════════════════════════════════
// Generic sanitizers driven by the registry
// ═════════════════════════════════════════════════════════════════════

const emptyValidation = () => ({
  min: null,
  max: null,
  minLength: null,
  maxLength: null,
  pattern: null,
  maxFiles: null,
});

const coerceToValidation = (type, rawValidation = {}) => {
  const def = FIELD_TYPES[type];
  if (!def || !def.validationKeys?.length) return emptyValidation();

  const out = emptyValidation();
  for (const key of def.validationKeys) {
    const v = rawValidation?.[key];
    if (key === "maxFiles") {
      out.maxFiles =
        Number.isFinite(Number(v)) && Number(v) > 0
          ? Math.min(10, Math.max(1, Number(v)))
          : def.ai?.defaultValidation?.maxFiles ?? 1;
    } else if (v != null && Number.isFinite(Number(v))) {
      out[key] = Number(v);
    } else if (def.ai?.defaultValidation?.[key] != null) {
      out[key] = def.ai.defaultValidation[key];
    }
  }
  return out;
};

export { coerceToValidation, emptyValidation };