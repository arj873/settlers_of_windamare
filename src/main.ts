import { Application } from 'pixi.js';
import {
  PLAYER_COLORS,
  createGame,
  defaultMapFor,
  layoutToMap,
  topologyOf,
  type GameState,
} from './engine';
import * as fixtures from './engine/fixtures';
import { BoardView } from './render';
import { setFrameColors } from './render';
import { boardFrameColors, Hud, initTheme, onThemeChange, type Controller } from './ui';
import { NAME_KEY, parseRoomCode, tokenKey } from './net/transport';
import { HomeScreen } from './ui/online/home';
import { inviteUrl } from './ui/online/lobbyModel';
import { OnlineApp } from './game/online/app';
import { browserKeyStore, pickBackend, realClock, tokenStoreFor } from './game/online/backend';
import { DEFAULT_SPEED, GameController } from './game/controller';
import { isHeadless, sfx } from './audio';
import { GameSounds } from './game/sounds';
import { extensionSoundRecipes, extensionSounds } from './ui/expansions';
import { sfxPanel } from './ui/sfxPanel';
import { installDebugHook } from './game/debug';
import { createFitButton, measureHudInsets } from './game/layout';
import { showNotice } from './game/noticeView';
import { SPEED_PRESETS, showResumePrompt, showToast } from './game/overlays';
import { parseParams, type DevParams } from './game/params';
import { SpotPrompt } from './ui/spotPrompt';
import {
  CONFIRM_BUILD_KEY,
  SPEED_KEY,
  browserStorage,
  clearSession,
  loadNumber,
  loadSession,
  saveNumber,
  type KeyValueStore,
} from './game/persist';

/**
 * Dev params: `?fixture=midGame` (any fixtures.ts function), `?seed=…&layout=beginner|random`
 * or `?map=base|baseRandom|base56|base78` (start at once), `?autoplay=4bots&speed=0` (all-bot
 * game, 3..8 bots), `?seats=hbbb`, `?vp=5`, `?timer=20` (turn timer, s), `?first=0` (starting
 * seat), `?speed=ms`, `?hl=vertices|edges|hexes` (highlight preview), `?names=A,B,C`, `?debug=1`
 * (playtest hook), `?mode=demo` (an expansion mode, docs/EXPANSIONS.md), `?modes=all` (setup
 * screen also offers wip / demo modes). Without any, the new-game / resume screen opens.
 */
function devGame(params: DevParams): { state: GameState; seats: Controller[] } | null {
  const seatsFor = (n: number, fallback: Controller): Controller[] =>
    params.seats?.length === n ? params.seats : Array<Controller>(n).fill(fallback);

  if (params.fixture) {
    const make = (fixtures as unknown as Record<string, unknown>)[params.fixture];
    if (typeof make === 'function') {
      let state = (make as () => GameState)();
      if (params.timer !== null) {
        state = { ...state, settings: { ...state.settings, turnTimerSec: params.timer } };
      }
      return { state, seats: seatsFor(state.players.length, 'human') };
    }
    showToast(`Unknown fixture "${params.fixture}"`, 'error');
  }
  if (params.autoplay || params.seed !== null || params.layout || params.map || params.mode) {
    const n = params.autoplay ?? params.seats?.length ?? 4;
    const seed = params.seed ?? String(Date.now() % 1e9);
    const map = params.map ?? (params.layout ? layoutToMap(params.layout) : defaultMapFor(n));
    console.info(`Windamere dev game: mode=${params.mode ?? 'base'} map=${map} seed=${seed}`);
    const names = params.names?.length === n ? params.names : null;
    let state: GameState;
    try {
      state = createGame({
        seed,
        players: PLAYER_COLORS.slice(0, n).map((p, i) => ({ ...p, name: names?.[i] ?? p.name })),
        // An expansion mode takes its map from its scenario unless ?map= names one of its maps.
        ...(params.mode ? { mode: params.mode, ...(params.map ? { map } : {}) } : { map }),
        ...(params.mode && params.scenario ? { scenario: params.scenario } : {}),
        ...(params.vpToWin === null ? {} : { vpToWin: params.vpToWin }),
        ...(params.timer === null ? {} : { turnTimerSec: params.timer }),
        ...(params.first === null || params.first >= n ? {} : { startingPlayer: params.first }),
      });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e), 'error');
      return null;
    }
    return { state, seats: params.autoplay ? seatsFor(n, 'bot') : seatsFor(n, 'human') };
  }
  return null;
}

