// features/templates/PdfDesigns.jsx
//
// Each template fills a fixed aspect-ratio A4 container from DocumentViewer.
// Props: { page, theme, fontSettings, pageNumber, totalPages }
//
// Sizing: everything is expressed in `cqw` (percent of container width)
// via the `pt()` helper. On a real A4 mockup 1pt ≈ 0.168cqw, so a 12pt
// body renders at the exact right proportion, at any zoom level or PDF
// export.
//
// Content:
//   page.blocks is the source of truth.
//   Legacy page.paragraphs / page.bullets still work as a fallback.
//
// Front matter / closing pages may contain LAYOUT blocks — text,
// heading, label-value, spacer, divider — emitted in whatever order the
// architect chose. `FrontMatter` renders them top-to-bottom. When a page
// has no blocks (old documents), the template falls back to its original
// designed cover.

// ─────────────────────────────────────────────────────────────
// Units
// ─────────────────────────────────────────────────────────────
const PT = 0.168;
const pt = (v) => `${(Number(v) || 0) * PT}cqw`;

// ─────────────────────────────────────────────────────────────
// Inline formatting
//   **bold**  *italic*  __underline__
//   {color:#RRGGBB}…{/color}
//   {size:14}…{/size}
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
      out.push(
        <span key={key} style={{ color: m[5] }}>
          {m[6]}
        </span>
      );
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

export const Inline = ({ text }) => <>{renderInline(text)}</>;

// ─────────────────────────────────────────────────────────────
// Theme + fonts
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

const DEFAULT_FS = {
  bodyFontSize: 12,
  headingFontSize: 16,
  fontFamily: "Calibri",
  lineSpacing: 1.5,
};

const resolveFont = (fontSettings) => {
  const f = { ...DEFAULT_FS, ...(fontSettings || {}) };
  return {
    body: pt(f.bodyFontSize),
    heading: pt(f.headingFontSize),
    lineHeight: f.lineSpacing,
    family: f.fontFamily,
    bodySize: f.bodyFontSize,
    headingSize: f.headingFontSize,
  };
};

const today = () =>
  new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

// ─────────────────────────────────────────────────────────────
// Front-matter block constants
// ─────────────────────────────────────────────────────────────
// pt sizes for `{type:"text", size:...}` blocks. Values fall back to
// body size when the block omits `size`.
const FM_TEXT_SIZE = { sm: 10, md: 12, lg: 16, xl: 22, "2xl": 30 };
// pt heights for `{type:"spacer", size:...}`. Always a real gap.
const FM_SPACER_PT = { sm: 8, md: 16, lg: 32, xl: 56 };

// ─────────────────────────────────────────────────────────────
// Body content normalization (unchanged behavior)
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

const tocEntries = (page) => {
  if (page?.role !== "toc") return [];
  return (page.blocks || [])
    .filter((b) => b.type === "toc-entry")
    .map((b) => ({ text: b.text || "", level: b.level || 1 }));
};

