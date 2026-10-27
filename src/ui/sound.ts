/**
 * Sound settings widget (A1): mute toggle + master volume slider for the HUD menu and (compact)
 * the setup footer. Reads and writes the page's SoundEngine (`sfx`), which saves the settings.
 */
import { sfx, type SoundEngine } from '../audio';
import { h } from './dom';
import './sound.css';

const SPEAKER = `<path d="M4 12h5l7-6v20l-7-6H4z" fill="currentColor"/>`;
const WAVES = `<path d="M20.5 11.5a6 6 0 0 1 0 9M23.5 8a11 11 0 0 1 0 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`;
const CROSS = `<path d="M20 12l8 8M28 12l-8 8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`;

function icon(muted: boolean): string {
  return `<svg viewBox="0 0 32 32" width="20" height="20" aria-hidden="true">${SPEAKER}${muted ? CROSS : WAVES}</svg>`;
}

export interface SoundControlOptions {
  /** Narrower slider, no label (setup footer). */
  compact?: boolean;
  /** The engine to control (tests); default the page's `sfx`. */
  engine?: SoundEngine;
}

export function soundControl(opts: SoundControlOptions = {}): HTMLElement {
  const engine = opts.engine ?? sfx;
  const s = engine.settings;
  const mute = h('button', { class: 'snd-mute', attrs: { 'data-k': 'mute' } });
  const slider = h('input', {
    class: 'snd-vol',
    type: 'range',
    attrs: { min: '0', max: '100', step: '5', 'aria-label': 'Volume', 'data-k': 'volume' },
  });
  slider.value = String(Math.round(s.volume * 100));

  const show = () => {
    const cur = engine.settings;
    const off = cur.muted || cur.volume === 0;
    mute.innerHTML = icon(off);
    mute.title = off ? 'Sound off: click to turn on' : 'Mute sounds';
    mute.setAttribute('aria-label', off ? 'Unmute sounds' : 'Mute sounds');
    mute.setAttribute('aria-pressed', String(cur.muted));
    slider.disabled = cur.muted;
    slider.style.setProperty('--fill', `${Math.round(cur.volume * 100)}%`);
  };

  mute.addEventListener('click', () => {
    engine.unlock();
    const cur = engine.settings;
    if (cur.muted) {
      engine.setMuted(false);
      if (cur.volume === 0) engine.setVolume(0.6);
      engine.play('settlement');
    } else {
      engine.setMuted(true);
    }
    slider.value = String(Math.round(engine.settings.volume * 100));
    show();
  });
  slider.addEventListener('input', () => {
    engine.setVolume(Number(slider.value) / 100);
    show();
  });
  // A sample at the new level once the slider is released.
  slider.addEventListener('change', () => {
    engine.unlock();
    engine.play('settlement');
  });
  show();

  return h(
    'div',
    {
      class: `snd${opts.compact ? ' is-compact' : ''}`,
      attrs: { role: 'group', 'aria-label': 'Sound' },
    },
    mute,
    slider,
  );
}
