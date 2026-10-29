# Online client (M3)

The browser side of online play. Protocol and server: `docs/MULTIPLAYER.md` (M1, M2).

## Flow

```
home (no ?room)                    invite link (?room=CODE)
 ├ Play online  → POST /api/rooms ─┐  ├ token for CODE stored → connect at once (reload/reconnect)
 ├ Join with code → GET  /api/rooms/CODE  └ else join card: nickname (prefilled) → Join / Watch
 └ Play offline → hotseat (unchanged: resume prompt / setup screen)
                                   ▼
        RoomClient (WebSocket /api/rooms/CODE/ws) ── room.phase ──┐
            lobby  → LobbyScreen (seats, invite link, settings, chat, start)
            playing/over → NetGameController (BoardView + Hud from server views), chat in sidebar
            lobby again (host: "Back to lobby" = rematch) → LobbyScreen
```

Dev params (`?fixture`, `?seats`, `?autoplay`, ...) still start a hotseat game directly.

## Modules

| Module                             | What                                                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/net/transport.ts`             | `Transport`/`Connect` (socket-like), `Clock`, `KeyStore`, `RoomApi`, `tokenKey`, `NAME_KEY`, `parseRoomCode` (codes or pasted links, via `api.ts`)                                                                                                                         |
| `src/net/client.ts`                | `RoomClient`: hello with stored token, keeps room/game/chat, `intent` stamps `seq`, ping every 25 s, dead socket after 60 s silence, reconnect with backoff 0.5 s × 2ⁿ (max 15 s, jitter), stops on 4000–4004 / fatal errors (`fatal`). No DOM, no timers (clock injected) |
| `src/net/loopback.ts`              | `RoomHost` (GameSession on LocalNet, alarm at `nextWakeAt` on an injected clock), `hostConnect` (Connect into it, with an `offline()` switch), `FakeClock`                                                                                                                 |
| `src/game/online/backend.ts`       | `Backend` = `RoomApi` + `connect`; WebSocket + fetch for the Worker; picks local vs remote; token stores                                                                                                                                                                   |
| `src/game/online/devServer.ts`     | in-browser room server (`RoomHost`s on real timers)                                                                                                                                                                                                                        |
| `src/game/online/devWorker.ts`     | SharedWorker hosting `DevServer` so tabs share rooms; `devBackend.ts` is the tab side (falls back to in-page where SharedWorker is missing)                                                                                                                                |
| `src/game/online/netController.ts` | `NetGameController`: renders `game` messages, clicks → intents, local countdown of the server's `timer`, `seatFlags` (bots, away), a toast when a trade offer this seat took part in ends without its own click (`tradeEndNotice`: withdrawn, everyone rejected, traded)   |
| `src/game/online/app.ts`           | `OnlineApp`: room check, nickname, lobby ⇄ game by phase, chat panel, reactions, reconnect banner, fatal screens, error toasts                                                                                                                                             |
| `src/ui/online/*`                  | `HomeScreen`, `LobbyScreen` (+ pure `lobbyModel`), `RoomConfigPanel`, `ChatPanel` + `ReactionLayer`, `ConnectionBanner`, error wording, `online.css`                                                                                                                       |

## Server selection

- `?server=local`: the dev server in the browser (SharedWorker). Default under `pnpm dev` unless
  `VITE_ROOM_SERVER` is set. Rooms live as long as one tab of this browser is open.
- `?server=remote` (default in builds): the Worker at `VITE_ROOM_SERVER` or this origin.
  `pnpm dev` proxies `/api` (WebSocket too) to `wrangler dev` on :8787, so `pnpm dev` +
  `?server=remote` talks to a local Worker. `pnpm dev:server` serves both on :8787.
  `VITE_ROOM_SERVER` is read at build time only: `vite.config.ts` also adds that origin (and its
  `wss:` form) to the page's Content-Security-Policy, so any other origin is blocked by the
  browser (MULTIPLAYER.md §12).
- Tokens: `localStorage['catan.mp.token.<CODE>']` for real rooms (two tabs = same player, the
  newer takes over: `replaced`). The dev server keeps them in `sessionStorage` so two tabs of one
  browser are two players. Nickname: `localStorage['catan.mp.name']`.
- Invite link: this page with `?room=CODE` (an explicit `?server=` is kept).

## Lobby

- Seats: open seats read "<Colour> Bot — a Normal bot plays it" (the seat's level); the host gets
  a difficulty picker (Easy / Normal / Hard, `setBotLevel`) on each open seat. Named members can sit / move / stand up and
  pick a free colour. Host: **Add bot** (+1 seat, the map follows like the setup screen's player
  stepper), **Remove** (only the last seat, when open, above the map minimum), **Start**
  (needs someone seated). Card layout: dot + name (one line, ellipsis) + status on top; the
  colour swatches and a footer row (level picker left, buttons right, wrapping) under it.
- Joining sits you down (server auto-seat, MULTIPLAYER.md §2); the invite note under the link
  says so, and names the seat cap when the table is full. A member without a seat gets a
  "You're watching. Pick a seat: [Sit here]" bar at the top (first open seat).
- Copy link: "Copy link" and "Copied!" share one grid cell (the hidden one keeps its width).
- Settings: the hotseat `SetupScreen` wrapped unchanged. Its `storage` option is a bridge: the
  draft it loads comes from the room config, every save becomes a (debounced 250 ms)
  `configure`. CSS hides its seats, seed and footer. Non-hosts get it `inert` and dimmed, rebuilt
  on every config change. New setup-screen rule options flow through as long as `buildConfig`
  emits them and `parseRoomConfig` (server) accepts them.

## HUD additions (`src/ui`)

- `HudView.spectator` (pass `viewer: -1`): no hand bar, no buttons, no dialogs, dice stay, a
  "Spectating" pill next to the turn pill. The build cards stay as a read-only price list
  (`.build-bar.is-costs`, all disabled) with their cost tooltips (#35).
- `HudView.away[]`: disconnected owner → offline icon in the player list (also when a bot plays
  for them).
- `Hud.setChat(el)`: a persistent Chat section at the bottom of the sidebar (typing survives
  renders). `Hud.setSessionActions([...])`: replaces "New game" in the menu and on the winner
  screen ("Leave room"; host after game over: "Back to lobby").
- The turn pill drops in only when its content changes (it used to replay the animation on every
  render and timer tick).

## Playtest harness (online)

`pnpm pt:serve --online --seats N [--bots B] [--map M] [--timer SEC] [--vp N] [--headed] [--remote URL]
[--mode ck|seafarers|tb|ep|oil|crop|seafarers+ck|tb+ck [--scenario fogIslands]]` (X1: an expansion
room with the setup screen's defaults for that mode / scenario; `<id>/` may be left out of the
scenario; the seat total must fit its player range):
reuses or starts `pnpm dev:server` (:8787), creates a room as Seat1 through the real home screen,
applies the table settings with a `configure`, joins Seat2..N from the invite link, sits them,
starts. One browser context (own token) per seat; the `pnpm pt <seat> ...` CLI is routed to that
seat's page (`scripts/playtest/`, `playtest/PLAYBOOK.md`). `?debug=1` installs `__catanDebug`
over the server view (`OnlineApp.debugController`). Extra commands: `chat`, `drop`, `reconnect`, `reload`.

## Tests

- `src/net/client.test.ts`: RoomClient over LocalNet — lobby → start → intents, errors, backoff
  reconnect, mid-game away → bot → reclaim, `replaced`, spectators, timer, dead socket, version.
- `src/game/online/netController.test.ts`: views per seat, HUD actions/board clicks → intents,
  spectator view, timer, away flags.
- `src/ui/online/online.test.ts` (jsdom): lobby model and screen, config bridge, chat, home, HUD
  spectator/away/chat/menu.
- `pnpm e2e:online`: headless Chrome, 2 tabs on the dev server — hotseat from home, create, join
  by link, seats, remove bot, host config seen by guest, chat, start, play, reactions,
  spectator, closed tab → away. Screenshots in `playtest/shots/e2e-online`.
  `pnpm e2e:online --remote http://localhost:8787/` runs it against `pnpm dev:server` (one
  browser profile per player) and adds a network-drop → reconnect check.
