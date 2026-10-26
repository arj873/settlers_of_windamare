# Online multiplayer — the contract (M1)

Stage 4. Friends play one game from their own browsers. Decisions (from the user): invite link +
nickname (no accounts); the host creates a room and shares `/room/<id>`; friends join, type a
name, pick a seat and colour; reconnect from the same browser; bots fill empty seats and play for
disconnected players; text chat + quick reactions; a server-enforced turn timer; spectators;
Cloudflare Workers + one Durable Object per room, in the same project as the static site
(docs/HOSTING.md §3).

M1 delivered the contract and the pure core. M2 built the room server on it (§18). M3 (client)
builds on both.

| Module                   | What                                                                    | Used by      |
| ------------------------ | ----------------------------------------------------------------------- | ------------ |
| `src/engine/view.ts`     | `viewFor(state, seat \| 'spectator')`, public-info helpers (§6)         | server, UI   |
| `src/net/protocol.ts`    | message types, `parseClientMessage`, `parseServerMessage`, limits (§13) | both         |
| `src/net/guard.ts`       | tiny runtime validators (no dependencies)                               | protocol     |
| `src/net/session.ts`     | `GameSession`: one room, transport-agnostic (§4)                        | M2, M3 tests |
| `src/net/testHarness.ts` | `LocalNet` (in-memory transport + fake clock), `fakeDeps`               | tests, M3    |
| `src/net/api.ts`         | HTTP API paths and shapes, room codes (M2, §18)                         | both         |
| `src/server/`            | Cloudflare Worker + room Durable Object (M2, §18)                       | server       |

`src/net` is lint-checked like the engine: no DOM, no `Date`, no `Math.random`, no timers.

---

## 1. Architecture

```
 browser (M3)                         Cloudflare Worker (M2)                    Durable Object "Room" (M2)
 ┌───────────────────┐  POST /api/rooms  ┌──────────────┐  idFromName(code) ┌──────────────────────────────┐
 │ home: Create room │ ────────────────► │ route        │ ────────────────► │ GameSession (src/net)         │
 │ /room/<code> lobby│ /api/rooms/<c>/ws │ /api/*, /ws/* │   fetch upgrade  │   full GameState (secret)     │
 │ NetController     │ ◄══ WebSocket ══► │ else: static │ ◄══════════════► │   seats, members, chat, clock │
 │ Hud + BoardView   │                   │ assets (SPA) │                   │   bots (src/bots)             │
 └───────────────────┘                   └──────────────┘                   │ storage: SessionSnapshot      │
                                                                             │ alarm:   nextWakeAt()         │
                                                                             └──────────────────────────────┘
```

- **The server is the authority.** It runs the same pure engine. Clients never hold the full
  state and never run `applyAction`; they send **intents** (an engine `Action`), the session
  validates the message shape, checks the sender owns `action.player`, then calls `applyAction`
  on the full state. Rejections go back to the sender only.
- After every change the session sends **each connected member their own view**
  (`viewFor(state, seat)`) plus **their own legal actions** (computed from the full state with
  `legalActions`, filtered to their seat). The HUD already enables buttons from `legal` only.
- **Bots and the turn timer run on the server**, inside the session, using `src/bots` and the
  pure `src/game/turnTimer.ts` (the same code as hotseat).
- `GameSession` knows nothing about sockets or Cloudflare. M2 is a thin adapter: socket events →
  `open/receive/close`, alarm → `tick`, results → `ws.send / ws.close`, `snapshot()` → storage.

## 2. Room lifecycle

```
             POST /api/rooms
                   │  GameSession.create(roomId, now, deps) → { session, hostToken }
                   ▼
   ┌──────────► lobby ──────── host: start ────────► playing ──── winner ────► over
   │            │  hello / setName / takeSeat /           │  intents, bots,           │
   │            │  leaveSeat / setColor /                 │  timer, chat,             │
   │            │  host: configure, kick                  │  disconnect → bot         │
   │            │                                         │                           │
   └────────────┴──────────── host: rematch ◄─────────────┴───────────────────────────┘
                (seats kept; members gone past the grace period lose their seat)

   any phase: no member connected for idleExpiryMs (24 h) → isExpired(now) → M2 deletes storage
```

- **Create**: the Worker makes a random room code (M2: 6 chars from `ROOM_CODE_ALPHABET`, no
  0/O/1/I, ≈ 30 bits; a collision with a live room retries with a new code, §18) and calls
  `GameSession.create`. The response carries `{ roomId, hostToken }`; the client stores the token
  (§8) and navigates to `/room/<code>`. The host member exists before anyone connects.
- **Lobby**: default config `DEFAULT_ROOM_CONFIG` (`baseRandom`, 4 seats, 90 s timer, 10 VP,
  discard limit 7). Seats are created with the palette colours in order. Seat count follows
  `config.seatCount` (map range is validated); shrinking unseats the members in removed seats.
