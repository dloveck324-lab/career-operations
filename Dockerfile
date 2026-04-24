# =============================================================================
# Dockerfile — Render deployment for career-ops-dave (personal instance)
#
# Data and config are persisted via a Render disk mounted at /app/persistent.
# entrypoint.sh symlinks /app/data and /app/config to that mount before boot.
# =============================================================================

FROM node:20-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY . .
RUN npm install

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production

WORKDIR /app/apps/server
EXPOSE 3001

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npx", "tsx", "src/index.ts"]
