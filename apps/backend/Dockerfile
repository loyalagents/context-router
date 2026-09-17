# Build stage
FROM node:24.21.0-alpine AS builder

WORKDIR /app

# Enable Corepack for pnpm
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

# Copy package files from monorepo root and backend
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/backend/prisma ./apps/backend/prisma/
COPY scripts/check-toolchain.mjs ./scripts/check-toolchain.mjs

# Install dependencies
RUN node scripts/check-toolchain.mjs
RUN pnpm install --frozen-lockfile

# Copy source code from apps/backend
COPY apps/backend/ ./apps/backend/

# Generate Prisma Client
RUN pnpm --filter backend exec prisma generate

# Build the application
RUN pnpm --filter backend build

# Production stage
FROM node:24.21.0-alpine AS production

WORKDIR /app

# Enable Corepack for pnpm
RUN corepack enable && corepack prepare pnpm@10.25.0 --activate

# Copy package files from monorepo root and backend
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/backend/prisma ./apps/backend/prisma/
COPY scripts/check-toolchain.mjs ./scripts/check-toolchain.mjs

# Install all dependencies temporarily to generate Prisma
RUN node scripts/check-toolchain.mjs
RUN pnpm install --frozen-lockfile

# Generate Prisma Client
RUN pnpm --filter backend exec prisma generate

# Remove dev dependencies (keep only production)
RUN CI=true pnpm install --frozen-lockfile --prod

# Copy built application from builder
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "apps/backend/dist/main"]
