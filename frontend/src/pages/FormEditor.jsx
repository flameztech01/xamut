// pages/FormEditor.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  useGetFormQuery,
  useUpdateFormMutation,
  usePublishFormMutation,
  useCloseFormMutation,
  useDeleteFormMutation,
  useAddCollaboratorMutation,
  useListCollaboratorsQuery,
  useRemoveCollaboratorMutation,
  useUpdateCollaboratorRoleMutation,
  useAddParticipantsMutation,
  useListParticipantsQuery,
  useRemoveParticipantMutation,
  useResendParticipantCredentialsMutation,
} from "../features/formApiSlice";

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
    label: "Other",
    types: [
      { id: "file", label: "File upload" },
      { id: "section", label: "Section header" },
    ],
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

  return base;
};

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

// ─────────────────────────────────────────────────────────────
// Icons (inline SVG, self-contained)
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
  eye: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
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
};

// ─────────────────────────────────────────────────────────────
// Toggle switch
// ─────────────────────────────────────────────────────────────
const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex cursor-pointer items-start gap-3 select-none">
    <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="absolute inset-0 rounded-full bg-stone-200 transition-colors peer-checked:bg-orange-500" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-[12.5px] font-medium text-stone-800">{label}</span>
      {hint ? (
        <span className="mt-0.5 block text-[11px] leading-snug text-stone-400">{hint}</span>
      ) : null}
    </span>
  </label>
);

