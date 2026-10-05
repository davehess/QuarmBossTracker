# Bristlebane — the raid-voice bot. Build context is THIS folder (Coolify: Dockerfile build pack, base
# directory /apps/bristlebane). It shares nothing with the main bot's Dockerfile at the repo root.
#
# Node 22.12+ is required by @discordjs/voice 0.19. If @snazzah/davey (DAVE voice encryption, a native
# prebuilt) ever fails to load on Alpine's musl, change the next line to node:22-slim — nothing else changes.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencies first so a code-only change reuses the cached layer. The lockfile is committed on purpose
# (the root .gitignore ignores lockfiles; this folder has an exception): the voice stack is pinned exactly.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY index.js lib.js ./

# Recordings (/data/recordings) and the consent list (/data/consent.json) live on the volume — Coolify →
# Persistent Storage → mount at /data. The image owns the folder for the non-root user, which a NAMED volume
# inherits; a host-path bind mount must be made writable for uid 1000 on the host instead.
RUN mkdir -p /data/recordings && chown -R node:node /data /app
VOLUME ["/data"]
USER node

CMD ["node", "index.js"]
