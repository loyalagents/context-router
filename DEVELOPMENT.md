# Development Guide

This guide explains how to run the Context Router monorepo in development mode.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Frontend (Next.js)                                 │
│  http://localhost:3002                              │
│  Running locally via: npm run dev:web               │
└────────────────┬────────────────────────────────────┘
                 │ GraphQL queries
                 ▼
┌─────────────────────────────────────────────────────┐
│  Backend (NestJS + GraphQL)                         │
│  http://localhost:3000/graphql                      │
│  Running in Docker via: docker compose up           │
└────────────────┬────────────────────────────────────┘
                 │ SQL queries
                 ▼
┌─────────────────────────────────────────────────────┐
│  PostgreSQL Database                                │
│  localhost:5432                                     │
│  Running in Docker (managed by docker-compose)      │
└─────────────────────────────────────────────────────┘
```

---

## Quick Start

### Prerequisites

- **Node.js 20+** (run `node -v` to check)
- **Docker Desktop** running
- **Environment variables** configured (see `.env` setup below)

### 1. First-Time Setup

```bash
# Install all dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your Auth0 credentials
# See AUTH0_SETUP.md for details
```

### 2. Start Development Environment

Open two terminal tabs:

**Terminal 1 - Backend + Database:**
```bash
# Start backend and PostgreSQL in Docker
docker compose up

# Or run in background:
docker compose up -d

# View logs:
docker compose logs -f app
```

**Terminal 2 - Frontend:**
```bash
# Start Next.js development server
npm run dev:web
```

---

## Services & Ports

| Service | URL | Port | How to Run |
|---------|-----|------|------------|
| **Frontend** | http://localhost:3002 | 3002 | `npm run dev:web` |
| **Backend (GraphQL)** | http://localhost:3000/graphql | 3000 | `docker compose up` |
| **PostgreSQL** | localhost:5432 | 5432 | `docker compose up` |

---

## Common Commands

### Development

```bash
# Run both backend (Docker) and frontend (local)
# Terminal 1:
docker compose up

# Terminal 2:
npm run dev:web

# OR run backend locally
npm run dev:backend  # Backend only
npm run dev:web      # Frontend only
npm run dev          # Both (uses concurrently - may not work with Docker)
```

### Database Management

```bash
# Run Prisma migrations
cd apps/backend
npx prisma migrate dev

# Generate Prisma client
npx prisma generate

# Open Prisma Studio (database GUI)
npx prisma studio

# Reset database (CAUTION: deletes all data)
npx prisma migrate reset
```

### Docker Commands

```bash
# Start services
docker compose up           # Run in foreground
docker compose up -d        # Run in background (detached)

# Stop services
docker compose down         # Stop and remove containers
docker compose down -v      # Stop and remove volumes (deletes DB data!)

# View logs
docker compose logs         # All services
docker compose logs app     # Backend only
docker compose logs -f      # Follow logs (live)

# Restart a service
docker compose restart app  # Restart backend
docker compose restart postgres

# Rebuild backend image (after dependency changes)
docker compose build app
docker compose up --build
```

### Building

```bash
# Build everything
npm run build

# Build individually
npm run build:backend
npm run build:web
```

### Testing

```bash
# Run all tests
npm run test

# Backend tests
cd apps/backend
npm run test
npm run test:e2e
npm run test:cov  # With coverage
```

---

## Environment Variables

### Backend (.env location: **ROOT** `.env`)

**IMPORTANT:** The `.env` file lives at the **root of the monorepo**, not in `apps/backend/`.

**Required for Auth0:**
```env
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_AUDIENCE=https://your-api-audience
AUTH0_ISSUER=https://your-tenant.auth0.com/
AUTH0_CLIENT_ID=your-auth0-client-id
AUTH0_CLIENT_SECRET=your-auth0-client-secret
AUTH0_MANAGEMENT_API_AUDIENCE=https://your-tenant.auth0.com/api/v2/
```

**Database:**
```env
# Use 'postgres' as hostname when running in Docker (container name)
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/context_router?schema=public
```

**CORS (allows frontend to access backend):**
```env
CORS_ORIGIN=http://localhost:3000,http://localhost:3002
```

### Frontend (.env.local location: `apps/web/.env.local`)

When you add Auth0 to the frontend, you'll need:
```env
NEXT_PUBLIC_AUTH0_DOMAIN=your-tenant.auth0.com
NEXT_PUBLIC_AUTH0_CLIENT_ID=your-frontend-client-id
NEXT_PUBLIC_GRAPHQL_URL=http://localhost:3000/graphql
```

---

## Troubleshooting

### Port Already in Use

**Error:** `EADDRINUSE: address already in use :::3000`

**Solution:**
```bash
# Find what's using the port
lsof -ti:3000

