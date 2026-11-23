# Multi-stage build for the FLUX monorepo. Targets: `api` and `web` (see docker-compose.yml).

FROM node:20-bookworm-slim AS base
# Prisma's query engine needs OpenSSL.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Install dependencies. The root postinstall builds @flux/shared and runs `prisma generate`,
# so their sources must be present before `npm ci`.
FROM base AS deps
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api/package.json apps/api/
COPY apps/api/prisma apps/api/prisma
COPY apps/web/package.json apps/web/
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build -w @flux/api && npm run build -w @flux/web

FROM build AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 4000
# Apply pending migrations, run the idempotent seed (bootstrap admin), then start the server.
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed && node dist/main.js"]

FROM build AS web
ENV NODE_ENV=production
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["npm", "run", "start"]
