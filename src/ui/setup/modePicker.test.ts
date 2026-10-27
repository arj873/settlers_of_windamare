// @vitest-environment jsdom
/** U7: expansion chips <-> registry modes, and the chip picker on the setup screen and online. */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CONFIG } from '../../net/protocol';
import { defaultVpToWin, modeById, scenarioById } from '../../engine';
import { RoomConfigPanel } from '../online/configPanel';
import {
  chipNotes,
  chipStates,
  modeChips,
  modeLabel,
  modesForChips,
  offeredChips,
  pickScenario,
  scenarioGroups,
  toggleChip,
} from './modePicker';
import {
  defaultSetup,
  saveSetup,
  setMode,
  visibleModes,
  type SetupDraft,
  type SetupStorage,
} from './model';
import { SetupScreen } from './screen';
import { pickMode } from './testkit';

const at = (mode: string): SetupDraft => setMode(defaultSetup(4), mode);
const reason = (draft: SetupDraft, chip: string, showAll = false) =>
  chipStates(draft, showAll).find((c) => c.id === chip)?.reason;

describe('chips from the registry', () => {
  it('one chip per expansion that plays alone: combinable ones first, then registry order', () => {
    expect(offeredChips().map((c) => c.id)).toEqual(['ck', 'seafarers', 'tb', 'ep', 'oil', 'crop']);
    // ?modes=all adds the demo (no combos: with the loners).
    expect(offeredChips(true).map((c) => c.id)).toEqual([
      'ck',
      'seafarers',
      'tb',
      'ep',
      'demo',
      'oil',
      'crop',
    ]);
    for (const c of offeredChips(true)) expect(c.icon, c.id).not.toBe('🧩');
  });

  it("a mode's chips are its modules without requires (combo modules drop out)", () => {
    expect(modeChips(modeById('base')!)).toEqual([]);
    expect(modeChips(modeById('ck')!)).toEqual(['ck']);
    for (const id of ['tb+ck', 'ba+ck', 'two+ck'])
      expect(modeChips(modeById(id)!)).toEqual(['ck', 'tb']);
    expect(modeChips(modeById('tb+tb')!)).toEqual(['tb']);
    expect(modeChips(modeById('seafarers+ck')!)).toEqual(['ck', 'seafarers']);
    expect(modesForChips(['tb', 'ck']).map((m) => m.id)).toEqual(['tb+ck', 'ba+ck', 'two+ck']);
    expect(modesForChips(['tb']).map((m) => m.id)).toEqual(['tb', 'tb+tb']);
  });

  it.each([false, true])('every offered mode and scenario is reachable (showAll %s)', (showAll) => {
    const seen = new Set<string>();
    const key = (d: SetupDraft) => `${d.mode}|${d.scenario ?? ''}`;
    const queue: SetupDraft[] = [defaultSetup(4)];
    while (queue.length > 0) {
      const d = queue.shift()!;
      if (seen.has(key(d))) continue;
      seen.add(key(d));
      for (const c of chipStates(d, showAll)) {
        if (c.reason === null) queue.push(toggleChip(d, c.id, showAll));
      }
      for (const g of scenarioGroups(d, showAll)) {
        for (const e of g.entries) queue.push(pickScenario(d, e.mode.id, e.scenario.id));
      }
    }
    for (const m of visibleModes(showAll)) {
      if (m.scenarios.length === 0) expect(seen.has(`${m.id}|`), m.id).toBe(true);
      for (const s of m.scenarios) expect(seen.has(`${m.id}|${s}`), `${m.id} ${s}`).toBe(true);
    }
    // Nothing outside the offered modes.
    const offered = new Set(visibleModes(showAll).map((m) => m.id));
    for (const k of seen) expect(offered.has(k.split('|')[0]!), k).toBe(true);
  });
});

