// server.js
import express from "express";
import cors from "cors";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

import userRoutes from "./routes/userRoutes.js";
import aiRoutes from "./routes/aiRoutes.js";
import formRoutes from "./routes/formRoutes.js";
import formAiRoutes from "./routes/formAiRoutes.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import Form from "./models/formModel.js";

import { notFound, errorHandler } from "./middleware/errorMiddleware.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 8000;

// ─────────────────────────────────────────────────────────────────────
// Core middleware
// ─────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));
app.use(cookieParser());

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:2000",
      "https://xamut.curriumx.online",
      "https://xamut.lovohcreate.com",
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);

// ─────────────────────────────────────────────────────────────────────
// Health check
// ─────────────────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.status(200).json({ success: true, message: "Backend is reachable" });
});

// ─────────────────────────────────────────────────────────────────────
// OG / link-preview + SPA passthrough for /forms/*
//
// Handles ALL /forms/* paths:
//   • /forms/:slug        → single segment (public form)
//   • /forms/:id/edit     → deep editor routes
//   • /forms/:id/responses, /forms/:id/preview, etc.
//
// Crawlers on a single-segment URL get dynamic OG tags from Mongo.
// Everyone else (humans on any /forms/* path, and crawlers on deep
// routes) gets the frontend's LIVE index.html fetched from
// FRONTEND_URL — never the backend's own bundled copy, which can go
// stale relative to the static site's hashed asset filenames and
// cause 404s → blank page on reload.
// ─────────────────────────────────────────────────────────────────────
const CRAWLER_RE =
  /(whatsapp|facebookexternalhit|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|embedly|quora link preview|showyoubot|outbrain|pinterest|vkShare|W3C_Validator|redditbot|applebot|googlebot|bingbot|yandex|duckduckbot|skypeuripreview)/i;

const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// Tiny in-memory cache for the fetched index.html, so a burst of
// editor reloads doesn't hammer the static site. 30s TTL means a new
// deploy propagates within half a minute.
let _indexCache = { html: "", at: 0 };
const INDEX_TTL_MS = 30_000;

async function getLiveIndexHtml() {
  const frontend = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
  if (!frontend) return null;

  const now = Date.now();
  if (_indexCache.html && now - _indexCache.at < INDEX_TTL_MS) {
    return _indexCache.html;
  }

  const resp = await fetch(`${frontend}/`);
  if (!resp.ok) return null;
  const html = await resp.text();
  _indexCache = { html, at: now };
  return html;
}

