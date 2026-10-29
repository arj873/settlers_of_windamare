// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { applyAction, legalActions, type Action, type GameState } from '../../engine';
import { freshGame } from '../../engine/fixtures';
import { Hud } from '../hud';
import { FOCUS_ATTR, TutorialCoach, offerTutorial, type CoachHost } from './coach';
import { TUTORIAL_PACE_MS, TUTORIAL_SEATS } from './game';
import { loadTutorial, type TutorialStorage } from './store';

function memStore(): TutorialStorage & { mem: Map<string, string> } {
  const mem = new Map<string, string>();
  return {
    mem,
    getItem: (k) => mem.get(k) ?? null,
    setItem: (k, v) => void mem.set(k, v),
  };
}

/** A controller stand-in: holds one state, re-renders the coach after every change. */
class FakeHost implements CoachHost {
  state: GameState | null = null;
  paces: (number | null)[] = [];
  newGames = 0;
  coach: TutorialCoach | null = null;
  game() {
    return this.state ? { state: this.state, legal: legalActions(this.state) } : null;
  }
  start(state: GameState) {
    this.state = state;
    this.coach?.update();
  }
  newGame() {
    this.newGames++;
  }
  pace(ms: number | null) {
    this.paces.push(ms);
  }
  /** Apply a move like the controller does, then render. */
  act(pick: (legal: Action[]) => Action | undefined) {
    if (!this.state) throw new Error('no game');
    const a = pick(legalActions(this.state));
    if (!a) throw new Error('no such move');
    const r = applyAction(this.state, a);
    if (!r.ok) throw new Error(r.error);
    this.state = r.state;
    this.coach?.update();
  }
}

let root: HTMLElement;
let host: FakeHost;
let store: ReturnType<typeof memStore>;
let coach: TutorialCoach;
const click = (k: string) => root.querySelector<HTMLButtonElement>(`[data-k="${k}"]`)?.click();
const title = () => root.querySelector('.tut-title')?.textContent ?? null;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  host = new FakeHost();
  store = memStore();
  coach = new TutorialCoach(root, host, store);
  host.coach = coach;
});

describe('TutorialCoach', () => {
  it('starts the tutorial game with the slower bot pace and shows the first lesson', () => {
    coach.begin();
    expect(host.state?.players).toHaveLength(TUTORIAL_SEATS.length);
    expect(host.paces).toEqual([TUTORIAL_PACE_MS]);
    expect(coach.active).toBe(true);
    expect(coach.panel.hidden).toBe(false);
    expect(title()).toBe('Your goal');
  });

  it('Next / Back page the lessons; the learner’s move advances it', () => {
    coach.begin();
    click('tut-next');
    expect(title()).toBe('The board');
    expect(root.querySelectorAll('.tut-terrain li')).toHaveLength(5);
    expect(root.querySelector('.tut-terrain')?.textContent).toContain('Pasture → Sheep');
    click('tut-back');
    expect(title()).toBe('Your goal');
    expect(root.querySelector('.tut-badge.is-back')).not.toBe(null);
    click('tut-next');
    click('tut-next');
    expect(title()).toBe('Place a settlement');
    host.act((l) => l.find((a) => a.type === 'placeSetupSettlement' && a.player === 0));
    expect(title()).toBe('Add a road');
  });

  it('points at a HUD element through an attribute on the HUD root', () => {
    coach.begin();
    // Play through setup to the first roll.
    click('tut-next');
    click('tut-next');
    for (let i = 0; i < 40 && host.state?.phase.kind === 'setup'; i++) {
      host.act((l) =>
        l.find((a) => a.type === 'placeSetupSettlement' || a.type === 'placeSetupRoad'),
      );
    }
    expect(title()).toBe('Roll the dice');
    expect(root.getAttribute(FOCUS_ATTR)).toBe('roll');
    click('tut-min');
    expect(coach.panel.classList.contains('is-collapsed')).toBe(true);
    expect(root.hasAttribute(FOCUS_ATTR)).toBe(false);
    click('tut-expand');
    expect(root.getAttribute(FOCUS_ATTR)).toBe('roll');
  });

  it('Skip hides the coach for good and restores the bot speed', () => {
    coach.begin();
    click('tut-skip');
    expect(coach.panel.hidden).toBe(true);
    expect(coach.active).toBe(false);
    expect(host.paces).toEqual([TUTORIAL_PACE_MS, null]);
    expect(loadTutorial(store)).toMatchObject({ completed: true, run: null });
  });

  it('resumes from storage with the saved game', () => {
    coach.begin();
    click('tut-next');
    const saved = host.state;
    // A reload: a new coach reads the run, the controller resumes the saved game.
    const again = new FakeHost();
    const root2 = document.createElement('div');
    const coach2 = new TutorialCoach(root2, again, store);
    again.coach = coach2;
    again.state = saved;
    coach2.update();
    expect(root2.querySelector('.tut-title')?.textContent).toBe('The board');
    expect(again.paces).toEqual([TUTORIAL_PACE_MS]);
  });

  it('another game replacing the tutorial game ends the run quietly', () => {
    coach.begin();
    host.start(freshGame());
    expect(coach.panel.hidden).toBe(true);
    expect(loadTutorial(store).run).toBe(null);
    expect(loadTutorial(store).completed).toBe(false);
    expect(host.paces.at(-1)).toBe(null);
  });
});

describe('first-visit hint', () => {
  it('is offered once, not to returning players, and starts the tutorial', () => {
    let learned = 0;
    expect(offerTutorial(document.body, store, true, () => learned++)).toBe(null);
    const card = offerTutorial(document.body, store, false, () => learned++);
    expect(card?.isConnected).toBe(true);
    card?.querySelector<HTMLButtonElement>('[data-k="tut-hint-learn"]')?.click();
    expect(learned).toBe(1);
    expect(card?.isConnected).toBe(false);
    expect(offerTutorial(document.body, store, false, () => learned++)).toBe(null);
  });
});

describe('entry points', () => {
  it('the setup screen and the menu offer "Learn to play" when wired', () => {
    const hudRoot = document.createElement('div');
    document.body.append(hudRoot);
    const hud = new Hud(hudRoot);
    let started = 0;
    hud.showNewGame();
    expect(hudRoot.querySelector('[data-k="learn"]')).toBe(null);
    hud.setLearnToPlay(() => started++);
    hud.showNewGame();
    hudRoot.querySelector<HTMLButtonElement>('[data-k="learn"]')?.click();
    expect(started).toBe(1);
    expect(hud.isCovered()).toBe(false);

    // In a game the menu asks before leaving it.
    const s = freshGame();
    hud.render(s, { viewer: 0, legal: legalActions(s), isBotTurn: false });
    hudRoot.querySelector<HTMLButtonElement>('.menu-btn')?.click();
    hudRoot.querySelector<HTMLButtonElement>('[data-k="learn-to-play"]')?.click();
    expect(started).toBe(1);
    const ask = hudRoot.querySelector('[data-k="learn-ask"]');
    expect(ask).not.toBe(null);
    [...(ask?.querySelectorAll('button') ?? [])]
      .find((b) => b.textContent === 'Start tutorial')
      ?.click();
    expect(started).toBe(2);
    hud.destroy();
  });
});
