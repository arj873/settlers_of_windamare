/** Dev page entry (ui-dev.html): the HUD over a placeholder background, one fixture at a time. */
import {
  discardGame,
  freshGame,
  gameOverGame,
  midGame,
  moveRobberGame,
  setupInProgressGame,
  tradeOfferGame,
} from '../engine/fixtures';
import type { GameState } from '../engine';
import { fakeLegal } from './devLegal';
import { Hud, type PlaceMode } from './index';

const FIXTURES: Record<string, () => GameState> = {
  'fresh (setup)': () => freshGame(4),
  'fresh, 3 players': () => freshGame(3),
  'setup in progress': () => {
    const s = setupInProgressGame();
    s.phase = { kind: 'setup', index: 5, step: 'road', lastSettlement: null };
    return s;
  },
  'pre-roll': () => {
    const s = midGame();
    s.phase = { kind: 'preRoll' };
    s.dice = null;
    return s;
  },
  'mid game (main)': midGame,
  discard: discardGame,
  'move robber': moveRobberGame,
  steal: () => {
    const s = moveRobberGame();
    s.phase = { kind: 'steal', candidates: [0, 3], resume: 'main' };
    return s;
  },
  'road building': () => {
    const s = midGame();
    s.phase = { kind: 'roadBuilding', remaining: 2, resume: 'main' };
    return s;
  },
  'trade offer': tradeOfferGame,
  '8 players, hidden bank': () => {
    const s = midGame();
    const extra = [
      ['Green', '#2e9e5b'],
      ['Purple', '#8e5bc8'],
      ['Teal', '#1fa3a3'],
      ['Brown', '#8a5a2b'],
    ] as const;
    extra.forEach(([name, color], i) => {
      const base = s.players[i];
      if (base) s.players.push({ ...base, id: s.players.length, name, color });
    });
    return { ...s, settings: { ...s.settings, hideBankCards: true } };
  },
  'game over': gameOverGame,
};

const bg = document.getElementById('bg');
const root = document.getElementById('hud-root');
const pickFixture = document.getElementById('fixture') as HTMLSelectElement | null;
const pickViewer = document.getElementById('viewer') as HTMLSelectElement | null;
const bot = document.getElementById('bot') as HTMLInputElement | null;
const newGameBtn = document.getElementById('new-game');
if (!bg || !root || !pickFixture || !pickViewer || !bot || !newGameBtn) {
  throw new Error('ui-dev.html is missing elements');
}

for (const name of Object.keys(FIXTURES)) pickFixture.append(new Option(name, name));

const hud = new Hud(root);
hud.on('action', (a) => console.info('[hud] action', JSON.stringify(a)));
hud.on('newGame', (cfg) => console.info('[hud] newGame', JSON.stringify(cfg)));
hud.on('placeMode', (m: PlaceMode | null) => console.info('[hud] placeMode', m));
newGameBtn.addEventListener('click', () => hud.showNewGame());

let state: GameState = midGame();

function rebuildViewers(): void {
  if (!pickViewer) return;
  const prev = pickViewer.value;
  pickViewer.replaceChildren();
  for (const p of state.players) pickViewer.append(new Option(p.name, String(p.id)));
  pickViewer.value =
    prev && Number(prev) < state.players.length ? prev : String(state.turn.current);
}

function draw(): void {
  if (!pickViewer || !bot) return;
  const viewer = Number(pickViewer.value);
  hud.render(state, { viewer, legal: fakeLegal(state, viewer), isBotTurn: bot.checked });
}

function load(): void {
  if (!pickFixture || !pickViewer) return;
  state = (FIXTURES[pickFixture.value] ?? midGame)();
  rebuildViewers();
  pickViewer.value = String(state.turn.current);
  const hash = `#${encodeURIComponent(pickFixture.value)}`;
  history.replaceState(null, '', hash);
  draw();
}

pickFixture.addEventListener('change', load);
pickViewer.addEventListener('change', draw);
bot.addEventListener('change', draw);

const wanted = decodeURIComponent(location.hash.slice(1));
if (wanted in FIXTURES) pickFixture.value = wanted;
else pickFixture.value = 'mid game (main)';
// ?click=Bank,Trade presses buttons by label (handy for screenshots of dialogs).
function clickByLabel(label: string): void {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(label));
  btn?.click();
}
const viewerParam = new URLSearchParams(location.search).get('viewer');
load();
if (viewerParam !== null && Number(viewerParam) < state.players.length) {
  pickViewer.value = viewerParam;
  draw();
}
for (const label of (new URLSearchParams(location.search).get('click') ?? '').split(',')) {
  if (label) clickByLabel(label);
}
