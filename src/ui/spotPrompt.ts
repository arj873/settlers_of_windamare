/**
 * Spot prompt (issue #28): the small popover a click on a board spot opens when no build mode is
 * on: what the spot can take, its cost, and Build / Cancel. Several choices (road or ship on a
 * coast edge, knight or settlement…) get one button each. Esc, Cancel or a press anywhere else
 * cancels. The controllers decide when to open it (game/logic.ts `resolveClick`).
 */
import {
  RESOURCES,
  costOf,
  type Action,
  type GameState,
  type Point,
  type ResourceCounts,
  resourceWord,
} from '../engine';
import { h } from './dom';
import { HUD_EXTENSIONS } from './expansions';
import { glyph, type GlyphName } from './icons';
import { resCardFace } from './widgets';
import './spotPrompt.css';

export interface SpotChoice {
  label: string;
  /** Null: a free piece (`free`) or not a purchase (Command, Move ship). */
  cost: ResourceCounts | null;
  /** A piece placed for free (setup, Road Building, a free ship). */
  free: boolean;
  glyph: GlyphName;
}

const BASE_CHOICES: Record<string, { label: string; item: 'road' | 'settlement' | 'city' | null }> =
  {
    buildRoad: { label: 'Road', item: 'road' },
    buildSettlement: { label: 'Settlement', item: 'settlement' },
    buildCity: { label: 'City', item: 'city' },
    placeSetupRoad: { label: 'Road', item: null },
    placeSetupSettlement: { label: 'Settlement', item: null },
    placeFreeRoad: { label: 'Road', item: null },
  };

