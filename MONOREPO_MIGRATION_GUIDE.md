Context Router: Monorepo Migration PlanThis document outlines the transition from a single-folder NestJS project to a pnpm workspace monorepo. This structure allows us to host the Backend and Frontend in the same repository while keeping their dependencies and build processes isolated.1. The New Project StructureWe are moving from a "Root = Backend" structure to a "Root = Workspace" structure.Visual Hierarchycontext-router/                  <-- ROOT (Git Repo)
│
├── package.json                 # Workspace Root Config (Scripts to run both apps)
├── pnpm-workspace.yaml          # Defines "apps/*" as the workspace
├── docker-compose.yml           # Shared Infrastructure (Postgres)
├── .gitignore                   # Global gitignore
│
├── apps/                        # The "Monorepo" container
│   │
│   ├── backend/                 # MOVED: Your existing NestJS application
│   │   ├── src/                 # Source code (auth, user, etc.)
│   │   ├── prisma/              # Database schema & migrations
│   │   ├── test/                # E2E tests
│   │   ├── Dockerfile           # Backend production build
│   │   ├── package.json         # Backend-specific dependencies
│   │   ├── tsconfig.json
│   │   └── .env                 # Backend secrets
│   │
│   └── web/                     # NEW: Next.js Frontend Application
│       ├── src/app/             # App Router pages (Login, Dashboard)
│       ├── public/              # Static assets
│       ├── package.json         # Frontend-specific dependencies
│       └── .env.local           # Frontend secrets (Auth0 keys)
│
└── packages/                    # (Future) Shared libraries
    └── types/                   # Shared TypeScript interfaces
2. Step-by-Step Migration GuideFollow these steps in order to migrate without losing data or breaking your git history.Phase 1: Create the Workspace SkeletonCreate the apps directory:mkdir -p apps/backend
Create the Workspace Definition:Create a file named pnpm-workspace.yaml at the root:packages:
  - 'apps/*'
Create Root Package.json:Overwrite the root package.json (after moving the original in Phase 2) or create a new one:{
  "name": "context-router-monorepo",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "dev": "concurrently \"pnpm --filter backend start:dev\" \"pnpm --filter web dev\"",
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  },
  "devDependencies": {
    "concurrently": "^8.0.0"
  }
}
Phase 2: Move the BackendMove your existing NestJS files into the new subfolder.Move Source Files:# Move core application folders
mv src apps/backend/
mv test apps/backend/
mv prisma apps/backend/
mv modules apps/backend/ 2>/dev/null  # If existing outside src
mv mcp apps/backend/ 2>/dev/null      # If existing outside src
Move Configuration Files:# Move configs
mv package.json apps/backend/
mv tsconfig*.json apps/backend/
mv nest-cli.json apps/backend/
mv .env* apps/backend/
mv Dockerfile apps/backend/
mv .eslintrc.js apps/backend/ 2>/dev/null
mv .prettierrc apps/backend/ 2>/dev/null
Note: Leave .git, .gitignore, and docker-compose.yml at the root.Phase 3: Initialize the FrontendGenerate the Next.js App:cd apps
npx create-next-app@latest web --typescript --tailwind --eslint
# Select "Yes" for App Router
# Select "No" for src directory (optional, but consistent if yes)
Install Root Dependencies:Go back to the root and link everything up.cd ..
pnpm install
Phase 4: Configuration UpdatesUpdate Backend schema.prisma:If your prisma folder moved, verify the output path in schema.prisma is still correct (usually defaults to node_modules, which is fine).Update docker-compose.yml (Root):If you use Docker Compose for local development (DB only), no change needed.If you use it to run the app, update the build context:services:
  api:
    build:
      context: ./apps/backend  # Changed from .
      dockerfile: Dockerfile
3. Potential Pitfalls & Solutions⚠️ Pitfall 1: Docker Build ContextThe Issue: When deploying to the cloud, your Dockerfile inside apps/backend might try to COPY . .. If the builder runs from the root, it copies the entire monorepo into the backend container, or fails to find files if run from the wrong directory.The Fix:Locally: Run docker builds from the root, pointing to the file: docker build -f apps/backend/Dockerfile .Cloud (Render/Railway): Configure the "Root Directory" setting in your cloud provider to apps/backend.⚠️ Pitfall 2: Prisma Client GenerationThe Issue: Running npx prisma generate at the root will fail because it can't find the schema.The Fix: Always run Prisma commands inside the backend directory:cd apps/backend && npx prisma generate
⚠️ Pitfall 3: Shared Types vs. Next.js ConfigThe Issue: Next.js (Webpack) prevents importing files outside its own directory (../backend/src/...) by default.The Fix:Short Term: Duplicate the types or use a script to copy schema.gql to the frontend.Long Term (Recommended): Create a packages/types folder.Initialize it as a minimal npm package.Add "@context-router/types": "workspace:*" to both apps/backend and apps/web package.json files.⚠️ Pitfall 4: CORS & Port ConflictsThe Issue: Your Frontend runs on port 3000 by default, which conflicts with NestJS (also 3000).The Fix:NestJS stays on 3000.Next.js (Frontend) automatically detects this and switches to 3001, OR you can force it in apps/web/package.json:"scripts": {
  "dev": "next dev -p 3001"
}
Update Backend .env: Ensure CORS_ORIGIN allows the frontend port:CORS_ORIGIN=http://localhost:3001,http://localhost:3000
4. Verification Checklist[ ] Directory structure matches the diagram above.[ ] Root package.json has private: true and workspaces (or pnpm-workspace.yaml) configured.[ ] pnpm install at root runs successfully for all apps.[ ] cd apps/backend && pnpm start:dev starts the NestJS server.[ ] cd apps/web && pnpm dev starts the Next.js server.[ ] Backend is accessible at http://localhost:3000/graphql.[ ] Frontend is accessible at http://localhost:3001.