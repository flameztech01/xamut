// controllers/formController.js
import asyncHandler from "express-async-handler";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

import Form from "../models/formModel.js";
import FormResponse from "../models/formResponseModel.js";
import User from "../models/userModel.js";
import { sendEmailSafe } from "../utils/sendMail.js";

// ─────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────
const isObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const genSlug = () => crypto.randomBytes(6).toString("hex");

const genFieldId = () => `f_${crypto.randomBytes(4).toString("hex")}`;
const genOptionId = () => `o_${crypto.randomBytes(3).toString("hex")}`;

const genPassword = () => {
  // Human-friendly password, no ambiguous characters (0/O, 1/I/l).
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[crypto.randomInt(0, chars.length)];
  return out;
};

const frontendUrl = () => (process.env.FRONTEND_URL || "").replace(/\/$/, "");

const httpError = (message, statusCode = 400) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

const findFormOrFail = async (id) => {
  if (!isObjectId(id)) throw httpError("Invalid form id.", 400);
  const form = await Form.findById(id);
  if (!form) throw httpError("Form not found.", 404);
  return form;
};

const assertOwner = (form, userId) => {
  if (String(form.owner) !== String(userId)) {
    throw httpError("Only the form owner can do that.", 403);
  }
};

const assertCanEdit = (form, userId) => {
  if (String(form.owner) === String(userId)) return "owner";
  const collab = form.collaborators.find(
    (c) => String(c.user) === String(userId)
  );
  if (collab && collab.role === "editor") return "editor";
  throw httpError("You don't have edit access to this form.", 403);
};

const assertCanView = (form, userId) => {
  if (String(form.owner) === String(userId)) return "owner";
  const collab = form.collaborators.find(
    (c) => String(c.user) === String(userId)
  );
  if (collab) return collab.role;
  throw httpError("You don't have access to this form.", 403);
};

// ─────────────────────────────────────────────────────────────────────
// Participant tokens — NOT Xamut auth. A scoped short-lived token
// that proves "this browser is authenticated as this participant for
// this specific form". Lets private forms be filled without requiring
// a Xamut account.
// ─────────────────────────────────────────────────────────────────────
const PARTICIPANT_PURPOSE = "form-participant";

const signParticipantToken = (formId, email) =>
  jwt.sign(
    {
      formId: String(formId),
      email: String(email).toLowerCase(),
      purpose: PARTICIPANT_PURPOSE,
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

const verifyParticipantToken = (token) => {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload?.purpose !== PARTICIPANT_PURPOSE) return null;
    return payload;
  } catch {
    return null;
  }
};

const readParticipantToken = (req) => {
  const header = req.headers?.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  if (typeof req.query?.t === "string" && req.query.t) return req.query.t;
  if (typeof req.body?.token === "string" && req.body.token)
    return req.body.token;
  return null;
};

// ─────────────────────────────────────────────────────────────────────
// Field sanitization
// ─────────────────────────────────────────────────────────────────────
const FIELD_TYPES = new Set([
  "short_text",
  "long_text",
  "email",
  "number",
  "date",
  "time",
  "url",
  "phone",
  "radio",
  "checkbox",
  "dropdown",
  "multi_select",
  "rating",
  "scale",
  "yes_no",
  "file",
  "section",
]);

const CHOICE_TYPES = new Set([
  "radio",
  "checkbox",
  "dropdown",
  "multi_select",
]);

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
      validation: {
        min: null,
        max: null,
        minLength: null,
        maxLength: null,
        pattern: null,
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
      "radio",
      "checkbox",
      "dropdown",
      "multi_select",
      "short_text",
      "long_text",
      "yes_no",
    ].includes(type);

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

    if (f.validation) {
      const v = f.validation;
      field.validation = {
        min: Number.isFinite(Number(v.min)) ? Number(v.min) : null,
        max: Number.isFinite(Number(v.max)) ? Number(v.max) : null,
        minLength: Number.isFinite(Number(v.minLength))
          ? Number(v.minLength)
          : null,
        maxLength: Number.isFinite(Number(v.maxLength))
          ? Number(v.maxLength)
          : null,
        pattern:
          typeof v.pattern === "string" ? v.pattern.slice(0, 300) : null,
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
    typeof s.successRedirectUrl === "string"
      ? s.successRedirectUrl.slice(0, 500)
      : "",
  theme: typeof s.theme === "string" ? s.theme.slice(0, 50) : "default",
  primaryColor:
    typeof s.primaryColor === "string" ? s.primaryColor.slice(0, 20) : "",
  showScoreImmediately: !!s.showScoreImmediately,
  passPercentage: Number.isFinite(Number(s.passPercentage))
    ? Math.max(0, Math.min(100, Number(s.passPercentage)))
    : 0,
});