describe('disabled chips and their reasons', () => {
  it('conflicts (either side) say so; other missing combos say "no official combination"', () => {
    expect(reason(at('seafarers'), 'ep')).toBe("Can't combine with Seafarers");
    expect(reason(at('ep'), 'seafarers')).toBe("Can't combine with Explorers & Pirates");
    expect(reason(at('seafarers'), 'oil')).toBe('No official combination with Seafarers');
    expect(reason(at('seafarers'), 'ck')).toBeNull();
    expect(reason(at('seafarers'), 'tb')).toBeNull();
    expect(reason(at('tb+ck'), 'seafarers')).toBe(
      'No official combination with Cities & Knights + Traders & Barbarians',
    );
    // The chips that are on can always go back (to the single expansion).
    expect(reason(at('tb+ck'), 'ck')).toBeNull();
    expect(reason(at('tb+ck'), 'tb')).toBeNull();
    // Base: every chip is free.
    expect(chipStates(defaultSetup()).every((c) => c.reason === null)).toBe(true);
  });

  it('notes group disabled chips by reason; a disabled chip does not toggle', () => {
    const oil = at('oil');
    expect(chipNotes(chipStates(oil))).toEqual([
      {
        names: [
          'Cities & Knights',
          'Seafarers',
          'Traders & Barbarians',
          'Explorers & Pirates',
          'Crop Trust',
        ],
        reason: 'No official combination with Oil Springs',
      },
    ]);
    expect(toggleChip(oil, 'ck')).toBe(oil);
  });
});

describe('toggling and the scenario picker', () => {
  it('toggling selects the matching mode and keeps a scenario both modes offer', () => {
    const tb = at('tb');
    expect(tb.scenario).toBe('tb/fishermen');
    const caravans = pickScenario(tb, 'tb', 'tb/caravans');
    const combo = toggleChip(caravans, 'ck');
    expect([combo.mode, combo.scenario]).toEqual(['tb+ck', 'tb/caravans']);
    expect(combo.vpToWin).toBe(defaultVpToWin(modeById('tb+ck')!, scenarioById('tb/caravans')!));
    // Seafarers has no T&B scenario ids: its first scenario.
    const sea = toggleChip(toggleChip(tb, 'tb'), 'seafarers');
    expect([sea.mode, sea.scenario]).toEqual(['seafarers', modeById('seafarers')!.scenarios[0]]);
    expect(toggleChip(sea, 'seafarers').mode).toBe('base');
  });

  it('T&B + C&K lists its three modes; seats and VP per entry; duplicate ids get a mode key', () => {
    const groups = scenarioGroups(at('tb+ck'));
    expect(groups.map((g) => g.mode.id)).toEqual(['tb+ck', 'ba+ck', 'two+ck']);
    const two = groups[2]!.entries[0]!;
    expect(two.scenario.id).toBe('tb/variants');
    expect(two.players).toEqual({ min: 2, max: 2 });
    expect(two.key).toBe('scenario-two+ck:tb/variants');
    const traders = groups[0]!.entries.find((e) => e.scenario.id === 'tb/traders')!;
    expect([traders.key, traders.vp, traders.players]).toEqual([
      'scenario-tb/traders',
      15,
      { min: 3, max: 6 },
    ]);
    const ba = pickScenario(at('tb+ck'), 'ba+ck', 'tb/barbarianAttack');
    expect([ba.mode, ba.scenario]).toEqual(['ba+ck', 'tb/barbarianAttack']);
    expect(scenarioGroups(defaultSetup())).toEqual([]);
  });

  it('the mode line names the mode; combos say "official combo"', () => {
    expect(modeLabel(defaultSetup())).toBe('Base game');
    expect(modeLabel(at('seafarers'))).toBe('Seafarers');
    expect(modeLabel(at('tb+ck'))).toBe('Traders & Barbarians + Cities & Knights · official combo');
    expect(modeLabel(at('ba+ck'))).toBe('Barbarian Attack + Cities & Knights · official combo');
    expect(modeLabel(at('tb+tb'))).toBe('T&B scenario pairs');
  });
});

class MemoryStorage implements SetupStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

