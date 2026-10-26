/** Bot difficulty picker (B1): one per bot seat on the setup screen and in the online lobby. */
import { BOT_LEVELS, BOT_LEVEL_LABELS, DEFAULT_BOT_LEVEL, type BotLevel } from '../bots/levels';
import { h } from './dom';

export const BOT_LEVEL_HINTS: Record<BotLevel, string> = {
  easy: 'Plays random legal moves',
  normal: 'Plays a reasonable game',
  hard: 'Plans ahead, guards against the leader',
};

export interface BotLevelSelectOptions {
  /** Keep the slot (row alignment) but show nothing: a human seat. */
  hidden?: boolean;
  disabled?: boolean;
  /** For `data-k` / labels: the seat number shown to people (0-based index). */
  seat: number;
  /** `data-k` prefix (default 'level'): `<prefix>-<seat>`. */
  key?: string;
}

/** A `<select>` of the levels; `onChange` gets the picked one. */
export function botLevelSelect(
  level: BotLevel | undefined,
  opts: BotLevelSelectOptions,
  onChange: (level: BotLevel) => void,
): HTMLSelectElement {
  const value = level ?? DEFAULT_BOT_LEVEL;
  return h(
    'select',
    {
      class: `input bot-level${opts.hidden ? ' is-hidden' : ''}`,
      title: BOT_LEVEL_HINTS[value],
      attrs: {
        'aria-label': `Seat ${opts.seat + 1} bot difficulty`,
        'data-k': `${opts.key ?? 'level'}-${opts.seat}`,
        ...(opts.disabled || opts.hidden ? { disabled: '' } : {}),
        ...(opts.hidden ? { 'aria-hidden': 'true', tabindex: '-1' } : {}),
      },
      on: {
        change: (e) => {
          const raw = (e.target as HTMLSelectElement).value;
          const picked = BOT_LEVELS.find((l) => l === raw);
          if (picked) onChange(picked);
        },
      },
    },
    ...BOT_LEVELS.map((l) =>
      h(
        'option',
        { attrs: { value: l, ...(l === value ? { selected: '' } : {}) } },
        BOT_LEVEL_LABELS[l],
      ),
    ),
  );
}
