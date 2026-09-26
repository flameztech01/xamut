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
// OG / link-preview endpoint
//
// Crawlers (WhatsApp, Twitter, FB, LinkedIn, Telegram, Slack, Discord)
// don't run JavaScript. They read raw HTML and look for og:* / twitter:*
// meta tags. This endpoint serves a tiny HTML doc with those tags for
// any bot that hits /forms/:slug.
//
// Real browsers get the frontend's LIVE index.html fetched and returned
// directly (not a redirect — a redirect back to the same domain would
// loop straight back into this same rewrite rule). Fetching and
// returning the content means we always serve whatever's actually
// live on the frontend's own static hosting, so this never goes stale
// even if this backend's own bundled copy of the SPA is out of date.
// ─────────────────────────────────────────────────────────────────────
const CRAWLER_RE =
  /(whatsapp|facebookexternalhit|twitterbot|telegrambot|linkedinbot|slackbot|discordbot|embedly|quora link preview|showyoubot|outbrain|pinterest|vkShare|W3C_Validator|redditbot|applebot|googlebot|bingbot|yandex|duckduckbot|skypeuripreview)/i;

const escapeHtml = (s = "") =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

app.get("/forms/:slug", async (req, res, next) => {
  const ua = req.headers["user-agent"] || "";
  const isCrawler = CRAWLER_RE.test(ua);

  // ── Real browsers: fetch the frontend's own live index.html and
  // return it directly. This is NOT a redirect — redirecting back to
  // the same domain would just loop into this same /forms/* rewrite
  // rule forever. Fetching the root path ("/") sidesteps that rule
  // entirely (it only matches /forms/*), so we always get the
  // frontend's current, freshly-deployed build.
  if (!isCrawler) {
    const frontend = (process.env.FRONTEND_URL || "").replace(/\/$/, "");

    if (frontend) {
      try {
        const resp = await fetch(`${frontend}/`);
        if (resp.ok) {
          const html = await resp.text();
          return res
            .status(200)
            .set("Content-Type", "text/html; charset=utf-8")
            .send(html);
        }
      } catch (err) {
        console.error("Failed to proxy frontend index.html:", err.message);
      }
    }

    // Fallback: this backend's own bundled copy, if the fetch above
    // failed or FRONTEND_URL isn't set.
    return next();
  }

  try {
    const form = await Form.findOne({ slug: req.params.slug })
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

    res
      .status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("Cache-Control", "public, max-age=60, s-maxage=300")
      .send(html);
  } catch (err) {
    console.error("OG render failed:", err.message);
    next();
  }
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
// Serve the built React SPA
//
// We look in a few candidate locations so this works both locally
// (frontend/dist) and on Render (frontend/dist again, since Root
// Directory is set to the repo root). If someone later chooses to
// copy dist into backend/public during build, that path is also
// checked first.
//
// NOTE: this is now only a FALLBACK for human traffic — the /forms/:slug
// route above fetches the frontend's live index.html directly instead
// of relying on this bundled copy staying in sync. This still matters
// for any other non-API route a human might hit directly on the
// backend's own domain.
// ─────────────────────────────────────────────────────────────────────
const PUBLIC_CANDIDATES = [
  path.join(__dirname, "public"), // prod fallback: build copies dist here
  path.join(__dirname, "..", "frontend", "dist"), // local + Render monorepo
  path.join(__dirname, "..", "dist"), // alt monorepo layout
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