// ─────────────────────────────────────────────────────────────────────
// Answer validation
// ─────────────────────────────────────────────────────────────────────
const validateAnswer = (field, rawValue) => {
  if (field.type === "section") return { ok: true, value: null };

  const isEmpty =
    rawValue === undefined ||
    rawValue === null ||
    rawValue === "" ||
    (Array.isArray(rawValue) && rawValue.length === 0);

  if (isEmpty) {
    if (field.required) {
      return { ok: false, error: `"${field.label}" is required.` };
    }
    return { ok: true, value: null };
  }

  switch (field.type) {
    case "short_text":
    case "long_text": {
      const v = String(rawValue).trim();
      const { minLength, maxLength } = field.validation || {};
      if (minLength != null && v.length < minLength)
        return {
          ok: false,
          error: `"${field.label}": min ${minLength} characters.`,
        };
      if (maxLength != null && v.length > maxLength)
        return {
          ok: false,
          error: `"${field.label}": max ${maxLength} characters.`,
        };
      return { ok: true, value: v };
    }

    case "email": {
      const v = String(rawValue).trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))
        return { ok: false, error: `"${field.label}": invalid email.` };
      return { ok: true, value: v };
    }

    case "url":
    case "file": {
      try {
        new URL(String(rawValue));
        return { ok: true, value: String(rawValue) };
      } catch {
        return { ok: false, error: `"${field.label}": invalid URL.` };
      }
    }

    case "number":
    case "rating":
    case "scale": {
      const n = Number(rawValue);
      if (!Number.isFinite(n))
        return { ok: false, error: `"${field.label}": must be a number.` };
      const { min, max } = field.validation || {};
      if (min != null && n < min)
        return { ok: false, error: `"${field.label}": min ${min}.` };
      if (max != null && n > max)
        return { ok: false, error: `"${field.label}": max ${max}.` };
      return { ok: true, value: n };
    }

    case "date": {
      const d = new Date(rawValue);
      if (Number.isNaN(d.getTime()))
        return { ok: false, error: `"${field.label}": invalid date.` };
      return { ok: true, value: d.toISOString() };
    }

    case "time": {
      const v = String(rawValue).trim();
      if (!/^\d{1,2}:\d{2}/.test(v))
        return { ok: false, error: `"${field.label}": invalid time.` };
      return { ok: true, value: v };
    }

    case "phone": {
      const v = String(rawValue).trim();
      if (!/^[+\d\s()\-.]{5,}$/.test(v))
        return { ok: false, error: `"${field.label}": invalid phone.` };
      return { ok: true, value: v };
    }

    case "radio":
    case "dropdown": {
      const v = String(rawValue);
      const found = field.options.find(
        (o) => o.value === v || o.id === v || o.label === v
      );
      if (!found)
        return { ok: false, error: `"${field.label}": choose a valid option.` };
      return { ok: true, value: found.value };
    }

    case "checkbox":
    case "multi_select": {
      const arr = Array.isArray(rawValue) ? rawValue : [rawValue];
      const values = [];
      for (const v of arr) {
        const found = field.options.find(
          (o) => o.value === v || o.id === v || o.label === v
        );
        if (!found)
          return {
            ok: false,
            error: `"${field.label}": contains an invalid option.`,
          };
        values.push(found.value);
      }
      return { ok: true, value: values };
    }

    case "yes_no": {
      const v = String(rawValue).toLowerCase();
      if (!["yes", "no", "true", "false"].includes(v))
        return { ok: false, error: `"${field.label}": answer yes or no.` };
      return { ok: true, value: v === "yes" || v === "true" };
    }

    default:
      return { ok: true, value: String(rawValue) };
  }
};

const scoreAnswer = (field, value) => {
  if (!field.scoring || !field.scoring.points)
    return { score: 0, correct: null };
  const correct = field.scoring.correct || [];
  if (!correct.length) return { score: 0, correct: null };

  const norm = (v) => String(v ?? "").trim().toLowerCase();

  if (Array.isArray(value)) {
    const given = value.map(norm).sort();
    const expected = correct.map(norm).sort();
    const same =
      given.length === expected.length &&
      given.every((v, i) => v === expected[i]);
    return { score: same ? field.scoring.points : 0, correct: same };
  }

  const isCorrect = correct.some((c) => norm(c) === norm(value));
  return { score: isCorrect ? field.scoring.points : 0, correct: isCorrect };
};

