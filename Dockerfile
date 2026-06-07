FROM node:20-alpine

WORKDIR /app

# ffmpeg powers @discordjs/voice transcoding for the TTS pipeline (utils/voice.js).
# msedge-tts emits 24kHz mono Opus; Discord wants 48kHz stereo, and we feed ffmpeg
# the stream rather than wedge in a JS resampler. Cheap (~30MB) on alpine.
RUN apk add --no-cache ffmpeg

# Install dependencies first (better layer caching)
COPY package.json ./
RUN npm install --omit=dev

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
