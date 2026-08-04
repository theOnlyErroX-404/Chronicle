# Next.js standalone + Prisma: the standalone server.js already traces almost
# everything; only the Prisma schema/generated client and static assets are
# copied explicitly.

FROM node:22-alpine AS base
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

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Prisma runtime: schema + generated client must exist in the runner image even
# though the report store defaults to memory (postgres is opt-in via env).
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