async function boot() {
  // HUD look, page background, board frame (src/ui/theme): `?theme=` > saved pick > Sunfired.
  initTheme(location.search);
  const params = parseParams(location.search);
  const dev = devGame(params);
  // Dev sessions never overwrite the real autosave.
  const storage = dev ? null : browserStorage();
  const prefs = browserStorage();

  // Sound effects (A1): synthesized; the AudioContext starts on the first gesture. Silent in
  // the playtest harness / automation (`?debug=1`, navigator.webdriver, `?mute=1`).
  sfx.register(extensionSoundRecipes());
  sfx.suppress(isHeadless(location.search, navigator));
  sfx.installUnlock(window);
  const sounds = new GameSounds({ play: (id, g) => sfx.play(id, g), extensions: extensionSounds });
  if (new URLSearchParams(location.search).get('sfx') === '1') document.body.append(sfxPanel());

  const app = new Application();
  await app.init({
    // Transparent: the page background (a theme token) shows around the board.
    backgroundAlpha: 0,
    resizeTo: window,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
    preference: 'webgl',
  });
  document.getElementById('app')?.appendChild(app.canvas);

  const board = new BoardView(app);
  const frameToTheme = () => {
    const frame = boardFrameColors();
    if (!frame) return;
    setFrameColors(frame);
    board.retheme();
  };
  frameToTheme();
  onThemeChange(frameToTheme);
  const uiRoot = document.getElementById('ui') as HTMLElement;
  const hud = new Hud(uiRoot);
  // A click on a board spot asks before building (issue #28), unless switched off in the menu.
  const prompt = new SpotPrompt(uiRoot);
  let confirmOn = loadNumber(prefs, CONFIRM_BUILD_KEY) !== 0;
  hud.setBuildConfirm({
    value: confirmOn,
    onChange: (on) => {
      confirmOn = on;
      saveNumber(prefs, CONFIRM_BUILD_KEY, on ? 1 : 0);
    },
  });
  const spots = { prompt, confirmBuild: () => confirmOn };

  const fitBoard = () => {
    const layout = measureHudInsets(uiRoot, window.innerWidth, window.innerHeight);
    if (layout) board.setInsets(layout.insets, layout.avoid);
  };
  uiRoot.after(createFitButton(() => board.fit()));
  window.addEventListener('resize', fitBoard);
  // The HUD re-renders on its own (cover dismissed, dialogs): re-measure after clicks too.
  uiRoot.addEventListener('click', () => requestAnimationFrame(fitBoard));

  // Online play (M3): `?room=CODE` joins a room; otherwise the home screen picks a mode.
  const online = (roomId: string, then: (app: OnlineApp) => void = (app) => void app.run()) => {
    void pickBackend(location.search).then((backend) => {
      // `params` was read at boot: creating a room rewrites the URL and may drop `?debug=1`.
      const room = new OnlineApp(
        {
          board,
          hud,
          backend,
          store: browserKeyStore,
          tokens: tokenStoreFor(backend.kind),
          clock: realClock,
          toast: showToast,
          notice: showNotice,
          onRender: fitBoard,
          sounds,
          layer: document.body,
          href: location.href,
          goHome: () => location.assign(homeUrl()),
          playOffline: () => {
            history.replaceState(null, '', homeUrl());
            offline(null);
          },
          ...spots,
        },
        roomId,
      );
      (window as unknown as { catan: unknown }).catan = { online: room, board, hud };
      if (params.debug) installDebugHook(room.debugController, board);
      then(room);
    });
  };
  const roomId = dev ? null : parseRoomCode(new URLSearchParams(location.search).get('room') ?? '');
  if (roomId) {
    online(roomId);
    return;
  }

  // Hotseat: everything below is the offline game, unchanged.
  const offline = (dev: { state: GameState; seats: Controller[] } | null) =>
    startOffline({ board, hud, params, dev, storage, prefs, fitBoard, spots, sounds });
  if (dev) {
    offline(dev);
    return;
  }
  const home = new HomeScreen({
    name: browserKeyStore.get(NAME_KEY) ?? '',
    onOffline: () => {
      home.element.remove();
      offline(null);
    },
    onCreate: async (name) => {
      const backend = await pickBackend(location.search);
      const room = await backend.api.create();
      tokenStoreFor(backend.kind).set(tokenKey(room.roomId), room.hostToken);
      browserKeyStore.set(NAME_KEY, name);
      history.pushState(null, '', inviteUrl(location.href, room.roomId));
      online(room.roomId, (a) => {
        home.element.remove();
        a.connect(name);
      });
    },
    onJoin: async (code, name) => {
      const backend = await pickBackend(location.search);
      if (!(await backend.api.check(code))) throw new Error(`There is no room “${code}”.`);
      browserKeyStore.set(NAME_KEY, name);
      history.pushState(null, '', inviteUrl(location.href, code));
      online(code, (a) => {
        home.element.remove();
        a.connect(name);
      });
    },
  });
  document.body.append(home.element);
}

