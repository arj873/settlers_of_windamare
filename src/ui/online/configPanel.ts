/**
 * The host's game settings in the lobby: the hotseat SetupScreen (src/ui/setup), wrapped and not
 * modified. The screen reads its draft from, and saves every edit to, the `storage` it is given;
 * here that storage is a bridge to the room config, so the setup screen's own sections (and any
 * rule options added to it later) drive `configure`. The lobby hides the parts it replaces
 * (seats, seed, footer) with CSS. Non-hosts get the same screen, inert and read-only.
 */
import { roomConfigError, type RoomConfig } from '../../net/protocol';
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

/** Equality of JSON data, key order ignored (the server and the setup model build keys apart). */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameData(x, b[i]));
  }
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => sameData(ra[k], rb[k]));
}

/** Host edits not yet confirmed by the server: changed top-level fields (undefined = removed). */
export type ConfigPatch = { [K in keyof RoomConfig]?: RoomConfig[K] | undefined };

/** The top-level fields `to` changed from `from`. */
export function diffConfig(from: RoomConfig, to: RoomConfig): ConfigPatch {
  const out: Record<string, unknown> = {};
  const f = from as unknown as Record<string, unknown>;
  const t = to as unknown as Record<string, unknown>;
  for (const k of new Set([...Object.keys(f), ...Object.keys(t)])) {
    if (!sameData(f[k], t[k])) out[k] = t[k];
  }
  return out as ConfigPatch;
}

/**
 * The host's edits on top of the room's latest config: the patch's fields win; the rest (a seat
 * count a join grew, and the board that follows it) comes from the server. Null when they no
 * longer fit together (then the server's config stands).
 */
export function rebaseConfig(patch: ConfigPatch, server: RoomConfig): RoomConfig | null {
  const out = new Map<string, unknown>(Object.entries(server));
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) out.delete(k);
    else out.set(k, v);
  }
  const merged = Object.fromEntries(out) as unknown as RoomConfig;
  if (roomConfigError(merged) === null) return merged;
  // e.g. the host picked a 3-4 player board, then a 5th player joined: the board follows the seats.
  const fitted = withSeatCount(merged, merged.seatCount);
  if (fitted.seatCount !== merged.seatCount) return null;
  return roomConfigError(fitted) === null ? fitted : null;
}

const hasKeys = (p: ConfigPatch) => Object.keys(p).length > 0;

/** Automatic re-sends of one unconfirmed edit before the panel gives up and shows the server's. */
const MAX_SENDS = 6;

export interface ConfigPanelOptions {
  config: RoomConfig;
  editable: boolean;
  /** Send a host edit (debounced); `seats` = the room's seat count the edit was made on. */
  onChange: (config: RoomConfig, seats: number) => void;
  debounceMs?: number;
  /** Wait before re-sending an edit the server has not confirmed (or refused as too fast). */
  retryMs?: number;
}

/**
 * The host's settings screen. What it shows is always the room's latest config with the host's
 * unconfirmed edits on top (`patch`), so a room update (someone joins and the room grows) never
 * undoes a host edit, and an edit is sent again until the server has it. Start reads `current()`.
 */
export class RoomConfigPanel {
  readonly element: HTMLElement;
  private screen: SetupScreen | null = null;
  /** What the screen shows. */
  private shown: RoomConfig;
  /** The room's config as the server last sent it. */
  private server: RoomConfig;
  private editable: boolean;
  private patch: ConfigPatch = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Sends since the host's last edit. */
  private sends = 0;

  constructor(private readonly opts: ConfigPanelOptions) {
    this.shown = opts.config;
    this.server = opts.config;
    this.editable = opts.editable;
    this.element = h('div', { class: 'ol-config' });
    this.build();
  }

  /** What the screen shows: the config Start uses. */
  current(): RoomConfig {
    return this.shown;
  }

  /** True while a host edit is not confirmed by the server. */
  get unconfirmed(): boolean {
    return hasKeys(this.patch);
  }

  /** A room update: rebuild only if what we show changes (or the host role moved). */
  update(config: RoomConfig, editable: boolean): void {
    const roleChanged = editable !== this.editable;
    this.editable = editable;
    this.server = config;
    if (!editable) this.drop();
    const next = this.reconcile();
    if (!roleChanged && sameData(next, this.shown)) return;
    this.shown = next;
    this.build();
  }

  /**
   * The settings with `n` seats (the lobby's Add / Remove seat), sent at once by the caller: it
   * carries any pending edit, so the debounced send is not needed.
   */
  withSeats(n: number): RoomConfig {
    this.cancel();
    return withSeatCount(this.shown, n);
  }

  /** Start pressed: the shown settings go with it; nothing is left to send on its own. */
  takeForStart(): RoomConfig {
    this.cancel();
    return this.shown;
  }

  /** The server refused a configure or start (`ref`). */
  serverError(code: string, ref: string | undefined): void {
    if (!this.editable || (ref !== 'configure' && ref !== 'start') || !hasKeys(this.patch)) return;
    if (code === 'rate_limited' || code === 'stale_state' || ref === 'start') {
      // Too fast, or a join changed the seats (that room update is already here): send again.
      this.schedule(code === 'stale_state' ? this.debounce : this.retry);
      return;
    }
    // bad_config, wrong_phase...: the server's settings stand.
    this.drop();
    this.shown = this.server;
    this.build();
  }

  /** Send a pending edit now (leaving the lobby screen). */
  flush(): void {
    if (this.timer === null) return;
    this.cancel();
    this.send();
  }

  destroy(): void {
    this.flush();
    this.cancel();
  }

  private get debounce(): number {
    return this.opts.debounceMs ?? 250;
  }

  private get retry(): number {
    return this.opts.retryMs ?? 1000;
  }

  /** Server config + patch; the patch goes once the server has all of it. */
  private reconcile(): RoomConfig {
    if (!hasKeys(this.patch)) return this.server;
    const merged = rebaseConfig(this.patch, this.server);
    if (!merged || sameData(merged, this.server)) {
      this.drop();
      return this.server;
    }
    // Still in the debounce, on the wire, refused, or sent on fewer seats: make sure it goes out.
    if (this.timer === null) this.schedule(this.retry);
    return merged;
  }

  private drop(): void {
    this.patch = {};
    this.cancel();
  }

  private cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
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
        if (sameData(next, this.shown)) return;
        this.patch = { ...this.patch, ...diffConfig(this.shown, next) };
        this.shown = next;
        this.sends = 0;
        this.schedule(this.debounce);
      },
    };
    this.screen = new SetupScreen({ storage: bridge, onStart: () => undefined });
    this.element.classList.toggle('is-readonly', !this.editable);
    this.element.toggleAttribute('inert', !this.editable);
    this.element.replaceChildren(this.screen.element);
  }

  private schedule(ms: number): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.send();
    }, ms);
  }

  private send(): void {
    if (!this.editable || !hasKeys(this.patch)) return;
    const cfg = rebaseConfig(this.patch, this.server);
    if (!cfg || sameData(cfg, this.server)) {
      this.drop();
      if (!sameData(this.shown, this.server)) {
        this.shown = this.server;
        this.build();
      }
      return;
    }
    if (++this.sends > MAX_SENDS) {
      // The server keeps not taking it: show what the room really has.
      this.drop();
      this.shown = this.server;
      this.build();
      return;
    }
    this.opts.onChange(cfg, this.server.seatCount);
  }
}
