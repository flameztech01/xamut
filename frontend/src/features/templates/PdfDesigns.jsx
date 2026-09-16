// features/templates/PdfDesigns.jsx
//
// Each template is a React component rendered inside a fixed aspect-ratio
// (US Letter 8.5/11) container by DocumentViewer.
// Props: { page, theme, pageNumber, totalPages }
// `page` = one page object from the Document model.
//
// Design notes:
// These are PROSE templates — think page of a paper, not a slide. Body
// text is small, justified, and set in a serif face wherever it suits
// the tone. Footers carry a page number so the downloaded PDF paginates
// correctly. The container clips overflow; if the AI writes an overly
// long section it will be cut off — keep instructions capped in the
// generator prompt if that becomes a problem.
//
// Formatting notes:
// Generated paragraphs/bullets may contain the ONLY two markdown tokens
// the generator prompt is allowed to produce: **bold** and *italic*.
// The <Inline> helper below turns those into real <strong>/<em> nodes so
// they don't just render as literal asterisks. Every place that used to
// print `{p}` or `{b}` directly now renders `<Inline text={p} />` instead.
// This same syntax is mirrored in PowerPointDesigns.jsx (for the preview)
// and in DocumentViewer.jsx's `mdToRuns` (for the .pptx export) — if you
// ever extend what the model is allowed to emit, update all three.

