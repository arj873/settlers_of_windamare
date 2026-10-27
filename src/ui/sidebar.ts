/** The right sidebar's contents: Game Events (log), Bank and Players. Pure DOM builders. */
import { longestRoadName, type GameState, type PlayerId } from '../engine';
import { h, type Child } from './dom';
import { dieFace, glyph, RESOURCE_LABEL } from './icons';
import { groupLog, type LogToken } from './log';
import { bankView, playerSummaries, type PlayerSummary } from './model';
import type { HudView } from './types';
import { avatar, devCardFace, miniCards, playerName, playerStyle, resCardFace } from './widgets';

const AWARD_LABEL = { longestRoad: 'Longest Road', largestArmy: 'Largest Army' } as const;

function tokenNode(
  state: GameState,
  t: LogToken,
  liveDice: readonly [number, number] | null,
): Child {
  switch (t.kind) {
    case 'text':
      return t.text;
    case 'player':
      return playerName(state.players[t.id]);
    case 'resource':
      return miniCards(t.resource, t.count);
    case 'dice': {
      // The log has both faces since T14. Older saves only have the total: their latest roll
      // borrows the faces from state.dice, earlier ones show the number.
      const faces =
        t.faces ?? (liveDice && liveDice[0] + liveDice[1] === t.total ? liveDice : null);
      return faces
        ? h(
            'span',
            { class: 'log-dice', title: `Rolled ${t.total} (${faces[0]}+${faces[1]})` },
            dieFace(faces[0]),
            dieFace(faces[1]),
          )
        : h('span', { class: 'log-roll', title: `Rolled ${t.total}` }, String(t.total));
    }
    case 'piece':
      return glyph(t.piece, 18, t.piece);
    case 'dev':
      return devCardFace(t.card, 14);
    case 'robber':
      return glyph('robber', 18, 'the robber');
    case 'award':
      return glyph(
        t.award,
        17,
        t.award === 'longestRoad' ? longestRoadName(state) : AWARD_LABEL[t.award],
      );
  }
}

/** Piece icons in a log row take the colour of the row's player. */
function rowColor(state: GameState, player: PlayerId | null): Record<string, string> {
  const color = player === null ? undefined : state.players[player]?.color;
  return color ? { '--pc': color } : {};
}

/**
 * The Game Events list, grouped per turn; newest at the bottom. `viewer` reads the private texts
 * meant for them (#32: "You stole 1 wool from Blue"), marked with a lock.
 */
export function logList(state: GameState, viewer: PlayerId | null = null): HTMLElement {
  const groups = groupLog(state.log, state.players, viewer);
  let lastRoll = -1;
  state.log.forEach((e, i) => {
    if (/ rolled \d+( \(\d\+\d\))?$/.test(e.text)) lastRoll = i;
  });
  return h(
    'div',
    { class: 'log-list', attrs: { role: 'log', 'aria-live': 'polite' } },
    ...groups.map((g) =>
      h(
        'div',
        { class: 'log-group' },
        h('div', { class: 'log-sep' }, h('span', {}, g.turn === 0 ? 'Setup' : `Turn ${g.turn}`)),
        ...g.items.map((item) => {
          if (item.kind === 'production') {
            return h(
              'div',
              { class: 'log-prod' },
              h('div', { class: 'log-prod-title' }, 'Production:'),
              ...item.rows.map((row) =>
                h(
                  'div',
                  { class: 'log-row log-prod-row', style: rowColor(state, row.player) },
                  playerName(state.players[row.player]),
                  ': ',
                  ...row.tokens.map((t) => tokenNode(state, t, null)),
                ),
              ),
            );
          }
          const dice = item.index === lastRoll ? state.dice : null;
          return h(
            'div',
            {
              class: `log-row${item.player === null ? ' is-system' : ''}${item.secret ? ' is-secret' : ''}`,
              style: rowColor(state, item.player),
              ...(item.secret
                ? { attrs: { title: 'Only you and the other player see this' } }
                : {}),
            },
            ...item.tokens.map((t) => tokenNode(state, t, dice)),
          );
        }),
      ),
    ),
  );
}

