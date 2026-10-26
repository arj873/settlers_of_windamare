/** The bot of each difficulty level (levels.ts). */
import { createRandomBot, type Bot } from './index';
import { DEFAULT_BOT_LEVEL, type BotLevel } from './levels';
import { hardBot, normalBot } from './smart';

/** Easy: the random bot nudged to make progress (the pre-B1 default bot). */
export const easyBot: Bot = createRandomBot({ progressBias: 0.5 });

const BOTS: Record<BotLevel, Bot> = { easy: easyBot, normal: normalBot, hard: hardBot };

export function botForLevel(level: BotLevel = DEFAULT_BOT_LEVEL): Bot {
  return BOTS[level];
}