// ─────────────────────────────────────────────────────────────────────
// Invite email
// ─────────────────────────────────────────────────────────────────────
const sendParticipantInviteEmail = async ({ form, participant, password }) => {
  const link = `${frontendUrl()}/forms/${form.slug}`;
  const subject = `You've been invited to fill "${form.title}"`;

  const text = [
    `Hi${participant.name ? " " + participant.name : ""},`,
    "",
    `You've been invited to fill out "${form.title}".`,
    "",
    `Open the form: ${link}`,
    "",
    "Use these credentials on the form page:",
    `  Email:    ${participant.email}`,
    `  Password: ${password}`,
    "",
    "Keep this email. You'll need the password if you come back later.",
    "",
    "— Xamut",
  ].join("\n");

  const html = `
    <div style="font-family:Raleway,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1c1917;">
      <h2 style="margin:0 0 12px;font-size:20px;">You've been invited to fill a form</h2>
      <p style="margin:0 0 16px;color:#44403c;">
        Hi${participant.name ? " " + participant.name : ""}, you've been invited to fill out
        <strong>${form.title}</strong>.
      </p>
      <p style="margin:0 0 20px;">
        <a href="${link}" style="display:inline-block;background:#ea580c;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600;">Open the form</a>
      </p>
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-radius:12px;padding:14px 16px;margin:0 0 20px;">
        <p style="margin:0 0 6px;font-size:13px;color:#78716c;text-transform:uppercase;letter-spacing:.08em;">Your access</p>
        <p style="margin:0;font-family:monospace;font-size:14px;">Email: <strong>${participant.email}</strong></p>
        <p style="margin:4px 0 0;font-family:monospace;font-size:14px;">Password: <strong>${password}</strong></p>
      </div>
      <p style="margin:0;color:#78716c;font-size:12px;">Keep this email. You'll need the password if you come back later.</p>
    </div>
  `;

  await sendEmailSafe({ to: participant.email, subject, text, html });
};

// ─────────────────────────────────────────────────────────────────────
// FORM CRUD
// ─────────────────────────────────────────────────────────────────────

// POST /api/forms
export const createForm = asyncHandler(async (req, res) => {
  const {
    title = "Untitled form",
    description = "",
    type = "form",
    visibility = "public",
    fields = [],
    settings = {},
  } = req.body || {};

  if (!["form", "quiz", "survey", "feedback", "attendance"].includes(type)) {
    res.status(400);
    throw new Error("Unknown form type.");
  }

  const form = await Form.create({
    owner: req.user._id,
    title: String(title).slice(0, 200),
    description: String(description).slice(0, 2000),
    type,
    visibility: visibility === "private" ? "private" : "public",
    status: "draft",
    slug: genSlug(),
    fields: sanitizeFields(fields),
    settings: sanitizeSettings(settings),
    sourceConversation:
      req.body?.conversationId && isObjectId(req.body.conversationId)
        ? req.body.conversationId
        : null,
  });

  res.status(201).json({ success: true, form });
});

// GET /api/forms
export const listForms = asyncHandler(async (req, res) => {
  const userId = req.user._id;

  const [owned, collaborated] = await Promise.all([
    Form.find({ owner: userId })
      .select("-participants.passwordHash")
      .sort({ updatedAt: -1 })
      .lean(),
    Form.find({ "collaborators.user": userId })
      .select("-participants.passwordHash")
      .sort({ updatedAt: -1 })
      .lean(),
  ]);

  const shape = (f, role) => ({
    _id: f._id,
    title: f.title,
    description: f.description,
    type: f.type,
    visibility: f.visibility,
    status: f.status,
    slug: f.slug,
    responseCount: f.responseCount || 0,
    fieldsCount: f.fields?.length || 0,
    collaboratorsCount: f.collaborators?.length || 0,
    participantsCount: f.participants?.length || 0,
    createdAt: f.createdAt,
    updatedAt: f.updatedAt,
    role,
  });

  res.status(200).json({
    success: true,
    owned: owned.map((f) => shape(f, "owner")),
    collaborated: collaborated.map((f) => shape(f, "collaborator")),
  });
});

// GET /api/forms/:id
export const getForm = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  const role = assertCanView(form, req.user._id);

  const obj = form.toObject();
  if (obj.participants) {
    obj.participants = obj.participants.map((p) => ({
      _id: p._id,
      email: p.email,
      name: p.name,
      invitedAt: p.invitedAt,
      lastInvitedAt: p.lastInvitedAt,
      completed: p.completed,
      submittedAt: p.submittedAt,
    }));
  }

  res.status(200).json({ success: true, role, form: obj });
});

// PUT /api/forms/:id
export const updateForm = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanEdit(form, req.user._id);

  const {
    title,
    description,
    type,
    visibility,
    fields,
    settings,
    isMultipage,
    expiresAt,
  } = req.body || {};

  if (typeof title === "string") form.title = title.slice(0, 200);
  if (typeof description === "string")
    form.description = description.slice(0, 2000);

  if (
    type &&
    ["form", "quiz", "survey", "feedback", "attendance"].includes(type)
  ) {
    form.type = type;
  }
  if (visibility === "public" || visibility === "private") {
    form.visibility = visibility;
  }
  if (Array.isArray(fields)) {
    form.fields = sanitizeFields(fields);
  }
  if (settings && typeof settings === "object") {
    const current =
      typeof form.settings?.toObject === "function"
        ? form.settings.toObject()
        : form.settings || {};
    form.settings = sanitizeSettings({ ...current, ...settings });
  }
  if (typeof isMultipage === "boolean") form.isMultipage = isMultipage;

  if (expiresAt === null) {
    form.expiresAt = null;
  } else if (expiresAt) {
    const d = new Date(expiresAt);
    form.expiresAt = Number.isNaN(d.getTime()) ? null : d;
  }

  await form.save();
  res.status(200).json({ success: true, form });
});

