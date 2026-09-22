// pages/FormResponses.jsx
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  useGetFormQuery,
  useGetFormStatsQuery,
  useListResponsesQuery,
  useGetLeaderboardQuery,
  useDeleteResponseMutation,
} from "../features/formApiSlice";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const formatDateTime = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

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

const formatDuration = (sec) => {
  if (!sec || sec < 1) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

const formatBytes = (bytes) => {
  if (!bytes || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ─────────────────────────────────────────────────────────────
// Media value helpers
//
// Media field answers land here in one of three shapes:
//   • a plain URL string (legacy `file` fields from before the
//     media upload feature)
//   • { url, filename, size, mimetype } (single-file upload)
//   • [ ...objects ] (multi-file upload)
//
// These helpers normalise all three so the renderer doesn't care
// which shape it received.
// ─────────────────────────────────────────────────────────────
const MEDIA_FIELD_TYPES = new Set(["file", "image", "document"]);

const isMediaField = (type) => MEDIA_FIELD_TYPES.has(type);

const mediaValueToUrl = (v) => {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof v.url === "string") return v.url;
  return "";
};

const mediaValueToName = (v) => {
  if (v == null) return "";
  if (typeof v === "object") {
    return v.filename || v.name || "";
  }
  if (typeof v === "string") {
    try {
      const u = new URL(v);
      const parts = u.pathname.split("/").filter(Boolean);
      return decodeURIComponent(parts[parts.length - 1] || "");
    } catch {
      return v;
    }
  }
  return "";
};

const normalizeMediaValue = (value) => {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((v) => v != null && v !== "");
  return [value];
};

const looksLikeImage = (v, kind) => {
  if (kind === "image") return true;
  if (typeof v === "object" && typeof v.mimetype === "string") {
    return v.mimetype.startsWith("image/");
  }
  const url = mediaValueToUrl(v);
  return /\.(jpe?g|png|gif|webp|avif|heic|heif|svg)(?:\?|$)/i.test(url);
};

// ─────────────────────────────────────────────────────────────
// Value → display string (for CSV, chips, aria, etc.)
// ─────────────────────────────────────────────────────────────
const stripHtmlToText = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x && typeof x === "object" && typeof x.url === "string") {
          return x.filename || x.url;
        }
        return String(x);
      })
      .join(", ");
  }
  if (typeof v === "object") {
    if (typeof v.url === "string") return v.filename || v.url;
    return "";
  }
  return String(v);
};

// ─────────────────────────────────────────────────────────────
// CSV exporter — media values get flattened to their URLs
// ─────────────────────────────────────────────────────────────
const toCSV = (columns, rows) => {
  const esc = (val) => {
    if (val === null || val === undefined) return "";
    let s;
    if (Array.isArray(val)) {
      s = val
        .map((x) => {
          if (x && typeof x === "object" && typeof x.url === "string")
            return x.url;
          return String(x);
        })
        .join("; ");
    } else if (typeof val === "object" && typeof val.url === "string") {
      s = val.url;
    } else {
      s = String(val);
    }
    if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.map((c) => esc(c.label)).join(",");
  const body = rows
    .map((r) => columns.map((c) => esc(r[c.id])).join(","))
    .join("\n");
  return `${header}\n${body}`;
};

const downloadBlob = (content, filename, type = "text/csv;charset=utf-8") => {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Match a label that reads like a name field. Covers "Name",
// "Full name", "First name", "Last name", "Your name", "Full Name",
// "Name of student", etc. Deliberately broad — a text answer to a
// field labeled anything name-ish is a reasonable fallback.
const NAME_LABEL_RE = /\b(name|fullname|full-?name)\b/i;

// Match a label that reads like an email field. Used as a secondary
// path since we also have an explicit "email" field type.
const EMAIL_LABEL_RE = /\b(e-?mail|mail\s*address)\b/i;

// ─────────────────────────────────────────────────────────────
// Respondent display resolver
//
// Order of preference:
//   1. response.respondentName       — captured at submit time
//   2. A name-like text field answer — "Full name", "Your name", etc.
//   3. response.respondentEmail      — captured at submit time
//   4. An email-type / email-labeled field answer
//   5. Local part of any email we found (so we never say "Anonymous"
//      when we at least have an address)
//   6. "Anonymous"
//
// Returns { primary, secondary, initials } where secondary is the
// email to show under the name (empty string if none).
// ─────────────────────────────────────────────────────────────
const getRespondentDisplay = (response, form) => {
  const r = response || {};
  const fields = form?.fields || [];
  const answers = Array.isArray(r.answers) ? r.answers : [];

  let foundName = String(r.respondentName || "").trim();
  let foundEmail = String(r.respondentEmail || "").trim();

  if ((!foundName || !foundEmail) && fields.length && answers.length) {
    for (const field of fields) {
      if (field.type === "section") continue;
      const a = answers.find((x) => x.fieldId === field.id);
      if (!a || a.value == null || a.value === "") continue;

      const valueStr = stripHtmlToText(a.value).trim();
      if (!valueStr) continue;

      if (
        !foundName &&
        (field.type === "short_text" || field.type === "long_text") &&
        NAME_LABEL_RE.test(field.label || "")
      ) {
        foundName = valueStr;
      }

      if (
        !foundEmail &&
        (field.type === "email" || EMAIL_LABEL_RE.test(field.label || "")) &&
        EMAIL_RE.test(valueStr)
      ) {
        foundEmail = valueStr.toLowerCase();
      }

      if (foundName && foundEmail) break;
    }
  }

  if (!foundName && foundEmail) {
    const local = foundEmail.split("@")[0];
    const clean = local
      .replace(/[._-]+/g, " ")
      .replace(/\d+/g, " ")
      .trim();
    if (clean && clean.length <= 40 && /^[a-z]/i.test(local)) {
      foundName = clean
        .split(/\s+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
    }
  }

  const primary = foundName || foundEmail || "Anonymous";
  const secondary = foundName && foundEmail ? foundEmail : "";
  const initials = (primary || "?").charAt(0).toUpperCase();

  return { primary, secondary, initials };
};

const STATUS_META = {
  draft: {
    label: "Draft",
    dot: "bg-stone-400 dark:bg-stone-500",
    chip: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300",
  },
  open: {
    label: "Open",
    dot: "bg-emerald-500",
    chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  closed: {
    label: "Closed",
    dot: "bg-red-400",
    chip: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400",
  },
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
  dots: (c) => (
    <svg viewBox="0 0 24 24" fill="currentColor" className={c}>
      <circle cx="5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="19" cy="12" r="1.7" />
    </svg>
  ),
  close: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={c}>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  ),
  search: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={c}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
    </svg>
  ),
  download: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  trash: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M3 6h18M8 6v14a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6M10 11v6M14 11v6" strokeLinecap="round" />
    </svg>
  ),
  chevRight: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className={c}>
      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chart: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M4 20V10M12 20V4M20 20v-7" strokeLinecap="round" />
    </svg>
  ),
  list: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" strokeLinecap="round" />
    </svg>
  ),
  trophy: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v3a3 3 0 0 1-3 3M7 5H4v3a3 3 0 0 0 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  edit: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className={c}>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
    </svg>
  ),
  x: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" className={c}>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
    </svg>
  ),
  clock: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" strokeLinecap="round" />
    </svg>
  ),
  users: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" strokeLinecap="round" />
    </svg>
  ),
  empty: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={c}>
      <path d="M3 5h18v14H3zM3 9h18M8 13h8M8 17h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  arrowLeft: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={c}>
      <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  file: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
      <path d="M14 2v6h6" strokeLinejoin="round" />
    </svg>
  ),
  external: (c) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className={c}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

