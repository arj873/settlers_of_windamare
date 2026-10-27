/**
 * Playtest CLI for player agents: `pnpm -s pt <seat 1..N> <command> [args]` (N = 3..8).
 * Talks to the running `pnpm pt:serve` session; prints plain text and exits.
 */
import { request } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import {
  SESSION_FILE,
  type CommandRequest,
  type CommandResponse,
  type SessionInfo,
} from './protocol';
import { parseFlags, parseSeat } from './text';

const HELP = `Playtest CLI. Usage: pnpm -s pt <your seat number> <command> [args]

Look (always allowed):
  wait [--timeout 600]   block until it is your move (or the game ends); says why it woke
  status                 your hand, VP, other players, prompt, dialog, buttons, last log lines
  spots                  numbered board spots you can click now (setup, build, robber, free roads)
  shot [board|hud|full]  save a screenshot, prints the path
  console                new page console errors/warnings
  report --title "..." --severity blocker|major|minor|visual --expected "..." --actual "..." --steps "..."

Act (only when it is your move; others are refused):
  pass                   dismiss the "Pass to <you>" hotseat cover (hotseat only)
  click <button text>    click a HUD/dialog button by its text, e.g. click Roll dice
  click-tile <text>      same as click (resource tiles, dev cards, players)
  set <label> <n>        set a stepper (discard / trade), e.g. set brick 2, set give sheep 1
  choose <label> = <opt> pick a dropdown option, e.g. choose Bank: give = Wheat
  click-spot <n>         click spot n from the last \`spots\` list
  click-board <id>       click a board id (v:.., e:.., h:..)

Online games only (each seat is its own browser; no pass-the-device cover):
  chat <message>         say something in the room chat (optional)
  drop                   cut your network, like dropped Wi-Fi (the others see you away)
  reconnect              restore the network and wait until you are back in your seat
  reload                 reload your tab (your stored token should put you back in your seat)

Session: pnpm -s pt stop   (stops the server)`;

function session(): SessionInfo | null {
  if (!existsSync(SESSION_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8')) as SessionInfo;
  } catch {
    return null;
  }
}

function send(port: number, body: CommandRequest): Promise<CommandResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/cmd',
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as CommandResponse);
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)));
          }
        });
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help') {
    console.log(HELP);
    return 0;
  }
  const info = session();
  if (!info) {
    console.log('No playtest session is running. Start one with: pnpm pt:serve');
    return 1;
  }
  if (argv[0] === 'stop') {
    console.log((await send(info.port, { seat: -1, cmd: 'stop', args: [], flags: {} })).out);
    return 0;
  }

  const seats = info.seats ?? 3;
  const seat = parseSeat(argv[0], seats);
  if (seat === null) {
    console.log(
      `First argument must be your seat number, 1 to ${seats} (got "${argv[0] ?? ''}").\n\n${HELP}`,
    );
    return 1;
  }
  const cmd = (argv[1] ?? 'help').toLowerCase();
  if (cmd === 'help') {
    console.log(HELP);
    return 0;
  }
  const { positional, flags } = parseFlags(argv.slice(2));
  const name = cmd === 'click-tile' ? 'click' : cmd;

  if (name === 'wait') {
    const timeout = Number(flags.timeout || 600);
    const until = Date.now() + (Number.isFinite(timeout) ? timeout : 600) * 1000;
    for (;;) {
      const res = await send(info.port, { seat, cmd: 'probe', args: [], flags: {} });
      if (res.ready) {
        console.log(res.out);
        return 0;
      }
      if (Date.now() >= until) {
        console.log(`TIMEOUT after ${timeout}s, still waiting (${res.out}). Run \`wait\` again.`);
        return 0;
      }
      await sleep(1000);
    }
  }

  const res = await send(info.port, { seat, cmd: name, args: positional, flags });
  console.log(res.out);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(
      /ECONNREFUSED/.test(msg)
        ? 'The playtest server is not answering. Is `pnpm pt:serve` still running?'
        : `HARNESS ERROR: ${msg}`,
    );
    process.exit(1);
  },
);
