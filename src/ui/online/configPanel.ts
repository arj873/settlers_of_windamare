/**
 * The host's game settings in the lobby: the hotseat SetupScreen (src/ui/setup), wrapped and not
 * modified. The screen reads its draft from, and saves every edit to, the `storage` it is given;
 * here that storage is a bridge to the room config, so the setup screen's own sections (and any
 * rule options added to it later) drive `configure`. The lobby hides the parts it replaces
 * (seats, seed, footer) with CSS. Non-hosts get the same screen, inert and read-only.
 */
import type { RoomConfig } from '../../net/protocol';
import type { NewGameVariants } from '../types';
import {
  buildConfig,
  MAP_RULE_OPTIONS,
  sanitizeSetup,
  setPlayerCount,
  STORAGE_KEY,
  TIMER_STEPS,
  SEAT_COLORS,
  type SetupDraft,
  type SetupStorage,
} from '../setup/model';
import { SetupScreen } from '../setup/screen';
import { h } from '../dom';

/** The variants of a room config as the setup draft's flat fields (buildVariants' inverse). */
function variantFields(v: NewGameVariants | undefined): Partial<SetupDraft> {
  if (!v) return {};
  const { mapRules, timer, ...flat } = v;
  const out: Partial<SetupDraft> = { ...flat };
  for (const o of MAP_RULE_OPTIONS) if (mapRules?.[o.rule]) out[o.key] = true;
  if (timer) {
    out.clockPreset = timer.preset;
    out.customBankMin = Math.round(timer.bankSec / 60);
    out.customIncrementSec = timer.incrementSec;
  }
  return out;
}

/** RoomConfig -> setup draft (seats are placeholders: only their count matters here). */
export function draftOf(config: RoomConfig): SetupDraft {
  const { seatCount, map, rules, turnTimerSec, vpToWin, discardLimit, variants, ...extra } = config;
  const timerIdx = Math.max(0, TIMER_STEPS.indexOf(turnTimerSec));
  return sanitizeSetup({
    // Rule options added to both shapes later pass through by name (mode, scenario, options).
    ...extra,
    ...variantFields(variants),
    ...rules,
    map,
    seats: Array.from({ length: seatCount }, (_, i) => ({
      name: '',
      color: SEAT_COLORS[i % SEAT_COLORS.length]?.color,
      controller: 'bot',
    })),
    timerIdx,
    vpToWin,
    discardLimit,
    seed: '',
  });
}

/** Setup draft -> RoomConfig: the hotseat NewGameConfig without players and seed, plus seat count. */
export function configOf(draft: SetupDraft): RoomConfig {
  const { players, seed: _seed, ...rest } = buildConfig(draft);
  return { ...rest, seatCount: players.length };
}

/** The room config with a different seat count (the map follows, like the setup screen). */
export function withSeatCount(config: RoomConfig, n: number): RoomConfig {
  return configOf(setPlayerCount(draftOf(config), n));
}

const same = (a: RoomConfig, b: RoomConfig) => JSON.stringify(a) === JSON.stringify(b);

export interface ConfigPanelOptions {
  config: RoomConfig;
  editable: boolean;
  /** Host edits, debounced. */
  onChange: (config: RoomConfig) => void;
  debounceMs?: number;
}

export class RoomConfigPanel {
  readonly element: HTMLElement;
  private screen: SetupScreen | null = null;
  private shown: RoomConfig;
  private editable: boolean;
  /** Last config we sent; its echo from the server must not rebuild the screen. */
  private sent: RoomConfig | null = null;
  private pending: ReturnType<typeof setTimeout> | null = null;
  private draftConfig: RoomConfig;

  constructor(private readonly opts: ConfigPanelOptions) {
    this.shown = opts.config;
    this.draftConfig = opts.config;
    this.editable = opts.editable;
    this.element = h('div', { class: 'ol-config' });
    this.build();
  }

  /** A room update: rebuild only if the config changed under us (or the host role moved). */
  update(config: RoomConfig, editable: boolean): void {
    const roleChanged = editable !== this.editable;
    this.editable = editable;
    if (!roleChanged) {
      if (same(config, this.draftConfig)) return;
      // Our own edit is on its way (or its echo is still behind it): keep the local draft.
      if (this.editable && (this.pending !== null || (this.sent && same(config, this.sent))))
        return;
    }
    this.shown = config;
    this.draftConfig = config;
    this.build();
  }

  destroy(): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = null;
  }

  private build(): void {
    const bridge: SetupStorage = {
      getItem: (key) => (key === STORAGE_KEY ? JSON.stringify(draftOf(this.shown)) : null),
      setItem: (key, value) => {
        if (key !== STORAGE_KEY || !this.editable) return;
        let next: RoomConfig;
        try {
          next = configOf(sanitizeSetup(JSON.parse(value)));
        } catch {
          return;
        }
        if (same(next, this.draftConfig)) return;
        this.draftConfig = next;
        this.schedule();
      },
    };
    this.screen = new SetupScreen({ storage: bridge, onStart: () => undefined });
    this.element.classList.toggle('is-readonly', !this.editable);
    this.element.toggleAttribute('inert', !this.editable);
    this.element.replaceChildren(this.screen.element);
  }

  private schedule(): void {
    if (this.pending !== null) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      this.sent = this.draftConfig;
      this.opts.onChange(this.draftConfig);
    }, this.opts.debounceMs ?? 250);
  }
}
