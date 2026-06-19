# Agent Guide

## Project Overview

StudyDeck AI is a production-oriented SaaS for generating study presentations from prompts and uploaded materials.

Current architecture:
- `apps/web`: Next.js App Router frontend, Auth.js, user dashboard/editor/export flows.
- `apps/api`: NestJS internal API, project/source/export/job/billing endpoints.
- `apps/worker`: BullMQ worker for document extraction, AI generation and export jobs.
- `packages/shared`: shared Zod contracts and TypeScript types.
- `prisma`: PostgreSQL schema and migrations.
- `infra/Caddyfile`: production reverse proxy for web/API.
- `scripts/deploy.ps1`: SSH deploy helper that archives `HEAD`, builds compose on the server, runs Prisma deploy, and starts services.
- `server.js` plus root `*.html`, `styles.css`, `script.js`: legacy MVP kept for fallback only.

Prefer changing the monorepo apps over the legacy MVP unless the user explicitly asks for legacy work.

Recent product areas to preserve:
- Generation supports OpenAI and Yandex providers, with optional demo fallback.
- `with_sources` generation and projects without uploaded files can create `WEB` sources through Tavily web search.
- Presentation visuals can be enriched with Tavily image search and downloaded into MinIO.
- The web app has local demo-preview behavior for non-POST project reads unless `NEXT_PUBLIC_DEMO_PREVIEW=false`.
- Slide rendering/export depends on the richer shared presentation contract: themes, layouts, visuals, narrative plan, speech script, and source refs.

## Local Environment

The repo is a Node.js npm workspaces project.

Required local services:
- PostgreSQL
- Redis
- MinIO

They are provided by `docker-compose.yml`.

Use `.env.example` as the baseline. Copy it to `.env` for local development if missing:

```powershell
Copy-Item .env.example .env
```

Environment areas that often affect behavior:
- AI providers: `AI_PROVIDER`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `YANDEX_API_KEY`, `YANDEX_FOLDER_ID`, `YANDEX_MODEL_URI`, `YANDEX_MODEL_NAME`.
- Web and image search: `TAVILY_API_KEY`, `WEB_SEARCH_PROVIDER`, `WEB_SEARCH_MAX_RESULTS`, `PRESENTATION_IMAGES_ENABLED`, `PRESENTATION_IMAGE_SEARCH_RESULTS`, `PRESENTATION_IMAGE_MAX_BYTES`, `PRESENTATION_IMAGE_TIMEOUT_MS`.
- Local/demo behavior: `ALLOW_DEMO_GENERATION`, `NEXT_PUBLIC_DEMO_PREVIEW`, `TEMP_USER_ID`, `INTERNAL_API_TOKEN`.

Important local note on this Windows host:
- Docker Desktop previously failed because Windows pagefile was disabled.
- A pagefile was created at `D:\pagefile.sys` with 8192 MB initial and 24576 MB max.
- If Docker fails with `runtime.newosproc`, `errno=1450`, `paging file is too small`, or WSL bootstrap errors, check pagefile and restart WSL/Docker first.
- Ports `3000` and `3001` may already be occupied. Use `WEB_PORT=3010` for compose if needed.

## Common Commands

Install dependencies:

```powershell
npm install
```

Generate Prisma client:

```powershell
npm run prisma:generate
```

Run local infrastructure only:

```powershell
docker compose up -d postgres redis minio create-bucket
```

Run migrations from Windows:

```powershell
$env:DATABASE_URL='postgresql://studydeck:studydeck@localhost:5432/studydeck?schema=public'
npm run prisma:migrate
```

If Prisma's Windows schema engine fails, run deploy inside Docker instead:

```powershell
docker compose run --rm api npm run prisma:deploy
```

Run development services in separate terminals:

```powershell
npm run dev:web:fast
npm run dev:api
npm run dev:worker
```

For frontend work, `npm run dev:web:fast` is the default preview workflow. It
starts Next.js with hot reload at `http://localhost:3020`, loads the root
`.env`, points to the API at `http://localhost:4000`, and builds
`packages/shared` once before startup. Changes under `apps/web` should appear
within seconds without rebuilding a Docker image. Restart the command after
changing `packages/shared`.

Run the full production-like compose stack on a free web port:

```powershell
$env:WEB_PORT='3010'
docker compose up -d
```

Useful URLs after compose startup:
- Web direct: `http://localhost:3010`
- API health direct: `http://localhost:4000/v1/health`
- Caddy web: `https://localhost`
- Caddy API health: `https://localhost/api/internal-health`
- MinIO console: `http://localhost:9001`

For HTTPS on localhost, Caddy uses a local certificate. Use `curl.exe -k` for command-line checks when needed.

Local auth/API notes:
- `apps/web/src/lib/internal-api.ts` currently uses `TEMP_USER_ID` or `local-user` and forwards `x-user-id` plus `x-internal-token`.
- Keep `INTERNAL_API_TOKEN` consistent between web/API when testing real API calls.
- `NEXT_PUBLIC_DEMO_PREVIEW=false` is useful when you need the web app to show real API data instead of the bundled demo project.

