FROM node:20-alpine

WORKDIR /app

# ffmpeg powers @discordjs/voice transcoding for the TTS pipeline (utils/voice.js).
# msedge-tts emits 24kHz mono Opus; Discord wants 48kHz stereo, and we feed ffmpeg
# the stream rather than wedge in a JS resampler. Cheap (~30MB) on alpine.
RUN apk add --no-cache ffmpeg

# Install dependencies first (better layer caching)
# --legacy-peer-deps: with no lockfile npm still resolves the dev tree, and on 2026-10-15 vitest's optional peer
# set (browser runners, jsdom, canvas) started crashing npm 10's peer resolver ("reading 'edgesOut'") — two
# Railway builds failed on it. No production dependency needs an auto-installed peer (checked the same day).
COPY package.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy source — .dockerignore excludes data/state.json so it's never baked in
COPY . .

# Ensure data dir exists but contains NO state.json
# (state.json must come from the mounted volume at runtime)
RUN mkdir -p data && rm -f data/state.json

# Run as non-root user
RUN addgroup -S botgroup && adduser -S botuser -G botgroup
RUN chown -R botuser:botgroup /app
USER botuser

CMD ["node", "index.js"]