// ─────────────────────────────────────────────────────────────
// FrontMatter
//
// Draws the layout blocks of a cover / closing page in ORDER.
// `styles` lets each template tune the defaults (size scale,
// alignment defaults, etc.) without duplicating logic.
// ─────────────────────────────────────────────────────────────
const FrontMatter = ({ page, font, primary, accent, text, variant = "cover" }) => {
  const blocks = Array.isArray(page.blocks) ? page.blocks : [];
  if (!blocks.length) return null;

  const isCover = variant === "cover";

  // Vertical centering for covers, top-aligned for closings / any
  // other use. Padding matches the templates' outer frames.
  const wrapper = {
    display: "flex",
    flexDirection: "column",
    justifyContent: isCover ? "center" : "flex-start",
    width: "100%",
    height: "100%",
  };

  return (
    <div style={wrapper}>
      {blocks.map((b, i) => {
        if (!b) return null;

        if (b.type === "spacer") {
          const height = FM_SPACER_PT[b.size] || FM_SPACER_PT.md;
          return <div key={i} style={{ height: pt(height), flexShrink: 0 }} />;
        }

        if (b.type === "divider") {
          return (
            <hr
              key={i}
              style={{
                border: "none",
                borderTop: `1px solid ${primary}33`,
                margin: `${pt(10)} 0`,
              }}
            />
          );
        }

        if (b.type === "heading") {
          const size =
            b.level === 1
              ? Math.max(28, font.headingSize + 18)
              : b.level === 2
              ? Math.max(20, font.headingSize + 8)
              : font.headingSize;
          return (
            <h1
              key={i}
              style={{
                margin: `${pt(2)} 0`,
                textAlign: b.align || "left",
                fontFamily: font.family,
                fontSize: pt(size),
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: "-0.01em",
                color: text,
              }}
            >
              <Inline text={b.text} />
            </h1>
          );
        }

        if (b.type === "label-value") {
          return (
            <div
              key={i}
              style={{
                marginBottom: pt(3),
                textAlign: b.align || "left",
                fontFamily: font.family,
                fontSize: pt(Math.max(10, font.bodySize)),
                lineHeight: 1.5,
                color: text,
              }}
            >
              {b.label ? (
                <span style={{ fontWeight: 600, color: accent }}>
                  {b.label}:
                </span>
              ) : null}{" "}
              <span>{b.value}</span>
            </div>
          );
        }

        if (b.type === "paragraph" || b.type === "text") {
          const size = FM_TEXT_SIZE[b.size] || font.bodySize;
          return (
            <p
              key={i}
              style={{
                margin: `${pt(2)} 0`,
                textAlign: b.align || "left",
                fontFamily: font.family,
                fontSize: pt(size),
                fontWeight: b.weight === "bold" ? 700 : 400,
                lineHeight: 1.5,
                color: text,
              }}
            >
              <Inline text={b.text} />
            </p>
          );
        }

        if (
          (b.type === "bullets" || b.type === "numbered") &&
          Array.isArray(b.items)
        ) {
          const Tag = b.type === "numbered" ? "ol" : "ul";
          return (
            <Tag
              key={i}
              style={{
                margin: `${pt(3)} 0`,
                paddingLeft: pt(16),
                fontFamily: font.family,
                fontSize: pt(font.bodySize),
                lineHeight: font.lineHeight,
                color: text,
              }}
            >
              {b.items.map((it, j) => (
                <li key={j}>
                  <Inline text={it} />
                </li>
              ))}
            </Tag>
          );
        }

        if (b.type === "quote") {
          return (
            <blockquote
              key={i}
              style={{
                margin: `${pt(4)} 0`,
                paddingLeft: pt(10),
                borderLeft: `2px solid ${primary}`,
                fontStyle: "italic",
                fontFamily: font.family,
                fontSize: pt(font.bodySize),
                lineHeight: font.lineHeight,
                color: text,
                opacity: 0.85,
              }}
            >
              <Inline text={b.text} />
            </blockquote>
          );
        }

        return null;
      })}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Body renderer (unchanged)
// ─────────────────────────────────────────────────────────────
const Body = ({
  blocks,
  font,
  color,
  headingColor,
  headingFamily,
  paraAlign = "left",
  paraGap = 5,
  bulletGap = 3,
  dropCapFirst = false,
  dropCapColor,
  Bullet,
  Numbered,
}) => {
  let paraSeen = 0;
  const rendered = [];

  blocks.forEach((b, idx) => {
    if (!b) return;

    if (b.type === "heading") {
      const Tag = b.level === 1 ? "h3" : b.level === 3 ? "h5" : "h4";
      rendered.push(
        <Tag
          key={`h-${idx}`}
          style={{
            fontSize: font.heading,
            fontFamily: headingFamily || font.family,
            color: headingColor || color,
            fontWeight: 700,
            lineHeight: 1.2,
            marginTop: pt(6),
            marginBottom: pt(3),
          }}
        >
          <Inline text={b.text} />
        </Tag>
      );
      return;
    }

    if (b.type === "paragraph") {
      const isFirst = paraSeen === 0;
      paraSeen++;

      const body =
        dropCapFirst && isFirst && b.text?.length > 1
          ? (() => {
              const stripped = b.text.replace(/^(\*\*|\*)/, "");
              const first = stripped.charAt(0);
              const rest = stripped.slice(1);
              return (
                <>
                  <span
                    style={{
                      float: "left",
                      fontSize: pt(font.bodySize * 3.4),
                      lineHeight: 0.85,
                      fontWeight: 700,
                      color: dropCapColor || headingColor || color,
                      marginRight: pt(2),
                      marginTop: pt(1),
                    }}
                  >
                    {first}
                  </span>
                  <Inline text={rest} />
                </>
              );
            })()
          : <Inline text={b.text} />;

      rendered.push(
        <p
          key={`p-${idx}`}
          style={{
            fontSize: font.body,
            fontFamily: font.family,
            lineHeight: font.lineHeight,
            textAlign: paraAlign,
            hyphens: paraAlign === "justify" ? "auto" : undefined,
            marginBottom: pt(paraGap),
          }}
        >
          {body}
        </p>
      );
      return;
    }

    if (b.type === "bullets" && Array.isArray(b.items)) {
      rendered.push(
        <ul
          key={`ul-${idx}`}
          style={{
            marginTop: pt(1),
            marginBottom: pt(paraGap),
            display: "flex",
            flexDirection: "column",
            gap: pt(bulletGap),
          }}
        >
          {b.items.map((item, j) => (
            <li
              key={j}
              style={{
                display: "flex",
                gap: pt(3),
                fontSize: font.body,
                fontFamily: font.family,
                lineHeight: font.lineHeight,
              }}
            >
              {Bullet ? (
                <Bullet />
              ) : (
                <span
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    width: pt(2),
                    height: pt(2),
                    borderRadius: "50%",
                    background: color,
                    marginTop: `calc(${font.body} * 0.65)`,
                  }}
                />
              )}
              <span style={{ flex: 1 }}>
                <Inline text={item} />
              </span>
            </li>
          ))}
        </ul>
      );
      return;
    }

    if (b.type === "numbered" && Array.isArray(b.items)) {
      rendered.push(
        <ol
          key={`ol-${idx}`}
          style={{
            marginTop: pt(1),
            marginBottom: pt(paraGap),
            paddingLeft: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: pt(bulletGap),
          }}
        >
          {b.items.map((item, j) => (
            <li
              key={j}
              style={{
                display: "flex",
                gap: pt(3),
                fontSize: font.body,
                fontFamily: font.family,
                lineHeight: font.lineHeight,
              }}
            >
              {Numbered ? (
                <Numbered n={j + 1} />
              ) : (
                <span
                  style={{
                    flexShrink: 0,
                    minWidth: pt(8),
                    fontWeight: 700,
                    color,
                  }}
                >
                  {j + 1}.
                </span>
              )}
              <span style={{ flex: 1 }}>
                <Inline text={item} />
              </span>
            </li>
          ))}
        </ol>
      );
      return;
    }

    if (b.type === "quote") {
      rendered.push(
        <blockquote
          key={`q-${idx}`}
          style={{
            borderLeft: `2px solid ${color}`,
            paddingLeft: pt(6),
            margin: `${pt(3)} 0 ${pt(paraGap)}`,
            fontStyle: "italic",
            fontSize: font.body,
            fontFamily: font.family,
            lineHeight: font.lineHeight,
            color,
            opacity: 0.85,
          }}
        >
          <Inline text={b.text} />
        </blockquote>
      );
      return;
    }

    if (b.type === "code") {
      rendered.push(
        <pre
          key={`c-${idx}`}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: pt(Math.max(9, font.bodySize - 1)),
            lineHeight: 1.55,
            background: `${color}0d`,
            padding: pt(6),
            borderRadius: pt(2),
            margin: `${pt(3)} 0 ${pt(paraGap)}`,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {b.text}
        </pre>
      );
      return;
    }

    if (b.type === "divider") {
      rendered.push(
        <hr
          key={`d-${idx}`}
          style={{
            border: "none",
            borderTop: `1px solid ${color}33`,
            margin: `${pt(5)} 0`,
          }}
        />
      );
    }
  });

  return <>{rendered}</>;
};

