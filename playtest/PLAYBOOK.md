# Playtest playbook (player agent)

You are **one seat** in a shared hotseat Catan game in a real browser. Other agents play the
other seats. Games have 3 to 8 players; with more players you wait longer between turns.
Your job: **find bugs** while playing to win. You only play through the CLI below.
**Never edit code, configs or other files.** Only `pnpm -s pt` commands.

The orchestrator has started the session (`nice -n 19 pnpm pt:serve [--seats 3..8]
[--map base|baseRandom|base56|base78] [--seed S] [--vp N] [--timer SEC] [--headed]`; `--headed`
opens a window a human can watch). A random seat starts (the log says "SeatN starts"). Your seat number is given to you (below: `K`). Every command is
`pnpm -s pt K <command>`. Each call prints text and exits.

## Online mode (each seat is its own browser, against the real room server)

If the orchestrator started the session with `pnpm pt:serve --online ...`, you are one human
seat of ONE online room; the other humans are other agents, empty seats are server bots. Same
CLI, same loop below. What is different:

- `wait` wakes on what the **server** says: your move, a discard you owe, a trade offer to answer
  (also `GAME OVER`, or `DISCONNECTED for good` if the room closed on you). There is no cover:
  ignore `pass`. On waking it prints the log **since your last command** (attacks, robberies).
- Acting commands wait for the server's answer (up to 15 s on a busy machine) and say what
  happened in their first line:
  - `OK: ... the server applied it (game seq 41 -> 42)`: done.
  - `OK: clicked [Bank]` + `screen-only change`: a local click (opened a dialog, picked a mode).
  - `REFUSED BY THE SERVER: ...`: the server said no (the message says why). Run `status`.
  - `SENT, NO ANSWER YET: ...`: the move went out but nothing came back yet. **Do not click
    again**: run `status` or `wait` first, it may still apply. Report it only if `status` still
    shows the old state after a minute.
- `REFUSED: [X] is covered by ...` means a player really could not click it: worth a `shot` and
  a report.
- `reload` puts you back in your seat. If `status` ever says "the page lost its `?debug=1` hook",
  run `reload`.
- Bots play at their own pace; "thinking…" in the prompt is a bot. Other humans can be slow.
- **Chat is allowed but optional**: `pnpm -s pt K chat "hello"`. `status` shows the last chat lines
  and the server's seat list (human / away / bot). Do not spend turns on chat.
- `drop` / `reconnect` / `reload` simulate a lost connection or a refreshed tab. Use them only if
  the orchestrator asked, or once mid-game to look at what happens (banner shown? same seat back?
  nothing lost? a bot played for you? the others saw you "away"?). Everything refused while offline is normal.
- Bugs go to `playtest/bugs/` with `report`, as before. Online-specific things are **worth
  reporting**:
  - **desync**: your `status` disagrees with another seat's (hand counts, VP, whose turn, log);
    or the board and the panel disagree after a click;
  - **stale view**: you still see an old phase or an open dialog the others have already moved past;
    a button that does nothing, or a toast like "Action rejected" / "not your turn" after a normal click;
  - **reconnect**: no banner after `drop`, not back in your own seat after `reconnect`/`reload`,
    missing log lines, someone stuck as "away" after returning, a bot still playing your seat;
  - **timer** (`--timer`): the countdown differs a lot between seats, hits 0 with no auto-move,
    or the auto-move is not what the rules say (minimum moves);
  - a game that stops: nobody can act for minutes while `status` shows everyone connected.
    Say which seat you are and what the other seats showed (ask them via chat if useful).

## The loop

```
1. pnpm -s pt K wait            # blocks until it is your move (may take minutes)
2. if it says "covered":  pnpm -s pt K pass
3. pnpm -s pt K status          # read YOU MUST, Hand, Prompt, Dialog, Buttons
4. if you must place something:  pnpm -s pt K spots
5. act: click / set / click-spot (one step at a time)
6. read the reply ("OK: ...", "New log:", "Now: ..."); repeat 3-5 until "Not your moment"
7. back to 1
```

- `wait` prints `YOUR MOVE: ...`, `GAME OVER: ...`, `STALLED: ...` or `TIMEOUT ...`.
  On TIMEOUT just run `wait` again. On GAME OVER, stop. On STALLED, report a blocker.
- `REFUSED: Not your moment` is normal: it is someone else's move. Go back to `wait`.
- Labels in `[...]` from `status` are what `click` accepts. Short unique words work
  (`click roll`), but if it says "matches several", type the full label.

## Commands

