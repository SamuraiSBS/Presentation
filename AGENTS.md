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
- `server.js` plus root `*.html`, `styles.css`, `script.js`: legacy MVP kept for fallback only.

Prefer changing the monorepo apps over the legacy MVP unless the user explicitly asks for legacy work.

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
npm run dev:web
npm run dev:api
npm run dev:worker
```

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

## Verification

Run before handing off substantial changes:

```powershell
npm run check
npm run build
npm run test
docker compose config --quiet
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
- The web app talks to the API through `INTERNAL_API_URL`.
- Worker jobs depend on Redis, Postgres and MinIO.
- MinIO bucket name defaults to `studydeck`.
- Caddy maps `/v1/*` to `api:4000` and all other traffic to `web:3000`.

## Git And Editing

- The working tree may contain user changes. Do not revert unrelated files.
- Use `git -c safe.directory=D:/presentation ...` if Git reports repository ownership/safe-directory issues.
- Keep edits scoped. Do not refactor legacy files while working on production monorepo features unless required.
