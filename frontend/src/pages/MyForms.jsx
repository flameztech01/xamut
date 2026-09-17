// pages/MyForms.jsx
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import {
  useListFormsQuery,
  useCreateFormMutation,
  useDeleteFormMutation,
  useDuplicateFormMutation,
  usePublishFormMutation,
  useCloseFormMutation,
} from "../features/formApiSlice";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const FORM_TYPE_META = {
  form: { label: "Form", bg: "bg-orange-50", text: "text-orange-600" },
  quiz: { label: "Quiz", bg: "bg-purple-50", text: "text-purple-600" },
  survey: { label: "Survey", bg: "bg-blue-50", text: "text-blue-600" },
  feedback: { label: "Feedback", bg: "bg-emerald-50", text: "text-emerald-600" },
  attendance: { label: "Attendance", bg: "bg-amber-50", text: "text-amber-700" },
};

const STATUS_META = {
  draft: { label: "Draft", dot: "bg-stone-400", text: "text-stone-500" },
  open: { label: "Open", dot: "bg-emerald-500", text: "text-emerald-600" },
  closed: { label: "Closed", dot: "bg-red-400", text: "text-red-500" },
};

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

// ─────────────────────────────────────────────────────────────
// Brand mark
// ─────────────────────────────────────────────────────────────
const XamutMark = ({ className = "h-9 w-9" }) => (
  <div
    className={`${className} flex shrink-0 items-center justify-center rounded-[11px] bg-gradient-to-br from-orange-400 via-orange-500 to-orange-600 shadow-sm shadow-orange-500/30`}
  >
    <svg viewBox="0 0 24 24" className="h-1/2 w-1/2 text-white">
      <path
        fill="currentColor"
        d="M6 5h3.2L12 9.3 14.8 5H18l-4.5 6.4L18.5 19H15.3L12 14.2 8.7 19H5.5L10 12.2 6 5Z"
      />
    </svg>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Small icons (inline SVG, keeps the file self-contained)
// ─────────────────────────────────────────────────────────────
const IconPlus = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
    <path d="M12 5v14M5 12h14" strokeLinecap="round" />
  </svg>
);

const IconDots = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <circle cx="5" cy="12" r="1.7" />
    <circle cx="12" cy="12" r="1.7" />
    <circle cx="19" cy="12" r="1.7" />
  </svg>
);

const IconCopy = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const IconTrash = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <path d="M3 6h18M8 6v14a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6M10 11v6M14 11v6" strokeLinecap="round" />
  </svg>
);

const IconExternal = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M7 17L17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconChart = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <path d="M4 20V10M12 20V4M20 20v-7" strokeLinecap="round" />
  </svg>
);

const IconEdit = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconPlay = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <path d="M5 3l14 9-14 9V3z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconStop = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);

const IconLink = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={className}>
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07L12 5" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07L12 19" />
  </svg>
);

