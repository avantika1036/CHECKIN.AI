# checkIn.ai

Visitor-management proof of concept for registering visits, applying organization-specific rules, routing host approvals, and reviewing activity.

## Run & Operate

- Replit runs the web app in `artifacts/checkin-ai: web` and the API in `artifacts/api-server: API Server`.
- The API health check is available at `/api/healthz`.
- `pnpm --filter @workspace/db run push` — create/update the development database schema
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- Replit provides `DATABASE_URL` to the app. `GROQ_API_KEY` enables AI visitor extraction and analytics; `SARVAM_API_KEY` enables speech transcription.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: Vite (web) and esbuild (API)

## Where things live

- `artifacts/checkin-ai/` — React/Vite visitor-management interface
- `artifacts/api-server/` — Express API, visitor workflow, AI agents, and demo-data initialization
- `lib/db/src/schema/visitor-workflow.ts` — PostgreSQL schema
- `lib/api-spec/openapi.yaml` — API contract

## Architecture decisions

- AI-generated visitor data is validated by deterministic business rules before it is stored.
- The imported project uses React/TypeScript and Express; keep this stack unless the product owner requests a migration.

## Product

- Demo profiles for university, housing, and museum visitor workflows
- Visitor registration, approval, check-in/check-out, notifications, analytics, and audit history

## User preferences

## Gotchas

- The API server seeds demo records at startup and requires the development database schema to exist first.
- API routes are served through the Replit artifact path `/api`; the web app uses Replit's shared path router rather than a Vite proxy.
- AI extraction/analytics and speech transcription need their respective provider secrets; other visitor-management screens can load without them.
