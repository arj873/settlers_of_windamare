// In-page scanner for the playtest harness. Injected with Playwright's addInitScript and called
// as `window.__pt.snapshot()`. Plain browser JS (no imports, no build step). Read-only, except
// that it tags the buttons it reports with `data-pt` so the server can click them by id.
// Output shape: `Snapshot` in protocol.ts.
(() => {
  const clean = (s) =>
    s
      .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  /**
   * Visible text of an element, separate spans joined by spaces. Icons (`role="img"`) count as
   * their aria-label ("Brick"), so "🧱×1" reads "Brick ×1". Adjacent repeats are dropped
   * ("Brick Brick 4:1" -> "Brick 4:1").
   */
  const text = (el) => {
    if (!el) return '';
    const parts = [];
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = clean(node.textContent || '');
        if (t) parts.push(t);
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      // Hover-only extras (e.g. the cost cards on build buttons) are not part of the label.
      if (node !== el && node.getAttribute('aria-hidden') === 'true') return;
      if (node.getAttribute('role') === 'img' && node.getAttribute('aria-label')) {
        parts.push(node.getAttribute('aria-label'));
        return;
      }
      for (const child of node.childNodes) walk(child);
    };
    walk(el);
    return parts.filter((p, i) => p !== parts[i - 1]).join(' ');
  };

  const visible = (el) => {
    if (!el || el.getClientRects().length === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
  };

  /** The nearest preceding `p.sub` heading among the element's ancestors' siblings. */
  const sectionOf = (el, stop) => {
    for (let node = el; node && node !== stop; node = node.parentElement) {
      for (let sib = node.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.matches('p.sub')) return text(sib);
      }
    }
    return '';
  };

  const shortSection = (s) => {
    const t = s.replace(/^you\s+/i, '').replace(/^offer\s+/i, '');
    return t.length > 0 && t.length <= 12 ? t : '';
  };

  let seq = 0;
  const tag = (el, prefix) => {
    const id = `${prefix}${++seq}`;
    el.setAttribute('data-pt', id);
    return id;
  };

  function labelFor(btn, dialog) {
    const own = btn.getAttribute('aria-label') || text(btn) || btn.getAttribute('title') || '?';
    const resp = btn.closest('.resp');
    if (resp) return `${text(resp.querySelector('.resp-name'))}: ${own}`;
    if (dialog && (btn.closest('.rpick') || btn.closest('.recipients'))) {
      const sec = shortSection(sectionOf(btn, dialog));
      if (sec) return `${sec}: ${own}`;
    }
    return own;
  }

  function scan() {
    seq = 0;
    for (const el of document.querySelectorAll('[data-pt]')) el.removeAttribute('data-pt');
    const dialog =
      [...document.querySelectorAll('.hud-dialog-layer .dialog')].find(visible) || null;

    const cover = document.querySelector('.cover h1');
    const winner = document.querySelector('.winner-card h1');
    const screen = document.querySelector('.newgame')
      ? 'newGame'
      : document.querySelector('.game-resume')
        ? 'resume'
        : winner
          ? 'winner'
          : null;

    const controls = [];
    for (const btn of document.querySelectorAll('button')) {
      if (!visible(btn) || btn.classList.contains('btn-round')) continue;
      controls.push({
        id: tag(btn, 'b'),
        label: labelFor(btn, dialog),
        enabled: !btn.disabled,
        on: btn.classList.contains('is-on') || btn.classList.contains('is-selected'),
        inDialog: !!(dialog && dialog.contains(btn)),
        why: btn.getAttribute('data-why'),
      });
    }

    const steppers = [];
    for (const step of document.querySelectorAll('.step')) {
      if (!visible(step)) continue;
      const name = text(step.querySelector('.step-name'));
      const sec = shortSection(sectionOf(step, dialog));
      const [dec, inc] = step.querySelectorAll('.step-ctl button');
      steppers.push({
        label: sec ? `${sec} ${name}` : name,
        value: Number(text(step.querySelector('.step-val'))) || 0,
        decId: dec ? tag(dec, 's') : null,
        incId: inc ? tag(inc, 's') : null,
        canDec: !!dec && !dec.disabled,
        canInc: !!inc && !inc.disabled,
      });
    }

    const dialogText = dialog
      ? [...dialog.querySelectorAll('p:not(.sub), .offer-line, .resp')]
          .filter(visible)
          .map(text)
          .filter(Boolean)
      : [];

    let hand = null;
    const cards = document.querySelectorAll('.hud-bottom .rcard');
    if (cards.length > 0) {
      hand = {};
      for (const c of cards) {
        hand[text(c.querySelector('.rc-name')).toLowerCase()] = Number(
          text(c.querySelector('.rc-count')),
        );
      }
    }

    const stat = (pp, title) => {
      const el = pp.querySelector(`.pp-stats [title="${title}"]`);
      return el ? Number(text(el).replace(/[^0-9]/g, '')) : 0;
    };
    const panels = [...document.querySelectorAll('.hud-players .pp')].map((pp) => ({
      name: text(pp.querySelector('.pp-name')),
      vp: Number(text(pp.querySelector('.pp-vp')).replace(/[^0-9]/g, '')),
      cards: stat(pp, 'Resource cards in hand'),
      dev: stat(pp, 'Development cards'),
      knights: stat(pp, 'Knights played'),
    }));

    const total = document.querySelector('.dice-total');
    // Turn pill (T17): title, hint and the T14 turn timer.
    const hint = document.querySelector('.hud-turn .hint');
    const title = document.querySelector('.hud-turn .turn-title');
    const timer = document.querySelector('.hud-turn .turn-timer');
    return {
      cover: cover && visible(cover) ? text(cover) : null,
      screen,
      winnerText: winner ? text(winner) : null,
      hint: hint ? text(hint) : null,
      turnTitle: title ? text(title) : null,
      timer: timer ? text(timer) : null,
      timerLow: !!timer && timer.classList.contains('is-low'),
      dialogTitle: dialog ? text(dialog.querySelector('h2')) : null,
      dialogText,
      controls,
      steppers,
      toasts: [...document.querySelectorAll('.game-toast:not(.is-leaving)')].map(text),
      hand,
      panels,
      diceTotal: total ? Number(text(total)) : null,
    };
  }

  function snapshot() {
    const dbg = window.__catanDebug;
    return {
      state: dbg ? dbg.state() : null,
      viewer: dbg ? dbg.viewer() : null,
      legal: dbg ? dbg.legal() : [],
      targets: dbg ? dbg.boardTargets() : [],
      ui: scan(),
      consoleCount: dbg ? dbg.consoleErrors().length : 0,
    };
  }

  /** What is on top at a page point: 'canvas' or a short description of the covering element. */
  function topAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'nothing (off-screen)';
    if (el.tagName === 'CANVAS') return 'canvas';
    const cls = typeof el.className === 'string' ? el.className : '';
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls.split(/\s+/).join('.') : ''} "${text(el).slice(0, 40)}"`;
  }

  window.__pt = { snapshot, topAt };
})();