// ─────────────────────────────────────────────────────────────
// Shared cover/closing wrapper
//
// If the page has front-matter blocks, render them. Otherwise fall
// back to the passed `Fallback` renderer (each template's original
// designed cover).
// ─────────────────────────────────────────────────────────────
const CoverOrClosing = ({
  page,
  font,
  primary,
  accent,
  text,
  frame,
  Fallback,
}) => {
  const hasBlocks = Array.isArray(page.blocks) && page.blocks.length > 0;
  return (
    <div className="flex h-full w-full flex-col" style={frame}>
      {hasBlocks ? (
        <FrontMatter
          page={page}
          font={font}
          primary={primary}
          accent={accent}
          text={text}
          variant="cover"
        />
      ) : (
        <Fallback />
      )}
    </div>
  );
};

// ═════════════════════════════════════════════════════════════
// 1. Formal Academic
// ═════════════════════════════════════════════════════════════
const FormalAcademic = ({ page, theme, fontSettings, pageNumber, totalPages }) => {
  const { primary, bg, text, accent } = palette(theme);
  const font = resolveFont(fontSettings);
  const blocks = normalizeBlocks(page);

  const frame = {
    background: bg,
    color: text,
    fontFamily: font.family,
    padding: `${pt(56)} ${pt(72)}`,
  };

  if (page.role === "cover" || page.role === "closing") {
    return (
      <CoverOrClosing
        page={page}
        font={font}
        primary={primary}
        accent={accent}
        text={text}
        frame={frame}
        Fallback={() => (
          <>
            <div style={{ flex: 1 }} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: pt(6),
                marginBottom: pt(20),
              }}
            >
              <div style={{ width: pt(30), height: 1, background: primary }} />
              <span
                style={{
                  fontSize: pt(9),
                  letterSpacing: "0.35em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: accent,
                }}
              >
                Xamut Academic
              </span>
            </div>

            <h1
              style={{
                fontFamily: font.family,
                fontSize: pt(Math.max(30, font.headingSize + 22)),
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: "-0.01em",
                maxWidth: "80%",
              }}
            >
              {page.heading}
            </h1>

            <div
              style={{
                width: pt(50),
                height: 2,
                background: primary,
                margin: `${pt(16)} 0`,
              }}
            />

            {page.subheading ? (
              <p
                style={{
                  fontSize: pt(font.bodySize + 2),
                  fontStyle: "italic",
                  color: accent,
                  maxWidth: "70%",
                  lineHeight: 1.6,
                }}
              >
                {page.subheading}
              </p>
            ) : null}

            <p
              style={{
                marginTop: pt(40),
                fontSize: pt(9),
                letterSpacing: "0.28em",
                textTransform: "uppercase",
                color: accent,
              }}
            >
              {today()}
            </p>

            <div style={{ flex: 1 }} />
          </>
        )}
      />
    );
  }

  if (page.role === "toc") {
    const entries = tocEntries(page);
    return (
      <div className="flex h-full w-full flex-col" style={frame}>
        <h2
          style={{
            fontFamily: font.family,
            fontSize: pt(Math.max(20, font.headingSize + 4)),
            fontWeight: 700,
            marginBottom: pt(16),
          }}
        >
          {page.heading || "Table of Contents"}
        </h2>
        <div style={{ flex: 1 }}>
          {entries.map((e, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: pt(4),
                padding: `${pt(3)} 0`,
                fontSize: pt(font.bodySize),
              }}
            >
              <span style={{ fontWeight: 600, color: primary, minWidth: pt(14) }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ flex: 1 }}>{e.text}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            marginTop: pt(6),
            borderTop: `1px solid ${primary}22`,
            paddingTop: pt(4),
            textAlign: "center",
            fontSize: pt(10),
            fontStyle: "italic",
            color: accent,
          }}
        >
          {pageNumber} of {totalPages}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col" style={frame}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${primary}22`,
          paddingBottom: pt(3),
          marginBottom: pt(10),
          fontSize: pt(8.5),
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: accent,
        }}
      >
        <span>Xamut Academic</span>
        <span style={{ fontStyle: "italic", letterSpacing: "normal" }}>
          {String(pageNumber).padStart(2, "0")}
        </span>
      </div>

      <div style={{ marginBottom: pt(8) }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: pt(6),
            marginBottom: pt(3),
          }}
        >
          <span
            style={{
              fontSize: pt(9),
              fontWeight: 700,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: primary,
            }}
          >
            Section {String(Math.max(1, pageNumber - 1)).padStart(2, "0")}
          </span>
          <div style={{ flex: 1, height: 1, background: `${primary}22` }} />
        </div>
        <h2
          style={{
            fontFamily: font.family,
            fontSize: pt(Math.max(20, font.headingSize + 8)),
            fontWeight: 700,
            lineHeight: 1.2,
            letterSpacing: "-0.005em",
          }}
        >
          {page.heading}
        </h2>
        {page.subheading ? (
          <p
            style={{
              marginTop: pt(2),
              fontSize: pt(font.bodySize),
              fontStyle: "italic",
              color: accent,
            }}
          >
            {page.subheading}
          </p>
        ) : null}
      </div>

      <div style={{ flex: 1 }}>
        <Body
          blocks={blocks}
          font={font}
          color={primary}
          headingColor={text}
          paraAlign="justify"
          paraGap={6}
        />
      </div>

      <div
        style={{
          marginTop: pt(6),
          borderTop: `1px solid ${primary}22`,
          paddingTop: pt(4),
          textAlign: "center",
          fontSize: pt(10),
          fontStyle: "italic",
          color: accent,
        }}
      >
        {pageNumber} of {totalPages}
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════
// 2. Corporate Report
// ═════════════════════════════════════════════════════════════
const CorporateReport = ({ page, theme, fontSettings, pageNumber, totalPages }) => {
  const { primary, bg, text, accent } = palette(theme);
  const font = resolveFont(fontSettings);
  const blocks = normalizeBlocks(page);

  const frame = {
    background: bg,
    color: text,
    fontFamily: font.family,
    padding: `${pt(56)} ${pt(72)}`,
  };

  if (page.role === "cover" || page.role === "closing") {
    return (
      <CoverOrClosing
        page={page}
        font={font}
        primary={primary}
        accent={accent}
        text={text}
        frame={frame}
        Fallback={() => (
          <div className="relative flex h-full w-full flex-col">
            <div
              style={{
                position: "absolute",
                top: `-${pt(56)}`,
                left: `-${pt(72)}`,
                right: `-${pt(72)}`,
                height: pt(4),
                background: primary,
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: pt(9),
                letterSpacing: "0.3em",
                textTransform: "uppercase",
              }}
            >
              <span style={{ color: primary, fontWeight: 700 }}>Report</span>
              <span style={{ color: accent }}>{today()}</span>
            </div>
            <div style={{ flex: 1 }} />
            <h1
              style={{
                fontFamily: font.family,
                fontSize: pt(Math.max(32, font.headingSize + 24)),
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.015em",
                maxWidth: "85%",
              }}
            >
              {page.heading}
            </h1>
            <div
              style={{
                width: pt(50),
                height: 3,
                background: primary,
                margin: `${pt(12)} 0`,
              }}
            />
            {page.subheading ? (
              <p
                style={{
                  fontSize: pt(font.bodySize + 2),
                  lineHeight: 1.6,
                  maxWidth: "75%",
                  color: accent,
                }}
              >
                {page.subheading}
              </p>
            ) : null}
            <div style={{ flex: 1 }} />
            <div
              style={{
                borderTop: `1px solid ${primary}22`,
                paddingTop: pt(6),
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end",
                fontSize: pt(9),
              }}
            >
              <div>
                <p
                  style={{
                    letterSpacing: "0.28em",
                    textTransform: "uppercase",
                    color: accent,
                    marginBottom: pt(2),
                  }}
                >
                  Prepared by
                </p>
                <p style={{ fontWeight: 600 }}>Xamut</p>
              </div>
              <p
                style={{
                  fontFamily: "ui-monospace, monospace",
                  color: accent,
                }}
              >
                — CONFIDENTIAL —
              </p>
            </div>
          </div>
        )}
      />
    );
  }

  if (page.role === "toc") {
    const entries = tocEntries(page);
    return (
      <div className="flex h-full w-full flex-col" style={frame}>
        <h2
          style={{
            fontFamily: font.family,
            fontSize: pt(Math.max(22, font.headingSize + 6)),
            fontWeight: 700,
            marginBottom: pt(14),
          }}
        >
          {page.heading || "Contents"}
        </h2>
        {entries.map((e, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: pt(6),
              padding: `${pt(4)} 0`,
              borderBottom: `1px solid ${primary}15`,
              fontSize: pt(font.bodySize + 1),
            }}
          >
            <span
              style={{
                fontWeight: 700,
                color: primary,
                fontFamily: "ui-monospace, monospace",
                minWidth: pt(20),
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ flex: 1, fontWeight: 500 }}>{e.text}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div
          style={{
            borderTop: `1px solid ${primary}22`,
            paddingTop: pt(4),
            display: "flex",
            justifyContent: "space-between",
            fontSize: pt(9),
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: accent,
          }}
        >
          <span>Xamut</span>
          <span>
            {pageNumber} / {totalPages}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col" style={frame}>
      <div
        style={{
          position: "absolute",
          left: pt(32),
          top: pt(56),
          bottom: pt(48),
          width: pt(16),
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontSize: pt(10),
            fontWeight: 700,
            color: primary,
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {String(Math.max(1, pageNumber - 1)).padStart(2, "0")}
        </span>
        <div
          style={{
            marginTop: pt(6),
            width: 1,
            flex: 1,
            background: `${primary}22`,
          }}
        />
      </div>

      <div style={{ marginBottom: pt(10) }}>
        <p
          style={{
            fontSize: pt(9),
            fontWeight: 700,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: primary,
            marginBottom: pt(3),
          }}
        >
          {page.role === "section" ? "Section" : "Page"}
        </p>
        <h2
          style={{
            fontFamily: font.family,
            fontSize: pt(Math.max(20, font.headingSize + 8)),
            fontWeight: 700,
            lineHeight: 1.2,
          }}
        >
          {page.heading}
        </h2>
        {page.subheading ? (
          <p
            style={{
              marginTop: pt(3),
              fontSize: pt(font.bodySize),
              color: accent,
              lineHeight: font.lineHeight,
            }}
          >
            {page.subheading}
          </p>
        ) : null}
      </div>

      <div style={{ flex: 1 }}>
        <Body
          blocks={blocks}
          font={font}
          color={primary}
          headingColor={text}
          Bullet={() => (
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: pt(3),
                height: pt(3),
                background: primary,
                transform: "rotate(45deg)",
                marginTop: `calc(${font.body} * 0.5)`,
              }}
            />
          )}
        />
      </div>

      <div
        style={{
          borderTop: `1px solid ${primary}22`,
          paddingTop: pt(3),
          display: "flex",
          justifyContent: "space-between",
          fontSize: pt(9),
          letterSpacing: "0.28em",
          textTransform: "uppercase",
          color: accent,
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

// ═════════════════════════════════════════════════════════════
// 3. Warm Cream
// ═════════════════════════════════════════════════════════════
const WarmCream = ({ page, theme, fontSettings, pageNumber, totalPages }) => {
  const { primary, bg, text, accent } = palette(theme);
  const font = resolveFont(fontSettings);
  const blocks = normalizeBlocks(page);

  const frame = {
    background: bg,
    color: text,
    fontFamily: font.family,
    padding: `${pt(60)} ${pt(72)}`,
  };

  if (page.role === "cover" || page.role === "closing") {
    return (
      <CoverOrClosing
        page={page}
        font={font}
        primary={primary}
        accent={accent}
        text={text}
        frame={frame}
        Fallback={() => (
          <>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", alignItems: "center", gap: pt(3) }}>
              <div
                style={{
                  width: pt(3),
                  height: pt(3),
                  borderRadius: "50%",
                  background: accent,
                }}
              />
              <span
                style={{
                  fontSize: pt(9),
                  letterSpacing: "0.4em",
                  textTransform: "uppercase",
                  fontWeight: 600,
                  color: accent,
                }}
              >
                Xamut
              </span>
            </div>
            <h1
              style={{
                fontFamily: font.family,
                fontSize: pt(Math.max(36, font.headingSize + 28)),
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: "-0.015em",
                color: primary,
                marginTop: pt(20),
                maxWidth: "80%",
              }}
            >
              {page.heading}
            </h1>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: pt(3),
                marginTop: pt(16),
              }}
            >
              <div style={{ width: pt(50), height: 1, background: accent }} />
              <div
                style={{
                  width: pt(3),
                  height: pt(3),
                  borderRadius: "50%",
                  background: accent,
                }}
              />
              <div style={{ width: pt(15), height: 1, background: accent }} />
            </div>
            {page.subheading ? (
              <p
                style={{
                  marginTop: pt(16),
                  fontSize: pt(font.bodySize + 2),
                  fontStyle: "italic",
                  lineHeight: 1.7,
                  maxWidth: "70%",
                  opacity: 0.75,
                }}
              >
                {page.subheading}
              </p>
            ) : null}
            <p
              style={{
                marginTop: pt(40),
                fontSize: pt(11),
                fontStyle: "italic",
                color: accent,
              }}
            >
              — {today()} —
            </p>
            <div style={{ flex: 1 }} />
          </>
        )}
      />
    );
  }

  if (page.role === "toc") {
    const entries = tocEntries(page);
    return (
      <div className="flex h-full w-full flex-col" style={frame}>
        <h2
          style={{
            fontFamily: font.family,
            fontSize: pt(Math.max(22, font.headingSize + 6)),
            fontWeight: 700,
            color: primary,
            marginBottom: pt(16),
          }}
        >
          {page.heading || "Contents"}
        </h2>
        <div style={{ flex: 1 }}>
          {entries.map((e, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: pt(6),
                padding: `${pt(4)} 0`,
                fontSize: pt(font.bodySize + 1),
              }}
            >
              <span
                style={{
                  fontStyle: "italic",
                  color: accent,
                  minWidth: pt(20),
                }}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span style={{ flex: 1 }}>{e.text}</span>
            </div>
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: pt(4),
            marginTop: pt(6),
            color: accent,
            fontSize: pt(10),
            fontStyle: "italic",
          }}
        >
          <div style={{ width: pt(20), height: 1, background: `${accent}55` }} />
          <span>
            {pageNumber} of {totalPages}
          </span>
          <div style={{ width: pt(20), height: 1, background: `${accent}55` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col" style={frame}>
      <div style={{ marginBottom: pt(10) }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: pt(8) }}>
          <span
            style={{
              fontFamily: font.family,
              fontSize: pt(40),
              fontWeight: 700,
              lineHeight: 1,
              color: `${primary}30`,
            }}
          >
            {String(Math.max(1, pageNumber - 1)).padStart(2, "0")}
          </span>
          <div style={{ flex: 1, paddingBottom: pt(4) }}>
            <p
              style={{
                fontSize: pt(9),
                letterSpacing: "0.4em",
                textTransform: "uppercase",
                color: accent,
                marginBottom: pt(2),
              }}
            >
              Chapter {Math.max(1, pageNumber - 1)}
            </p>
            <h2
              style={{
                fontFamily: font.family,
                fontSize: pt(Math.max(20, font.headingSize + 8)),
                fontWeight: 700,
                lineHeight: 1.2,
                color: primary,
              }}
            >
              {page.heading}
            </h2>
          </div>
        </div>
        {page.subheading ? (
          <p
            style={{
              marginTop: pt(4),
              fontSize: pt(font.bodySize),
              fontStyle: "italic",
              opacity: 0.72,
            }}
          >
            {page.subheading}
          </p>
        ) : null}
      </div>

      <div style={{ flex: 1 }}>
        <Body
          blocks={blocks}
          font={font}
          color={primary}
          headingColor={primary}
          dropCapFirst
          dropCapColor={primary}
          paraGap={6}
          Bullet={() => (
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: pt(2.5),
                height: pt(2.5),
                borderRadius: "50%",
                background: accent,
                marginTop: `calc(${font.body} * 0.65)`,
              }}
            />
          )}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: pt(4),
          marginTop: pt(6),
          fontSize: pt(10),
          fontStyle: "italic",
          color: accent,
        }}
      >
        <div style={{ width: pt(15), height: 1, background: `${accent}55` }} />
        <span>
          {pageNumber} of {totalPages}
        </span>
        <div style={{ width: pt(15), height: 1, background: `${accent}55` }} />
      </div>
    </div>
  );
};

// ═════════════════════════════════════════════════════════════
// 4. Minimal Slate
// ═════════════════════════════════════════════════════════════
const MinimalSlate = ({ page, theme, fontSettings, pageNumber, totalPages }) => {
  const { primary, bg, text, accent } = palette(theme);
  const font = resolveFont(fontSettings);
  const blocks = normalizeBlocks(page);

  const frame = {
    background: bg,
    color: text,
    fontFamily: font.family,
    padding: `${pt(60)} ${pt(72)}`,
  };

  if (page.role === "cover" || page.role === "closing") {
    return (
      <CoverOrClosing
        page={page}
        font={font}
        primary={primary}
        accent={accent}
        text={text}
        frame={frame}
        Fallback={() => (
          <div className="flex h-full w-full flex-col">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: pt(3) }}>
                <div
                  style={{
                    width: pt(4),
                    height: pt(4),
                    borderRadius: "50%",
                    background: primary,
                  }}
                />
                <span
                  style={{
                    fontSize: pt(10),
                    letterSpacing: "0.35em",
                    textTransform: "uppercase",
                    fontWeight: 600,
                  }}
                >
                  Xamut
                </span>
              </div>
              <span
                style={{
                  fontSize: pt(10),
                  letterSpacing: "0.3em",
                  textTransform: "uppercase",
                  color: accent,
                }}
              >
                {today()}
              </span>
            </div>
            <div style={{ flex: 1 }} />
            <h1
              style={{
                fontFamily: font.family,
                fontSize: pt(Math.max(38, font.headingSize + 30)),
                fontWeight: 700,
                lineHeight: 1.05,
                letterSpacing: "-0.02em",
                maxWidth: "85%",
              }}
            >
              {page.heading}
            </h1>
            {page.subheading ? (
              <p
                style={{
                  marginTop: pt(14),
                  fontSize: pt(font.bodySize + 2),
                  lineHeight: 1.7,
                  maxWidth: "70%",
                  color: accent,
                }}
              >
                {page.subheading}
              </p>
            ) : null}
            <div style={{ flex: 1 }} />
            <div
              style={{
                borderTop: `1px solid ${primary}22`,
                paddingTop: pt(4),
                display: "flex",
                justifyContent: "space-between",
                fontSize: pt(9),
                letterSpacing: "0.3em",
                textTransform: "uppercase",
                color: accent,
              }}
            >
              <span>A document by Xamut</span>
              <span style={{ fontFamily: "ui-monospace, monospace" }}>
                01 / {totalPages}
              </span>
            </div>
          </div>
        )}
      />
    );
  }

  if (page.role === "toc") {
    const entries = tocEntries(page);
    return (
      <div className="flex h-full w-full flex-col" style={frame}>
        <h2
          style={{
            fontFamily: font.family,
            fontSize: pt(Math.max(24, font.headingSize + 8)),
            fontWeight: 700,
            marginBottom: pt(16),
            letterSpacing: "-0.01em",
          }}
        >
          {page.heading || "Contents"}
        </h2>
        {entries.map((e, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: pt(6),
              padding: `${pt(3)} 0`,
              borderBottom: `1px solid ${primary}10`,
              fontSize: pt(font.bodySize + 1),
            }}
          >
            <span
              style={{
                fontFamily: "ui-monospace, monospace",
                color: primary,
                minWidth: pt(18),
              }}
            >
              {String(i + 1).padStart(2, "0")}
            </span>
            <span style={{ flex: 1 }}>{e.text}</span>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div
          style={{
            borderTop: `1px solid ${primary}15`,
            paddingTop: pt(4),
            display: "flex",
            justifyContent: "space-between",
            fontSize: pt(9),
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: accent,
          }}
        >
          <span>Xamut</span>
          <span style={{ fontFamily: "ui-monospace, monospace" }}>
            {pageNumber} / {totalPages}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col" style={frame}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: pt(8),
          borderBottom: `1px solid ${primary}15`,
          paddingBottom: pt(6),
          marginBottom: pt(12),
        }}
      >
        <span
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: pt(10),
            color: primary,
          }}
        >
          {String(pageNumber).padStart(2, "0")}
        </span>
        <div style={{ flex: 1, height: 1, background: `${primary}15` }} />
        <span
          style={{
            fontSize: pt(9),
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: accent,
          }}
        >
          {page.role === "section" ? "Section" : "Page"}
        </span>
      </div>

      <div style={{ marginBottom: pt(10) }}>
        <h2
          style={{
            fontFamily: font.family,
            fontSize: pt(Math.max(24, font.headingSize + 12)),
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-0.015em",
          }}
        >
          {page.heading}
        </h2>
        {page.subheading ? (
          <p
            style={{
              marginTop: pt(4),
              fontSize: pt(font.bodySize),
              color: accent,
              lineHeight: font.lineHeight,
            }}
          >
            {page.subheading}
          </p>
        ) : null}
      </div>

      <div style={{ flex: 1 }}>
        <Body
          blocks={blocks}
          font={font}
          color={primary}
          headingColor={text}
          paraGap={7}
          Bullet={() => (
            <span
              aria-hidden
              style={{
                flexShrink: 0,
                width: pt(12),
                height: 1,
                background: primary,
                marginTop: `calc(${font.body} * 0.72)`,
              }}
            />
          )}
        />
      </div>

      <div
        style={{
          borderTop: `1px solid ${primary}15`,
          paddingTop: pt(4),
          display: "flex",
          justifyContent: "space-between",
          fontSize: pt(9),
          letterSpacing: "0.3em",
          textTransform: "uppercase",
          color: accent,
        }}
      >
        <span>Xamut</span>
        <span style={{ fontFamily: "ui-monospace, monospace" }}>
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
  { id: "formal-academic", label: "Formal Academic", primary: "2E7D32", secondary: "FFFFFF", accent: "6B7280" },
  { id: "corporate-report", label: "Corporate Report", primary: "1565C0", secondary: "FFFFFF", accent: "0D47A1" },
  { id: "warm-cream", label: "Warm Cream", primary: "5D4037", secondary: "F5F1E8", accent: "C9A227" },
  { id: "minimal-slate", label: "Minimal Slate", primary: "1E293B", secondary: "FFFFFF", accent: "64748B" },
];

export const DEFAULT_PDF_TEMPLATE = "formal-academic";