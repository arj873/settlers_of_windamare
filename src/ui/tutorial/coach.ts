/**
 * The "Learn to play" coach: starts the tutorial game, follows it after every render (the pure
 * steps in machine.ts), draws the panel and points at HUD elements. The game itself is a normal
 * hotseat game; the coach only reads it. main.ts wires it to the GameController (`CoachHost`).
 */
import type { Action, GameState } from '../../engine';
import type { BotLevel } from '../../bots/levels';
import { h } from '../dom';
import type { Controller } from '../types';
import {
  TUTORIAL_BOT_LEVELS,
  TUTORIAL_ME,
  TUTORIAL_PACE_MS,
  TUTORIAL_SEATS,
  TUTORIAL_SEED,
  isTutorialGame,
  tutorialGame,
} from './game';
import type { TutorialCtx } from './lessons';
import {
  advance,
  back,
  newRun,
  next,
  panelView,
  setCollapsed,
  skip,
  type TutorialRun,
} from './machine';
import { renderPanel } from './panel';
import { loadTutorial, saveTutorial, type TutorialRecord, type TutorialStorage } from './store';
import './tutorial.css';

export interface CoachHost {
  /** The game on screen and everyone's legal actions; null before the first game. */
  game(): { state: GameState; legal: readonly Action[] } | null;
  /** Start the tutorial game (seat controllers and bot levels by PlayerId). */
  start(state: GameState, seats: readonly Controller[], botLevels: readonly BotLevel[]): void;
  /** Open the new-game screen. */
  newGame(): void;
  /** Bots move at least this slowly (ms per move); null = the player's own bot speed again. */
  pace(ms: number | null): void;
}

/** Attribute on the HUD root naming the element to point at (tutorial.css). */
export const FOCUS_ATTR = 'data-tut-focus';

export class TutorialCoach {
  readonly panel: HTMLElement;
  private record: TutorialRecord;
  private paced = false;

  constructor(
    /** The HUD root: the panel lives inside it, so it hides with the HUD's covers. */
    private readonly root: HTMLElement,
    private readonly host: CoachHost,
    private readonly store: TutorialStorage | null,
  ) {
    this.record = loadTutorial(store);
    this.panel = h('section', {
      class: 'tut-panel wood',
      attrs: { 'aria-label': 'Tutorial', 'aria-live': 'polite', hidden: '' },
    });
    root.append(this.panel);
  }

  /** The coach is following a game right now. */
  get active(): boolean {
    const run = this.record.run;
    const game = this.host.game();
    return run !== null && !run.over && game !== null && this.belongs(run, game.state);
  }

  /** The learner finished or skipped the tutorial once. */
  get completed(): boolean {
    return this.record.completed;
  }

  /** "Learn to play": a fresh tutorial game with the coach from the first lesson. */
  begin(): void {
    this.save({ ...this.record, offered: true, run: newRun(TUTORIAL_SEED, TUTORIAL_ME) });
    this.setPace(true);
    // The controller renders the new game, which calls update().
    this.host.start(tutorialGame(), TUTORIAL_SEATS, TUTORIAL_BOT_LEVELS);
  }

  /** After every render of the game (and after resuming a saved one). */
  update(): void {
    const run = this.record.run;
    const game = this.host.game();
    if (!run || run.over || !game) {
      this.hide();
      return;
    }
    if (!this.belongs(run, game.state)) {
      // Another game replaced the tutorial game (and its autosave): the run is gone.
      this.save({ ...this.record, run: null });
      this.setPace(false);
      this.hide();
      return;
    }
    this.setPace(true);
    const ctx = this.ctx(run, game);
    this.set(advance(run, ctx), ctx);
  }

  /** Remove the coach from the screen (the run stays saved). */
  hide(): void {
    this.panel.hidden = true;
    this.panel.replaceChildren();
    this.root.removeAttribute(FOCUS_ATTR);
  }

  private belongs(run: TutorialRun, state: GameState): boolean {
    return isTutorialGame(state) && String(state.settings.seed) === run.seed;
  }

  private ctx(run: TutorialRun, game: { state: GameState; legal: readonly Action[] }): TutorialCtx {
    return {
      state: game.state,
      me: run.me,
      legal: game.legal.filter((a) => a.player === run.me),
    };
  }

  /** Apply a panel button to the run, with the current game. */
  private press(step: (run: TutorialRun, ctx: TutorialCtx) => TutorialRun): void {
    const run = this.record.run;
    const game = this.host.game();
    if (!run || !game) return;
    const ctx = this.ctx(run, game);
    this.set(step(run, ctx), ctx);
  }

  private set(run: TutorialRun, ctx: TutorialCtx): void {
    if (run.over) {
      this.save({ ...this.record, completed: true, run: null });
      this.setPace(false);
      this.hide();
      return;
    }
    if (run !== this.record.run) this.save({ ...this.record, run });
    const view = panelView(run, ctx);
    this.panel.hidden = false;
    renderPanel(this.panel, view, {
      next: () => this.press(next),
      back: () => this.press((r) => back(r)),
      skip: () => this.press((r) => skip(r)),
      collapse: (c) => this.press((r) => setCollapsed(r, c)),
      newGame: () => {
        this.press(next);
        this.host.newGame();
      },
    });
    if (view.focus && !view.collapsed) this.root.setAttribute(FOCUS_ATTR, view.focus);
    else this.root.removeAttribute(FOCUS_ATTR);
  }

  private setPace(on: boolean): void {
    if (on === this.paced) return;
    this.paced = on;
    this.host.pace(on ? TUTORIAL_PACE_MS : null);
  }

  private save(rec: TutorialRecord): void {
    this.record = rec;
    saveTutorial(this.store, rec);
  }
}

/**
 * First visit: a small dismissible "New here?" card, shown once. Not after the tutorial was
 * offered or finished, and not for a returning player (`returning`: a save or setup settings).
 * Returns the card (already in `parent`; remove it when the screen changes) or null.
 */
export function offerTutorial(
  parent: HTMLElement,
  store: TutorialStorage | null,
  returning: boolean,
  onLearn: () => void,
): HTMLElement | null {
  const rec = loadTutorial(store);
  if (rec.offered || rec.completed || returning) return null;
  saveTutorial(store, { ...rec, offered: true });
  const card = h(
    'aside',
    { class: 'tut-hint wood', attrs: { role: 'note', 'aria-label': 'Learn to play' } },
    h('p', {}, h('b', {}, 'New to the game? '), 'Learn the rules while you play your first game.'),
    h(
      'div',
      { class: 'tut-hint-actions' },
      h(
        'button',
        {
          class: 'btn btn-ghost btn-sm',
          attrs: { 'data-k': 'tut-hint-close' },
          on: { click: () => card.remove() },
        },
        'Not now',
      ),
      h(
        'button',
        {
          class: 'btn btn-primary btn-sm',
          attrs: { 'data-k': 'tut-hint-learn' },
          on: {
            click: () => {
              card.remove();
              onLearn();
            },
          },
        },
        'Learn to play',
      ),
    ),
  );
  parent.append(card);
  return card;
}
