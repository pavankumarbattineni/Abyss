@AGENTS.md

# ThinkLoop — No-Code AI Agent Platform

This document is the development guide for ThinkLoop. It is derived from a full analysis of the interactive HTML prototype (`thinkloop.html`) and defines the product's purpose, architecture, requirements, and engineering standards for building the real Next.js application. Treat it as the source of truth for how the codebase should be organized and how features should behave; update it whenever a decision here is deliberately overridden.

## 1. Project Overview

ThinkLoop is a **no-code platform for building, configuring, and operating AI agents**. A non-technical user should be able to:

- Create an agent by describing its purpose and system instructions (no code, no infra).
- Attach tools (Gmail, Calendar, Drive, Slack, GitHub, Stripe, web search, custom MCP servers) to give the agent real-world capabilities.
- Compose multi-agent systems by nesting **sub-agents** under a parent/orchestrator agent, each with their own instructions and tools.
- Chat with an agent in a threaded conversation, watch it delegate to sub-agents and call tools in real time, and **approve or edit** any sensitive action (e.g., sending an email) before it executes.
- Manage which LLM providers and models power the platform, with per-key connection management and a default-model selection.
- Do all of the above through a visual, drag-free "builder" canvas rather than editing configuration files or code.

The prototype models a single-user "Personal workspace," but the platform must be designed so a workspace/team concept can be introduced without a rewrite (see [§13 Scalability](#13-scalability-considerations)).

## 2. Tech Stack

| Category             | Technology                  | Purpose                                          |
| -------------------- | ---------------------------- | ------------------------------------------------- |
| Framework            | Next.js (App Router)         | Frontend framework, file-based routing, SSR/RSC   |
| Language             | TypeScript (strict)          | Type safety                                       |
| UI Components        | shadcn/ui                    | Reusable, ownable UI components                   |
| Component Primitives | Radix UI                     | Accessible headless components                    |
| Styling              | Tailwind CSS v4              | Utility-first styling, CSS-variable theming        |
| Icons                | Lucide React                 | Icon library                                      |
| Data Fetching        | TanStack Query               | Server state, caching, mutations, polling         |
| HTTP Client          | Axios                        | API requests and interceptors                     |
| Local State          | Zustand                      | Client-only ephemeral state (builder, UI)          |
| Forms                | React Hook Form              | Form state management                             |
| Validation           | Zod                          | Schema validation (forms + API boundaries)         |
| Form Integration     | @hookform/resolvers/zod       | React Hook Form + Zod integration                 |
| Notifications        | Sonner                       | Toast notifications                               |
| Theme                | next-themes                  | Dark/light mode persistence                       |
| Node Builder         | React Flow (`@xyflow/react`) | Visual AI Agent Builder canvas                    |
| Markdown Rendering   | react-markdown + remark-gfm  | AI response rendering                             |
| Authentication       | Context API                  | Client-side auth/session state                    |
| Real-time Streaming  | Server-Sent Events (SSE)     | Streaming agent responses, tool-call/approval events |
| Date Utilities       | date-fns                     | Date formatting                                   |
| Utility Functions    | clsx + tailwind-merge        | Conditional class names (via `cn()`)              |

This is a **frontend repository**. It assumes a backend (agent orchestration engine, tool/OAuth broker, model gateway) exposed over REST + SSE. No orchestration logic, LLM calls, or credential storage live in this codebase — see [§12 Security](#12-security-considerations).

## 3. Architecture

### 3.1 Routing

Next.js App Router under `src/app/`:

- **`auth/`** — a real path segment (not a route group), so routes resolve at `/auth/login` and `/auth/reset-password`. Unauthenticated, centered, chrome-less layout.
- **`(dashboard)`** — a route group (adds no URL segment) for the authenticated shell. Renders only the persistent left `Sidebar` (platform nav, theme toggle, account, settings). There is no global top bar — Fleet-style, a header is a per-screen choice: a page renders its own heading/actions inline as part of its own content if it needs one, rather than a shared component wrapping every route.

`middleware.ts` guards `(dashboard)/*`, redirecting unauthenticated requests to `/auth/login`, and guards `auth/*` the other way for already-authenticated users. `src/lib/axios.ts`'s 401 handler redirects to this same `/auth/login` path.

### 3.2 Rendering strategy

- List/detail routes (`/agents`, `/tools`, `/providers`, `/mcp`, `/approvals`, `/settings`) are React Server Components that fetch initial data server-side and hydrate a TanStack Query cache (via `HydrationBoundary`), avoiding request waterfalls and loading spinners on first paint.
- Highly interactive surfaces are Client Components: the **chat view** (streaming, optimistic sends, scroll management), the **Agent Builder canvas** (React Flow, drag/inspect/connect), and any modal/dialog flow.
- Route-level `loading.tsx` and `error.tsx` boundaries are required per segment under `(dashboard)`.

### 3.3 State layering

Three distinct state systems, used for three distinct purposes — do not blur these lines:

| Layer | Tool | Owns |
|---|---|---|
| Server state | TanStack Query | Agents, sub-agents, tools, MCP servers, providers/models, threads, messages, approvals — anything the backend is the source of truth for. |
| Client/UI state | Zustand | Builder canvas selection/inspector-open state, split-pane width, active modal, toast queue, chat draft text, sidebar collapse. Never mirrors server data. |
| Form state | React Hook Form + Zod | Any editable form (agent fields, sub-agent fields, tool connect dialogs, API key dialogs, MCP add dialog, settings). Zod schema is the single source of truth for a form's shape and is reused for the mutation payload type. |
| Auth state | React Context | Current user/session, exposed via `AuthProvider`; backed by an httpOnly session cookie, not localStorage. |

### 3.4 Real-time chat

Agent replies, sub-agent tool-call progress, and approval requests stream into the active thread via **SSE** (`EventSource` or a fetch-based SSE reader), not polling. The chat UI must handle, as discrete event types: `message.delta` (token streaming), `tool_call.started/updated/completed`, `approval.requested/resolved`, and `error`. The prototype's typing-dots indicator and inline `thread-card` (tool call) / `approval-card` UI map directly to these event types.

### 3.5 Component layering

- `components/ui` — shadcn-generated primitives only. Treat as vendor code: extend via composition, avoid hand-editing generated internals beyond shadcn's intended customization points (CSS variables, `class-variance-authority` variants).
- `components/layout` — app chrome reused **across every page** (currently just `Sidebar`; add others here — e.g. `EmptyState`, `ConfirmDialog` — only once a second page genuinely needs them). There is deliberately no `Topbar`/`Header` in this folder: see §3.1.
- `components/pages/<route>` — the actual implementation of a route, one folder per page (see [§3.6](#36-page-convention)). Page-local state (search, filters, tabs), data-fetching calls, any page-specific header/heading, and any sub-component used only by that page (cards, avatars, badges, row items) all live here.

There is no top-level `components/<feature>` tier — a component either belongs to exactly one page (goes in that page's folder) or is genuinely cross-page (goes in `components/layout`). Don't create shared components speculatively; promote a page-local component only once a second page actually needs it.

### 3.6 Page convention

Every route's real implementation lives under `components/pages/<kebab-route-name>/` as:

- `<kebab-route-name>.tsx` — the page itself, exported as `export const <PascalCaseName>Page = () => { ... };`. Owns all page-level state and layout.
- Sibling files for page-only sub-components, e.g. `agent-card.tsx`, `agent-avatar.tsx`, imported relatively (`./agent-card`) — never re-exported from `index.ts`.
- `index.ts` — a pure barrel exporting only the page: `export * from "./<kebab-route-name>";`.

The matching `app/.../page.tsx` is a thin wrapper only:

```tsx
import { <PascalCaseName>Page } from "@/components/pages/<kebab-route-name>";

const Page = () => <<PascalCaseName>Page />;

export default Page;
```

This keeps every route file mechanically identical and puts the actual page logic somewhere it can be found without threading through the App Router's file-naming constraints. Reference implementation: `components/pages/agents/agents.tsx` + `index.ts` + `app/(dashboard)/agents/page.tsx`. Codified as the `.claude/skills/new-page` skill — invoke it (or follow it manually) when adding a new route.

## 4. Core Modules

1. **Auth** — login, reset password, session persistence, route guarding.
2. **Agents** — CRUD, search, status (running/idle), pending-approval badges, delete with confirmation.
3. **Chat & Threads** — per-agent thread list, message stream, tool-call cards, approval cards, typing indicator, file attach (see [§15](#15-out-of-scope--explicitly-deferred)).
4. **Agent Builder** — visual canvas: tool nodes (top) → center agent node → sub-agent nodes (bottom), inspector panel for editing the selected node, resizable split view (chat ⟷ canvas), attach/detach tools, add/remove sub-agents.
5. **Tools & Integrations** — categorized tool catalog (Google Workspace, Search, Other), OAuth connect flow, API-key connect flow, enable/disable toggle, custom MCP server registration.
6. **Model Providers & API Keys** — provider list (Groq, Anthropic, OpenAI, Google, …), masked key display, add/update/revoke key, default-model selection scoped to connected providers.
7. **Approvals** — human-in-the-loop gate for sensitive tool actions; aggregate inbox across agents plus inline per-thread cards; approve, approve-with-edit, or reject.
8. **Settings** — profile, appearance/theme, (future: workspace/team, billing).

## 5. Functional Requirements

### 5.1 Agents
- Create, rename, edit description/instructions, delete (with a destructive-action confirmation dialog naming the agent and warning that sub-agents + history are removed).
- Toggle status between `running` and `idle` (pause/resume).
- Search/filter the agent grid by name.
- Show sub-agent count and pending-approval count per agent, both in the grid and in the sidebar list.
- Deleting an agent cascades to its threads, messages, and sub-agents.

### 5.2 Chat
- Each agent has independent threads; switching agents shows that agent's thread list, not a shared one.
- Sending the first message in an empty thread sets the thread title from the message text.
- Agent responses stream token-by-token; a typing indicator shows before the first token arrives.
- A response may include zero or more **tool-call cards** (sub-agent or tool invocation with a live status: running/succeeded/failed) and at most one **approval card** per gated action.
- `Enter` sends; `Shift+Enter` inserts a newline.
- The composer shows the count of tools currently attached to the agent and deep-links to the Builder.

### 5.3 Agent Builder
- Canvas renders three tiers: attached tools, the center agent node, attached sub-agents — connected with edges (React Flow), matching the prototype's curved SVG connectors.
- Clicking any node opens its Inspector (name, description, instructions, attached tools as checkboxes against **connected** tools only).
- "+ Add tool" only offers tools/MCP servers whose connection status is `connected`; if none are connected, it deep-links to Tools & Integrations.
- "+ Add sub-agent" creates a sub-agent with placeholder fields, immediately opens its Inspector, and focuses the name field.
- Detaching a tool or removing a sub-agent requires no confirmation (non-destructive to history) but must update the canvas and thread's tool-count immediately.
- The chat/canvas split divider is drag-resizable with a minimum width on both panes (300px in the prototype).

### 5.4 Tools & Integrations
- Tools are grouped by category (Google Workspace, Search, Other) plus a distinct MCP Servers section.
- OAuth tools show a connect flow with a progress state, then flip to `connected`; API-key tools show a modal requiring a non-empty key.
- Connected tools expose an enable/disable switch and a "Reconfigure" action; disabled tools remain connected but are excluded from agent tool-attachment lists.
- Users can register a custom MCP server by name, URL, and optional bearer token.

### 5.5 Model Providers & API Keys
- Each provider shows connection status and a masked key (first 4 / last 4 chars) once set; "Add key" becomes "Update key" once connected.
- The default-model list only offers models from `connected` providers, as a single-select.
- Changing the default model is instantaneous (no separate save step) and confirmed via toast.

### 5.6 Approvals
- Any agent action flagged as sensitive by the backend renders as a pending approval card with the target tool, recipient/destination, and payload summary (e.g., attachment).
- Actions: **Approve & send** (executes immediately), **Edit before sending** (opens an editor for the drafted payload — not a mock in production), or reject.
- Pending counts roll up: per-agent (sidebar + agent card) and platform-wide (top nav badge).
- A dedicated `/approvals` inbox lists all pending approvals across agents for triage without opening each thread.

### 5.7 Cross-cutting
- Theme toggle (dark/light) persists per-user via `next-themes`, driven by CSS variables (already scaffolded in `globals.css` by shadcn).
- Every destructive or state-changing action confirms via toast; destructive-only actions (delete agent) additionally require a modal confirmation.

## 6. Non-Functional Requirements

- **Performance**: route-level code splitting (App Router default); virtualize long message lists and large tool/agent grids; debounce search inputs; React Flow canvas should only re-render affected nodes (memoized node components).
- **Accessibility**: Radix gives correct focus trapping/ARIA for dialogs and dropdowns for free — do not replace with hand-rolled modals. Icon-only buttons require `aria-label`. Canvas interactions must have a non-drag, keyboard-reachable equivalent (click-to-select nodes, as the prototype already does).
- **Reliability**: mutations are optimistic where safe (toggle tool enabled, pause/resume agent) with rollback on failure; destructive/irreversible actions (delete, send-after-approval) are never optimistic.
- **Resilience**: SSE connections reconnect with backoff; a dropped stream must not lose already-rendered messages, and resumes by re-fetching thread state.
- **Observability**: a client-side error boundary per `(dashboard)` route segment reports to a monitoring provider (Sentry or equivalent) with agent/thread context attached.
- **Internationalization-ready**: copy lives in components, not yet extracted to a message catalog, but avoid concatenating translatable strings so extraction later is mechanical.
- **Browser support**: evergreen Chrome/Edge/Firefox/Safari; no IE/legacy support required.

## 7. Data Model (frontend types)

These map directly to the prototype's in-memory mock state and belong in `src/types/`:

```ts
type AgentStatus = "running" | "idle";

interface Agent {
  id: string;
  name: string;
  initials: string;
  color: string;
  status: AgentStatus;
  description: string;
  instructions: string;
  toolIds: string[];
  subAgents: SubAgent[];
}

interface SubAgent {
  id: string;
  name: string;
  description: string;
  instructions: string;
  toolIds: string[];
}

type ToolAuthType = "oauth" | "key";
type ConnectionStatus = "connected" | "not_connected";

interface Tool {
  id: string;
  name: string;
  category: "Google Workspace" | "Search" | "Other";
  icon: string;
  color: string;
  auth: ToolAuthType;
  status: ConnectionStatus;
  enabled: boolean;
  actions: string[]; // e.g. ["send_email", "search_inbox"]
}

interface McpServer {
  id: string;
  name: string;
  url: string;
  status: ConnectionStatus;
}

interface ModelOption {
  id: string;
  name: string;
}

interface Provider {
  id: string;
  name: string;
  icon: string;
  color: string;
  status: ConnectionStatus;
  keyMasked: string | null;
  models: ModelOption[];
}

interface ToolCall {
  name: string;
  status: "running" | "succeeded" | "failed";
  detail: string;
}

interface Approval {
  tool: string;
  to: string;
  file: string;
  state: "pending" | "approved" | "rejected";
}

interface Message {
  id: string;
  role: "user" | "agent";
  text: string;
  createdAt: string;
  toolCall?: ToolCall;
  approval?: Approval;
}

interface Thread {
  id: string;
  agentId: string;
  title: string;
  messages: Message[];
  updatedAt: string;
}

type ExecutionStatus = "queued" | "running" | "succeeded" | "failed";

interface Execution {
  id: string;
  agentId: string;
  threadId?: string;
  status: ExecutionStatus;
  startedAt: string;
  finishedAt?: string;
}
```

Zod schemas in `src/schemas/` should validate the **write** side of these (create/update payloads); `src/types/` holds the **read** shapes returned by the API. Where they're identical, derive the type from the schema with `z.infer<>` rather than hand-duplicating.

## 8. Key User Flows

**Create & configure an agent**
1. `/agents` → "+ New Agent" → agent created with placeholder name, user is routed to `/agents/[agentId]/builder` with the Inspector open on the new agent node, name field focused.
2. User edits name/description/instructions in the Inspector (autosaves on blur or via explicit "Done Editing", per final UX decision — prototype auto-persists to in-memory state on every keystroke, production should debounce and persist via mutation).
3. User clicks "+ Add tool" → picks from connected tools/MCP servers → node appears on canvas, edge draws to the agent.
4. User clicks "+ Add sub-agent" → configures it the same way as the parent, optionally attaching its own tools.

**Chat with an agent**
1. `/agents/[agentId]` shows the thread list + active thread (or empty state if none).
2. User sends a message → optimistic user bubble appended → typing indicator → SSE stream renders the agent's reply, plus any tool-call/approval cards inline.
3. If an approval card appears, the thread is effectively blocked on that action until the user approves, edits, or rejects it.

**Connect a tool**
1. `/tools` → "Connect" on a not-connected tool.
2. OAuth tools: modal shows a progress bar while redirect/callback completes server-side, then flips to connected.
3. API-key tools: modal collects and validates a non-empty key, backend stores it encrypted, UI shows the masked key.

**Manage providers/models**
1. `/providers` → "Add key" per provider → key stored, provider becomes connected.
2. Default model list repopulates to include that provider's models; user selects one as the platform default.

**Resolve an approval**
1. From `/approvals` or inline in a thread → review the pending action's target/payload → Approve & send, Edit before sending, or reject.
2. Resolution updates the card in place (no page reload) and decrements all pending-count badges.

## 9. Coding Standards

- **TypeScript strict mode** everywhere; no `any` — use `unknown` + narrowing or generated/inferred types. Exported functions have explicit return types.
- **`useState` always takes an explicit generic** (`useState<string>("")`, `useState<QueryClient>(...)`), even when the initial value would let TypeScript infer it — don't rely on inference for component state.
- **File naming**: kebab-case filenames (`agent-card.tsx`), PascalCase component/type names, camelCase functions/variables, `use-*` hook files exporting `useXxx`, Zustand stores named `use<Domain>Store`.
- **One component per file**; colocate a component's tiny private sub-components in the same file only if they're not reused elsewhere.
- **Imports**: always via the `@/*` alias (`@/components/...`, `@/lib/...`); no `../../../` deep relative imports.
- **State discipline**: never copy TanStack Query data into a Zustand store "for convenience" — read it where needed via the query hook. Zustand is for state with no server counterpart.
- **Forms**: every form is `react-hook-form` + a Zod schema from `src/schemas/` via `@hookform/resolvers/zod`. The mutation function accepts the schema's inferred type, not a hand-written interface.
- **Styling**: Tailwind utilities + `cn()` for conditional classes; no ad-hoc inline `style={{}}` except for values that are genuinely dynamic and data-driven (e.g., an agent's user-chosen accent color), exactly as the prototype does for avatar backgrounds.
- **Server communication**: all HTTP calls go through `src/services/*` (thin wrappers around the shared Axios instance in `src/lib/axios.ts`); components and hooks never call `axios`/`fetch` directly.
- **Errors**: services throw typed errors; UI surfaces them via Sonner toasts and/or inline form errors — never a silent `console.error` as the only handling.
- **Comments**: only where the *why* isn't obvious from the code (a backend constraint, a workaround, a non-obvious invariant). Don't restate what the code does.
- **Linting/formatting**: ESLint (`next lint`, already configured) must pass with zero warnings before merge; run `npm run build` (which type-checks) before considering a change done.

## 10. Folder Structure

```
src/
├── app/
│   ├── auth/                           # real segment → /auth/login, /auth/reset-password
│   │   ├── layout.tsx
│   │   ├── login/page.tsx
│   │   └── reset-password/page.tsx
│   ├── (dashboard)/
│   │   ├── layout.tsx                 # Sidebar shell, no global header (see §3.1)
│   │   ├── page.tsx                   # redirects to /agents
│   │   ├── agents/
│   │   │   ├── page.tsx               # agent grid
│   │   │   ├── create/page.tsx
│   │   │   └── [agentId]/
│   │   │       ├── page.tsx           # chat
│   │   │       ├── builder/page.tsx   # visual builder
│   │   │       └── threads/[threadId]/page.tsx
│   │   ├── tools/page.tsx
│   │   ├── providers/page.tsx
│   │   ├── mcp/page.tsx
│   │   ├── approvals/page.tsx
│   │   └── settings/page.tsx
│   ├── globals.css
│   ├── layout.tsx                     # root layout: ThemeProvider, QueryProvider, AuthProvider
│   └── favicon.ico
├── components/
│   ├── ui/          # shadcn-generated primitives only
│   ├── layout/       # cross-page chrome only: Sidebar (theme toggle + account live here, not in a topbar)
│   └── pages/        # one folder per route (see §3.6) — page + its page-only sub-components + index.ts barrel
│       ├── agents/
│       │   ├── agents.tsx          # AgentsPage
│       │   ├── agent-card.tsx      # page-only, not re-exported
│       │   ├── agent-avatar.tsx    # page-only, not re-exported
│       │   ├── status-badge.tsx    # page-only, not re-exported
│       │   └── index.ts            # export * from "./agents"
│       ├── agents-builder/
│       ├── tools/
│       ├── providers/
│       ├── mcp/
│       ├── approvals/
│       └── settings/
├── services/         # authService, agentService, chatService, threadService, toolService,
│                      # providerService, mcpService, approvalService, executionService
├── hooks/            # useAgentBuilder, useChat, useChatStream, useApproval, useResizablePanel, useTheme
├── store/            # useBuilderStore, useChatStore, useUiStore  (Zustand — client-only state)
├── contexts/         # AuthProvider, QueryProvider, ThemeProvider (React context wrappers)
├── lib/              # axios.ts, utils.ts (cn), permissions.ts, storage.ts
├── schemas/          # Zod schemas: auth, agent, tool, provider, thread, approval
├── types/            # TypeScript types: auth, agent, tool, provider, mcp, thread, message, approval, execution
├── constants/         # routes, api, colors, models, tools
├── utils/            # format-date, copy, download, validation
├── assets/
└── middleware.ts
```

> Naming note: `src/providers/` (React context providers — `ThemeProvider`, `QueryProvider`) shares its name with the unrelated AI-model-provider *domain* (`src/components/pages/providers/`, `app/(dashboard)/providers/`). This is a known ambiguity, not a typo — when adding to either, check the import path, not just the word "provider".

## 11. Development Workflow

**Setup**
```bash
npm install
cp .env.example .env.local   # fill in required vars below
npm run dev
```

**Required environment variables** (backend-facing; none of these are LLM/OAuth secrets — those live server-side in the backend, never in this repo or `NEXT_PUBLIC_*`):
- `NEXT_PUBLIC_API_URL` — REST API base URL (read by `src/lib/axios.ts`).
- `NEXT_PUBLIC_SSE_URL` — streaming endpoint base URL (if different from the API base).

**Before opening a PR**
1. `npm run lint` — zero warnings.
2. `npm run build` — must succeed (this also runs the TypeScript check).
3. Manually exercise the changed flow in the browser — this repo has no test runner configured yet; until one is added, a working build + lint is necessary but not sufficient.
4. Keep commits scoped and messages in the imperative mood (`add agent builder inspector`, not `added`/`adds`).

**Branching**: feature branches off `main`, PR review required before merge, no direct pushes to `main`.

## 12. Security Considerations

- **No secrets in the frontend.** OAuth client secrets, provider API keys (Groq/Anthropic/OpenAI/etc.), and MCP bearer tokens are submitted to the backend and never stored in `localStorage`, cookies readable by JS, or Zustand. The frontend only ever renders a masked representation returned by the API.
- **Session**: httpOnly, secure, `SameSite=Lax` (or stricter) cookie issued by the backend; `AuthProvider` reads session/user info from a `/me`-style endpoint, not from a client-decoded token.
- **XSS**: agent responses are rendered with `react-markdown`; do not enable raw HTML rendering (`rehype-raw`) unless the backend guarantees sanitized output — treat all agent/tool output as untrusted.
- **CSRF**: state-changing requests (approve/reject, delete agent, connect tool) must be protected per the backend's CSRF scheme (double-submit cookie or same-site cookie + custom header).
- **Authorization**: every dashboard route and mutation assumes the backend re-checks permissions; the frontend's route guards and `hasPermission()` checks are UX conveniences, not the security boundary.
- **Approvals are a security control, not just a UX pattern** — any tool action capable of external side effects (sending email, posting to Slack, financial actions) must default to requiring approval unless a user has explicitly marked that specific action auto-approved for that agent.
- **Least privilege for tool connections**: OAuth scopes requested per tool should be the minimum needed for the actions listed on that tool card.

## 13. Scalability Considerations

- **Multi-tenancy**: the prototype shows one "Personal workspace." Model `workspaceId` into the data layer now (even if the UI doesn't expose switching yet) so agents/tools/providers are workspace-scoped from day one — retrofitting tenancy later is a much larger migration than including an ID column/field up front.
- **Pagination & virtualization**: agent grid, tool catalog, and message lists must support pagination/virtualized rendering — the mock data is small, but the architecture (TanStack Query + list components) should assume hundreds of agents and long-running threads.
- **Builder canvas performance**: React Flow nodes should be memoized and only the affected subtree re-rendered on inspector edits; large multi-agent graphs (many sub-agents, many tools) must stay interactive.
- **Streaming at scale**: SSE is sufficient for single-connection-per-open-thread; if concurrent multi-thread streaming per user becomes common, revisit in favor of a multiplexed WebSocket.
- **Service layer isolation**: all backend communication is centralized in `src/services/*`, so the backend can evolve (REST → GraphQL, SSE → WebSocket) behind that boundary without touching components/hooks.
- **Page-colocated structure**: the `components/pages/<route>` + `services/<feature>` + `types/<feature>` mirroring makes it straightforward to extract a page into a separate package or micro-frontend later if the platform grows that large.

## 14. Assumptions Inferred From the Prototype

The prototype is a static, client-only mock (in-memory state, `setTimeout`-simulated async work, no real backend). The following are inferred requirements not literally shown, but necessary for a production system:

- A real backend exists for: agent/thread persistence, LLM orchestration and sub-agent delegation, tool execution, OAuth token exchange/refresh, encrypted credential storage, and SSE event emission.
- An **Execution** concept (see [§7](#7-data-model-frontend-types)) is needed even though the prototype has no "run history" view — every agent invocation needs an auditable record for the Approvals flow and future observability/billing.
- Multi-tenant workspaces (users, roles, invites) will eventually be needed; the prototype's single hardcoded user ("Pavan Kumar," "Personal workspace") is a placeholder, not a design decision to keep single-user forever.
- Role-based access control (who can connect tools, approve actions, edit agents) is not shown but is implied by the existence of an approval gate — approvals only make sense if the approver can differ from the agent's creator/operator.
- "Edit before sending" on an approval card is a mocked toast in the prototype; production requires a real inline editor for the drafted payload (e.g., email body) before resubmission.

## 15. Out of Scope / Explicitly Deferred

The prototype marks these as future work — do not build them speculatively ahead of a dedicated spec:

- **Skills** — the builder canvas shows a "Coming soon — reusable capabilities you can attach to any agent" placeholder node. Treat as a future first-class entity (likely similar shape to a Tool but user-authored); do not shoehorn it into the Tools domain now.
- **Chat file attachments** — the composer's "Attach" pill is a placeholder ("coming soon") in the prototype; implement only when the backend defines upload/storage semantics.
