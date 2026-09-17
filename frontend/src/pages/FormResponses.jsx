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

const stripHtmlToText = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.map(stripHtmlToText).join(", ");
  return String(v);
};

// Convert export payload to CSV text (client-side, no dependency).
const toCSV = (columns, rows) => {
  const esc = (val) => {
    if (val === null || val === undefined) return "";
    let s = Array.isArray(val) ? val.join("; ") : String(val);
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
        <span className="min-w-0 truncate text-[12px] text-stone-700">{label}</span>
      </div>
      <div className="shrink-0 text-[11.5px] font-semibold text-stone-700">
        {count}
        <span className="ml-1.5 font-normal text-stone-400">
          {percentage}%
        </span>
      </div>
    </div>
    <div className="h-2 overflow-hidden rounded-full bg-stone-100">
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          correct ? "bg-emerald-500" : "bg-gradient-to-r from-orange-400 to-orange-500"
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
      <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/50 px-4 py-3">
        <p className="text-[13px] font-semibold text-stone-600">{field.label}</p>
        <p className="mt-0.5 text-[10.5px] uppercase tracking-wider text-stone-400">
          Section header
        </p>
      </div>
    );
  }

  const answered = stats?.answered ?? 0;
  const skipped = stats?.skipped ?? 0;

  return (
    <div className="rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-sm shadow-stone-900/[0.02] sm:p-4">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-[13.5px] font-semibold tracking-tight text-stone-900">
            {field.label}
          </p>
          <p className="mt-0.5 text-[10.5px] uppercase tracking-wider text-stone-400">
            {answered} {answered === 1 ? "response" : "responses"}
            {skipped > 0 ? ` · ${skipped} skipped` : ""}
          </p>
        </div>
      </div>

      {/* Choice types */}
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

      {/* Yes / No */}
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

      {/* Numeric */}
      {["number", "rating", "scale"].includes(field.type) && stats ? (
        <div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-stone-50 px-3 py-2.5">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400">
                Min
              </p>
              <p className="mt-0.5 text-[15px] font-semibold text-stone-800">
                {stats.min ?? "—"}
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 px-3 py-2.5">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400">
                Avg
              </p>
              <p className="mt-0.5 text-[15px] font-semibold text-orange-600">
                {stats.avg ?? "—"}
              </p>
            </div>
            <div className="rounded-xl bg-stone-50 px-3 py-2.5">
              <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400">
                Max
              </p>
              <p className="mt-0.5 text-[15px] font-semibold text-stone-800">
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

      {/* Date */}
      {field.type === "date" && stats ? (
        <div className="space-y-1.5 text-[12px] text-stone-600">
          {stats.earliest ? (
            <p>
              <span className="text-stone-400">Earliest:</span>{" "}
              {formatDateTime(stats.earliest)}
            </p>
          ) : null}
          {stats.latest ? (
            <p>
              <span className="text-stone-400">Latest:</span>{" "}
              {formatDateTime(stats.latest)}
            </p>
          ) : null}
          {!stats.earliest && !stats.latest ? (
            <p className="text-stone-400">No answers yet.</p>
          ) : null}
        </div>
      ) : null}

      {/* Text-ish samples */}
      {["short_text", "long_text", "email", "phone", "url", "time", "file"].includes(
        field.type
      ) && stats ? (
        <div>
          {stats.correctRate !== null && stats.correctRate !== undefined ? (
            <p className="mb-2 text-[11.5px] font-semibold text-emerald-600">
              {stats.correctRate}% got this right
            </p>
          ) : null}
          {stats.samples?.length ? (
            <div className="space-y-1.5">
              {stats.samples.slice(0, 12).map((s, i) => (
                <div
                  key={i}
                  className="rounded-xl bg-stone-50/80 px-3 py-2 text-[12px] leading-snug text-stone-700"
                >
                  {stripHtmlToText(s) || (
                    <span className="text-stone-400">(empty)</span>
                  )}
                </div>
              ))}
              {stats.samples.length > 12 ? (
                <p className="pt-1 text-center text-[10.5px] text-stone-400">
                  Showing 12 of {stats.samples.length} responses · open the
                  responses tab to see them all
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[12px] text-stone-400">No answers yet.</p>
          )}
        </div>
      ) : null}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Empty states
// ─────────────────────────────────────────────────────────────
const EmptyResponses = ({ status }) => (
  <div className="flex flex-col items-center px-4 py-14 text-center">
    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        className="h-7 w-7 text-orange-500"
      >
        <path d="M3 5h18v14H3zM3 9h18M8 13h8M8 17h5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
    <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-stone-900">
      No responses yet
    </h3>
    <p className="mt-1.5 max-w-xs text-[12.5px] leading-relaxed text-stone-500">
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

  return (
    <div className="fixed inset-0 z-[75] flex items-end justify-center bg-stone-900/40 backdrop-blur-[3px] sm:items-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
        {/* Header */}
        <div
          className="flex items-start justify-between gap-3 border-b border-stone-100 px-4 pb-3 sm:px-5"
          style={{ paddingTop: "max(env(safe-area-inset-top), 1rem)" }}
        >
          <div className="min-w-0">
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-stone-400">
              Response
            </p>
            <h2 className="mt-0.5 truncate text-[15px] font-semibold tracking-tight text-stone-900">
              {response.respondentName ||
                response.respondentEmail ||
                "Anonymous"}
            </h2>
            {response.respondentName && response.respondentEmail ? (
              <p className="mt-0.5 truncate text-[11.5px] text-stone-400">
                {response.respondentEmail}
              </p>
            ) : null}
            <p className="mt-1 text-[10.5px] text-stone-400">
              {formatDateTime(response.submittedAt)}
              {response.durationSeconds ? ` · ${formatDuration(response.durationSeconds)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            aria-label="Close"
          >
            {I.close("h-4 w-4")}
          </button>
        </div>

        {/* Quiz score panel */}
        {isQuiz ? (
          <div className="border-b border-stone-100 bg-purple-50/40 px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-purple-100">
                <span className="text-[16px] font-bold text-purple-700">
                  {response.percentage ?? 0}%
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-purple-900">
                  {response.totalScore} / {response.maxScore} points
                </p>
                {response.passed !== null && response.passed !== undefined ? (
                  <p
                    className={`mt-0.5 inline-flex items-center gap-1 text-[11px] font-semibold ${
                      response.passed ? "text-emerald-600" : "text-red-500"
                    }`}
                  >
                    {response.passed ? "Passed" : "Failed"}
                  </p>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {/* Body */}
        <div className="scrollbar-thin flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="space-y-3">
            {(form.fields || []).map((field) => {
              if (field.type === "section") {
                return (
                  <div
                    key={field.id}
                    className="rounded-xl border border-dashed border-stone-300 bg-stone-50/50 px-3 py-2"
                  >
                    <p className="text-[12px] font-semibold text-stone-600">
                      {field.label}
                    </p>
                  </div>
                );
              }

              const a = answerMap.get(field.id);
              const value = a?.value;
              const correct = a?.correct;

              return (
                <div key={field.id}>
                  <div className="mb-1 flex items-center gap-1.5">
                    <p className="min-w-0 flex-1 text-[11.5px] font-semibold text-stone-600">
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
                  <div className="rounded-xl bg-stone-50 px-3 py-2.5 text-[12.5px] leading-relaxed text-stone-800">
                    {value === null || value === undefined || value === "" ? (
                      <span className="italic text-stone-400">No answer</span>
                    ) : field.type === "url" || field.type === "file" ? (
                      <a
                        href={String(value)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-orange-600 underline decoration-orange-300 underline-offset-2 hover:text-orange-700"
                      >
                        {String(value)}
                      </a>
                    ) : Array.isArray(value) ? (
                      <div className="flex flex-wrap gap-1.5">
                        {value.map((v, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-white px-2 py-0.5 text-[11.5px] font-medium text-stone-700 ring-1 ring-stone-200"
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
                    <p className="mt-1 text-[10.5px] text-purple-600">
                      {a.score} / {field.scoring.points} points
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between gap-2 border-t border-stone-100 px-4 pt-3 sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.875rem)" }}
        >
          <button
            type="button"
            onClick={() => onDelete(response._id)}
            disabled={deleting}
            className="flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-40"
          >
            {I.trash("h-3.5 w-3.5")}
            Delete
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-stone-900 px-4 py-2 text-[12.5px] font-semibold text-white hover:bg-stone-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Response row
// ─────────────────────────────────────────────────────────────
const ResponseRow = ({ response, form, onOpen }) => {
  const isQuiz = form?.type === "quiz" || (response.maxScore || 0) > 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(response)}
      className="group flex w-full items-center gap-3 rounded-2xl border border-stone-200/80 bg-white px-3.5 py-3 text-left shadow-sm shadow-stone-900/[0.02] transition-all duration-150 hover:border-orange-200 hover:shadow-md"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-100 text-[12px] font-semibold text-orange-700">
        {(
          response.respondentName ||
          response.respondentEmail ||
          "?"
        )
          .charAt(0)
          .toUpperCase()}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-stone-800">
          {response.respondentName ||
            response.respondentEmail ||
            "Anonymous"}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-stone-400">
          <span>{formatRelative(response.submittedAt)}</span>
          {response.durationSeconds ? (
            <>
              <span className="text-stone-300">·</span>
              <span className="inline-flex items-center gap-1">
                {I.clock("h-3 w-3")}
                {formatDuration(response.durationSeconds)}
              </span>
            </>
          ) : null}
          {isQuiz ? (
            <>
              <span className="text-stone-300">·</span>
              <span
                className={`font-semibold ${
                  response.passed === true
                    ? "text-emerald-600"
                    : response.passed === false
                    ? "text-red-500"
                    : "text-purple-600"
                }`}
              >
                {response.percentage ?? 0}%
              </span>
            </>
          ) : null}
        </div>
      </div>

      <span className="shrink-0 text-stone-300 transition-transform group-hover:translate-x-0.5 group-hover:text-orange-500">
        {I.chevRight("h-4 w-4")}
      </span>
    </button>
  );
};

// ─────────────────────────────────────────────────────────────
// Leaderboard row
// ─────────────────────────────────────────────────────────────
const LeaderboardRow = ({ entry }) => {
  const medal =
    entry.rank === 1
      ? "bg-gradient-to-br from-amber-300 to-amber-500 text-white shadow-sm shadow-amber-500/30"
      : entry.rank === 2
      ? "bg-gradient-to-br from-stone-300 to-stone-400 text-white"
      : entry.rank === 3
      ? "bg-gradient-to-br from-orange-300 to-orange-500 text-white"
      : "bg-stone-100 text-stone-600";

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-stone-200/80 bg-white px-3.5 py-3 shadow-sm shadow-stone-900/[0.02]">
      <span
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${medal}`}
      >
        {entry.rank}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-stone-800">
          {entry.name || entry.email || "Anonymous"}
        </p>
        {entry.name && entry.email ? (
          <p className="truncate text-[10.5px] text-stone-400">{entry.email}</p>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[13px] font-bold text-stone-800">
          {entry.totalScore}
          <span className="text-[10.5px] font-normal text-stone-400">
            /{entry.maxScore}
          </span>
        </p>
        <p className="text-[10.5px] font-semibold text-purple-600">
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

  const [tab, setTab] = useState("summary"); // summary | responses | leaderboard
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

  const {
    data: statsData,
    isLoading: statsLoading,
  } = useGetFormStatsQuery(id, { skip: !id || tab !== "summary" });

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

  // Reset paging on search change
  useEffect(() => {
    setPage(1);
  }, [search]);

  // ─── Export ─────────────────────────────────────────────────
  const handleExportCSV = async () => {
    if (!form) return;
    try {
      const res = await fetch(
        `${import.meta.env.VITE_API_URL || ""}/api/forms/${id}/export`,
        {
          headers: {
            Authorization: `Bearer ${JSON.parse(
              localStorage.getItem("userInfo") || "{}"
            )?.token || ""}`,
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

  // ─── Loading ────────────────────────────────────────────────
  if (formLoading || !form) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-[#f7f5f0]">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-stone-300 border-t-orange-500" />
          <p className="text-[12px] text-stone-400">Loading responses…</p>
        </div>
      </div>
    );
  }

  const totalResponses = statsData?.totalResponses ?? form.responseCount ?? 0;
  const averageDuration = statsData?.averageDurationSeconds || 0;
  const quiz = statsData?.quiz;

  const statusMeta = {
    draft: { label: "Draft", dot: "bg-stone-400", text: "text-stone-500" },
    open: { label: "Open", dot: "bg-emerald-500", text: "text-emerald-600" },
    closed: { label: "Closed", dot: "bg-red-400", text: "text-red-500" },
  }[form.status] || { label: "Draft", dot: "bg-stone-400", text: "text-stone-500" };

  return (
    <div className="flex min-h-dvh w-full flex-col bg-[#f7f5f0] text-stone-900 antialiased">
      {/* ─── Header ──────────────────────────────────────── */}
      <header
        className="sticky top-0 z-30 border-b border-stone-200/70 bg-white/85 backdrop-blur-xl"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-2.5 py-2.5 sm:gap-3 sm:px-6 sm:py-3.5">
          <button
            type="button"
            onClick={() => navigate("/forms")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
            aria-label="Back"
          >
            {I.back("h-4 w-4")}
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[14px] font-semibold tracking-tight text-stone-900 sm:text-base">
              {form.title || "Untitled form"}
            </h1>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold ${statusMeta.text}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`} />
                {statusMeta.label}
              </span>
              <span className="text-[10px] text-stone-300">·</span>
              <span className="text-[10px] text-stone-400">
                {totalResponses}{" "}
                {totalResponses === 1 ? "response" : "responses"}
              </span>
            </div>
          </div>

          {/* Actions */}
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!totalResponses}
            className="hidden h-9 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 text-[12px] font-semibold text-stone-600 transition-colors hover:border-orange-300 hover:bg-orange-50 hover:text-orange-700 disabled:opacity-40 sm:flex"
          >
            {I.download("h-3.5 w-3.5")}
            Export CSV
          </button>
          <button
            type="button"
            onClick={handleExportCSV}
            disabled={!totalResponses}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-stone-500 transition-colors hover:bg-stone-100 hover:text-orange-600 disabled:opacity-40 sm:hidden"
            aria-label="Export CSV"
          >
            {I.download("h-4 w-4")}
          </button>

          <button
            type="button"
            onClick={() => navigate(`/forms/${id}/edit`)}
            className="hidden h-9 items-center gap-1.5 rounded-full bg-stone-900 px-3.5 text-[12px] font-semibold text-white transition-colors hover:bg-stone-800 sm:flex"
          >
            Edit form
          </button>
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-5xl px-2.5 pb-2.5 sm:px-6 sm:pb-3.5">
          <div className="flex items-center gap-1 overflow-x-auto rounded-full bg-stone-100/80 p-1 scrollbar-none">
            {[
              { id: "summary", label: "Summary", icon: I.chart },
              { id: "responses", label: "Responses", icon: I.list },
              ...(isQuiz
                ? [{ id: "leaderboard", label: "Leaderboard", icon: I.trophy }]
                : []),
            ].map((t) => {
              const active = tab === t.id;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`flex flex-1 shrink-0 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
                    active
                      ? "bg-white text-orange-600 shadow-sm ring-1 ring-stone-900/5"
                      : "text-stone-500 hover:text-stone-800"
                  }`}
                >
                  {Icon("h-3.5 w-3.5")}
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* ─── Body ────────────────────────────────────────── */}
      <main className="min-h-0 flex-1">
        <div className="mx-auto max-w-5xl px-2.5 pb-12 pt-4 sm:px-6 sm:pb-16 sm:pt-6">
          {/* ─── SUMMARY TAB ─────────────────────────── */}
          {tab === "summary" ? (
            <>
              {statsLoading ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-24 animate-pulse rounded-2xl bg-white/70 shadow-sm"
                    />
                  ))}
                </div>
              ) : totalResponses === 0 ? (
                <EmptyResponses status={form.status} />
              ) : (
                <>
                  {/* Stat cards */}
                  <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
                    <div className="rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-sm shadow-stone-900/[0.02]">
                      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400">
                        Responses
                      </p>
                      <p className="mt-1 text-[22px] font-bold tracking-tight text-stone-900">
                        {totalResponses}
                      </p>
                    </div>

                    <div className="rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-sm shadow-stone-900/[0.02]">
                      <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400">
                        Avg time
                      </p>
                      <p className="mt-1 text-[22px] font-bold tracking-tight text-stone-900">
                        {formatDuration(averageDuration)}
                      </p>
                    </div>

                    {isQuiz && quiz ? (
                      <>
                        <div className="rounded-2xl border border-purple-200/70 bg-purple-50/40 p-3.5 shadow-sm shadow-purple-900/[0.02]">
                          <p className="text-[9.5px] font-semibold uppercase tracking-wider text-purple-600">
                            Avg score
                          </p>
                          <p className="mt-1 text-[22px] font-bold tracking-tight text-purple-700">
                            {quiz.averagePercentage}%
                          </p>
                          <p className="mt-0.5 text-[10px] text-purple-500">
                            {quiz.averageScore} / {quiz.maxScore} pts
                          </p>
                        </div>
                        <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/40 p-3.5 shadow-sm shadow-emerald-900/[0.02]">
                          <p className="text-[9.5px] font-semibold uppercase tracking-wider text-emerald-600">
                            Passed
                          </p>
                          <p className="mt-1 text-[22px] font-bold tracking-tight text-emerald-700">
                            {quiz.passedCount}
                          </p>
                          {quiz.passPercentage > 0 ? (
                            <p className="mt-0.5 text-[10px] text-emerald-600">
                              {quiz.passPercentage}% to pass
                            </p>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-sm shadow-stone-900/[0.02]">
                          <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400">
                            Fields
                          </p>
                          <p className="mt-1 text-[22px] font-bold tracking-tight text-stone-900">
                            {(form.fields || []).filter((f) => f.type !== "section").length}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-stone-200/80 bg-white p-3.5 shadow-sm shadow-stone-900/[0.02]">
                          <p className="text-[9.5px] font-semibold uppercase tracking-wider text-stone-400">
                            Type
                          </p>
                          <p className="mt-1 text-[16px] font-bold capitalize tracking-tight text-stone-900">
                            {form.type}
                          </p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Per-field stats */}
                  <div className="space-y-3">
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
            </>
          ) : null}

          {/* ─── RESPONSES TAB ───────────────────────── */}
          {tab === "responses" ? (
            <>
              {/* Search */}
              <div className="relative mb-3">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-stone-400">
                  {I.search("h-4 w-4")}
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by email…"
                  className="w-full rounded-full border border-stone-200/80 bg-white py-2.5 pl-10 pr-3 text-[13px] text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-orange-400 focus:ring-4 focus:ring-orange-500/10"
                />
              </div>

              {responsesLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-16 animate-pulse rounded-2xl bg-white/70 shadow-sm"
                    />
                  ))}
                </div>
              ) : !responsesData?.responses?.length ? (
                search ? (
                  <div className="py-14 text-center">
                    <p className="text-[13px] font-semibold text-stone-700">
                      No responses match "{search}"
                    </p>
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="mt-2 text-[12px] font-semibold text-orange-600 hover:text-orange-700"
                    >
                      Clear search
                    </button>
                  </div>
                ) : (
                  <EmptyResponses status={form.status} />
                )
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between px-1">
                    <p className="text-[11px] text-stone-400">
                      Showing{" "}
                      <span className="font-semibold text-stone-600">
                        {responsesData.responses.length}
                      </span>{" "}
                      of {responsesData.total}
                    </p>
                    {responsesFetching ? (
                      <span className="text-[10.5px] text-stone-400">
                        Updating…
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    {responsesData.responses.map((r) => (
                      <ResponseRow
                        key={r._id}
                        response={r}
                        form={form}
                        onOpen={setOpenResponse}
                      />
                    ))}
                  </div>

                  {/* Pagination */}
                  {responsesData.pages > 1 ? (
                    <div className="mt-5 flex items-center justify-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="rounded-full border border-stone-200 bg-white px-4 py-2 text-[12px] font-semibold text-stone-600 transition-colors hover:border-orange-300 hover:text-orange-700 disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-stone-600"
                      >
                        Previous
                      </button>
                      <span className="text-[11.5px] text-stone-400">
                        Page {page} of {responsesData.pages}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setPage((p) => Math.min(responsesData.pages, p + 1))
                        }
                        disabled={page === responsesData.pages}
                        className="rounded-full border border-stone-200 bg-white px-4 py-2 text-[12px] font-semibold text-stone-600 transition-colors hover:border-orange-300 hover:text-orange-700 disabled:opacity-40 disabled:hover:border-stone-200 disabled:hover:text-stone-600"
                      >
                        Next
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : null}

          {/* ─── LEADERBOARD TAB ─────────────────────── */}
          {tab === "leaderboard" && isQuiz ? (
            <>
              {leaderboardLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="h-16 animate-pulse rounded-2xl bg-white/70 shadow-sm"
                    />
                  ))}
                </div>
              ) : !leaderboardData?.leaderboard?.length ? (
                <EmptyResponses status={form.status} />
              ) : (
                <>
                  <div className="mb-3 rounded-2xl border border-purple-200/70 bg-purple-50/50 p-3.5">
                    <div className="flex items-center gap-2">
                      <span className="text-purple-500">
                        {I.trophy("h-4 w-4")}
                      </span>
                      <p className="text-[12.5px] font-semibold text-purple-800">
                        Top {Math.min(leaderboardData.leaderboard.length, 200)} scores
                      </p>
                    </div>
                    <p className="mt-1 text-[11px] text-purple-700/80">
                      Sorted by total score, earliest submission breaks ties.
                    </p>
                  </div>

                  <div className="space-y-2">
                    {leaderboardData.leaderboard.map((entry) => (
                      <LeaderboardRow key={entry.rank} entry={entry} />
                    ))}
                  </div>
                </>
              )}
            </>
          ) : null}
        </div>
      </main>

      {/* ─── Response detail modal ─────────────────────── */}
      <ResponseDetailModal
        response={openResponse}
        form={form}
        onClose={() => setOpenResponse(null)}
        onDelete={(rid) => setConfirmDeleteId(rid)}
        deleting={deleting}
      />

      {/* ─── Confirm delete ──────────────────────────── */}
      {confirmDeleteId ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-stone-900/40 px-4 backdrop-blur-[3px]">
          <div
            className="absolute inset-0"
            onClick={() => setConfirmDeleteId(null)}
            aria-hidden
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <h3 className="text-[15px] font-semibold tracking-tight text-stone-900">
              Delete this response?
            </h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-stone-500">
              This can't be undone. The stats will update immediately.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                disabled={deleting}
                className="rounded-full px-4 py-2 text-[12.5px] font-semibold text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleting}
                className="rounded-full bg-red-500 px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-md shadow-red-500/25 transition-all hover:bg-red-600 active:scale-95 disabled:opacity-60"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Toast ───────────────────────────────────── */}
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

export default FormResponses;