/** This page without query parameters (except an explicit `?server=`, kept for dev). */
function homeUrl(): string {
  const u = new URL(location.href);
  const server = u.searchParams.get('server');
  u.search = '';
  u.hash = '';
  if (server) u.searchParams.set('server', server);
  return u.toString();
}

/** The hotseat game: controller, bot speed, debug hook, dev params, resume prompt. */
function startOffline(o: {
  board: BoardView;
  hud: Hud;
  params: DevParams;
  dev: { state: GameState; seats: Controller[] } | null;
  storage: KeyValueStore | null;
  prefs: KeyValueStore | null;
  fitBoard: () => void;
  spots: { prompt: SpotPrompt; confirmBuild: () => boolean };
  sounds: GameSounds;
}): void {
  const { board, hud, params, dev, storage, prefs, fitBoard, spots, sounds } = o;
  const speed = params.speed ?? loadNumber(prefs, SPEED_KEY) ?? DEFAULT_SPEED;
  const controller = new GameController({
    board,
    hud,
    storage,
    speed,
    toast: showToast,
    notice: showNotice,
    onRender: fitBoard,
    ...spots,
    sounds,
  });
  // Bot speed lives in the HUD menu (shown while any seat is a bot).
  hud.setBotSpeed({
    value: speed,
    presets: SPEED_PRESETS.some((p) => p.ms === speed)
      ? SPEED_PRESETS
      : [...SPEED_PRESETS, { label: `${speed} ms`, ms: speed }],
    onChange: (ms) => {
      controller.setSpeed(ms);
      saveNumber(prefs, SPEED_KEY, ms);
    },
  });
  // Debug handle for the console.
  (window as unknown as { catan: unknown }).catan = { controller, board, hud };
  if (params.debug) installDebugHook(controller, board);

  if (dev) {
    const levels = params.levels?.length === dev.seats.length ? params.levels : undefined;
    controller.start(dev.state, dev.seats, levels ? { botLevels: levels } : {});
    const hl = params.hl;
    const s = dev.state;
    const topo = topologyOf(s);
    if (hl === 'vertices') {
      board.setHighlights({ vertices: topo.vertices.filter((v) => !s.pieces.buildings[v]) });
    } else if (hl === 'edges') {
      board.setHighlights({ edges: topo.edges.filter((e) => !s.pieces.roads[e]) });
    } else if (hl === 'hexes') {
      board.setHighlights({ hexes: topo.landHexes.filter((h) => h !== s.robber) });
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