app.get(/^\/forms\/.+/, async (req, res, next) => {
  const ua = req.headers["user-agent"] || "";
  const isCrawler = CRAWLER_RE.test(ua);

  // Path after "/forms/", ignoring a trailing slash.
  const rest = req.path.replace(/^\/forms\//, "").replace(/\/$/, "");
  const segments = rest.split("/").filter(Boolean);
  const isSingleSegment = segments.length === 1;

  // ── Crawler on a single-segment URL → serve OG HTML ───────────────
  if (isCrawler && isSingleSegment) {
    const slug = segments[0];
    try {
      const form = await Form.findOne({ slug })
        .select("title description coverPhoto type slug")
        .lean();

      if (!form) {
        return res
          .status(404)
          .type("html")
          .send(
            `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Form not found</title></head><body><p>Form not found.</p></body></html>`
          );
      }

      const frontend = (process.env.FRONTEND_URL || "").replace(/\/$/, "");
      const url = `${frontend}/forms/${form.slug}`;
      const title = `${form.title} — Xamut`;
      const desc = (
        form.description || `A ${form.type} on Xamut. Fill it out here.`
      ).slice(0, 300);
      const img = form.coverPhoto || "";

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(desc)}" />
  <link rel="canonical" href="${escapeHtml(url)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(desc)}" />
  <meta property="og:url" content="${escapeHtml(url)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Xamut" />
  ${
    img
      ? `<meta property="og:image" content="${escapeHtml(img)}" />
  <meta property="og:image:secure_url" content="${escapeHtml(img)}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />`
      : ""
  }
  <meta name="twitter:card" content="${
    img ? "summary_large_image" : "summary"
  }" />
  <meta name="twitter:title" content="${escapeHtml(title)}" />
  <meta name="twitter:description" content="${escapeHtml(desc)}" />
  ${img ? `<meta name="twitter:image" content="${escapeHtml(img)}" />` : ""}
</head>
<body>
  <p>${escapeHtml(title)}</p>
</body>
</html>`;

      return res
        .status(200)
        .set("Content-Type", "text/html; charset=utf-8")
        .set("Cache-Control", "public, max-age=60, s-maxage=300")
        .send(html);
    } catch (err) {
      console.error("OG render failed:", err.message);
      return next();
    }
  }

  // ── Everyone else → serve the frontend's LIVE index.html ──────────
  //
  // Covers humans on /forms/:slug, humans on deep routes like
  // /forms/:id/edit or /forms/:id/responses, and crawlers on deep
  // routes (who'd just get the SPA shell — fine, they don't index
  // editor URLs).
  //
  // We fetch from FRONTEND_URL instead of res.sendFile() so we never
  // serve the backend's bundled copy, whose asset hashes can drift
  // from the static site's current deploy and cause a 404 on the JS
  // chunk → blank React page.
  try {
    const html = await getLiveIndexHtml();
    if (html) {
      return res
        .status(200)
        .set("Content-Type", "text/html; charset=utf-8")
        .set("Cache-Control", "no-cache")
        .send(html);
    }
  } catch (err) {
    console.error("Failed to proxy frontend index.html:", err.message);
  }

  // Fallback: bundled copy, if FRONTEND_URL isn't set or the fetch failed.
  return next();
});

// ─────────────────────────────────────────────────────────────────────
// API routes
// ─────────────────────────────────────────────────────────────────────
app.use("/api/users", userRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/forms", formRoutes);
app.use("/api/form-ai", formAiRoutes);
app.use("/api/whatsapp", whatsappRoutes);

// ─────────────────────────────────────────────────────────────────────
// Serve the built React SPA (fallback only)
//
// Only reached when /forms/* doesn't match (e.g. /chat, /dashboard),
// or when the /forms/* handler called next() because FRONTEND_URL
// wasn't set or the fetch failed. If someone deploys the frontend
// bundle alongside the backend, this serves it; otherwise it warns.
// ─────────────────────────────────────────────────────────────────────
const PUBLIC_CANDIDATES = [
  path.join(__dirname, "public"),
  path.join(__dirname, "..", "frontend", "dist"),
  path.join(__dirname, "..", "dist"),
];

let PUBLIC_DIR = null;
for (const p of PUBLIC_CANDIDATES) {
  try {
    if (fs.statSync(p).isDirectory()) {
      PUBLIC_DIR = p;
      break;
    }
  } catch {
    /* try next */
  }
}

if (PUBLIC_DIR) {
  console.log(`✅ Serving SPA from: ${PUBLIC_DIR}`);

  app.use(
    express.static(PUBLIC_DIR, {
      index: false,
      setHeaders(res, filePath) {
        if (
          /\/assets\//.test(filePath) ||
          /\.(js|css|woff2?|png|jpg|jpeg|svg|webp|ico|map)$/.test(filePath)
        ) {
          res.setHeader(
            "Cache-Control",
            "public, max-age=31536000, immutable"
          );
        } else {
          res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        }
      },
    })
  );

  // SPA fallback — any non-API GET that accepts HTML and isn't a real
  // file gets index.html, and React Router handles the route.
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!req.accepts("html")) return next();
    if (req.path.startsWith("/api/")) return next();

    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });
} else {
  console.warn(
    "⚠️  SPA build not found. Run `npm run build` in the frontend folder."
  );
}

// ─────────────────────────────────────────────────────────────────────
// API 404 + error handler (scoped to /api/* only)
// ─────────────────────────────────────────────────────────────────────
app.use("/api", notFound);
app.use(errorHandler);

// ─────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error.message);
  });