// DELETE /api/forms/:id
export const deleteForm = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertOwner(form, req.user._id);

  await Promise.all([
    Form.deleteOne({ _id: form._id }),
    FormResponse.deleteMany({ form: form._id }),
  ]);

  res.status(200).json({ success: true, message: "Form deleted." });
});

// POST /api/forms/:id/duplicate
export const duplicateForm = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanView(form, req.user._id);

  const copy = await Form.create({
    owner: req.user._id,
    title: `${form.title} (copy)`.slice(0, 200),
    description: form.description,
    type: form.type,
    visibility: form.visibility,
    status: "draft",
    slug: genSlug(),
    fields: form.fields.map((f) => {
      const o = typeof f.toObject === "function" ? f.toObject() : f;
      return {
        ...o,
        id: genFieldId(),
        options: (o.options || []).map((opt) => ({
          ...opt,
          id: genOptionId(),
        })),
      };
    }),
    settings: form.settings,
    isMultipage: form.isMultipage,
  });

  res.status(201).json({ success: true, form: copy });
});

// POST /api/forms/:id/publish
export const publishForm = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanEdit(form, req.user._id);

  if (!form.fields.length) {
    res.status(400);
    throw new Error("Add at least one field before publishing.");
  }

  form.status = "open";
  form.publishedAt = form.publishedAt || new Date();
  form.closedAt = null;
  await form.save();

  res.status(200).json({
    success: true,
    form,
    publicUrl: `${frontendUrl()}/forms/${form.slug}`,
  });
});

// POST /api/forms/:id/close
export const closeForm = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanEdit(form, req.user._id);

  form.status = "closed";
  form.closedAt = new Date();
  await form.save();

  res.status(200).json({ success: true, form });
});

// ─────────────────────────────────────────────────────────────────────
// COLLABORATORS (Xamut users, edit/view access)
// ─────────────────────────────────────────────────────────────────────

// POST /api/forms/:id/collaborators
export const addCollaborator = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertOwner(form, req.user._id);

  const { email, role = "editor" } = req.body || {};
  if (!email?.trim()) {
    res.status(400);
    throw new Error("Collaborator email is required.");
  }
  if (!["editor", "viewer"].includes(role)) {
    res.status(400);
    throw new Error("Role must be 'editor' or 'viewer'.");
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() });
  if (!user) {
    res.status(404);
    throw new Error(
      "No Xamut account with that email. They need to sign up first."
    );
  }
  if (String(user._id) === String(form.owner)) {
    res.status(400);
    throw new Error("That's you. You already own this form.");
  }

  const existing = form.collaborators.find(
    (c) => String(c.user) === String(user._id)
  );
  if (existing) {
    existing.role = role;
  } else {
    form.collaborators.push({
      user: user._id,
      role,
      addedAt: new Date(),
    });
  }
  await form.save();

  res.status(200).json({
    success: true,
    collaborators: form.collaborators.map((c) => ({
      user: c.user,
      role: c.role,
      addedAt: c.addedAt,
    })),
  });
});

// GET /api/forms/:id/collaborators
export const listCollaborators = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanView(form, req.user._id);

  const ids = form.collaborators.map((c) => c.user);
  const users = await User.find({ _id: { $in: ids } })
    .select("name email profilePhoto")
    .lean();

  const byId = new Map(users.map((u) => [String(u._id), u]));

  const owner = await User.findById(form.owner)
    .select("name email profilePhoto")
    .lean();

  res.status(200).json({
    success: true,
    owner: owner
      ? {
          user: owner._id,
          name: owner.name,
          email: owner.email,
          profilePhoto: owner.profilePhoto,
          role: "owner",
        }
      : null,
    collaborators: form.collaborators.map((c) => {
      const u = byId.get(String(c.user));
      return {
        user: c.user,
        role: c.role,
        addedAt: c.addedAt,
        name: u?.name || "",
        email: u?.email || "",
        profilePhoto: u?.profilePhoto || "",
      };
    }),
  });
});

// DELETE /api/forms/:id/collaborators/:userId
export const removeCollaborator = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertOwner(form, req.user._id);

  const { userId } = req.params;
  if (!isObjectId(userId)) {
    res.status(400);
    throw new Error("Invalid user id.");
  }

  form.collaborators = form.collaborators.filter(
    (c) => String(c.user) !== String(userId)
  );
  await form.save();

  res.status(200).json({ success: true, message: "Collaborator removed." });
});

// PUT /api/forms/:id/collaborators/:userId
export const updateCollaboratorRole = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertOwner(form, req.user._id);

  const { userId } = req.params;
  const { role } = req.body || {};
  if (!["editor", "viewer"].includes(role)) {
    res.status(400);
    throw new Error("Role must be 'editor' or 'viewer'.");
  }

  const collab = form.collaborators.find(
    (c) => String(c.user) === String(userId)
  );
  if (!collab) {
    res.status(404);
    throw new Error("Collaborator not found on this form.");
  }
  collab.role = role;
  await form.save();

  res.status(200).json({ success: true, collaborators: form.collaborators });
});

