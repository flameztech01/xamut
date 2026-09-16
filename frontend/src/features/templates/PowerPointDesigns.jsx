// features/templates/PowerPointDesigns.jsx
//
// Same contract as PdfDesigns.jsx — each template is a component that fills
// its parent's aspect-ratio (16:9). Props: { page, theme, pageNumber, totalPages }.

// ─────────────────────────────────────────────────────────────
// Template 1 — Modern Green
// ─────────────────────────────────────────────────────────────
const ModernGreen = ({ page, theme, pageNumber, totalPages }) => {
  const primary = `#${theme?.primaryColor || "2E7D32"}`;
  const bg = `#${theme?.secondaryColor || "FFFFFF"}`;
  const text = `#${theme?.textColor || "1B2B1E"}`;
  const accent = `#${theme?.accentColor || "C9A227"}`;

  if (page.role === "cover" || page.role === "closing") {
    return (
      <div
        className="relative flex h-full w-full flex-col justify-end p-12"
        style={{ background: text }}
      >
        <div className="absolute left-12 top-12 flex items-center gap-2">
          <div className="h-2 w-2 rounded-full" style={{ background: accent }} />
          <p
            className="text-[10px] font-bold uppercase tracking-[0.35em]"
            style={{ color: accent }}
          >
            Xamut
          </p>
        </div>
        <div className="mb-8 h-0.5 w-24" style={{ background: primary }} />
        <h1 className="max-w-3xl text-5xl font-bold leading-tight text-white">
          {page.heading}
        </h1>
        {page.subheading && (
          <p
            className="mt-4 max-w-2xl text-lg"
            style={{ color: primary }}
          >
            {page.subheading}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-col px-12 py-10"
      style={{ background: bg, color: text }}
    >
      <div
        className="absolute left-0 top-0 h-1.5 w-full"
        style={{ background: primary }}
      />
      <div className="mb-8 flex items-start gap-4">
        <div
          className="mt-1.5 h-10 w-1 shrink-0 rounded-full"
          style={{ background: primary }}
        />
        <h2 className="text-3xl font-bold leading-tight">{page.heading}</h2>
      </div>

      {page.bullets?.length > 0 && (
        <ul className="flex-1 space-y-4">
          {page.bullets.map((b, i) => (
            <li key={i} className="flex items-start gap-4">
              <span
                className="mt-2.5 h-2 w-2 shrink-0 rotate-45"
                style={{ background: primary }}
              />
              <span className="text-[15px] leading-relaxed">{b}</span>
            </li>
          ))}
        </ul>
      )}

      {page.paragraphs?.length > 0 && (
        <p className="mt-4 text-sm leading-relaxed opacity-70">
          {page.paragraphs.join(" ")}
        </p>
      )}

      <div
        className="mt-auto flex items-center justify-between pt-4 text-[10px]"
        style={{ color: `${text}88` }}
      >
        <span>Xamut</span>
        <span>
          {pageNumber} / {totalPages}
        </span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Template 2 — Elegant Navy
// ─────────────────────────────────────────────────────────────
const ElegantNavy = ({ page, theme, pageNumber, totalPages }) => {
  const primary = `#${theme?.primaryColor || "0D1B2A"}`;
  const bg = `#${theme?.secondaryColor || "F4F1EA"}`;
  const text = `#${theme?.textColor || "0D1B2A"}`;
  const accent = `#${theme?.accentColor || "C9A227"}`;

  if (page.role === "cover" || page.role === "closing") {
    return (
      <div
        className="relative flex h-full w-full flex-col items-center justify-center p-12 text-center"
        style={{ background: primary }}
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="h-px w-10" style={{ background: accent }} />
          <div className="h-1.5 w-1.5 rotate-45" style={{ background: accent }} />
          <div className="h-px w-10" style={{ background: accent }} />
        </div>
        <h1 className="max-w-4xl font-serif text-5xl font-bold leading-tight text-white">
          {page.heading}
        </h1>
        {page.subheading && (
          <p
            className="mt-5 max-w-2xl text-lg italic"
            style={{ color: accent }}
          >
            {page.subheading}
          </p>
        )}
        <div className="mt-10 flex items-center gap-3">
          <div className="h-px w-10" style={{ background: accent }} />
          <p
            className="text-[10px] font-semibold uppercase tracking-[0.4em]"
            style={{ color: accent }}
          >
            Xamut
          </p>
          <div className="h-px w-10" style={{ background: accent }} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-col px-14 py-10"
      style={{ background: bg, color: text }}
    >
      <div className="mb-8">
        <p
          className="text-[10px] font-bold uppercase tracking-[0.3em]"
          style={{ color: accent }}
        >
          Slide {pageNumber - 1}
        </p>
        <h2
          className="mt-3 max-w-3xl font-serif text-3xl font-bold leading-tight"
          style={{ color: primary }}
        >
          {page.heading}
        </h2>
      </div>

      <ul className="flex-1 space-y-4">
        {(page.bullets || []).map((b, i) => (
          <li key={i} className="flex items-start gap-4">
            <span
              className="mt-2 h-1.5 w-6 shrink-0 rounded-full"
              style={{ background: accent }}
            />
            <span className="text-[15px] leading-relaxed">{b}</span>
          </li>
        ))}
      </ul>

      <div
        className="mt-auto flex items-center justify-between pt-4 text-[10px] uppercase tracking-widest"
        style={{ color: `${text}88` }}
      >
        <span>Xamut</span>
        <span>
          {pageNumber} / {totalPages}
        </span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Template 3 — Bold Orange
// ─────────────────────────────────────────────────────────────
const BoldOrange = ({ page, theme, pageNumber, totalPages }) => {
  const primary = `#${theme?.primaryColor || "E65100"}`;
  const bg = `#${theme?.secondaryColor || "FFF7ED"}`;
  const text = `#${theme?.textColor || "1A0F05"}`;
  const accent = `#${theme?.accentColor || "111827"}`;

  if (page.role === "cover" || page.role === "closing") {
    return (
      <div
        className="relative flex h-full w-full flex-col justify-between p-14"
        style={{ background: primary }}
      >
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md" style={{ background: text }} />
          <p
            className="text-[10px] font-bold uppercase tracking-[0.35em]"
            style={{ color: bg }}
          >
            Xamut
          </p>
        </div>
        <div>
          <h1
            className="max-w-4xl text-6xl font-black leading-[0.95] tracking-tight"
            style={{ color: bg }}
          >
            {page.heading}
          </h1>
          {page.subheading && (
            <p
              className="mt-5 max-w-2xl text-lg font-medium"
              style={{ color: bg, opacity: 0.85 }}
            >
              {page.subheading}
            </p>
          )}
        </div>
        <p
          className="text-[10px] font-semibold uppercase tracking-[0.35em]"
          style={{ color: bg, opacity: 0.7 }}
        >
          Prepared by Xamut
        </p>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-col px-14 py-10"
      style={{ background: bg, color: text }}
    >
      <div className="mb-8 flex items-start gap-5">
        <p
          className="text-4xl font-black leading-none"
          style={{ color: primary }}
        >
          {String(pageNumber - 1).padStart(2, "0")}
        </p>
        <h2 className="max-w-3xl pt-1 text-3xl font-bold leading-tight">
          {page.heading}
        </h2>
      </div>

      <ul className="flex-1 space-y-4">
        {(page.bullets || []).map((b, i) => (
          <li key={i} className="flex items-start gap-4">
            <span
              className="mt-2 h-3 w-3 shrink-0 rounded-sm"
              style={{ background: primary }}
            />
            <span className="text-[15px] font-medium leading-relaxed">
              {b}
            </span>
          </li>
        ))}
      </ul>

      <div
        className="mt-auto flex items-center justify-between pt-4 text-[10px] font-semibold uppercase tracking-widest"
        style={{ color: `${text}66` }}
      >
        <span>Xamut</span>
        <span>
          {pageNumber} / {totalPages}
        </span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────
export const PptDesigns = {
  "modern-green": ModernGreen,
  "elegant-navy": ElegantNavy,
  "bold-orange": BoldOrange,
};

export const PPT_TEMPLATE_LIST = [
  { id: "modern-green", label: "Modern Green", primary: "2E7D32", secondary: "FFFFFF", accent: "C9A227" },
  { id: "elegant-navy", label: "Elegant Navy", primary: "0D1B2A", secondary: "F4F1EA", accent: "C9A227" },
  { id: "bold-orange", label: "Bold Orange", primary: "E65100", secondary: "FFF7ED", accent: "111827" },
];

export const DEFAULT_PPT_TEMPLATE = "modern-green";