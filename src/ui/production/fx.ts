/**
 * Production animation (issue #29), the DOM half: after a roll, small cards fly from each
 * producing hex to the receiving player's row in the Players panel (or to your own hand), then
 * a "+2 grain +1 ore" badge pops on the row and fades. The robber's hex bounces its cards off.
 *
 * Plain DOM over the board (one fixed layer, Web Animations on transforms and opacity), so the
 * Pixi board renders nothing for it and stays idle. Plans come from plan.ts; a new plan cancels
 * the running one at once, and rolls in quick succession (fast bots) show badges only.
 */
import { isResource, type GameState, type HexId, type PlayerId } from '../../engine';
import { h } from '../dom';
import { hudExtensionsFor } from '../expansions';
import { loadAnimations, prefersReducedMotion } from '../motion';
import type { HudView } from '../types';
import { resCardFace } from '../widgets';
import { Coalescer, FLIGHT_MS, productionPlan, timeline, type ProductionPlan } from './plan';
import './fx.css';

export interface Point {
  x: number;
  y: number;
}

/** Page position (CSS px, like clientX/Y) of a hex centre on the board; null when unknown. */
export type HexLocator = (hex: HexId) => Point | null;

/** How long a badge stays (pop, hold, fade), ms. Matches `prod-badge` in fx.css. */
export const BADGE_MS = 2200;
const CARD_W = 26;
const BADGE_CARD_W = 15;

export interface ProductionFxOptions {
  /** Clock in ms (default performance.now). */
  now?: () => number;
  /** Flying is allowed (default: the Animations setting and no reduced-motion request). */
  motion?: () => boolean;
}

export class ProductionFx {
  readonly layer: HTMLElement;
  private locate: HexLocator | null = null;
  private prev: GameState | null = null;
  private readonly coalescer = new Coalescer();
  private readonly running = new Set<Animation>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private readonly now: () => number;
  private readonly motion: () => boolean;

  constructor(
    private readonly root: HTMLElement,
    opts: ProductionFxOptions = {},
  ) {
    this.now = opts.now ?? (() => performance.now());
    this.motion = opts.motion ?? (() => loadAnimations() && !prefersReducedMotion());
    this.layer = h('div', { class: 'prod-fx', attrs: { 'aria-hidden': 'true' } });
    root.append(this.layer);
  }

  /** Where hexes are on screen (the board view). Without it cards fly from the dice. */
  setLocator(locate: HexLocator | null): void {
    this.locate = locate;
  }

  /**
   * A new state was rendered (the HUD has already redrawn its rows and hand). `covered`: the
   * hotseat cover or the new-game screen hides the game; the change is noted but not shown.
   */
  update(state: GameState, view: HudView, covered: boolean): void {
    const plan = productionPlan(this.prev, state);
    this.prev = state;
    if (!plan || covered) return;
    this.play(plan, state, view, this.coalescer.next(this.now(), this.motion()));
  }

  /** Stop everything at once (a new plan, a new game). */
  clear(): void {
    for (const a of this.running) a.cancel();
    this.running.clear();
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.layer.replaceChildren();
  }

  destroy(): void {
    this.clear();
    this.layer.remove();
  }

  private play(plan: ProductionPlan, state: GameState, view: HudView, fly: boolean): void {
    this.clear();
    // Web Animations missing (jsdom, very old browsers): badges only.
    const canFly = fly && typeof this.layer.animate === 'function';
    const tl = timeline(plan, canFly);
    const dice = this.diceCenter();

    for (const f of tl.flights) {
      const from = (f.from && this.locate?.(f.from)) || dice;
      const to = this.target(f.player, f.kind, view);
      if (!from || !to) continue;
      this.fly(this.face(state, f.kind, CARD_W), from, to, f.delay);
    }
    for (const b of tl.badges) {
      const gain = plan.gains.find((g) => g.player === b.player);
      if (gain) this.later(b.at, () => this.badge(state, gain.player, gain.items));
    }
    if (plan.blocked && canFly) {
      const at = this.locate?.(plan.blocked);
      if (at) this.bounce(at);
    }
  }