// ─────────────────────────────────────────────────────────────
// Card menu (small dropdown for actions)
// ─────────────────────────────────────────────────────────────
const CardMenu = ({ form, onAction }) => {
  const [open, setOpen] = useState(false);

  const items = [
    { id: "edit", label: "Edit form", icon: <IconEdit className="h-3.5 w-3.5" /> },
    { id: "responses", label: "View responses", icon: <IconChart className="h-3.5 w-3.5" /> },
    { id: "duplicate", label: "Duplicate", icon: <IconCopy className="h-3.5 w-3.5" /> },
    {
      id: form.status === "open" ? "close" : "publish",
      label: form.status === "open" ? "Close form" : "Publish form",
      icon:
        form.status === "open" ? (
          <IconStop className="h-3.5 w-3.5" />
        ) : (
          <IconPlay className="h-3.5 w-3.5" />
        ),
    },
    { id: "copy-link", label: "Copy link", icon: <IconLink className="h-3.5 w-3.5" /> },
    { id: "delete", label: "Delete", icon: <IconTrash className="h-3.5 w-3.5" />, danger: true },
  ];

  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700"
        aria-label="More actions"
      >
        <IconDots className="h-4 w-4" />
      </button>

      {open ? (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div className="absolute right-0 top-full z-50 mt-1.5 w-44 overflow-hidden rounded-xl border border-stone-200/80 bg-white py-1 shadow-xl shadow-stone-900/10">
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAction(it.id, form);
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12.5px] leading-tight transition-colors ${
                  it.danger
                    ? "text-red-600 hover:bg-red-50"
                    : "text-stone-700 hover:bg-stone-50"
                }`}
              >
                <span className={it.danger ? "text-red-500" : "text-stone-400"}>
                  {it.icon}
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
// Form card
// ─────────────────────────────────────────────────────────────
const FormCard = ({ form, role, onAction }) => {
  const navigate = useNavigate();
  const typeMeta = FORM_TYPE_META[form.type] || FORM_TYPE_META.form;
  const statusMeta = STATUS_META[form.status] || STATUS_META.draft;

  const openEditor = () => navigate(`/forms/${form._id}/edit`);
  const openResponses = () => navigate(`/forms/${form._id}/responses`);
  const openPublic = () => {
    if (form.status !== "open") return;
    window.open(`/forms/${form.slug}`, "_blank", "noopener");
  };

  return (
    <div
      onClick={openEditor}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") openEditor();
      }}
      className="group flex cursor-pointer flex-col rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-sm shadow-stone-900/[0.02] transition-all duration-200 hover:-translate-y-0.5 hover:border-orange-200 hover:shadow-[0_10px_28px_-16px_rgba(234,88,12,0.35)] sm:p-4"
    >
      {/* Top row: type badge + status */}
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${typeMeta.bg} ${typeMeta.text}`}
          >
            {typeMeta.label}
          </span>
          {role === "collaborator" ? (
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-stone-500">
              Shared
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-flex items-center gap-1 text-[10.5px] font-semibold ${statusMeta.text}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
            {statusMeta.label}
          </span>
          <CardMenu form={form} onAction={onAction} />
        </div>
      </div>

      {/* Title + description */}
      <h3 className="line-clamp-2 text-[14px] font-semibold tracking-tight text-stone-900">
        {form.title || "Untitled form"}
      </h3>
      {form.description ? (
        <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-stone-500">
          {form.description}
        </p>
      ) : null}

      {/* Meta row */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-stone-500">
        <span className="inline-flex items-center gap-1">
          <IconChart className="h-3 w-3 text-stone-400" />
          <span className="font-semibold text-stone-700">
            {form.responseCount || 0}
          </span>
          {form.responseCount === 1 ? "response" : "responses"}
        </span>
        <span className="text-stone-300">·</span>
        <span>
          {form.fieldsCount || 0}{" "}
          {form.fieldsCount === 1 ? "field" : "fields"}
        </span>
        {form.visibility === "private" ? (
          <>
            <span className="text-stone-300">·</span>
            <span className="text-stone-600">
              {form.participantsCount || 0}{" "}
              {form.participantsCount === 1 ? "participant" : "participants"}
            </span>
          </>
        ) : null}
      </div>

      {/* Footer: updated at + quick actions */}
      <div className="mt-3.5 flex items-center justify-between border-t border-stone-100 pt-2.5">
        <span className="text-[10.5px] text-stone-400">
          Updated {formatDate(form.updatedAt)}
        </span>

        <div className="flex items-center gap-1">
          {form.status === "open" ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                openPublic();
              }}
              className="rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-orange-600"
              title="Open public view"
            >
              <IconExternal className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              openResponses();
            }}
            className="rounded-lg px-2 py-1 text-[11px] font-semibold text-orange-600 transition-colors hover:bg-orange-50"
          >
            Responses
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Create modal
// ─────────────────────────────────────────────────────────────
const TYPE_OPTIONS = [
  {
    id: "form",
    label: "Blank form",
    desc: "Start from scratch with any fields you want.",
    icon: "📝",
  },
  {
    id: "quiz",
    label: "Quiz",
    desc: "Score respondents, set correct answers and points.",
    icon: "🎯",
  },
  {
    id: "survey",
    label: "Survey",
    desc: "Collect opinions and general feedback.",
    icon: "📊",
  },
  {
    id: "feedback",
    label: "Feedback",
    desc: "Ask for reviews or suggestions.",
    icon: "💬",
  },
  {
    id: "attendance",
    label: "Attendance",
    desc: "Check who showed up. Good for events and classes.",
    icon: "✅",
  },
];

const CreateFormModal = ({ open, onClose, onCreate, creating }) => {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("form");
  const [visibility, setVisibility] = useState("public");

  if (!open) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onCreate({
      title: title.trim() || "Untitled form",
      description: description.trim(),
      type,
      visibility,
    });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-900/40 backdrop-blur-[3px] sm:items-center">
      <div
        className="absolute inset-0"
        onClick={() => !creating && onClose()}
        aria-hidden
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
      >
        {/* Header */}
        <div
          className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900">
              New form
            </h2>
            <p className="mt-0.5 text-[11.5px] text-stone-400">
              Pick a type, give it a name, you can edit everything later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="h-4 w-4">
              <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {/* Type picker */}
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-stone-400">
            Type
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {TYPE_OPTIONS.map((t) => {
              const active = type === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all duration-150 ${
                    active
                      ? "border-orange-300 bg-orange-50/70 ring-2 ring-orange-500/10"
                      : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
                  }`}
                >
                  <span className="text-lg leading-none">{t.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[12.5px] font-semibold ${
                        active ? "text-orange-700" : "text-stone-800"
                      }`}
                    >
                      {t.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-stone-500">
                      {t.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Title */}
          <div className="mt-5">
            <label
              htmlFor="form-title"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-stone-500"
            >
              Title
            </label>
            <input
              id="form-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Team feedback Q1"
              autoFocus
              className="w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10"
            />
          </div>

          {/* Description */}
          <div className="mt-4">
            <label
              htmlFor="form-description"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-stone-500"
            >
              Description <span className="text-stone-300">(optional)</span>
            </label>
            <textarea
              id="form-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this form about?"
              className="w-full resize-none rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-[13.5px] leading-relaxed text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10"
            />
          </div>

          {/* Visibility */}
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
              Who can fill it
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  id: "public",
                  label: "Anyone",
                  desc: "Public link, no password",
                },
                {
                  id: "private",
                  label: "Invited only",
                  desc: "You add emails, they get a password",
                },
              ].map((v) => {
                const active = visibility === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVisibility(v.id)}
                    className={`rounded-xl border p-3 text-left transition-all duration-150 ${
                      active
                        ? "border-orange-300 bg-orange-50/70 ring-2 ring-orange-500/10"
                        : "border-stone-200 hover:border-stone-300 hover:bg-stone-50"
                    }`}
                  >
                    <span
                      className={`block text-[12.5px] font-semibold ${
                        active ? "text-orange-700" : "text-stone-800"
                      }`}
                    >
                      {v.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-stone-500">
                      {v.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-end gap-2 border-t border-stone-100 px-4 pt-3 sm:px-5"
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom), 0.875rem)",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-full px-4 py-2 text-[12.5px] font-semibold text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating}
            className="rounded-full bg-gradient-to-br from-orange-500 to-orange-600 px-5 py-2.5 text-[12.5px] font-semibold text-white shadow-md shadow-orange-500/25 transition-all duration-200 hover:shadow-lg hover:shadow-orange-500/35 active:scale-95 disabled:opacity-60"
          >
            {creating ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                Creating…
              </span>
            ) : (
              "Create form"
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Confirm delete modal
// ─────────────────────────────────────────────────────────────
const ConfirmDeleteModal = ({ open, form, onClose, onConfirm, deleting }) => {
  if (!open || !form) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/40 px-4 backdrop-blur-[3px]">
      <div className="absolute inset-0" onClick={() => !deleting && onClose()} aria-hidden />
      <div className="relative z-10 w-full max-w-sm overflow-hidden rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
            <IconTrash className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">
              Delete this form?
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-stone-500">
              <span className="font-medium text-stone-700">
                {form.title || "Untitled form"}
              </span>{" "}
              and all of its responses will be permanently deleted. This can't
              be undone.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-full px-4 py-2 text-[12.5px] font-semibold text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-full bg-red-500 px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-md shadow-red-500/25 transition-all hover:bg-red-600 active:scale-95 disabled:opacity-60"
          >
            {deleting ? "Deleting…" : "Delete forever"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────
const EmptyState = ({ onCreate, variant = "owned" }) => (
  <div className="flex flex-col items-center px-4 py-14 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className="h-7 w-7 text-orange-500"
      >
        <path
          d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
    <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-stone-900">
      {variant === "owned"
        ? "No forms yet"
        : variant === "collaborated"
        ? "Nothing shared with you"
        : "No forms match"}
    </h3>
    <p className="mt-1.5 max-w-xs text-[12.5px] leading-relaxed text-stone-500">
      {variant === "owned"
        ? "Create your first form, quiz, survey or attendance sheet. It takes ten seconds."
        : variant === "collaborated"
        ? "When someone adds you as a collaborator on a form, it'll show up here."
        : "Try a different filter or search term."}
    </p>
    {variant === "owned" ? (
      <button
        type="button"
        onClick={onCreate}
        className="mt-5 inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-md shadow-orange-500/25 transition-all hover:shadow-lg hover:shadow-orange-500/35 active:scale-95"
      >
        <IconPlus className="h-3.5 w-3.5" />
        Create a form
      </button>
    ) : null}
  </div>
);

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
const MyForms = () => {
  const navigate = useNavigate();

  const [tab, setTab] = useState("owned"); // "owned" | "collaborated"
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // all | open | draft | closed

  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toast, setToast] = useState("");

  const { data, isLoading, isFetching, refetch } = useListFormsQuery();
  const owned = data?.owned || [];
  const collaborated = data?.collaborated || [];

  const [createForm, { isLoading: creating }] = useCreateFormMutation();
  const [deleteForm, { isLoading: deleting }] = useDeleteFormMutation();
  const [duplicateForm] = useDuplicateFormMutation();
  const [publishForm] = usePublishFormMutation();
  const [closeForm] = useCloseFormMutation();

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  };

  // Filter + search
  const filterForms = (list) => {
    let out = list;
    if (statusFilter !== "all") out = out.filter((f) => f.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (f) =>
          (f.title || "").toLowerCase().includes(q) ||
          (f.description || "").toLowerCase().includes(q)
      );
    }
    return out;
  };

  const visibleOwned = useMemo(() => filterForms(owned), [owned, search, statusFilter]);
  const visibleCollab = useMemo(
    () => filterForms(collaborated),
    [collaborated, search, statusFilter]
  );

  const currentList = tab === "owned" ? visibleOwned : visibleCollab;
  const totalCount = owned.length + collaborated.length;

  // ─── Handlers ────────────────────────────────────────────────
  const handleCreate = async (payload) => {
    try {
      const res = await createForm(payload).unwrap();
      setCreateOpen(false);
      showToast("Form created.");
      if (res?.form?._id) {
        navigate(`/forms/${res.form._id}/edit`);
      }
    } catch (err) {
      showToast(err?.data?.message || "Couldn't create the form.");
    }
  };

  const handleAction = async (action, form) => {
    try {
      switch (action) {
        case "edit":
          navigate(`/forms/${form._id}/edit`);
          break;

        case "responses":
          navigate(`/forms/${form._id}/responses`);
          break;

        case "duplicate": {
          await duplicateForm(form._id).unwrap();
          showToast("Duplicated.");
          break;
        }

        case "publish": {
          await publishForm(form._id).unwrap();
          showToast("Form published. Link is live.");
          break;
        }

        case "close": {
          await closeForm(form._id).unwrap();
          showToast("Form closed.");
          break;
        }

        case "copy-link": {
          const url = `${window.location.origin}/forms/${form.slug}`;
          try {
            await navigator.clipboard.writeText(url);
            showToast("Link copied.");
          } catch {
            showToast(url);
          }
          break;
        }

        case "delete":
          setConfirmDelete(form);
          break;

        default:
          break;
      }
    } catch (err) {
      showToast(err?.data?.message || "Something went wrong.");
    }
  };

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteForm(confirmDelete._id).unwrap();
      showToast("Form deleted.");
      setConfirmDelete(null);
    } catch (err) {
      showToast(err?.data?.message || "Couldn't delete the form.");
    }
  };

  return (
    <div className="flex min-h-dvh w-full flex-col bg-[#f7f5f0] text-stone-900 antialiased">
      {/* ─── Header ────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b border-stone-200/70 bg-white/85 backdrop-blur-xl"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-3 py-2.5 sm:gap-3 sm:px-6 sm:py-3.5">
          <Link to="/chat" className="shrink-0" aria-label="Back to chat">
            <XamutMark className="h-9 w-9" />
          </Link>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-stone-900 sm:text-base">
              Forms
            </h1>
            <p className="truncate text-[10.5px] text-stone-400 sm:text-[11px]">
              {totalCount === 0
                ? "Create, share, collect responses"
                : `${totalCount} ${totalCount === 1 ? "form" : "forms"} total`}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-br from-orange-500 to-orange-600 px-3 py-2 text-[12px] font-semibold text-white shadow-sm shadow-orange-500/25 transition-all hover:shadow-md hover:shadow-orange-500/35 active:scale-95 sm:px-4 sm:py-2.5 sm:text-[12.5px]"
          >
            <IconPlus className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="hidden sm:inline">New form</span>
            <span className="sm:hidden">New</span>
          </button>
        </div>

        {/* Tabs + controls */}
        <div className="mx-auto max-w-6xl px-3 pb-2.5 sm:px-6 sm:pb-3.5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            {/* Tabs */}
            <div className="flex shrink-0 items-center gap-1 rounded-full bg-stone-100/80 p-1">
              {[
                { id: "owned", label: "My forms", count: owned.length },
                {
                  id: "collaborated",
                  label: "Shared",
                  count: collaborated.length,
                },
              ].map((t) => {
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                      active
                        ? "bg-white text-orange-600 shadow-sm ring-1 ring-stone-900/5"
                        : "text-stone-500 hover:text-stone-800"
                    }`}
                  >
                    {t.label}
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${
                        active
                          ? "bg-orange-100 text-orange-700"
                          : "bg-stone-200/70 text-stone-500"
                      }`}
                    >
                      {t.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <div className="relative min-w-0 flex-1">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
              </svg>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search forms…"
                className="w-full rounded-full border border-stone-200/80 bg-white py-1.5 pl-8 pr-3 text-[12.5px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10"
              />
            </div>

            {/* Status filter */}
            <div className="scrollbar-none flex shrink-0 items-center gap-1 overflow-x-auto">
              {[
                { id: "all", label: "All" },
                { id: "open", label: "Open" },
                { id: "draft", label: "Draft" },
                { id: "closed", label: "Closed" },
              ].map((f) => {
                const active = statusFilter === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setStatusFilter(f.id)}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      active
                        ? "bg-orange-500 text-white shadow-sm shadow-orange-500/25"
                        : "bg-stone-100 text-stone-500 hover:bg-stone-200"
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </header>

      {/* ─── Body ──────────────────────────────────────────── */}
      <main className="min-h-0 flex-1">
        <div className="mx-auto max-w-6xl px-3 pb-8 pt-4 sm:px-6 sm:pt-6">
          {/* Loading skeletons */}
          {isLoading ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="h-44 animate-pulse rounded-2xl bg-white/70 shadow-sm"
                />
              ))}
            </div>
          ) : null}

          {/* Empty states */}
          {!isLoading && currentList.length === 0 ? (
            search.trim() || statusFilter !== "all" ? (
              <EmptyState variant="filtered" />
            ) : tab === "owned" ? (
              <EmptyState variant="owned" onCreate={() => setCreateOpen(true)} />
            ) : (
              <EmptyState variant="collaborated" />
            )
          ) : null}

          {/* Grid */}
          {!isLoading && currentList.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {currentList.map((f) => (
                <FormCard
                  key={f._id}
                  form={f}
                  role={tab === "owned" ? "owner" : "collaborator"}
                  onAction={handleAction}
                />
              ))}
            </div>
          ) : null}

          {/* Refreshing hint */}
          {isFetching && !isLoading ? (
            <p className="mt-6 text-center text-[11px] text-stone-400">
              Refreshing…
            </p>
          ) : null}
        </div>
      </main>

      {/* ─── Toast ────────────────────────────────────────── */}
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

      {/* ─── Modals ───────────────────────────────────────── */}
      <CreateFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
        creating={creating}
      />

      <ConfirmDeleteModal
        open={!!confirmDelete}
        form={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleConfirmDelete}
        deleting={deleting}
      />
    </div>
  );
};

export default MyForms;