| Command                   | Use                                                               |
| ------------------------- | ----------------------------------------------------------------- |
| `wait [--timeout 600]`    | wait for your move                                                |
| `status`                  | everything you need to decide                                     |
| `spots`                   | numbered board spots (setup, build, robber, free roads)           |
| `click-spot N`            | click spot N from your **latest** `spots` list                    |
| `click <label>`           | click a button: `click Roll dice`, `click End turn`               |
| `set <label> <n>`         | stepper in discard/trade dialogs: `set wheat 2`, `set want ore 1` |
| `pass`                    | dismiss the "Pass to <you>" cover                                 |
| `shot [board\|hud\|full]` | screenshot; prints a path you can open and look at                |
| `console`                 | new browser console errors                                        |
| `click-board <id>`        | click any board id (`v:..`, `e:..`, `h:..`) to test odd clicks    |
| `report ...`              | file a bug (see below)                                            |
| `chat <text>`             | online only: say something in the room chat                       |
| `drop` / `reconnect`      | online only: cut / restore your network                           |
| `reload`                  | online only: reload your tab                                      |

## How to do things

- **Setup:** `spots` (best spots first, with pips and harbors) -> `click-spot N`. Then the
  road: `spots` -> `click-spot N`.
- **Turn:** `click Roll dice`. Then build/trade/play, then `click End turn`.
- **Build:** `click Road` (or `Settlement`, `City`) -> `spots` -> `click-spot N`.
  Costs: road = brick+lumber; settlement = brick+lumber+sheep+wheat; city = 2 wheat+3 ore;
  dev card (`click Buy card`) = sheep+wheat+ore.
- **Bank trade:** `click Bank` -> `click Give: <Resource>` -> `click Receive: <Resource>` ->
  `click Trade`. Ratios (4:1, 3:1, 2:1) are in `status`.
- **Player trade:** `click Trade` -> `set give sheep 1` -> `set want ore 1` -> optional
  `click to: SeatN` to drop a recipient -> `click Send offer`. Then `wait`: it wakes once every
  recipient has answered (or the offer ended); then `click SeatN: Trade` to confirm with someone
  who accepted, or `click Cancel offer`. If everyone rejects, the offer closes by itself
  ("Everyone rejected the offer" in the log).
- **Answering an offer:** `click Accept` or `click Reject`.
- **Special build step (5+ players):** after each turn, every other player in order may build
  or buy a dev card (no trading, no playing dev cards). Build as usual, then `click Pass`
  (the button that is normally End turn). Not the same as the `pass` command for the cover.
  `status` shows `Turn: "Special build: you then Seat3"` (who is still to go).
- **Turn timer (`--timer`):** `status` shows `Turn timer: 0:45 left`. At 0 the game makes the
  minimum moves for you (roll, end turn, random robber/discard, reject/cancel trades). The
  clock is paused while the "Pass to" cover is up.
- **Disabled build buttons** say why in `status`, e.g. `[Road 13/15 — Missing 1 brick]`.
- **Rolled 7, too many cards:** a "Discard N cards" dialog. `set <resource> <n>` until it
  says "Discarding N of N", then `click Discard`.
- **Robber:** `spots` -> `click-spot N` (pick a hex with an opponent, not yours). Then
  "Steal from whom?": `click SeatN` (no dialog when only one player can be robbed: the game
  robs them at once).
- **Dev cards:** in `Buttons` as `[Knight ×1]` etc. Cards bought this turn work next turn.
  `click Knight` -> robber as above. `click Road Building` -> `spots`/`click-spot` twice.
  `click Year of Plenty` -> click two resources. `click Monopoly` -> click one resource.

## Expansions (`--mode ck | seafarers | tb | ep | ...`)

Everything still goes through `status`, `spots`, `click` and `click-spot`. What helps:

- `status` adds the expansion's own panel as `Panel "<name>":` lines (gold, commodities,
  knights, wagons, ships, missions) and `Also in hand:` for non-resource cards (commodities,
  gold, progress cards). `Dev cards:` notes expansion cards (Swift Journey) it cannot itemise.
- `YOU MUST` quotes the screen's prompt in expansion steps ("Movement: click one of your ships
  ...") and lists the expansion moves that are legal (`ep/moveShip`, `ck/activateKnight`).
- `spots` names each spot's move when the list mixes them: `[setup road]` vs
  `[place setup ship]`. `click-spot N` clicks the build card the move needs first (like a player
  would) and says so: `clicked [Ship 15/15], then spot 4`.
- When there is nothing on the board yet, `spots` lists **board moves behind a button**, e.g.
  `[Command]: select knight (1)`: `click Command`, then `spots` again.
- Two buttons with the same text are named by their row: `[Ship 1 settler 4 MP: Select]`,
  `[Ship 2 empty 4 MP: Select]` (`click Ship 2` is enough).
- `set <name> <n>` also works on expansion count pickers (C&K / T&B "less / more" buttons).

### Cities & Knights (`ck`)

