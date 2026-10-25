# Catan Clone — Agent Rules

Browser Catan clone. TypeScript (strict) + PixiJS v8 + Vite + Vitest, pnpm.
You are one of several parallel agents. An orchestrator assigns you ONE task (a KANBAN card) on your own git branch/worktree.

## Layout
```
src/engine/   pure TS rules engine. NO DOM, NO Pixi, NO Math.random, NO Date. Deterministic.
src/bots/     random bot + headless simulator
src/render/   PixiJS board view + hit-testing
src/ui/       HTML/CSS overlay (HUD, dialogs)
src/game/     controller wiring engine ⇄ render ⇄ ui ⇄ bots
docs/ARCHITECTURE.md   the contract. Read it first. Update it if you change a public type.
```

## Engine contract
- State is plain serializable data (JSON-safe). Never mutate input state.
- `applyAction(state, action)` returns `{ ok: true, state }` or `{ ok: false, error }`.
- `legalActions(state)` must only return actions that `applyAction` accepts.
- All randomness goes through the seeded RNG stored in state.
- Follow official Catan base-game rules (3–4 players). The rules reference is `docs/RULES.md` (sourced, with engine status per rule). When unsure, say so in your report.

## Working rules
- Stay inside your task's module(s). If you must touch another module, keep it minimal and mention it in your report.
- Do NOT edit `KANBAN.md`. List new card ideas in your final report.
- Engine code: write tests first or alongside; every rule gets a test.
- Change files with the Edit/Write tools, not sed/mv/python/heredocs in Bash (those need manual approval and stall you). Use `git mv` only when renaming.
- Prefix heavy commands with `nice -n 19` (installs, builds, test suites, sims).
- Before reporting done, all must pass:
  `nice -n 19 pnpm typecheck && nice -n 19 pnpm lint && nice -n 19 pnpm test`
- Commit on your branch with clear messages. Do not merge, rebase onto main, or push — the orchestrator does that.

## Final report (when done)
1. What now works (concrete)
2. What is left / known gaps
3. Files/modules touched outside your scope
4. New card ideas
