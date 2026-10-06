# checkIn.ai

Visitor-management proof of concept built with React, TypeScript, Vite, Express, PostgreSQL, and Drizzle ORM.

## Prerequisites

- Node.js 24 or newer
- pnpm
- PostgreSQL, when running the API and database locally

Install pnpm if it is not already available:

```powershell
corepack enable
corepack prepare pnpm@latest --activate
```

## Install dependencies

From the repository root:

```powershell
pnpm install
```

The repository uses pnpm workspaces. Run the install from `C:\Work\CHECKIN.AI`, not from `artifacts\checkin-ai`.

## Run the frontend only

To start the React/Vite frontend without starting the API:

```powershell
pnpm --filter @workspace/checkin-ai dev
```

Open <http://localhost:5173> in a browser.

The frontend source is in [`artifacts/checkin-ai`](./artifacts/checkin-ai). The frontend-only server is useful for working on the interface, but API-backed features require the API server and a database.

## Run the full application

1. Copy the example environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Edit `.env` and provide at least a PostgreSQL connection string:

   ```env
   DATABASE_URL=postgresql://username:password@localhost:5432/checkin
   ```

   Optional provider keys enable additional features:

   ```env
   GROQ_API_KEY=
   SARVAM_API_KEY=
   ```

3. Create or update the development database schema:

   ```powershell
   pnpm run db:push
   ```

4. Start the frontend and API together:

   ```powershell
   pnpm dev
   ```

The application is available at <http://localhost:5173>. The API health endpoint is <http://localhost:5000/api/healthz>.

By default:

- Frontend: `5173`
- API: `5000`

To use different ports, set these values in `.env`:

```env
API_PORT=5000
WEB_PORT=5173
```

## Useful commands

Run the frontend production build:

```powershell
pnpm --filter @workspace/checkin-ai build
```

Preview the frontend production build:

```powershell
pnpm --filter @workspace/checkin-ai serve
```

Type-check the frontend:

```powershell
pnpm --filter @workspace/checkin-ai typecheck
```

Type-check all workspace packages:

```powershell
pnpm run typecheck
```

Build all workspace packages:

```powershell
pnpm run build
```

## Project structure

- [`artifacts/checkin-ai`](./artifacts/checkin-ai) - React/Vite frontend
- [`artifacts/api-server`](./artifacts/api-server) - Express API
- [`lib/db`](./lib/db) - PostgreSQL schema and database utilities
- [`lib/api-spec`](./lib/api-spec) - OpenAPI specification and code generation
- [`lib/api-client-react`](./lib/api-client-react) - Generated React API client
- [`scripts/dev.mjs`](./scripts/dev.mjs) - Root development launcher

## Troubleshooting

### `pnpm` is not recognized

Enable Corepack and activate pnpm:

```powershell
corepack enable
corepack prepare pnpm@latest --activate
```

### The API reports that `DATABASE_URL` is missing

Make sure `.env` exists in the repository root and contains a valid `DATABASE_URL`. The root development launcher reads environment variables from this file.

### AI or voice features do not work

Set `GROQ_API_KEY` for AI extraction and analytics. Set `SARVAM_API_KEY` for speech transcription. The rest of the application can run without these optional keys.

### Port already in use

Set different values for `WEB_PORT` and `API_PORT` in `.env`, then restart `pnpm dev`.
