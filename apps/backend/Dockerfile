# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Enable Corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files from monorepo root and backend
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/backend/prisma ./apps/backend/prisma/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code from apps/backend
COPY apps/backend/ ./apps/backend/

# Generate Prisma Client
RUN pnpm --filter backend exec prisma generate

# Build the application
RUN pnpm --filter backend build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Enable Corepack for pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files from monorepo root and backend
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json ./apps/backend/package.json
COPY apps/backend/prisma ./apps/backend/prisma/

# Install production dependencies only
RUN pnpm install --frozen-lockfile --prod

# Copy Prisma generated client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built application from builder
COPY --from=builder /app/apps/backend/dist ./apps/backend/dist

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "apps/backend/dist/main"]
