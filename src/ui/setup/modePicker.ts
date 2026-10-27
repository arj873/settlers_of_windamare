/**
 * The setup screen's mode picker, derived from the engine registry (no DOM): one chip per
 * expansion that plays on its own, and the modes each chip selection stands for.
 *
 * A mode's chips are the modules it activates that require no other module (`modeModules`, with
 * `requires` followed): `tb+ck` -> {ck, tb}. Modes with the same chips share one selection
 * (`tb+ck`, `ba+ck` and `two+ck` are all T&B + C&K; `tb+tb` is T&B on its own) and are told
 * apart by the scenario picker, which lists every scenario of every mode of the selection.
 */
import {
  allModules,
  expansionById,
  scenarioById,
  type ModeDef,
  type PlayerRange,
  type ScenarioDef,
} from '../../engine';
import {
  VP_MAX,
  VP_MIN,
  clamp,
  draftVpDefault,
  modeModules,
  modeOf,
  playerRange,
  setMode,
  setScenario,
  visibleModes,
  type SetupDraft,
} from './model';

export interface Chip {
  /** The module's id. */
  id: string;
  name: string;
  icon: string;
}

export interface ChipState extends Chip {
  on: boolean;
  /** Why the chip can't be toggled from the current selection (null = it can). */
  reason: string | null;
}

/** Shown when a module has no `icon`. */
const DEFAULT_ICON = '🧩';

const registryIndex = (id: string): number => allModules().findIndex((m) => m.id === id);
const byRegistry = (a: string, b: string): number => registryIndex(a) - registryIndex(b);
const keyOf = (chips: readonly string[]): string => [...chips].sort(byRegistry).join('+');

/** The chips of a mode, in registry order ([] = base). */
export function modeChips(mode: ModeDef): string[] {
  return modeModules(mode)
    .filter((m) => !m.variant && (m.requires ?? []).length === 0)
    .map((m) => m.id)
    .sort(byRegistry);
}

/**
 * Chips for the offered modes: expansions that combine with others first (the big boxes), then
 * the rest, each part in registry order.
 */
export function offeredChips(showAll = false): Chip[] {
  const modes = visibleModes(showAll).map(modeChips);
  const ids = [...new Set(modes.flat())].sort(byRegistry);
  const combines = (id: string) => modes.some((c) => c.length > 1 && c.includes(id));
  return [...ids.filter(combines), ...ids.filter((id) => !combines(id))].map((id) => {
    const m = expansionById(id);
    return { id, name: m?.name ?? id, icon: m?.icon ?? DEFAULT_ICON };
  });
}

/** Offered modes whose chips are exactly `chips`, in registry order. */
export function modesForChips(chips: readonly string[], showAll = false): ModeDef[] {
  const key = keyOf(chips);
  return visibleModes(showAll).filter((m) => keyOf(modeChips(m)) === key);
}

export function selectedChips(draft: Pick<SetupDraft, 'mode'>): string[] {
  return modeChips(modeOf(draft));
}

const nameOf = (id: string): string => expansionById(id)?.name ?? id;

/** Why `id` can't join `chips`: an official conflict (either side declares it), else no mode. */
function addReason(chips: readonly string[], id: string): string {
  const m = expansionById(id);
  const clash = chips.filter(
    (c) => m?.conflicts?.includes(c) === true || expansionById(c)?.conflicts?.includes(id) === true,
  );
  if (clash.length > 0) return `Can't combine with ${clash.map(nameOf).join(' + ')}`;
  return `No official combination with ${chips.map(nameOf).join(' + ')}`;
}

/** Every offered chip: whether it is on, and why it can't be toggled (null = it can). */
export function chipStates(draft: Pick<SetupDraft, 'mode'>, showAll = false): ChipState[] {
  const sel = selectedChips(draft);
  return offeredChips(showAll).map((c) => {
    const on = sel.includes(c.id);
    const next = on ? sel.filter((x) => x !== c.id) : [...sel, c.id];
    let reason: string | null = null;
    if (modesForChips(next, showAll).length === 0) {
      reason = on ? `No mode without ${c.name}` : addReason(sel, c.id);
    }
    return { ...c, on, reason };
  });
}

