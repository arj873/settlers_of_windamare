# Playtest playbook (player agent)

You are **one seat** in a shared hotseat Catan game in a real browser. Other agents play the
other seats. Games have 3 to 8 players; with more players you wait longer between turns.
Your job: **find bugs** while playing to win. You only play through the CLI below.
**Never edit code, configs or other files.** Only `pnpm -s pt` commands.

The orchestrator has started the session (`nice -n 19 pnpm pt:serve [--seats 3..8]
[--map base|baseRandom|base56|base78] [--seed S] [--vp N] [--headed]`; `--headed` opens a window
a human can watch). Your seat number is given to you (below: `K`). Every command is
`pnpm -s pt K <command>`. Each call prints text and exits.

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
| `set <label> <n>`         | stepper in discard/trade dialogs: `set grain 2`, `set want ore 1` |
| `pass`                    | dismiss the "Pass to <you>" cover                                 |
| `shot [board\|hud\|full]` | screenshot; prints a path you can open and look at                |
| `console`                 | new browser console errors                                        |
| `click-board <id>`        | click any board id (`v:..`, `e:..`, `h:..`) to test odd clicks    |
| `report ...`              | file a bug (see below)                                            |

## How to do things

- **Setup:** `spots` (best spots first, with pips and harbors) -> `click-spot N`. Then the
  road: `spots` -> `click-spot N`.
- **Turn:** `click Roll dice`. Then build/trade/play, then `click End turn`.
- **Build:** `click Road` (or `Settlement`, `City`) -> `spots` -> `click-spot N`.
  Costs: road = brick+lumber; settlement = brick+lumber+wool+grain; city = 2 grain+3 ore;
  dev card (`click Buy card`) = wool+grain+ore.
- **Bank trade:** `click Bank` -> `click Give: <Resource>` -> `click Receive: <Resource>` ->
  `click Trade`. Ratios (4:1, 3:1, 2:1) are in `status`.
- **Player trade:** `click Trade` -> `set give wool 1` -> `set want ore 1` -> optional
  `click to: SeatN` to drop a recipient -> `click Send offer`. Then `wait`; when you wake,
  `click SeatN: Trade` to confirm with someone who accepted, or `click Cancel offer`.
- **Answering an offer:** `click Accept` or `click Reject`.
- **Rolled 7, too many cards:** a "Discard N cards" dialog. `set <resource> <n>` until it
  says "Discarding N of N", then `click Discard`.
- **Robber:** `spots` -> `click-spot N` (pick a hex with an opponent, not yours). Then
  "Steal from whom?": `click SeatN`.
- **Dev cards:** in `Buttons` as `[Knight ×1]` etc. Cards bought this turn work next turn.
  `click Knight` -> robber as above. `click Road Building` -> `spots`/`click-spot` twice.
  `click Year of Plenty` -> click two resources. `click Monopoly` -> click one resource.

## Strategy (short)

Settle on high pips with varied resources. Grain + ore -> cities and dev cards; brick +
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
  --steps "1. Seat2 rolled 7 with 9 cards 2. set grain 3 3. click Discard"
```

Severity: `blocker` (game cannot continue), `major` (wrong rules/numbers, lost turn),
`minor` (small wrong thing, has a workaround), `visual` (looks wrong only). The report saves a
screenshot, the game state and the log for you. Give exact commands in `--steps`.
After reporting, keep playing.

## Fair play

`status` shows only your own hand. Do not use screenshots taken during other seats' moves to
learn their cards. Do not run acting commands for other seats.