/** 'ck/activateKnight' -> 'Activate knight' (an action no build card names). */
function humanize(type: string): string {
  const name = type.slice(type.indexOf('/') + 1).replace(/([a-z])([A-Z])/g, '$1 $2');
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/** Label, cost and icon of a spot action: base builds, module build cards, else its type name. */
export function spotChoice(state: GameState, a: Action): SpotChoice {
  const base = BASE_CHOICES[a.type];
  if (base) {
    return {
      label: base.label,
      cost: base.item ? costOf(state, base.item) : null,
      free: base.item === null,
      glyph: base.item ?? (base.label === 'Road' ? 'road' : 'settlement'),
    };
  }
  for (const x of HUD_EXTENSIONS) {
    for (const card of x.buildCards ?? []) {
      // The card's own action is the purchase; its `alsoActions` place free pieces.
      const own = card.actionType === a.type;
      if (!own && !card.alsoActions?.includes(a.type)) continue;
      const cost = own ? costOf(state, card.costItem ?? card.mode) : undefined;
      return {
        label: card.label,
        cost: cost && RESOURCES.some((r) => cost[r] > 0) ? cost : null,
        free: !own,
        glyph: card.glyph ?? 'settlement',
      };
    }
  }
  return { label: humanize(a.type), cost: null, free: false, glyph: 'settlement' };
}

export interface SpotPromptRequest {
  state: GameState;
  /** The actions at the spot, one per type (game/logic.ts `resolveClick`). */
  choices: readonly Action[];
  /** Page position (CSS px) of the spot; null = bottom centre. */
  at: Point | null;
  /** The acting player's colour (glyph tint). */
  color?: string;
  onPick(action: Action): void;
  onCancel(): void;
}

/** Gap between the spot and the popover, and the popover's distance from the window edges. */
const GAP = 22;
const MARGIN = 8;

export class SpotPrompt {
  private el: HTMLElement | null = null;
  private req: SpotPromptRequest | null = null;

  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // The HUD also listens for Esc (menu, build mode): this Esc only closes the prompt.
    e.stopImmediatePropagation();
    this.cancel();
  };
  private readonly onDown = (e: PointerEvent) => {
    if (this.el && !this.el.contains(e.target as Node)) this.cancel();
  };

  constructor(private readonly layer: HTMLElement) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  /** The open request's choices (tests, controllers re-checking legality). */
  get choices(): readonly Action[] {
    return this.req?.choices ?? [];
  }

  show(req: SpotPromptRequest): void {
    this.close();
    this.req = req;
    const items = req.choices.map((a) => ({ action: a, info: spotChoice(req.state, a) }));
    const single = items.length === 1 ? items[0] : undefined;
    const style = req.color ? { '--pc': req.color } : undefined;
    const pick = (a: Action) => () => {
      this.close();
      req.onPick(a);
    };
    const cancel = h(
      'button',
      {
        class: 'btn btn-ghost',
        attrs: { 'data-k': 'spot-cancel' },
        on: { click: () => this.cancel() },
      },
      'Cancel',
    );
    let body: HTMLElement[];
    let primary: HTMLButtonElement;
    if (single) {
      const { info, action } = single;
      primary = h(
        'button',
        {
          class: 'btn btn-primary',
          attrs: { 'data-k': 'spot-build', 'data-action': action.type },
          on: { click: pick(action) },
        },
        info.cost || info.free ? 'Build' : info.label,
      );
      body = [
        h(
          'div',
          { class: 'spot-head' },
          glyph(info.glyph, 28),
          h('span', { class: 'spot-label' }, info.label),
          costRow(info),
        ),
        h('div', { class: 'spot-btns' }, cancel, primary),
      ];
    } else {
      const options = items.map(({ action, info }) =>
        h(
          'button',
          {
            class: 'btn spot-choice',
            attrs: { 'data-k': 'spot-build', 'data-action': action.type },
            on: { click: pick(action) },
          },
          glyph(info.glyph, 26),
          h('span', { class: 'spot-label' }, info.label),
          costRow(info),
        ),
      );
      primary = options[0] as HTMLButtonElement;
      body = [
        h('div', { class: 'spot-title' }, 'Build here'),
        h('div', { class: 'spot-list' }, ...options),
        h('div', { class: 'spot-btns' }, cancel),
      ];
    }
    const el = h(
      'div',
      {
        // `menu-panel wood`: each theme dresses it like the menu (sunfired: the light glaze).
        class: 'spot-prompt menu-panel wood',
        attrs: {
          role: 'dialog',
          'aria-label': single ? `Build ${single.info.label}?` : 'Build here',
        },
        ...(style ? { style } : {}),
      },
      ...body,
    );
    this.el = el;
    this.layer.append(el);
    this.place(req.at);
    document.addEventListener('keydown', this.onKey, true);
    document.addEventListener('pointerdown', this.onDown, true);
    primary.focus({ preventScroll: true });
  }

  /** Close without a callback (the controller moved on: new state, build mode, new viewer). */
  hide(): void {
    this.close();
  }

  private cancel(): void {
    const req = this.req;
    this.close();
    req?.onCancel();
  }

  private close(): void {
    if (!this.el) return;
    document.removeEventListener('keydown', this.onKey, true);
    document.removeEventListener('pointerdown', this.onDown, true);
    this.el.remove();
    this.el = null;
    this.req = null;
  }

  /** Above the spot (below when there is no room), kept inside the window. */
  private place(at: Point | null): void {
    const el = this.el;
    if (!el) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const ht = el.offsetHeight;
    const p = at ?? { x: vw / 2, y: vh - MARGIN - GAP };
    const above = p.y - GAP - ht >= MARGIN;
    const top = above ? p.y - GAP - ht : Math.min(p.y + GAP, vh - ht - MARGIN);
    const left = Math.max(MARGIN, Math.min(p.x - w / 2, vw - w - MARGIN));
    el.classList.toggle('is-below', !above);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(Math.max(MARGIN, top))}px`;
    // The caret points at the spot even when the box was pushed sideways.
    el.style.setProperty(
      '--caret-x',
      `${Math.round(Math.max(16, Math.min(w - 16, p.x - left)))}px`,
    );
  }
}

function costRow({ cost, free }: SpotChoice): HTMLElement | null {
  if (!cost) return free ? h('span', { class: 'spot-cost muted' }, 'free') : null;
  return h(
    'span',
    { class: 'spot-cost', attrs: { 'aria-label': `cost: ${describe(cost)}` } },
    ...RESOURCES.flatMap((r) => Array.from({ length: cost[r] }, () => resCardFace(r, 18))),
  );
}

const describe = (cost: ResourceCounts) =>
  RESOURCES.filter((r) => cost[r] > 0)
    .map((r) => `${cost[r]} ${resourceWord(r)}`)
    .join(', ');