// ─────────────────────────────────────────────────────────────────────
// PARTICIPANTS (private form fillers, no account needed)
// ─────────────────────────────────────────────────────────────────────

// POST /api/forms/:id/participants
// Body: { participants: [{ email, name? }] }
export const addParticipants = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanEdit(form, req.user._id);

  if (form.visibility !== "private") {
    res.status(400);
    throw new Error("Participants can only be added to private forms.");
  }

  const input = Array.isArray(req.body?.participants)
    ? req.body.participants
    : Array.isArray(req.body)
    ? req.body
    : [];

  if (!input.length) {
    res.status(400);
    throw new Error("Provide at least one participant.");
  }

  const created = [];

  for (const raw of input) {
    const email = String(raw?.email || "").trim().toLowerCase();
    const name = String(raw?.name || "").trim().slice(0, 120);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;

    const existing = form.participants.find((p) => p.email === email);
    const plain = genPassword();
    const hash = await bcrypt.hash(plain, 10);

    if (existing) {
      existing.passwordHash = hash;
      existing.name = name || existing.name;
      existing.lastInvitedAt = new Date();
      existing.completed = false;
      existing.submittedAt = null;
      existing.submissionId = null;
    } else {
      form.participants.push({
        email,
        name,
        passwordHash: hash,
        invitedAt: new Date(),
        lastInvitedAt: new Date(),
        completed: false,
      });
    }

    created.push({ email, name, passwordPlain: plain });
  }

  if (!created.length) {
    res.status(400);
    throw new Error("No valid email addresses were provided.");
  }

  await form.save();

  // Fire and forget emails. The controller still returns the plaintext
  // passwords so the owner can hand them out manually if SMTP fails.
  (async () => {
    for (const c of created) {
      await sendParticipantInviteEmail({
        form,
        participant: { email: c.email, name: c.name },
        password: c.passwordPlain,
      });
    }
  })();

  res.status(200).json({
    success: true,
    added: created.map((c) => ({
      email: c.email,
      name: c.name,
      password: c.passwordPlain,
    })),
    participants: form.participants.map((p) => ({
      _id: p._id,
      email: p.email,
      name: p.name,
      invitedAt: p.invitedAt,
      lastInvitedAt: p.lastInvitedAt,
      completed: p.completed,
      submittedAt: p.submittedAt,
    })),
  });
});

// GET /api/forms/:id/participants
export const listParticipants = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanView(form, req.user._id);

  res.status(200).json({
    success: true,
    participants: form.participants.map((p) => ({
      _id: p._id,
      email: p.email,
      name: p.name,
      invitedAt: p.invitedAt,
      lastInvitedAt: p.lastInvitedAt,
      completed: p.completed,
      submittedAt: p.submittedAt,
    })),
  });
});

// DELETE /api/forms/:id/participants/:participantId
export const removeParticipant = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanEdit(form, req.user._id);

  const { participantId } = req.params;
  if (!isObjectId(participantId)) {
    res.status(400);
    throw new Error("Invalid participant id.");
  }

  form.participants = form.participants.filter(
    (p) => String(p._id) !== String(participantId)
  );
  await form.save();

  res.status(200).json({ success: true, message: "Participant removed." });
});

