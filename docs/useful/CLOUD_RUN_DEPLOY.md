# Cloud Run Deploy

- Status: useful
- Read when: deploying the backend to Google Cloud Run
- Source of truth: `cloudbuild.yaml`, `cloudrun.env.example`, `apps/backend/Dockerfile`, `apps/backend/.env.example`
- Last reviewed: 2026-05-03

This runbook assumes `zsh`, `bash`, or another POSIX-style shell. The backend is deployed as a container image built by Cloud Build from `apps/backend/Dockerfile`.

## Copy/Paste: Build And Deploy

Run this from the repo root after `cloudrun.env` has the hosted values you want.

```bash
export PROJECT_ID="hai-gcp-representation"
export IMAGE_URI="us-central1-docker.pkg.dev/hai-gcp-representation/monolith-context-router/monolith-context-router:latest"
export REGION="us-central1"
export SERVICE="context-router"
export INSTANCE_CONNECTION_NAME="hai-gcp-representation:us-central1:context-monolith-pg"

# 1. Build a new image from the current code and Dockerfile.
gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions "_IMAGE_TAG=${IMAGE_URI}" \
  --project "${PROJECT_ID}" \
  .

# 2. Deploy that image with the env values from cloudrun.env.
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE_URI}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --platform managed \
  --allow-unauthenticated \
  --add-cloudsql-instances "${INSTANCE_CONNECTION_NAME}" \
  --env-vars-file cloudrun.env
```

## Copy/Paste: Prisma

Run these from `apps/backend`. Use **migrate only** for normal deploys. Use **full reset** only when you intentionally want to wipe and reseed the cloud database.

```bash
cd apps/backend
export CLOUD_DB="postgresql://<db-user>:<db-password>@<cloud-sql-public-ip>:5432/<db-name>?schema=public"

# Normal deploy path: apply only pending migrations. Non-destructive.
DATABASE_URL="${CLOUD_DB}" pnpm exec prisma migrate deploy

# Optional after migrate: seed or upsert app data.
DATABASE_URL="${CLOUD_DB}" pnpm exec prisma db seed
```

```bash
cd apps/backend
export CLOUD_DB="postgresql://<db-user>:<db-password>@<cloud-sql-public-ip>:5432/<db-name>?schema=public"

# Full reset: destructive. Drops data, reapplies migrations, then you can reseed.
DATABASE_URL="${CLOUD_DB}" pnpm exec prisma migrate reset --force
DATABASE_URL="${CLOUD_DB}" pnpm exec prisma db seed
```

## What Looks Correct

- `cloudbuild.yaml` correctly builds the backend image from the monorepo root with `apps/backend/Dockerfile`.
- The backend listens on `process.env.PORT`, which is what Cloud Run injects.
- The Cloud SQL Unix socket style can work with the current `pg` adapter when `DATABASE_URL` includes `host=/cloudsql/<instance-connection-name>`.

## Things To Fix Before Deploying

- Keep real `cloudrun*.env` files local. They are ignored by git.
- Deploy with `--add-cloudsql-instances`; the socket path in `DATABASE_URL` is not enough by itself.
- Run Prisma migrations separately; the Cloud Run service image starts the app and does not run `prisma migrate deploy`.
- After the first deploy, set `MCP_SERVER_URL` to the final Cloud Run service URL and redeploy.

## TODO

- Move `DATABASE_URL` and `AUTH0_CLIENT_SECRET` from plain Cloud Run env vars to Secret Manager when this deployment needs tighter production handling. Keeping them in the ignored local `cloudrun.env` is acceptable for the current convenience workflow.

## One-Time Setup

```bash
export PROJECT_ID="<gcp-project-id>"
export REGION="us-central1"
export REPOSITORY="context-router"
export SERVICE="context-router"
export IMAGE_NAME="backend"
export CLOUD_SQL_INSTANCE="<project-id>:<region>:<cloud-sql-instance>"
export RUNTIME_SERVICE_ACCOUNT="context-router-run@${PROJECT_ID}.iam.gserviceaccount.com"
```

Enable the APIs the deploy path needs:

```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  sqladmin.googleapis.com \
  aiplatform.googleapis.com \
  --project "${PROJECT_ID}"
```

Create the Artifact Registry repository if it does not exist yet:

