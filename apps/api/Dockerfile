# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches/ patches/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/tsconfig/package.json packages/tsconfig/
# Keep `pnpm install` without `--prod`: the start command in railway.json
# (repo root) runs `prisma migrate deploy` at boot, which needs the
# `prisma` CLI from devDependencies. If you tighten this to `--prod`,
# move `prisma` to dependencies in packages/db/package.json first.
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm --filter @ccc/db db:generate
RUN pnpm --filter @ccc/db build
RUN pnpm --filter @ccc/shared build
RUN pnpm --filter @ccc/api build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /repo /repo
EXPOSE 4000
CMD ["node", "apps/api/dist/boot.js"]