  private later(ms: number, fn: () => void): void {
    if (ms <= 0) {
      fn();
      return;
    }
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  private track(a: Animation, el: HTMLElement): void {
    this.running.add(a);
    a.onfinish = () => {
      this.running.delete(a);
      el.remove();
    };
  }

  // --- pieces -----------------------------------------------------------------

  /** A card's art: resources, a module's own (`cardFace`), else a lettered token. */
  private face(state: GameState, kind: string, w: number): HTMLElement {
    if (isResource(kind)) return resCardFace(kind, w);
    for (const x of hudExtensionsFor(state)) {
      const el = x.cardFace?.(kind, w);
      if (el) return el;
    }
    return h(
      'span',
      {
        class: 'card-face prod-token',
        style: { '--cw': `${w}px` },
        attrs: { role: 'img', 'aria-label': kind },
      },
      kind.slice(0, 1).toUpperCase(),
    );
  }

  /** One card from `from` to `to` on a slight arc, after `delay` ms. */
  private fly(face: HTMLElement, from: Point, to: Point, delay: number): void {
    const el = h('div', { class: 'prod-card' }, face);
    el.style.left = `${from.x}px`;
    el.style.top = `${from.y}px`;
    this.layer.append(el);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    // The arc rises a little over its flat midpoint, more on long flights.
    const lift = Math.min(90, 24 + Math.hypot(dx, dy) * 0.12);
    const at = (t: number, extra: string) =>
      `translate(-50%, -50%) translate(${dx * t}px, ${dy * t - lift * 4 * t * (1 - t)}px) ${extra}`;
    const a = el.animate(
      [
        { transform: at(0, 'scale(0.4)'), opacity: 0 },
        { transform: at(0.12, 'scale(1.05)'), opacity: 1, offset: 0.12 },
        { transform: at(0.5, 'scale(1) rotate(-4deg)'), opacity: 1, offset: 0.5 },
        { transform: at(0.9, 'scale(0.8)'), opacity: 1, offset: 0.9 },
        { transform: at(1, 'scale(0.55)'), opacity: 0 },
      ],
      { duration: FLIGHT_MS, delay, easing: 'cubic-bezier(.45,.05,.4,1)', fill: 'both' },
    );
    this.track(a, el);
  }

  /** Two card backs hop up from the robber's hex and fall back with a shake: nothing paid. */
  private bounce(at: Point): void {
    for (const side of [-1, 1]) {
      const el = h('div', { class: 'prod-card prod-blocked' }, h('span', { class: 'prod-back' }));
      el.style.left = `${at.x}px`;
      el.style.top = `${at.y}px`;
      this.layer.append(el);
      const x = (t: number) => `translate(-50%, -50%) translate(${side * 10 * t}px, `;
      const a = el.animate(
        [
          { transform: `${x(0)}0px) scale(0.5)`, opacity: 0 },
          { transform: `${x(0.6)}-30px) rotate(${side * 8}deg)`, opacity: 1, offset: 0.35 },
          { transform: `${x(0.8)}-24px) rotate(${-side * 10}deg)`, opacity: 1, offset: 0.55 },
          { transform: `${x(1)}4px) rotate(${side * 18}deg) scale(0.7)`, opacity: 0 },
        ],
        { duration: 760, easing: 'ease-out', fill: 'both' },
      );
      this.track(a, el);
    }
    const mark = h('div', { class: 'prod-blocked-mark' }, '✕');
    mark.style.left = `${at.x}px`;
    mark.style.top = `${at.y}px`;
    this.layer.append(mark);
    const a = mark.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1.1)', opacity: 1, offset: 0.3 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.7 },
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 },
      ],
      { duration: 900, delay: 120, fill: 'both' },
    );
    this.track(a, mark);
  }

  /** "+2 [grain] +1 [ore]" on the player's row; it pops, holds, and fades (CSS). */
  private badge(state: GameState, player: PlayerId, items: ProductionPlan['gains'][0]['items']) {
    const row = this.row(player);
    if (!row) return;
    const r = row.getBoundingClientRect();
    const el = h(
      'div',
      {
        class: `prod-badge${this.motion() ? '' : ' is-still'}`,
        attrs: { 'data-player': String(player) },
      },
      ...items.flatMap((it) => [
        h('span', { class: 'prod-n' }, `+${it.count}`),
        this.face(state, it.kind, BADGE_CARD_W),
      ]),
    );
    el.style.left = `${r.right - 6}px`;
    el.style.top = `${r.top + r.height / 2}px`;
    this.layer.append(el);
    this.later(BADGE_MS, () => el.remove());
  }

  // --- where things are -------------------------------------------------------

  private row(player: PlayerId): HTMLElement | null {
    const el = this.root.querySelector<HTMLElement>(`.hud-players .pp[data-player="${player}"]`);
    return el && visible(el) ? el : null;
  }

  /** Your own cards land on their card in the hand; everyone else's on their row. */
  private target(player: PlayerId, kind: string, view: HudView): Point | null {
    if (player === view.viewer && !view.spectator) {
      const hand = this.root.querySelector<HTMLElement>('.hand');
      const card =
        hand?.querySelector<HTMLElement>(`[data-card="${CSS.escape(kind)}"]`) ??
        (hand && visible(hand) ? hand : null);
      if (card && visible(card)) return center(card);
    }
    const row = this.row(player);
    return row ? center(row) : null;
  }

  private diceCenter(): Point | null {
    const dice = this.root.querySelector<HTMLElement>('.hud-controls .dice');
    return dice && visible(dice) ? center(dice) : null;
  }
}

function visible(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function center(el: HTMLElement): Point {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
