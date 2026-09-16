FROM node:20-bookworm-slim

# ─── System dependencies ─────────────────────────────────
# • ffmpeg    → for audio extraction and clip cutting
# • python3   → for yt-dlp
# • pip3      → to install yt-dlp
# • curl      → to fetch the Deno installer
# • unzip     → REQUIRED by the Deno installer to extract its binary
# • ca-certificates → for HTTPS
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg \
      python3 \
      python3-pip \
      curl \
      unzip \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ─── yt-dlp ──────────────────────────────────────────────
# [default] pulls in yt-dlp-ejs, brotli, etc. — needed for YouTube
# signature and PO-token challenges.
RUN pip3 install --break-system-packages -U "yt-dlp[default]"

# ─── Deno ────────────────────────────────────────────────
# yt-dlp uses a JS runtime (Deno is recommended) to solve YouTube's
# n-signature challenges. Without it, most formats disappear and you
# get "Requested format is not available".
#
# `-s -- -y v2.1.4` means: pass "-y v2.1.4" to the install script,
# which skips the interactive prompt and pins the version.
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s -- -y v2.1.4

# Make sure the Deno binary is on PATH for yt-dlp to find
ENV PATH="/usr/local/bin:${PATH}"

# ─── App ─────────────────────────────────────────────────
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 8000
CMD ["node", "server.js"]