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
    let own = btn.getAttribute('aria-label') || text(btn) || btn.getAttribute('title') || '?';
    // A tooltip that names the button's row ("Buy for 2 gold (2 left): Lumber") says more.
    const title = clean(btn.getAttribute('title') || '');
    if (title.length > own.length && title.endsWith(`: ${own}`)) own = title;
    const resp = btn.closest('.resp');
    if (resp) return `${text(resp.querySelector('.resp-name'))}: ${own}`;
    if (dialog && (btn.closest('.rpick') || btn.closest('.recipients'))) {
      const sec = shortSection(sectionOf(btn, dialog));
      if (sec) return `${sec}: ${own}`;
    }
    return own;
  }

  const BLOCK = new Set([
    'DIV',
    'P',
    'LI',
    'UL',
    'OL',
    'SECTION',
    'HEADER',
    'H1',
    'H2',
    'H3',
    'H4',
    'TR',
    'TABLE',
    'FORM',
  ]);

  /**
   * An element's text as lines (one per block element), icons as their labels, buttons left out
   * (`status` lists them). Works on collapsed sections too (no layout needed).
   */
  function blockLines(root) {
    const lines = [];
    let cur = [];
    const flush = () => {
      const t = cur.join(' ').replace(/\s+/g, ' ').trim();
      if (t) lines.push(t);
      cur = [];
    };
    const walk = (node) => {
      for (const ch of node.childNodes) {
        if (ch.nodeType === Node.TEXT_NODE) {
          const t = clean(ch.textContent || '');
          if (t) cur.push(t);
          continue;
        }
        if (ch.nodeType !== Node.ELEMENT_NODE) continue;
        if (ch.hidden || ch.getAttribute('aria-hidden') === 'true') continue;
        if (ch.tagName === 'BUTTON' || ch.tagName === 'SELECT' || ch.tagName === 'INPUT') continue;
        if (ch.getAttribute('role') === 'img') {
          const l = ch.getAttribute('aria-label') || ch.getAttribute('title');
          if (l) cur.push(l);
          continue;
        }
        const block = BLOCK.has(ch.tagName);
        if (block) flush();
        // A short titled number ("0 /2" titled "Knights") keeps its meaning: "Knights 0 /2".
        const title = clean(ch.getAttribute('title') || '');
        const before = cur.length;
        walk(ch);
        const got = cur.slice(before).join(' ');
        if (title && /\d/.test(got) && got.length <= 14 && !got.includes(title)) {
          // "2 of 3 ships in supply" over "2"; else "Knights: 0 /2".
          cur.splice(before, cur.length - before, title.includes(got) ? title : `${title}: ${got}`);
        }
        if (block) flush();
      }
    };
    walk(root);
    flush();
    return lines;
  }

  /** Expansion sidebar sections (gold, commodities, knights, wagons...) as text lines. */
  function extPanels() {
    return [...document.querySelectorAll('.side-sec.sec-ext')].map((sec) => ({
      title: text(sec.querySelector('.sec-head h2')),
      lines: blockLines(sec.querySelector('.sec-body') || sec).slice(0, 30),
    }));
  }

  /** Hand-bar cards that are not base resources (C&K commodities, progress / journey cards). */
  function handExtras() {
    const out = [];
    for (const c of document.querySelectorAll('.hud-bottom .hcard')) {
      if (c.querySelector('.rc-name')) continue;
      const label = clean(c.getAttribute('title') || c.getAttribute('aria-label') || '');
      // Base resource cards are already the Hand line.
      if (label && !/^(brick|lumber|wool|grain|ore)\b/i.test(label)) out.push(label);
    }
    return out;
  }

  /** The name of a button's list row: the row's text before its first button ("Ship 1"). */
  function rowName(btn) {
    const row = btn.closest('li, tr');
    if (!row) {
      // Outside a list: the sidebar section it sits in ("Cities & Knights: Trade").
      const sec = btn.closest('.side-sec');
      return sec ? text(sec.querySelector('.sec-head h2')) : '';
    }
    const parts = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.querySelector('button')) return false;
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName === 'BUTTON') return false;
        const t =
          child.nodeType === Node.ELEMENT_NODE ? text(child) : clean(child.textContent || '');
        if (t) parts.push(t);
      }
      return true;
    };
    walk(row);
    return parts.join(' ').slice(0, 40);
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
        actions: btn.hasAttribute('data-actions')
          ? btn.getAttribute('data-actions').split(' ').filter(Boolean)
          : null,
        el: btn,
      });
    }
    // Same label twice ("Select", "Select"): name each by its row ("Ship 1: Select").
    const byLabel = new Map();
    for (const c of controls) byLabel.set(c.label, (byLabel.get(c.label) || 0) + 1);
    for (const c of controls) {
      if (byLabel.get(c.label) > 1) {
        const ctx = rowName(c.el);
        if (ctx) c.label = `${ctx}: ${c.label}`;
      }
      delete c.el;
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

    // Module steppers (C&K / T&B dialogs): a "less X" / "more X" button pair around the count.
    for (const less of document.querySelectorAll('button[aria-label^="less "]')) {
      if (!visible(less)) continue;
      const name = less.getAttribute('aria-label').slice(5);
      const box = less.parentElement;
      const more = box && box.querySelector(`button[aria-label="more ${CSS.escape(name)}"]`);
      if (!more) continue;
      const count = [...box.children].find((c) => c.tagName !== 'BUTTON' && /^\d+$/.test(text(c)));
      steppers.push({
        label: name,
        value: count ? Number(text(count)) : 0,
        decId: tag(less, 's'),
        incId: tag(more, 's'),
        canDec: !less.disabled,
        canInc: !more.disabled,
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
      vp: Number(text(pp.querySelector('.vp-badge, .pp-vp')).replace(/[^0-9]/g, '')),
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
      handExtras: handExtras(),
      panels,
      extPanels: extPanels(),
      diceTotal: total ? Number(text(total)) : null,
    };
  }

  // ---- online intents: what this page sent and what the server refused --------------------
  // The one place the harness touches the app: it wraps RoomClient.intent to count the moves a
  // click sent, so acting commands can wait for the server's answer (OnlineScan.sent / errors).
  let sent = 0;
  let lastSent = null;
  const errors = [];
  let errorCount = 0;
  let watched = null;
  function watchClient(c) {
    if (watched === c) return;
    watched = c;
    const intent = c.intent.bind(c);
    c.intent = (action) => {
      const ok = intent(action);
      if (ok) {
        sent++;
        lastSent = action.type;
      }
      return ok;
    };
    c.on((e) => {
      if (e.type !== 'error') return;
      errors.push({ n: ++errorCount, code: e.code, message: e.message });
      if (errors.length > 20) errors.shift();
    });
  }

  /** Online pages: connection and room facts from the page's RoomClient (see OnlineScan). */
  function onlineScan() {
    const c = window.catan && window.catan.online && window.catan.online.roomClient;
    if (!c) return null;
    watchClient(c);
    const room = c.room;
    const members = new Map(((room && room.members) || []).map((m) => [m.id, m]));
    const banner = document.querySelector('.conn-banner:not([hidden])');
    const notice = document.querySelector('.online-screen .ol-home-card');
    return {
      room: window.catan.online.roomId,
      status: c.status,
      attempts: c.attempts,
      seq: c.game ? c.game.seq : null,
      roomPhase: room ? room.phase : null,
      fatal: c.fatal ? { code: c.fatal.code, message: c.fatal.message } : null,
      seats: ((room && room.seats) || []).map((s) => {
        const who = s.occupant !== null && members.get(s.occupant);
        return `${s.index + 1} ${who ? who.name : s.color} ${s.status}`;
      }),
      chat: c.chat.slice(-8).map((e) => ({ id: e.id, line: `${e.name || 'room'}: ${e.text}` })),
      timerLeftMs: c.game && c.game.timer ? c.timerLeftMs() : null,
      sent,
      lastSent,
      errors: errors.slice(-5),
      banner: banner ? text(banner) : null,
      notice: notice ? text(notice).slice(0, 200) : null,
    };
  }

  function snapshot() {
    const dbg = window.__catanDebug;
    return {
      online: onlineScan() || undefined,
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

  /**
   * Where to click the button tagged `id` (from the last scan): its centre, scrolled into view,
   * and whether that point really hits it. Null when the element is gone (the HUD re-rendered).
   */
  function pointFor(id) {
    const el = document.querySelector(`[data-pt="${id}"]`);
    if (!el || !el.isConnected) return null;
    const at = () => {
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return { x, y, ok: !!hit && (hit === el || el.contains(hit)) };
    };
    let p = at();
    // Off-screen, or clipped by a scrolling panel (a long sidebar section): scroll, like a player.
    if (!p.ok) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      p = at();
    }
    return { ...p, cover: p.ok ? null : topAt(p.x, p.y) };
  }

  // ---- still board (headless sessions) ------------------------------------------------------
  // The board draws only when something changed or moves (BoardView). Headless Chromium has no
  // GPU, so each frame is drawn in software (~1.5 cores per page) and every Playwright call to
  // the page waits on it. `renderOnDemand()` also stops the motion (`setAnimated(false)`):
  // highlights hold still instead of pulsing, pop-ins and robber moves jump to their end.
  let onDemand = false;
  function appOf() {
    const b = window.catan && window.catan.board;
    return b && b.app && b.app.ticker ? b.app : null;
  }
  /** Draw one frame now. */
  function render() {
    const app = appOf();
    if (!app) return false;
    app.ticker.update();
    return true;
  }
  function renderOnDemand() {
    if (onDemand) return;
    onDemand = true;
    const still = () => {
      const b = window.catan && window.catan.board;
      if (!b) return setTimeout(still, 200);
      b.setAnimated(false);
    };
    still();
  }

  window.__pt = { snapshot, topAt, pointFor, render, renderOnDemand };
})();
