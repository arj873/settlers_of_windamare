/**
 * Tests (and e2e scripts in spirit): pick a registry mode on a rendered setup screen the way a
 * player does, by clicking expansion chips and then the mode's first scenario tile.
 */
import { modeById } from '../../engine';
import { modeChips } from './modePicker';

const button = (root: ParentNode, k: string) =>
  root.querySelector<HTMLButtonElement>(`[data-k="${k}"]`);

/** Click chips (then the scenario tile) until `modeId` is selected. False if the UI can't. */
export function pickMode(root: ParentNode, modeId: string): boolean {
  const mode = modeById(modeId);
  if (!mode) return false;
  const want = modeChips(mode);
  const pressed = () =>
    [...root.querySelectorAll<HTMLButtonElement>('[data-k^="chip-"][aria-pressed="true"]')].map(
      (b) => (b.getAttribute('data-k') ?? '').slice('chip-'.length),
    );
  for (let guard = 0; guard < 32; guard++) {
    const on = pressed();
    const extra = on.find((id) => !want.includes(id));
    const missing = want.filter((id) => !on.includes(id));
    if (extra === undefined && missing.length === 0) break;
    // Drop extras first; then add any missing chip the current selection accepts.
    const next =
      (extra !== undefined ? button(root, `chip-${extra}`) : null) ??
      missing.map((id) => button(root, `chip-${id}`)).find((b) => b && !b.disabled);
    if (!next || next.disabled) return false;
    next.click();
  }
  const first = mode.scenarios[0];
  if (first === undefined) return pressed().length === 0;
  const tile = root.querySelector<HTMLButtonElement>(
    `[data-mode="${modeId}"][data-scenario="${first}"]`,
  );
  if (!tile) return false;
  tile.click();
  return true;
}