- **Setup:** round 2 places a **city** (`YOU MUST: Place your setup city`), not a settlement.
- **Knight:** `click Knight` -> `spots` -> `click-spot N` (sheep + ore).
- **Activate / promote / move / displace / chase the robber:** `click Command` -> `spots`
  (your knights) -> `click-spot N` opens the knight dialog: `click Activate` (wheat),
  `click Promote`, `click Chase the robber`, or `spots` -> `click-spot N` to move there / onto a
  weaker knight. `click Done` closes it. A knight activated this turn cannot move yet, and every
  barbarian attack deactivates all knights.
- **City wall:** `click City wall` -> `spots` -> `click-spot N`.
- **Improvements / progress cards / commodity trades:** buttons in the `Panel "Cities & Knights"`
  section of `status` (e.g. `[Cities & Knights: Trade]` for the trade track). Progress card
  prompts (give a commodity, pick a player) show as `YOU MUST: Expansion step (ck/card): "..."`:
  click the named button.
- **Discard on a 7:** commodities count; `set cloth 1`, `set sheep 2`, ... then `click Discard`.

### Seafarers (`seafarers`, e.g. `--scenario fogIslands`)

- **Setup on a coast:** `spots` lists both `[setup road]` and `[place setup ship]` for coast
  edges; pick the number of the piece you want.
- **Build a ship:** `click Ship` -> `spots` -> `click-spot N`. **Move a ship:** `click Move ship`
  -> `spots` (your movable ships) -> `click-spot N` -> `spots` (where to) -> `click-spot N`.
- Fog / gold hexes: the log and `Panel "..."` say what was revealed and what you may choose.

### Traders & Barbarians (`tb`, scenarios such as `traders`)

- **Wagon (Traders & Merchants):** `click Wagon` -> `spots` -> `click-spot N` per step; the
  panel shows your gold, the commodity you carry and your baggage-train level.
- **Swift Journey** (a development card) can only be played **after** your wagon moved this turn:
  it then shows as a `[Swift Journey]` button.
- Discards and gold trades use `set <resource> <n>` and the dialog's buttons.

### Explorers & Pirates (`ep`, e.g. `--scenario pirateLairs`)

- **Setup:** settlement, then `ep/setupRoad`, then `ep/setupShip` (with a settler): `spots` /
  `click-spot N` each time.
- **Gold:** `Also in hand: Gold: N`. Buy with gold: `[Buy for 2 gold (2 left): Lumber]`
  (`click Buy for 2 gold (2 left): Lumber`, or a unique part of it).
- **A turn:** roll, then build/trade (Action phase), then `click Start Movement phase` (no more
  building or trading). In Movement: with several ships, `click Ship N` (its Select button) or
  `spots` -> `click-spot N` on a ship; then `spots` lists where it can sail (`[move ship]`) ->
  `click-spot N`. Load / Unload / Crew buttons appear on the ship's row. `click End turn` when done.
- **7:** place your pirate ship: `spots` -> `click-spot N`.

## Strategy (short)

Settle on high pips with varied resources. Wheat + ore -> cities and dev cards; brick +
lumber -> roads and settlements. Use harbors you own. Rob the leader. But **finding bugs comes
first**: try odd but legal things (trade with a harbor, build on a coast, play a card before
rolling, cancel dialogs, Esc out of build mode via `click Cancel`).

## What is a bug

Compare what you see with `docs/RULES.md` (the rules this game follows). Report when:

- the UI allows something the rules forbid, or blocks something they allow;
- numbers are wrong (cards, VP, ratios, production after a roll, discard count);
- you are stuck: no button works, a dialog will not close, `STALLED`, a click does nothing;
- `status` prints `POSSIBLE BUG (UI vs engine)` or a spot is "hidden under a HUD element";
- a toast says "Action rejected" after a normal click;
- `console` shows errors;
- something looks wrong in a `shot` (overlaps, cut-off text, wrong colours, pieces misplaced);
- the UX is confusing (you could not tell what to do from the screen).

Not bugs: being refused while it is not your move; a house rule documented in RULES.md
(e.g. max 3 trade offers per turn).

## How to report

One report per distinct bug, as soon as you see it. Before reporting, check it again once.

```
pnpm -s pt K report --title "Discard dialog accepts 3 of 4 cards" --severity major \
  --expected "Discard button disabled until 4 cards chosen (RULES 5.2)" \
  --actual "Button enabled at 3; clicking it showed toast 'Action rejected'" \
  --steps "1. Seat2 rolled 7 with 9 cards 2. set wheat 3 3. click Discard"
```

Severity: `blocker` (game cannot continue), `major` (wrong rules/numbers, lost turn),
`minor` (small wrong thing, has a workaround), `visual` (looks wrong only). The report saves a
screenshot, the game state and the log for you. Give exact commands in `--steps`.
After reporting, keep playing.

## Fair play

`status` shows only your own hand. Do not use screenshots taken during other seats' moves to
learn their cards. Do not run acting commands for other seats.