// POST /api/forms/:id/participants/:participantId/resend
export const resendParticipantCredentials = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanEdit(form, req.user._id);

  const { participantId } = req.params;
  const participant = form.participants.id(participantId);
  if (!participant) {
    res.status(404);
    throw new Error("Participant not found.");
  }

  const plain = genPassword();
  participant.passwordHash = await bcrypt.hash(plain, 10);
  participant.lastInvitedAt = new Date();
  participant.completed = false;
  participant.submittedAt = null;
  participant.submissionId = null;
  await form.save();

  await sendParticipantInviteEmail({
    form,
    participant: { email: participant.email, name: participant.name },
    password: plain,
  });

  res.status(200).json({
    success: true,
    participant: {
      email: participant.email,
      name: participant.name,
      password: plain,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────
// PUBLIC / RESPONDENT
// ─────────────────────────────────────────────────────────────────────

const getFormBySlugOrId = async (slugOrId) => {
  const query = isObjectId(slugOrId) ? { _id: slugOrId } : { slug: slugOrId };
  const form = await Form.findOne(query);
  if (!form) throw httpError("Form not found.", 404);
  return form;
};

const buildPublicForm = (form) => {
  const fields = form.fields.map((f) => ({
    id: f.id,
    type: f.type,
    label: f.label,
    description: f.description,
    placeholder: f.placeholder,
    required: f.required,
    order: f.order,
    options: f.options.map((o) => ({
      id: o.id,
      label: o.label,
      value: o.value,
    })),
    validation: f.validation,
    // NOTE: scoring is deliberately omitted so correct answers
    // never leak to the respondent.
  }));

  return {
    _id: form._id,
    slug: form.slug,
    title: form.title,
    description: form.description,
    type: form.type,
    visibility: form.visibility,
    status: form.status,
    isMultipage: form.isMultipage,
    fields,
    settings: {
      collectEmail: form.settings.collectEmail,
      allowMultipleSubmissions: form.settings.allowMultipleSubmissions,
      shuffleQuestions: form.settings.shuffleQuestions,
      showProgressBar: form.settings.showProgressBar,
      confirmationMessage: form.settings.confirmationMessage,
      successRedirectUrl: form.settings.successRedirectUrl,
      theme: form.settings.theme,
      primaryColor: form.settings.primaryColor,
      showScoreImmediately: form.settings.showScoreImmediately,
    },
    publishedAt: form.publishedAt,
    expiresAt: form.expiresAt,
  };
};

const isFormAcceptingResponses = (form) => {
  if (form.status !== "open") return false;
  if (form.expiresAt && new Date(form.expiresAt).getTime() < Date.now())
    return false;
  return true;
};

// GET /api/forms/public/:slug
export const getPublicForm = asyncHandler(async (req, res) => {
  const form = await getFormBySlugOrId(req.params.slug);

  if (!isFormAcceptingResponses(form)) {
    res.status(410);
    throw new Error(
      form.status === "closed"
        ? "This form is closed."
        : "This form isn't open yet."
    );
  }

  if (form.visibility === "private") {
    const token = verifyParticipantToken(readParticipantToken(req));
    if (!token || String(token.formId) !== String(form._id)) {
      res.status(401);
      throw new Error(
        "This form is private. Sign in with your email and password."
      );
    }
    const participant = form.participants.find(
      (p) => p.email === token.email.toLowerCase()
    );
    if (!participant) {
      res.status(403);
      throw new Error("You are not a participant on this form.");
    }
    return res.status(200).json({
      success: true,
      form: buildPublicForm(form),
      participant: { email: participant.email, name: participant.name },
    });
  }

  res.status(200).json({ success: true, form: buildPublicForm(form) });
});

// POST /api/forms/public/:slug/login
export const participantLogin = asyncHandler(async (req, res) => {
  const form = await getFormBySlugOrId(req.params.slug);

  if (form.visibility !== "private") {
    res.status(400);
    throw new Error("This form doesn't require a password.");
  }

  if (!isFormAcceptingResponses(form)) {
    res.status(410);
    throw new Error("This form isn't accepting responses.");
  }

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (!email || !password) {
    res.status(400);
    throw new Error("Email and password are required.");
  }

  const participant = form.participants.find((p) => p.email === email);
  if (!participant) {
    res.status(401);
    throw new Error("Invalid email or password.");
  }

  const ok = await bcrypt.compare(password, participant.passwordHash);
  if (!ok) {
    res.status(401);
    throw new Error("Invalid email or password.");
  }

  const token = signParticipantToken(form._id, participant.email);

  res.status(200).json({
    success: true,
    token,
    form: buildPublicForm(form),
    participant: { email: participant.email, name: participant.name },
  });
});

// POST /api/forms/public/:slug/submit
export const submitResponse = asyncHandler(async (req, res) => {
  const form = await getFormBySlugOrId(req.params.slug);

  if (!isFormAcceptingResponses(form)) {
    res.status(410);
    throw new Error("This form isn't accepting responses.");
  }

  const {
    answers = {},
    startedAt,
    durationSeconds,
    email,
    name,
    userAgent,
  } = req.body || {};

  let participant = null;
  if (form.visibility === "private") {
    const token = verifyParticipantToken(readParticipantToken(req));
    if (!token || String(token.formId) !== String(form._id)) {
      res.status(401);
      throw new Error("You need to sign in with your email and password.");
    }
    participant = form.participants.find(
      (p) => p.email === token.email.toLowerCase()
    );
    if (!participant) {
      res.status(403);
      throw new Error("You are not a participant on this form.");
    }
    if (participant.completed && !form.settings.allowMultipleSubmissions) {
      res.status(409);
      throw new Error("You've already submitted this form.");
    }
  }

  const map = new Map();
  for (const [k, v] of Object.entries(answers || {})) map.set(k, v);

  const validated = [];
  const errors = [];

  for (const field of form.fields) {
    if (field.type === "section") continue;
    const raw = map.get(field.id);
    const result = validateAnswer(field, raw);
    if (!result.ok) {
      errors.push(result.error);
      continue;
    }
    const { score, correct } = scoreAnswer(field, result.value);
    validated.push({
      fieldId: field.id,
      value: result.value,
      score,
      correct,
    });
  }

  if (errors.length) {
    res.status(400);
    throw new Error(errors.slice(0, 4).join(" "));
  }

  const maxScore = form.fields.reduce(
    (sum, f) => sum + (f.scoring?.points || 0),
    0
  );
  const totalScore = validated.reduce((sum, a) => sum + (a.score || 0), 0);
  const percentage =
    maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  const passed =
    maxScore > 0 && form.settings.passPercentage > 0
      ? percentage >= form.settings.passPercentage
      : null;

  const respondentEmail =
    participant?.email ||
    (form.settings.collectEmail
      ? String(email || "").trim().toLowerCase()
      : "") ||
    "";

  const response = await FormResponse.create({
    form: form._id,
    respondentEmail,
    respondentName:
      participant?.name || String(name || "").slice(0, 120),
    participantId: participant?._id || null,
    answers: validated,
    totalScore,
    maxScore,
    percentage,
    passed,
    startedAt: startedAt ? new Date(startedAt) : new Date(),
    submittedAt: new Date(),
    durationSeconds: Number(durationSeconds) || 0,
    userAgent: String(userAgent || req.headers["user-agent"] || "").slice(
      0,
      400
    ),
  });

  form.responseCount = (form.responseCount || 0) + 1;

  if (participant) {
    participant.completed = true;
    participant.submittedAt = new Date();
    participant.submissionId = response._id;
  }

  await form.save();

  const isQuiz = form.type === "quiz" || maxScore > 0;
  const showScore = isQuiz && form.settings.showScoreImmediately;

  res.status(201).json({
    success: true,
    responseId: response._id,
    confirmationMessage: form.settings.confirmationMessage,
    successRedirectUrl: form.settings.successRedirectUrl,
    score: showScore ? { totalScore, maxScore, percentage, passed } : null,
  });
});

// ─────────────────────────────────────────────────────────────────────
// RESPONSES
// ─────────────────────────────────────────────────────────────────────

// GET /api/forms/:id/responses?page=1&limit=50&q=
export const listResponses = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanView(form, req.user._id);

  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  const filter = { form: form._id };
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q) filter.respondentEmail = { $regex: q, $options: "i" };

  const [items, total] = await Promise.all([
    FormResponse.find(filter)
      .sort({ submittedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    FormResponse.countDocuments(filter),
  ]);

  res.status(200).json({
    success: true,
    page,
    limit,
    total,
    pages: Math.ceil(total / limit),
    responses: items,
  });
});

// GET /api/forms/:id/responses/:responseId
export const getResponse = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanView(form, req.user._id);

  const { responseId } = req.params;
  if (!isObjectId(responseId)) {
    res.status(400);
    throw new Error("Invalid response id.");
  }

  const response = await FormResponse.findOne({
    _id: responseId,
    form: form._id,
  }).lean();

  if (!response) {
    res.status(404);
    throw new Error("Response not found.");
  }

  res.status(200).json({ success: true, response });
});

