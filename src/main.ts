import { Application } from 'pixi.js';
import { TOPOLOGY, createGame, type GameState } from './engine';
import * as fixtures from './engine/fixtures';
import { BoardView } from './render';
import { Hud, type Controller } from './ui';
import { DEFAULT_SPEED, GameController } from './game/controller';
import { installDebugHook } from './game/debug';
import { measureHudInsets } from './game/layout';
import { mountSpeedPicker, showResumePrompt, showToast } from './game/overlays';
import { parseParams, type DevParams } from './game/params';
import {
  SPEED_KEY,
  browserStorage,
  clearSession,
  loadNumber,
  loadSession,
  saveNumber,
} from './game/persist';

/**
 * Dev params: `?fixture=midGame` (any fixtures.ts function), `?seed=…&layout=beginner|random`
 * (start at once), `?autoplay=4bots&speed=0` (all-bot game), `?seats=hbbb`, `?vp=5`, `?speed=ms`,
 * `?hl=vertices|edges|hexes` (highlight preview), `?names=A,B,C`, `?debug=1` (playtest hook).
 * Without any, the new-game / resume screen opens.
 */
function devGame(params: DevParams): { state: GameState; seats: Controller[] } | null {
  const seatsFor = (n: number, fallback: Controller): Controller[] =>
    params.seats?.length === n ? params.seats : Array<Controller>(n).fill(fallback);

  if (params.fixture) {
    const make = (fixtures as unknown as Record<string, unknown>)[params.fixture];
    if (typeof make === 'function') {
      const state = (make as () => GameState)();
      return { state, seats: seatsFor(state.players.length, 'human') };
    }
    showToast(`Unknown fixture "${params.fixture}"`, 'error');
  }
  if (params.autoplay || params.seed !== null || params.layout) {
    const n = params.autoplay ?? params.seats?.length ?? 4;
    const seed = params.seed ?? String(Date.now() % 1e9);
    const layout = params.layout ?? 'random';
    console.info(`Catan dev game: layout=${layout} seed=${seed}`);
    const names = params.names?.length === n ? params.names : null;
    const state = createGame({
      seed,
      players: fixtures.FIXTURE_PLAYERS.slice(0, n).map((p, i) => ({
        ...p,
        name: names?.[i] ?? p.name,
      })),
      layout,
      ...(params.vpToWin === null ? {} : { vpToWin: params.vpToWin }),
    });
    return { state, seats: params.autoplay ? seatsFor(n, 'bot') : seatsFor(n, 'human') };
  }
  return null;
}

async function boot() {
  const params = parseParams(location.search);
  const dev = devGame(params);
  // Dev sessions never overwrite the real autosave.
  const storage = dev ? null : browserStorage();
  const prefs = browserStorage();

  const app = new Application();
  await app.init({
    background: 0x0f2a44,
    resizeTo: window,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    preference: 'webgl',
  });
  document.getElementById('app')?.appendChild(app.canvas);

  const board = new BoardView(app);
  const uiRoot = document.getElementById('ui') as HTMLElement;
  const hud = new Hud(uiRoot);

  const fitBoard = () => {
    const insets = measureHudInsets(uiRoot, window.innerWidth, window.innerHeight);
    if (insets) board.setInsets(insets);
  };
  let setSpeedVisible: (v: boolean) => void = () => undefined;

  const speed = params.speed ?? loadNumber(prefs, SPEED_KEY) ?? DEFAULT_SPEED;
  const controller = new GameController({
    board,
    hud,
    storage,
    speed,
    toast: showToast,
    onRender: () => {
      fitBoard();
      setSpeedVisible(controller.seats.includes('bot'));
    },
  });
  setSpeedVisible = mountSpeedPicker(speed, (ms) => {
    controller.setSpeed(ms);
    saveNumber(prefs, SPEED_KEY, ms);
  });
  window.addEventListener('resize', fitBoard);
  // The HUD re-renders on its own (cover dismissed, dialogs): re-measure after clicks too.
  uiRoot.addEventListener('click', () => requestAnimationFrame(fitBoard));
  // Debug handle for the console.
  (window as unknown as { catan: unknown }).catan = { controller, board, hud };
  if (params.debug) installDebugHook(controller, board);

  if (dev) {
    controller.start(dev.state, dev.seats);
    const hl = params.hl;
    const s = dev.state;
    if (hl === 'vertices') {
      board.setHighlights({ vertices: TOPOLOGY.vertices.filter((v) => !s.pieces.buildings[v]) });
    } else if (hl === 'edges') {
      board.setHighlights({ edges: TOPOLOGY.edges.filter((e) => !s.pieces.roads[e]) });
    } else if (hl === 'hexes') {
      board.setHighlights({ hexes: TOPOLOGY.landHexes.filter((h) => h !== s.robber) });
    }
    return;
  }

  const saved = loadSession(storage);
  if (saved && saved.state.phase.kind !== 'gameOver') {
    const s = saved.state;
    const names = s.players.map((p) => p.name).join(', ');
    const when = s.turn.number === 0 ? 'setup' : `turn ${s.turn.number}`;
    showResumePrompt(
      `Unfinished game (${names}) at ${when}.`,
      () => controller.resume(saved),
      () => {
        clearSession(storage);
        hud.showNewGame();
      },
    );
  } else {
    hud.showNewGame();
  }
}

void boot();
