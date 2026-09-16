FROM node:20-bookworm-slim

# ─────────────────────────────────────────────────────────────
# System dependencies
#
# ffmpeg  → required by yt-dlp to merge video+audio streams and cut clips
# python3 → required by yt-dlp itself
# pip3    → to install yt-dlp
# ca-certificates → for HTTPS verification
#
# NOTE: We intentionally do NOT install Deno. The base image ships
# Node 20, which is a supported yt-dlp JS runtime (min version 20.0.0)
# and avoids the Deno installer's unzip/7z requirement entirely.
# ─────────────────────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ─────────────────────────────────────────────────────────────
# yt-dlp
#
# Installing with the [default] extra is CRITICAL — the single-file
# binary from GitHub releases does NOT include the EJS challenge solver
# scripts that live in the yt_dlp/ package directory. Without them,
# YouTube downloads silently fall back to throttled/broken streams.
#
# --break-system-packages is required on Debian Bookworm (PEP 668).
# ─────────────────────────────────────────────────────────────
RUN pip3 install --break-system-packages -U "yt-dlp[default]"

# ─────────────────────────────────────────────────────────────
# Global yt-dlp config
#
# Tells yt-dlp to use Node as the JS runtime (already on PATH from the
# base image) and to fetch EJS solver components from GitHub's releases.
# This is a belt-and-braces setup — yt-dlp would auto-detect Node
# anyway, but explicit config avoids surprises across yt-dlp versions.
# ─────────────────────────────────────────────────────────────
RUN printf '%s\n' \
      '--js-runtimes node' \
      '--remote-components ejs:github' \
      > /etc/yt-dlp.conf

# ─────────────────────────────────────────────────────────────
# Application
# ─────────────────────────────────────────────────────────────
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 8000

CMD ["node", "server.js"]