/**
 * Toggle a chip: select the first mode of the new selection, or the one that also offers the
 * current scenario (T&B Fishermen + C&K stays on Fishermen). A chip that can't toggle: no-op.
 */
export function toggleChip(draft: SetupDraft, id: string, showAll = false): SetupDraft {
  const state = chipStates(draft, showAll).find((c) => c.id === id);
  if (!state || state.reason !== null) return draft;
  const sel = selectedChips(draft);
  const modes = modesForChips(state.on ? sel.filter((x) => x !== id) : [...sel, id], showAll);
  const scenario = draft.scenario;
  const keep = scenario === null ? undefined : modes.find((m) => m.scenarios.includes(scenario));
  const mode = keep ?? modes[0];
  if (!mode) return draft;
  const next = setMode(draft, mode.id);
  return keep && scenario !== null ? setScenario(next, scenario) : next;
}

/** The line naming the selected mode ("Traders & Barbarians + Cities & Knights · official combo"). */
export function modeLabel(draft: Pick<SetupDraft, 'mode'>): string {
  const mode = modeOf(draft);
  const n = modeChips(mode).length;
  if (n === 0) return 'Base game';
  return n > 1 ? `${mode.name} · official combo` : mode.name;
}

/** Disabled chips grouped by reason, for the notes under the chips. */
export function chipNotes(chips: readonly ChipState[]): { names: string[]; reason: string }[] {
  const out: { names: string[]; reason: string }[] = [];
  for (const c of chips) {
    if (c.reason === null) continue;
    const row = out.find((r) => r.reason === c.reason);
    if (row) row.names.push(c.name);
    else out.push({ names: [c.name], reason: c.reason });
  }
  return out;
}

export interface ScenarioEntry {
  mode: ModeDef;
  scenario: ScenarioDef;
  /** Seats the mode allows on this scenario. */
  players: PlayerRange;
  /** The VP target picking it starts from (the draft's options when it is the draft's mode). */
  vp: number;
  /** data-k: `scenario-<id>`, or `scenario-<mode>:<id>` for a scenario an earlier mode lists. */
  key: string;
}

/** The scenarios of every mode of the draft's selection, grouped by mode (base: none). */
export function scenarioGroups(
  draft: SetupDraft,
  showAll = false,
): { mode: ModeDef; entries: ScenarioEntry[] }[] {
  const sel = selectedChips(draft);
  if (sel.length === 0) return [];
  const modes = modesForChips(sel, showAll);
  // A hidden mode the draft still holds (tests, an old save): show it on its own.
  if (!modes.some((m) => m.id === draft.mode)) modes.splice(0, modes.length, modeOf(draft));
  const seen = new Set<string>();
  return modes.map((mode) => {
    const base = mode.id === draft.mode ? draft : setMode(draft, mode.id);
    const entries: ScenarioEntry[] = [];
    for (const id of mode.scenarios) {
      const scenario = scenarioById(id);
      if (!scenario) continue;
      const key = seen.has(id) ? `scenario-${mode.id}:${id}` : `scenario-${id}`;
      seen.add(id);
      const at = { ...base, scenario: id };
      entries.push({
        mode,
        scenario,
        players: playerRange(at),
        vp: clamp(draftVpDefault(at), VP_MIN, VP_MAX),
        key,
      });
    }
    return { mode, entries };
  });
}

/** Pick a scenario of any mode of the selection (switching mode first if needed). */
export function pickScenario(draft: SetupDraft, modeId: string, scenarioId: string): SetupDraft {
  const next = draft.mode === modeId ? draft : setMode(draft, modeId);
  return next.mode === modeId ? setScenario(next, scenarioId) : draft;
}