// ─────────────────────────────────────────────────────────────
// Field type picker modal
// ─────────────────────────────────────────────────────────────
const FieldTypePicker = ({ open, onClose, onPick }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-900/40 backdrop-blur-[3px] sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 max-h-[90dvh] w-full max-w-lg overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div
          className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900">
              Add a field
            </h2>
            <p className="mt-0.5 text-[11.5px] text-stone-400">
              Pick the type of question you want to ask.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
            aria-label="Close"
          >
            {I.close("h-4 w-4")}
          </button>
        </div>

        <div className="scrollbar-thin max-h-[65dvh] overflow-y-auto px-4 py-4 sm:px-5">
          {FIELD_GROUPS.map((group) => (
            <div key={group.label} className="mb-4 last:mb-0">
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-stone-400">
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
                    className="flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-left transition-all hover:border-orange-300 hover:bg-orange-50/70 active:scale-[0.98]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-stone-700">
                      {t.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div
          className="flex items-center justify-end border-t border-stone-100 px-4 pt-3 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.875rem)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-[12.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800"
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
          <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-stone-300" />
          <input
            type="text"
            value={opt.label}
            onChange={(e) => updateOption(idx, "label", e.target.value)}
            placeholder={`Option ${idx + 1}`}
            className="min-w-0 flex-1 rounded-lg border border-transparent bg-stone-50 px-2.5 py-1.5 text-[12.5px] text-stone-800 outline-none transition-all focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-500/10"
          />
          {field.options.length > 1 ? (
            <button
              type="button"
              onClick={() => removeOption(idx)}
              className="shrink-0 rounded-lg p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500"
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
        className="mt-1.5 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold text-orange-600 transition-colors hover:bg-orange-50"
      >
        {I.plus("h-3 w-3")}
        Add option
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Scoring editor (for quizzes)
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
    <div className="rounded-xl border border-purple-200/70 bg-purple-50/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-purple-700">
          Quiz scoring
        </p>
        <div className="flex items-center gap-1.5">
          <label className="text-[11px] text-purple-700">Points</label>
          <input
            type="number"
            min="0"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            className="w-14 rounded-lg border border-purple-200 bg-white px-2 py-1 text-center text-[12px] font-semibold text-purple-800 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/10"
          />
        </div>
      </div>

      {isChoice ? (
        <>
          <p className="mb-1.5 text-[11px] text-purple-700/80">
            Mark the correct {field.type === "checkbox" || field.type === "multi_select" ? "answers" : "answer"}:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {field.options.map((opt) => {
              const active = correct.includes(opt.value);
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => toggleCorrect(opt.value)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? "border-purple-400 bg-purple-500 text-white"
                      : "border-purple-200 bg-white text-purple-700 hover:bg-purple-50"
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
          <p className="mb-1.5 text-[11px] text-purple-700/80">
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
            className="w-full rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-[12.5px] text-stone-800 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/10"
          />
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Field card (each question)
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

  const patch = (partial) => onChange({ ...field, ...partial });

  return (
    <div
      className={`group relative rounded-2xl border bg-white p-3.5 shadow-sm shadow-stone-900/[0.02] transition-all duration-200 hover:border-orange-200 sm:p-4 ${
        isSection ? "border-dashed border-stone-300 bg-stone-50/50" : "border-stone-200/80"
      }`}
    >
      {/* Top row: drag handle + type + actions */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="hidden text-stone-300 sm:block" title="Reorder with the arrows">
            {I.drag("h-4 w-4")}
          </span>
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-stone-500">
            {FIELD_LABEL[field.type] || field.type}
          </span>
          <span className="text-[10.5px] text-stone-300">#{index + 1}</span>
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent"
            title="Move up"
          >
            {I.chevUp("h-3.5 w-3.5")}
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30 disabled:hover:bg-transparent"
            title="Move down"
          >
            {I.chevDown("h-3.5 w-3.5")}
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
              title="More"
            >
              {I.dots("h-3.5 w-3.5")}
            </button>
            {menuOpen ? (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
                <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-xl border border-stone-200/80 bg-white py-1 shadow-xl shadow-stone-900/10">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDuplicate();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-stone-700 hover:bg-stone-50"
                  >
                    {I.copy("h-3.5 w-3.5 text-stone-400")}
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] text-red-600 hover:bg-red-50"
                  >
                    {I.trash("h-3.5 w-3.5 text-red-500")}
                    Delete
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Label */}
      <input
        type="text"
        value={field.label}
        onChange={(e) => patch({ label: e.target.value })}
        placeholder={isSection ? "Section title" : "Question"}
        className={`w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-stone-900 outline-none transition-all placeholder:text-stone-300 focus:border-orange-200 focus:bg-orange-50/30 focus:ring-2 focus:ring-orange-500/5 ${
          isSection
            ? "text-[15px] font-semibold"
            : "text-[14px] font-medium"
        }`}
      />

      {/* Description */}
      <input
        type="text"
        value={field.description}
        onChange={(e) => patch({ description: e.target.value })}
        placeholder="Add a description (optional)"
        className="mt-0.5 w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-[12px] text-stone-500 outline-none transition-all placeholder:text-stone-300 focus:border-orange-200 focus:bg-orange-50/30"
      />

      {/* Section header gets no more UI */}
      {isSection ? null : (
        <div className="mt-3 space-y-3">
          {/* Type-specific preview / input */}
          {CHOICE_TYPES.has(field.type) ? (
            <OptionsEditor field={field} onChange={patch} />
          ) : null}

          {["short_text", "long_text", "email", "phone", "url", "number"].includes(
            field.type
          ) ? (
            <input
              type="text"
              value={field.placeholder || ""}
              onChange={(e) => patch({ placeholder: e.target.value })}
              placeholder="Placeholder text (optional)"
              className="w-full rounded-lg border border-stone-200 bg-stone-50/50 px-3 py-2 text-[12.5px] text-stone-700 outline-none transition-all placeholder:text-stone-400 focus:border-orange-300 focus:bg-white focus:ring-2 focus:ring-orange-500/10"
            />
          ) : null}

          {["rating", "scale"].includes(field.type) ? (
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-stone-500">
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
                className="w-16 rounded-lg border border-stone-200 bg-white px-2 py-1 text-center text-[12px] outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-500/10"
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
                className="w-16 rounded-lg border border-stone-200 bg-white px-2 py-1 text-center text-[12px] outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-500/10"
              />
            </div>
          ) : null}

          {["short_text", "long_text"].includes(field.type) ? (
            <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-stone-500">
              <span>Min</span>
              <input
                type="number"
                value={field.validation?.minLength ?? ""}
                onChange={(e) =>
                  patch({
                    validation: {
                      ...field.validation,
                      minLength: e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
                placeholder="0"
                className="w-16 rounded-lg border border-stone-200 bg-white px-2 py-1 text-center text-[12px] outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-500/10"
              />
              <span>Max</span>
              <input
                type="number"
                value={field.validation?.maxLength ?? ""}
                onChange={(e) =>
                  patch({
                    validation: {
                      ...field.validation,
                      maxLength: e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
                placeholder="500"
                className="w-20 rounded-lg border border-stone-200 bg-white px-2 py-1 text-center text-[12px] outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-500/10"
              />
              <span>chars</span>
            </div>
          ) : null}

          {isQuiz && SCORABLE_TYPES.has(field.type) ? (
            <ScoringEditor field={field} onChange={patch} />
          ) : null}

          {/* Required toggle */}
          <Toggle
            checked={!!field.required}
            onChange={(v) => patch({ required: v })}
            label="Required"
            hint="Respondent must answer before submitting"
          />
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Settings panel
// ─────────────────────────────────────────────────────────────
const SettingsPanel = ({ form, onChange }) => {
  const settings = form.settings || {};
  const isQuiz = form.type === "quiz" || form.fields.some((f) => f.scoring?.points > 0);

  const patch = (partial) => onChange({ settings: { ...settings, ...partial } });

  return (
    <div className="space-y-5">
      {/* Form type */}
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          Form type
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { id: "form", label: "Form" },
            { id: "quiz", label: "Quiz" },
            { id: "survey", label: "Survey" },
            { id: "feedback", label: "Feedback" },
            { id: "attendance", label: "Attendance" },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChange({ type: t.id })}
              className={`rounded-xl border px-3 py-2 text-[12px] font-semibold transition-colors ${
                form.type === t.id
                  ? "border-orange-300 bg-orange-50 text-orange-700"
                  : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </section>

      {/* Visibility */}
      <section>
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
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
              className={`rounded-xl border px-3 py-2 text-[12px] font-semibold transition-colors ${
                form.visibility === v.id
                  ? "border-orange-300 bg-orange-50 text-orange-700"
                  : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        {form.visibility === "private" ? (
          <p className="mt-1.5 text-[11px] leading-snug text-stone-400">
            Add participants from the Share menu. Each one gets a unique password by email.
          </p>
        ) : null}
      </section>

      {/* Behaviour */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
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
        <Toggle
          checked={!!settings.shuffleQuestions}
          onChange={(v) => patch({ shuffleQuestions: v })}
          label="Shuffle questions"
          hint="Randomise the order for each respondent"
        />
        <Toggle
          checked={settings.showProgressBar !== false}
          onChange={(v) => patch({ showProgressBar: v })}
          label="Show progress bar"
        />
      </section>

      {/* Quiz-specific */}
      {isQuiz ? (
        <section className="space-y-3 rounded-xl border border-purple-200/70 bg-purple-50/40 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-purple-700">
            Quiz
          </p>
          <Toggle
            checked={!!settings.showScoreImmediately}
            onChange={(v) => patch({ showScoreImmediately: v })}
            label="Show score immediately"
            hint="Respondents see their score right after submitting"
          />
          <div>
            <label className="mb-1 block text-[11.5px] font-medium text-purple-700">
              Pass percentage
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={settings.passPercentage ?? 0}
              onChange={(e) =>
                patch({
                  passPercentage: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                })
              }
              className="w-full rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-[12.5px] text-stone-800 outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-500/10"
            />
            <p className="mt-1 text-[10.5px] text-purple-700/70">
              Set 0 to disable pass/fail marking.
            </p>
          </div>
        </section>
      ) : null}

      {/* Confirmation */}
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          After submitting
        </p>
        <textarea
          rows={2}
          value={settings.confirmationMessage || ""}
          onChange={(e) => patch({ confirmationMessage: e.target.value })}
          placeholder="Thanks, your response has been recorded."
          className="w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12.5px] leading-relaxed text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-500/10"
        />
        <input
          type="url"
          value={settings.successRedirectUrl || ""}
          onChange={(e) => patch({ successRedirectUrl: e.target.value })}
          placeholder="Redirect URL (optional)"
          className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-[12.5px] text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-500/10"
        />
      </section>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Share modal (collaborators)
// ─────────────────────────────────────────────────────────────
const ShareModal = ({ open, onClose, formId }) => {
  const { data, isLoading } = useListCollaboratorsQuery(formId, { skip: !open });
  const [addCollaborator, { isLoading: adding }] = useAddCollaboratorMutation();
  const [removeCollaborator] = useRemoveCollaboratorMutation();
  const [updateRole] = useUpdateCollaboratorRoleMutation();

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("editor");
  const [error, setError] = useState("");

  if (!open) return null;

  const handleAdd = async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim()) return;
    try {
      await addCollaborator({ id: formId, email: email.trim(), role }).unwrap();
      setEmail("");
    } catch (err) {
      setError(err?.data?.message || "Couldn't add collaborator.");
    }
  };

  const owner = data?.owner;
  const collabs = data?.collaborators || [];

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-stone-900/40 backdrop-blur-[3px] sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div
          className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900">
              Share form
            </h2>
            <p className="mt-0.5 text-[11.5px] text-stone-400">
              Invite Xamut users to help edit or view responses.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
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
                }}
                placeholder="name@example.com"
                className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-white px-3 py-2 text-[13px] text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-500/10"
              />
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="shrink-0 rounded-xl border border-stone-200 bg-white px-2.5 py-2 text-[12px] font-medium text-stone-700 outline-none focus:border-orange-300 focus:ring-2 focus:ring-orange-500/10"
              >
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
              </select>
              <button
                type="submit"
                disabled={adding || !email.trim()}
                className="shrink-0 rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm shadow-orange-500/25 transition-all hover:shadow-md active:scale-95 disabled:opacity-50"
              >
                {adding ? "…" : "Add"}
              </button>
            </div>
            {error ? (
              <p className="text-[11.5px] text-red-600">{error}</p>
            ) : null}
          </form>

          {isLoading ? (
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-xl bg-stone-100" />
              ))}
            </div>
          ) : (
            <div className="space-y-1.5">
              {owner ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-stone-200 bg-stone-50/70 px-3 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-stone-900 text-[11px] font-semibold text-white">
                    {(owner.name || owner.email || "?").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-stone-800">
                      {owner.name || owner.email}
                    </p>
                    <p className="truncate text-[10.5px] text-stone-400">
                      {owner.email}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-stone-200/80 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-stone-600">
                    Owner
                  </span>
                </div>
              ) : null}

              {collabs.map((c) => (
                <div
                  key={c.user}
                  className="flex items-center gap-2.5 rounded-xl border border-stone-200 bg-white px-3 py-2.5"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[11px] font-semibold text-orange-700">
                    {(c.name || c.email || "?").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-stone-800">
                      {c.name || c.email}
                    </p>
                    <p className="truncate text-[10.5px] text-stone-400">{c.email}</p>
                  </div>
                  <select
                    value={c.role}
                    onChange={(e) =>
                      updateRole({ id: formId, userId: c.user, role: e.target.value })
                    }
                    className="shrink-0 rounded-lg border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-700 outline-none focus:border-orange-300"
                  >
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => removeCollaborator({ id: formId, userId: c.user })}
                    className="shrink-0 rounded-lg p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500"
                    aria-label="Remove"
                  >
                    {I.trash("h-3.5 w-3.5")}
                  </button>
                </div>
              ))}

              {!owner && collabs.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-stone-400">
                  No collaborators yet.
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end border-t border-stone-100 px-4 pt-3 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.875rem)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-stone-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Participants modal (private forms)
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
    const text = `Email: ${p.email}\nPassword: ${p.password}\nLink: ${window.location.origin}/forms/${
      window.location.pathname.split("/")[2]
    }`;
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
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-stone-900/40 backdrop-blur-[3px] sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        <div
          className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900">
              Invite participants
            </h2>
            <p className="mt-0.5 text-[11.5px] text-stone-400">
              They don't need a Xamut account. Each one gets a unique password by email.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
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
              className="w-full resize-none rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-[13px] leading-relaxed text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-500/10"
            />
            {error ? <p className="text-[11.5px] text-red-600">{error}</p> : null}
            <button
              type="submit"
              disabled={adding || !bulk.trim()}
              className="w-full rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 px-3.5 py-2.5 text-[12.5px] font-semibold text-white shadow-sm shadow-orange-500/25 transition-all hover:shadow-md active:scale-[0.98] disabled:opacity-50"
            >
              {adding ? "Sending invites…" : "Send invites"}
            </button>
          </form>

          {created.length ? (
            <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
                Just added · passwords below
              </p>
              <p className="mb-2 text-[10.5px] leading-snug text-emerald-700/80">
                Invite emails were sent. Save the passwords here too in case email delivery fails.
              </p>
              <div className="space-y-1.5">
                {created.map((p) => (
                  <div
                    key={p.email}
                    className="flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-emerald-900">
                      {p.email}
                    </span>
                    <code className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] font-mono text-emerald-800">
                      {p.password}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyCreds(p)}
                      className="shrink-0 rounded p-1 text-emerald-600 hover:bg-emerald-100"
                      title="Copy credentials"
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
                <div key={i} className="h-12 animate-pulse rounded-xl bg-stone-100" />
              ))}
            </div>
          ) : participants.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-stone-400">
              No participants yet.
            </p>
          ) : (
            <div className="space-y-1.5">
              {participants.map((p) => (
                <div
                  key={p._id}
                  className="flex items-center gap-2.5 rounded-xl border border-stone-200 bg-white px-3 py-2.5"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                      p.completed
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-stone-100 text-stone-600"
                    }`}
                  >
                    {(p.name || p.email || "?").charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-stone-800">
                      {p.name || p.email}
                    </p>
                    <p className="truncate text-[10.5px] text-stone-400">
                      {p.completed ? "Submitted" : "Not yet submitted"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => resend({ id: formId, participantId: p._id })}
                    className="shrink-0 rounded-lg px-2 py-1 text-[10.5px] font-semibold text-orange-600 transition-colors hover:bg-orange-50"
                    title="Send a new password"
                  >
                    Resend
                  </button>
                  <button
                    type="button"
                    onClick={() => removeParticipant({ id: formId, participantId: p._id })}
                    className="shrink-0 rounded-lg p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500"
                    aria-label="Remove"
                  >
                    {I.trash("h-3.5 w-3.5")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          className="flex items-center justify-end border-t border-stone-100 px-4 pt-3 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.875rem)" }}
        >
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white transition-colors hover:bg-stone-800"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
const FormEditor = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useGetFormQuery(id, { skip: !id });

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
  const [confirmClose, setConfirmClose] = useState(false);

  const loadedRef = useRef(false);

  // Seed local state once data arrives
  useEffect(() => {
    if (data?.form && !loadedRef.current) {
      setForm(data.form);
      loadedRef.current = true;
    }
  }, [data]);

  // Reset when the id changes
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

  // ─── Field operations ────────────────────────────────────────
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
    const fields = form.fields.filter((_, i) => i !== index);
    patchForm({ fields });
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

  // ─── Save ───────────────────────────────────────────────────
  const handleSave = async () => {
    if (!form) return;
    try {
      const payload = {
        title: form.title,
        description: form.description,
        type: form.type,
        visibility: form.visibility,
        fields: form.fields,
        settings: form.settings,
        isMultipage: form.isMultipage,
      };
      const res = await updateForm({ id, ...payload }).unwrap();
      setForm(res.form);
      setDirty(false);
      showToast("Saved.");
    } catch (err) {
      showToast(err?.data?.message || "Couldn't save.");
    }
  };

  const handlePublish = async () => {
    if (dirty) {
      try {
        await handleSave();
      } catch {
        return;
      }
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
    if (!window.confirm("Delete this form and all its responses? This can't be undone.")) {
      return;
    }
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

  const isQuiz = useMemo(
    () => form?.type === "quiz" || form?.fields?.some((f) => f.scoring?.points > 0),
    [form]
  );

  const statusMeta = {
    draft: { label: "Draft", dot: "bg-stone-400", text: "text-stone-500" },
    open: { label: "Open", dot: "bg-emerald-500", text: "text-emerald-600" },
    closed: { label: "Closed", dot: "bg-red-400", text: "text-red-500" },
  }[form?.status] || { label: "Draft", dot: "bg-stone-400", text: "text-stone-500" };

  // ─── Loading / error ───────────────────────────────────────
  if (isLoading || !form) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f7f5f0]">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-orange-500" />
          <p className="text-[12px] text-stone-400">Loading editor…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-[#f7f5f0] px-4 text-center">
        <p className="text-[14px] font-semibold text-stone-800">
          Couldn't load this form
        </p>
        <p className="text-[12.5px] text-stone-500">
          {error?.data?.message || "It may have been deleted or you don't have access."}
        </p>
        <Link
          to="/forms"
          className="mt-2 rounded-full bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-stone-800"
        >
          Back to forms
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh w-full flex-col bg-[#f7f5f0] text-stone-900 antialiased">
      {/* ─── Header ──────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b border-stone-200/70 bg-white/85 backdrop-blur-xl"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-2 px-2.5 py-2.5 sm:gap-3 sm:px-6 sm:py-3.5">
          <button
            type="button"
            onClick={() => navigate("/forms")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
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
              className="w-full truncate rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold tracking-tight text-stone-900 outline-none transition-all placeholder:text-stone-300 focus:border-orange-200 focus:bg-orange-50/30 sm:text-base"
            />
            <div className="mt-0.5 flex items-center gap-1.5 px-1">
              <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${statusMeta.text}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
              {dirty ? (
                <span className="text-[10px] font-medium text-orange-600">
                  · unsaved
                </span>
              ) : null}
            </div>
          </div>

          {/* Mobile: settings icon */}
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 lg:hidden"
            aria-label="Settings"
          >
            {I.settings("h-4 w-4")}
          </button>

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            className={`hidden shrink-0 rounded-full px-4 py-2 text-[12px] font-semibold shadow-sm transition-all sm:block ${
              dirty
                ? "bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-orange-500/25 hover:shadow-md active:scale-95"
                : "cursor-not-allowed bg-stone-100 text-stone-400"
            }`}
          >
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>

          {/* More menu */}
          <EditorMenu
            form={form}
            onShare={() => setShareOpen(true)}
            onParticipants={() => setParticipantsOpen(true)}
            onCopyLink={handleCopyLink}
            onPublish={handlePublish}
            onClose={() => setConfirmClose(true)}
            onPreview={() => window.open(`/forms/${form.slug}`, "_blank", "noopener")}
            onResponses={() => navigate(`/forms/${id}/responses`)}
            onDelete={handleDelete}
            publishing={publishing}
            deleting={deleting}
          />
        </div>
      </header>

      {/* ─── Main ────────────────────────────────────────── */}
      <div className="mx-auto w-full max-w-6xl flex-1 px-2.5 pb-32 pt-3 sm:px-6 sm:pb-8 sm:pt-5">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          {/* Fields column */}
          <div className="min-w-0">
            {/* Form title & description block */}
            <div className="mb-4 rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-sm shadow-stone-900/[0.02] sm:p-4">
              <input
                type="text"
                value={form.title}
                onChange={(e) => patchForm({ title: e.target.value })}
                placeholder="Form title"
                className="w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-[18px] font-semibold tracking-tight text-stone-900 outline-none transition-all placeholder:text-stone-300 focus:border-orange-200 focus:bg-orange-50/30 sm:text-[20px]"
              />
              <input
                type="text"
                value={form.description}
                onChange={(e) => patchForm({ description: e.target.value })}
                placeholder="Form description (optional)"
                className="mt-0.5 w-full rounded-lg border border-transparent bg-transparent px-1 py-1 text-[12.5px] text-stone-500 outline-none transition-all placeholder:text-stone-300 focus:border-orange-200 focus:bg-orange-50/30"
              />
            </div>

            {/* Fields */}
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

            {/* Add field */}
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-stone-300 bg-white/50 py-3.5 text-[12.5px] font-semibold text-stone-500 transition-colors hover:border-orange-300 hover:bg-orange-50/50 hover:text-orange-600"
            >
              {I.plus("h-4 w-4")}
              Add field
            </button>

            {form.fields?.length === 0 ? (
              <p className="mt-3 text-center text-[11.5px] text-stone-400">
                A form needs at least one field before it can be published.
              </p>
            ) : null}
          </div>

          {/* Desktop settings sidebar */}
          <aside className="hidden lg:block">
            <div className="sticky top-24 rounded-2xl border border-stone-200/80 bg-white p-4 shadow-sm shadow-stone-900/[0.02]">
              <div className="mb-4 flex items-center gap-2">
                <span className="text-stone-400">{I.settings("h-4 w-4")}</span>
                <h2 className="text-[13px] font-semibold tracking-tight text-stone-900">
                  Settings
                </h2>
              </div>
              <SettingsPanel form={form} onChange={patchForm} />
            </div>
          </aside>
        </div>
      </div>

      {/* ─── Mobile save button (sticky) ─────────────────── */}
      {dirty ? (
        <div
          className="fixed inset-x-0 z-40 flex justify-center px-4 lg:hidden"
          style={{ bottom: "max(env(safe-area-inset-bottom), 1rem)" }}
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-full bg-gradient-to-br from-orange-500 to-orange-600 px-6 py-2.5 text-[13px] font-semibold text-white shadow-lg shadow-orange-500/30 transition-all hover:shadow-xl active:scale-95 disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      ) : null}

      {/* ─── Modals ──────────────────────────────────────── */}
      <FieldTypePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={addField}
      />

      {/* Mobile settings sheet */}
      {settingsOpen ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-900/40 backdrop-blur-[3px] lg:hidden">
          <div className="absolute inset-0" onClick={() => setSettingsOpen(false)} aria-hidden />
          <div className="relative z-10 flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl">
            <div
              className="flex items-center justify-between border-b border-stone-100 px-4 pb-3"
              style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
            >
              <h2 className="text-[15px] font-semibold tracking-tight text-stone-900">
                Settings
              </h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
                aria-label="Close"
              >
                {I.close("h-4 w-4")}
              </button>
            </div>
            <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4">
              <SettingsPanel form={form} onChange={patchForm} />
            </div>
            <div
              className="flex items-center justify-end border-t border-stone-100 px-4 pt-3"
              style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.875rem)" }}
            >
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="rounded-full bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-stone-800"
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

      {/* Confirm close modal */}
      {confirmClose ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/40 px-4 backdrop-blur-[3px]">
          <div className="absolute inset-0" onClick={() => setConfirmClose(false)} aria-hidden />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">
              Close this form?
            </h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-500">
              People won't be able to submit any more responses. You can reopen it later.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmClose(false)}
                className="rounded-full px-4 py-2 text-[12.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-full bg-stone-900 px-4 py-2.5 text-[12.5px] font-semibold text-white hover:bg-stone-800"
              >
                Close form
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Toast */}
      {toast ? (
        <div
          className="pointer-events-none fixed inset-x-0 z-[90] flex justify-center px-4"
          style={{ bottom: "max(env(safe-area-inset-bottom), 1.25rem)" }}
        >
          <div className="pointer-events-auto max-w-sm rounded-full border border-stone-200/80 bg-stone-900 px-4 py-2.5 text-[12px] font-medium text-white shadow-xl shadow-stone-900/20">
            {toast}
          </div>
        </div>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Editor header menu (more actions)
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
  publishing,
  deleting,
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
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
        aria-label="More actions"
      >
        {I.dots("h-4 w-4")}
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-56 overflow-hidden rounded-xl border border-stone-200/80 bg-white py-1 shadow-xl shadow-stone-900/10">
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
                      ? "text-red-600 hover:bg-red-50"
                      : "text-stone-700 hover:bg-stone-50"
                  }`}
                >
                  <span className={it.danger ? "text-red-500" : "text-stone-400"}>
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

export default FormEditor;