```bash
gcloud artifacts repositories create "${REPOSITORY}" \
  --repository-format docker \
  --location "${REGION}" \
  --description "Context Router container images" \
  --project "${PROJECT_ID}"
```

Create a runtime service account if it does not exist yet:

```bash
gcloud iam service-accounts create context-router-run \
  --display-name "Context Router Cloud Run runtime" \
  --project "${PROJECT_ID}"
```

Grant the runtime service account access to Cloud SQL and Vertex AI:

```bash
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role roles/cloudsql.client

gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role roles/aiplatform.user
```

## Build The Image

```bash
export TAG="$(git rev-parse --short HEAD)"
export IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${IMAGE_NAME}:${TAG}"

gcloud builds submit \
  --config cloudbuild.yaml \
  --substitutions "_IMAGE_TAG=${IMAGE_URI}" \
  --project "${PROJECT_ID}" \
  .
```

## Deploy The Service

Copy the placeholder env file and fill in the hosted values:

```bash
cp cloudrun.env.example cloudrun.env
```

For Cloud SQL, use the instance connection name in the `DATABASE_URL` `host` query parameter:

```bash
DATABASE_URL=postgresql://<db-user>:<db-password>@localhost/<db-name>?schema=public&host=/cloudsql/<project-id>:<region>:<cloud-sql-instance>
```

Deploy the image:

```bash
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE_URI}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${RUNTIME_SERVICE_ACCOUNT}" \
  --env-vars-file cloudrun.env \
  --add-cloudsql-instances "${CLOUD_SQL_INSTANCE}" \
  --allow-unauthenticated
```

Use `--allow-unauthenticated` only if the backend should be reachable directly by the web app and MCP clients. The app still enforces Auth0 for protected routes.

Fetch the deployed URL:

```bash
export SERVICE_URL="$(gcloud run services describe "${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format 'value(status.url)')"

printf '%s\n' "${SERVICE_URL}"
```

Set `MCP_SERVER_URL` in `cloudrun.env` to that URL, then redeploy with the same `gcloud run deploy` command.

## Run Migrations

Cloud Run deploys the app, but it does not apply Prisma migrations. Run migrations from a trusted machine that can reach Cloud SQL, usually through the Cloud SQL Auth Proxy:

```bash
cloud-sql-proxy "${CLOUD_SQL_INSTANCE}" --port 5432
```

In another shell:

```bash
export CLOUD_DB="postgresql://<db-user>:<db-password>@127.0.0.1:5432/<db-name>?schema=public"
DATABASE_URL="${CLOUD_DB}" pnpm --filter backend exec prisma migrate deploy
```

## Quick Checks

```bash
curl "${SERVICE_URL}/health"

gcloud run services logs read "${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --limit 100
```

## Later: Move Secrets To Secret Manager

When ready, enable Secret Manager:

```bash
gcloud services enable secretmanager.googleapis.com --project "${PROJECT_ID}"
```

Create secrets:

```bash
printf '%s' '<database-url>' \
  | gcloud secrets create context-router-database-url \
      --data-file - \
      --project "${PROJECT_ID}"

printf '%s' '<auth0-client-secret>' \
  | gcloud secrets create context-router-auth0-client-secret \
      --data-file - \
      --project "${PROJECT_ID}"
```

Allow the runtime service account to read them:

```bash
gcloud secrets add-iam-policy-binding context-router-database-url \
  --member "serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role roles/secretmanager.secretAccessor \
  --project "${PROJECT_ID}"

gcloud secrets add-iam-policy-binding context-router-auth0-client-secret \
  --member "serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" \
  --role roles/secretmanager.secretAccessor \
  --project "${PROJECT_ID}"
```

Remove `DATABASE_URL` and `AUTH0_CLIENT_SECRET` from `cloudrun.env`, then deploy with explicit secret versions:

```bash
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE_URI}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${RUNTIME_SERVICE_ACCOUNT}" \
  --env-vars-file cloudrun.env \
  --update-secrets DATABASE_URL=context-router-database-url:1,AUTH0_CLIENT_SECRET=context-router-auth0-client-secret:1 \
  --add-cloudsql-instances "${CLOUD_SQL_INSTANCE}" \
  --allow-unauthenticated
```
