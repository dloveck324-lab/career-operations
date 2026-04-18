# Stack & Conventions

## Package manager
npm workspaces. Root `package.json` declares `apps/*` and `packages/*` as workspaces.
Run all installs from the repo root: `npm install`.

## TypeScript
- `tsconfig.base.json` at root — shared options (`strict: true`, `ES2022`, `bundler` module resolution for web).
- Server uses `NodeNext` module resolution (overrides base) to support native ESM with `.js` extensions in imports.
- Web uses `bundler` resolution (Vite handles resolution).
- All source files use `.ts` / `.tsx`. Imports inside server use `.js` extensions (NodeNext requirement even for `.ts` source).

## Server conventions
- Fastify 5 + `@fastify/sensible` (for `app.httpErrors.*`).
- All routes use async/await — Fastify handles promise rejection automatically.
- `zod` for request body validation. Parse with `z.object(...).parse(req.body)` — throws 400 on failure.
- No ORM. Raw SQL via `better-sqlite3` (synchronous, fast, zero setup).
- `db.pragma('journal_mode = WAL')` — mandatory for concurrent reads.
- `db.pragma('foreign_keys = ON')` — enforces referential integrity.

## Frontend conventions
- React 19 (no class components).
- MUI v6 — use `sx` prop for one-off styles, `theme.ts` for global overrides.
- `@mui/x-data-grid` v7 for tables — use `GridColDef` with typed `renderCell`.
- State: local `useState` / `useCallback`. No global state manager needed (small app, single user).
- Routing: `react-router-dom` v7. Only two routes: `/pipeline` and `/settings`.
- All server communication through `apps/web/src/api.ts`. Never call `fetch` directly in components.

## SSE pattern
Server: Fastify route sets `Content-Type: text/event-stream`, keeps connection open, writes `data: {json}\n\n` per event.
Client: `createSseConnection()` in `api.ts` wraps `EventSource`. Returns a disconnect function.
`AppShell.tsx` subscribes to `/api/scan/events` once on mount — covers both scan and evaluate progress.

## File naming
- React components: `PascalCase.tsx`
- Utilities, routes, adapters: `camelCase.ts`
- Config files: `kebab-case.yml`