/** Bank: resource stacks with counts (or hidden counts) and the development deck. */
export function bankPanel(state: GameState): HTMLElement {
  const bank = bankView(state);
  const stack = (face: HTMLElement, count: number | null, label: string) =>
    h(
      'div',
      {
        class: `bank-stack${count === 0 ? ' is-empty' : ''}`,
        title: count === null ? `${label}: hidden` : `${label}: ${count} left`,
      },
      face,
      count !== null && h('span', { class: 'count-badge' }, String(count)),
    );
  return h(
    'div',
    { class: 'bank' },
    ...bank.stacks.map((s) =>
      stack(resCardFace(s.resource, 30), s.count, RESOURCE_LABEL[s.resource]),
    ),
    h('span', { class: 'bank-gap' }),
    stack(devCardFace(null, 30), bank.devDeck, 'Development cards'),
  );
}

function stat(icon: Child, value: number | string, title: string, cls = ''): HTMLElement {
  return h('span', { class: `pstat${cls}`, title }, icon, h('span', {}, String(value)));
}

function playerBar(
  p: PlayerSummary,
  viewer: PlayerId,
  away: boolean,
  roadCard: string,
): HTMLElement {
  const you = p.id === viewer;
  return h(
    'div',
    {
      class: `pp${p.isCurrent ? ' is-current' : ''}${you ? ' is-you' : ''}${p.isActing && !p.isCurrent ? ' is-acting' : ''}${away ? ' is-away' : ''}`,
      style: playerStyle(p.color),
      attrs: { 'data-player': String(p.id) },
    },
    avatar(
      p,
      p.isBot,
      34,
      h('span', { class: 'vp-badge', title: 'Victory points (public)' }, String(p.publicVp)),
    ),
    h(
      'div',
      { class: 'pp-main' },
      h(
        'div',
        { class: 'pp-head' },
        h('span', { class: 'pp-name' }, p.name),
        you && h('span', { class: 'tag' }, 'You'),
        p.isBot && h('span', { class: 'tag tag-bot' }, 'Bot'),
        away &&
          h(
            'span',
            {
              class: 'pp-away',
              title: p.isBot
                ? 'Disconnected: a bot plays until they return'
                : 'Disconnected: a bot takes over if they do not return soon',
            },
            glyph('offline', 15, 'Disconnected'),
          ),
        p.hiddenVp > 0 &&
          h(
            'span',
            { class: 'hidden-vp', title: 'Hidden VP cards (only you see this)' },
            `+${p.hiddenVp} VP`,
          ),
      ),
      h(
        'div',
        { class: 'pp-stats' },
        stat(glyph('cards', 15), p.cards, 'Cards in hand', p.cards > 7 ? ' is-warn' : ''),
        stat(glyph('devCards', 15), p.devCards, 'Development cards'),
        stat(
          glyph('knight', 15),
          p.knights,
          p.largestArmy ? 'Knights played — holds Largest Army (+2 VP)' : 'Knights played',
          p.largestArmy ? ' is-award' : '',
        ),
        stat(
          glyph('road', 15),
          p.roadLength,
          p.longestRoad ? `Longest road — holds ${roadCard} (+2 VP)` : 'Longest road',
          p.longestRoad ? ' is-award' : '',
        ),
      ),
    ),
    h(
      'div',
      { class: 'pp-awards' },
      p.longestRoad && glyph('longestRoad', 20, roadCard),
      p.largestArmy && glyph('largestArmy', 20, 'Largest Army'),
    ),
  );
}

/** One coloured bar per player (compact from 5 players on). */
export function playersList(state: GameState, view: HudView): HTMLElement {
  const list = playerSummaries(state, view.viewer, view.bots ?? []);
  return h(
    'div',
    { class: `hud-players${list.length > 4 ? ' is-compact' : ''}` },
    ...list.map((p) =>
      playerBar(p, view.viewer, view.away?.[p.id] === true, longestRoadName(state)),
    ),
  );
}
