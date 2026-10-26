/**
 * Bot difficulty levels (B1), chosen per bot seat on the setup screen and in the online lobby.
 * Easy is the random bot every sim and fuzz test uses (unchanged); Normal and Hard are the
 * heuristic bots of src/bots/smart.
 */
import { createRandomBot, type Bot } from './index';
import { hardBot, normalBot } from './smart';

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

/** The random bot nudged to make progress (the pre-B1 default bot). */
export const easyBot: Bot = createRandomBot({ progressBias: 0.5 });

const BOTS: Record<BotLevel, Bot> = { easy: easyBot, normal: normalBot, hard: hardBot };

export function botForLevel(level: BotLevel): Bot {
  return BOTS[level];
}