describe('chip picker on the setup screen', () => {
  let screen: SetupScreen;
  const q = (k: string) => screen.element.querySelector<HTMLButtonElement>(`[data-k="${k}"]`)!;
  const pressed = () =>
    [...screen.element.querySelectorAll('[data-k^="chip-"][aria-pressed="true"]')].map((b) =>
      b.getAttribute('data-k'),
    );

  beforeEach(() => {
    screen = new SetupScreen({ onStart: () => {}, storage: null, showAllModes: false });
    document.body.replaceChildren(screen.element);
  });

  it('chips build T&B + C&K; incompatible chips are disabled with their reason shown', () => {
    q('chip-tb').click();
    expect(screen.state.mode).toBe('tb');
    q('chip-ck').click();
    expect(screen.state.mode).toBe('tb+ck');
    expect(pressed()).toEqual(['chip-ck', 'chip-tb']);
    expect(q('mode-result').textContent).toContain('Traders & Barbarians + Cities & Knights');
    expect(q('mode-result').textContent).toContain('official combo');
    const sea = q('chip-seafarers');
    expect(sea.disabled).toBe(true);
    expect(sea.title).toBe('No official combination with Cities & Knights + Traders & Barbarians');
    expect(screen.element.querySelector('.su-mode-notes')!.textContent).toContain('Seafarers');
    // One heading per mode of the selection, each scenario tile with seats and VP.
    const heads = [...screen.element.querySelectorAll('.su-scen-head')].map(
      (h) => h.firstChild?.textContent,
    );
    expect(heads).toEqual([
      'Traders & Barbarians + Cities & Knights',
      'Barbarian Attack + Cities & Knights',
      'Catan for Two + Cities & Knights',
    ]);
    expect(q('scenario-tb/traders').textContent).toContain('3–6 players · 15 VP');
    q('scenario-two+ck:tb/variants').click();
    expect([screen.state.mode, screen.state.seats.length]).toEqual(['two+ck', 2]);
    expect(q('scenario-two+ck:tb/variants').getAttribute('aria-pressed')).toBe('true');
    expect(q('scenario-two+ck:tb/variants').textContent).toContain('2 players');
    expect(q('mode-result').textContent).toContain('Catan for Two + Cities & Knights');
    // Dropping C&K keeps the T&B variants scenario.
    q('chip-ck').click();
    expect([screen.state.mode, screen.state.scenario]).toEqual(['tb', 'tb/variants']);
  });

  it('E&P next to Seafarers is disabled: they cannot be combined', () => {
    q('chip-seafarers').click();
    expect(q('chip-ep').disabled).toBe(true);
    const notes = [...screen.element.querySelectorAll('.su-mode-notes li')].map(
      (li) => li.textContent,
    );
    expect(notes).toEqual([
      "Explorers & Pirates: Can't combine with Seafarers",
      'Oil Springs, Crop Trust: No official combination with Seafarers',
    ]);
  });

  it('a saved combo mode comes back with its chips and scenario', () => {
    const st = new MemoryStorage();
    saveSetup(st, pickScenario(at('tb+ck'), 'ba+ck', 'tb/barbarianAttack'));
    screen = new SetupScreen({ onStart: () => {}, storage: st, showAllModes: false });
    expect(pressed()).toEqual(['chip-ck', 'chip-tb']);
    const tile = screen.element.querySelector(
      '[data-mode="ba+ck"][data-scenario="tb/barbarianAttack"]',
    );
    expect(tile?.getAttribute('aria-pressed')).toBe('true');
  });

  it('pickMode (test kit) reaches every ready mode through the UI', () => {
    for (const m of visibleModes()) {
      expect(pickMode(screen.element, m.id), m.id).toBe(true);
      expect(screen.state.mode).toBe(m.id);
    }
    expect(pickMode(screen.element, 'demo')).toBe(false);
  }, 60_000);
});

describe('chip picker in the online lobby', () => {
  it('the host toggles chips (configure); a guest sees the selected chips, inert', async () => {
    const sent: { mode?: string }[] = [];
    const panel = new RoomConfigPanel({
      config: DEFAULT_ROOM_CONFIG,
      editable: true,
      onChange: (c) => sent.push(c),
      debounceMs: 0,
    });
    document.body.replaceChildren(panel.element);
    panel.element.querySelector<HTMLButtonElement>('[data-k="chip-ck"]')!.click();
    await new Promise((r) => setTimeout(r, 5));
    expect(sent.at(-1)?.mode).toBe('ck');

    panel.update({ ...DEFAULT_ROOM_CONFIG, mode: 'tb+ck', scenario: 'tb/traders' }, false);
    expect(panel.element.hasAttribute('inert')).toBe(true);
    const on = [...panel.element.querySelectorAll('[data-k^="chip-"][aria-pressed="true"]')];
    expect(on.map((b) => b.getAttribute('data-k'))).toEqual(['chip-ck', 'chip-tb']);
    expect(panel.element.querySelector('[data-k="mode-result"]')!.textContent).toContain(
      'official combo',
    );
  });
});
