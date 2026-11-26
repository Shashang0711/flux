# Multi-stage build for the FLUX monorepo. Targets:
# - api:   the API server (production dependencies only: no Prisma CLI, no build tools)
# - web:   the Next.js app (production dependencies only)
# - tools: migrations, seeding and backup/restore (full toolchain + PostgreSQL client tools)
# See docker-compose.yml.

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

# Built apps with production dependencies only. The generated Prisma client (node_modules/.prisma)
# stays; the Prisma CLI and TypeScript go, with their dependencies, so they are not shipped in
# the running containers. Both are optional peers of @prisma/client, which `npm prune` keeps once
# installed, hence `--omit=peer --omit=optional` (no lifecycle scripts: postinstall needs the CLI).
# Nothing at runtime needs an optional package: next.config is plain JS (no SWC at start).
FROM build AS runtime
RUN npm install --omit=dev --omit=peer --omit=optional --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

FROM runtime AS api
ENV NODE_ENV=production
WORKDIR /app/apps/api
EXPOSE 4000
# Runs as the unprivileged node user; local file storage (if used) needs a writable folder.
RUN mkdir -p storage && chown node:node storage
USER node
CMD ["node", "dist/main.js"]

FROM runtime AS web
ENV NODE_ENV=production
WORKDIR /app/apps/web
EXPOSE 3000
RUN mkdir -p .next/cache && chown -R node:node .next/cache
USER node
CMD ["npx", "next", "start"]

# One-off jobs: `migrate deploy` + seed (the default command), and backups:
#   docker compose run --rm tools npm run backup -- --dir /backups --keep 14
FROM build AS tools
ARG PG_MAJOR=16
# PostgreSQL client tools of the server's major version (pg_dump/pg_restore must match it).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
     https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
     > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-${PG_MAJOR} \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app/apps/api
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]
