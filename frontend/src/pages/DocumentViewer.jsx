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

// Look up a template defensively. If the saved theme.templateId is a
// presentation id on a document (or vice versa), we fall through to the
// correct default instead of rendering the wrong design.
const resolveTemplate = (map, list, defaultId, templateId) => {
  const isKnown = list.some((t) => t.id === templateId);
  if (isKnown && map[templateId]) return map[templateId];
  return map[defaultId];
};

// ─────────────────────────────────────────────────────────────
// Page
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
  const [themeDirty, setThemeDirty] = useState(false);

  const previewRef = useRef(null);
  const hiddenRef = useRef(null);

  useEffect(() => {
    if (doc?.theme && !theme) setTheme({ ...doc.theme });
  }, [doc, theme]);

  useDebouncedEffect(
    () => {
      if (!themeDirty || !doc?._id || !theme) return;
      updateDocument({ id: doc._id, theme }).unwrap().catch(() => {});
      setThemeDirty(false);
    },
    [themeDirty, theme],
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
          slide.addShape(pptx.ShapeType.rect, {
            x: 0.5,
            y: 0.55,
            w: 0.12,
            h: 0.7,
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
          const bullets = (p.bullets || []).map((b) => ({
            text: b,
            options: {
              bullet: { code: "25AA", color: primary },
              fontSize: 18,
              color: "2B2B2B",
              paraSpaceAfter: 10,
            },
          }));
          if (bullets.length) {
            slide.addText(bullets, {
              x: 0.9,
              y: 1.6,
              w: 11.3,
              h: 5.2,
              valign: "top",
            });
          }
          if (p.paragraphs?.length) {
            slide.addText(p.paragraphs.join(" "), {
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
      <div className="flex h-screen items-center justify-center bg-stone-100">
        <div className="flex items-center gap-3 text-stone-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-orange-500" />
          Loading document…
        </div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-stone-100 px-6 text-center">
        <p className="text-lg font-semibold text-stone-800">
          Document not found
        </p>
        <p className="max-w-sm text-sm text-stone-500">
          It may have been deleted, or the link is incorrect.
        </p>
        <Link
          to="/chat"
          className="rounded-full bg-orange-500 px-6 py-2.5 text-sm font-semibold text-white shadow-md shadow-orange-500/25 hover:bg-orange-600"
        >
          Back to chat
        </Link>
      </div>
    );
  }

  // ─── Aspect-ratio driven sizing ────────────────────────────
  // The wrapper uses container queries so we can express:
  //   "take min(container width, max px, container height × aspectRatio)"
  // This guarantees the rendered page fits the viewport in BOTH
  // dimensions and never gets squashed into a wrong shape.
  const aspect = isPresentation ? "16 / 9" : "8.5 / 11";
  const aspectRatioNum = isPresentation ? 16 / 9 : 8.5 / 11;
  const maxPx = isPresentation ? 1100 : 820;

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-stone-100 text-stone-900">
      {/* ─── Header ─────────────────────────────────────────── */}
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
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                isPresentation
                  ? "bg-orange-100 text-orange-700"
                  : "bg-blue-100 text-blue-700"
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
              {isPresentation ? "Slides" : "Document"}
            </span>
            <h1 className="truncate text-sm font-semibold text-stone-900">
              {doc.title || "Untitled"}
            </h1>
          </div>
          <p className="truncate text-[11px] text-stone-400">
            Page {currentPage + 1} of {totalPages} ·{" "}
            {isPresentation ? "Landscape 16:9" : "A4 Portrait"}
          </p>
        </div>

        {/* Template picker (desktop) */}
        <div className="relative hidden sm:block">
          <button
            onClick={() => setShowTemplatePicker((s) => !s)}
            className="flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs font-semibold text-stone-600 transition-colors hover:border-orange-300 hover:text-orange-600"
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
              <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-stone-200 bg-white p-2 shadow-xl">
                <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                  {isPresentation ? "Presentation templates" : "Document templates"}
                </p>
                <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto">
                  {templateList.map((t) => {
                    const active = t.id === theme?.templateId;
                    return (
                      <button
                        key={t.id}
                        onClick={() => handleSelectTemplate(t.id)}
                        className={`flex items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                          active
                            ? "bg-orange-50 text-orange-900"
                            : "text-stone-700 hover:bg-stone-100"
                        }`}
                      >
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
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
                            className="h-3.5 w-3.5 text-orange-500"
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
          className={`hidden rounded-lg p-2 transition-colors md:block ${
            showThemePanel
              ? "bg-orange-50 text-orange-600"
              : "text-stone-500 hover:bg-stone-100 hover:text-stone-900"
          }`}
          aria-label="Customize colors"
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
          className="rounded-lg p-2 text-stone-500 transition-colors hover:bg-stone-100 hover:text-stone-900 md:hidden"
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
          className="hidden rounded-lg p-2 text-stone-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40 sm:block"
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
          className="flex items-center gap-1.5 rounded-full bg-orange-500 px-4 py-2 text-xs font-semibold text-white shadow-md shadow-orange-500/25 transition-all hover:bg-orange-600 disabled:opacity-60"
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

      {/* ─── Body ───────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Thumbnails rail (desktop) */}
        <aside className="hidden w-44 shrink-0 overflow-y-auto border-r border-stone-200 bg-white/60 p-3 md:block">
          <div className="space-y-2">
            {pages.map((p, i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                className={`group relative block w-full overflow-hidden rounded-lg border-2 transition-all ${
                  currentPage === i
                    ? "border-orange-500 shadow-md shadow-orange-500/20"
                    : "border-stone-200 hover:border-stone-300"
                }`}
              >
                <div
                  className="w-full bg-white"
                  style={{ aspectRatio: aspect }}
                >
                  <TemplateThumb
                    Template={Template}
                    page={p}
                    theme={theme}
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

        {/* Preview */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div
            className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-8"
            style={{ containerType: "size" }}
          >
            {Template && pages[currentPage] ? (
              <div
                ref={previewRef}
                className={`overflow-hidden bg-white ${
                  isPresentation
                    ? "rounded-lg shadow-[0_25px_50px_-12px_rgba(28,25,23,0.35)]"
                    : "rounded-sm border border-stone-200/80 shadow-[0_1px_3px_rgba(28,25,23,0.06),0_20px_40px_-24px_rgba(28,25,23,0.28)]"
                }`}
                style={{
                  // min(container width, max px, container height * aspect ratio)
                  width: `min(100cqw, ${maxPx}px, calc(100cqh * ${aspectRatioNum}))`,
                  aspectRatio: aspect,
                }}
              >
                <Template
                  page={pages[currentPage]}
                  theme={theme}
                  pageNumber={currentPage + 1}
                  totalPages={totalPages}
                />
              </div>
            ) : (
              <p className="text-sm text-stone-500">Nothing to preview.</p>
            )}
          </div>

          {/* Page nav */}
          <div className="flex shrink-0 items-center justify-center gap-2 border-t border-stone-200 bg-white/70 px-4 py-3 backdrop-blur">
            <button
              onClick={() => setCurrentPage((i) => Math.max(0, i - 1))}
              disabled={currentPage === 0}
              className="rounded-full border border-stone-200 bg-white p-2 text-stone-500 transition-colors hover:border-orange-300 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
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
                className="w-12 rounded-lg border border-stone-200 bg-white py-1 text-center text-sm font-semibold text-stone-800 outline-none focus:border-orange-400"
              />
              <span className="text-xs text-stone-400">/ {totalPages}</span>
            </div>

            <button
              onClick={() =>
                setCurrentPage((i) => Math.min(totalPages - 1, i + 1))
              }
              disabled={currentPage === totalPages - 1}
              className="rounded-full border border-stone-200 bg-white p-2 text-stone-500 transition-colors hover:border-orange-300 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
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

        {/* Theme panel (desktop) */}
        {showThemePanel && (
          <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-stone-200 bg-white p-4 md:block">
            <ThemePanel
              theme={theme}
              templateList={templateList}
              onChange={updateTheme}
              onClose={() => setShowThemePanel(false)}
              themeDirty={themeDirty}
            />
          </aside>
        )}
      </div>

      {/* ─── Mobile bottom sheet ────────────────────────────── */}
      {showMobileSheet && (
        <>
          <div
            className="fixed inset-0 z-40 bg-stone-900/40 backdrop-blur-sm md:hidden"
            onClick={() => setShowMobileSheet(false)}
          />
          <div className="fixed inset-x-0 bottom-0 z-50 max-h-[80vh] overflow-y-auto rounded-t-3xl border-t border-stone-200 bg-white p-5 pb-8 shadow-2xl md:hidden">
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-stone-200" />

            <div className="mb-5">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                {isPresentation ? "Presentation template" : "Document template"}
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {templateList.map((t) => {
                  const active = t.id === theme?.templateId;
                  return (
                    <button
                      key={t.id}
                      onClick={() => handleSelectTemplate(t.id)}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                        active
                          ? "border-orange-300 bg-orange-50 text-orange-900"
                          : "border-stone-200 text-stone-700 hover:bg-stone-50"
                      }`}
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
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
                          className="h-4 w-4 text-orange-500"
                        >
                          <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-5 border-t border-stone-100 pt-5">
              <ThemePanel
                theme={theme}
                templateList={templateList}
                onChange={updateTheme}
                themeDirty={themeDirty}
                bare
              />
            </div>

            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="flex w-full items-center justify-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
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

      {/* ─── Hidden full render for PDF export ──────────────── */}
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
            }}
          >
            {Template && (
              <Template
                page={p}
                theme={theme}
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

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────
const ThemePanel = ({
  theme,
  templateList,
  onChange,
  onClose,
  themeDirty,
  bare = false,
}) => (
  <div className={bare ? "" : ""}>
    {!bare && (
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-900">Customize</h2>
        {onClose && (
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
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

    <ColorField
      label="Primary"
      value={theme?.primaryColor}
      onChange={(v) => onChange({ primaryColor: v })}
    />
    <ColorField
      label="Background"
      value={theme?.secondaryColor}
      onChange={(v) => onChange({ secondaryColor: v })}
    />
    <ColorField
      label="Accent"
      value={theme?.accentColor}
      onChange={(v) => onChange({ accentColor: v })}
    />
    <ColorField
      label="Text"
      value={theme?.textColor}
      onChange={(v) => onChange({ textColor: v })}
    />

    <button
      onClick={() => {
        const def = templateList.find((t) => t.id === theme?.templateId);
        if (!def) return;
        onChange({
          primaryColor: def.primary,
          secondaryColor: def.secondary,
          accentColor: def.accent,
        });
      }}
      className="mt-4 w-full rounded-full border border-stone-200 bg-white py-2 text-xs font-semibold text-stone-600 transition-colors hover:border-orange-300 hover:text-orange-600"
    >
      Reset to template default
    </button>

    {themeDirty && (
      <p className="mt-3 text-center text-[10px] text-stone-400">Saving…</p>
    )}
  </div>
);

const ColorField = ({ label, value, onChange }) => (
  <div className="mb-3">
    <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-stone-500">
      {label}
    </label>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={`#${value || "000000"}`}
        onChange={(e) =>
          onChange(e.target.value.replace("#", "").toUpperCase())
        }
        className="h-9 w-10 cursor-pointer rounded-lg border border-stone-200 bg-white"
      />
      <input
        type="text"
        value={value || ""}
        onChange={(e) => {
          const v = e.target.value.replace("#", "").toUpperCase().slice(0, 6);
          if (/^[0-9A-F]{0,6}$/.test(v)) onChange(v);
        }}
        className="flex-1 rounded-lg border border-stone-200 bg-white px-3 py-2 font-mono text-xs text-stone-700 outline-none focus:border-orange-400"
      />
    </div>
  </div>
);

// Renders the real template at 100% width and scales it down with a
// CSS transform. `aspectRatioNum` is passed so the inner wrapper can
// match the target aspect exactly.
const TemplateThumb = ({
  Template,
  page,
  theme,
  pageNumber,
  totalPages,
  aspectRatioNum,
}) => {
  // Render target is 100px wide; scale factor below fits it in the rail.
  const innerWidth = 100; // %
  const innerHeight = 100 / aspectRatioNum; // % of width
  const scale = 0.28;

  return (
    <div className="pointer-events-none h-full w-full origin-top-left overflow-hidden" style={{ transform: `scale(${scale})` }}>
      <div
        style={{
          width: `${(100 / scale)}%`,
          height: `${(100 / scale)}%`,
        }}
      >
        <Template
          page={page}
          theme={theme}
          pageNumber={pageNumber}
          totalPages={totalPages}
        />
      </div>
    </div>
  );
};

export default DocumentViewer;