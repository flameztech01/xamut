// pages/FormEditor.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  useGetFormQuery,
  useUpdateFormMutation,
  usePublishFormMutation,
  useCloseFormMutation,
  useDeleteFormMutation,
  useUploadFormCoverMutation,
  useRemoveFormCoverMutation,
  useUploadFormMediaEditorMutation,
  useAddCollaboratorMutation,
  useListCollaboratorsQuery,
  useRemoveCollaboratorMutation,
  useUpdateCollaboratorRoleMutation,
  useResendCollaboratorInviteMutation,
  useAddParticipantsMutation,
  useListParticipantsQuery,
  useRemoveParticipantMutation,
  useResendParticipantCredentialsMutation,
  useListAccessRequestsQuery,
  useApproveAccessRequestMutation,
  useRejectAccessRequestMutation,
  useBulkReviewAccessRequestsMutation,
} from "../features/formApiSlice";
import {
  useStartFormAiSessionMutation,
  useAnswerFormAiQuestionMutation,
  useRegenerateFormAiDraftMutation,
  useConfirmFormAiSessionMutation,
  useCancelFormAiSessionMutation,
} from "../features/formAiApiSlice";

// ─────────────────────────────────────────────────────────────
// Field type metadata
// ─────────────────────────────────────────────────────────────
const FIELD_GROUPS = [
  {
    label: "Text",
    types: [
      { id: "short_text", label: "Short answer" },
      { id: "long_text", label: "Paragraph" },
      { id: "email", label: "Email" },
      { id: "phone", label: "Phone" },
      { id: "url", label: "URL" },
      { id: "number", label: "Number" },
    ],
  },
  {
    label: "Choice",
    types: [
      { id: "radio", label: "Multiple choice" },
      { id: "checkbox", label: "Checkboxes" },
      { id: "dropdown", label: "Dropdown" },
      { id: "multi_select", label: "Multi-select" },
      { id: "yes_no", label: "Yes / No" },
    ],
  },
  {
    label: "Date & time",
    types: [
      { id: "date", label: "Date" },
      { id: "time", label: "Time" },
    ],
  },
  {
    label: "Scale",
    types: [
      { id: "rating", label: "Rating" },
      { id: "scale", label: "Linear scale" },
    ],
  },
  {
    label: "Media",
    types: [
      { id: "image", label: "Image upload" },
      { id: "document", label: "Document upload" },
      { id: "file", label: "Any file" },
    ],
  },
  {
    label: "Other",
    types: [{ id: "section", label: "Section header" }],
  },
];

const FIELD_LABEL = Object.fromEntries(
  FIELD_GROUPS.flatMap((g) => g.types.map((t) => [t.id, t.label]))
);

const CHOICE_TYPES = new Set(["radio", "checkbox", "dropdown", "multi_select"]);
const SCORABLE_TYPES = new Set([
  "radio",
  "checkbox",
  "dropdown",
  "multi_select",
  "short_text",
  "long_text",
  "yes_no",
]);
const TEXT_INPUT_TYPES = new Set([
  "short_text",
  "long_text",
  "email",
  "phone",
  "url",
  "number",
]);
const MEDIA_TYPES = new Set(["image", "document", "file"]);

const ROLE_OPTIONS = [
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
];

const FORM_TYPES = [
  { id: "form", label: "Form" },
  { id: "quiz", label: "Quiz" },
  { id: "survey", label: "Survey" },
  { id: "feedback", label: "Feedback" },
  { id: "attendance", label: "Attendance" },
  { id: "election", label: "Election" },
];