// DELETE /api/forms/:id/responses/:responseId
export const deleteResponse = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanEdit(form, req.user._id);

  const { responseId } = req.params;
  if (!isObjectId(responseId)) {
    res.status(400);
    throw new Error("Invalid response id.");
  }

  const deleted = await FormResponse.findOneAndDelete({
    _id: responseId,
    form: form._id,
  });
  if (!deleted) {
    res.status(404);
    throw new Error("Response not found.");
  }

  if (deleted.participantId) {
    const participant = form.participants.id(deleted.participantId);
    if (participant) {
      participant.completed = false;
      participant.submittedAt = null;
      participant.submissionId = null;
    }
  }

  form.responseCount = Math.max(0, (form.responseCount || 1) - 1);
  await form.save();

  res.status(200).json({ success: true, message: "Response deleted." });
});

// ─────────────────────────────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────────────────────────────

// GET /api/forms/:id/stats
export const getStats = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanView(form, req.user._id);

  const responses = await FormResponse.find({ form: form._id }).lean();
  const total = responses.length;

  const durations = responses
    .map((r) => r.durationSeconds || 0)
    .filter((d) => d > 0);
  const avgDuration = durations.length
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  const isQuiz =
    form.type === "quiz" || form.fields.some((f) => f.scoring?.points > 0);
  const maxScore = form.fields.reduce(
    (sum, f) => sum + (f.scoring?.points || 0),
    0
  );

  const scores = responses.map((r) => r.totalScore || 0);
  const percentages = responses.map((r) => r.percentage || 0);
  const avgScore = scores.length
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;
  const avgPct = percentages.length
    ? percentages.reduce((a, b) => a + b, 0) / percentages.length
    : 0;
  const passedCount = responses.filter((r) => r.passed === true).length;

  const fields = form.fields.map((f) => {
    if (f.type === "section") {
      return { fieldId: f.id, label: f.label, type: f.type, isSection: true };
    }

    const values = responses
      .map((r) => r.answers.find((a) => a.fieldId === f.id))
      .filter((a) => a && a.value !== null && a.value !== undefined);

    const answered = values.length;
    const skipped = total - answered;

    const base = {
      fieldId: f.id,
      label: f.label,
      type: f.type,
      answered,
      skipped,
    };

    if (CHOICE_TYPES.has(f.type)) {
      const counts = new Map();
      for (const o of f.options) counts.set(o.value, 0);
      for (const a of values) {
        const arr = Array.isArray(a.value) ? a.value : [a.value];
        for (const v of arr) {
          counts.set(String(v), (counts.get(String(v)) || 0) + 1);
        }
      }
      const options = f.options.map((o) => {
        const c = counts.get(o.value) || 0;
        return {
          optionId: o.id,
          label: o.label,
          value: o.value,
          count: c,
          percentage: answered ? Math.round((c / answered) * 100) : 0,
        };
      });
      return { ...base, options };
    }

    if (["number", "rating", "scale"].includes(f.type)) {
      const nums = values.map((a) => Number(a.value)).filter(Number.isFinite);
      if (!nums.length)
        return { ...base, min: null, max: null, avg: null, distribution: [] };
      const min = Math.min(...nums);
      const max = Math.max(...nums);
      const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
      const distMap = new Map();
      for (const n of nums) distMap.set(n, (distMap.get(n) || 0) + 1);
      const distribution = [...distMap.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([value, count]) => ({ value, count }));
      return { ...base, min, max, avg: Number(avg.toFixed(2)), distribution };
    }

    if (f.type === "yes_no") {
      let yes = 0;
      let no = 0;
      for (const a of values) {
        if (a.value === true) yes++;
        else if (a.value === false) no++;
      }
      return {
        ...base,
        yes,
        no,
        yesPercentage: answered ? Math.round((yes / answered) * 100) : 0,
      };
    }

    if (f.type === "date") {
      const dates = values
        .map((a) => new Date(a.value))
        .filter((d) => !Number.isNaN(d.getTime()));
      if (!dates.length) return { ...base, earliest: null, latest: null };
      dates.sort((a, b) => a - b);
      return {
        ...base,
        earliest: dates[0].toISOString(),
        latest: dates[dates.length - 1].toISOString(),
      };
    }

    const samples = values
      .slice(-30)
      .reverse()
      .map((a) => String(a.value));

    let correctRate = null;
    if (f.scoring?.points) {
      const withResult = values.filter((a) => a.correct !== null);
      if (withResult.length) {
        const correctCount = withResult.filter((a) => a.correct).length;
        correctRate = Math.round((correctCount / withResult.length) * 100);
      }
    }

    return { ...base, samples, correctRate };
  });

  res.status(200).json({
    success: true,
    totalResponses: total,
    averageDurationSeconds: avgDuration,
    isQuiz,
    quiz: isQuiz
      ? {
          maxScore,
          averageScore: Number(avgScore.toFixed(2)),
          averagePercentage: Number(avgPct.toFixed(2)),
          passedCount,
          passPercentage: form.settings.passPercentage || 0,
        }
      : null,
    fields,
  });
});