## Applying Changes To The Running App

For ordinary frontend implementation and visual verification, do not run
`docker compose build web`. Use `npm run dev:web:fast` and verify the result at
`http://localhost:3020`. Keep the Docker API and infrastructure services
running as needed. This is the preferred workflow because a production web
image build can take many minutes.

Only rebuild the `web` Docker image when the user explicitly asks to validate
the production container, requests a production-like Docker check, or asks for
deployment. If the user is specifically checking the compose web app at
`http://localhost:3010` or `https://localhost`, explain that those URLs use the
production container and rebuild it only when that production check is
actually required.

API and worker source changes are still not visible in their Docker containers
until the affected images are rebuilt and containers recreated. Use the
narrowest service set needed.

Use the narrowest service set that matches the files changed:
- `apps/web` or UI display logic during development: use
  `npm run dev:web:fast`, no Docker rebuild
- `apps/web` production-container validation: `web`
- `packages/shared` used by the dev web: restart `npm run dev:web:fast`
- `apps/api`, `packages/shared` used by API, or Prisma client/API contracts: `api`
- `apps/worker`, generation/export/extraction/search/image logic, or `packages/shared` used by jobs: `worker`
- `prisma/schema.prisma` or migrations: usually `api worker`, plus run migration/deploy as needed
- `infra/Caddyfile`: `caddy`

PowerShell deploy script for changed app services:

```powershell
# Pick only the services affected by the change.
$services = @('web', 'worker')

docker compose build @services
docker compose up -d @services
docker compose ps
curl.exe -s http://localhost:4000/v1/health
curl.exe -k -s https://localhost/api/internal-health
```

Examples:

```powershell
# Frontend-only development and visual verification
npm run dev:web:fast
# Open http://localhost:3020

# Production web container validation only
$services = @('web')
docker compose build @services
docker compose up -d @services

# Generation/export worker change
$services = @('worker')
docker compose build @services
docker compose up -d @services

# Shared contract change used by all apps
$services = @('web', 'api', 'worker')
docker compose build @services
docker compose up -d @services
```

After rebuilding production containers, tell the user which URL to refresh and
whether a hard refresh (`Ctrl+F5`) is useful. When
`npm run dev:web:fast` is running, rely on hot reload, verify at
`http://localhost:3020`, and do not rebuild Docker.

## Verification

Run before handing off substantial changes:

```powershell
npm run check
npm run build
npm run test
docker compose config --quiet
```

For targeted changes, use workspace tests/typechecks before the full suite when that is faster:

```powershell
npm run typecheck -w @studydeck/web
npm run test -w @studydeck/web
npm run typecheck -w @studydeck/worker
npm run test -w @studydeck/worker
```

For Docker runtime verification:

```powershell
docker info --format '{{.ServerVersion}} {{.OSType}} {{.Architecture}}'
docker compose ps
curl.exe -s http://localhost:4000/v1/health
curl.exe -k -s https://localhost/api/internal-health
```

Expected healthy API response:

```json
{"ok":true,"service":"studydeck-api","at":"<iso-date>"}
```

## Implementation Notes

- Keep shared request/response contracts in `packages/shared` and import them from apps instead of duplicating shapes.
- Use Prisma migrations for DB schema changes.
- API routes are globally prefixed with `/v1` in `apps/api/src/main.ts`.
- The web app talks to the API through `INTERNAL_API_URL` and its own Next route handlers in `apps/web/src/app/api/**`.
- Worker jobs depend on Redis, Postgres and MinIO.
- MinIO bucket name defaults to `studydeck`.
- Caddy maps `/v1/*` to `api:4000` and all other traffic to `web:3000`.
- Tavily is used by worker web/image search. Keep network-dependent behavior optional in tests through injected dependencies or env gates.
- Presentation generation output is validated and normalized in `apps/worker/src/tasks/presentation.ts`; update tests when changing prompts, layouts, quality checks, or schema fields.
- Export behavior in `apps/worker/src/tasks/export.ts` must stay aligned with the web slide renderer in `apps/web/src/lib/presentation-display.ts`.
- Avoid committing generated TypeScript build info such as `apps/web/tsconfig.tsbuildinfo`.

## Remote Deploy

Use `scripts/deploy.ps1` only when the user explicitly asks for a remote deploy:

```powershell
.\scripts\deploy.ps1 -HostName deploy@your-server -RemotePath /opt/studydeck
```

The script deploys committed `HEAD`, so commit or otherwise ensure the intended changes are in Git before using it.

## Git And Editing

- The working tree may contain user changes. Do not revert unrelated files.
- Use `git -c safe.directory=D:/presentation ...` if Git reports repository ownership/safe-directory issues.
- Keep edits scoped. Do not refactor legacy files while working on production monorepo features unless required.