# Kill the process
kill $(lsof -ti:3000)

# Or use a different port in docker-compose.yml
ports:
  - '3001:3000'  # Maps host port 3001 to container port 3000
```

### Backend Won't Start

**Error:** Prisma client errors or database connection issues

**Solution:**
```bash
# Make sure PostgreSQL is running
docker compose up postgres

# Regenerate Prisma client
cd apps/backend
npx prisma generate

# Run migrations
npx prisma migrate dev
```

### Docker Build Fails

**Solution:**
```bash
# Clean Docker cache and rebuild
docker compose down
docker system prune -a  # CAUTION: removes all unused images
docker compose build --no-cache app
docker compose up
```

### Frontend Type Errors

**Solution:**
```bash
# Reinstall dependencies with correct Node version
node -v  # Should be 20+
rm -rf node_modules apps/*/node_modules package-lock.json
npm install
```

### CORS Errors

**Error:** Frontend can't connect to backend

**Solution:**
1. Check backend is running: `curl http://localhost:3000/graphql`
2. Verify CORS_ORIGIN in `apps/backend/.env` includes `http://localhost:3002`
3. Restart backend: `docker compose restart app`

---

## Development Workflow

### Making Backend Changes

1. Edit files in `apps/backend/src/`
2. Docker watches for changes and auto-reloads (via `npm run start:dev`)
3. Check logs: `docker compose logs -f app`

### Making Frontend Changes

1. Edit files in `apps/web/app/`
2. Next.js hot-reloads automatically
3. View in browser: http://localhost:3002

### Adding Dependencies

**Backend:**
```bash
cd apps/backend
npm install <package>
docker compose restart app  # Restart to pick up new dependencies
```

**Frontend:**
```bash
cd apps/web
npm install <package>
# Frontend auto-reloads
```

### Database Schema Changes

```bash
# 1. Edit prisma/schema.prisma
cd apps/backend

# 2. Create migration
npx prisma migrate dev --name describe_your_change

# 3. If running backend in Docker, restart it
docker compose restart app
```

---

## Production Deployment

See deployment-specific guides:
- **Render/Railway:** Use docker-compose.yml, set root directory to `apps/backend`
- **Vercel (Frontend):** Deploy `apps/web`, set build command to `npm run build`
- **Separate Hosting:** Build and deploy each app independently

---

## Tips & Best Practices

### 1. Use Docker for Backend in Development
- **Pro:** Consistent environment, easy database setup
- **Con:** Slightly slower than native (usually negligible)

### 2. Run Frontend Locally
- **Pro:** Fast hot-reload, better DX
- **Con:** Need to manage Node version

### 3. Keep Containers Running
```bash
# Start once, leave running in background
docker compose up -d

# Check status anytime
docker compose ps

# View logs when needed
docker compose logs -f app
```

### 4. Database Backups
```bash
# Export database
docker compose exec postgres pg_dump -U postgres context_router > backup.sql

# Import database
docker compose exec -T postgres psql -U postgres context_router < backup.sql
```

### 5. Clean Restart
```bash
# When things get weird, nuclear option:
docker compose down -v    # Deletes database!
rm -rf node_modules apps/*/node_modules
npm install
docker compose up
```

---

## Next Steps

- **Add Auth0 to Frontend:** See [FRONTEND_INTEGRATION_GUIDE.md](FRONTEND_INTEGRATION_GUIDE.md)
- **Configure Auth0:** See [AUTH0_SETUP.md](AUTH0_SETUP.md)
- **Deploy to Production:** See deployment docs (TBD)

---

**Happy coding! 🚀**
