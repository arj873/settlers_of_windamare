/**
 * Bot difficulty levels (B1), chosen per bot seat on the setup screen and in the online lobby.
 * Easy is the random bot every sim and fuzz test uses (unchanged); Normal and Hard are the
 * heuristic bots of src/bots/smart. No imports: the UI and the protocol use these too.
 * The bots themselves: `botForLevel` (byLevel.ts).
 */
export type BotLevel = 'easy' | 'normal' | 'hard';

export const BOT_LEVELS: readonly BotLevel[] = ['easy', 'normal', 'hard'];

export const DEFAULT_BOT_LEVEL: BotLevel = 'normal';

export const BOT_LEVEL_LABELS: Record<BotLevel, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
};

export function isBotLevel(x: unknown): x is BotLevel {
  return typeof x === 'string' && (BOT_LEVELS as readonly string[]).includes(x);
}
