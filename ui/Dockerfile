# Multi-stage build
# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app

# The committed lockfile currently installs from prebuilt packages. Avoid a
# full compiler/Python toolchain here: it adds hundreds of MB to the build
# container and can exhaust small Coolify/Hostinger VPS disks during builds.
RUN apk add --no-cache libc6-compat

# Copy package files
COPY ui/package*.json ./

# Reproducible install. If package.json and package-lock.json drift, fail the
# build instead of silently generating a different dependency tree.
RUN npm ci --no-audit --no-fund && npm cache clean --force

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app

# Install libc6-compat for native modules in builder stage too
RUN apk add --no-cache libc6-compat

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy all files needed for build
COPY ui/package*.json ./
COPY ui/tsconfig.json ./
COPY ui/next.config.ts ./
COPY ui/components.json ./
COPY ui/postcss.config.mjs ./
COPY ui/public ./public
COPY ui/src ./src

# Set build-time environment variables (needed for Next.js build)
ENV NEXT_PUBLIC_NODE_ENV="oss"
ENV NEXT_TELEMETRY_DISABLED="1"
ENV NEXT_SERVER_SOURCE_MAPS="false"
ENV NEXT_PUBLIC_CHATWOOT_URL=""
ENV NEXT_PUBLIC_CHATWOOT_TOKEN=""
ENV BACKEND_URL="http://api:8000"

# Build the application with standalone mode
# Keep the build inside small VPS memory limits. Raising this can make Docker
# builds faster on large hosts, but low-memory Coolify machines can crash when
# Next.js is allowed to consume several GB.
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN npm run build

# Stage 3: Runner (production image)
FROM node:22-alpine AS runner
WORKDIR /app

# Environment variables will be provided by docker-compose
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

# Switch to non-root user
USER nextjs

# Expose the port Next.js runs on
EXPOSE 3010

# Start the production server using the standalone Node.js server
CMD ["node", "server.js"]
