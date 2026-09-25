// features/templates/PowerPointDesigns.jsx
//
// 16:9 slide templates. Same prop contract as PdfDesigns.
// Content lives in `page.blocks`; legacy arrays still render.

import { Fragment } from "react";

// 1pt on a 13.33in slide ≈ 0.104cqw. Slide type is intrinsically big,
// so the numbers are similar to how you'd size real PowerPoint text.
const PT = 0.104;
const pt = (v) => `${(Number(v) || 0) * PT}cqw`;

// ─────────────────────────────────────────────────────────────
// Inline (same grammar as PDF side)
// ─────────────────────────────────────────────────────────────
const INLINE_RE =
  /(\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|\{color:(#[0-9a-fA-F]{6})\}([\s\S]*?)\{\/color\}|\{size:(\d{1,2})\}([\s\S]*?)\{\/size\})/g;

const renderInline = (text) => {
  const str = String(text ?? "");
  const out = [];
  let last = 0;
  let k = 0;
  INLINE_RE.lastIndex = 0;
  let m;
  while ((m = INLINE_RE.exec(str)) !== null) {
    if (m.index > last) out.push(str.slice(last, m.index));
    const key = `i${k++}`;
    if (m[2] !== undefined) out.push(<strong key={key}>{m[2]}</strong>);
    else if (m[3] !== undefined) out.push(<u key={key}>{m[3]}</u>);
    else if (m[4] !== undefined) out.push(<em key={key}>{m[4]}</em>);
    else if (m[5] !== undefined)
      out.push(<span key={key} style={{ color: m[5] }}>{m[6]}</span>);
    else if (m[7] !== undefined)
      out.push(
        <span key={key} style={{ fontSize: pt(Number(m[7])) }}>
          {m[8]}
        </span>
      );
    last = m.index + m[0].length;
  }
  if (last < str.length) out.push(str.slice(last));
  return out;
};

const Inline = ({ text }) => <>{renderInline(text)}</>;

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const normalizeBlocks = (page) => {
  if (Array.isArray(page?.blocks) && page.blocks.length) return page.blocks;
  const out = [];
  for (const p of page?.paragraphs || [])
    out.push({ type: "paragraph", text: p });
  if (page?.bullets?.length)
    out.push({ type: "bullets", items: page.bullets });
  return out;
};

const tocEntries = (page) =>
  (page?.blocks || [])
    .filter((b) => b.type === "toc-entry")
    .map((b) => ({ text: b.text || "", level: b.level || 1 }));

const pickColors = (theme) => ({
  primary: `#${theme?.primaryColor || "2E7D32"}`,
  bg: `#${theme?.secondaryColor || "FFFFFF"}`,
  text: `#${theme?.textColor || "1B2B1E"}`,
  accent: `#${theme?.accentColor || "C9A227"}`,
});

// ─────────────────────────────────────────────────────────────
// Shared slide body — bullets + paragraphs from blocks
// ─────────────────────────────────────────────────────────────
const SlideBody = ({
  blocks,
  color,
  font,
  bullet,
  headingColor,
  bulletSize = 15,
  paragraphSize = 12,
}) => {
  const items = [];
  blocks.forEach((b, i) => {
    if (!b) return;

    if (b.type === "heading") {
      items.push(
        <h3
          key={`h-${i}`}
          style={{
            fontSize: pt(b.level === 1 ? 24 : b.level === 3 ? 16 : 20),
            fontWeight: 700,
            color: headingColor || color,
            lineHeight: 1.2,
            marginTop: pt(4),
            marginBottom: pt(2),
          }}
        >
          <Inline text={b.text} />
        </h3>
      );
      return;
    }

    if (b.type === "bullets" || b.type === "numbered") {
      items.push(
        <ul
          key={`ul-${i}`}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: pt(6),
            marginTop: pt(2),
            marginBottom: pt(2),
          }}
        >
          {b.items.map((it, j) => (
            <li
              key={j}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: pt(4),
                fontSize: pt(bulletSize),
                lineHeight: 1.45,
              }}
            >
              {b.type === "numbered" ? (
                <span
                  style={{
                    flexShrink: 0,
                    fontWeight: 700,
                    color,
                    minWidth: pt(10),
                  }}
                >
                  {j + 1}.
                </span>
              ) : bullet ? (
                <bullet.Node />
              ) : (
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: pt(3),
                    height: pt(3),
                    borderRadius: "50%",
                    background: color,
                    marginTop: `calc(${pt(bulletSize)} * 0.55)`,
                  }}
                />
              )}
              <span style={{ flex: 1 }}>
                <Inline text={it} />
              </span>
            </li>
          ))}
        </ul>
      );
      return;
    }

    if (b.type === "paragraph") {
      items.push(
        <p
          key={`p-${i}`}
          style={{
            fontSize: pt(paragraphSize),
            lineHeight: 1.6,
            opacity: 0.85,
            marginTop: pt(2),
          }}
        >
          <Inline text={b.text} />
        </p>
      );
    }
  });
  return <>{items}</>;
};

