# Abyss frontend

The Next.js 16 web app of [Abyss](../README.md): React 19, TypeScript, Tailwind CSS 4,
shadcn/ui on Radix, TanStack Query, React Flow (agent builder).

## Run

```bash
cp .env.example .env.local   # NEXT_PUBLIC_API_URL + the Firebase web config
npm ci
npm run dev -- -p 3100       # http://localhost:3100 (the backend runs on 8100)
```

`NEXT_PUBLIC_*` values are baked into the build, so changing one in Vercel needs a redeploy.

## Where things are

| Path | What |
|---|---|
| `src/app/` | Routes. Public: `/home`, `/about-trench`, `/auth/*`; everything else needs a session (`src/proxy.ts`) |
| `src/components/pages/<route>/` | Each route's implementation (see `CLAUDE.md` for the conventions) |
| `src/components/shared/` | Chat panel, Markdown rendering, Mermaid diagrams, interactive views, reasoning timeline |
| `src/components/ui/` | shadcn/ui primitives |
| `src/services/` | All API calls (one Axios instance in `src/lib/axios.ts`); streaming in `stream-service.ts` |
| `src/app/globals.css` | Design tokens: Sage `#9CAF88`, Off-White `#F7F5EF`, Tomato `#E8412C`, light and dark |

## Checks

```bash
npm run lint
npx next typegen && npx tsc --noEmit
npm run build
```

Production runs on Vercel; the Docker image (`Dockerfile`, standalone output) is used by
`compose.yaml` and scanned in CI.
