import { Application } from 'pixi.js';
import { createGame } from './engine';
import { FIXTURE_PLAYERS } from './engine/fixtures';
import { drawProofBoard } from './render';

const HEX_SIZE = 48;

async function boot() {
  const params = new URLSearchParams(location.search);
  const layout = params.get('layout') === 'beginner' ? 'beginner' : 'random';
  const seed = params.get('seed') ?? String(Date.now());
  const state = createGame({ seed, players: FIXTURE_PLAYERS, layout });

  const app = new Application();
  await app.init({ background: 0x0f2a44, resizeTo: window, antialias: true });
  document.getElementById('app')?.appendChild(app.canvas);

  const board = drawProofBoard(state, HEX_SIZE);
  const center = () => board.position.set(app.screen.width / 2, app.screen.height / 2);
  center();
  app.renderer.on('resize', center);
  app.stage.addChild(board);

  console.info(`Catan board: layout=${layout} seed=${seed}`);
}

void boot();
