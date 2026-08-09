# StudyDeck AI

Production-oriented SaaS implementation for generating study presentations from prompts and uploaded materials.

## Stack

- `apps/web`: Next.js App Router frontend with Auth.js.
- `apps/api`: NestJS internal API.
- `apps/worker`: BullMQ worker for extraction, generation and exports.
- `packages/shared`: shared Zod contracts and TypeScript types.
- `prisma`: Postgres schema for auth, projects, sources, presentations, jobs, exports and billing.

## Preferred libraries

StudyDeck now has a preferred library map for future implementation work:

- AI generation: `ai`, `@ai-sdk/openai`, OpenAI/Yandex provider code, Tavily and `zod`.
- Background jobs: BullMQ.
- Editing and visuals: Tiptap, Mermaid and `sharp`.
- Frontend data/UI: TanStack Query, local shadcn-style UI components, Radix UI and `lucide-react`.
- Observability: Sentry, `pino` and OpenTelemetry.
- Testing: Vitest and Playwright.

Agent-ready implementation prompts and short Russian explanations are in
`plans/library-implementation-prompts/`.

## Local Setup

1. Copy `.env.example` to `.env`.
2. Run `npm install`.
3. Start infrastructure: `docker compose up postgres redis minio create-bucket`.
4. Run `npm run prisma:generate`.
5. Run migrations: `npm run prisma:migrate`.
6. Start services:
   - `npm run dev:web`
   - `npm run dev:api`
   - `npm run dev:worker`

## Fast frontend iteration

Do not rebuild the production `web` Docker image just to preview frontend
changes. Keep the API and infrastructure running, then start the Next.js dev
server on the host:

```powershell
npm run dev:web:fast
```

Open `http://localhost:3020`. Changes under `apps/web` use hot reload and
normally appear in seconds. The script builds `packages/shared` once at startup;
restart it after changing the shared contract.

Use `docker compose build web` only when validating the production image or
before deployment.

## Production deployment

Production uses a separate compose definition and never reads `.env.example`.
Copy [`.env.production.example`](.env.production.example) to `.env.production`
on the deployment host, replace every placeholder through the secret manager,
then validate and launch it:

```powershell
npm run validate:production-config
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml up -d --build
```

Only Caddy publishes ports 80/443 in this topology. PostgreSQL, Redis, MinIO,
and the API remain on the internal Docker network.

The legacy MVP is still available with `npm run legacy:start`.
