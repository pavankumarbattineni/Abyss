# Abyss — planned features

Three features are designed but deliberately **not implemented yet** (paused 2026-11-17, to resume later).
Each document records the decisions, the reasoning and the open questions, so work can restart without
re-discussing them.

| Plan | Status | What exists in code today | Document |
|---|---|---|---|
| Personal Memory System | Design proposed, awaiting final approval | Static Settings → Memory page (`/settings/memory`), no backend | [personal-memory.md](personal-memory.md) |
| Document & photo upload | Direction agreed | Static "+" menu in the chat composer (both options "Coming soon"), no backend | [document-upload.md](document-upload.md) |
| Whiteboard | Plan agreed | Nothing | [whiteboard.md](whiteboard.md) |

## When resuming
1. Re-read the plan and check the "Open decisions" section — answer those first.
2. Re-verify the code references against the current `development` branch (they were checked at commit `42d0011`).
3. Branch from `development` as `Abyss-<N>-<Title>`; one feature per branch/PR; production deploys from `development`.
4. Suggested order: Personal Memory v1 → Document upload → Whiteboard (memory touches every agent and benefits the other two).
