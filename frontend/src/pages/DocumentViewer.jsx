// pages/DocumentViewer.jsx
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  useGetDocumentQuery,
  useUpdateDocumentMutation,
  useDeleteDocumentMutation,
} from "../features/aiApiSlice";
import {
  PdfDesigns,
  PDF_TEMPLATE_LIST,
  DEFAULT_PDF_TEMPLATE,
} from "../features/templates/PdfDesigns";
import {
  PptDesigns,
  PPT_TEMPLATE_LIST,
  DEFAULT_PPT_TEMPLATE,
} from "../features/templates/PowerPointDesigns";

// ─────────────────────────────────────────────────────────────
// A4 words-per-page reference (mirrors backend)
// ─────────────────────────────────────────────────────────────
const A4_WORDS_PER_PAGE = {
  10: { 1.0: 600, 1.15: 520, 1.5: 400, 2.0: 300 },
  11: { 1.0: 550, 1.15: 480, 1.5: 370, 2.0: 275 },
  12: { 1.0: 500, 1.15: 435, 1.5: 335, 2.0: 250 },
  13: { 1.0: 450, 1.15: 390, 1.5: 300, 2.0: 225 },
  14: { 1.0: 400, 1.15: 350, 1.5: 270, 2.0: 200 },
  15: { 1.0: 355, 1.15: 310, 1.5: 240, 2.0: 180 },
  16: { 1.0: 320, 1.15: 280, 1.5: 215, 2.0: 160 },
  18: { 1.0: 260, 1.15: 225, 1.5: 175, 2.0: 130 },
};

const computeWordsPerPage = ({ bodyFontSize = 12, lineSpacing = 1.5 } = {}) => {
  const table = A4_WORDS_PER_PAGE[bodyFontSize] || A4_WORDS_PER_PAGE[12];
  const keys = Object.keys(table).map(Number);
  const nearest = keys.reduce((a, b) =>
    Math.abs(b - lineSpacing) < Math.abs(a - lineSpacing) ? b : a
  );
  return table[nearest];
};

const DEFAULT_FONT_SETTINGS = {
  bodyFontSize: 12,
  headingFontSize: 16,
  fontFamily: "Calibri",
  lineSpacing: 1.5,
};