// GET /api/forms/:id/leaderboard
export const getLeaderboard = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanView(form, req.user._id);

  const responses = await FormResponse.find({ form: form._id })
    .sort({ totalScore: -1, submittedAt: 1 })
    .limit(200)
    .select(
      "respondentEmail respondentName totalScore maxScore percentage passed submittedAt durationSeconds"
    )
    .lean();

  const leaderboard = responses.map((r, i) => ({
    rank: i + 1,
    email: r.respondentEmail,
    name: r.respondentName,
    totalScore: r.totalScore,
    maxScore: r.maxScore,
    percentage: r.percentage,
    passed: r.passed,
    durationSeconds: r.durationSeconds,
    submittedAt: r.submittedAt,
  }));

  res.status(200).json({ success: true, leaderboard });
});

// GET /api/forms/:id/export
export const exportResponses = asyncHandler(async (req, res) => {
  const form = await findFormOrFail(req.params.id);
  assertCanView(form, req.user._id);

  const responses = await FormResponse.find({ form: form._id })
    .sort({ submittedAt: -1 })
    .lean();

  const columns = [
    { id: "_id", label: "Response ID" },
    { id: "submittedAt", label: "Submitted at" },
    { id: "respondentEmail", label: "Email" },
    { id: "respondentName", label: "Name" },
    { id: "durationSeconds", label: "Duration (s)" },
    { id: "totalScore", label: "Score" },
    { id: "maxScore", label: "Max score" },
    { id: "percentage", label: "Percentage" },
    { id: "passed", label: "Passed" },
    ...form.fields
      .filter((f) => f.type !== "section")
      .map((f) => ({ id: f.id, label: f.label || f.id, type: f.type })),
  ];

  const rows = responses.map((r) => {
    const row = {
      _id: r._id,
      submittedAt: r.submittedAt,
      respondentEmail: r.respondentEmail,
      respondentName: r.respondentName,
      durationSeconds: r.durationSeconds,
      totalScore: r.totalScore,
      maxScore: r.maxScore,
      percentage: r.percentage,
      passed: r.passed,
    };
    for (const f of form.fields) {
      if (f.type === "section") continue;
      const a = r.answers.find((x) => x.fieldId === f.id);
      row[f.id] = a ? a.value : null;
    }
    return row;
  });

  res.status(200).json({
    success: true,
    form: { _id: form._id, title: form.title, type: form.type },
    columns,
    rows,
  });
});

// ─────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────
export default {
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
};