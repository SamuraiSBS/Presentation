# StudyDeck AI

Production-oriented SaaS implementation for generating study presentations from prompts and uploaded materials.

## Stack

- `apps/web`: Next.js App Router frontend with Auth.js.
- `apps/api`: NestJS internal API.
- `apps/worker`: BullMQ worker for extraction, generation and exports.
- `packages/shared`: shared Zod contracts and TypeScript types.
- `prisma`: Postgres schema for auth, projects, sources, presentations, jobs, exports and billing.

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

The legacy MVP is still available with `npm run legacy:start`.
