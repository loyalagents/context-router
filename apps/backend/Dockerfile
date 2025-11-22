# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files from apps/backend
COPY apps/backend/package.json ./package.json
# Note: We use the root package-lock.json since this is a monorepo
COPY package-lock.json ./package-lock.json
COPY apps/backend/prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy source code from apps/backend
COPY apps/backend/ .

# Generate Prisma Client
RUN npx prisma generate

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files from apps/backend
COPY apps/backend/package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY apps/backend/prisma ./prisma/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy Prisma generated client from builder
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy built application from builder
COPY --from=builder /app/dist ./dist

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "dist/main"]
