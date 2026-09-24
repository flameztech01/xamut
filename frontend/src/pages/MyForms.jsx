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
  useListMyPendingFormsQuery,
} from "../features/formApiSlice";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────
const FORM_TYPE_META = {
  form: {
    label: "Form",
    bg: "bg-teal-50 dark:bg-teal-500/15",
    text: "text-teal-600 dark:text-teal-400",
  },
  quiz: {
    label: "Quiz",
    bg: "bg-purple-50 dark:bg-purple-500/15",
    text: "text-purple-600 dark:text-purple-400",
  },
  survey: {
    label: "Survey",
    bg: "bg-blue-50 dark:bg-blue-500/15",
    text: "text-blue-600 dark:text-blue-400",
  },
  feedback: {
    label: "Feedback",
    bg: "bg-emerald-50 dark:bg-emerald-500/15",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  attendance: {
    label: "Attendance",
    bg: "bg-amber-50 dark:bg-amber-500/15",
    text: "text-amber-700 dark:text-amber-400",
  },
  election: {
    label: "Election",
    bg: "bg-rose-50 dark:bg-rose-500/15",
    text: "text-rose-600 dark:text-rose-400",
  },
};

const STATUS_META = {
  draft: {
    label: "Draft",
    dot: "bg-stone-400 dark:bg-stone-500",
    text: "text-stone-500 dark:text-stone-400",
    chip: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  },
  open: {
    label: "Open",
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  closed: {
    label: "Closed",
    dot: "bg-red-400",
    text: "text-red-500 dark:text-red-400",
    chip: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400",
  },
};

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "draft", label: "Drafts" },
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
];

const TYPE_FILTERS = [
  { id: "all", label: "All types" },
  { id: "form", label: "Forms" },
  { id: "quiz", label: "Quizzes" },
  { id: "survey", label: "Surveys" },
  { id: "feedback", label: "Feedback" },
  { id: "attendance", label: "Attendance" },
  { id: "election", label: "Elections" },
];

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);

  if (sameDay)
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const formatShortDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
};

const formatWindowDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ─────────────────────────────────────────────────────────────
// Type icon
// ─────────────────────────────────────────────────────────────
const TypeIcon = ({ type, className = "h-4 w-4" }) => {
  const props = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "1.9",
    className,
  };
  switch (type) {
    case "quiz":
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "survey":
      return (
        <svg {...props}>
          <path d="M4 20V10M12 20V4M20 20v-7" strokeLinecap="round" />
        </svg>
      );
    case "feedback":
      return (
        <svg {...props}>
          <path
            d="M21 12a8 8 0 0 1-8 8H7l-4 3v-7a8 8 0 0 1 8-8h2a8 8 0 0 1 8 4z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "attendance":
      return (
        <svg {...props}>
          <path
            d="M9 11l2 2 4-4M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    case "election":
      return (
        <svg {...props}>
          <path
            d="M4 20h16M6 20V10h12v10M10 6l2 2 4-4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <path
            d="M9 12h6M9 16h6M9 8h6M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
};

// ─────────────────────────────────────────────────────────────
// Interface icons
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

const IconSearch = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
  </svg>
);

const IconClose = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={className}>
    <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
  </svg>
);

const IconArrowLeft = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const IconClock = ({ className = "h-4 w-4" }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// ─────────────────────────────────────────────────────────────
// Card menu
// ─────────────────────────────────────────────────────────────
const CardMenu = ({ form, onAction, align = "right" }) => {
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
        className="flex h-7 w-7 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        aria-label="More actions"
      >
        <IconDots className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className={`absolute top-full z-50 mt-1 w-44 overflow-hidden rounded-md border border-stone-200/80 bg-white py-1 shadow-xl shadow-stone-900/10 dark:border-stone-700/80 dark:bg-stone-900 dark:shadow-black/40 ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {items.map((it) => (
              <button
                key={it.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onAction(it.id, form);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] leading-tight transition-colors ${
                  it.danger
                    ? "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-500/10"
                    : "text-stone-700 hover:bg-stone-50 dark:text-stone-200 dark:hover:bg-stone-800"
                }`}
              >
                <span className={it.danger ? "text-red-500 dark:text-red-400" : "text-stone-400 dark:text-stone-500"}>
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
// Time window line (used on desktop card)
// ─────────────────────────────────────────────────────────────
const TimeWindowLine = ({ form }) => {
  if (!form.startAt && !form.expiresAt) return null;
  const now = new Date();
  if (form.startAt && new Date(form.startAt) > now) {
    return (
      <p className="mt-1 text-[10.5px] text-amber-600 dark:text-amber-400">
        Starts {formatWindowDate(form.startAt)}
      </p>
    );
  }
  if (form.expiresAt) {
    return (
      <p className="mt-1 text-[10.5px] text-stone-400 dark:text-stone-500">
        Ends {formatWindowDate(form.expiresAt)}
      </p>
    );
  }
  return null;
};

// ─────────────────────────────────────────────────────────────
// Pending access-request badge
// ─────────────────────────────────────────────────────────────
const PendingRequestsBadge = ({ count }) => {
  if (!count) return null;
  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded bg-amber-100 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
      title={`${count} pending access request${count === 1 ? "" : "s"}`}
    >
      {count} req
    </span>
  );
};

// ─────────────────────────────────────────────────────────────
// Desktop form card
// ─────────────────────────────────────────────────────────────
const DesktopFormCard = ({ form, role, onAction }) => {
  const navigate = useNavigate();
  const typeMeta = FORM_TYPE_META[form.type] || FORM_TYPE_META.form;
  const statusMeta = STATUS_META[form.status] || STATUS_META.draft;

  const openEditor = () => navigate(`/forms/${form._id}/edit`);
  const openResponses = () => navigate(`/forms/${form._id}/responses`);

  const openPublic = (e) => {
    e.stopPropagation();
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
      className="group flex cursor-pointer flex-col rounded-lg border border-stone-200/80 bg-white p-3.5 transition-all duration-150 hover:border-teal-300 hover:shadow-[0_4px_16px_-8px_rgba(13,148,136,0.35)] dark:border-stone-800 dark:bg-stone-900 dark:hover:border-teal-500/50 dark:hover:shadow-[0_4px_16px_-8px_rgba(13,148,136,0.5)]"
    >
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex h-5 items-center gap-1 rounded px-1.5 text-[9.5px] font-bold uppercase tracking-wider ${typeMeta.bg} ${typeMeta.text}`}
          >
            <TypeIcon type={form.type} className="h-2.5 w-2.5" />
            {typeMeta.label}
          </span>
          {role === "collaborator" ? (
            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              Shared
            </span>
          ) : null}
          <PendingRequestsBadge count={form.pendingRequestsCount} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${statusMeta.chip}`}
          >
            <span className={`h-1 w-1 rounded-full ${statusMeta.dot}`} />
            {statusMeta.label}
          </span>
          <CardMenu form={form} onAction={onAction} />
        </div>
      </div>

      <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug tracking-tight text-stone-900 dark:text-stone-100">
        {form.title || "Untitled form"}
      </h3>
      {form.description ? (
        <p className="mt-1 line-clamp-1 text-[11.5px] leading-snug text-stone-500 dark:text-stone-400">
          {form.description}
        </p>
      ) : (
        <p className="mt-1 text-[11.5px] italic leading-snug text-stone-400 dark:text-stone-600">
          No description
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 divide-x divide-stone-100 border-y border-stone-100 py-2 dark:divide-stone-800 dark:border-stone-800">
        <div className="px-2 first:pl-0">
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            Responses
          </p>
          <p className="mt-0.5 text-[13px] font-semibold text-stone-800 dark:text-stone-100">
            {form.responseCount || 0}
          </p>
        </div>
        <div className="px-2">
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            {form.type === "election" ? "Positions" : "Fields"}
          </p>
          <p className="mt-0.5 text-[13px] font-semibold text-stone-800 dark:text-stone-100">
            {form.type === "election"
              ? form.positionsCount || 0
              : form.fieldsCount || 0}
          </p>
        </div>
        <div className="px-2">
          <p className="text-[9.5px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
            {form.visibility === "private" ? "Invited" : "Access"}
          </p>
          <p className="mt-0.5 text-[13px] font-semibold text-stone-800 dark:text-stone-100">
            {form.visibility === "private"
              ? form.participantsCount || 0
              : "Public"}
          </p>
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between">
        <div className="min-w-0">
          <span className="text-[10.5px] text-stone-400 dark:text-stone-500">
            Updated {formatDate(form.updatedAt)}
          </span>
          <TimeWindowLine form={form} />
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {form.status === "open" ? (
            <button
              type="button"
              onClick={openPublic}
              className="flex h-6 w-6 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-100 hover:text-teal-600 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-teal-400"
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
            className="rounded px-2 py-1 text-[10.5px] font-semibold text-teal-600 transition-colors hover:bg-teal-50 dark:text-teal-400 dark:hover:bg-teal-500/10"
          >
            Responses
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Mobile form row
// ─────────────────────────────────────────────────────────────
const MobileFormRow = ({ form, onAction }) => {
  const navigate = useNavigate();
  const typeMeta = FORM_TYPE_META[form.type] || FORM_TYPE_META.form;
  const statusMeta = STATUS_META[form.status] || STATUS_META.draft;

  return (
    <button
      type="button"
      onClick={() => navigate(`/forms/${form._id}/edit`)}
      className="flex w-full items-center gap-3 border-b border-stone-100 bg-white px-4 py-3 text-left transition-colors active:bg-stone-50 dark:border-stone-800/60 dark:bg-stone-950 dark:active:bg-stone-900"
    >
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${typeMeta.bg} ${typeMeta.text}`}
      >
        <TypeIcon type={form.type} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13.5px] font-semibold text-stone-900 dark:text-stone-100">
            {form.title || "Untitled form"}
          </span>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusMeta.dot}`} />
          {form.pendingRequestsCount > 0 ? (
            <span className="shrink-0 rounded bg-amber-100 px-1 text-[9px] font-bold text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              {form.pendingRequestsCount}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-stone-500 dark:text-stone-400">
          {plural(form.responseCount || 0, "response")}
          <span className="mx-1 text-stone-300 dark:text-stone-600">·</span>
          {typeMeta.label.toLowerCase()}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <span className="text-[10px] text-stone-400 dark:text-stone-500">
          {formatShortDate(form.updatedAt)}
        </span>
        <CardMenu form={form} onAction={onAction} />
      </span>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────
// Pending drafts banner
// ─────────────────────────────────────────────────────────────
const PendingDraftsBanner = ({ drafts, onResume }) => {
  if (!drafts.length) return null;

  return (
    <div className="border-b border-amber-200/70 bg-amber-50/70 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-500/5 sm:px-5">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400">
          <IconClock className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] font-semibold text-amber-900 dark:text-amber-300">
            You have {drafts.length} unfinished{" "}
            {drafts.length === 1 ? "form" : "forms"}
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {drafts.slice(0, 6).map((d) => (
              <button
                key={d.draftId}
                type="button"
                onClick={() => onResume(d)}
                disabled={!d.accessible}
                title={d.accessible ? "Resume" : d.reason || "Not available"}
                className={`inline-flex max-w-[220px] items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                  d.accessible
                    ? "border-amber-300 bg-white text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:bg-transparent dark:text-amber-300 dark:hover:bg-amber-500/10"
                    : "cursor-not-allowed border-stone-200 bg-white/60 text-stone-400 dark:border-stone-700 dark:bg-transparent dark:text-stone-500"
                }`}
              >
                <span className="truncate">
                  {d.form?.title || "Untitled form"}
                </span>
                {!d.accessible && d.reason ? (
                  <span className="shrink-0 text-[9.5px] uppercase tracking-wide opacity-70">
                    {d.reason}
                  </span>
                ) : null}
              </button>
            ))}
            {drafts.length > 6 ? (
              <span className="self-center text-[10.5px] text-amber-700/70 dark:text-amber-400/70">
                +{drafts.length - 6} more
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Create modal
// ─────────────────────────────────────────────────────────────
const TYPE_OPTIONS = [
  { id: "form", label: "Blank form", desc: "Start from scratch.", icon: "📝" },
  { id: "quiz", label: "Quiz", desc: "Score respondents.", icon: "🎯" },
  { id: "survey", label: "Survey", desc: "Collect opinions.", icon: "📊" },
  { id: "feedback", label: "Feedback", desc: "Ask for reviews.", icon: "💬" },
  { id: "attendance", label: "Attendance", desc: "Track who showed up.", icon: "✅" },
  { id: "election", label: "Election", desc: "Vote for positions.", icon: "🗳️" },
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
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-stone-900/50 backdrop-blur-[3px] dark:bg-black/60 sm:items-center">
      <div
        className="absolute inset-0"
        onClick={() => !creating && onClose()}
        aria-hidden
      />
      <form
        onSubmit={handleSubmit}
        className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl dark:bg-stone-900 sm:rounded-xl"
      >
        <div
          className="flex items-center justify-between border-b border-stone-100 px-4 pb-3 dark:border-stone-800 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div>
            <h2 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              New form
            </h2>
            <p className="mt-0.5 text-[11.5px] text-stone-400 dark:text-stone-500">
              Pick a type, give it a name, edit later.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="flex h-8 w-8 items-center justify-center rounded-md text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:opacity-40 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label="Close"
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
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
                  className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-all duration-150 ${
                    active
                      ? "border-teal-400 bg-teal-50/70 ring-2 ring-teal-500/15 dark:border-teal-500/60 dark:bg-teal-500/10 dark:ring-teal-500/20"
                      : "border-stone-200 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:hover:border-stone-600 dark:hover:bg-stone-800"
                  }`}
                >
                  <span className="text-lg leading-none">{t.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-[12.5px] font-semibold ${
                        active
                          ? "text-teal-700 dark:text-teal-300"
                          : "text-stone-800 dark:text-stone-100"
                      }`}
                    >
                      {t.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-stone-500 dark:text-stone-400">
                      {t.desc}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            <label
              htmlFor="form-title"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400"
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
              className="w-full rounded-md border border-stone-200 bg-white px-3.5 py-2.5 text-[14px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
            />
          </div>

          <div className="mt-4">
            <label
              htmlFor="form-description"
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400"
            >
              Description{" "}
              <span className="text-stone-300 dark:text-stone-600">
                (optional)
              </span>
            </label>
            <textarea
              id="form-description"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What's this form about?"
              className="w-full resize-none rounded-md border border-stone-200 bg-white px-3.5 py-2.5 text-[13.5px] leading-relaxed text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100 dark:placeholder:text-stone-500"
            />
          </div>

          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-stone-500 dark:text-stone-400">
              Who can fill it
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "public", label: "Anyone", desc: "Public link" },
                { id: "private", label: "Invited only", desc: "You send access" },
              ].map((v) => {
                const active = visibility === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVisibility(v.id)}
                    className={`rounded-lg border p-3 text-left transition-all duration-150 ${
                      active
                        ? "border-teal-400 bg-teal-50/70 ring-2 ring-teal-500/15 dark:border-teal-500/60 dark:bg-teal-500/10 dark:ring-teal-500/20"
                        : "border-stone-200 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:hover:border-stone-600 dark:hover:bg-stone-800"
                    }`}
                  >
                    <span
                      className={`block text-[12.5px] font-semibold ${
                        active
                          ? "text-teal-700 dark:text-teal-300"
                          : "text-stone-800 dark:text-stone-100"
                      }`}
                    >
                      {v.label}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-stone-500 dark:text-stone-400">
                      {v.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          className="flex items-center justify-end gap-2 border-t border-stone-100 px-4 py-3 dark:border-stone-800 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-md px-3.5 py-2 text-[12.5px] font-semibold text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={creating}
            className="rounded-md bg-teal-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.98] disabled:opacity-50 dark:bg-teal-500 dark:hover:bg-teal-400"
          >
            {creating ? "Creating…" : "Create form"}
          </button>
        </div>
      </form>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Confirm delete modal
// ─────────────────────────────────────────────────────────────
const ConfirmDeleteModal = ({ form, onClose, onConfirm, deleting }) => {
  if (!form) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/50 px-4 backdrop-blur-[3px] dark:bg-black/60">
      <div className="absolute inset-0" onClick={() => !deleting && onClose()} aria-hidden />
      <div className="relative z-10 w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl dark:bg-stone-900">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-red-50 text-red-500 dark:bg-red-500/15 dark:text-red-400">
            <IconTrash className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[14.5px] font-semibold text-stone-900 dark:text-stone-100">
              Delete form?
            </h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              <span className="font-medium text-stone-700 dark:text-stone-300">
                "{form.title || "Untitled form"}"
              </span>{" "}
              and all of its responses will be permanently deleted. This can't be undone.
            </p>
          </div>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="rounded-md px-3.5 py-2 text-[12.5px] font-semibold text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="rounded-md bg-red-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm shadow-red-500/25 transition-all hover:bg-red-700 active:scale-[0.98] disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-400"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
const MyForms = () => {
  const navigate = useNavigate();

  const [tab, setTab] = useState("owned"); // "owned" | "collaborated"
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [toast, setToast] = useState("");

  const { data, isLoading, isFetching, refetch } = useListFormsQuery();
  const owned = data?.owned || [];
  const collaborated = data?.collaborated || [];

  const { data: pendingData } = useListMyPendingFormsQuery();
  const pendingDrafts = pendingData?.pending || [];

  const [createForm, { isLoading: creating }] = useCreateFormMutation();
  const [deleteForm, { isLoading: deleting }] = useDeleteFormMutation();
  const [duplicateForm] = useDuplicateFormMutation();
  const [publishForm] = usePublishFormMutation();
  const [closeForm] = useCloseFormMutation();

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  };

  const applyFilters = (list) => {
    let out = list;
    if (statusFilter !== "all") out = out.filter((f) => f.status === statusFilter);
    if (typeFilter !== "all") out = out.filter((f) => f.type === typeFilter);
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

  const visibleOwned = useMemo(
    () => applyFilters(owned),
    [owned, search, statusFilter, typeFilter]
  );
  const visibleCollab = useMemo(
    () => applyFilters(collaborated),
    [collaborated, search, statusFilter, typeFilter]
  );

  const currentList = tab === "owned" ? visibleOwned : visibleCollab;
  const allForms = useMemo(
    () => [...owned, ...collaborated],
    [owned, collaborated]
  );

  const stats = useMemo(() => {
    const total = allForms.length;
    const responses = allForms.reduce(
      (sum, f) => sum + (f.responseCount || 0),
      0
    );
    const open = allForms.filter((f) => f.status === "open").length;
    const draft = allForms.filter((f) => f.status === "draft").length;
    return { total, responses, open, draft };
  }, [allForms]);

  const statusCounts = useMemo(() => {
    const c = { all: allForms.length, draft: 0, open: 0, closed: 0 };
    for (const f of allForms) if (c[f.status] != null) c[f.status]++;
    return c;
  }, [allForms]);

  const typeCounts = useMemo(() => {
    const c = { all: allForms.length };
    for (const f of allForms) c[f.type] = (c[f.type] || 0) + 1;
    return c;
  }, [allForms]);

  const isFiltered =
    search.trim() || statusFilter !== "all" || typeFilter !== "all";

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
        case "duplicate":
          await duplicateForm(form._id).unwrap();
          showToast("Duplicated.");
          refetch();
          break;
        case "publish":
          await publishForm(form._id).unwrap();
          showToast("Form published. Link is live.");
          refetch();
          break;
        case "close":
          await closeForm(form._id).unwrap();
          showToast("Form closed.");
          refetch();
          break;
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
      refetch();
    } catch (err) {
      showToast(err?.data?.message || "Couldn't delete the form.");
    }
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-white text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      {/* ── Desktop sidebar ──────────────────────────────── */}
      <aside className="hidden shrink-0 flex-col border-r border-stone-200/70 bg-stone-50/50 dark:border-stone-800/70 dark:bg-stone-900/40 md:flex md:w-[260px]">
        <div className="flex h-14 items-center border-b border-stone-200/70 px-4 dark:border-stone-800/70">
          <Link to="/chat" className="flex items-center">
            <img
              src="/xamut-logo.png"
              alt="Xamut"
              draggable={false}
              className="h-7 w-auto select-none dark:brightness-0 dark:invert"
            />
          </Link>
        </div>

        <div className="px-3 pt-4">
          <Link
            to="/chat"
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13px] font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <IconArrowLeft className="h-4 w-4 text-stone-400 dark:text-stone-500" />
            Back to chat
          </Link>
        </div>

        <div className="px-3 pt-4">
          <div className="grid grid-cols-2 gap-0.5 rounded-md border border-stone-200/70 bg-white p-0.5 dark:border-stone-800 dark:bg-stone-900">
            {[
              { id: "owned", label: "Mine", count: owned.length },
              { id: "collaborated", label: "Shared", count: collaborated.length },
            ].map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex items-center justify-center gap-1 rounded px-2 py-1.5 text-[11.5px] font-semibold transition-colors ${
                    active
                      ? "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"
                      : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
                  }`}
                >
                  {t.label}
                  <span
                    className={`text-[10px] ${
                      active
                        ? "text-teal-600 dark:text-teal-400"
                        : "text-stone-400 dark:text-stone-500"
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-3 pt-5">
          <p className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            Status
          </p>
          <div className="space-y-0.5">
            {STATUS_FILTERS.map((s) => {
              const active = statusFilter === s.id;
              const count = statusCounts[s.id] ?? 0;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatusFilter(s.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    active
                      ? "bg-teal-50 font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"
                      : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <span
                    className={`shrink-0 text-[10.5px] ${
                      active
                        ? "text-teal-600 dark:text-teal-400"
                        : "text-stone-400 dark:text-stone-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-3 pt-5">
          <p className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            Type
          </p>
          <div className="space-y-0.5">
            {TYPE_FILTERS.map((t) => {
              const active = typeFilter === t.id;
              const count = typeCounts[t.id] ?? 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTypeFilter(t.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                    active
                      ? "bg-teal-50 font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"
                      : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                  <span
                    className={`shrink-0 text-[10.5px] ${
                      active
                        ? "text-teal-600 dark:text-teal-400"
                        : "text-stone-400 dark:text-stone-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1" />

        <div className="border-t border-stone-200/70 p-3 dark:border-stone-800/70">
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-stone-200/70 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Responses
              </p>
              <p className="mt-0.5 text-[16px] font-semibold text-stone-900 dark:text-stone-100">
                {stats.responses}
              </p>
            </div>
            <div className="rounded-md border border-stone-200/70 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Open
              </p>
              <p className="mt-0.5 text-[16px] font-semibold text-emerald-600 dark:text-emerald-400">
                {stats.open}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main area ────────────────────────────────────── */}
      <main className="relative flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-stone-950">
        <header
          className="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-stone-200/70 bg-white/90 px-3 backdrop-blur-xl dark:border-stone-800/70 dark:bg-stone-950/90 sm:px-5"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <Link
            to="/chat"
            className="flex shrink-0 items-center md:hidden"
            aria-label="Xamut"
          >
            <img
              src="/xamut-icon.png"
              alt="Xamut"
              draggable={false}
              className="h-7 w-7 select-none dark:brightness-0 dark:invert"
            />
          </Link>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100 md:text-[17px]">
              My forms
            </h1>
            <p className="hidden truncate text-[11px] text-stone-400 dark:text-stone-500 md:block">
              {stats.total} total
              <span className="mx-1.5 text-stone-300 dark:text-stone-600">·</span>
              {stats.open} open
              <span className="mx-1.5 text-stone-300 dark:text-stone-600">·</span>
              {stats.draft} draft{stats.draft === 1 ? "" : "s"}
            </p>
          </div>

          <div className="relative hidden md:block">
            <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search forms…"
              className="w-56 rounded-md border border-stone-200 bg-stone-50 py-1.5 pl-8 pr-3 text-[12.5px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:bg-white focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:bg-stone-900"
            />
          </div>

          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-md bg-teal-600 px-3 text-[12.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.97] dark:bg-teal-500 dark:hover:bg-teal-400"
          >
            <IconPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New form</span>
            <span className="sm:hidden">New</span>
          </button>
        </header>

        {/* Mobile filter bar */}
        <div className="border-b border-stone-200/70 bg-white dark:border-stone-800/70 dark:bg-stone-950 md:hidden">
          <div className="px-3 pt-3">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400 dark:text-stone-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search forms…"
                className="w-full rounded-md border border-stone-200 bg-stone-50 py-2 pl-8 pr-3 text-[13px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:bg-white focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500"
              />
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-2.5 overflow-x-auto scrollbar-thin">
            {[
              { id: "owned", label: "Mine", count: owned.length },
              { id: "collaborated", label: "Shared", count: collaborated.length },
            ].map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                    active
                      ? "border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500/60 dark:bg-teal-500/15 dark:text-teal-300"
                      : "border-stone-200 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                  }`}
                >
                  {t.label} {t.count}
                </button>
              );
            })}
            <span className="mx-1 h-5 w-px shrink-0 bg-stone-200 dark:bg-stone-700" />
            {STATUS_FILTERS.map((s) => {
              const active = statusFilter === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatusFilter(s.id)}
                  className={`shrink-0 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                    active
                      ? "border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500/60 dark:bg-teal-500/15 dark:text-teal-300"
                      : "border-stone-200 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                  }`}
                >
                  {s.label}
                </button>
              );
            })}
            <span className="mx-1 h-5 w-px shrink-0 bg-stone-200 dark:bg-stone-700" />
            {TYPE_FILTERS.map((t) => {
              const active = typeFilter === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTypeFilter(t.id)}
                  className={`shrink-0 rounded-md border px-2.5 py-1 text-[11.5px] font-semibold transition-colors ${
                    active
                      ? "border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500/60 dark:bg-teal-500/15 dark:text-teal-300"
                      : "border-stone-200 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {/* Pending drafts banner */}
          <PendingDraftsBanner
            drafts={pendingDrafts}
            onResume={(d) => navigate(`/forms/${d.form.slug}`)}
          />

          {/* Loading */}
          {isLoading ? (
            <div>
              <div className="md:hidden">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 border-b border-stone-100 bg-white px-4 py-3 dark:border-stone-800/60 dark:bg-stone-950"
                  >
                    <div className="h-9 w-9 shrink-0 animate-pulse rounded-md bg-stone-100 dark:bg-stone-800/60" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-3 w-2/3 animate-pulse rounded bg-stone-100 dark:bg-stone-800/60" />
                      <div className="h-2.5 w-1/3 animate-pulse rounded bg-stone-100 dark:bg-stone-800/60" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="hidden p-5 md:block">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <div
                      key={i}
                      className="h-[180px] animate-pulse rounded-lg border border-stone-200/80 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/60"
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {/* Empty state */}
          {!isLoading && currentList.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400">
                <TypeIcon type="form" className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-[15px] font-semibold text-stone-900 dark:text-stone-100">
                {isFiltered
                  ? "Nothing matches"
                  : tab === "owned"
                  ? "No forms yet"
                  : "Nothing shared with you"}
              </h2>
              <p className="mt-1 max-w-xs text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
                {isFiltered
                  ? "Try clearing your filters or searching for something else."
                  : tab === "owned"
                  ? "Create your first form, quiz, survey, election or attendance sheet. It takes ten seconds."
                  : "When someone adds you as a collaborator on a form, it'll show up here."}
              </p>
              {!isFiltered && tab === "owned" ? (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="mt-5 flex items-center gap-1.5 rounded-md bg-teal-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.97] dark:bg-teal-500 dark:hover:bg-teal-400"
                >
                  <IconPlus className="h-3.5 w-3.5" />
                  Create a form
                </button>
              ) : null}
            </div>
          ) : null}

          {/* Mobile list */}
          {!isLoading && currentList.length > 0 ? (
            <div className="md:hidden">
              {currentList.map((f) => (
                <MobileFormRow key={f._id} form={f} onAction={handleAction} />
              ))}
              <div className="h-6" />
            </div>
          ) : null}

          {/* Desktop grid */}
          {!isLoading && currentList.length > 0 ? (
            <div className="hidden p-5 md:block">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
                  {currentList.length}{" "}
                  {currentList.length === 1 ? "form" : "forms"}
                </p>
                {isFetching ? (
                  <span className="text-[10.5px] text-stone-400 dark:text-stone-500">
                    Refreshing…
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                {currentList.map((f) => (
                  <DesktopFormCard
                    key={f._id}
                    form={f}
                    role={tab === "owned" ? "owner" : "collaborator"}
                    onAction={handleAction}
                  />
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </main>

      {/* ── Toast ──────────────────────────────────────── */}
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

      {/* ── Modals ─────────────────────────────────────── */}
      <CreateFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={handleCreate}
        creating={creating}
      />

      <ConfirmDeleteModal
        form={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={handleConfirmDelete}
        deleting={deleting}
      />
    </div>
  );
};

export default MyForms;