- **Start** (host): needs at least one seated member. Seats → `NewGameConfig` (stage-2 setup
  config, `src/ui/types.ts`): seated members play under their nickname, open seats become
  `"<Colour> Bot"`; names are made unique. Seed from `deps.seed()`; `gameConfigOf(cfg, seed)`
  (`src/game/logic.ts`, shared with the hotseat controller) → `createGame`. Starting seat is
  drawn from the seed as in hotseat. Bot RNG `bots:<seed>`, timeout RNG `timer:<seed>` (as the
  controller).
- **Play**: §9–§11.
- **Game over**: room phase `over`; the last `game` message reveals every hand (final scores show
  VP cards). System chat "X won the game!".
- **Rematch** (host, `over` only): back to `lobby`, same config and seats; the host presses start
  again (new seed). Seats of members still away after the grace period are freed.
- **Expiry**: `isExpired(now)` is true once no member has been connected for `idleExpiryMs`.
  `nextWakeAt()` returns that moment while the room is empty, so an alarm fires then. A `hello`
  to an expired room gets `room_expired` (close 4004).

## 3. Seats and roles

| Role      | Who                                 | Can                                                                        |
| --------- | ----------------------------------- | -------------------------------------------------------------------------- |
| host      | creator (`hostToken`), or successor | `configure`, `kick`, `start`, `rematch` + everything a player can do       |
| player    | member with a seat                  | lobby: move seat, colour; game: `intent` for their seat only               |
| spectator | member without a seat               | watch (spectator view, `legal: []`), chat, react; take a seat in the lobby |
| bot       | not a member: a seat with no human  | plays open seats for the whole game, and away seats after the grace period |