const REQUEST_FIELD_TYPES = [
  { id: "short_text", label: "Short text" },
  { id: "long_text", label: "Paragraph" },
  { id: "email", label: "Email" },
  { id: "number", label: "Number" },
  { id: "phone", label: "Phone" },
  { id: "url", label: "URL" },
  { id: "date", label: "Date" },
];

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const genId = (prefix = "f") =>
  `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

const defaultField = (type = "short_text") => {
  const base = {
    id: genId(),
    type,
    label: FIELD_LABEL[type] || "Untitled field",
    description: "",
    placeholder: "",
    required: false,
    order: 0,
    options: [],
    scoring: { correct: [], points: 0 },
    validation: {
      min: null,
      max: null,
      minLength: null,
      maxLength: null,
      pattern: null,
      maxFiles: MEDIA_TYPES.has(type) ? 1 : null,
    },
  };

  if (CHOICE_TYPES.has(type)) {
    base.options = [
      { id: genId("o"), label: "Option 1", value: "Option 1" },
      { id: genId("o"), label: "Option 2", value: "Option 2" },
    ];
  }
  if (type === "rating") {
    base.validation.min = 1;
    base.validation.max = 5;
  }
  if (type === "scale") {
    base.validation.min = 1;
    base.validation.max = 10;
  }
  if (type === "image") {
    base.label = "Upload an image";
    base.description = "JPG, PNG or WEBP. Max 15MB.";
  }
  if (type === "document") {
    base.label = "Upload a document";
    base.description = "PDF, DOC, DOCX, XLS, PPT, TXT or ZIP. Max 15MB.";
  }
  return base;
};

const defaultCandidate = (order = 0) => ({
  id: genId("c"),
  name: "",
  bio: "",
  manifesto: "",
  photoUrl: "",
  slogan: "",
  metadata: {},
  order,
});

const defaultPosition = (order = 0) => ({
  id: genId("p"),
  title: "",
  description: "",
  maxSelections: 1,
  required: true,
  order,
  candidates: [defaultCandidate(0), defaultCandidate(1)],
});

const defaultRequestField = (order = 0) => ({
  id: genId("rf"),
  label: "",
  type: "short_text",
  required: false,
  placeholder: "",
  order,
});

const formatRelative = (iso) => {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.max(0, now - d);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
};

const toLocalInputValue = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
};

const fromLocalInputValue = (value) => {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
};

// ─────────────────────────────────────────────────────────────
// Icons
// ─────────────────────────────────────────────────────────────
const I = {
  back: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={c}>
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  plus: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={c}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  ),
  dots: (c) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={c}>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  ),
  trash: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M3 6h18M8 6v14a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6M10 11v6M14 11v6" strokeLinecap="round" />
    </svg>
  ),
  copy: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  chevUp: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={c}>
      <path d="M18 15l-6-6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevDown: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={c}>
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  close: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={c}>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  ),
  check: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" className={c}>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  eye: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  image: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <path d="M21 15l-5-5L5 21" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  upload: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  settings: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  ),
  share: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" />
    </svg>
  ),
  users: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" />
    </svg>
  ),
  chart: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M4 20V10M12 20V4M20 20v-7" strokeLinecap="round" />
    </svg>
  ),
  play: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M5 3l14 9-14 9V3z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  stop: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  ),
  link: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L12 5" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07L12 19" />
    </svg>
  ),
  drag: (c) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={c}>
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </svg>
  ),
  save: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17 21v-8H7v8M7 3v5h8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  mail: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  sparkle: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path
        d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 17l.9 2.1L22 20l-2.1.9L19 23l-.9-2.1L16 20l2.1-.9L19 17z"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  ballot: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M4 20h16M6 20V10h12v10M10 6l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  clock: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" strokeLinecap="round" />
    </svg>
  ),
  inbox: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 5.5L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────
// Dropdown
// ─────────────────────────────────────────────────────────────
const Dropdown = ({
  value,
  onChange,
  options,
  disabled = false,
  className = "",
  menuAlign = "left",
}) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("touchstart", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("touchstart", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="flex w-full items-center justify-between gap-2 rounded-md border border-stone-200 bg-white px-2.5 py-2 text-[12px] font-medium text-stone-700 transition-colors hover:border-stone-300 focus:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-500/10 disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-stone-600 dark:focus:border-teal-500/60"
      >
        <span className="truncate">{selected?.label ?? "Select"}</span>
        <span className="shrink-0 text-stone-400 dark:text-stone-500">
          {I.chevDown("h-3.5 w-3.5")}
        </span>
      </button>

      {open ? (
        <div
          role="listbox"
          className={`absolute top-full z-50 mt-1 min-w-full overflow-hidden rounded-md border border-stone-200/80 bg-white py-1 shadow-xl shadow-stone-900/10 dark:border-stone-700/80 dark:bg-stone-900 dark:shadow-black/40 ${
            menuAlign === "right" ? "right-0" : "left-0"
          }`}
        >
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 whitespace-nowrap px-3 py-1.5 text-left text-[12px] transition-colors ${
                  active
                    ? "bg-teal-50 font-semibold text-teal-700 dark:bg-teal-500/10 dark:text-teal-300"
                    : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
                }`}
              >
                <span className="truncate">{opt.label}</span>
                {active ? (
                  <span className="shrink-0 text-teal-600 dark:text-teal-400">
                    {I.check("h-3 w-3")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Toggle switch
// ─────────────────────────────────────────────────────────────
const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex cursor-pointer select-none items-start gap-3">
    <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="absolute inset-0 rounded-full bg-stone-200 transition-colors peer-checked:bg-teal-500 dark:bg-stone-700 dark:peer-checked:bg-teal-500" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 dark:bg-stone-100" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-[12.5px] font-medium text-stone-800 dark:text-stone-200">
        {label}
      </span>
      {hint ? (
        <span className="mt-0.5 block text-[11px] leading-snug text-stone-400 dark:text-stone-500">
          {hint}
        </span>
      ) : null}
    </span>
  </label>
);

// ─────────────────────────────────────────────────────────────
// Cover photo panel
// ─────────────────────────────────────────────────────────────
const CoverPhotoPanel = ({ formId, coverPhoto, onChanged }) => {
  const [uploadCover, { isLoading: uploading }] = useUploadFormCoverMutation();
  const [removeCover, { isLoading: removing }] = useRemoveFormCoverMutation();
  const inputRef = useRef(null);
  const [error, setError] = useState("");

  const pickFile = () => inputRef.current?.click();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick an image file (JPG, PNG, WEBP).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Image is bigger than 8MB.");
      return;
    }
    setError("");
    try {
      const res = await uploadCover({ id: formId, file }).unwrap();
      onChanged?.(res.coverPhoto || "");
    } catch (err) {
      setError(err?.data?.message || "Couldn't upload the cover.");
    }
  };

  const handleRemove = async () => {
    if (!coverPhoto) return;
    setError("");
    try {
      await removeCover(formId).unwrap();
      onChanged?.("");
    } catch (err) {
      setError(err?.data?.message || "Couldn't remove the cover.");
    }
  };

  const busy = uploading || removing;

  return (
    <div className="mb-4 rounded-lg border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />

      {coverPhoto ? (
        <div className="relative overflow-hidden rounded-t-lg">
          <img
            src={coverPhoto}
            alt="Form cover"
            className="h-36 w-full object-cover sm:h-44"
          />
          <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-3 py-2">
            <button
              type="button"
              onClick={pickFile}
              disabled={busy}
              className="rounded-md bg-white/95 px-2.5 py-1.5 text-[11px] font-semibold text-stone-800 shadow-sm transition-colors hover:bg-white disabled:opacity-60"
            >
              {uploading ? "Uploading…" : "Replace"}
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={busy}
              className="rounded-md bg-black/50 px-2.5 py-1.5 text-[11px] font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/70 disabled:opacity-60"
            >
              {removing ? "Removing…" : "Remove"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pickFile}
          disabled={busy}
          className="flex w-full items-center gap-3 rounded-lg px-4 py-3.5 text-left transition-colors hover:bg-stone-50 disabled:opacity-60 dark:hover:bg-stone-800/50"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-sm shadow-teal-500/25">
            {I.image("h-5 w-5")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] font-semibold text-stone-800 dark:text-stone-100">
              {uploading ? "Uploading cover…" : "Add a cover image"}
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-stone-400 dark:text-stone-500">
              Add your poster design or a banner. Shows at the top of the form.
            </span>
          </span>
          <span className="shrink-0 text-stone-300 dark:text-stone-600">
            {I.upload("h-4 w-4")}
          </span>
        </button>
      )}

      {error ? (
        <p className="border-t border-red-100 bg-red-50/70 px-3 py-1.5 text-[11px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Field type picker modal
// ─────────────────────────────────────────────────────────────
const FieldTypePicker = ({ open, onClose, onPick }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-900/50 backdrop-blur-[3px] dark:bg-black/60 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl dark:bg-stone-900 sm:rounded-xl">
        <div
          className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 dark:border-stone-800 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Add a field
            </h2>
            <p className="mt-0.5 text-[11.5px] text-stone-400 dark:text-stone-500">
              Pick the type of question you want to ask.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label="Close"
          >
            {I.close("h-4 w-4")}
          </button>
        </div>

        <div className="scrollbar-thin max-h-[65dvh] flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {FIELD_GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                {group.label}
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {group.types.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      onPick(t.id);
                      onClose();
                    }}
                    className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-2.5 text-left transition-all hover:border-teal-300 hover:bg-teal-50/70 active:scale-[0.98] dark:border-stone-700 dark:bg-stone-800 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-stone-700 dark:text-stone-200">
                      {t.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div
          className="flex items-center justify-end border-t border-stone-100 px-4 py-3 dark:border-stone-800 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3.5 py-2 text-[12.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Options editor
// ─────────────────────────────────────────────────────────────
const OptionsEditor = ({ field, onChange }) => {
  const updateOption = (idx, key, value) => {
    const options = [...field.options];
    options[idx] = { ...options[idx], [key]: value };
    if (key === "label") options[idx].value = value;
    onChange({ options });
  };

  const addOption = () => {
    const n = field.options.length + 1;
    onChange({
      options: [
        ...field.options,
        { id: genId("o"), label: `Option ${n}`, value: `Option ${n}` },
      ],
    });
  };

  const removeOption = (idx) => {
    if (field.options.length <= 1) return;
    onChange({ options: field.options.filter((_, i) => i !== idx) });
  };

  return (
    <div className="space-y-1.5">
      {field.options.map((opt, idx) => (
        <div key={opt.id} className="flex items-center gap-2">
          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-stone-300 dark:border-stone-600" />
          <input
            type="text"
            value={opt.label}
            onChange={(e) => updateOption(idx, "label", e.target.value)}
            placeholder={`Option ${idx + 1}`}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-stone-50 px-2.5 py-1.5 text-[12.5px] text-stone-800 outline-none transition-all focus:border-teal-300 focus:bg-white focus:ring-2 focus:ring-teal-500/10 dark:bg-stone-800 dark:text-stone-100 dark:focus:border-teal-500/50 dark:focus:bg-stone-900"
          />
          {field.options.length > 1 ? (
            <button
              type="button"
              onClick={() => removeOption(idx)}
              className="shrink-0 rounded-md p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-stone-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              aria-label="Remove option"
            >
              {I.close("h-3.5 w-3.5")}
            </button>
          ) : null}
        </div>
      ))}

      <button
        type="button"
        onClick={addOption}
        className="mt-1.5 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] font-semibold text-teal-600 transition-colors hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-500/10"
      >
        {I.plus("h-3 w-3")}
        Add option
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Scoring editor
// ─────────────────────────────────────────────────────────────
const ScoringEditor = ({ field, onChange }) => {
  const correct = field.scoring?.correct || [];
  const points = field.scoring?.points || 0;

  const toggleCorrect = (value) => {
    let next;
    if (field.type === "checkbox" || field.type === "multi_select") {
      next = correct.includes(value)
        ? correct.filter((v) => v !== value)
        : [...correct, value];
    } else {
      next = correct.includes(value) ? [] : [value];
    }
    onChange({ scoring: { ...field.scoring, correct: next, points } });
  };

  const setPoints = (p) => {
    onChange({ scoring: { ...field.scoring, correct, points: Number(p) || 0 } });
  };

  const isChoice = CHOICE_TYPES.has(field.type);

  return (
    <div className="rounded-lg border border-purple-200/70 bg-purple-50/40 p-3 dark:border-purple-500/30 dark:bg-purple-500/10">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-purple-700 dark:text-purple-400">
          Quiz scoring
        </p>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-purple-700 dark:text-purple-400">
            Points
          </label>
          <input
            type="number"
            min="0"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="w-14 rounded-md border border-purple-200 bg-white px-2 py-1 text-center text-[12px] font-semibold text-purple-800 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/10 dark:border-purple-500/40 dark:bg-stone-900 dark:text-purple-300"
          />
        </div>
      </div>

      {isChoice ? (
        <>
          <p className="mb-1.5 text-[11px] text-purple-700/80 dark:text-purple-400/80">
            Mark the correct{" "}
            {field.type === "checkbox" || field.type === "multi_select"
              ? "answers"
              : "answer"}
            :
          </p>
          <div className="flex flex-wrap gap-1.5">
            {field.options.map((opt) => {
              const active = correct.includes(opt.value);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggleCorrect(opt.value)}
                  className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? "border-purple-400 bg-purple-500 text-white dark:border-purple-500 dark:bg-purple-500"
                      : "border-purple-200 bg-white text-purple-700 hover:bg-purple-50 dark:border-purple-500/30 dark:bg-stone-900 dark:text-purple-300 dark:hover:bg-purple-500/10"
                  }`}
                >
                  {opt.label || opt.value}
                </button>
              );
            })}
          </div>
        </>
      ) : (
        <div>
          <p className="mb-1.5 text-[11px] text-purple-700/80 dark:text-purple-400/80">
            Accepted answer{correct.length > 1 ? "s" : ""} (comma-separated):
          </p>
          <input
            type="text"
            value={correct.join(", ")}
            onChange={(e) =>
              onChange({
                scoring: {
                  ...field.scoring,
                  correct: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                  points,
                },
              })
            }
            placeholder="e.g. Paris, paris"
            className="w-full rounded-md border border-purple-200 bg-white px-3 py-1.5 text-[12.5px] text-stone-800 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/10 dark:border-purple-500/40 dark:bg-stone-900 dark:text-stone-100"
          />
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Field card
// ─────────────────────────────────────────────────────────────
const FieldCard = ({
  field,
  index,
  total,
  isQuiz,
  onChange,
  onDelete,
  onDuplicate,
  onMoveUp,
  onMoveDown,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const isSection = field.type === "section";
  const isMedia = MEDIA_TYPES.has(field.type);

  const patch = (partial) => onChange({ ...field, ...partial });

  return (
    <div
      className={`group relative rounded-lg border bg-white transition-colors dark:bg-stone-900 ${
        isSection
          ? "border-dashed border-stone-300 bg-stone-50/50 dark:border-stone-700 dark:bg-stone-900/50"
          : "border-stone-200/80 hover:border-teal-300 dark:border-stone-800 dark:hover:border-teal-500/40"
      }`}
    >
      <div className="flex items-start gap-2 p-3.5 sm:p-4">
        <div className="hidden shrink-0 flex-col items-center pt-0.5 sm:flex">
          <span className="text-stone-300 dark:text-stone-600" title="Reorder with the arrows">
            {I.drag("h-4 w-4")}
          </span>
          <span className="mt-1 text-[10px] font-semibold text-stone-300 dark:text-stone-600">
            {index + 1}
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                {FIELD_LABEL[field.type] || field.type}
              </span>
              <span className="text-[10.5px] text-stone-300 dark:text-stone-600 sm:hidden">
                #{index + 1}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={onMoveUp}
                disabled={index === 0}
                className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                title="Move up"
              >
                {I.chevUp("h-3.5 w-3.5")}
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={index === total - 1}
                className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                title="Move down"
              >
                {I.chevDown("h-3.5 w-3.5")}
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                  title="More"
                >
                  {I.dots("h-3.5 w-3.5")}
                </button>
                {menuOpen ? (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                    <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-md border border-stone-200/80 bg-white py-1 shadow-xl shadow-stone-900/10 dark:border-stone-700/80 dark:bg-stone-900 dark:shadow-black/40">
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onDuplicate();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
                      >
                        {I.copy("h-3.5 w-3.5 text-stone-400 dark:text-stone-500")}
                        Duplicate
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          onDelete();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      >
                        {I.trash("h-3.5 w-3.5 text-red-500 dark:text-red-400")}
                        Delete
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <input
            type="text"
            value={field.label}
            onChange={(e) => patch({ label: e.target.value })}
            placeholder={isSection ? "Section title" : "Question"}
            className={`w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-stone-900 outline-none transition-all placeholder:text-stone-300 focus:border-teal-200 focus:bg-teal-50/30 focus:ring-2 focus:ring-teal-500/5 dark:text-stone-100 dark:placeholder:text-stone-600 dark:focus:border-teal-500/40 dark:focus:bg-teal-500/5 ${
              isSection ? "text-[15px] font-semibold" : "text-[14px] font-medium"
            }`}
          />

          <input
            type="text"
            value={field.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Add a description (optional)"
            className="mt-0.5 w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12px] text-stone-500 outline-none transition-all placeholder:text-stone-300 focus:border-teal-200 focus:bg-teal-50/30 dark:text-stone-400 dark:placeholder:text-stone-600 dark:focus:border-teal-500/40 dark:focus:bg-teal-500/5"
          />

          {isSection ? null : (
            <div className="mt-3 space-y-3">
              {CHOICE_TYPES.has(field.type) ? (
                <OptionsEditor field={field} onChange={patch} />
              ) : null}

              {TEXT_INPUT_TYPES.has(field.type) ? (
                <input
                  type="text"
                  value={field.placeholder || ""}
                  onChange={(e) => patch({ placeholder: e.target.value })}
                  placeholder="Placeholder text (optional)"
                  className="w-full rounded-md border border-stone-200 bg-stone-50/50 px-3 py-2 text-[12.5px] text-stone-700 outline-none transition-all placeholder:text-stone-400 focus:border-teal-300 focus:bg-white focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:placeholder:text-stone-500 dark:focus:border-teal-500/40 dark:focus:bg-stone-900"
                />
              ) : null}

              {isMedia ? (
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-stone-500 dark:text-stone-400">
                  <span>
                    {field.type === "image"
                      ? "Images"
                      : field.type === "document"
                      ? "Documents"
                      : "Files"}{" "}
                    per respondent
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={field.validation?.maxFiles ?? 1}
                    onChange={(e) =>
                      patch({
                        validation: {
                          ...field.validation,
                          maxFiles:
                            e.target.value === ""
                              ? 1
                              : Math.max(1, Math.min(10, Number(e.target.value) || 1)),
                        },
                      })
                    }
                    className="w-14 rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-[12px] text-stone-800 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                  />
                  <span className="text-stone-400 dark:text-stone-500">(1–10)</span>
                </div>
              ) : null}

              {["rating", "scale"].includes(field.type) ? (
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-stone-500 dark:text-stone-400">
                  <span>Range</span>
                  <input
                    type="number"
                    value={field.validation?.min ?? ""}
                    onChange={(e) =>
                      patch({
                        validation: {
                          ...field.validation,
                          min: e.target.value === "" ? null : Number(e.target.value),
                        },
                      })
                    }
                    placeholder="1"
                    className="w-16 rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-[12px] text-stone-800 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                  />
                  <span>to</span>
                  <input
                    type="number"
                    value={field.validation?.max ?? ""}
                    onChange={(e) =>
                      patch({
                        validation: {
                          ...field.validation,
                          max: e.target.value === "" ? null : Number(e.target.value),
                        },
                      })
                    }
                    placeholder="5"
                    className="w-16 rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-[12px] text-stone-800 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                  />
                </div>
              ) : null}

              {["short_text", "long_text"].includes(field.type) ? (
                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-stone-500 dark:text-stone-400">
                  <span>Min</span>
                  <input
                    type="number"
                    value={field.validation?.minLength ?? ""}
                    onChange={(e) =>
                      patch({
                        validation: {
                          ...field.validation,
                          minLength:
                            e.target.value === "" ? null : Number(e.target.value),
                        },
                      })
                    }
                    placeholder="0"
                    className="w-16 rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-[12px] text-stone-800 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                  />
                  <span>Max</span>
                  <input
                    type="number"
                    value={field.validation?.maxLength ?? ""}
                    onChange={(e) =>
                      patch({
                        validation: {
                          ...field.validation,
                          maxLength:
                            e.target.value === "" ? null : Number(e.target.value),
                        },
                      })
                    }
                    placeholder="500"
                    className="w-20 rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-[12px] text-stone-800 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
                  />
                  <span>chars</span>
                </div>
              ) : null}

              {isQuiz && SCORABLE_TYPES.has(field.type) ? (
                <ScoringEditor field={field} onChange={patch} />
              ) : null}

              <Toggle
                checked={!!field.required}
                onChange={(v) => patch({ required: v })}
                label="Required"
                hint="Respondent must answer before submitting"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Candidate photo picker — small circular avatar
// ─────────────────────────────────────────────────────────────
const CandidatePhotoButton = ({ formId, candidate, onUploaded }) => {
  const [upload, { isLoading }] = useUploadFormMediaEditorMutation();
  const inputRef = useRef(null);
  const [error, setError] = useState("");

  const pick = () => inputRef.current?.click();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pick an image.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setError("Image is bigger than 12MB.");
      return;
    }
    setError("");
    try {
      const res = await upload({ id: formId, file }).unwrap();
      onUploaded(res.url);
    } catch (err) {
      setError(err?.data?.message || "Upload failed.");
    }
  };

  return (
    <div className="flex flex-col items-center">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
      />
      <button
        type="button"
        onClick={pick}
        disabled={isLoading}
        title={candidate.photoUrl ? "Replace photo" : "Upload photo"}
        className="group relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-stone-300 bg-stone-50 transition-colors hover:border-teal-400 hover:bg-teal-50/50 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-800 dark:hover:border-teal-500/60 dark:hover:bg-teal-500/10"
      >
        {candidate.photoUrl ? (
          <>
            <img
              src={candidate.photoUrl}
              alt=""
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition-all group-hover:bg-black/40 group-hover:opacity-100">
              {I.upload("h-4 w-4")}
            </span>
          </>
        ) : (
          <span className="text-stone-400 dark:text-stone-500">
            {I.image("h-5 w-5")}
          </span>
        )}
        {isLoading ? (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-stone-900/70">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-300 border-t-teal-500" />
          </span>
        ) : null}
      </button>
      {error ? (
        <p className="mt-1 text-[10px] text-red-500 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Candidate row
// ─────────────────────────────────────────────────────────────
const CandidateRow = ({ formId, candidate, index, total, onChange, onDelete, onMoveUp, onMoveDown }) => {
  const [expanded, setExpanded] = useState(false);
  const patch = (partial) => onChange({ ...candidate, ...partial });

  return (
    <div className="rounded-lg border border-stone-200/80 bg-stone-50/40 p-3 dark:border-stone-800 dark:bg-stone-800/30">
      <div className="flex items-start gap-3">
        <CandidatePhotoButton
          formId={formId}
          candidate={candidate}
          onUploaded={(url) => patch({ photoUrl: url })}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={candidate.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder={`Candidate ${index + 1} name`}
              className="min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[13px] font-medium text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500"
            />
            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={onMoveUp}
                disabled={index === 0}
                className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 dark:text-stone-500 dark:hover:bg-stone-800"
                title="Move up"
              >
                {I.chevUp("h-3 w-3")}
              </button>
              <button
                type="button"
                onClick={onMoveDown}
                disabled={index === total - 1}
                className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 dark:text-stone-500 dark:hover:bg-stone-800"
                title="Move down"
              >
                {I.chevDown("h-3 w-3")}
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={total <= 1}
                className="rounded-md p-1 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-30 disabled:hover:bg-transparent dark:text-stone-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                title="Remove candidate"
              >
                {I.trash("h-3.5 w-3.5")}
              </button>
            </div>
          </div>

          <input
            type="text"
            value={candidate.slogan}
            onChange={(e) => patch({ slogan: e.target.value })}
            placeholder="Slogan (optional)"
            className="mt-1.5 w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] text-stone-700 outline-none transition-all placeholder:text-stone-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-500"
          />

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
          >
            {expanded ? I.chevUp("h-3 w-3") : I.chevDown("h-3 w-3")}
            {expanded ? "Hide details" : "Bio & manifesto"}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="mt-3 space-y-2 border-t border-stone-200/80 pt-3 dark:border-stone-800">
          <textarea
            rows={2}
            value={candidate.bio}
            onChange={(e) => patch({ bio: e.target.value })}
            placeholder="Short bio — who they are, what they've done."
            className="w-full resize-none rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[12.5px] leading-relaxed text-stone-700 outline-none transition-all placeholder:text-stone-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-500"
          />
          <textarea
            rows={3}
            value={candidate.manifesto}
            onChange={(e) => patch({ manifesto: e.target.value })}
            placeholder="Manifesto — what they promise to do."
            className="w-full resize-none rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[12.5px] leading-relaxed text-stone-700 outline-none transition-all placeholder:text-stone-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:placeholder:text-stone-500"
          />
        </div>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Position card
// ─────────────────────────────────────────────────────────────
const PositionCard = ({ formId, position, index, total, onChange, onDelete, onMoveUp, onMoveDown }) => {
  const patch = (partial) => onChange({ ...position, ...partial });

  const addCandidate = () => {
    const order = position.candidates.length;
    patch({
      candidates: [...position.candidates, defaultCandidate(order)],
    });
  };

  const updateCandidate = (idx, next) => {
    const candidates = [...position.candidates];
    candidates[idx] = next;
    patch({ candidates });
  };

  const deleteCandidate = (idx) => {
    if (position.candidates.length <= 1) return;
    patch({ candidates: position.candidates.filter((_, i) => i !== idx) });
  };

  const moveCandidate = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= position.candidates.length) return;
    const candidates = [...position.candidates];
    [candidates[idx], candidates[target]] = [candidates[target], candidates[idx]];
    patch({ candidates });
  };

  return (
    <div className="rounded-lg border border-rose-200/70 bg-white dark:border-rose-500/20 dark:bg-stone-900">
      <div className="border-b border-stone-100 p-3.5 dark:border-stone-800 sm:p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="inline-flex h-5 items-center gap-1 rounded bg-rose-50 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-rose-600 dark:bg-rose-500/15 dark:text-rose-400">
              {I.ballot("h-2.5 w-2.5")}
              Position #{index + 1}
            </span>
            <span className="text-[10.5px] text-stone-400 dark:text-stone-500">
              {position.candidates.length}{" "}
              {position.candidates.length === 1 ? "candidate" : "candidates"}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={onMoveUp}
              disabled={index === 0}
              className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 dark:text-stone-500 dark:hover:bg-stone-800"
              title="Move up"
            >
              {I.chevUp("h-3.5 w-3.5")}
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={index === total - 1}
              className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 dark:text-stone-500 dark:hover:bg-stone-800"
              title="Move down"
            >
              {I.chevDown("h-3.5 w-3.5")}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-md p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-stone-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              title="Delete position"
            >
              {I.trash("h-3.5 w-3.5")}
            </button>
          </div>
        </div>

        <input
          type="text"
          value={position.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Position title — e.g. President, Director of Socials"
          className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[15px] font-semibold text-stone-900 outline-none transition-all placeholder:text-stone-300 focus:border-rose-200 focus:bg-rose-50/30 dark:text-stone-100 dark:placeholder:text-stone-600 dark:focus:border-rose-500/40 dark:focus:bg-rose-500/5"
        />
        <input
          type="text"
          value={position.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="Optional description shown to voters"
          className="mt-0.5 w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-[12px] text-stone-500 outline-none transition-all placeholder:text-stone-300 focus:border-rose-200 focus:bg-rose-50/30 dark:text-stone-400 dark:placeholder:text-stone-600 dark:focus:border-rose-500/40 dark:focus:bg-rose-500/5"
        />

        <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[11.5px] text-stone-500 dark:text-stone-400">
          <label className="flex items-center gap-1.5">
            <span>Voters pick</span>
            <input
              type="number"
              min="1"
              max="20"
              value={position.maxSelections}
              onChange={(e) =>
                patch({
                  maxSelections: Math.max(
                    1,
                    Math.min(20, Number(e.target.value) || 1)
                  ),
                })
              }
              className="w-14 rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-[12px] text-stone-800 outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            />
            <span>{position.maxSelections === 1 ? "candidate" : "candidates"}</span>
          </label>
          <label className="flex cursor-pointer select-none items-center gap-1.5">
            <input
              type="checkbox"
              checked={!!position.required}
              onChange={(e) => patch({ required: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-stone-300 text-rose-500 focus:ring-rose-500/30 dark:border-stone-600"
            />
            <span>Required</span>
          </label>
        </div>
      </div>

      <div className="space-y-2 p-3.5 sm:p-4">
        {position.candidates.map((c, i) => (
          <CandidateRow
            key={c.id}
            formId={formId}
            candidate={c}
            index={i}
            total={position.candidates.length}
            onChange={(next) => updateCandidate(i, next)}
            onDelete={() => deleteCandidate(i)}
            onMoveUp={() => moveCandidate(i, -1)}
            onMoveDown={() => moveCandidate(i, 1)}
          />
        ))}

        <button
          type="button"
          onClick={addCandidate}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-stone-300 bg-white/50 py-2 text-[11.5px] font-semibold text-stone-500 transition-colors hover:border-rose-300 hover:bg-rose-50/40 hover:text-rose-600 dark:border-stone-700 dark:bg-stone-900/40 dark:text-stone-400 dark:hover:border-rose-500/50 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
        >
          {I.plus("h-3.5 w-3.5")}
          Add candidate
        </button>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Positions editor (election mode)
// ─────────────────────────────────────────────────────────────
const PositionsEditor = ({ formId, positions, onChange }) => {
  const add = () => {
    onChange([...positions, defaultPosition(positions.length)]);
  };

  const update = (idx, next) => {
    const copy = [...positions];
    copy[idx] = next;
    onChange(copy);
  };

  const remove = (idx) => {
    onChange(positions.filter((_, i) => i !== idx));
  };

  const move = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= positions.length) return;
    const copy = [...positions];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    onChange(copy);
  };

  return (
    <div className="space-y-3">
      {positions.map((p, i) => (
        <PositionCard
          key={p.id}
          formId={formId}
          position={p}
          index={i}
          total={positions.length}
          onChange={(next) => update(i, next)}
          onDelete={() => remove(i)}
          onMoveUp={() => move(i, -1)}
          onMoveDown={() => move(i, 1)}
        />
      ))}

      <button
        type="button"
        onClick={add}
        className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-rose-300 bg-rose-50/30 py-3.5 text-[12.5px] font-semibold text-rose-600 transition-colors hover:border-rose-400 hover:bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/5 dark:text-rose-400 dark:hover:border-rose-500/60 dark:hover:bg-rose-500/10"
      >
        {I.plus("h-4 w-4")}
        Add position
      </button>

      {positions.length === 0 ? (
        <p className="mt-1 text-center text-[11.5px] text-stone-400 dark:text-stone-500">
          Add at least one position with candidates before publishing.
        </p>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Request fields editor — owner-defined extra fields
// ─────────────────────────────────────────────────────────────
const RequestFieldsEditor = ({ fields, onChange }) => {
  const add = () =>
    onChange([...fields, defaultRequestField(fields.length)]);

  const update = (idx, next) => {
    const copy = [...fields];
    copy[idx] = next;
    onChange(copy);
  };

  const remove = (idx) => onChange(fields.filter((_, i) => i !== idx));

  const move = (idx, dir) => {
    const target = idx + dir;
    if (target < 0 || target >= fields.length) return;
    const copy = [...fields];
    [copy[idx], copy[target]] = [copy[target], copy[idx]];
    onChange(copy);
  };

  return (
    <div className="space-y-2">
      {fields.map((rf, i) => (
        <div
          key={rf.id}
          className="flex items-start gap-2 rounded-md border border-stone-200 bg-white p-2 dark:border-stone-700 dark:bg-stone-800"
        >
          <div className="min-w-0 flex-1 space-y-1.5">
            <input
              type="text"
              value={rf.label}
              onChange={(e) => update(i, { ...rf, label: e.target.value })}
              placeholder="Field label — e.g. Matric number, Department"
              className="w-full rounded-md border border-transparent bg-stone-50 px-2 py-1.5 text-[12px] text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-teal-300 focus:bg-white focus:ring-2 focus:ring-teal-500/10 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500"
            />
            <div className="flex items-center gap-1.5">
              <Dropdown
                value={rf.type}
                onChange={(v) => update(i, { ...rf, type: v })}
                options={REQUEST_FIELD_TYPES.map((t) => ({
                  value: t.id,
                  label: t.label,
                }))}
                className="w-32"
              />
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px] text-stone-600 dark:text-stone-300">
                <input
                  type="checkbox"
                  checked={!!rf.required}
                  onChange={(e) =>
                    update(i, { ...rf, required: e.target.checked })
                  }
                  className="h-3.5 w-3.5 rounded border-stone-300 text-teal-500 focus:ring-teal-500/30 dark:border-stone-600"
                />
                Required
              </label>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-0.5 pt-1">
            <button
              type="button"
              onClick={() => move(i, -1)}
              disabled={i === 0}
              className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 dark:text-stone-500 dark:hover:bg-stone-800"
              title="Move up"
            >
              {I.chevUp("h-3 w-3")}
            </button>
            <button
              type="button"
              onClick={() => move(i, 1)}
              disabled={i === fields.length - 1}
              className="rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 dark:text-stone-500 dark:hover:bg-stone-800"
              title="Move down"
            >
              {I.chevDown("h-3 w-3")}
            </button>
            <button
              type="button"
              onClick={() => remove(i)}
              className="rounded p-0.5 text-stone-300 hover:bg-red-50 hover:text-red-500 dark:text-stone-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
              title="Remove"
            >
              {I.trash("h-3 w-3")}
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={add}
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] font-semibold text-teal-600 transition-colors hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-500/10"
      >
        {I.plus("h-3 w-3")}
        Add request field
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Settings panel
// ─────────────────────────────────────────────────────────────
const SettingsPanel = ({ form, onChange }) => {
  const settings = form.settings || {};
  const isQuiz =
    form.type === "quiz" || form.fields.some((f) => f.scoring?.points > 0);
  const isElection = form.type === "election";
  const isPrivate = form.visibility === "private";

  const patch = (partial) => onChange({ settings: { ...settings, ...partial } });

  return (
    <div className="space-y-6">
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
          Form type
        </p>
        <div className="grid grid-cols-2 gap-2">
          {FORM_TYPES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange({ type: t.id })}
              className={`rounded-md border px-3 py-2 text-[12px] font-semibold transition-colors ${
                form.type === t.id
                  ? "border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500/60 dark:bg-teal-500/15 dark:text-teal-300"
                  : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {isElection ? (
          <p className="mt-1.5 text-[11px] leading-snug text-rose-600 dark:text-rose-400">
            Election mode uses positions and candidates instead of fields.
          </p>
        ) : null}
      </section>

      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
          Who can fill it
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: "public", label: "Anyone" },
            { id: "private", label: "Invited only" },
          ].map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onChange({ visibility: v.id })}
              className={`rounded-md border px-3 py-2 text-[12px] font-semibold transition-colors ${
                form.visibility === v.id
                  ? "border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500/60 dark:bg-teal-500/15 dark:text-teal-300"
                  : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </section>

      {/* Time window */}
      <section>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
          {I.clock("h-3.5 w-3.5")}
          Time window
        </p>
        <p className="mb-2 text-[11px] leading-snug text-stone-400 dark:text-stone-500">
          Optional. Opens at the start time and closes at the end time
          automatically — even if it's still "published".
        </p>
        <div className="space-y-2">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-stone-600 dark:text-stone-300">
              Starts
            </span>
            <input
              type="datetime-local"
              value={toLocalInputValue(form.startAt)}
              onChange={(e) =>
                onChange({ startAt: fromLocalInputValue(e.target.value) })
              }
              className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] text-stone-800 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:[color-scheme:dark]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-stone-600 dark:text-stone-300">
              Ends
            </span>
            <input
              type="datetime-local"
              value={toLocalInputValue(form.expiresAt)}
              onChange={(e) =>
                onChange({ expiresAt: fromLocalInputValue(e.target.value) })
              }
              className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] text-stone-800 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:[color-scheme:dark]"
            />
          </label>
          {form.startAt || form.expiresAt ? (
            <button
              type="button"
              onClick={() => onChange({ startAt: null, expiresAt: null })}
              className="text-[11px] font-semibold text-stone-500 underline-offset-2 hover:text-stone-800 hover:underline dark:text-stone-400 dark:hover:text-stone-100"
            >
              Clear window
            </button>
          ) : null}
        </div>
      </section>

      {/* Access requests (private only) */}
      {isPrivate ? (
        <section className="rounded-lg border border-teal-200/70 bg-teal-50/40 p-3 dark:border-teal-500/30 dark:bg-teal-500/10">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-400">
            {I.lock("h-3.5 w-3.5")}
            Access requests
          </p>
          <div className="space-y-3">
            <Toggle
              checked={!!settings.allowAccessRequests}
              onChange={(v) => patch({ allowAccessRequests: v })}
              label="Let visitors request access"
              hint="They submit their email (plus any fields below) and wait for your approval."
            />
            {settings.allowAccessRequests ? (
              <>
                <Toggle
                  checked={!!settings.autoApproveAccess}
                  onChange={(v) => patch({ autoApproveAccess: v })}
                  label="Auto-approve requests"
                  hint="Skip manual review — credentials are emailed the moment they ask."
                />

                <div className="border-t border-teal-200/60 pt-3 dark:border-teal-500/20">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-teal-700/80 dark:text-teal-400/80">
                    Extra info to collect
                  </p>
                  <p className="mb-2 text-[11px] leading-snug text-teal-700/70 dark:text-teal-400/70">
                    Ask for anything else you need to approve — matric number, department,
                    roll number, anything.
                  </p>
                  <RequestFieldsEditor
                    fields={settings.requestFields || []}
                    onChange={(rf) => patch({ requestFields: rf })}
                  />
                </div>
              </>
            ) : null}
          </div>
        </section>
      ) : null}

      {/* Election-specific */}
      {isElection ? (
        <section className="rounded-lg border border-rose-200/70 bg-rose-50/40 p-3 dark:border-rose-500/30 dark:bg-rose-500/10">
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">
            {I.ballot("h-3.5 w-3.5")}
            Election
          </p>
          <div className="space-y-3">
            <Toggle
              checked={!!settings.shufflePositions}
              onChange={(v) => patch({ shufflePositions: v })}
              label="Shuffle positions"
              hint="Randomise the order for each voter"
            />
            <Toggle
              checked={!!settings.allowAbstain}
              onChange={(v) => patch({ allowAbstain: v })}
              label="Allow abstaining"
              hint="Voters can skip a position even if it's marked required"
            />
            <Toggle
              checked={!!settings.requireAllPositions}
              onChange={(v) => patch({ requireAllPositions: v })}
              label="Require every position"
              hint="Only applies when abstaining is off"
            />
            <Toggle
              checked={!!settings.showLiveResults}
              onChange={(v) => patch({ showLiveResults: v })}
              label="Show live results to voters"
              hint="Voters see standings after they vote. Off = only you and your collaborators see them."
            />
          </div>
        </section>
      ) : null}

      {/* Behaviour */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
          Behaviour
        </p>
        <Toggle
          checked={!!settings.collectEmail}
          onChange={(v) => patch({ collectEmail: v })}
          label="Collect email addresses"
          hint="Respondents are asked for their email"
        />
        <Toggle
          checked={!!settings.allowMultipleSubmissions}
          onChange={(v) => patch({ allowMultipleSubmissions: v })}
          label="Allow multiple submissions"
          hint="Let the same person submit more than once"
        />
        {!isElection ? (
          <Toggle
            checked={!!settings.shuffleQuestions}
            onChange={(v) => patch({ shuffleQuestions: v })}
            label="Shuffle questions"
            hint="Randomise the order for each respondent"
          />
        ) : null}
        <Toggle
          checked={settings.showProgressBar !== false}
          onChange={(v) => patch({ showProgressBar: v })}
          label="Show progress bar"
        />
      </section>

      {/* Quiz scoring */}
      {isQuiz && !isElection ? (
        <section className="space-y-3 rounded-lg border border-purple-200/70 bg-purple-50/40 p-3 dark:border-purple-500/30 dark:bg-purple-500/10">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-purple-700 dark:text-purple-400">
            Quiz
          </p>
          <Toggle
            checked={!!settings.showScoreImmediately}
            onChange={(v) => patch({ showScoreImmediately: v })}
            label="Show score immediately"
            hint="Respondents see their score right after submitting"
          />
          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-purple-700 dark:text-purple-400">
              Pass percentage
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={settings.passPercentage ?? 0}
              onChange={(e) =>
                patch({
                  passPercentage: Math.max(
                    0,
                    Math.min(100, Number(e.target.value) || 0)
                  ),
                })
              }
              className="w-full rounded-md border border-purple-200 bg-white px-3 py-1.5 text-[12.5px] text-stone-800 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/10 dark:border-purple-500/40 dark:bg-stone-900 dark:text-stone-100"
            />
            <p className="mt-1 text-[10.5px] text-purple-700/70 dark:text-purple-400/70">
              Set 0 to disable pass/fail marking.
            </p>
          </div>
        </section>
      ) : null}

      {/* After submitting */}
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
          After submitting
        </p>
        <textarea
          rows={2}
          value={settings.confirmationMessage || ""}
          onChange={(e) => patch({ confirmationMessage: e.target.value })}
          placeholder={
            isElection
              ? "Thanks for voting!"
              : "Thanks, your response has been recorded."
          }
          className="w-full resize-none rounded-md border border-stone-200 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/40"
        />

        <div>
          <input
            type="url"
            value={settings.successRedirectUrl || ""}
            onChange={(e) => patch({ successRedirectUrl: e.target.value })}
            placeholder="https://chat.whatsapp.com/…"
            className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[12.5px] text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/40"
          />
          <p className="mt-1 text-[10.5px] leading-snug text-stone-400 dark:text-stone-500">
            Optional. After submitting, redirect respondents to a WhatsApp group,
            Telegram link, website, or thank-you page.
          </p>
        </div>
      </section>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// AI edit panel (unchanged — hidden for elections)
// ─────────────────────────────────────────────────────────────
const AiEditPanel = ({ formId, dirty, onSaveFirst, onApplied }) => {
  const [prompt, setPrompt] = useState("");
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picked, setPicked] = useState([]);
  const [otherText, setOtherText] = useState("");
  const [tweak, setTweak] = useState("");
  const [showTweak, setShowTweak] = useState(false);

  const [startSession] = useStartFormAiSessionMutation();
  const [answerQuestion] = useAnswerFormAiQuestionMutation();
  const [regenerate] = useRegenerateFormAiDraftMutation();
  const [confirmSession] = useConfirmFormAiSessionMutation();
  const [cancelSession] = useCancelFormAiSessionMutation();

  const resetLocalInputs = () => {
    setPicked([]);
    setOtherText("");
    setTweak("");
    setShowTweak(false);
    setError("");
  };

  const handleStart = async (e) => {
    e?.preventDefault?.();
    const text = prompt.trim();
    if (!text || busy) return;
    if (dirty) {
      const ok = await onSaveFirst?.();
      if (!ok) return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await startSession({ prompt: text, mode: "edit", formId }).unwrap();
      setSession(res.session);
      resetLocalInputs();
      setPrompt("");
    } catch (err) {
      setError(err?.data?.message || "Couldn't reach the AI.");
    } finally {
      setBusy(false);
    }
  };

  const handleAnswer = async () => {
    if (!session?.pendingQuestion) return;
    const other = otherText.trim();
    if (!picked.length && !other) {
      setError("Pick an option or type your own.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await answerQuestion({
        sessionId: session._id,
        answer: { optionIds: picked, otherText: other || undefined },
      }).unwrap();
      setSession(res.session);
      resetLocalInputs();
    } catch (err) {
      setError(err?.data?.message || "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  };

  const handleTweak = async () => {
    if (!session || !tweak.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await regenerate({
        sessionId: session._id,
        feedback: tweak.trim(),
      }).unwrap();
      setSession(res.session);
      setTweak("");
      setShowTweak(false);
    } catch (err) {
      setError(err?.data?.message || "Couldn't rework the draft.");
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      const res = await confirmSession({ sessionId: session._id }).unwrap();
      setSession(null);
      resetLocalInputs();
      await onApplied?.(res.result);
    } catch (err) {
      setError(err?.data?.message || "Couldn't apply changes.");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!session) return;
    setBusy(true);
    try {
      await cancelSession({ sessionId: session._id }).unwrap();
    } catch {
      /* swallow */
    } finally {
      setSession(null);
      resetLocalInputs();
      setBusy(false);
    }
  };

  const toggleOption = (opt) => {
    if (!session?.pendingQuestion) return;
    if (!session.pendingQuestion.multiSelect) {
      setPicked([opt.id]);
      return;
    }
    setPicked((prev) =>
      prev.includes(opt.id) ? prev.filter((x) => x !== opt.id) : [...prev, opt.id]
    );
  };

  if (!session) {
    return (
      <form
        onSubmit={handleStart}
        className="mb-4 overflow-hidden rounded-lg border border-teal-200/80 bg-gradient-to-br from-teal-50/60 to-white dark:border-teal-500/30 dark:from-teal-500/10 dark:to-stone-900"
      >
        <div className="flex items-center gap-2 px-3 py-2 sm:px-3.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-sm shadow-teal-500/30">
            {I.sparkle("h-3.5 w-3.5")}
          </span>
          <input
            type="text"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (error) setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleStart(e);
              }
            }}
            placeholder="Ask AI to edit this form — add a field, rename something, reorganize…"
            disabled={busy}
            className="min-w-0 flex-1 bg-transparent px-1 py-1.5 text-[13px] text-stone-900 outline-none placeholder:text-stone-400 disabled:opacity-60 dark:text-stone-100 dark:placeholder:text-stone-500"
          />
          <button
            type="submit"
            disabled={busy || !prompt.trim()}
            className="shrink-0 rounded-md bg-teal-600 px-3 py-1.5 text-[11.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-95 disabled:opacity-50 dark:bg-teal-500 dark:hover:bg-teal-400"
          >
            {busy ? "…" : "Ask"}
          </button>
        </div>
        {error ? (
          <p className="border-t border-red-100 bg-red-50/70 px-3 py-1.5 text-[11px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 sm:px-3.5">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  if (session.pendingQuestion) {
    const q = session.pendingQuestion;
    return (
      <div className="mb-4 overflow-hidden rounded-lg border border-teal-200/80 bg-gradient-to-br from-teal-50/60 to-white dark:border-teal-500/30 dark:from-teal-500/10 dark:to-stone-900">
        <div className="flex items-center justify-between gap-2 border-b border-teal-100/80 px-3 py-2 dark:border-teal-500/20 sm:px-3.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-sm shadow-teal-500/30">
              {I.sparkle("h-3 w-3")}
            </span>
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-teal-600 dark:text-teal-400">
              AI needs one thing
            </span>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-white/70 hover:text-stone-700 disabled:opacity-40 dark:text-stone-500 dark:hover:bg-stone-800/70 dark:hover:text-stone-200"
          >
            {I.close("h-3.5 w-3.5")}
          </button>
        </div>

        <div className="px-3 py-2.5 sm:px-3.5">
          <p className="mb-2 text-[13px] font-medium leading-snug text-stone-800 dark:text-stone-100">
            {q.text}
          </p>
          {q.helper ? (
            <p className="mb-2 text-[11.5px] leading-snug text-stone-500 dark:text-stone-400">
              {q.helper}
            </p>
          ) : null}

          {q.options?.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {q.options.map((opt) => {
                const active = picked.includes(opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => toggleOption(opt)}
                    disabled={busy}
                    className={`rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-all active:scale-[0.97] disabled:opacity-60 ${
                      active
                        ? "border-teal-400 bg-teal-500 text-white shadow-sm shadow-teal-500/25 dark:border-teal-400 dark:bg-teal-500"
                        : "border-stone-200 bg-white text-stone-700 hover:border-teal-300 hover:bg-teal-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {q.allowOther ? (
            <input
              type="text"
              value={otherText}
              onChange={(e) => {
                setOtherText(e.target.value);
                if (error) setError("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleAnswer();
                }
              }}
              placeholder={q.otherPlaceholder || "Or type your own…"}
              disabled={busy}
              className="mb-2 w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[12.5px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
            />
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={handleAnswer}
              disabled={busy || (!picked.length && !otherText.trim())}
              className="rounded-md bg-gradient-to-br from-teal-500 to-teal-600 px-4 py-1.5 text-[11.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:shadow-md active:scale-95 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Next"}
            </button>
          </div>
        </div>

        {error ? (
          <p className="border-t border-red-100 bg-red-50/70 px-3 py-1.5 text-[11px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 sm:px-3.5">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  if (session.awaitingConfirm && session.draft) {
    const draft = session.draft;
    const realFields = (draft.fields || []).filter((f) => f.type !== "section");
    const newCount = realFields.length;

    return (
      <div className="mb-4 overflow-hidden rounded-lg border border-teal-200/80 bg-gradient-to-br from-teal-50/60 to-white dark:border-teal-500/30 dark:from-teal-500/10 dark:to-stone-900">
        <div className="flex items-center justify-between gap-2 border-b border-teal-100/80 px-3 py-2 dark:border-teal-500/20 sm:px-3.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-teal-500 to-teal-600 text-white shadow-sm shadow-teal-500/30">
              {I.check("h-3 w-3")}
            </span>
            <span className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-teal-600 dark:text-teal-400">
              AI proposal
            </span>
            <span className="shrink-0 rounded-full bg-white/80 px-1.5 py-0.5 text-[9.5px] font-semibold text-teal-600 ring-1 ring-teal-100 dark:bg-stone-800/80 dark:text-teal-400 dark:ring-teal-500/20">
              {newCount} field{newCount === 1 ? "" : "s"}
            </span>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            disabled={busy}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-white/70 hover:text-stone-700 disabled:opacity-40 dark:text-stone-500 dark:hover:bg-stone-800/70 dark:hover:text-stone-200"
          >
            {I.close("h-3.5 w-3.5")}
          </button>
        </div>

        <div
          className="scrollbar-thin overflow-y-auto px-3 py-2.5 sm:px-3.5"
          style={{ maxHeight: "min(44dvh, 320px)" }}
        >
          {session.messages?.length ? (
            <p className="mb-2 text-[12px] leading-snug text-stone-600 dark:text-stone-300">
              {session.messages[session.messages.length - 1]?.content ||
                "Here's the updated form."}
            </p>
          ) : null}

          <div className="space-y-1">
            {realFields.length === 0 ? (
              <p className="py-2 text-center text-[11.5px] text-stone-400 dark:text-stone-500">
                The proposal has no fields. Something went wrong.
              </p>
            ) : (
              realFields.map((f, i) => (
                <div
                  key={f.id || i}
                  className="rounded-md border border-stone-200/80 bg-white px-2.5 py-2 dark:border-stone-700/80 dark:bg-stone-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 break-words text-[12.5px] font-medium leading-snug text-stone-800 dark:text-stone-100">
                      <span className="mr-1.5 text-stone-400 dark:text-stone-500">
                        {i + 1}.
                      </span>
                      {f.label || `Question ${i + 1}`}
                      {f.required ? (
                        <span className="ml-1 text-teal-500 dark:text-teal-400">*</span>
                      ) : null}
                    </p>
                    <span className="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-500 dark:bg-stone-800 dark:text-stone-400">
                      {FIELD_LABEL[f.type] || f.type}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {showTweak ? (
          <div className="border-t border-teal-100/80 px-3 py-2.5 dark:border-teal-500/20 sm:px-3.5">
            <textarea
              rows={2}
              value={tweak}
              onChange={(e) => setTweak(e.target.value)}
              placeholder="What should change? e.g. 'make Q3 required'"
              autoFocus
              disabled={busy}
              className="w-full resize-none rounded-md border border-stone-200 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 disabled:opacity-60 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowTweak(false);
                  setTweak("");
                }}
                disabled={busy}
                className="rounded-md px-3 py-1.5 text-[11.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleTweak}
                disabled={busy || !tweak.trim()}
                className="rounded-md border border-stone-200 bg-white px-3.5 py-1.5 text-[11.5px] font-semibold text-stone-700 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10 dark:hover:text-teal-300"
              >
                {busy ? "Reworking…" : "Apply change"}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 border-t border-teal-100/80 px-3 py-2 dark:border-teal-500/20 sm:px-3.5">
            <button
              type="button"
              onClick={() => setShowTweak(true)}
              disabled={busy}
              className="rounded-md px-3 py-1.5 text-[11.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            >
              Keep tweaking
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || realFields.length === 0}
              className="rounded-md bg-gradient-to-br from-teal-500 to-teal-600 px-4 py-1.5 text-[11.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:shadow-md active:scale-95 disabled:opacity-50"
            >
              {busy ? "Applying…" : "Apply to form"}
            </button>
          </div>
        )}

        {error ? (
          <p className="border-t border-red-100 bg-red-50/70 px-3 py-1.5 text-[11px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400 sm:px-3.5">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return null;
};

// ─────────────────────────────────────────────────────────────
// Access requests modal
// ─────────────────────────────────────────────────────────────
const AccessRequestsModal = ({ open, onClose, formId, requestFields }) => {
  const { data, isLoading } = useListAccessRequestsQuery(
    { id: formId, status: "pending" },
    { skip: !open }
  );
  const [approve, { isLoading: approving }] = useApproveAccessRequestMutation();
  const [reject, { isLoading: rejecting }] = useRejectAccessRequestMutation();
  const [bulkReview, { isLoading: bulking }] = useBulkReviewAccessRequestsMutation();

  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setNote("");
      setError("");
      setBusyId(null);
    }
  }, [open]);

  if (!open) return null;

  const requests = data?.requests || [];

  const handleApprove = async (id) => {
    setError("");
    setBusyId(id);
    try {
      await approve({ id: formId, requestId: id, note }).unwrap();
      setNote("");
    } catch (err) {
      setError(err?.data?.message || "Couldn't approve.");
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id) => {
    setError("");
    setBusyId(id);
    try {
      await reject({ id: formId, requestId: id, note }).unwrap();
      setNote("");
    } catch (err) {
      setError(err?.data?.message || "Couldn't reject.");
    } finally {
      setBusyId(null);
    }
  };

  const handleBulk = async (action) => {
    if (!requests.length) return;
    setError("");
    setBusyId("bulk");
    try {
      await bulkReview({
        id: formId,
        ids: requests.map((r) => r._id),
        action,
        note,
      }).unwrap();
      setNote("");
    } catch (err) {
      setError(err?.data?.message || "Bulk action failed.");
    } finally {
      setBusyId(null);
    }
  };

  const busy = approving || rejecting || bulking;

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-stone-900/50 backdrop-blur-[3px] dark:bg-black/60 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl dark:bg-stone-900 sm:rounded-xl">
        <div
          className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 dark:border-stone-800 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div>
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              {I.inbox("h-4 w-4")}
              Access requests
            </h2>
            <p className="mt-0.5 text-[11.5px] text-stone-400 dark:text-stone-500">
              Approve to send credentials by email, or decline with an optional reason.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label="Close"
          >
            {I.close("h-4 w-4")}
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-20 animate-pulse rounded-md bg-stone-100 dark:bg-stone-800/60"
                />
              ))}
            </div>
          ) : requests.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[13px] font-medium text-stone-700 dark:text-stone-200">
                All caught up 🎉
              </p>
              <p className="mt-1 text-[11.5px] text-stone-400 dark:text-stone-500">
                No pending requests right now.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {requests.map((r) => {
                const isBusy = busyId === r._id;
                return (
                  <div
                    key={r._id}
                    className="rounded-lg border border-stone-200 bg-white p-3 dark:border-stone-800 dark:bg-stone-900"
                  >
                    <div className="flex items-start gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-[12px] font-semibold text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                        {(r.name || r.email || "?").charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-semibold text-stone-800 dark:text-stone-100">
                          {r.name || r.email.split("@")[0]}
                        </p>
                        <p className="truncate text-[11px] text-stone-400 dark:text-stone-500">
                          {r.email} · {formatRelative(r.requestedAt)}
                        </p>

                        {r.note ? (
                          <p className="mt-1.5 rounded-md bg-stone-50 px-2 py-1.5 text-[11.5px] leading-snug text-stone-600 dark:bg-stone-800/60 dark:text-stone-300">
                            "{r.note}"
                          </p>
                        ) : null}

                        {requestFields?.length && r.extraInfo ? (
                          <div className="mt-1.5 space-y-0.5">
                            {requestFields.map((rf) => {
                              const v = r.extraInfo?.[rf.id];
                              if (v == null || v === "") return null;
                              return (
                                <p
                                  key={rf.id}
                                  className="text-[11px] leading-snug text-stone-500 dark:text-stone-400"
                                >
                                  <span className="font-medium text-stone-600 dark:text-stone-300">
                                    {rf.label}:
                                  </span>{" "}
                                  {String(v)}
                                </p>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleReject(r._id)}
                        disabled={busy}
                        className="rounded-md border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                      >
                        {isBusy && rejecting ? "…" : "Decline"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApprove(r._id)}
                        disabled={busy}
                        className="rounded-md bg-teal-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:hover:bg-teal-400"
                      >
                        {isBusy && approving ? "…" : "Approve"}
                      </button>
                    </div>
                  </div>
                );
              })}

              {requests.length > 1 ? (
                <div className="mt-3 rounded-md border border-stone-200 bg-stone-50/60 p-2.5 dark:border-stone-700 dark:bg-stone-800/40">
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
                    Bulk · {requests.length} pending
                  </p>
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleBulk("reject")}
                      disabled={busy}
                      className="rounded-md border border-stone-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-600 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:border-red-500/40 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                    >
                      Decline all
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulk("approve")}
                      disabled={busy}
                      className="rounded-md bg-teal-600 px-3 py-1 text-[11px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-colors hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-500 dark:hover:bg-teal-400"
                    >
                      Approve all
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="border-t border-stone-100 px-4 py-3 dark:border-stone-800 sm:px-5">
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
            Note (optional)
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Included in the email — 'see you at the polling unit' etc."
            className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-[12px] text-stone-800 outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
          />
          {error ? (
            <p className="mt-1.5 text-[11px] text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}
        </div>

        <div
          className="flex items-center justify-end border-t border-stone-100 px-4 py-3 dark:border-stone-800 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Share modal (unchanged)
// ─────────────────────────────────────────────────────────────
const ShareModal = ({ open, onClose, formId }) => {
  const { data, isLoading } = useListCollaboratorsQuery(formId, { skip: !open });
  const [addCollaborator, { isLoading: adding }] = useAddCollaboratorMutation();
  const [removeCollaborator] = useRemoveCollaboratorMutation();
  const [updateRole] = useUpdateCollaboratorRoleMutation();
  const [resendInvite, { isLoading: resending }] = useResendCollaboratorInviteMutation();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [error, setError] = useState("");
  const [lastResult, setLastResult] = useState(null);
  const [resendingFor, setResendingFor] = useState(null);

  if (!open) return null;

  const handleAdd = async (e) => {
    e.preventDefault();
    setError("");
    setLastResult(null);
    if (!email.trim()) return;
    try {
      const res = await addCollaborator({
        id: formId,
        email: email.trim(),
        role,
      }).unwrap();
      setLastResult({
        invited: !!res.invited,
        added: !!res.added,
        email: email.trim().toLowerCase(),
      });
      setEmail("");
    } catch (err) {
      setError(err?.data?.message || "Couldn't add collaborator.");
    }
  };

  const handleResend = async (pendingEmail) => {
    setError("");
    setResendingFor(pendingEmail);
    try {
      await resendInvite({ id: formId, email: pendingEmail }).unwrap();
    } catch (err) {
      setError(err?.data?.message || "Couldn't resend invite.");
    } finally {
      setResendingFor(null);
    }
  };

  const owner = data?.owner;
  const collabs = data?.collaborators || [];
  const pending = data?.pendingCollaborators || [];

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-stone-900/50 backdrop-blur-[3px] dark:bg-black/60 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl dark:bg-stone-900 sm:rounded-xl">
        <div
          className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 dark:border-stone-800 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Share form
            </h2>
            <p className="mt-0.5 text-[11.5px] text-stone-400 dark:text-stone-500">
              Invite people to help edit or view responses.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label="Close"
          >
            {I.close("h-4 w-4")}
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <form onSubmit={handleAdd} className="mb-4 space-y-2">
            <div className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError("");
                  if (lastResult) setLastResult(null);
                }}
                placeholder="name@example.com"
                className="min-w-0 flex-1 rounded-md border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/40"
              />
              <Dropdown
                value={role}
                onChange={setRole}
                options={ROLE_OPTIONS}
                className="w-24 shrink-0"
                menuAlign="right"
              />
              <button
                type="submit"
                disabled={adding || !email.trim()}
                className="shrink-0 rounded-md bg-teal-600 px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-95 disabled:opacity-50 dark:bg-teal-500 dark:hover:bg-teal-400"
              >
                {adding ? "…" : "Invite"}
              </button>
            </div>

            {error ? (
              <p className="text-[11.5px] text-red-600 dark:text-red-400">{error}</p>
            ) : null}

            {lastResult ? (
              <div className="flex items-start gap-2 rounded-md bg-teal-50 px-2.5 py-2 text-[11.5px] leading-snug text-teal-700 dark:bg-teal-500/10 dark:text-teal-300">
                <span className="mt-0.5 shrink-0">{I.mail("h-3.5 w-3.5")}</span>
                <span>
                  {lastResult.invited ? (
                    <>
                      Invite sent to{" "}
                      <span className="font-semibold">{lastResult.email}</span>.
                    </>
                  ) : (
                    <>
                      Added{" "}
                      <span className="font-semibold">{lastResult.email}</span>{" "}
                      as a collaborator.
                    </>
                  )}
                </span>
              </div>
            ) : null}
          </form>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-md bg-stone-100 dark:bg-stone-800/60"
                />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {owner ? (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                    Owner
                  </p>
                  <div className="flex items-center gap-2.5 rounded-md border border-stone-200 bg-stone-50/70 px-3 py-2.5 dark:border-stone-800 dark:bg-stone-800/40">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-semibold text-white dark:bg-stone-100 dark:text-stone-900">
                      {(owner.name || owner.email || "?").charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-semibold text-stone-800 dark:text-stone-100">
                        {owner.name || owner.email}
                      </p>
                      <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
                        {owner.email}
                      </p>
                    </div>
                  </div>
                </div>
              ) : null}

              {collabs.length ? (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                    Collaborators · {collabs.length}
                  </p>
                  <div className="space-y-1.5">
                    {collabs.map((c) => (
                      <div
                        key={c.user}
                        className="flex items-center gap-2.5 rounded-md border border-stone-200 bg-white px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-semibold text-teal-700 dark:bg-teal-500/20 dark:text-teal-300">
                          {(c.name || c.email || "?").charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold text-stone-800 dark:text-stone-100">
                            {c.name || c.email}
                          </p>
                          <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
                            {c.email}
                          </p>
                        </div>
                        <Dropdown
                          value={c.role}
                          onChange={(next) =>
                            updateRole({ id: formId, userId: c.user, role: next })
                          }
                          options={ROLE_OPTIONS}
                          className="w-24 shrink-0"
                          menuAlign="right"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            removeCollaborator({ id: formId, userId: c.user })
                          }
                          className="shrink-0 rounded-md p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-stone-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                          aria-label="Remove"
                        >
                          {I.trash("h-3.5 w-3.5")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {pending.length ? (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                    Pending invites · {pending.length}
                  </p>
                  <div className="space-y-1.5">
                    {pending.map((p) => (
                      <div
                        key={p.email}
                        className="flex items-center gap-2.5 rounded-md border border-dashed border-stone-300 bg-stone-50/60 px-3 py-2.5 dark:border-stone-700 dark:bg-stone-900/60"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-200 text-[11px] font-semibold text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                          {(p.name || p.email || "?").charAt(0).toUpperCase()}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[12.5px] font-semibold text-stone-800 dark:text-stone-100">
                            {p.name || p.email}
                          </p>
                          <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
                            {p.role === "editor" ? "Editor" : "Viewer"} · invited{" "}
                            {formatRelative(p.lastInvitedAt || p.invitedAt)}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleResend(p.email)}
                          disabled={resendingFor === p.email || resending}
                          className="shrink-0 rounded-md px-2 py-1 text-[10.5px] font-semibold text-teal-600 transition-colors hover:bg-teal-50 disabled:opacity-50 dark:text-teal-400 dark:hover:bg-teal-500/10"
                        >
                          {resendingFor === p.email ? "Sending…" : "Resend"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            removeCollaborator({ id: formId, email: p.email })
                          }
                          className="shrink-0 rounded-md p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-stone-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                        >
                          {I.trash("h-3.5 w-3.5")}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end border-t border-stone-100 px-4 py-3 dark:border-stone-800 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Participants modal (unchanged)
// ─────────────────────────────────────────────────────────────
const ParticipantsModal = ({ open, onClose, formId }) => {
  const { data, isLoading } = useListParticipantsQuery(formId, { skip: !open });
  const [addParticipants, { isLoading: adding }] = useAddParticipantsMutation();
  const [removeParticipant] = useRemoveParticipantMutation();
  const [resend] = useResendParticipantCredentialsMutation();

  const [bulk, setBulk] = useState("");
  const [created, setCreated] = useState([]);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");

  if (!open) return null;

  const handleAdd = async (e) => {
    e.preventDefault();
    setError("");
    setCreated([]);

    const emails = bulk
      .split(/[\s,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (!emails.length) {
      setError("Add at least one email.");
      return;
    }

    try {
      const res = await addParticipants({
        id: formId,
        participants: emails.map((email) => ({ email })),
      }).unwrap();
      setCreated(res.added || []);
      setBulk("");
    } catch (err) {
      setError(err?.data?.message || "Couldn't add participants.");
    }
  };

  const copyCreds = async (p) => {
    const text = `Email: ${p.email}\nPassword: ${p.password}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(p.email);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* noop */
    }
  };

  const participants = data?.participants || [];

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-stone-900/50 backdrop-blur-[3px] dark:bg-black/60 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl dark:bg-stone-900 sm:rounded-xl">
        <div
          className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 dark:border-stone-800 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Invite participants
            </h2>
            <p className="mt-0.5 text-[11.5px] text-stone-400 dark:text-stone-500">
              They don't need a Xamut account. Each one gets a unique password by email.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label="Close"
          >
            {I.close("h-4 w-4")}
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <form onSubmit={handleAdd} className="mb-4 space-y-2">
            <textarea
              rows={2}
              value={bulk}
              onChange={(e) => {
                setBulk(e.target.value);
                if (error) setError("");
              }}
              placeholder="Paste emails, one per line or comma-separated"
              className="w-full resize-none rounded-md border border-stone-200 bg-white px-3 py-2.5 text-[13px] leading-relaxed text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-teal-300 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-teal-500/40"
            />
            {error ? (
              <p className="text-[11.5px] text-red-600 dark:text-red-400">{error}</p>
            ) : null}
            <button
              type="submit"
              disabled={adding || !bulk.trim()}
              className="w-full rounded-md bg-teal-600 px-3.5 py-2.5 text-[12.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:opacity-50 dark:bg-teal-500 dark:hover:bg-teal-400"
            >
              {adding ? "Sending invites…" : "Send invites"}
            </button>
          </form>

          {created.length ? (
            <div className="mb-4 rounded-md border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                Just added · passwords below
              </p>
              <div className="space-y-1.5">
                {created.map((p) => (
                  <div
                    key={p.email}
                    className="flex items-center gap-2 rounded-md bg-white/70 px-2.5 py-1.5 dark:bg-stone-900/60"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-emerald-900 dark:text-emerald-300">
                      {p.email}
                    </span>
                    <code className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-mono text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300">
                      {p.password}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyCreds(p)}
                      className="shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-100 dark:text-emerald-400 dark:hover:bg-emerald-500/20"
                    >
                      {copied === p.email ? (
                        <span className="text-[10px] font-semibold">Copied</span>
                      ) : (
                        I.copy("h-3 w-3")
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-12 animate-pulse rounded-md bg-stone-100 dark:bg-stone-800/60"
                />
              ))}
            </div>
          ) : participants.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-stone-400 dark:text-stone-500">
              No participants yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              {participants.map((p) => (
                <div
                  key={p._id}
                  className="flex items-center gap-2.5 rounded-md border border-stone-200 bg-white px-3 py-2.5 dark:border-stone-800 dark:bg-stone-900"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      p.completed
                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                        : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                    }`}
                  >
                    {(p.name || p.email || "?").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-stone-800 dark:text-stone-100">
                      {p.name || p.email}
                    </p>
                    <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
                      {p.completed ? "Submitted" : "Not yet submitted"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => resend({ id: formId, participantId: p._id })}
                    className="shrink-0 rounded-md px-2 py-1 text-[10.5px] font-semibold text-teal-600 transition-colors hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-500/10"
                  >
                    Resend
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      removeParticipant({ id: formId, participantId: p._id })
                    }
                    className="shrink-0 rounded-md p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 dark:text-stone-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                  >
                    {I.trash("h-3.5 w-3.5")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end border-t border-stone-100 px-4 py-3 dark:border-stone-800 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Editor menu
// ─────────────────────────────────────────────────────────────
const EditorMenu = ({
  form,
  onShare,
  onParticipants,
  onCopyLink,
  onPublish,
  onClose,
  onPreview,
  onResponses,
  onDelete,
  onAccessRequests,
  publishing,
  deleting,
  pendingRequestsCount,
}) => {
  const [open, setOpen] = useState(false);

  const items = [
    { id: "responses", label: "View responses", icon: I.chart, handler: onResponses },
    {
      id: "preview",
      label: form.status === "open" ? "Open public page" : "Preview (publish first)",
      icon: I.eye,
      handler: onPreview,
      disabled: form.status !== "open",
    },
    { id: "share", label: "Share with collaborators", icon: I.share, handler: onShare },
    {
      id: "participants",
      label: "Manage participants",
      icon: I.users,
      handler: onParticipants,
      hidden: form.visibility !== "private",
    },
    {
      id: "access-requests",
      label:
        pendingRequestsCount > 0
          ? `Access requests (${pendingRequestsCount})`
          : "Access requests",
      icon: I.inbox,
      handler: onAccessRequests,
      hidden: form.visibility !== "private",
    },
    { id: "copy-link", label: "Copy public link", icon: I.link, handler: onCopyLink },
    {
      id: "publish",
      label: form.status === "open" ? "Republish" : "Publish form",
      icon: I.play,
      handler: onPublish,
      disabled: publishing,
    },
    {
      id: "close",
      label: "Close form",
      icon: I.stop,
      handler: onClose,
      hidden: form.status !== "open",
    },
    {
      id: "delete",
      label: "Delete form",
      icon: I.trash,
      handler: onDelete,
      danger: true,
      disabled: deleting,
    },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
        aria-label="More actions"
      >
        {I.dots("h-4 w-4")}
        {pendingRequestsCount > 0 ? (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-white">
            {pendingRequestsCount > 9 ? "9+" : pendingRequestsCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-60 overflow-hidden rounded-md border border-stone-200/80 bg-white py-1 shadow-xl shadow-stone-900/10 dark:border-stone-700/80 dark:bg-stone-900 dark:shadow-black/40">
            {items
              .filter((it) => !it.hidden)
              .map((it) => (
                <button
                  key={it.id}
                  type="button"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.handler?.();
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] leading-tight transition-colors disabled:opacity-40 ${
                    it.danger
                      ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                      : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
                  }`}
                >
                  <span
                    className={
                      it.danger
                        ? "text-red-500 dark:text-red-400"
                        : "text-stone-400 dark:text-stone-500"
                    }
                  >
                    {it.icon("h-3.5 w-3.5")}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                </button>
              ))}
          </div>
        </>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
const FormEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error, refetch } = useGetFormQuery(id, { skip: !id });

  const [updateForm, { isLoading: saving }] = useUpdateFormMutation();
  const [publishForm, { isLoading: publishing }] = usePublishFormMutation();
  const [closeForm] = useCloseFormMutation();
  const [deleteForm, { isLoading: deleting }] = useDeleteFormMutation();

  const [form, setForm] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);

  const loadedRef = useRef(false);

  useEffect(() => {
    if (data?.form && !loadedRef.current) {
      setForm(data.form);
      loadedRef.current = true;
    }
  }, [data]);

  useEffect(() => {
    loadedRef.current = false;
    setForm(null);
    setDirty(false);
  }, [id]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  };

  const patchForm = (partial) => {
    setForm((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  };

  // ── Field ops (non-election) ─────────────────────────────
  const addField = (type) => {
    const field = defaultField(type);
    patchForm({
      fields: [...(form.fields || []), { ...field, order: form.fields?.length || 0 }],
    });
  };

  const updateField = (index, next) => {
    const fields = [...form.fields];
    fields[index] = next;
    patchForm({ fields });
  };

  const deleteField = (index) => {
    patchForm({ fields: form.fields.filter((_, i) => i !== index) });
  };

  const duplicateField = (index) => {
    const orig = form.fields[index];
    const copy = {
      ...orig,
      id: genId(),
      options: (orig.options || []).map((o) => ({ ...o, id: genId("o") })),
    };
    const fields = [...form.fields];
    fields.splice(index + 1, 0, copy);
    patchForm({ fields });
  };

  const moveField = (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= form.fields.length) return;
    const fields = [...form.fields];
    [fields[index], fields[target]] = [fields[target], fields[index]];
    patchForm({ fields });
  };

  // ── Save / publish / close ───────────────────────────────
  const handleSave = async () => {
    if (!form) return false;
    try {
      const payload = {
        title: form.title,
        description: form.description,
        type: form.type,
        visibility: form.visibility,
        fields: form.fields,
        positions: form.positions || [],
        settings: form.settings,
        isMultipage: form.isMultipage,
        coverPhoto: form.coverPhoto || "",
        startAt: form.startAt || null,
        expiresAt: form.expiresAt || null,
      };
      const res = await updateForm({ id, ...payload }).unwrap();
      setForm(res.form);
      setDirty(false);
      showToast("Saved.");
      return true;
    } catch (err) {
      showToast(err?.data?.message || "Couldn't save.");
      return false;
    }
  };

  const handleCoverChanged = (newUrl) => {
    setForm((prev) => (prev ? { ...prev, coverPhoto: newUrl } : prev));
  };

  const handlePublish = async () => {
    if (dirty) {
      const ok = await handleSave();
      if (!ok) return;
    }
    try {
      const res = await publishForm(id).unwrap();
      setForm(res.form);
      showToast("Form published.");
    } catch (err) {
      showToast(err?.data?.message || "Couldn't publish.");
    }
  };

  const handleClose = async () => {
    try {
      const res = await closeForm(id).unwrap();
      setForm(res.form);
      setConfirmClose(false);
      showToast("Form closed.");
    } catch (err) {
      showToast(err?.data?.message || "Couldn't close.");
    }
  };

  const handleDelete = async () => {
    if (
      !window.confirm(
        "Delete this form and all its responses? This can't be undone."
      )
    )
      return;
    try {
      await deleteForm(id).unwrap();
      navigate("/forms");
    } catch (err) {
      showToast(err?.data?.message || "Couldn't delete.");
    }
  };

  const handleCopyLink = async () => {
    if (!form?.slug) return;
    const url = `${window.location.origin}/forms/${form.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied.");
    } catch {
      showToast(url);
    }
  };

  const handleAiApplied = async () => {
    try {
      const fresh = await refetch();
      if (fresh.data?.form) {
        setForm(fresh.data.form);
        setDirty(false);
        loadedRef.current = true;
      }
      showToast("AI changes applied.");
    } catch {
      showToast("Applied, but couldn't refresh. Reload the page.");
    }
  };

  const isQuiz = useMemo(
    () =>
      form?.type === "quiz" || form?.fields?.some((f) => f.scoring?.points > 0),
    [form]
  );
  const isElection = form?.type === "election";

  const pendingRequestsCount = useMemo(() => {
    if (!form?.participantRequests) return 0;
    return form.participantRequests.filter((r) => r.status === "pending").length;
  }, [form]);

  const statusMeta =
    {
      draft: {
        label: "Draft",
        dot: "bg-stone-400 dark:bg-stone-500",
        text: "text-stone-500 dark:text-stone-400",
      },
      open: {
        label: "Open",
        dot: "bg-emerald-500",
        text: "text-emerald-600 dark:text-emerald-400",
      },
      closed: {
        label: "Closed",
        dot: "bg-red-400",
        text: "text-red-500 dark:text-red-400",
      },
    }[form?.status] || {
      label: "Draft",
      dot: "bg-stone-400 dark:bg-stone-500",
      text: "text-stone-500 dark:text-stone-400",
    };

  if (isLoading || !form) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white dark:bg-stone-950">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-teal-500 dark:border-stone-700 dark:border-t-teal-400" />
          <p className="text-[12px] text-stone-400 dark:text-stone-500">
            Loading editor…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-white px-4 text-center dark:bg-stone-950">
        <p className="text-[14px] font-semibold text-stone-800 dark:text-stone-100">
          Couldn't load this form
        </p>
        <p className="text-[12.5px] text-stone-500 dark:text-stone-400">
          {error?.data?.message ||
            "It may have been deleted or you don't have access."}
        </p>
        <Link
          to="/forms"
          className="mt-2 rounded-md bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
        >
          Back to forms
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-white text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <header
        className="z-30 shrink-0 border-b border-stone-200/70 bg-white/85 backdrop-blur-xl dark:border-stone-800/70 dark:bg-stone-950/85"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex h-14 items-center gap-2 px-2.5 sm:gap-3 sm:px-4">
          <button
            type="button"
            onClick={() => navigate("/forms")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            aria-label="Back"
          >
            {I.back("h-4 w-4")}
          </button>

          <div className="min-w-0 flex-1">
            <input
              type="text"
              value={form.title}
              onChange={(e) => patchForm({ title: e.target.value })}
              placeholder="Untitled form"
              className="w-full truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[14.5px] font-semibold tracking-tight text-stone-900 outline-none transition-all placeholder:text-stone-300 focus:border-teal-200 focus:bg-teal-50/30 dark:text-stone-100 dark:placeholder:text-stone-600 dark:focus:border-teal-500/40 dark:focus:bg-teal-500/5"
            />
            <div className="mt-0.5 flex items-center gap-1.5 px-1">
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${statusMeta.text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
              {isElection ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                  · Election
                </span>
              ) : null}
              {dirty ? (
                <span className="text-[10px] font-medium text-teal-600 dark:text-teal-400">
                  · unsaved
                </span>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 lg:hidden"
            aria-label="Settings"
          >
            {I.settings("h-4 w-4")}
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className={`hidden shrink-0 items-center gap-1.5 rounded-md px-3.5 py-2 text-[12px] font-semibold transition-all sm:flex ${
              dirty
                ? "bg-teal-600 text-white shadow-sm shadow-teal-500/25 hover:bg-teal-700 active:scale-[0.97] dark:bg-teal-500 dark:hover:bg-teal-400"
                : "cursor-not-allowed bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500"
            }`}
          >
            {I.save("h-3.5 w-3.5")}
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>

          <EditorMenu
            form={form}
            onShare={() => setShareOpen(true)}
            onParticipants={() => setParticipantsOpen(true)}
            onAccessRequests={() => setAccessOpen(true)}
            onCopyLink={handleCopyLink}
            onPublish={handlePublish}
            onClose={() => setConfirmClose(true)}
            onPreview={() => window.open(`/forms/${form.slug}`, "_blank", "noopener")}
            onResponses={() => navigate(`/forms/${id}/responses`)}
            onDelete={handleDelete}
            publishing={publishing}
            deleting={deleting}
            pendingRequestsCount={pendingRequestsCount}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <div className="mx-auto w-full max-w-6xl px-2.5 pb-32 pt-3 sm:px-4 sm:pb-8 sm:pt-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              <CoverPhotoPanel
                formId={id}
                coverPhoto={form.coverPhoto || ""}
                onChanged={handleCoverChanged}
              />

              <div className="mb-4 rounded-lg border border-stone-200/80 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900 sm:p-4">
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => patchForm({ title: e.target.value })}
                  placeholder="Form title"
                  className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-[18px] font-semibold tracking-tight text-stone-900 outline-none transition-all placeholder:text-stone-300 focus:border-teal-200 focus:bg-teal-50/30 dark:text-stone-100 dark:placeholder:text-stone-600 dark:focus:border-teal-500/40 dark:focus:bg-teal-500/5 sm:text-[20px]"
                />
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => patchForm({ description: e.target.value })}
                  placeholder="Form description (optional)"
                  className="mt-0.5 w-full rounded-md border border-transparent bg-transparent px-1 py-1 text-[12.5px] text-stone-500 outline-none transition-all placeholder:text-stone-300 focus:border-teal-200 focus:bg-teal-50/30 dark:text-stone-400 dark:placeholder:text-stone-600 dark:focus:border-teal-500/40 dark:focus:bg-teal-500/5"
                />
              </div>

              {/* AI edit — hidden for elections (fields-only AI) */}
              {!isElection ? (
                <AiEditPanel
                  formId={id}
                  dirty={dirty}
                  onSaveFirst={handleSave}
                  onApplied={handleAiApplied}
                />
              ) : null}

              {/* Fields vs Positions */}
              {isElection ? (
                <PositionsEditor
                  formId={id}
                  positions={form.positions || []}
                  onChange={(positions) => patchForm({ positions })}
                />
              ) : (
                <>
                  <div className="space-y-3">
                    {(form.fields || []).map((field, idx) => (
                      <FieldCard
                        key={field.id}
                        field={field}
                        index={idx}
                        total={form.fields.length}
                        isQuiz={isQuiz}
                        onChange={(next) => updateField(idx, next)}
                        onDelete={() => deleteField(idx)}
                        onDuplicate={() => duplicateField(idx)}
                        onMoveUp={() => moveField(idx, -1)}
                        onMoveDown={() => moveField(idx, 1)}
                      />
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-stone-300 bg-white/50 py-3.5 text-[12.5px] font-semibold text-stone-500 transition-colors hover:border-teal-300 hover:bg-teal-50/50 hover:text-teal-600 dark:border-stone-700 dark:bg-stone-900/40 dark:text-stone-400 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10 dark:hover:text-teal-400"
                  >
                    {I.plus("h-4 w-4")}
                    Add field
                  </button>

                  {form.fields?.length === 0 ? (
                    <p className="mt-3 text-center text-[11.5px] text-stone-400 dark:text-stone-500">
                      A form needs at least one field before it can be published.
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <aside className="hidden lg:block">
              <div className="sticky top-24 rounded-lg border border-stone-200/80 bg-white p-4 dark:border-stone-800 dark:bg-stone-900">
                <div className="mb-4 flex items-center gap-2">
                  <span className="text-stone-400 dark:text-stone-500">
                    {I.settings("h-4 w-4")}
                  </span>
                  <h2 className="text-[13px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                    Settings
                  </h2>
                </div>
                <SettingsPanel form={form} onChange={patchForm} />
              </div>
            </aside>
          </div>
        </div>
      </div>

      {dirty ? (
        <div
          className="fixed inset-x-0 z-40 flex justify-center px-4 lg:hidden"
          style={{ bottom: "max(env(safe-area-inset-bottom), 1rem)" }}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-teal-600 px-6 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-teal-500/30 transition-all hover:bg-teal-700 active:scale-95 disabled:opacity-60 dark:bg-teal-500 dark:hover:bg-teal-400"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : null}

      <FieldTypePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addField}
      />

      {settingsOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-900/50 backdrop-blur-[3px] dark:bg-black/60 lg:hidden">
          <div
            className="absolute inset-0"
            onClick={() => setSettingsOpen(false)}
            aria-hidden
          />
          <div className="relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl dark:bg-stone-900">
            <div
              className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 dark:border-stone-800"
              style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
            >
              <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
                Settings
              </h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                aria-label="Close"
              >
                {I.close("h-4 w-4")}
              </button>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
              <SettingsPanel form={form} onChange={patchForm} />
            </div>
            <div
              className="flex items-center justify-end border-t border-stone-100 px-4 py-3 dark:border-stone-800"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
            >
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-md bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ShareModal open={shareOpen} onClose={() => setShareOpen(false)} formId={id} />
      <ParticipantsModal
        open={participantsOpen}
        onClose={() => setParticipantsOpen(false)}
        formId={id}
      />
      <AccessRequestsModal
        open={accessOpen}
        onClose={() => setAccessOpen(false)}
        formId={id}
        requestFields={form.settings?.requestFields || []}
      />

      {confirmClose ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/50 px-4 backdrop-blur-[3px] dark:bg-black/60">
          <div
            className="absolute inset-0"
            onClick={() => setConfirmClose(false)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl dark:bg-stone-900">
            <h3 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Close this form?
            </h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              People won't be able to submit any more responses. You can reopen it
              later.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClose(false)}
                className="rounded-md px-3.5 py-2 text-[12.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-md bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
              >
                Close form
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center px-4"
          style={{ bottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
        >
          <div className="pointer-events-auto max-w-sm rounded-md border border-stone-200/80 bg-stone-900 px-4 py-2.5 text-[12px] font-medium text-white shadow-xl shadow-stone-900/20 dark:border-stone-700 dark:bg-stone-100 dark:text-stone-900">
            {toast}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default FormEditor;