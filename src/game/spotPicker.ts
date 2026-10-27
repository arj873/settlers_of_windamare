/**
 * Board clicks for both controllers (hotseat and online), issue #28: a click on a spot either
 * submits at once (prompts, build modes, or a lone build with "Confirm before building" off) or
 * opens the spot prompt (ui/spotPrompt.ts) with what the spot can take. The decisions are pure
 * (logic.ts `clickTargets` / `resolveClick`); this keeps the open prompt in step with the game.
 */
import type { Action, GameState, PlayerId, Point } from '../engine';
import type { Highlights } from '../render';
import type { PlaceMode } from '../ui';
import type { SpotPromptRequest } from '../ui/spotPrompt';
import { clickTargets, highlightsFor, resolveClick, type BoardClick } from './logic';

/** What the controllers need of ui/spotPrompt.ts `SpotPrompt`. */
export interface SpotPromptLike {
  show(req: SpotPromptRequest): void;
  hide(): void;
}

export interface SpotPickerOptions {
  /** Null: no prompt (tests, headless): an ask submits its first choice. */
  prompt: SpotPromptLike | null;
  /** Page position of a spot (BoardView.screenPos), where the prompt opens. */
  screenPos(id: string): Point | null;
  /** The "Confirm before building" setting. */
  confirm(): boolean;
  submit(action: Action): void;
  /** The highlights changed (prompt opened or closed). */
  rehighlight(): void;
}

/** What the controller shows now. */
export interface SpotContext {
  state: GameState;
  legal: readonly Action[];
  viewer: PlayerId;
  placeMode: PlaceMode | null;
}

const key = (a: Action) => JSON.stringify(a);

export class SpotPicker {
  /** The open prompt's choices and whom they are for. */
  private open: {
    choices: readonly Action[];
    viewer: PlayerId;
    placeMode: PlaceMode | null;
  } | null = null;

  constructor(private readonly o: SpotPickerOptions) {}

  get isOpen(): boolean {
    return this.open !== null;
  }

  /** Board actions a click may lead to right now (what the board highlights). */
  targets(ctx: Omit<SpotContext, 'state'>): Action[] {
    return clickTargets(ctx.legal, ctx.viewer, ctx.placeMode).actions;
  }

  click(ctx: SpotContext, click: BoardClick): void {
    const out = resolveClick(
      clickTargets(ctx.legal, ctx.viewer, ctx.placeMode),
      click,
      this.o.confirm(),
    );
    if (out.kind === 'none') return;
    const prompt = this.o.prompt;
    if (out.kind === 'act' || !prompt) {
      this.close();
      this.o.submit(out.kind === 'act' ? out.action : (out.choices[0] as Action));
      return;
    }
    this.open = { choices: out.choices, viewer: ctx.viewer, placeMode: ctx.placeMode };
    const color = ctx.state.players[ctx.viewer]?.color;
    prompt.show({
      state: ctx.state,
      choices: out.choices,
      at: this.o.screenPos(click.id),
      ...(color ? { color } : {}),
      onPick: (a) => {
        this.open = null;
        this.o.submit(a);
        this.o.rehighlight();
      },
      onCancel: () => {
        this.open = null;
        this.o.rehighlight();
      },
    });
    this.o.rehighlight();
  }

  /** Highlights: the open prompt's spot, else every target (build-anywhere ones on hover only). */
  highlights(ctx: SpotContext): Highlights {
    const color = ctx.state.players[ctx.viewer]?.color;
    if (this.open) return highlightsFor(this.open.choices, color);
    const t = clickTargets(ctx.legal, ctx.viewer, ctx.placeMode);
    return highlightsFor(t.actions, color, t.spot);
  }

  /**
   * After a state or mode change: the prompt stays only while all its choices are still legal for
   * the same viewer in the same build mode (another seat moved, a trade reply came in…).
   */
  sync(ctx: { legal: readonly Action[]; viewer: PlayerId | null; placeMode: PlaceMode | null }) {
    const open = this.open;
    if (!open) return;
    const legal = new Set(ctx.legal.map(key));
    const valid =
      ctx.viewer === open.viewer &&
      ctx.placeMode === open.placeMode &&
      open.choices.every((a) => legal.has(key(a)));
    if (!valid) this.close();
  }

  /** Close the prompt without submitting. */
  close(): void {
    if (!this.open) return;
    this.open = null;
    this.o.prompt?.hide();
  }
}