// ─────────────────────────────────────────────────────────────
// Inline markdown — bold / italic only
// ─────────────────────────────────────────────────────────────
export const Inline = ({ text = "" }) => {
  const parts = String(text ?? "").split(/(\*\*.+?\*\*|\*.+?\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 1) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
};

// ─────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────
const FALLBACK = {
  primaryColor: "2E7D32",
  secondaryColor: "FFFFFF",
  accentColor: "6B7280",
  textColor: "1A1A1A",
};

const palette = (theme) => ({
  primary: `#${theme?.primaryColor || FALLBACK.primaryColor}`,
  bg: `#${theme?.secondaryColor || FALLBACK.secondaryColor}`,
  text: `#${theme?.textColor || FALLBACK.textColor}`,
  accent: `#${theme?.accentColor || FALLBACK.accentColor}`,
});

const today = () =>
  new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

// ═════════════════════════════════════════════════════════════
// 1. Formal Academic — serif, justified, running header
// ═════════════════════════════════════════════════════════════
const FormalAcademic = ({ page, theme, pageNumber, totalPages }) => {
  const { primary, bg, text, accent } = palette(theme);

  if (page.role === "cover") {
    return (
      <div
        className="relative flex h-full w-full flex-col px-20 py-20"
        style={{ background: bg, color: text }}
      >
        <div className="flex-1" />

        <div className="max-w-xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="h-px w-8" style={{ background: primary }} />
            <span
              className="text-[9px] font-semibold uppercase tracking-[0.4em]"
              style={{ color: accent }}
            >
              Xamut Academic
            </span>
          </div>

          <h1
            className="font-serif text-[38px] font-bold leading-[1.15] tracking-tight"
            style={{ color: text }}
          >
            {page.heading}
          </h1>

          <div className="mt-6 h-0.5 w-16" style={{ background: primary }} />

          {page.subheading && (
            <p
              className="mt-6 max-w-lg font-serif text-base italic leading-[1.6]"
              style={{ color: accent }}
            >
              {page.subheading}
            </p>
          )}

          <p
            className="mt-12 text-[10px] font-medium uppercase tracking-[0.3em]"
            style={{ color: accent }}
          >
            {today()}
          </p>
        </div>

        <div className="flex-1" />

        <div
          className="border-t pt-3 text-[9px] uppercase tracking-[0.3em]"
          style={{ borderColor: `${primary}22`, color: accent }}
        >
          Prepared with Xamut
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-col px-20 py-12"
      style={{ background: bg, color: text }}
    >
      {/* Running header */}
      <div
        className="mb-8 flex items-center justify-between border-b pb-2.5"
        style={{ borderColor: `${primary}22` }}
      >
        <span
          className="text-[9px] uppercase tracking-[0.3em]"
          style={{ color: accent }}
        >
          Xamut Academic
        </span>
        <span
          className="font-serif text-[10px] italic"
          style={{ color: accent }}
        >
          {String(pageNumber).padStart(2, "0")}
        </span>
      </div>

      {/* Section heading */}
      <div className="mb-6">
        <div className="mb-3 flex items-center gap-3">
          <span
            className="text-[9px] font-bold uppercase tracking-[0.35em]"
            style={{ color: primary }}
          >
            Section {String(pageNumber - 1).padStart(2, "0")}
          </span>
          <div className="h-px flex-1" style={{ background: `${primary}22` }} />
        </div>
        <h2
          className="font-serif text-[26px] font-bold leading-[1.2] tracking-tight"
          style={{ color: text }}
        >
          {page.heading}
        </h2>
        {page.subheading && (
          <p
            className="mt-2 font-serif text-sm italic"
            style={{ color: accent }}
          >
            {page.subheading}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-3.5 font-serif text-[13.5px] leading-[1.75]">
        {page.paragraphs?.map((p, i) => (
          <p key={i} style={{ textAlign: "justify", hyphens: "auto" }}>
            <Inline text={p} />
          </p>
        ))}

        {page.bullets?.length > 0 && (
          <ul className="mt-2 space-y-2 pl-4">
            {page.bullets.map((b, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className="mt-2.5 h-1 w-1 shrink-0 rounded-full"
                  style={{ background: primary }}
                />
                <span><Inline text={b} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div
        className="mt-6 border-t pt-2.5 text-center font-serif text-[10px] italic"
        style={{ borderColor: `${primary}22`, color: accent }}
      >
        {pageNumber} of {totalPages}
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════
// 2. Corporate Report — sans, structured, numbered sections
// ═════════════════════════════════════════════════════════════
const CorporateReport = ({ page, theme, pageNumber, totalPages }) => {
  const { primary, bg, text, accent } = palette(theme);

  if (page.role === "cover") {
    return (
      <div
        className="relative flex h-full w-full flex-col px-20 py-20"
        style={{ background: bg, color: text }}
      >
        {/* Top accent bar */}
        <div
          className="absolute left-0 top-0 h-1.5 w-full"
          style={{ background: primary }}
        />

        <div className="flex items-center justify-between">
          <span
            className="text-[10px] font-bold uppercase tracking-[0.35em]"
            style={{ color: primary }}
          >
            Report
          </span>
          <span
            className="text-[10px] font-medium uppercase tracking-[0.3em]"
            style={{ color: accent }}
          >
            {today()}
          </span>
        </div>

        <div className="flex-1" />

        <div className="max-w-2xl">
          <h1
            className="text-[40px] font-bold leading-[1.1] tracking-tight"
            style={{ color: text }}
          >
            {page.heading}
          </h1>
          <div className="mt-6 h-1 w-14" style={{ background: primary }} />
          {page.subheading && (
            <p
              className="mt-6 max-w-xl text-base leading-relaxed"
              style={{ color: accent }}
            >
              {page.subheading}
            </p>
          )}
        </div>

        <div className="flex-1" />

        <div
          className="flex items-end justify-between border-t pt-4"
          style={{ borderColor: `${primary}22` }}
        >
          <div>
            <p
              className="text-[9px] font-semibold uppercase tracking-[0.3em]"
              style={{ color: accent }}
            >
              Prepared by
            </p>
            <p className="mt-1 text-sm font-semibold" style={{ color: text }}>
              Xamut
            </p>
          </div>
          <p
            className="font-mono text-[10px]"
            style={{ color: accent }}
          >
            — CONFIDENTIAL —
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-col pl-20 pr-16 py-12"
      style={{ background: bg, color: text }}
    >
      {/* Left numbered rail */}
      <div
        className="absolute left-10 top-14 flex h-[calc(100%-7rem)] w-4 flex-col items-center"
      >
        <span
          className="text-[10px] font-bold tabular-nums"
          style={{ color: primary }}
        >
          {String(pageNumber - 1).padStart(2, "0")}
        </span>
        <div
          className="mt-2 w-px flex-1"
          style={{ background: `${primary}22` }}
        />
      </div>

      {/* Section heading */}
      <div className="mb-7">
        <div className="mb-3 flex items-center gap-2">
          <span
            className="text-[9px] font-bold uppercase tracking-[0.3em]"
            style={{ color: primary }}
          >
            {page.role === "section" ? "Section" : "Page"}
          </span>
        </div>
        <h2
          className="text-[26px] font-bold leading-tight tracking-tight"
          style={{ color: text }}
        >
          {page.heading}
        </h2>
        {page.subheading && (
          <p className="mt-2.5 text-sm leading-relaxed" style={{ color: accent }}>
            {page.subheading}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-3.5 text-[13px] leading-[1.7]">
        {page.paragraphs?.map((p, i) => (
          <p key={i}><Inline text={p} /></p>
        ))}

        {page.bullets?.length > 0 && (
          <ul className="mt-3 space-y-2.5">
            {page.bullets.map((b, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rotate-45"
                  style={{ background: primary }}
                />
                <span><Inline text={b} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div
        className="mt-6 flex items-center justify-between border-t pt-3 text-[9px] uppercase tracking-[0.3em]"
        style={{ borderColor: `${primary}22`, color: accent }}
      >
        <span>Xamut</span>
        <span className="tabular-nums">
          {pageNumber} / {totalPages}
        </span>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════
// 3. Warm Cream — editorial, drop cap, literary
// ═════════════════════════════════════════════════════════════
const WarmCream = ({ page, theme, pageNumber, totalPages }) => {
  const { primary, bg, text, accent } = palette(theme);

  if (page.role === "cover") {
    return (
      <div
        className="relative flex h-full w-full flex-col px-20 py-20"
        style={{ background: bg, color: text }}
      >
        <div className="flex-1" />

        <div className="max-w-xl">
          <div className="flex items-center gap-3">
            <div className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} />
            <p
              className="text-[10px] font-semibold uppercase tracking-[0.4em]"
              style={{ color: accent }}
            >
              Xamut
            </p>
          </div>

          <h1
            className="mt-10 font-serif text-[44px] font-bold leading-[1.1] tracking-tight"
            style={{ color: primary }}
          >
            {page.heading}
          </h1>

          <div className="mt-8 flex items-center gap-3">
            <div className="h-px w-16" style={{ background: accent }} />
            <div className="h-1 w-1 rounded-full" style={{ background: accent }} />
            <div className="h-px w-4" style={{ background: accent }} />
          </div>

          {page.subheading && (
            <p
              className="mt-8 max-w-md font-serif text-base italic leading-[1.7]"
              style={{ color: text, opacity: 0.7 }}
            >
              {page.subheading}
            </p>
          )}
        </div>

        <div className="flex-1" />

        <p
          className="font-serif text-[11px] italic"
          style={{ color: accent }}
        >
          — {today()} —
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-col px-20 py-14"
      style={{ background: bg, color: text }}
    >
      {/* Chapter marker */}
      <div className="mb-8">
        <div className="flex items-baseline gap-4">
          <span
            className="font-serif text-[46px] font-bold leading-none"
            style={{ color: `${primary}30` }}
          >
            {String(pageNumber - 1).padStart(2, "0")}
          </span>
          <div className="flex-1 pb-3">
            <p
              className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.4em]"
              style={{ color: accent }}
            >
              Chapter {pageNumber - 1}
            </p>
            <h2
              className="font-serif text-[26px] font-bold leading-tight"
              style={{ color: primary }}
            >
              {page.heading}
            </h2>
          </div>
        </div>
        {page.subheading && (
          <p
            className="mt-3 font-serif text-sm italic"
            style={{ color: text, opacity: 0.7 }}
          >
            {page.subheading}
          </p>
        )}
      </div>

      {/* Body — drop cap on first paragraph */}
      <div className="flex-1 space-y-3.5 font-serif text-[13.5px] leading-[1.8]">
        {page.paragraphs?.map((p, i) => {
          if (i === 0 && p?.length > 1) {
            // Drop cap uses the first *visible* character. If the paragraph
            // opens with a markdown marker (e.g. "**Solar** power..."), strip
            // leading ** / * before pulling the first letter so the drop cap
            // itself never renders a stray asterisk.
            const stripped = p.replace(/^(\*\*|\*)/, "");
            const first = stripped.charAt(0);
            const rest = stripped.slice(1);
            return (
              <p key={i}>
                <span
                  className="float-left mr-2 mt-1 font-serif text-[42px] font-bold leading-[0.85]"
                  style={{ color: primary }}
                >
                  {first}
                </span>
                <Inline text={rest} />
              </p>
            );
          }
          return <p key={i}><Inline text={p} /></p>;
        })}

        {page.bullets?.length > 0 && (
          <ul
            className="mt-4 space-y-2.5 border-l-2 pl-5"
            style={{ borderColor: `${accent}55` }}
          >
            {page.bullets.map((b, i) => (
              <li key={i} className="italic">
                <Inline text={b} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 flex items-center justify-center gap-3">
        <div className="h-px w-8" style={{ background: `${accent}55` }} />
        <span
          className="font-serif text-[10px] italic"
          style={{ color: accent }}
        >
          {pageNumber} of {totalPages}
        </span>
        <div className="h-px w-8" style={{ background: `${accent}55` }} />
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════
// 4. Minimal Slate — clean, monochrome, modern
// ═════════════════════════════════════════════════════════════
const MinimalSlate = ({ page, theme, pageNumber, totalPages }) => {
  const { primary, bg, text, accent } = palette(theme);

  if (page.role === "cover") {
    return (
      <div
        className="relative flex h-full w-full flex-col px-20 py-20"
        style={{ background: bg, color: text }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full" style={{ background: primary }} />
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.35em]"
              style={{ color: text }}
            >
              Xamut
            </span>
          </div>
          <span
            className="text-[10px] font-medium uppercase tracking-[0.3em]"
            style={{ color: accent }}
          >
            {today()}
          </span>
        </div>

        <div className="flex-1" />

        <div className="max-w-3xl">
          <h1
            className="text-[46px] font-bold leading-[1.05] tracking-tight"
            style={{ color: text }}
          >
            {page.heading}
          </h1>
          {page.subheading && (
            <p
              className="mt-6 max-w-xl text-base leading-[1.7]"
              style={{ color: accent }}
            >
              {page.subheading}
            </p>
          )}
        </div>

        <div className="flex-1" />

        <div
          className="flex items-center justify-between border-t pt-4 text-[9px] uppercase tracking-[0.3em]"
          style={{ borderColor: `${primary}22`, color: accent }}
        >
          <span>A document by Xamut</span>
          <span className="font-mono">01 / {totalPages}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-col px-20 py-14"
      style={{ background: bg, color: text }}
    >
      {/* Header: page tag + rule */}
      <div
        className="mb-10 flex items-center gap-4 border-b pb-4"
        style={{ borderColor: `${primary}15` }}
      >
        <span
          className="font-mono text-[10px] tabular-nums"
          style={{ color: primary }}
        >
          {String(pageNumber).padStart(2, "0")}
        </span>
        <div className="h-px flex-1" style={{ background: `${primary}15` }} />
        <span
          className="text-[9px] uppercase tracking-[0.3em]"
          style={{ color: accent }}
        >
          {page.role === "section" ? "Section" : "Page"}
        </span>
      </div>

      {/* Heading */}
      <div className="mb-8">
        <h2
          className="text-[30px] font-bold leading-[1.15] tracking-tight"
          style={{ color: text }}
        >
          {page.heading}
        </h2>
        {page.subheading && (
          <p
            className="mt-3 max-w-2xl text-sm leading-relaxed"
            style={{ color: accent }}
          >
            {page.subheading}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 space-y-4 text-[13.5px] leading-[1.75]">
        {page.paragraphs?.map((p, i) => (
          <p key={i}><Inline text={p} /></p>
        ))}

        {page.bullets?.length > 0 && (
          <ul className="mt-4 space-y-3">
            {page.bullets.map((b, i) => (
              <li key={i} className="flex gap-4">
                <span
                  className="mt-2 h-px w-4 shrink-0"
                  style={{ background: primary }}
                />
                <span><Inline text={b} /></span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div
        className="mt-8 flex items-center justify-between border-t pt-4 text-[9px] uppercase tracking-[0.3em]"
        style={{ borderColor: `${primary}15`, color: accent }}
      >
        <span>Xamut</span>
        <span className="font-mono tabular-nums">
          {pageNumber} / {totalPages}
        </span>
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════
// Registry
// ═════════════════════════════════════════════════════════════
export const PdfDesigns = {
  "formal-academic": FormalAcademic,
  "corporate-report": CorporateReport,
  "warm-cream": WarmCream,
  "minimal-slate": MinimalSlate,
};

export const PDF_TEMPLATE_LIST = [
  {
    id: "formal-academic",
    label: "Formal Academic",
    primary: "2E7D32",
    secondary: "FFFFFF",
    accent: "6B7280",
  },
  {
    id: "corporate-report",
    label: "Corporate Report",
    primary: "1565C0",
    secondary: "FFFFFF",
    accent: "0D47A1",
  },
  {
    id: "warm-cream",
    label: "Warm Cream",
    primary: "5D4037",
    secondary: "F5F1E8",
    accent: "C9A227",
  },
  {
    id: "minimal-slate",
    label: "Minimal Slate",
    primary: "1E293B",
    secondary: "FFFFFF",
    accent: "64748B",
  },
];

export const DEFAULT_PDF_TEMPLATE = "formal-academic";