// ─────────────────────────────────────────────────────────────
// Template 1 — Modern Green
// ─────────────────────────────────────────────────────────────
const ModernGreen = ({ page, theme, pageNumber, totalPages }) => {
  const { primary, bg, text, accent } = pickColors(theme);
  const blocks = normalizeBlocks(page);

  if (page.role === "cover" || page.role === "closing") {
    return (
      <div
        className="relative flex h-full w-full flex-col justify-end"
        style={{ background: text, padding: pt(60) }}
      >
        <div
          style={{
            position: "absolute",
            top: pt(60),
            left: pt(60),
            display: "flex",
            alignItems: "center",
            gap: pt(4),
          }}
        >
          <div
            style={{
              width: pt(4),
              height: pt(4),
              borderRadius: "50%",
              background: accent,
            }}
          />
          <span
            style={{
              fontSize: pt(11),
              fontWeight: 700,
              letterSpacing: "0.35em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            Xamut
          </span>
        </div>
        <div
          style={{
            width: pt(120),
            height: 2,
            background: primary,
            marginBottom: pt(30),
          }}
        />
        <h1
          style={{
            fontSize: pt(54),
            fontWeight: 700,
            lineHeight: 1.05,
            color: "#FFFFFF",
            maxWidth: "85%",
          }}
        >
          {page.heading}
        </h1>
        {page.subheading ? (
          <p
            style={{
              marginTop: pt(12),
              fontSize: pt(22),
              color: primary,
              maxWidth: "75%",
            }}
          >
            {page.subheading}
          </p>
        ) : null}
      </div>
    );
  }

  if (page.role === "toc") {
    const entries = tocEntries(page);
    return (
      <div
        className="relative flex h-full w-full flex-col"
        style={{ background: bg, color: text, padding: `${pt(60)} ${pt(72)}` }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: pt(4),
            background: primary,
          }}
        />
        <h2 style={{ fontSize: pt(36), fontWeight: 700, marginBottom: pt(20) }}>
          {page.heading || "Agenda"}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: pt(10) }}>
          {entries.map((e, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: pt(8) }}
            >
              <span
                style={{
                  width: pt(20),
                  height: pt(3),
                  background: primary,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: pt(20), fontWeight: 500 }}>
                {e.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full w-full flex-col"
      style={{ background: bg, color: text, padding: `${pt(56)} ${pt(72)}` }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: pt(6),
          background: primary,
        }}
      />
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: pt(16),
          marginBottom: pt(28),
        }}
      >
        <div
          style={{
            width: pt(6),
            height: pt(46),
            background: primary,
            flexShrink: 0,
            marginTop: pt(4),
          }}
        />
        <h2 style={{ fontSize: pt(38), fontWeight: 700, lineHeight: 1.1 }}>
          {page.heading}
        </h2>
      </div>
      <div style={{ flex: 1 }}>
        <SlideBody
          blocks={blocks}
          color={primary}
          headingColor={text}
          bullet={{ Node: () => (
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: pt(4),
                height: pt(4),
                background: primary,
                transform: "rotate(45deg)",
                marginTop: `calc(${pt(15)} * 0.55)`,
              }}
            />
          ) }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingTop: pt(8),
          fontSize: pt(10),
          color: `${text}88`,
        }}
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
  const { primary, bg, text, accent } = pickColors(theme);
  const blocks = normalizeBlocks(page);

  if (page.role === "cover" || page.role === "closing") {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center text-center"
        style={{ background: primary, padding: pt(60) }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: pt(6),
            marginBottom: pt(24),
          }}
        >
          <div style={{ width: pt(40), height: 1, background: accent }} />
          <div
            style={{
              width: pt(5),
              height: pt(5),
              background: accent,
              transform: "rotate(45deg)",
            }}
          />
          <div style={{ width: pt(40), height: 1, background: accent }} />
        </div>
        <h1
          style={{
            fontSize: pt(54),
            fontWeight: 700,
            color: "#FFFFFF",
            lineHeight: 1.05,
            maxWidth: "80%",
          }}
        >
          {page.heading}
        </h1>
        {page.subheading ? (
          <p
            style={{
              marginTop: pt(16),
              fontSize: pt(22),
              fontStyle: "italic",
              color: accent,
              maxWidth: "70%",
            }}
          >
            {page.subheading}
          </p>
        ) : null}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: pt(6),
            marginTop: pt(36),
          }}
        >
          <div style={{ width: pt(40), height: 1, background: accent }} />
          <span
            style={{
              fontSize: pt(11),
              letterSpacing: "0.4em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            Xamut
          </span>
          <div style={{ width: pt(40), height: 1, background: accent }} />
        </div>
      </div>
    );
  }

  if (page.role === "toc") {
    const entries = tocEntries(page);
    return (
      <div
        className="flex h-full w-full flex-col"
        style={{ background: bg, color: text, padding: `${pt(60)} ${pt(72)}` }}
      >
        <p
          style={{
            fontSize: pt(11),
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: accent,
            marginBottom: pt(8),
          }}
        >
          Agenda
        </p>
        <h2
          style={{
            fontSize: pt(38),
            fontWeight: 700,
            color: primary,
            marginBottom: pt(24),
          }}
        >
          {page.heading || "Overview"}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: pt(12) }}>
          {entries.map((e, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: pt(8) }}
            >
              <div
                style={{
                  width: pt(24),
                  height: pt(3),
                  background: accent,
                  borderRadius: pt(2),
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: pt(20) }}>{e.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{ background: bg, color: text, padding: `${pt(56)} ${pt(72)}` }}
    >
      <div style={{ marginBottom: pt(28) }}>
        <p
          style={{
            fontSize: pt(11),
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: accent,
          }}
        >
          Slide {Math.max(1, pageNumber - 1)}
        </p>
        <h2
          style={{
            marginTop: pt(6),
            fontSize: pt(38),
            fontWeight: 700,
            color: primary,
            lineHeight: 1.1,
          }}
        >
          {page.heading}
        </h2>
      </div>
      <div style={{ flex: 1 }}>
        <SlideBody
          blocks={blocks}
          color={accent}
          headingColor={primary}
          bullet={{ Node: () => (
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: pt(16),
                height: pt(3),
                background: accent,
                borderRadius: pt(2),
                marginTop: `calc(${pt(15)} * 0.65)`,
              }}
            />
          ) }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingTop: pt(8),
          fontSize: pt(10),
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: `${text}88`,
        }}
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
  const { primary, bg, text, accent } = pickColors(theme);
  const blocks = normalizeBlocks(page);

  if (page.role === "cover" || page.role === "closing") {
    return (
      <div
        className="relative flex h-full w-full flex-col justify-between"
        style={{ background: primary, padding: pt(64) }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: pt(4) }}>
          <div style={{ width: pt(24), height: pt(24), background: text }} />
          <span
            style={{
              fontSize: pt(11),
              fontWeight: 700,
              letterSpacing: "0.35em",
              textTransform: "uppercase",
              color: bg,
            }}
          >
            Xamut
          </span>
        </div>
        <div>
          <h1
            style={{
              fontSize: pt(64),
              fontWeight: 900,
              letterSpacing: "-0.02em",
              lineHeight: 0.98,
              color: bg,
              maxWidth: "90%",
            }}
          >
            {page.heading}
          </h1>
          {page.subheading ? (
            <p
              style={{
                marginTop: pt(16),
                fontSize: pt(22),
                fontWeight: 500,
                color: bg,
                opacity: 0.85,
                maxWidth: "75%",
              }}
            >
              {page.subheading}
            </p>
          ) : null}
        </div>
        <p
          style={{
            fontSize: pt(11),
            fontWeight: 600,
            letterSpacing: "0.35em",
            textTransform: "uppercase",
            color: bg,
            opacity: 0.7,
          }}
        >
          Prepared by Xamut
        </p>
      </div>
    );
  }

  if (page.role === "toc") {
    const entries = tocEntries(page);
    return (
      <div
        className="flex h-full w-full flex-col"
        style={{ background: bg, color: text, padding: `${pt(60)} ${pt(72)}` }}
      >
        <h2
          style={{
            fontSize: pt(40),
            fontWeight: 900,
            color: primary,
            letterSpacing: "-0.02em",
            marginBottom: pt(20),
          }}
        >
          {page.heading || "Agenda"}
        </h2>
        <div style={{ display: "flex", flexDirection: "column", gap: pt(10) }}>
          {entries.map((e, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: pt(8) }}
            >
              <span
                style={{
                  fontSize: pt(20),
                  fontWeight: 900,
                  color: primary,
                  minWidth: pt(28),
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ fontSize: pt(22), fontWeight: 600 }}>
                {e.text}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex h-full w-full flex-col"
      style={{ background: bg, color: text, padding: `${pt(56)} ${pt(72)}` }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: pt(16),
          marginBottom: pt(28),
        }}
      >
        <p
          style={{
            fontSize: pt(44),
            fontWeight: 900,
            lineHeight: 0.9,
            color: primary,
          }}
        >
          {String(Math.max(1, pageNumber - 1)).padStart(2, "0")}
        </p>
        <h2
          style={{
            flex: 1,
            paddingTop: pt(4),
            fontSize: pt(38),
            fontWeight: 700,
            lineHeight: 1.1,
          }}
        >
          {page.heading}
        </h2>
      </div>
      <div style={{ flex: 1 }}>
        <SlideBody
          blocks={blocks}
          color={primary}
          headingColor={text}
          bullet={{ Node: () => (
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: pt(5),
                height: pt(5),
                background: primary,
                marginTop: `calc(${pt(15)} * 0.5)`,
              }}
            />
          ) }}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          paddingTop: pt(8),
          fontSize: pt(10),
          fontWeight: 600,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: `${text}66`,
        }}
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