/** Small DOM pieces the controller owns: toasts, the resume prompt, bot-speed presets (HUD menu). */
import type { ToastKind } from './controller';
import './game.css';

let toastBox: HTMLElement | null = null;

export function showToast(message: string, kind: ToastKind = 'info', ms = 4000): void {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = document.createElement('div');
    toastBox.className = 'game-toasts';
    toastBox.setAttribute('role', 'status');
    document.body.append(toastBox);
  }
  const el = document.createElement('div');
  el.className = `game-toast is-${kind}`;
  el.textContent = message;
  toastBox.append(el);
  setTimeout(() => el.classList.add('is-leaving'), ms);
  setTimeout(() => el.remove(), ms + 400);
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

/** Full-screen "Resume / New game" prompt shown on load when an unfinished save exists. */
export function showResumePrompt(info: string, onResume: () => void, onNew: () => void): void {
  const wrap = document.createElement('div');
  wrap.className = 'catan-hud';
  const screen = document.createElement('div');
  screen.className = 'game-resume';
  screen.style.pointerEvents = 'auto';
  const card = document.createElement('div');
  card.className = 'game-resume-card';
  const logo = document.createElement('div');
  logo.className = 'logo';
  logo.textContent = '⬡';
  const title = document.createElement('h1');
  title.textContent = 'Welcome back';
  const sub = document.createElement('p');
  sub.textContent = info;
  const actions = document.createElement('div');
  actions.className = 'game-resume-actions';
  const close = (then: () => void) => () => {
    wrap.remove();
    then();
  };
  actions.append(
    button('New game', 'btn btn-ghost btn-lg', close(onNew)),
    button('Resume', 'btn btn-primary btn-lg', close(onResume)),
  );
  card.append(logo, title, sub, actions);
  screen.append(card);
  wrap.append(screen);
  document.body.append(wrap);
}

export const SPEED_PRESETS: { label: string; ms: number }[] = [
  { label: 'Slow', ms: 1200 },
  { label: 'Normal', ms: 500 },
  { label: 'Fast', ms: 150 },
  { label: 'Instant', ms: 0 },
];