`SeatInfo.status`: lobby `human` (taken) / `bot` (open → bot at start); game `human`
(connected), `away` (disconnected, grace running, still the player's turn and clock), `bot`
(open seat, or grace over: a bot plays until the owner returns). `occupant` stays set while a
bot plays for someone, so they can reclaim.

- Joining after the start makes you a spectator. Taking over an open bot seat mid-game is not
  supported (the engine's player names are fixed; see §17).
- **Host succession**: when the host has been disconnected for `graceMs` (or was never
  connected) and someone else is connected, the longest-present connected member (seated first)
  becomes host. System chat "X is now the host".
- **Kick** (host): the member gets `kicked` (close 4002) and is removed; their token stops
  working; their seat opens (lobby) or goes to a bot for good (game).
- Members per room: `LIMITS.members` (32). When full, the longest-gone member without a seat is
  forgotten to make room; otherwise `room_full` (close 4001).

## 4. GameSession API (for M2 and M3)

```ts
const { session, hostToken } = GameSession.create(roomId, now, deps, opts?);
const session = GameSession.restore(snapshot, deps, opts?);   // after a Durable Object restart

session.open(conn, now)          // socket accepted; nothing is sent until the client says hello
session.receive(conn, raw, now)  // raw = the frame string (or a parsed value)
session.close(conn, now)         // socket closed / errored
session.tick(now)                // alarm fired: bots, turn timeouts, grace periods
session.reconcile(liveConns, now)// after restore: forget sockets the runtime no longer has
// each returns Outbound[]:
//   { kind: 'send', conn, msg: ServerMessage }  → ws.send(JSON.stringify(msg))
//   { kind: 'close', conn, code, reason }       → ws.close(code, reason)

session.nextWakeAt()             // absolute ms of the next due tick, or null → storage.setAlarm
session.isExpired(now)           // → storage.deleteAll()
session.snapshot()               // JSON-safe SessionSnapshot → storage.put('session', …)
session.room(), .state, .phase, .seq   // read-only (logs, tests). `.state` is SECRET.
```

- `deps: SessionDeps = { token(), seed() }`: tokens must be unguessable, ≥ 128 bits, matching
  `[A-Za-z0-9_-]{16,128}` — `crypto.randomUUID()` fits. Seeds: any fresh string.
- `opts: SessionOptions` (defaults `DEFAULT_SESSION_OPTIONS`): `graceMs` 60 000, `botDelayMs`
  900 (reactions × `FAST_FACTOR` 0.4), `timeoutStepMs` 400, `idleExpiryMs` 24 h, `bot`
  (`defaultBot` of the hotseat controller).
- Time only enters through `now`. Within one call the session does all due work in order
  (several bot moves if they are due) and sends **one** `game` message per member at the end.
  With `botDelayMs: 0` a whole bot sequence collapses into one call (tests).
- Outbound order matters: send in the returned order.
- **Durable Object sketch (M2):**
  ```ts
  // fetch (upgrade): const conn = crypto.randomUUID(); ws.serializeAttachment({ conn });
  //   this.ctx.acceptWebSocket(ws); run(session.open(conn, Date.now()))
  // webSocketMessage(ws, data): run(session.receive(attachment(ws).conn, data, Date.now()))
  // webSocketClose/Error(ws):   run(session.close(attachment(ws).conn, Date.now()))
  // alarm():                    run(session.tick(Date.now())); if (session.isExpired(now)) deleteAll
  // run(out): deliver out, then storage.put('session', session.snapshot()),
  //           then setAlarm(session.nextWakeAt()) or deleteAlarm()
  // constructor: restore from storage, then reconcile(ctx.getWebSockets().map(conn), now)
  // ping: ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  ```
  Persist after every call that returned something or changed state (simplest: every call).
  Snapshots are small (a late 4-player state with the full 200-entry log is ≈ 17 KB of JSON). The DO may use `setTimeout` while awake
  instead of an alarm for sub-second bot delays; the alarm stays the source of truth.

## 5. Sequence diagrams

### 5.1 Create, join, take seats

```
Host browser              Worker              Room DO / GameSession             Friend browser
    │ POST /api/rooms        │                         │                              │
    │───────────────────────►│ create(roomId)         │                              │
    │                        │────────────────────────►│ host m1 (token T1)           │
    │ { roomId, hostToken }  │◄────────────────────────│                              │
    │◄───────────────────────│                         │                              │
    │ localStorage[room]=T1; open /api/rooms/<code>/ws │                              │
    │═════════════════════════════════════════════════►│ open(c1)                     │
    │ hello{token:T1, name:'Ann'}                      │                              │
    │─────────────────────────────────────────────────►│                              │
    │ welcome{you:m1,T1, room, chat}                   │                              │
    │◄─────────────────────────────────────────────────│                              │
    │ (shares https://…/room/<id>)                     │      opens link, no token     │
    │                                                  │◄═════════════════════════════│ open(c2)
    │                                                  │  hello{token:null,name:'Bob'}│
    │                                                  │◄─────────────────────────────│
    │                                                  │ new m2, token T2             │
    │                                                  │ welcome{you:m2,T2,…} ───────►│ store T2
    │ room{members:[Ann,Bob]}, chat "Bob joined…"      │ ───────────────────────────► │ room, chat
    │◄─────────────────────────────────────────────────│                              │
    │ takeSeat{0}                                      │           takeSeat{1}        │
    │─────────────────────────────────────────────────►│◄─────────────────────────────│
    │ room (each change, to everyone)                  │─────────────────────────────►│
```

### 5.2 Start and a turn

```
Ann (host, seat 0)                 GameSession                                 Bob (seat 1)
    │ configure{…seatCount:3}          │                                          │
    │ start ─────────────────────────► │ createGame(seed) · seat 2 = "White Bot"  │
    │ ◄── room{phase:playing}, chat ── │ ── room, chat ─────────────────────────► │
    │ ◄── game{seq:1, view(0), legal(0), timer} ── game{seq:1, view(1), legal(1)} ►│
    │ intent{placeSetupSettlement…, seq:1}                                        │
    │ ───────────────────────────────► │ parse → seat check → seq check →         │
    │                                  │ applyAction(full state) ok               │
    │ ◄── game{seq:2,…} ────────────── │ ── game{seq:2,…} ──────────────────────► │
    │                                  │  … bot's turn: botDueAt = now+900        │
    │                                  │  alarm → tick(now) → bot move            │
    │ ◄── game{seq:n} ──────────────── │ ── game{seq:n} ────────────────────────► │
    │ intent{rollDice, seq:old}        │                                          │
    │ ───────────────────────────────► │ seq ≠ current                            │
    │ ◄── error{stale_state} + game{current}                                      │
```

### 5.3 Disconnect, bot takes over, reconnect reclaims

```
Bob                     GameSession                                         Ann
 │ socket drops            │ close(c2): seat 1 → away; room ────────────────► │ "Bob away"
 │                         │ (Bob's turn: clock keeps running; no timer → the turn waits)
 │                         │ … graceMs later: tick → seat 1 → bot             │
 │                         │ chat "Bob is away; a bot plays until they return"► │
 │                         │ bot moves for seat 1 every botDelayMs ─ game ───► │
 │ reopens /room/<id>      │                                                   │
 │ hello{token:T2} ───────►│ m2 found → seat 1 → human; chat "Bob is back…"   │
 │ ◄── welcome, game{view(1), legal(1)} ── room ──────────────────────────────► │
```

A reconnect within the grace period silently flips `away` back to `human`. The same token on a
second tab replaces the first socket (`replaced`, close 4003).

### 5.4 Turn timeout

```
GameSession: slot = timerSlot(state, seats, legal, null)   (src/game/turnTimer.ts)
   clock = syncClock(clock, slot, turnTimerSec·1000); nextWakeAt = clockAt + remainingMs
   alarm → tick: clock expired → timeoutMove(...) for the player on the clock
         chat "Ann ran out of time" (once per slot); repeat every timeoutStepMs until the slot ends
   every game message: timer{player, kind, remainingMs, totalMs} → client counts down locally
```

### 5.5 Spectator

```
Eve: hello{token:null,name:'Eve'} → welcome (seat:null) → game{view(spectator), legal:[]}
     chat / react allowed · intent → error{not_seated}
```

## 6. Hidden information (`src/engine/view.ts`)

`viewFor(state, viewer)` returns a **GameView**: the GameState shape with secrets masked, plus
`view: ViewInfo`. Because the shape is unchanged, `BoardView.render` and `Hud.render` accept it.

| Secret                                                    | In a view                                 | Public replacement                                                |
| --------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------- |
| other players' `resources`                                | all 0                                     | `view.handCounts[p]`                                              |
| other players' `devCards`, `newDevCards`                  | all 0                                     | `view.devCardCounts[p]`                                           |
| `devDeck` order and composition                           | `HIDDEN_DEV_CARD` × length                | `devDeck.length`                                                  |
| `diceDeck` (balanced dice)                                | `0` × length                              | `diceDeck.length`                                                 |
| `rng`                                                     | `0`                                       | —                                                                 |
| `settings.seed` (+ "Game created …, seed X" log line)     | `HIDDEN_SEED`; seed removed from the line | —                                                                 |
| exact special-build queue (depends on hands)              | —                                         | `view.specialBuildQueue` (all builders still to come, unfiltered) |
| `stats` (UX2: stolen cards, dev cards bought, VP history) | absent until `gameOver`, then all of it   | —                                                                 |

Kept (public by the rules): board, pieces, robber, bank, dice, phase (incl. discard `pending`
counts, trade offers, steal candidates), awards, knights and progress cards played, turn, log.
A spectator is masked like an opponent for every seat. At `gameOver` hands, dev cards and the
game statistics are revealed to all; decks, rng and seed stay hidden. The game-over `game`
message also carries `durationMs` (room clock: `GameRec.startedAt` at `start` → `endedAt` at game
over; absent for games started before UX2) for the stats screen.

**UI code reads only public info:** `handCount(state, p)`, `devCardCount(state, p)`,
`visibleSpecialBuildQueue(state)` work on full states (hotseat) and on views; the player list,
steal dialog and turn pill now use them. Everything else the HUD reads about other players
(name, colour, VP from buildings/awards, knights, road length) is public. `victoryPoints(view,
p)` gives public VP for masked players and the full count for the viewer. Rules for new UI code:
never read another player's `resources`/`devCards` directly; never call `legalActions` or
`applyAction` on a view (use the `legal` from the server).

**Expansion secrets (X1).** After the base masks, each active module's `maskFor` hook masks its
own (docs/EXPANSIONS.md §5 "Online views"): C&K progress hands, commodity split and progress
decks; Seafarers fog stacks and face-down gift cards; T&B fish hands / pool, Barbarian Attack
deck, commodity stacks, Swift Journeys (counted in `view.devCardCounts`); E&P face-down hexes,
disc stacks, lair tokens. Per-module proofs: `src/expansions/<id>/mask.test.ts` (canaries over
bot games, `src/expansions/maskTestkit.ts`).

Proofs: `src/engine/view.test.ts` (unit) and `src/bots/viewLeak.test.ts` (property test over 5
simulated games, 3–7 players, balanced dice: no secret fields, counts match, and the view does
not change when only secrets change — redistributed hands, reshuffled decks, new rng/seed).

## 7. Identity

- No accounts. A **member** = one browser in one room: public id `m<n>`, nickname, secret token.
- `localStorage['catan.mp.token.<roomId>'] = token` (M3; every access in try/catch). The client
  sends it in `hello`; unknown/null → a new member with a fresh token in `welcome`. Store the
  token from every `welcome` (it is the same for a known member).
- The token is the only credential. It is never included in `room` messages or sent to anyone
  else. Kicking deletes the member, so the token stops working.
- Nicknames: `cleanText` (control/bidi characters stripped, whitespace collapsed), max
  `LIMITS.name` (16) code points, unique per room (case-insensitive; "ann" → "ann 2").
  A name is required to take a seat or chat. Engine player names are fixed at start.

## 8. Disconnect policy

| Event                               | Lobby                   | Game                                                          |
| ----------------------------------- | ----------------------- | ------------------------------------------------------------- |
| socket closes                       | seat kept               | seat `away`; still their turn, clock running, nothing skipped |
| back within `graceMs` (60 s)        | nothing changes         | `away` → `human`, silently                                    |
| `graceMs` passes                    | seat freed              | seat `bot`; chat notice; the bot plays from the current state |
| back after that (same token)        | spectator, seat is gone | seat `human` again at once ("X is back and took over …")      |
| host away ≥ `graceMs`               | host passes on          | host passes on                                                |
| **nobody connected**                | —                       | **game pauses**: no bot moves, clock frozen; resumes on hello |
| nobody connected for `idleExpiryMs` | room expires            | room expires                                                  |

Pausing an empty room keeps bots from playing a whole game alone (and saves DO duration). With
the turn timer on, an away player can still time out during the grace period (minimum moves,
§9); with it off, the table waits at most `graceMs` for them.

## 9. Turn timer (server)

`settings.turnTimerSec` (lobby default 90 s; `null` = off; values from the setup screen's
`TIMER_STEPS`). The session reuses `src/game/turnTimer.ts` unchanged:
`timerSlot(state, controllers, legal, null)` → `syncClock` → `tickClock(now − clockAt)` →
`timeoutMove`. `away` seats count as human (they are on the clock); bots are never timed.
Chess clock (`settings.timer`, V1): the same slots, but `syncBankClock` puts the player on the
clock with their own bank (`GameRec.banks`, part of the snapshot) and `bankAfterAction` banks the
time used and credits the increment after each action (`begin()` has advanced the clock to `now`).
`TimerInfo.remainingMs` is then the bank and `totalMs` the starting bank. Map veto and event-card
choices need nothing special: `actingPlayers` / `obligated` cover them, so legal actions, bots and
the timer work unchanged. With Randomize Turn Order, `start` reorders the lobby seats by
`settings.seatOrder` so that seat index = PlayerId.
Differences from hotseat: there is no viewer (`null`), so when several humans owe a discard or
a trade reply they are timed one after another in table order; there is no "covered" pause; the
clock only freezes while nobody is connected. Clients get `timer: { player, kind, remainingMs,
totalMs }` in every `game` message and count down locally (≤ 1 s drift per message).

## 10. Bots (server)

`src/bots` random bot, `defaultBot` + `BOT_OFFERS_PER_TURN` (1 player-trade offer per turn) +
`nextBot` (bots owing a response first; a bot offerer waits for human replies) — exactly the
hotseat controller's policy. A bot whose offer was accepted confirms with a random accepter (it
only withdraws while nobody has accepted; BUG-B3). One move every `botDelayMs` (reactions ×0.4)
so people can follow.
Bots read the full state (the random bot ignores hands anyway); a smarter bot must be given
`viewFor(state, seat)` to play fair.

## 11. Chat and reactions

- `chat{text}`: cleaned like names, max `LIMITS.chat` (280) code points (frames up to 560 are
  accepted, then clipped); empty after cleaning = ignored. Broadcast as `ChatEntry` to everyone
  connected (players and spectators). Last `LIMITS.chatHistory` (100) entries are kept and sent
  in `welcome`. System entries (`from: null`): joined, game started, ran out of time, bot took
  over / is back, X won, host changed, removed, rematch.
- `react{reaction}`: one of `REACTIONS` (ids, the client draws them); broadcast, not stored.
- Rate limits (token buckets per member, `RATE_LIMITS`): chat burst 5 / 0.5 per s; react 6 / 1 per
  s; intent 20 / 10 per s; lobby ops 10 / 2 per s. Over the limit → `rate_limited`, message
  dropped. Frames over `LIMITS.messageChars` (8000) are rejected before `JSON.parse`. The client
  should render chat text as text (never `innerHTML`).

## 12. Security

- **Never trust the client.** Every frame: size check → JSON → version → `parseClientMessage`
  (types, ranges, id formats; unknown keys in bundles rejected; objects rebuilt from known
  fields) → role/phase/seat checks → `applyAction` on the full state (the engine validates every
  rule). `action.player` must equal the sender's seat (`not_your_seat`).
- **Hide all private info**: clients only ever receive `viewFor` output and their own legal
  actions. The full state, seed, RNG and other members' tokens never leave the session.
- Secrets in `deps` come from the platform CSPRNG; room ids are not secrets (the token is).
- Stale intents: send `seq`; a mismatch is rejected (`stale_state`) and the current state is
  re-sent, so a double click can never act on a state the player has not seen.
- Abuse: rate limits, member cap, chat/name length caps, host kick. M2 adds per-IP caps on
  connections and room creations, a per-socket frame limit and an origin check (§18.4).
- Known leaks by design (public in the physical game): hand sizes, dev card counts, discards,
  traded cards, monopoly/YoP takes. The steal log hides the card; only thief and victim can
  infer it from their own hands.

## 13. Protocol (`src/net/protocol.ts`)

Every frame is a JSON object `{ v: PROTOCOL_VERSION (1), type, … }`. Keep-alive is the raw text
frame `ping` → `pong` (not JSON; the Durable Object auto-responds without waking).

**Client → server**

| type        | fields                           | who / when          | errors                                                              |
| ----------- | -------------------------------- | ------------------- | ------------------------------------------------------------------- |
| `hello`     | `token: string \| null`, `name?` | first frame         | room_full, room_expired, version_mismatch                           |
| `setName`   | `name`                           | any member          | name_required                                                       |
| `takeSeat`  | `seat`                           | named member, lobby | wrong_phase, name_required, bad_seat, seat_taken                    |
| `leaveSeat` | —                                | seated, lobby       | wrong_phase, not_seated                                             |
| `setColor`  | `color` (one of `ROOM_COLORS`)   | seated, lobby       | wrong_phase, not_seated, color_taken                                |
| `configure` | `config: RoomConfig`             | host, lobby         | not_host, wrong_phase, bad_message                                  |
| `kick`      | `member`                         | host                | not_host, bad_message                                               |
| `start`     | —                                | host, lobby         | not_host, wrong_phase, not_seated, bad_config                       |
| `rematch`   | —                                | host, over          | not_host, wrong_phase                                               |
| `intent`    | `action: Action`, `seq?`         | seated, playing     | wrong_phase, not_seated, not_your_seat, stale_state, illegal_action |
| `chat`      | `text`                           | named member        | name_required, rate_limited                                         |
| `react`     | `reaction`                       | any member          | rate_limited                                                        |
| `sync`      | —                                | any member          | — (resends `room` + `game`)                                         |

Any frame before `hello` → `not_joined`. `RoomConfig` = `NewGameConfig` without `players`/`seed`
plus `seatCount` (`mode` (any registered mode, X1), `scenario?` (one of the mode's), `options?`
(the mode's modules' options: known keys, typed, in range; neither in base games), `map`,
`rules{balancedDice, hideBankCards}`, `turnTimerSec`, `vpToWin` 3–20, `discardLimit` 5–20; seat
count within the map's range (base) or the mode + scenario's (`playerRange`)), plus optional
`variants` (V1, RULES.md §18: `robberMode, eventCards, rushMode, turboMode, secondSettler,
randomTurnOrder, mapSelection, setupPlacement, timer`; V2, §19/§20: `rules56` (5+ seats, not with
second settler) and `mapRules`, strict keys, only `true` flags kept). `parseVariants` is strict (unknown keys
rejected, a named clock preset must carry its own values) and normalises defaults away (off flags,
`'normal'`, `'fixed'`). Combinations `createGame` would refuse are refused at `configure`
(`bad_message`): event cards + balanced dice, chess clock + `turnTimerSec`, second settler with
fewer than 4 seats. The V1 game actions (`vetoMap`, `eventGain`, `eventGive`, `eventSteal` with an
explicit `victim: null` to pass, `eventDamageRoad`, `repairRoad`) have strict parsers like the rest.
Finally `roomConfigError` runs `resolveSettings` on the config (placeholder players): anything
else createGame would refuse (a module's `validate`, e.g. C&K + Rush) is `bad_message` too, so
`start` cannot fail. Expansion actions (`<id>/<name>`, X1): the type must be a registered
module's action; the payload is rebuilt as plain JSON (identifier keys, `EXT_ACTION_LIMITS`), the
handler checks its meaning. **Intent guard:** an intent is refused (`illegal_action`) unless
`legalActions` offers that seat an action of that type right now; the payload is then
`applyAction`'s to judge (legal lists sample open-ended trade offers).

**Server → client**

| type       | fields                                                           | sent                                               |
| ---------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| `welcome`  | `you{member, token}`, `room: RoomInfo`, `chat: ChatEntry[]`      | reply to `hello`                                   |
| `room`     | `room: RoomInfo` (`id, phase, host, config, seats[], members[]`) | to everyone after any lobby/seat/member change     |
| `game`     | `seq`, `view: GameView`, `legal: Action[]`, `timer`              | to each member after every state change (own view) |
| `chat`     | `entry: ChatEntry{id, at, from, name, seat, text}`               | to everyone                                        |
| `reaction` | `member`, `seat`, `reaction`                                     | to everyone                                        |
| `error`    | `code: ErrorCode`, `message`, `ref?` (client message type)       | to the sender                                      |

The client validates server frames with `parseServerMessage` (JSON, version, known type; the
payload is trusted). A `room` with `phase: 'lobby'` after a game means the game is gone (rematch).

## 14. Error and close codes

| code               | meaning                                              | closes |
| ------------------ | ---------------------------------------------------- | ------ |
| `bad_message`      | not JSON, too long, wrong shape, unknown type/member |        |
| `version_mismatch` | client and server protocol differ: reload the page   | 4000   |
| `not_joined`       | a frame before `hello`                               |        |
| `rate_limited`     | too many messages of that kind; dropped              |        |
| `room_full`        | member cap reached                                   | 4001   |
| `not_host`         | host-only message                                    |        |
| `wrong_phase`      | not possible in this room phase                      |        |
| `name_required`    | set a nickname first                                 |        |
| `bad_seat`         | no such seat                                         |        |
| `seat_taken`       | seat belongs to someone else                         |        |
| `color_taken`      | another seat has that colour                         |        |
| `not_seated`       | needs a seat (or: nobody seated at start)            |        |
| `bad_config`       | `createGame` rejected the config                     |        |
| `not_your_seat`    | `action.player` is not your seat                     |        |
| `stale_state`      | `seq` is old; the current `game` follows             |        |
| `illegal_action`   | `applyAction` rejected it (message = engine error)   |        |
| `kicked`           | removed by the host                                  | 4002   |
| `replaced`         | the same member connected from another tab           | 4003   |
| `room_expired`     | the room is gone                                     | 4004   |

Clients should not auto-reconnect after 4000–4004.

## 15. Versioning

- `PROTOCOL_VERSION` (1) is in every frame. Bump it for any incompatible message change; the
  server answers other versions with `version_mismatch` and closes. Client and server ship from
  the same build (same Worker), so a mismatch means a stale tab: reload.
- Additive changes (new optional fields, new server message types the client ignores) keep the
  version. Validators ignore unknown top-level fields; bundles reject unknown keys.
- Engine state inside `view` carries `schemaVersion`. `SessionSnapshot.version` (1) is for DO
  storage; `GameSession.restore` throws on unknown versions — add a migration step there (and
  run `upgradeState` on `game.state`) when either changes.
- Expansion modes are on the wire (X1, additive: same protocol version): `mode`, `scenario`,
  `options` in `RoomConfig`, expansion actions in `intent`.

## 16. Notes for M3 (client)

- Render with the existing `BoardView` and `Hud`: `board.render(view)`,
  `hud.render(view, { viewer: view.view.viewer ?? 0, legal, isBotTurn, bots, turnTimer })`.
  `bots` = `room.seats.map(s => s.status === 'bot')`; turn timer from `timer` + local countdown.
- Spectators: `view.view.viewer === null`. The HUD has no spectator mode yet: passing a seat
  number shows that seat's (masked, empty) hand and no enabled buttons. A real spectator mode
  (no hand bar) is an M3 task.
- No hotseat cover online (one human per browser); `isCovered` stays false.
- Send `intent` with the `seq` of the `game` message the click was made on.
- Test against `LocalNet` + `GameSession` (`src/net/testHarness.ts`) — no server needed.

## 17. Known gaps / open questions

- Several humans owing discards/replies are timed one at a time (pure timer has one slot).
- No mid-game seat takeover by a newcomer (would need a rename outside `applyAction`).
- Bots see the full state (harmless for the random bot).
- Full view per message (≈ 17 KB late in a 4-player game, mostly the log); deltas or sending
  the board once could come later if needed.
- The thief/victim of a steal get no explicit "you stole X" notice; the UI can diff the hand.

## 18. Room server (M2: `src/server/`)

One Cloudflare Worker serves the static game (`dist/`, Workers Static Assets) and the API. One
Durable Object `Room` per room code (`ROOMS.idFromName(code)`) wraps a `GameSession`. Only
`/api/*` and `/ws/*` run Worker code (`run_worker_first`); everything else is free static traffic.

| File                        | What                                                                                |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `src/server/worker.ts`      | Worker entry + `Room` class: thin adapters to the runtime (only file with CF types) |
| `src/server/router.ts`      | HTTP routes, origin check, per-IP limits, code collision retry (platform-free)      |
| `src/server/room.ts`        | `RoomCore`: the Durable Object logic behind a `RoomPlatform` port; `roomFetch`      |
| `src/server/limits.ts`      | `SERVER_LIMITS`, `TokenBucket`, `RateLimiter`                                       |
| `src/server/origin.ts`      | `originAllowed`, `parseOrigins`                                                     |
| `src/server/testRuntime.ts` | `FakeRuntime`: in-memory storage/alarm/sockets, `hibernate()`, `evict()` (tests)    |
| `src/net/api.ts`            | paths, `CreateRoomResponse`, `RoomSummary`, room codes (shared with the client)     |
| `scripts/e2e-server.ts`     | end-to-end: real `wrangler dev`, 3 WebSocket clients, a bot-filled game to the end  |

### 18.1 HTTP API (`src/net/api.ts`)

| Request                                       | Response                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/rooms` (no body)                   | `201 { roomId, hostToken }`; `429` per-IP limit; `503` no free code (8 tries) |
| `GET /api/rooms/:code`                        | `200 RoomSummary { roomId, phase, seats, taken, connected }`; `404`           |
| `GET /api/rooms/:code/ws` (WebSocket upgrade) | `101`; `404` no room; `426` not an upgrade; `429` per-IP; `503` room full     |
| `GET /ws/:code`                               | alias of the above (the M1 diagram's path)                                    |

Every error body is `{ error: string }`; API responses are `no-store`. `403` = origin refused.
Codes are case-insensitive in URLs (`normalizeRoomCode`), canonical upper case everywhere else
(`room.id` in `RoomInfo`). Client side:

```ts
const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
const ws = new WebSocket(`${scheme}://${location.host}${roomSocketPath(code)}`);
```

### 18.2 Room codes

6 symbols from `23456789ABCDEFGHJKLMNPQRSTUVWXYZ` (32, no 0/O/1/I): 2^30 ≈ 10^9 codes, 5 random
bits per symbol from `crypto.getRandomValues`. Collision-safe: the Worker asks the code's
Durable Object to `create`; the object (single-threaded) answers `409` if it already holds a live
room, and the Worker retries with a fresh code (`SERVER_LIMITS.createAttempts` = 8). An expired
room deletes its storage, so its code is free again. Codes are not secrets (§12): a guessed code
only lets someone watch as a spectator; the per-IP lookup limit slows scanning.

### 18.3 Durable Object lifecycle (`RoomCore`)

- **Every event** (`fetch` upgrade, `webSocketMessage`, `webSocketClose/Error`, `alarm`): call the
  session → send the Outbound list in order (`ws.send` / `ws.close`) → `storage.put('session',
JSON)` if the snapshot changed (identical ones are skipped: free plan = 100k row writes/day) →
  `setAlarm(session.nextWakeAt())` / `deleteAlarm()` if it moved.
- **Hibernation API**: `ctx.acceptWebSocket`; the socket attachment holds `{ conn, ip, at,
joined }`; `ping` → `pong` via `setWebSocketAutoResponse` (no wake-up).
- **Restart** (hibernation wake-up or eviction): the constructor runs `RoomCore.load` inside
  `blockConcurrencyWhile`: `GameSession.restore(snapshot)`, then `reconcile(live sockets)` so
  members whose sockets are gone become away (and bots take over after `graceMs`).
- **Alarm** = `tick`: bot moves (one per `botDelayMs`), turn timeouts, grace periods, host
  succession, expiry. Expired (`isExpired`) → close sockets 4004, `deleteAlarm` + `deleteAll`.
- **Session error** (a bug throwing inside GameSession): the event is dropped, the in-memory
  session is rebuilt from the last saved snapshot, due work retries after 5 s. Logged.

### 18.4 Security (on top of §12)

- **Origin check** on every API request and upgrade: no `Origin` (not a browser) passes; else it
  must be the Worker's own host, an `ALLOWED_ORIGINS` entry (wrangler var, comma separated), or
  loopback when the server is on loopback (`wrangler dev` + Vite). Otherwise `403`.
- **Per IP** (`CF-Connecting-IP`): room creations 5 burst then 1/min, lookups and upgrades 30
  burst then 2/s (per Worker isolate: best effort; see HOSTING.md §6.3 for a global rule); at most
  12 sockets per room from one IP.
- **Per room**: at most `LIMITS.members + 8` (40) sockets; at capacity, the oldest socket that has
  not sent `hello` within 15 s is closed (1008) to make room.
- **Per socket**, before parsing: binary frames and frames over `LIMITS.messageChars` (8000) →
  `bad_message`; a frame bucket of all `RATE_LIMITS` together (41 burst, 13.5/s) → `rate_limited`,
  and 20 drops in a row close the socket (1008). The session then applies its per-member limits.
- **Secrets**: tokens are 32 symbols × 6 bits (192 bits), seeds 128 bits, both from the CSPRNG.
  Clients only get `viewFor` output (checked by `room.test.ts` and the e2e script). The
  `x-room-client-ip` header to the object is always overwritten by the Worker.

### 18.5 Running it

```
nice -n 19 pnpm dev:server      # vite build, then wrangler dev on http://localhost:8787
nice -n 19 pnpm e2e:server      # wrangler dev on a free port + 3 clients play a 3-VP game (a few s)
```

- `wrangler dev` serves the built client from `dist/`; rebuild (`pnpm build`) after client
  changes, or run Vite (`pnpm dev`, port 5173) with a proxy for `/api` (`ws: true`) to 8787 —
  loopback origins are allowed, so no extra config is needed.
- Dev overrides (`--var KEY:VALUE` or `.dev.vars`): `BOT_DELAY_MS` (bot speed), `GRACE_MS`.
- Local state lives in `.wrangler/` (gitignored). The e2e script uses a temp dir.
- Deploying: docs/HOSTING.md §6 (`pnpm deploy:cf`, by the user; plain `pnpm deploy` is a pnpm
  builtin).

### 18.6 Changes to the M1 contract (all backward compatible)

- Room ids are 6-char codes (§18.2) instead of 12 chars `[a-z0-9]`; `GameSession` is unchanged.
- WebSocket path `/api/rooms/:code/ws`; the M1 path `/ws/:code` still works.
- New: `src/net/api.ts` (HTTP shapes). No protocol message changed; `PROTOCOL_VERSION` stays 1.

### 18.7 Known gaps

- Per-IP HTTP limits live in Worker isolate memory (not global). A Cloudflare rate-limiting rule
  (HOSTING.md §6.3) is the real fence for a public deploy.
- One `put` per state change: a 4-player game with bots is roughly 1–2k writes, so the free plan
  fits ≈ 50–100 games a day. Batching writes (e.g. only on human moves + every N bot moves) is
  possible if that becomes the limit.
- Bot moves are driven by alarms (one wake-up per move, ≥ `botDelayMs` apart); fine for turn
  pacing, not for sub-100 ms timing.
- No `@cloudflare/vitest-pool-workers`: the Durable Object logic is tested through `RoomCore` with
  `FakeRuntime`, and the real runtime only by the e2e script (not part of `pnpm test`, it needs
  workerd and spawns a server).