// Kind → pretty label. Purely cosmetic; the renderer itself doesn't
// branch on kind.
const KIND_LABEL = {
  assignment: "Assignment",
  essay: "Essay",
  letter: "Letter",
  report: "Report",
  memo: "Memo",
  notes: "Notes",
  guide: "Guide",
  manual: "Manual",
  article: "Article",
  proposal: "Proposal",
  speech: "Speech",
  bio: "Bio",
  summary: "Summary",
  "study-guide": "Study guide",
  story: "Story",
  tutorial: "Tutorial",
  other: "Document",
  document: "Document",
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
const slugify = (text, fallback = "Xamut_File") =>
  String(text || "")
    .replace(/[^a-zA-Z0-9\s_]/g, "")
    .trim()
    .replace(/\s+/g, "_") || fallback;

const useDebouncedEffect = (fn, deps, delay) => {
  useEffect(() => {
    const t = setTimeout(fn, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
};

const resolveTemplate = (map, list, defaultId, templateId) => {
  const isKnown = list.some((t) => t.id === templateId);
  if (isKnown && map[templateId]) return map[templateId];
  return map[defaultId];
};

// ─────────────────────────────────────────────────────────────
// Reusable UI atoms
// ─────────────────────────────────────────────────────────────
const Section = ({ title, children }) => (
  <div className="mb-5 last:mb-0">
    <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
      {title}
    </p>
    <div className="space-y-2">{children}</div>
  </div>
);

const ColorField = ({ label, value, onChange }) => (
  <div>
    <label className="mb-1 block text-[11px] font-semibold text-stone-500 dark:text-stone-400">
      {label}
    </label>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={`#${value || "000000"}`}
        onChange={(e) => onChange(e.target.value.replace("#", "").toUpperCase())}
        className="h-8 w-9 cursor-pointer rounded-md border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800"
      />
      <input
        type="text"
        value={value || ""}
        onChange={(e) => {
          const v = e.target.value.replace("#", "").toUpperCase().slice(0, 6);
          if (/^[0-9A-F]{0,6}$/.test(v)) onChange(v);
        }}
        className="flex-1 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 font-mono text-[11.5px] text-stone-700 outline-none transition-colors focus:border-teal-400 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:focus:border-teal-500/60"
      />
    </div>
  </div>
);

const NumberRow = ({
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  unit = "",
  onChange,
}) => {
  const safe = Number.isFinite(Number(value)) ? Number(value) : "";
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-stone-700 dark:text-stone-200">
          {label}
        </p>
        {hint ? (
          <p className="mt-0.5 text-[10.5px] leading-snug text-stone-400 dark:text-stone-500">
            {hint}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={safe}
          onChange={(e) => {
            if (e.target.value === "") return onChange(null);
            const n = Number(e.target.value);
            if (Number.isNaN(n)) return;
            onChange(Math.min(Math.max(n, min), max));
          }}
          className="w-16 rounded-md border border-stone-200 bg-white px-2 py-1 text-center text-[12px] font-semibold text-stone-800 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
        />
        {unit ? (
          <span className="text-[11px] text-stone-400 dark:text-stone-500">
            {unit}
          </span>
        ) : null}
      </div>
    </div>
  );
};

const SegmentedControl = ({ value, onChange, options }) => (
  <div className="grid grid-cols-4 gap-0.5 rounded-md border border-stone-200/70 bg-stone-50/70 p-0.5 dark:border-stone-800/70 dark:bg-stone-900/50">
    {options.map((o) => {
      const active = value === o.value;
      return (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-md py-1 text-[10.5px] font-semibold leading-tight transition-colors ${
            active
              ? "bg-white text-teal-600 shadow-sm ring-1 ring-stone-900/5 dark:bg-stone-800 dark:text-teal-400 dark:ring-stone-100/5"
              : "text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200"
          }`}
        >
          {o.label}
        </button>
      );
    })}
  </div>
);

const ToggleRow = ({ label, hint, checked, onChange }) => (
  <label className="flex cursor-pointer select-none items-start justify-between gap-3">
    <span className="min-w-0">
      <span className="block text-[12px] font-medium text-stone-700 dark:text-stone-200">
        {label}
      </span>
      {hint ? (
        <span className="mt-0.5 block text-[10.5px] leading-snug text-stone-400 dark:text-stone-500">
          {hint}
        </span>
      ) : null}
    </span>
    <span className="relative mt-0.5 inline-flex h-5 w-9 shrink-0">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="absolute inset-0 rounded-full bg-stone-200 transition-colors peer-checked:bg-teal-500 dark:bg-stone-700 dark:peer-checked:bg-teal-500" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4 dark:bg-stone-100" />
    </span>
  </label>
);

// ─────────────────────────────────────────────────────────────
// Theme + typography + structure panel
// ─────────────────────────────────────────────────────────────
const ThemePanel = ({
  theme,
  fontSettings,
  meta,
  templateList,
  isPresentation,
  dirty,
  bare = false,
  onClose,
  onChangeTheme,
  onChangeFont,
  onChangeMeta,
}) => {
  if (!theme || !fontSettings || !meta) return null;

  const wordsPerPage = computeWordsPerPage(fontSettings);
  const activeTemplate = templateList.find((t) => t.id === theme.templateId);

  return (
    <div>
      {!bare && (
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold tracking-tight text-stone-900 dark:text-stone-100">
            Customize
          </h2>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-md p-1 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label="Close"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-3.5 w-3.5"
              >
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      )}

      <Section title="Colors">
        <ColorField
          label="Primary"
          value={theme.primaryColor}
          onChange={(v) => onChangeTheme({ primaryColor: v })}
        />
        <ColorField
          label="Background"
          value={theme.secondaryColor}
          onChange={(v) => onChangeTheme({ secondaryColor: v })}
        />
        <ColorField
          label="Accent"
          value={theme.accentColor}
          onChange={(v) => onChangeTheme({ accentColor: v })}
        />
        <ColorField
          label="Text"
          value={theme.textColor}
          onChange={(v) => onChangeTheme({ textColor: v })}
        />
        <button
          type="button"
          onClick={() => {
            if (!activeTemplate) return;
            onChangeTheme({
              primaryColor: activeTemplate.primary,
              secondaryColor: activeTemplate.secondary,
              accentColor: activeTemplate.accent,
            });
          }}
          className="mt-1 w-full rounded-md border border-stone-200 bg-white py-1.5 text-[11.5px] font-semibold text-stone-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10 dark:hover:text-teal-400"
        >
          Reset to template default
        </button>
      </Section>

      <div className="mb-5 border-t border-stone-100 pt-4 dark:border-stone-800">
        <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
          Typography
        </p>
        <div className="space-y-3">
          <NumberRow
            label="Body size"
            hint={`≈ ${wordsPerPage} words / A4 page`}
            value={fontSettings.bodyFontSize}
            min={8}
            max={32}
            unit="pt"
            onChange={(v) => v != null && onChangeFont({ bodyFontSize: v })}
          />
          <NumberRow
            label="Heading size"
            value={fontSettings.headingFontSize}
            min={10}
            max={40}
            unit="pt"
            onChange={(v) => v != null && onChangeFont({ headingFontSize: v })}
          />
          <div>
            <p className="mb-1.5 text-[12px] font-medium text-stone-700 dark:text-stone-200">
              Line spacing
            </p>
            <SegmentedControl
              value={fontSettings.lineSpacing}
              onChange={(v) => onChangeFont({ lineSpacing: v })}
              options={[
                { value: 1, label: "1.0" },
                { value: 1.15, label: "1.15" },
                { value: 1.5, label: "1.5" },
                { value: 2, label: "2.0" },
              ]}
            />
          </div>
          <div>
            <label className="mb-1 block text-[12px] font-medium text-stone-700 dark:text-stone-200">
              Font family
            </label>
            <select
              value={fontSettings.fontFamily}
              onChange={(e) => onChangeFont({ fontFamily: e.target.value })}
              className="w-full rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[12px] text-stone-800 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-500/10 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
            >
              {[
                "Calibri",
                "Arial",
                "Georgia",
                "Times New Roman",
                "Helvetica",
                "Cambria",
                "Garamond",
              ].map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {!isPresentation && (
        <div className="border-t border-stone-100 pt-4 dark:border-stone-800">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-stone-400 dark:text-stone-500">
            Page structure
          </p>
          <div className="space-y-3">
            <NumberRow
              label="Target page count"
              hint="Guides the AI on regenerate"
              value={meta.pageCount ?? ""}
              min={1}
              max={40}
              unit="pp"
              onChange={(v) => onChangeMeta({ pageCount: v })}
            />
            <ToggleRow
              label="Cover page"
              hint="Title + subtitle page at the top"
              checked={meta.includeCoverPage}
              onChange={(v) => onChangeMeta({ includeCoverPage: v })}
            />
            <ToggleRow
              label="Table of contents"
              hint="Sections with page numbers"
              checked={meta.includeTableOfContents}
              onChange={(v) => onChangeMeta({ includeTableOfContents: v })}
            />
          </div>
        </div>
      )}

      {dirty && (
        <p className="mt-4 text-center text-[10px] text-stone-400 dark:text-stone-500">
          Saving…
        </p>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Thumbnail wrapper
// ─────────────────────────────────────────────────────────────
const TemplateThumb = ({
  Template,
  page,
  theme,
  fontSettings,
  pageNumber,
  totalPages,
  aspectRatioNum,
}) => {
  const scale = 0.28;
  return (
    <div
      className="pointer-events-none h-full w-full origin-top-left overflow-hidden"
      style={{ transform: `scale(${scale})` }}
    >
      <div
        style={{
          width: `${100 / scale}%`,
          height: `${100 / scale}%`,
          aspectRatio: aspectRatioNum,
          containerType: "inline-size",
        }}
      >
        <Template
          page={page}
          theme={theme}
          fontSettings={fontSettings}
          pageNumber={pageNumber}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────
const DocumentViewer = () => {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data, isLoading, error } = useGetDocumentQuery(id);
  const [updateDocument] = useUpdateDocumentMutation();
  const [deleteDocument, { isLoading: isDeleting }] =
    useDeleteDocumentMutation();

  const doc = data?.document;
  const isPresentation = doc?.type === "presentation";
  const pages = doc?.pages || [];
  const totalPages = pages.length;

  const [currentPage, setCurrentPage] = useState(0);
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showMobileSheet, setShowMobileSheet] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const [theme, setTheme] = useState(null);
  const [fontSettings, setFontSettings] = useState(null);
  const [meta, setMeta] = useState(null);

  const [themeDirty, setThemeDirty] = useState(false);
  const [fontDirty, setFontDirty] = useState(false);
  const [metaDirty, setMetaDirty] = useState(false);

  const hiddenRef = useRef(null);

  useEffect(() => {
    if (!doc) return;
    setTheme({ ...doc.theme });
    setFontSettings({
      ...DEFAULT_FONT_SETTINGS,
      ...(doc.fontSettings || {}),
    });
    setMeta({
      pageCount: doc.pageCount ?? null,
      includeCoverPage: doc.includeCoverPage === true,
      includeTableOfContents: doc.includeTableOfContents === true,
    });
    setCurrentPage(0);
    setThemeDirty(false);
    setFontDirty(false);
    setMetaDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc?._id]);

  const anyDirty = themeDirty || fontDirty || metaDirty;

  useDebouncedEffect(
    () => {
      if (!anyDirty || !doc?._id) return;
      const payload = {};
      if (themeDirty && theme) payload.theme = theme;
      if (fontDirty && fontSettings) payload.fontSettings = fontSettings;
      if (metaDirty && meta) {
        payload.pageCount = meta.pageCount ?? null;
        payload.includeCoverPage = !!meta.includeCoverPage;
        payload.includeTableOfContents = !!meta.includeTableOfContents;
      }
      updateDocument({ id: doc._id, ...payload })
        .unwrap()
        .catch(() => {})
        .finally(() => {
          setThemeDirty(false);
          setFontDirty(false);
          setMetaDirty(false);
        });
    },
    [anyDirty, theme, fontSettings, meta],
    600
  );

  const templateList = isPresentation ? PPT_TEMPLATE_LIST : PDF_TEMPLATE_LIST;
  const defaultTemplateId = isPresentation
    ? DEFAULT_PPT_TEMPLATE
    : DEFAULT_PDF_TEMPLATE;

  const Template = isPresentation
    ? resolveTemplate(
        PptDesigns,
        PPT_TEMPLATE_LIST,
        DEFAULT_PPT_TEMPLATE,
        theme?.templateId
      )
    : resolveTemplate(
        PdfDesigns,
        PDF_TEMPLATE_LIST,
        DEFAULT_PDF_TEMPLATE,
        theme?.templateId
      );

  const updateTheme = (patch) => {
    setTheme((t) => ({ ...t, ...patch }));
    setThemeDirty(true);
  };

  const updateFont = (patch) => {
    setFontSettings((f) => ({ ...f, ...patch }));
    setFontDirty(true);
  };

  const updateMeta = (patch) => {
    setMeta((m) => ({ ...m, ...patch }));
    setMetaDirty(true);
  };

  const handleSelectTemplate = (templateId) => {
    const def = templateList.find((t) => t.id === templateId);
    updateTheme({
      templateId,
      primaryColor: def?.primary || theme.primaryColor,
      secondaryColor: def?.secondary || theme.secondaryColor,
      accentColor: def?.accent || theme.accentColor,
    });
    setShowTemplatePicker(false);
    setShowMobileSheet(false);
  };

  // ─── Downloads ─────────────────────────────────────────────
  const downloadPdf = async () => {
    if (!hiddenRef.current || !doc) return;
    setDownloading(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const opt = {
        margin: 0,
        filename: `${slugify(doc.title)}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: {
          unit: "mm",
          format: "a4",
          orientation: isPresentation ? "landscape" : "portrait",
        },
        pagebreak: { mode: ["css", "legacy"] },
      };
      await html2pdf().set(opt).from(hiddenRef.current).save();
    } catch (err) {
      console.error("PDF download failed:", err);
    } finally {
      setDownloading(false);
    }
  };

  const downloadPptx = async () => {
    if (!doc || !theme) return;
    setDownloading(true);
    try {
      const PptxGenJS = (await import("pptxgenjs")).default;
      const pptx = new PptxGenJS();
      pptx.layout = "LAYOUT_WIDE";
      pptx.author = "Xamut";
      pptx.title = doc.title || "Presentation";

      const primary = theme.primaryColor || "2E7D32";
      const bg = theme.secondaryColor || "FFFFFF";
      const dark = theme.textColor || "111111";

      pages.forEach((p, idx) => {
        const slide = pptx.addSlide();

        if (p.role === "cover" || p.role === "closing") {
          slide.background = { color: dark };
          slide.addShape(pptx.ShapeType.rect, {
            x: 0,
            y: 3.55,
            w: 13.33,
            h: 0.06,
            fill: { color: primary },
            line: { color: primary },
          });
          slide.addText(p.heading || doc.title, {
            x: 0.8,
            y: 2.3,
            w: 11.7,
            h: 1.3,
            fontSize: 40,
            bold: true,
            color: "FFFFFF",
          });
          if (p.subheading) {
            slide.addText(p.subheading, {
              x: 0.8,
              y: 3.85,
              w: 11.7,
              h: 0.8,
              fontSize: 18,
              color: primary,
            });
          }
          slide.addText(doc.companyName || "Prepared by Xamut", {
            x: 10.5,
            y: 6.9,
            w: 2.3,
            h: 0.4,
            fontSize: 10,
            color: "888888",
            align: "right",
          });
        } else if (p.role === "toc") {
          slide.background = { color: bg };
          slide.addShape(pptx.ShapeType.rect, {
            x: 0,
            y: 0,
            w: 13.33,
            h: 0.14,
            fill: { color: primary },
            line: { color: primary },
          });
          slide.addText(p.heading || "Agenda", {
            x: 0.8,
            y: 0.45,
            w: 11.5,
            h: 0.9,
            fontSize: 26,
            bold: true,
            color: dark,
          });
          const entries = (p.blocks || [])
            .filter((b) => b.type === "toc-entry")
            .map((b) => ({
              text: b.text || "",
              options: {
                bullet: { code: "25AA", color: primary },
                fontSize: 18,
                color: "2B2B2B",
                paraSpaceAfter: 12,
              },
            }));
          if (entries.length) {
            slide.addText(entries, {
              x: 0.9,
              y: 1.6,
              w: 11.3,
              h: 5.2,
              valign: "top",
            });
          }
        } else {
          slide.background = { color: bg };
          slide.addShape(pptx.ShapeType.rect, {
            x: 0,
            y: 0,
            w: 13.33,
            h: 0.14,
            fill: { color: primary },
            line: { color: primary },
          });
          slide.addText(p.heading || "", {
            x: 0.8,
            y: 0.45,
            w: 11.5,
            h: 0.9,
            fontSize: 26,
            bold: true,
            color: dark,
          });

          const bulletItems = [];
          const bodyParas = [];
          for (const b of p.blocks || []) {
            if (b.type === "bullets" || b.type === "numbered") {
              for (const it of b.items || []) bulletItems.push(it);
            } else if (b.type === "paragraph") {
              bodyParas.push(b.text || "");
            }
          }
          if (!bulletItems.length)
            for (const b of p.bullets || []) bulletItems.push(b);
          if (!bodyParas.length)
            for (const pp of p.paragraphs || []) bodyParas.push(pp);

          if (bulletItems.length) {
            slide.addText(
              bulletItems.map((t) => ({
                text: t,
                options: {
                  bullet: { code: "25AA", color: primary },
                  fontSize: 18,
                  color: "2B2B2B",
                  paraSpaceAfter: 10,
                },
              })),
              { x: 0.9, y: 1.6, w: 11.3, h: 5.2, valign: "top" }
            );
          }
          if (bodyParas.length) {
            slide.addText(bodyParas.join(" "), {
              x: 0.9,
              y: 5.2,
              w: 11.3,
              h: 1.8,
              fontSize: 12,
              color: "555555",
              valign: "top",
            });
          }
          slide.addText(String(idx + 1), {
            x: 12.5,
            y: 7.35,
            w: 0.6,
            h: 0.3,
            fontSize: 10,
            color: "888888",
            align: "right",
          });
          if (p.notes) slide.addNotes(p.notes);
        }
      });

      await pptx.writeFile({ fileName: `${slugify(doc.title)}.pptx` });
    } catch (err) {
      console.error("PPTX download failed:", err);
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = async () => {
    if (!doc) return;
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    try {
      await deleteDocument(doc._id).unwrap();
      navigate("/chat", { replace: true });
    } catch {
      /* ignore */
    }
  };

  // ─── Loading / error ───────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-100 dark:bg-stone-950">
        <div className="flex items-center gap-3 text-stone-500 dark:text-stone-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-teal-500 dark:border-stone-700 dark:border-t-teal-400" />
          Loading document…
        </div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-stone-100 px-6 text-center dark:bg-stone-950">
        <p className="text-lg font-semibold text-stone-800 dark:text-stone-100">
          Document not found
        </p>
        <p className="max-w-sm text-sm text-stone-500 dark:text-stone-400">
          It may have been deleted, or the link is incorrect.
        </p>
        <Link
          to="/chat"
          className="rounded-md bg-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm shadow-teal-500/25 hover:bg-teal-700 dark:bg-teal-500 dark:hover:bg-teal-400"
        >
          Back to chat
        </Link>
      </div>
    );
  }

  const aspect = isPresentation ? "16 / 9" : "8.5 / 11";
  const aspectRatioNum = isPresentation ? 16 / 9 : 8.5 / 11;
  const maxPx = isPresentation ? 1100 : 820;

  const kindKey = (doc.kind || "").toLowerCase();
  const kindLabel = isPresentation
    ? "Slides"
    : KIND_LABEL[kindKey] || "Document";

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-stone-100 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-stone-200/70 bg-white px-3 dark:border-stone-800/70 dark:bg-stone-950 sm:gap-3 sm:px-5">
        <button
          onClick={() => navigate(-1)}
          className="rounded-md p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
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
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${
                isPresentation
                  ? "bg-teal-50 text-teal-700 dark:bg-teal-500/15 dark:text-teal-400"
                  : "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-400"
              }`}
            >
              {isPresentation ? (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-2.5 w-2.5"
                >
                  <rect x="3" y="4" width="18" height="12" rx="1.5" />
                  <path d="M8 20h8M12 16v4" strokeLinecap="round" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="h-2.5 w-2.5"
                >
                  <path
                    d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                    strokeLinecap="round"
                  />
                  <path d="M14 2v6h6" strokeLinecap="round" />
                </svg>
              )}
              {kindLabel}
            </span>
            <h1 className="truncate text-sm font-semibold text-stone-900 dark:text-stone-100">
              {doc.title || "Untitled"}
            </h1>
          </div>
          <p className="truncate text-[11px] text-stone-400 dark:text-stone-500">
            Page {currentPage + 1} of {totalPages} ·{" "}
            {isPresentation
              ? "Landscape 16:9"
              : `${fontSettings?.bodyFontSize || 12}pt · A4 Portrait`}
            {!isPresentation && meta?.pageCount
              ? ` · target ${meta.pageCount}pp`
              : ""}
          </p>
        </div>

        {/* Template picker (desktop) */}
        <div className="relative hidden sm:block">
          <button
            onClick={() => setShowTemplatePicker((s) => !s)}
            className="flex items-center gap-2 rounded-md border border-stone-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-stone-600 transition-colors hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-teal-500/50 dark:hover:bg-teal-500/10 dark:hover:text-teal-400"
          >
            <span
              className="h-3 w-3 rounded-full"
              style={{ background: `#${theme?.primaryColor || "2E7D32"}` }}
            />
            {templateList.find((t) => t.id === theme?.templateId)?.label ||
              "Template"}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="h-3 w-3"
            >
              <path d="M6 9l6 6 6-6" strokeLinecap="round" />
            </svg>
          </button>

          {showTemplatePicker && (
            <>
              <div
                className="fixed inset-0 z-20"
                onClick={() => setShowTemplatePicker(false)}
              />
              <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-stone-200 bg-white p-2 shadow-xl shadow-stone-900/10 dark:border-stone-700 dark:bg-stone-900 dark:shadow-black/40">
                <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                  {isPresentation
                    ? "Presentation templates"
                    : "Document templates"}
                </p>
                <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto">
                  {templateList.map((t) => {
                    const active = t.id === theme?.templateId;
                    return (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTemplate(t.id)}
                        className={`flex items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                          active
                            ? "bg-teal-50 text-teal-900 dark:bg-teal-500/15 dark:text-teal-200"
                            : "text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
                        }`}
                      >
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                          style={{ background: `#${t.primary}` }}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ background: `#${t.secondary}` }}
                          />
                        </span>
                        <span className="flex-1 truncate font-medium">
                          {t.label}
                        </span>
                        {active && (
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            className="h-3.5 w-3.5 text-teal-500 dark:text-teal-400"
                          >
                            <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Theme panel toggle (desktop) */}
        <button
          onClick={() => setShowThemePanel((s) => !s)}
          className={`hidden rounded-md p-2 transition-colors md:block ${
            showThemePanel
              ? "bg-teal-50 text-teal-600 dark:bg-teal-500/15 dark:text-teal-400"
              : "text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          }`}
          aria-label="Customize"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            className="h-4 w-4"
          >
            <circle cx="12" cy="12" r="9" />
            <circle cx="8.5" cy="10" r="1" fill="currentColor" />
            <circle cx="15.5" cy="10" r="1" fill="currentColor" />
            <circle cx="9.5" cy="15.5" r="1" fill="currentColor" />
            <circle cx="14.5" cy="15.5" r="1" fill="currentColor" />
          </svg>
        </button>

        {/* Mobile: sheet toggle */}
        <button
          onClick={() => setShowMobileSheet(true)}
          className="rounded-md p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-100 md:hidden"
          aria-label="Options"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="h-4 w-4"
          >
            <circle cx="12" cy="5" r="1.4" fill="currentColor" />
            <circle cx="12" cy="12" r="1.4" fill="currentColor" />
            <circle cx="12" cy="19" r="1.4" fill="currentColor" />
          </svg>
        </button>

        {/* Delete */}
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="hidden rounded-md p-2 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40 dark:hover:bg-red-500/10 sm:block"
          aria-label="Delete document"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            className="h-4 w-4"
          >
            <path
              d="M3 6h18M8 6v14a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6M10 11v6M14 11v6"
              strokeLinecap="round"
            />
          </svg>
        </button>

        {/* Download */}
        <button
          onClick={isPresentation ? downloadPptx : downloadPdf}
          disabled={downloading}
          className="flex items-center gap-1.5 rounded-md bg-teal-600 px-3.5 py-2 text-[12px] font-semibold text-white shadow-sm shadow-teal-500/25 transition-all hover:bg-teal-700 active:scale-[0.97] disabled:opacity-60 dark:bg-teal-500 dark:hover:bg-teal-400"
        >
          {downloading ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : (
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
          )}
          <span className="hidden sm:inline">
            {downloading
              ? "Downloading…"
              : isPresentation
              ? "PPTX"
              : "PDF"}
          </span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-44 shrink-0 overflow-y-auto border-r border-stone-200/70 bg-white/60 p-3 dark:border-stone-800/70 dark:bg-stone-900/40 md:block">
          <div className="space-y-2">
            {pages.map((p, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                className={`group relative block w-full overflow-hidden rounded-md border-2 transition-all ${
                  currentPage === i
                    ? "border-teal-500 shadow-md shadow-teal-500/20"
                    : "border-stone-200 hover:border-stone-300 dark:border-stone-700 dark:hover:border-stone-600"
                }`}
              >
                <div className="w-full bg-white" style={{ aspectRatio: aspect }}>
                  <TemplateThumb
                    Template={Template}
                    page={p}
                    theme={theme}
                    fontSettings={fontSettings}
                    pageNumber={i + 1}
                    totalPages={totalPages}
                    aspectRatioNum={aspectRatioNum}
                  />
                </div>
                <span className="absolute bottom-1 right-1 rounded bg-stone-900/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                  {i + 1}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-8"
            style={{ containerType: "size" }}
          >
            {Template && pages[currentPage] ? (
              <div
                className={`overflow-hidden bg-white ${
                  isPresentation
                    ? "rounded-lg shadow-[0_25px_50px_-12px_rgba(28,25,23,0.35)] dark:shadow-[0_25px_50px_-12px_rgba(0,0,0,0.7)]"
                    : "rounded-lg border border-stone-200/80 shadow-[0_1px_3px_rgba(28,25,23,0.06),0_20px_40px_-24px_rgba(28,25,23,0.28)] dark:border-stone-800"
                }`}
                style={{
                  width: `min(100cqw, ${maxPx}px, calc(100cqh * ${aspectRatioNum}))`,
                  aspectRatio: aspect,
                  containerType: "inline-size",
                }}
              >
                <Template
                  page={pages[currentPage]}
                  theme={theme}
                  fontSettings={fontSettings}
                  pageNumber={currentPage + 1}
                  totalPages={totalPages}
                />
              </div>
            ) : (
              <p className="text-sm text-stone-500 dark:text-stone-400">
                Nothing to preview.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-center gap-2 border-t border-stone-200/70 bg-white/70 px-4 py-3 backdrop-blur dark:border-stone-800/70 dark:bg-stone-950/70">
            <button
              onClick={() => setCurrentPage((i) => Math.max(0, i - 1))}
              disabled={currentPage === 0}
              className="rounded-md border border-stone-200 bg-white p-2 text-stone-500 transition-colors hover:border-teal-300 hover:text-teal-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-teal-500/50 dark:hover:text-teal-400"
              aria-label="Previous page"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
              >
                <path d="M15 18l-6-6 6-6" strokeLinecap="round" />
              </svg>
            </button>

            <div className="flex items-center gap-2 px-3">
              <input
                type="number"
                min="1"
                max={totalPages}
                value={currentPage + 1}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (n >= 1 && n <= totalPages) setCurrentPage(n - 1);
                }}
                className="w-12 rounded-md border border-stone-200 bg-white py-1 text-center text-sm font-semibold text-stone-800 outline-none focus:border-teal-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-100"
              />
              <span className="text-xs text-stone-400 dark:text-stone-500">
                / {totalPages}
              </span>
            </div>

            <button
              onClick={() =>
                setCurrentPage((i) => Math.min(totalPages - 1, i + 1))
              }
              disabled={currentPage === totalPages - 1}
              className="rounded-md border border-stone-200 bg-white p-2 text-stone-500 transition-colors hover:border-teal-300 hover:text-teal-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:border-teal-500/50 dark:hover:text-teal-400"
              aria-label="Next page"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="h-4 w-4"
              >
                <path d="M9 6l6 6-6 6" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </main>

        {showThemePanel && (
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-stone-200/70 bg-white p-4 dark:border-stone-800/70 dark:bg-stone-950 md:block">
            <ThemePanel
              theme={theme}
              fontSettings={fontSettings}
              meta={meta}
              templateList={templateList}
              isPresentation={isPresentation}
              dirty={anyDirty}
              onChangeTheme={updateTheme}
              onChangeFont={updateFont}
              onChangeMeta={updateMeta}
              onClose={() => setShowThemePanel(false)}
            />
          </aside>
        )}
      </div>

      {showMobileSheet && (
        <>
          <div
            className="fixed inset-0 z-40 bg-stone-900/40 backdrop-blur-sm md:hidden"
            onClick={() => setShowMobileSheet(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-xl border-t border-stone-200 bg-white p-5 pb-8 shadow-2xl dark:border-stone-800 dark:bg-stone-950 md:hidden">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-stone-200 dark:bg-stone-700" />

            <div className="mb-5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400 dark:text-stone-500">
                {isPresentation ? "Presentation template" : "Document template"}
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {templateList.map((t) => {
                  const active = t.id === theme?.templateId;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTemplate(t.id)}
                      className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors ${
                        active
                          ? "border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-500/50 dark:bg-teal-500/15 dark:text-teal-200"
                          : "border-stone-200 text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
                      }`}
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
                        style={{ background: `#${t.primary}` }}
                      >
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ background: `#${t.secondary}` }}
                        />
                      </span>
                      <span className="flex-1 truncate font-medium">
                        {t.label}
                      </span>
                      {active && (
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          className="h-4 w-4 text-teal-500 dark:text-teal-400"
                        >
                          <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-5 border-t border-stone-100 pt-5 dark:border-stone-800">
              <ThemePanel
                theme={theme}
                fontSettings={fontSettings}
                meta={meta}
                templateList={templateList}
                isPresentation={isPresentation}
                dirty={anyDirty}
                onChangeTheme={updateTheme}
                onChangeFont={updateFont}
                onChangeMeta={updateMeta}
                bare
              />
            </div>

            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/20"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                className="h-4 w-4"
              >
                <path
                  d="M3 6h18M8 6v14a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6M10 11v6M14 11v6"
                  strokeLinecap="round"
                />
              </svg>
              Delete document
            </button>
          </div>
        </>
      )}

      <div
        ref={hiddenRef}
        aria-hidden
        style={{
          position: "fixed",
          left: "-99999px",
          top: 0,
          width: isPresentation ? "1123px" : "794px",
          pointerEvents: "none",
        }}
      >
        {pages.map((p, i) => (
          <div
            key={i}
            className="page"
            style={{
              width: isPresentation ? "1123px" : "794px",
              height: isPresentation ? "794px" : "1123px",
              pageBreakAfter: i < pages.length - 1 ? "always" : "auto",
              overflow: "hidden",
              background: "#FFFFFF",
              containerType: "inline-size",
            }}
          >
            {Template && (
              <Template
                page={p}
                theme={theme}
                fontSettings={fontSettings}
                pageNumber={i + 1}
                totalPages={totalPages}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default DocumentViewer;