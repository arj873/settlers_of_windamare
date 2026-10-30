// @vitest-environment jsdom
/** C&K cards in the hand bar (#cardinfo): one card per progress card kind, with the info card. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGame, legalActions, type Action, type GameState } from '../../engine';
import { Hud } from '../../ui/hud';
import { CARD_TEXT, CK, ckSlice } from './engine';
import { V, build, giveCards, setGoods } from './engine/testkit';
import { COMMODITY_TEXT } from './hand';

const seats = ['A', 'B', 'C', 'D'].map((name, i) => ({ name, color: `#20202${i}` }));

/** Player 0's turn in `kind` (main: after the roll). */
function game(kind: 'main' | 'preRoll' = 'main'): GameState {
  const s = createGame({ seed: 4, players: seats, mode: CK, scenario: 'ck/starter' });
  s.turn = { number: 3, current: 0, devCardPlayed: false, tradeOffers: 0 };
  s.phase = { kind };
  return s;
}

let root: HTMLElement;
let hud: Hud;
let actions: Action[];

beforeEach(() => {
  root = document.createElement('div');
  document.body.replaceChildren(root);
  hud = new Hud(root);
  actions = [];
  hud.on('action', (a) => actions.push(a));
});

afterEach(() => hud.destroy());

const show = (s: GameState, viewer = 0) =>
  hud.render(s, { viewer, legal: legalActions(s), isBotTurn: false });
const card = (key: string) =>
  root.querySelector<HTMLButtonElement>(`.hud-bottom .hcard[data-info="${key}"]`)!;
const infoText = () => root.querySelector('.hud-pop-layer .dev-info')?.textContent ?? '';

describe('C&K hand cards', () => {
  it("off-turn: a progress card opens its own text and why it can't be played, never an action", () => {
    const s = game();
    giveCards(s, 1, 'spy', 'warlord');
    show(s, 1);
    const spy = card('ck/spy');
    expect(spy.getAttribute('aria-disabled')).toBe('true');
    expect(spy.classList.contains('is-off')).toBe(true);
    expect(spy.getAttribute('aria-label')).toBe("Spy ×1, can't play now");
    spy.click();
    expect(actions).toEqual([]);
    expect(infoText()).toContain('Spy');
    expect(infoText()).toContain(CARD_TEXT.spy);
    expect(infoText()).toContain('Not your turn. You can play this on your turn, after you roll.');
    card('ck/warlord').click(); // switches to the other card
    expect(infoText()).toContain(CARD_TEXT.warlord);
    expect(infoText()).not.toContain(CARD_TEXT.spy);
  });

  it('a playable card plays on click; right-click shows it first', () => {
    const s = game();
    giveCards(s, 0, 'spy', 'engineer');
    giveCards(s, 2, 'crane'); // someone to spy on
    show(s);
    const spy = card('ck/spy');
    expect(spy.classList.contains('can-play')).toBe(true);
    spy.dispatchEvent(new Event('contextmenu', { bubbles: true, cancelable: true }));
    expect(infoText()).toContain('Playable now: click the card to play it.');
    expect(actions).toEqual([]);
    card('ck/spy').click();
    expect(actions).toEqual([{ type: 'ck/play', player: 0, card: 'spy' }]);

    // The Engineer has nothing to do without a city: the line says why (CK-53).
    card('ck/engineer').click();
    expect(infoText()).toContain('Not now: it would have no effect (no city can take a wall).');
    expect(actions).toHaveLength(1);
  });

  it('before the roll: the Alchemist opens its dice dialog; other cards wait for the roll', () => {
    const s = game('preRoll');
    giveCards(s, 0, 'alchemist', 'spy');
    show(s);
    card('ck/spy').click();
    expect(infoText()).toContain('Roll the dice first');
    const alchemist = card('ck/alchemist');
    expect(alchemist.classList.contains('can-play')).toBe(true);
    alchemist.click();
    const dialog = root.querySelector<HTMLElement>('.hud-dialog-layer .dialog')!;
    expect(dialog.getAttribute('aria-label')).toBe('Alchemist');
    const [yellow, red] = dialog.querySelectorAll<HTMLSelectElement>('select');
    yellow!.value = '6';
    yellow!.dispatchEvent(new Event('change'));
    red!.value = '2';
    red!.dispatchEvent(new Event('change'));
    show(s); // a re-render keeps the picked dice
    const again = root.querySelector<HTMLElement>('.hud-dialog-layer .dialog')!;
    expect([...again.querySelectorAll('select')].map((x) => x.value)).toEqual(['6', '2']);
    [...again.querySelectorAll('button')].find((b) => b.textContent === 'Play')!.click();
    expect(actions).toEqual([{ type: 'ck/alchemist', player: 0, yellow: 6, red: 2 }]);
  });

  it('the Alchemist after the roll, and Cancel closes its dialog', () => {
    const s = game('preRoll');
    giveCards(s, 0, 'alchemist');
    show(s);
    card('ck/alchemist').click();
    [...root.querySelectorAll<HTMLButtonElement>('.hud-dialog-layer button')]
      .find((b) => b.textContent === 'Cancel')!
      .click();
    expect(root.querySelector('.hud-dialog-layer .dialog')).toBeNull();
    s.phase = { kind: 'main' };
    show(s);
    card('ck/alchemist').click();
    expect(infoText()).toContain(
      'The dice are rolled this turn: play the Alchemist before you roll, on a later turn.',
    );
    expect(actions).toEqual([]);
  });

  it('the hand limit shows on every progress card', () => {
    const s = game();
    giveCards(s, 0, 'spy', 'spy', 'crane', 'warlord', 'smith');
    show(s);
    card('ck/smith').click();
    expect(infoText()).toContain(
      'You hold 5 progress cards, the limit is 4: play or discard down to 4 before you end your turn.',
    );
    expect(card('ck/spy').querySelector('.count-badge')?.textContent).toBe('2');
  });

  it('commodities say what they are for and never act', () => {
    const s = game();
    build(s, 0, V(0, 0, 'S'), 'city');
    setGoods(s, 0, { cloth: 2 });
    show(s);
    const cloth = card('ck/cloth');
    expect(cloth.hasAttribute('aria-disabled')).toBe(false);
    expect(cloth.title).toBe('Cloth: 2');
    expect(cloth.dataset.card).toBe('cloth'); // the production animation lands here
    cloth.click();
    expect(infoText()).toContain(COMMODITY_TEXT.cloth);
    expect(infoText()).toContain('At the bank you give 4 for 1 card now.');
    expect(card('ck/cloth').getAttribute('aria-expanded')).toBe('true');
    expect(actions).toEqual([]);
    expect(ckSlice(s).players[0]?.commodities.cloth).toBe(2);
  });

  it('the open card closes when the card is played away', () => {
    const s = game();
    giveCards(s, 1, 'spy');
    show(s, 1);
    card('ck/spy').click();
    expect(infoText()).toContain('Spy');
    ckSlice(s).players[1]!.progress = [];
    show(s, 1);
    expect(root.querySelector('.hud-pop-layer .dev-info')).toBeNull();
  });
});
