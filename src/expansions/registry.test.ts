/**
 * Registry consistency for every built-in expansion (runs for new modules automatically):
 * unique and namespaced ids, resolvable modes, generatable scenario maps, matching layer
 * registries, and no import-cycle trouble when a module is the first thing imported.
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PLAYER_COLORS,
  allModules,
  createGame,
  generateBoard,
  isBoardVertex,
  isLandHex,
  listModes,
  mapDef,
  modeById,
  Rng,
  scenarioById,
  topologyFor,
} from '../engine';
import { BOT_EXTENSIONS } from '../bots/expansions';
import { HUD_EXTENSIONS } from '../ui/expansions';

const folders = readdirSync(__dirname, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

describe('expansion registry', () => {
  it('lists one engine module per folder in src/expansions, with the folder name as id', () => {
    expect(
      allModules()
        .map((m) => m.id)
        .sort(),
    ).toEqual([...folders].sort());
  });

  it('a module can be the first import of a fresh module graph (import-cycle rule)', async () => {
    for (const dir of folders) {
      vi.resetModules();
      const mod = (await import(join(__dirname, dir, 'engine', 'index.ts'))) as Record<
        string,
        unknown
      >;
      expect(Object.keys(mod).length, dir).toBeGreaterThan(0);
      const engine = await import('../engine');
      expect(engine.expansionById(dir)?.id).toBe(dir);
    }
  });

  it('has unique ids, namespaced by their module', () => {
    const seen = new Set<string>();
    const unique = (id: string) => {
      expect(seen.has(id), `duplicate id ${id}`).toBe(false);
      seen.add(id);
    };
    for (const m of allModules()) {
      expect(m.id).not.toContain('/');
      unique(`module:${m.id}`);
      for (const s of m.scenarios ?? []) {
        expect(s.id.startsWith(`${m.id}/`), s.id).toBe(true);
        unique(`scenario:${s.id}`);
      }
      for (const d of m.maps ?? []) {
        expect(d.id.startsWith(`${m.id}/`), d.id).toBe(true);
        unique(`map:${d.id}`);
      }
      for (const t of Object.keys(m.terrains ?? {})) expect(t.startsWith(`${m.id}/`), t).toBe(true);
      for (const type of Object.keys(m.actions ?? {})) {
        expect(type.startsWith(`${m.id}/`), type).toBe(true);
      }
    }
    for (const mode of listModes()) unique(`mode:${mode.id}`);
  });

  it('every mode resolves: its expansions, scenarios and maps exist and a game starts', () => {
    for (const mode of listModes()) {
      for (const id of mode.expansions)
        expect(
          allModules().some((m) => m.id === id),
          id,
        ).toBe(true);
      for (const id of mode.scenarios) {
        const s = scenarioById(id);
        expect(s, id).toBeDefined();
        for (const map of s?.maps ?? []) expect(mapDef(map), map).toBeDefined();
      }
      const n = mode.players.min;
      const s = createGame({ seed: 1, players: PLAYER_COLORS.slice(0, n), mode: mode.id });
      expect(modeById(s.settings.mode)).toBe(mode);
      expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    }
  });

  it('every module map generates a full, consistent board for each player count', () => {
    for (const m of allModules()) {
      for (const def of m.maps ?? []) {
        const t = topologyFor(def.id);
        for (let n = def.minPlayers; n <= def.maxPlayers; n++) {
          const { board, robber } = generateBoard(def.id, Rng.fromSeed(`check:${n}`), n);
          expect(Object.keys(board.hexes).sort(), def.id).toEqual([...t.landHexes].sort());
          expect(isLandHex(t, robber) || robber === 'h:999,999', def.id).toBe(true);
          for (const p of board.ports)
            for (const v of p.vertices) expect(isBoardVertex(t, v)).toBe(true);
        }
      }
    }
  });

  it('HUD and bot extensions belong to known modules (render drawers: same rule, see BOARD_DRAWERS)', () => {
    const ids = new Set(allModules().map((m) => m.id));
    for (const x of [...HUD_EXTENSIONS, ...BOT_EXTENSIONS]) expect(ids.has(x.id), x.id).toBe(true);
  });
});
