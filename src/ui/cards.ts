/**
 * Card names and the ink for a player colour: leaf data the widgets need. Kept out of model.ts,
 * which imports the engine, so the home screen's chunk (main.ts, s17) stays small.
 */
import type { DevCardType } from '../engine';

export const DEV_CARD_INFO: Record<DevCardType, { name: string; blurb: string; icon: string }> = {
  knight: { name: 'Knight', blurb: 'Move the robber and steal a card.', icon: '⚔️' },
  victoryPoint: { name: 'Victory Point', blurb: 'Counts 1 VP. Stays hidden.', icon: '🏆' },
  roadBuilding: { name: 'Road Building', blurb: 'Build 2 roads for free.', icon: '🛣️' },
  yearOfPlenty: {
    name: 'Year of Plenty',
    blurb: 'Take any 2 resources from the bank.',
    icon: '🎁',
  },
  monopoly: { name: 'Monopoly', blurb: 'Take every card of one resource.', icon: '💰' },
};

/** Dark or light text for a player colour (`#rgb` / `#rrggbb`; anything else gets light text). */
export function inkFor(color: string): 'dark' | 'light' {
  const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (!digits) return 'light';
  const hex = digits.length === 3 ? [...digits].map((c) => c + c).join('') : digits;
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  // Perceived luminance (Rec. 709 weights, gamma ignored on purpose: good enough for a choice).
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.62 ? 'dark' : 'light';
}