// ─────────────────────────────────────────────────────────────
// Media answer renderer
// ─────────────────────────────────────────────────────────────
const MediaAnswer = ({ value, kind, compact = false }) => {
  const items = normalizeMediaValue(value).filter((v) => mediaValueToUrl(v));
  if (!items.length) {
    return (
      <span className="italic text-stone-400 dark:text-stone-500">
        No answer
      </span>
    );
  }

  const renderOne = (item, i) => {
    const url = mediaValueToUrl(item);
    const name = mediaValueToName(item);
    const size = typeof item === "object" ? item.size : 0;

    if (looksLikeImage(item, kind)) {
      return (
        <a
          key={i}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`group relative block overflow-hidden rounded-md ring-1 ring-stone-200 transition-all hover:ring-teal-400 dark:ring-stone-700 dark:hover:ring-teal-500/60 ${
            compact ? "aspect-square" : "aspect-square"
          }`}
          title={name || "Open image"}
        >
          <img
            src={url}
            alt={name || "Uploaded image"}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-end bg-gradient-to-t from-black/55 to-transparent px-2 py-1.5 opacity-0 transition-opacity group-hover:opacity-100">
            <span className="text-white">{I.external("h-3 w-3")}</span>
          </span>
        </a>
      );
    }

    return (
      <a
        key={i}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2.5 rounded-md border border-stone-200 bg-white px-3 py-2 transition-colors hover:border-teal-300 hover:bg-teal-50/50 dark:border-stone-700 dark:bg-stone-900 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-stone-100 text-stone-500 dark:bg-stone-800 dark:text-stone-400">
          {I.file("h-4 w-4")}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12px] font-medium text-stone-800 dark:text-stone-100">
            {name || "Uploaded file"}
          </span>
          <span className="block truncate text-[10px] text-stone-400 dark:text-stone-500">
            {formatBytes(size) || "Open file"}
          </span>
        </span>
        <span className="shrink-0 text-stone-300 dark:text-stone-600">
          {I.external("h-3.5 w-3.5")}
        </span>
      </a>
    );
  };

  if (items.length === 1 && looksLikeImage(items[0], kind)) {
    const only = items[0];
    const url = mediaValueToUrl(only);
    const name = mediaValueToName(only);
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block overflow-hidden rounded-md ring-1 ring-stone-200 transition-all hover:ring-teal-400 dark:ring-stone-700 dark:hover:ring-teal-500/60"
      >
        <img
          src={url}
          alt={name || "Uploaded image"}
          loading="lazy"
          className="block max-h-64 w-full object-cover transition-transform duration-300 group-hover:scale-[1.01]"
        />
      </a>
    );
  }

  return (
    <div
      className={
        items.some((it) => looksLikeImage(it, kind))
          ? "grid grid-cols-2 gap-2 sm:grid-cols-3"
          : "space-y-2"
      }
    >
      {items.map(renderOne)}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Stat bar
// ─────────────────────────────────────────────────────────────
const StatBar = ({ label, count, percentage, correct }) => (
  <div>
    <div className="mb-1 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-1.5">
        {correct ? (
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            {I.check("h-2 w-2")}
          </span>
        ) : null}
        <span className="min-w-0 truncate text-[12px] text-stone-700 dark:text-stone-300">
          {label}
        </span>
      </div>
      <div className="shrink-0 text-[11.5px] font-semibold text-stone-700 dark:text-stone-300">
        {count}
        <span className="ml-1.5 font-normal text-stone-400 dark:text-stone-500">
          {percentage}%
        </span>
      </div>
    </div>
    <div className="h-1.5 overflow-hidden rounded-full bg-stone-100 dark:bg-stone-800">
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          correct ? "bg-emerald-500" : "bg-teal-500 dark:bg-teal-400"
        }`}
        style={{ width: `${Math.max(2, percentage)}%` }}
      />
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Field stats block
// ─────────────────────────────────────────────────────────────
const FieldStats = ({ field, stats }) => {
  if (stats?.isSection || field.type === "section") {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50/60 px-3.5 py-2.5 dark:border-stone-700 dark:bg-stone-900/50">
        <p className="text-[12.5px] font-semibold text-stone-600 dark:text-stone-300">
          {field.label}
        </p>
        <p className="mt-0.5 text-[10px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
          Section header
        </p>
      </div>
    );
  }

  const answered = stats?.answered ?? 0;
  const skipped = stats?.skipped ?? 0;

  return (
    <div className="rounded-lg border border-stone-200/80 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-[13px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            {field.label}
          </p>
          <p className="mt-0.5 text-[10.5px] uppercase tracking-wider text-stone-400 dark:text-stone-500">
            {answered} {answered === 1 ? "response" : "responses"}
            {skipped > 0 ? ` · ${skipped} skipped` : ""}
          </p>
        </div>
      </div>

      {["radio", "checkbox", "dropdown", "multi_select"].includes(field.type) &&
      stats?.options?.length ? (
        <div className="space-y-2.5">
          {stats.options.map((o) => {
            const isCorrect =
              field.scoring?.correct?.length &&
              field.scoring.correct.includes(o.value);
            return (
              <StatBar
                key={o.optionId}
                label={o.label || o.value}
                count={o.count}
                percentage={o.percentage}
                correct={isCorrect}
              />
            );
          })}
        </div>
      ) : null}

      {field.type === "yes_no" && stats ? (
        <div className="space-y-2.5">
          <StatBar
            label="Yes"
            count={stats.yes || 0}
            percentage={stats.yesPercentage || 0}
          />
          <StatBar
            label="No"
            count={stats.no || 0}
            percentage={answered ? Math.round(((stats.no || 0) / answered) * 100) : 0}
          />
        </div>
      ) : null}

      {["number", "rating", "scale"].includes(field.type) && stats ? (
        <div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-md bg-stone-50 px-2.5 py-2 dark:bg-stone-800/60">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Min
              </p>
              <p className="mt-0.5 text-[14px] font-semibold text-stone-800 dark:text-stone-100">
                {stats.min ?? "—"}
              </p>
            </div>
            <div className="rounded-md bg-teal-50 px-2.5 py-2 dark:bg-teal-500/10">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider text-teal-600 dark:text-teal-400">
                Avg
              </p>
              <p className="mt-0.5 text-[14px] font-semibold text-teal-700 dark:text-teal-300">
                {stats.avg ?? "—"}
              </p>
            </div>
            <div className="rounded-md bg-stone-50 px-2.5 py-2 dark:bg-stone-800/60">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Max
              </p>
              <p className="mt-0.5 text-[14px] font-semibold text-stone-800 dark:text-stone-100">
                {stats.max ?? "—"}
              </p>
            </div>
          </div>
          {stats.distribution?.length ? (
            <div className="space-y-2">
              {stats.distribution.map((d) => (
                <StatBar
                  key={d.value}
                  label={String(d.value)}
                  count={d.count}
                  percentage={
                    answered ? Math.round((d.count / answered) * 100) : 0
                  }
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {field.type === "date" && stats ? (
        <div className="space-y-1.5 text-[12px] text-stone-600 dark:text-stone-300">
          {stats.earliest ? (
            <p>
              <span className="text-stone-400 dark:text-stone-500">
                Earliest:
              </span>{" "}
              {formatDateTime(stats.earliest)}
            </p>
          ) : null}
          {stats.latest ? (
            <p>
              <span className="text-stone-400 dark:text-stone-500">Latest:</span>{" "}
              {formatDateTime(stats.latest)}
            </p>
          ) : null}
          {!stats.earliest && !stats.latest ? (
            <p className="text-stone-400 dark:text-stone-500">No answers yet.</p>
          ) : null}
        </div>
      ) : null}

      {isMediaField(field.type) && stats ? (
        <div>
          {stats.samples?.length ? (
            <MediaAnswer value={stats.samples} kind={field.type} compact />
          ) : (
            <p className="text-[12px] text-stone-400 dark:text-stone-500">
              No uploads yet.
            </p>
          )}
        </div>
      ) : null}

      {["short_text", "long_text", "email", "phone", "url", "time"].includes(
        field.type
      ) && stats ? (
        <div>
          {stats.correctRate !== null && stats.correctRate !== undefined ? (
            <p className="mb-2 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
              {stats.correctRate}% got this right
            </p>
          ) : null}
          {stats.samples?.length ? (
            <div className="space-y-1.5">
              {stats.samples.slice(0, 8).map((s, i) => (
                <div
                  key={i}
                  className="rounded-md bg-stone-50/80 px-2.5 py-1.5 text-[12px] leading-snug text-stone-700 dark:bg-stone-800/60 dark:text-stone-300"
                >
                  {stripHtmlToText(s) || (
                    <span className="text-stone-400 dark:text-stone-500">
                      (empty)
                    </span>
                  )}
                </div>
              ))}
              {stats.samples.length > 8 ? (
                <p className="pt-1 text-center text-[10.5px] text-stone-400 dark:text-stone-500">
                  Showing 8 of {stats.samples.length} · open Responses for the rest
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[12px] text-stone-400 dark:text-stone-500">
              No answers yet.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────
const EmptyResponses = ({ status }) => (
  <div className="flex flex-col items-center px-4 py-16 text-center">
    <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400">
      {I.empty("h-6 w-6")}
    </div>
    <h3 className="mt-3.5 text-[14.5px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
      No responses yet
    </h3>
    <p className="mt-1.5 max-w-xs text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
      {status === "draft"
        ? "Publish the form first. Once people start filling it, responses show up here."
        : status === "closed"
        ? "This form is closed. Reopen it to keep collecting responses."
        : "Share the public link to start collecting responses."}
    </p>
  </div>
);

// ─────────────────────────────────────────────────────────────
// Response detail modal
// ─────────────────────────────────────────────────────────────
const ResponseDetailModal = ({ response, form, onClose, onDelete, deleting }) => {
  if (!response || !form) return null;

  const answerMap = new Map();
  for (const a of response.answers || []) answerMap.set(a.fieldId, a);

  const isQuiz = form.type === "quiz" || (response.maxScore || 0) > 0;

  const { primary, secondary } = getRespondentDisplay(response, form);

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-stone-900/50 backdrop-blur-[3px] dark:bg-black/60 sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white shadow-2xl dark:bg-stone-900 sm:rounded-xl">
        <div
          className="flex items-start justify-between gap-3 border-b border-stone-100 px-4 pb-3 dark:border-stone-800 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
              Response
            </p>
            <h2 className="mt-0.5 truncate text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              {primary}
            </h2>
            {secondary ? (
              <p className="mt-0.5 truncate text-[11.5px] text-stone-400 dark:text-stone-500">
                {secondary}
              </p>
            ) : null}
            <p className="mt-1 text-[10.5px] text-stone-400 dark:text-stone-500">
              {formatDateTime(response.submittedAt)}
              {response.durationSeconds
                ? ` · ${formatDuration(response.durationSeconds)}`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 dark:text-stone-500 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label="Close"
          >
            {I.close("h-4 w-4")}
          </button>
        </div>

        {isQuiz ? (
          <div className="border-b border-stone-100 bg-purple-50/40 px-4 py-3 dark:border-stone-800 dark:bg-purple-500/10 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-500/20">
                <span className="text-[14px] font-bold text-purple-700 dark:text-purple-300">
                  {response.percentage ?? 0}%
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-purple-900 dark:text-purple-200">
                  {response.totalScore} / {response.maxScore} points
                </p>
                {response.passed !== null && response.passed !== undefined ? (
                  <p
                    className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold ${
                      response.passed
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-500 dark:text-red-400"
                    }`}
                  >
                    {response.passed ? "Passed" : "Failed"}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="space-y-3">
            {(form.fields || []).map((field) => {
              if (field.type === "section") {
                return (
                  <div
                    key={field.id}
                    className="rounded-md border border-dashed border-stone-300 bg-stone-50/50 px-3 py-2 dark:border-stone-700 dark:bg-stone-900/50"
                  >
                    <p className="text-[12px] font-semibold text-stone-600 dark:text-stone-300">
                      {field.label}
                    </p>
                  </div>
                );
              }

              const a = answerMap.get(field.id);
              const value = a?.value;
              const correct = a?.correct;
              const isEmpty =
                value === null ||
                value === undefined ||
                value === "" ||
                (Array.isArray(value) && value.length === 0);

              return (
                <div key={field.id}>
                  <div className="mb-1 flex items-center gap-1.5">
                    <p className="min-w-0 flex-1 text-[11.5px] font-semibold text-stone-600 dark:text-stone-300">
                      {field.label}
                    </p>
                    {correct !== null && correct !== undefined ? (
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white ${
                          correct ? "bg-emerald-500" : "bg-red-400"
                        }`}
                      >
                        {correct ? I.check("h-2.5 w-2.5") : I.x("h-2.5 w-2.5")}
                      </span>
                    ) : null}
                  </div>
                  <div className="rounded-md bg-stone-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-stone-800 dark:bg-stone-800/60 dark:text-stone-200">
                    {isEmpty ? (
                      <span className="italic text-stone-400 dark:text-stone-500">
                        No answer
                      </span>
                    ) : isMediaField(field.type) ? (
                      <MediaAnswer value={value} kind={field.type} />
                    ) : field.type === "url" ? (
                      <a
                        href={String(value)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-teal-600 underline decoration-teal-300 underline-offset-2 hover:text-teal-700 dark:text-teal-400 dark:decoration-teal-500/60 dark:hover:text-teal-300"
                      >
                        {String(value)}
                      </a>
                    ) : Array.isArray(value) ? (
                      <div className="flex flex-wrap gap-1.5">
                        {value.map((v, i) => (
                          <span
                            key={i}
                            className="rounded-md bg-white px-2 py-0.5 text-[11.5px] font-medium text-stone-700 ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-200 dark:ring-stone-700"
                          >
                            {stripHtmlToText(v)}
                          </span>
                        ))}
                      </div>
                    ) : typeof value === "boolean" ? (
                      value ? "Yes" : "No"
                    ) : (
                      <p className="whitespace-pre-wrap break-words">
                        {stripHtmlToText(value)}
                      </p>
                    )}
                  </div>
                  {a?.score != null && field.scoring?.points ? (
                    <p className="mt-1 text-[10.5px] text-purple-600 dark:text-purple-400">
                      {a.score} / {field.scoring.points} points
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div
          className="flex items-center justify-between gap-2 border-t border-stone-100 px-4 py-3 dark:border-stone-800 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.75rem)" }}
        >
          <button
            type="button"
            onClick={() => onDelete(response._id)}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-500/10"
          >
            {I.trash("h-3.5 w-3.5")}
            Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-stone-800 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-white"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Desktop response row
// ─────────────────────────────────────────────────────────────
const DesktopResponseRow = ({ response, form, onOpen }) => {
  const isQuiz = form?.type === "quiz" || (response.maxScore || 0) > 0;
  const { primary, secondary, initials } = getRespondentDisplay(response, form);

  return (
    <button
      type="button"
      onClick={() => onOpen(response)}
      className="group grid w-full grid-cols-[auto_1fr_auto_auto_auto_auto] items-center gap-4 border-b border-stone-100 px-4 py-3 text-left transition-colors hover:bg-stone-50/70 dark:border-stone-800/60 dark:hover:bg-stone-900/60"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-semibold text-teal-700 dark:bg-teal-500/20 dark:text-teal-300">
        {initials}
      </span>

      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-stone-800 dark:text-stone-100">
          {primary}
        </p>
        {secondary ? (
          <p className="truncate text-[11px] text-stone-400 dark:text-stone-500">
            {secondary}
          </p>
        ) : null}
      </div>

      <span className="shrink-0 text-[11px] text-stone-400 dark:text-stone-500">
        {formatRelative(response.submittedAt)}
      </span>

      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-stone-400 dark:text-stone-500">
        {I.clock("h-3 w-3")}
        {formatDuration(response.durationSeconds)}
      </span>

      {isQuiz ? (
        <span
          className={`shrink-0 text-[11px] font-semibold ${
            response.passed === true
              ? "text-emerald-600 dark:text-emerald-400"
              : response.passed === false
              ? "text-red-500 dark:text-red-400"
              : "text-purple-600 dark:text-purple-400"
          }`}
        >
          {response.percentage ?? 0}%
        </span>
      ) : (
        <span className="shrink-0 text-[11px] text-stone-300 dark:text-stone-600">
          —
        </span>
      )}

      <span className="shrink-0 text-stone-300 transition-transform group-hover:translate-x-0.5 group-hover:text-teal-500 dark:text-stone-600 dark:group-hover:text-teal-400">
        {I.chevRight("h-4 w-4")}
      </span>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────
// Mobile response row
// ─────────────────────────────────────────────────────────────
const MobileResponseRow = ({ response, form, onOpen }) => {
  const isQuiz = form?.type === "quiz" || (response.maxScore || 0) > 0;
  const { primary, secondary, initials } = getRespondentDisplay(response, form);

  return (
    <button
      type="button"
      onClick={() => onOpen(response)}
      className="flex w-full items-center gap-3 border-b border-stone-100 bg-white px-4 py-3 text-left transition-colors active:bg-stone-50 dark:border-stone-800/60 dark:bg-stone-950 dark:active:bg-stone-900"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-semibold text-teal-700 dark:bg-teal-500/20 dark:text-teal-300">
        {initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-stone-800 dark:text-stone-100">
          {primary}
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-stone-400 dark:text-stone-500">
          {secondary ? (
            <>
              <span className="truncate">{secondary}</span>
              <span className="text-stone-300 dark:text-stone-600">·</span>
            </>
          ) : null}
          <span className="shrink-0">{formatRelative(response.submittedAt)}</span>
          {response.durationSeconds ? (
            <>
              <span className="shrink-0 text-stone-300 dark:text-stone-600">·</span>
              <span className="shrink-0">
                {formatDuration(response.durationSeconds)}
              </span>
            </>
          ) : null}
          {isQuiz ? (
            <>
              <span className="shrink-0 text-stone-300 dark:text-stone-600">·</span>
              <span
                className={`shrink-0 font-semibold ${
                  response.passed === true
                    ? "text-emerald-600 dark:text-emerald-400"
                    : response.passed === false
                    ? "text-red-500 dark:text-red-400"
                    : "text-purple-600 dark:text-purple-400"
                }`}
              >
                {response.percentage ?? 0}%
              </span>
            </>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-stone-300 dark:text-stone-600">
        {I.chevRight("h-4 w-4")}
      </span>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────
// Leaderboard row
//
// Uses the exact same name resolution as the responses list, so a
// leaderboard entry with no respondentName/Email but a "Full name"
// or "Email" field answer still shows the person's name — and if
// we only have an email, we derive a friendly name from the local
// part before ever falling back to "Anonymous".
// ─────────────────────────────────────────────────────────────
const LeaderboardRow = ({ entry, form }) => {
  const medal =
    entry.rank === 1
      ? "bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-sm shadow-amber-500/30"
      : entry.rank === 2
      ? "bg-gradient-to-br from-stone-300 to-stone-400 text-white dark:from-stone-500 dark:to-stone-600"
      : entry.rank === 3
      ? "bg-gradient-to-br from-orange-300 to-orange-500 text-white"
      : "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300";

  // Shape the leaderboard entry like a response so we can reuse the
  // exact same resolver as the responses list. `entry.answers` may be
  // undefined on older backends — getRespondentDisplay handles that.
  const { primary, secondary, initials } = getRespondentDisplay(
    {
      respondentName: entry.name,
      respondentEmail: entry.email,
      answers: entry.answers || [],
    },
    form
  );

  return (
    <div className="flex items-center gap-3 border-b border-stone-100 px-4 py-2.5 last:border-b-0 dark:border-stone-800/60">
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${medal}`}
      >
        {entry.rank}
      </span>

      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 text-[11px] font-semibold text-teal-700 dark:bg-teal-500/20 dark:text-teal-300">
        {initials}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-stone-800 dark:text-stone-100">
          {primary}
        </p>
        {secondary ? (
          <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
            {secondary}
          </p>
        ) : null}
      </div>

      <div className="shrink-0 text-right">
        <p className="text-[13px] font-bold text-stone-800 dark:text-stone-100">
          {entry.totalScore}
          <span className="text-[10.5px] font-normal text-stone-400 dark:text-stone-500">
            /{entry.maxScore}
          </span>
        </p>
        <p className="text-[10.5px] font-semibold text-purple-600 dark:text-purple-400">
          {entry.percentage}%
          {entry.passed === true ? " · passed" : ""}
        </p>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
const FormResponses = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const [tab, setTab] = useState("summary");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openResponse, setOpenResponse] = useState(null);
  const [toast, setToast] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const { data: formData, isLoading: formLoading } = useGetFormQuery(id, {
    skip: !id,
  });
  const form = formData?.form;

  const isQuiz = useMemo(
    () =>
      form?.type === "quiz" || form?.fields?.some((f) => f.scoring?.points > 0),
    [form]
  );

  const { data: statsData, isLoading: statsLoading } = useGetFormStatsQuery(id, {
    skip: !id || tab !== "summary",
  });

  const {
    data: responsesData,
    isLoading: responsesLoading,
    isFetching: responsesFetching,
  } = useListResponsesQuery(
    { id, page, limit: 20, q: search },
    { skip: !id || tab !== "responses" }
  );

  const { data: leaderboardData, isLoading: leaderboardLoading } =
    useGetLeaderboardQuery(id, { skip: !id || tab !== "leaderboard" || !isQuiz });

  const [deleteResponse, { isLoading: deleting }] = useDeleteResponseMutation();

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  };

  useEffect(() => {
    setPage(1);
  }, [search]);

  const handleExportCSV = async () => {
    if (!form) return;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ""}/api/forms/${id}/export`,
        {
          headers: {
            Authorization: `Bearer ${
              JSON.parse(localStorage.getItem("userInfo") || "{}")?.token || ""
            }`,
          },
        }
      );
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();
      const csv = toCSV(data.columns, data.rows);
      const safeTitle = (form.title || "form")
        .replace(/[^a-z0-9\-_]+/gi, "_")
        .slice(0, 40);
      downloadBlob(csv, `${safeTitle}-responses.csv`);
      showToast("CSV downloaded.");
    } catch (err) {
      showToast("Couldn't export. Try again.");
    }
  };

  const handleDelete = async (responseId) => {
    try {
      await deleteResponse({ id, responseId }).unwrap();
      setOpenResponse(null);
      setConfirmDeleteId(null);
      showToast("Response deleted.");
    } catch (err) {
      showToast(err?.data?.message || "Couldn't delete response.");
    }
  };

  if (formLoading || !form) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-white dark:bg-stone-950">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-teal-500 dark:border-stone-700 dark:border-t-teal-400" />
          <p className="text-[12px] text-stone-400 dark:text-stone-500">
            Loading responses…
          </p>
        </div>
      </div>
    );
  }

  const totalResponses = statsData?.totalResponses ?? form.responseCount ?? 0;
  const averageDuration = statsData?.averageDurationSeconds || 0;
  const quiz = statsData?.quiz;
  const statusMeta = STATUS_META[form.status] || STATUS_META.draft;

  const TABS = [
    { id: "summary", label: "Summary", icon: I.chart },
    { id: "responses", label: "Responses", icon: I.list },
    ...(isQuiz ? [{ id: "leaderboard", label: "Leaderboard", icon: I.trophy }] : []),
  ];

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-white text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <aside className="hidden shrink-0 flex-col border-r border-stone-200/70 bg-stone-50/50 dark:border-stone-800/70 dark:bg-stone-900/40 md:flex md:w-[280px]">
        <div className="flex h-14 items-center gap-2.5 border-b border-stone-200/70 px-4 dark:border-stone-800/70">
          <button
            type="button"
            onClick={() => navigate("/forms")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
            aria-label="Back"
          >
            {I.arrowLeft("h-4 w-4")}
          </button>
          <Link to="/forms" className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Responses
            </p>
            <p className="truncate text-[10.5px] text-stone-400 dark:text-stone-500">
              Back to forms
            </p>
          </Link>
        </div>

        <div className="px-3 pt-4">
          <div className="rounded-lg border border-stone-200/70 bg-white p-3 dark:border-stone-800 dark:bg-stone-900">
            <h2 className="line-clamp-2 text-[13px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              {form.title || "Untitled form"}
            </h2>
            <div className="mt-2 flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${statusMeta.chip}`}
              >
                <span className={`h-1 w-1 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
              <span className="text-[10.5px] text-stone-400 dark:text-stone-500">
                {form.type}
              </span>
            </div>
          </div>
        </div>

        <div className="px-3 pt-4">
          <p className="px-2.5 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            View
          </p>
          <div className="space-y-0.5">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
                    active
                      ? "bg-teal-50 font-semibold text-teal-700 dark:bg-teal-500/15 dark:text-teal-300"
                      : "text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                  }`}
                >
                  <span
                    className={
                      active
                        ? "text-teal-600 dark:text-teal-400"
                        : "text-stone-400 dark:text-stone-500"
                    }
                  >
                    {t.icon("h-4 w-4")}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex-1" />

        <div className="border-t border-stone-200/70 p-3 dark:border-stone-800/70">
          <p className="mb-2 px-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            At a glance
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-stone-200/70 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Responses
              </p>
              <p className="mt-0.5 text-[16px] font-semibold text-stone-900 dark:text-stone-100">
                {totalResponses}
              </p>
            </div>
            <div className="rounded-lg border border-stone-200/70 bg-white p-2.5 dark:border-stone-800 dark:bg-stone-900">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                Avg time
              </p>
              <p className="mt-0.5 text-[14px] font-semibold text-stone-900 dark:text-stone-100">
                {formatDuration(averageDuration)}
              </p>
            </div>
          </div>
          {isQuiz && quiz ? (
            <div className="mt-2 rounded-lg border border-purple-200/70 bg-purple-50/60 p-2.5 dark:border-purple-500/30 dark:bg-purple-500/10">
              <p className="text-[9.5px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                Quiz avg
              </p>
              <p className="mt-0.5 text-[16px] font-semibold text-purple-700 dark:text-purple-300">
                {quiz.averagePercentage}%
              </p>
              <p className="mt-0.5 text-[10px] text-purple-500 dark:text-purple-400/80">
                {quiz.passedCount} passed
                {quiz.passPercentage > 0 ? ` · ${quiz.passPercentage}% to pass` : ""}
              </p>
            </div>
          ) : null}
        </div>
      </aside>

      <main className="relative flex h-full min-w-0 flex-1 flex-col bg-white dark:bg-stone-950">
        <header
          className="z-20 flex h-14 shrink-0 items-center gap-2 border-b border-stone-200/70 bg-white/90 px-3 backdrop-blur-xl dark:border-stone-800/70 dark:bg-stone-950/90 sm:px-4"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <button
            type="button"
            onClick={() => navigate("/forms")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 md:hidden"
            aria-label="Back"
          >
            {I.back("h-4 w-4")}
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              {form.title || "Untitled form"}
            </h1>
            <p className="hidden truncate text-[11px] text-stone-400 dark:text-stone-500 md:block">
              {totalResponses}{" "}
              {totalResponses === 1 ? "response" : "responses"}
              <span className="mx-1.5 text-stone-300 dark:text-stone-600">·</span>
              {form.type}
            </p>
          </div>

          {tab === "responses" ? (
            <div className="relative hidden md:block">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500">
                {I.search("h-3.5 w-3.5")}
              </span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by email…"
                className="w-56 rounded-md border border-stone-200 bg-stone-50 py-1.5 pl-8 pr-3 text-[12.5px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:bg-white focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:bg-stone-900"
              />
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!totalResponses}
            className="hidden items-center gap-1.5 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10 dark:hover:text-teal-400 sm:flex"
          >
            {I.download("h-3.5 w-3.5")}
            CSV
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!totalResponses}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-100 hover:text-teal-600 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-teal-400 sm:hidden"
            aria-label="Export CSV"
          >
            {I.download("h-4 w-4")}
          </button>

          <button
            type="button"
            onClick={() => navigate(`/forms/${id}/edit`)}
            className="hidden items-center gap-1.5 rounded-md bg-teal-600 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.97] dark:bg-teal-500 dark:hover:bg-teal-400 sm:flex"
          >
            {I.edit("h-3.5 w-3.5")}
            Edit
          </button>
        </header>

        <div className="border-b border-stone-200/70 bg-white dark:border-stone-800/70 dark:bg-stone-950 md:hidden">
          <div className="scrollbar-none flex items-center gap-1 overflow-x-auto px-3 py-2.5">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                    active
                      ? "border-teal-400 bg-teal-50 text-teal-700 dark:border-teal-500/60 dark:bg-teal-500/15 dark:text-teal-300"
                      : "border-stone-200 bg-white text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
                  }`}
                >
                  {t.icon("h-3.5 w-3.5")}
                  {t.label}
                </button>
              );
            })}
          </div>

          {tab === "responses" ? (
            <div className="px-3 pb-2.5">
              <div className="relative">
                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 dark:text-stone-500">
                  {I.search("h-3.5 w-3.5")}
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by email…"
                  className="w-full rounded-md border border-stone-200 bg-stone-50 py-2 pl-8 pr-3 text-[13px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-teal-400 focus:bg-white focus:ring-4 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100 dark:placeholder:text-stone-500"
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto">
          {tab === "summary" ? (
            <div className="mx-auto max-w-5xl p-3 sm:p-5">
              {statsLoading ? (
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-24 animate-pulse rounded-lg border border-stone-200/80 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/60"
                    />
                  ))}
                </div>
              ) : totalResponses === 0 ? (
                <EmptyResponses status={form.status} />
              ) : (
                <>
                  <div className="mb-5 grid grid-cols-2 gap-2.5 md:grid-cols-4 md:gap-3">
                    <div className="rounded-lg border border-stone-200/80 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900">
                      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                        Responses
                      </p>
                      <p className="mt-1 text-[22px] font-bold tracking-tight text-stone-900 dark:text-stone-100">
                        {totalResponses}
                      </p>
                    </div>

                    <div className="rounded-lg border border-stone-200/80 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900">
                      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                        Avg time
                      </p>
                      <p className="mt-1 text-[20px] font-bold tracking-tight text-stone-900 dark:text-stone-100">
                        {formatDuration(averageDuration)}
                      </p>
                    </div>

                    {isQuiz && quiz ? (
                      <>
                        <div className="rounded-lg border border-purple-200/70 bg-purple-50/40 p-3.5 dark:border-purple-500/30 dark:bg-purple-500/10">
                          <p className="text-[9.5px] font-semibold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                            Avg score
                          </p>
                          <p className="mt-1 text-[22px] font-bold tracking-tight text-purple-700 dark:text-purple-300">
                            {quiz.averagePercentage}%
                          </p>
                          <p className="mt-0.5 text-[10px] text-purple-500 dark:text-purple-400/80">
                            {quiz.averageScore} / {quiz.maxScore} pts
                          </p>
                        </div>
                        <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/40 p-3.5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                          <p className="text-[9.5px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                            Passed
                          </p>
                          <p className="mt-1 text-[22px] font-bold tracking-tight text-emerald-700 dark:text-emerald-300">
                            {quiz.passedCount}
                          </p>
                          {quiz.passPercentage > 0 ? (
                            <p className="mt-0.5 text-[10px] text-emerald-600 dark:text-emerald-400/80">
                              {quiz.passPercentage}% to pass
                            </p>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="rounded-lg border border-stone-200/80 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900">
                          <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                            Fields
                          </p>
                          <p className="mt-1 text-[22px] font-bold tracking-tight text-stone-900 dark:text-stone-100">
                            {(form.fields || []).filter(
                              (f) => f.type !== "section"
                            ).length}
                          </p>
                        </div>
                        <div className="rounded-lg border border-stone-200/80 bg-white p-3.5 dark:border-stone-800 dark:bg-stone-900">
                          <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                            Type
                          </p>
                          <p className="mt-1 text-[16px] font-bold capitalize tracking-tight text-stone-900 dark:text-stone-100">
                            {form.type}
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {(form.fields || []).map((field) => (
                      <FieldStats
                        key={field.id}
                        field={field}
                        stats={(statsData?.fields || []).find(
                          (s) => s.fieldId === field.id
                        )}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}

          {tab === "responses" ? (
            <div>
              <div className="hidden border-b border-stone-200/80 bg-stone-50/60 px-4 py-2 dark:border-stone-800/70 dark:bg-stone-900/40 md:grid md:grid-cols-[auto_1fr_auto_auto_auto_auto] md:items-center md:gap-4">
                <span className="w-8" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  Respondent
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  When
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  Duration
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  {isQuiz ? "Score" : ""}
                </span>
                <span className="w-4" />
              </div>

              {responsesLoading ? (
                <div>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 border-b border-stone-100 px-4 py-3 dark:border-stone-800/60"
                    >
                      <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-stone-100 dark:bg-stone-800/60" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="h-3 w-2/3 animate-pulse rounded bg-stone-100 dark:bg-stone-800/60" />
                        <div className="h-2.5 w-1/3 animate-pulse rounded bg-stone-100 dark:bg-stone-800/60" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : !responsesData?.responses?.length ? (
                search ? (
                  <div className="py-14 text-center">
                    <p className="text-[13px] font-semibold text-stone-700 dark:text-stone-200">
                      No responses match "{search}"
                    </p>
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="mt-2 text-[12px] font-semibold text-teal-600 hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  <EmptyResponses status={form.status} />
                )
              ) : (
                <>
                  <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2 dark:border-stone-800/60">
                    <p className="text-[11px] text-stone-400 dark:text-stone-500">
                      Showing{" "}
                      <span className="font-semibold text-stone-600 dark:text-stone-300">
                        {responsesData.responses.length}
                      </span>{" "}
                      of {responsesData.total}
                    </p>
                    {responsesFetching ? (
                      <span className="text-[10.5px] text-stone-400 dark:text-stone-500">
                        Updating…
                      </span>
                    ) : null}
                  </div>

                  <div className="hidden md:block">
                    {responsesData.responses.map((r) => (
                      <DesktopResponseRow
                        key={r._id}
                        response={r}
                        form={form}
                        onOpen={setOpenResponse}
                      />
                    ))}
                  </div>

                  <div className="md:hidden">
                    {responsesData.responses.map((r) => (
                      <MobileResponseRow
                        key={r._id}
                        response={r}
                        form={form}
                        onOpen={setOpenResponse}
                      />
                    ))}
                  </div>

                  {responsesData.pages > 1 ? (
                    <div className="flex items-center justify-center gap-2 border-t border-stone-100 px-4 py-3 dark:border-stone-800/60">
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="rounded-md border border-stone-200 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-stone-600 transition-colors hover:border-teal-300 hover:text-teal-700 disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-teal-500/50 dark:hover:text-teal-400"
                      >
                        Previous
                      </button>
                      <span className="text-[11.5px] text-stone-400 dark:text-stone-500">
                        Page {page} of {responsesData.pages}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPage((p) => Math.min(responsesData.pages, p + 1))
                        }
                        disabled={page === responsesData.pages}
                        className="rounded-md border border-stone-200 bg-white px-3.5 py-1.5 text-[12px] font-semibold text-stone-600 transition-colors hover:border-teal-300 hover:text-teal-700 disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-stone-600 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-teal-500/50 dark:hover:text-teal-400"
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {tab === "leaderboard" && isQuiz ? (
            <div className="mx-auto max-w-4xl p-3 sm:p-5">
              {leaderboardLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-14 animate-pulse rounded-lg border border-stone-200/80 bg-stone-50 dark:border-stone-800 dark:bg-stone-900/60"
                    />
                  ))}
                </div>
              ) : !leaderboardData?.leaderboard?.length ? (
                <EmptyResponses status={form.status} />
              ) : (
                <>
                  <div className="mb-3 rounded-lg border border-purple-200/70 bg-purple-50/50 p-3.5 dark:border-purple-500/30 dark:bg-purple-500/10">
                    <div className="flex items-center gap-2">
                      <span className="text-purple-500 dark:text-purple-400">
                        {I.trophy("h-4 w-4")}
                      </span>
                      <p className="text-[12.5px] font-semibold text-purple-800 dark:text-purple-200">
                        Top {Math.min(leaderboardData.leaderboard.length, 200)}{" "}
                        scores
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] text-purple-700/80 dark:text-purple-400/80">
                      Sorted by total score, earliest submission breaks ties.
                    </p>
                  </div>

                  <div className="overflow-hidden rounded-lg border border-stone-200/80 bg-white dark:border-stone-800 dark:bg-stone-900">
                    {leaderboardData.leaderboard.map((entry) => (
                      <LeaderboardRow
                        key={entry.rank}
                        entry={entry}
                        form={form}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          ) : null}
        </div>
      </main>

      <ResponseDetailModal
        response={openResponse}
        form={form}
        onClose={() => setOpenResponse(null)}
        onDelete={(rid) => setConfirmDeleteId(rid)}
        deleting={deleting}
      />

      {confirmDeleteId ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/50 px-4 backdrop-blur-[3px] dark:bg-black/60">
          <div
            className="absolute inset-0"
            onClick={() => setConfirmDeleteId(null)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl dark:bg-stone-900">
            <h3 className="text-[15px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
              Delete this response?
            </h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
              This can't be undone. The stats will update immediately.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
                className="rounded-md px-3.5 py-2 text-[12.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleting}
                className="rounded-md bg-red-600 px-4 py-2 text-[12.5px] font-semibold text-white shadow-sm shadow-red-500/25 transition-all hover:bg-red-700 active:scale-[0.98] disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-400"
              >
                {deleting ? "Deleting…" : "Delete"}
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

export default FormResponses;