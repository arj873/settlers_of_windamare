/**
 * Card names and the ink for a player colour: leaf data the widgets need. Kept out of model.ts,
 * which imports the engine, so the home screen's chunk (main.ts, s17) stays small.
 */
import type { DevCardType } from '../engine';

/** `blurb`: one short line; `text`: what the card does in plain words (the hand's info card). */
export const DEV_CARD_INFO: Record<
  DevCardType,
  { name: string; blurb: string; text: string; icon: string }
> = {
  knight: {
    name: 'Knight',
    blurb: 'Move the robber and steal a card.',
    text: 'Move the robber to another hex, then steal 1 random resource card from a player with a settlement or city next to it. Played Knights stay in front of you and count toward Largest Army.',
    icon: '⚔️',
  },
  victoryPoint: {
    name: 'Victory Point',
    blurb: 'Counts 1 VP. Stays hidden.',
    text: 'Worth 1 victory point for as long as you hold it, even on the turn you buy it. You never play it.',
    icon: '🏆',
  },
  roadBuilding: {
    name: 'Road Building',
    blurb: 'Build 2 roads for free.',
    text: 'Place 2 roads for free, following the normal building rules.',
    icon: '🛣️',
  },
  yearOfPlenty: {
    name: 'Year of Plenty',
    blurb: 'Take any 2 resources from the bank.',
    text: 'Take any 2 resource cards from the bank: two of the same kind or two different ones.',
    icon: '🎁',
  },
  monopoly: {
    name: 'Monopoly',
    blurb: 'Take every card of one resource.',
    text: 'Name one resource. Every other player gives you all of their cards of that resource.',
    icon: '💰',
  },
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
