# Next.js standalone + Prisma: the standalone server.js already traces almost
# everything; only the Prisma schema/generated client and static assets are
# copied explicitly.

# Digest-pinned so rebuilds are reproducible (dependabot re-bumps the digest on
# tag updates). node:22-alpine @ 2026-07-29.
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS base
ENV NEXT_TELEMETRY_DISABLED=1

# Deps layer so npm ci benefits from the build cache when only sources change.
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# The runner never invokes npm; drop the base image's bundled npm so the CVEs
# in its bundled internals (tar, sigstore, brace-expansion, picomatch,
# ip-address) don't ship or trip the Trivy image gate.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Prisma runtime: schema + generated client must exist in the runner image even
# though the report store defaults to memory (postgres is opt-in via env).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.js"]
