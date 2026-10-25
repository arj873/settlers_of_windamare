import { Application } from 'pixi.js';
import { TOPOLOGY, createGame, type GameState } from './engine';
import * as fixtures from './engine/fixtures';
import { BoardView } from './render';

/** Dev-only: `?fixture=midGame` (any fixtures.ts function), `?hl=vertices|edges|hexes` to preview highlights. */
function initialState(params: URLSearchParams): GameState {
  const name = params.get('fixture');
  if (name) {
    const make = (fixtures as unknown as Record<string, unknown>)[name];
    if (typeof make === 'function') return (make as () => GameState)();
    console.warn(`unknown fixture "${name}"`);
  }
  const layout = params.get('layout') === 'beginner' ? 'beginner' : 'random';
  const seed = params.get('seed') ?? String(Date.now());
  console.info(`Catan board: layout=${layout} seed=${seed}`);
  return createGame({ seed, players: fixtures.FIXTURE_PLAYERS, layout });
}

async function boot() {
  const params = new URLSearchParams(location.search);
  const state = initialState(params);

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
  board.render(state);

  const hl = params.get('hl');
  if (hl === 'vertices') {
    board.setHighlights({ vertices: TOPOLOGY.vertices.filter((v) => !state.pieces.buildings[v]) });
  } else if (hl === 'edges') {
    board.setHighlights({ edges: TOPOLOGY.edges.filter((e) => !state.pieces.roads[e]) });
  } else if (hl === 'hexes') {
    board.setHighlights({ hexes: TOPOLOGY.landHexes.filter((h) => h !== state.robber) });
  }

  board.on('vertexClick', (id) => console.info('vertexClick', id));
  board.on('edgeClick', (id) => console.info('edgeClick', id));
  board.on('hexClick', (id) => {
    console.info('hexClick', id);
    if (hl === 'hexes') board.render({ ...state, robber: id });
  });
}

void boot();
