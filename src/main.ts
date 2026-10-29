/**
 * Entry (s17): the home screen comes from a small chunk, so it paints while the game (Pixi, the
 * engine and its expansions, the HUD: `app.ts`) is still loading beside it. A dev game or a
 * `?room=` link waits for the game instead, and falls back to the home screen when it turns out
 * there is nothing to start (an unknown fixture).
 */
import { NAME_KEY, parseRoomCode } from './net/transport';
import { browserKeyStore } from './game/online/backend';
import { HomeScreen } from './ui/online/home';
import { setStylePreview } from './ui/profile/dialog';
import { loadProfile, saveProfile, type Profile } from './ui/profile/model';
import { initTheme } from './ui/theme';
import type * as GameModule from './app';

type GameChunk = typeof GameModule;

/** Query parameters that start a dev game at once (game/params.ts). */
const DEV_PARAMS = ['fixture', 'seed', 'layout', 'map', 'autoplay', 'mode'];

let gameChunk: Promise<GameChunk> | null = null;
const loadGame = () => (gameChunk ??= import('./app'));

async function main() {
  // HUD look, page background, board frame (src/ui/theme): `?theme=` > saved pick > Sunfired.
  initTheme(location.search);
  // The profile dialog's piece previews are drawn with Pixi: from the game chunk.
  setStylePreview((style, color) => loadGame().then((m) => m.pieceStylePreview(style, color)));
  const game = loadGame().then((m) => m.bootGame());
  const search = new URLSearchParams(location.search);
  const direct =
    DEV_PARAMS.some((k) => search.has(k)) || parseRoomCode(search.get('room') ?? '') !== null;
  if (direct && (await game).direct) return;

  const profile = {
    load: () => loadProfile(browserKeyStore),
    save: (p: Profile) => void saveProfile(browserKeyStore, p),
  };
  let hint: HTMLElement | null = null;
  const leave = () => {
    hint?.remove();
    home.element.remove();
  };
  const home = new HomeScreen({
    name: browserKeyStore.get(NAME_KEY) ?? '',
    profile,
    onOffline: () => {
      hint?.remove();
      // Pressed before the game chunk arrived (slow network): the screen shows it is working.
      home.element.classList.add('is-busy');
      void game.then((g) => {
        home.element.remove();
        g.offline();
      });
    },
    onCreate: async (name) => {
      hint?.remove();
      await (await game).create(name, leave);
    },
    onJoin: async (code, name) => {
      hint?.remove();
      await (await game).join(code, name, leave);
    },
  });
  document.body.append(home.element);
  const g = await game;
  // Still on the home screen (no button pressed meanwhile): offer the tutorial on a first visit.
  if (home.element.isConnected && !g.direct) {
    hint = g.offerTutorial(() => {
      home.element.remove();
      g.offline(true);
    });
  }
}

void main();
