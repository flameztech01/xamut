// pages/ClipViewer.jsx
import { Link, useNavigate, useParams } from "react-router";
import { useGetClipJobQuery } from "../features/aiApiSlice";

// ─────────────────────────────────────────────────────────────
// Stage metadata — used for the progress UI and header copy
// ─────────────────────────────────────────────────────────────
const STAGES = [
  { id: "downloading", label: "Downloading video" },
  { id: "transcribing", label: "Transcribing audio" },
  { id: "analyzing", label: "Scanning for highlights" },
  { id: "clipping", label: "Cutting clips" },
];

const STATUS_LABEL = {
  queued: "Queued",
  downloading: "Downloading",
  transcribing: "Transcribing",
  analyzing: "Scanning",
  clipping: "Cutting clips",
  ready: "Ready",
  failed: "Failed",
};

const formatDuration = (secs) => {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────
const ClipViewer = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useGetClipJobQuery(id, {
    pollingInterval: 4000,
  });

  const job = data?.result;
  const inProgress =
    job && !["ready", "failed"].includes(job.status);

  // ─── Loading ─────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-100">
        <div className="flex items-center gap-3 text-stone-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-orange-500" />
          Loading clip job…
        </div>
      </div>
    );
  }

  // ─── Error / not found ───────────────────────────────────
  if (error || !job) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-stone-100 px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-6 w-6"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
          </svg>
        </div>
        <p className="text-lg font-semibold text-stone-800">
          Clip job not found
        </p>
        <p className="max-w-sm text-sm text-stone-500">
          It may have been deleted, or the link is incorrect.
        </p>
        <Link
          to="/clips"
          className="rounded-full bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-500/25 hover:bg-orange-600"
        >
          Back to clips
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-stone-100 text-stone-900">
      {/* ─── Header ─────────────────────────────────────── */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-stone-200 bg-white px-3 sm:px-5">
        <button
          onClick={() => navigate(-1)}
          className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900"
          aria-label="Back"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4"
          >
            <path
              d="M19 12H5M12 19l-7-7 7-7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-purple-700">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-2.5 w-2.5"
              >
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M10 9l5 3-5 3V9z" fill="currentColor" />
              </svg>
              Clips · Groq
            </span>
            <h1 className="truncate text-sm font-semibold text-stone-900">
              {job.sourceTitle || "Video clips"}
            </h1>
          </div>
          <p className="truncate text-[11px] text-stone-400">
            {STATUS_LABEL[job.status] || job.status} ·{" "}
            {job.clips?.length || 0} / {job.requestedClips} clips
          </p>
        </div>

        <a
          href={job.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:border-orange-300 hover:text-orange-600 sm:block"
        >
          Open source
        </a>
      </header>

      {/* ─── Body ───────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-8">
        <div className="mx-auto w-full max-w-5xl">
          {/* In-progress */}
          {inProgress && <ProcessingPanel job={job} />}

          {/* Failed */}
          {job.status === "failed" && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-100 text-red-600">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-6 w-6"
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 8v4M12 16h.01" strokeLinecap="round" />
                </svg>
              </div>
              <p className="mt-4 text-lg font-semibold text-red-800">
                Clipping failed
              </p>
              <p className="mt-2 text-sm text-red-600">
                {job.failureReason || "Something went wrong."}
              </p>
              <Link
                to="/chat"
                className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-500/25 hover:bg-orange-600"
              >
                Try a different video
              </Link>
            </div>
          )}

          {/* Ready */}
          {job.status === "ready" && (
            <>
              {/* Summary */}
              {job.summary && (
                <div className="mb-6 rounded-2xl border border-stone-200 bg-white p-5">
                  <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      className="h-3 w-3"
                    >
                      <path
                        d="M12 2l2.6 6.6L21 9.6l-4.8 4.7L17.4 21 12 17.8 6.6 21l1.2-6.7L3 9.6l6.4-1L12 2z"
                        strokeLinejoin="round"
                      />
                    </svg>
                    Editor's note
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-700">
                    {job.summary}
                  </p>
                </div>
              )}

              {/* Clips grid */}
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                  Your clips
                </h2>
                <span className="text-[11px] text-stone-400">
                  {job.clips.length}{" "}
                  {job.clips.length === 1 ? "clip" : "clips"}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {job.clips.map((clip, i) => (
                  <ClipCard key={i} clip={clip} index={i} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Processing panel — a nice stepped progress indicator
// ─────────────────────────────────────────────────────────────
const ProcessingPanel = ({ job }) => {
  const currentIndex = STAGES.findIndex((s) => s.id === job.status);

  return (
    <div className="flex flex-col items-center py-12 text-center sm:py-20">
      {/* Spinner */}
      <div className="relative flex h-20 w-20 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-4 border-stone-200 border-t-orange-500" />
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-8 w-8 text-orange-500"
        >
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <path d="M10 9l5 3-5 3V9z" fill="currentColor" />
        </svg>
      </div>

      <p className="mt-6 text-xl font-semibold tracking-tight text-stone-900">
        {STATUS_LABEL[job.status] || "Working"}…
      </p>
      <p className="mt-2 max-w-md text-sm text-stone-500">
        Whisper transcribes the audio first, then Llama scans for the best
        moments. Bigger videos take longer — usually 1 to 5 minutes.
      </p>

      {/* Stepped progress */}
      <div className="mt-10 flex w-full max-w-lg flex-col gap-2 sm:gap-3">
        {STAGES.map((stage, i) => {
          const done = currentIndex > i;
          const active = currentIndex === i;
          return (
            <div
              key={stage.id}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors ${
                active
                  ? "border-orange-200 bg-orange-50/70"
                  : done
                    ? "border-emerald-200 bg-emerald-50/50"
                    : "border-stone-200 bg-white"
              }`}
            >
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-orange-500 text-white"
                      : "bg-stone-100 text-stone-400"
                }`}
              >
                {done ? (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
                  </svg>
                ) : active ? (
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : (
                  i + 1
                )}
              </span>
              <span
                className={`text-sm font-medium ${
                  active
                    ? "text-orange-900"
                    : done
                      ? "text-emerald-800"
                      : "text-stone-500"
                }`}
              >
                {stage.label}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-8 text-xs text-stone-400">
        This page refreshes automatically.
      </p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Clip card — video player + download
// ─────────────────────────────────────────────────────────────
const ClipCard = ({ clip, index }) => {
  const score = Math.round((clip.viralityScore || 0) * 100);

  return (
    <div className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      {/* Video */}
      <div className="relative aspect-[9/16] w-full bg-stone-900">
        {clip.url ? (
          <video
            src={clip.url}
            controls
            preload="metadata"
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-stone-500">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="h-12 w-12"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M10 9l5 3-5 3V9z" fill="currentColor" />
            </svg>
          </div>
        )}

        {/* Rank + duration */}
        <div className="pointer-events-none absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/65 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
          <span>#{index + 1}</span>
          <span className="text-white/60">·</span>
          <span>{formatDuration(clip.duration)}</span>
        </div>

        {/* Virality score */}
        {score > 0 && (
          <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1 rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white shadow-md shadow-orange-500/30">
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="h-2.5 w-2.5"
            >
              <path d="M13 2L3 14h7l-1 8 10-12h-7l1-8z" />
            </svg>
            {score}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="p-3.5">
        {clip.hook && (
          <p className="mb-1 line-clamp-2 text-[10px] font-bold uppercase tracking-wider text-orange-600">
            {clip.hook}
          </p>
        )}
        <p className="mb-3 line-clamp-2 text-[13px] font-medium leading-snug text-stone-800">
          {clip.title || `Clip ${index + 1}`}
        </p>

        <a
          href={clip.url}
          target="_blank"
          rel="noopener noreferrer"
          download
          className="flex w-full items-center justify-center gap-1.5 rounded-full bg-orange-500 px-3 py-2 text-xs font-semibold text-white shadow-md shadow-orange-500/25 transition-all hover:bg-orange-600"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-3.5 w-3.5"
          >
            <path
              d="M12 4v12M6 12l6 6 6-6M5 21h14"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          Download
        </a>
      </div>
    </div>
  );
};

export default ClipViewer;