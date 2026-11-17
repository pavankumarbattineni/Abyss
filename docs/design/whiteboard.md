# Whiteboard — plan

Status: **planned, not started** · Last updated: 2026-11-17

## 1. Goal
A collaborative visual surface in Abyss (inspired by Claude's whiteboard): the user and the agent sketch, diagram and plan
together inside a thread.

## 2. Plan agreed
- **Canvas:** Excalidraw (MIT) embedded in the Abyss frontend, one board per thread.
- **Agent participation through a "proposals" layer:** the agent suggests shapes or edits as structured data; the user
  accepts or rejects them. The agent never silently overwrites the user's drawing.
- **Reuse:** the 15 native visual formats (```` ```visual ```` blocks, `get_visual_format` tool, renderers in
  `abyss_frontend/src/components/visuals`, schemas in `src/lib/visuals`) as building blocks for agent proposals.
- **Phases:**
  1. Static board per thread + save/load.
  2. The agent can read the board as context.
  3. Agent proposals (accept/reject).
  4. Polish and export.

## 3. Open decisions
- Storage of board state (JSON in Postgres per thread vs object storage for large boards).
- How the agent reads a board (structured summary vs rendered image for vision models).
- Interaction with Personal Memory and document upload (e.g. dropping an uploaded image onto the board).
