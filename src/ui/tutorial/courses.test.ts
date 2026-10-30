// @vitest-environment jsdom
// The framework around courses: registry, per-course storage, the coach switching courses,
// the picker, the setup screen's "Learn it" links.
import { beforeEach, describe, expect, it } from 'vitest';
import { applyAction, legalActions, type Action, type GameState } from '../../engine';
import { loadPack, PACKS } from '../../expansions/load';
import { Hud } from '../hud';
import { SetupScreen } from '../setup/screen';
import { BASE_COURSE } from './base';
import { FOCUS_ATTR, TutorialCoach, type CoachHost } from './coach';
import { defineCourse, type LessonDef } from './course';
import { openTutorialPicker, pickerEntries } from './picker';
import {
  TUTORIAL_MODULES,
  courseById,
  courseOfGame,
  looksLikeTutorial,
  registerCourse,
} from './registry';
import {
  TUTORIAL_KEY,
  loadTutorial,
  saveTutorial,
  tutorialCompleted,
  tutorialKey,
  type TutorialStorage,
} from './store';

function memStore(): TutorialStorage & { mem: Map<string, string> } {
  const mem = new Map<string, string>();
  return { mem, getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) };
}

class FakeHost implements CoachHost {
  state: GameState | null = null;
  paces: (number | null)[] = [];
  coach: TutorialCoach | null = null;
  game() {
    return this.state ? { state: this.state, legal: legalActions(this.state) } : null;
  }
  start(state: GameState) {
    this.state = state;
    this.coach?.update();
  }
  newGame() {}
  pace(ms: number | null) {
    this.paces.push(ms);
  }
  act(pick: (legal: Action[]) => Action | undefined) {
    if (!this.state) throw new Error('no game');
    const a = pick(legalActions(this.state));
    if (!a) throw new Error('no such move');
    const r = applyAction(this.state, a);
    if (!r.ok) throw new Error(r.error);
    this.state = r.state;
    this.coach?.update();
  }
}

let root: HTMLElement;
let host: FakeHost;
let store: ReturnType<typeof memStore>;
let coach: TutorialCoach;
const click = (k: string, within: ParentNode = document) =>
  within.querySelector<HTMLButtonElement>(`[data-k="${k}"]`)?.click();
const title = () => root.querySelector('.tut-title')?.textContent ?? null;

beforeEach(() => {
  document.body.replaceChildren();
  root = document.createElement('div');
  document.body.append(root);
  host = new FakeHost();
  store = memStore();
  coach = new TutorialCoach(root, host, store);
  host.coach = coach;
});

describe('registry', () => {
  it('lists exactly the modules whose pack brings a course, under the module id', async () => {
    const withCourse: string[] = [];
    for (const id of Object.keys(PACKS)) {
      const pack = await loadPack(id);
      if (!pack.tutorial) continue;
      withCourse.push(id);
      expect(pack.tutorial.id).toBe(id);
      expect(pack.tutorial.mode).toBe(id);
      expect(courseById(id)).toBe(pack.tutorial);
    }
    expect([...TUTORIAL_MODULES].sort()).toEqual(withCourse.sort());
  });

  it('finds a course by its game, and tells tutorial games by their seed before loading', () => {
    expect(courseById('base')).toBe(BASE_COURSE);
    for (const id of ['base', ...TUTORIAL_MODULES]) {
      const course = courseById(id);
      const s = course?.game();
      expect(s && courseOfGame(s)).toBe(course);
      expect(s && looksLikeTutorial(s)).toBe(true);
    }
    const plain = { ...BASE_COURSE.game(), settings: { ...BASE_COURSE.game().settings, seed: 7 } };
    expect(looksLikeTutorial(plain)).toBe(false);
  });

  it('refuses a second, different course under a taken id', () => {
    const ck = courseById('ck');
    if (!ck) throw new Error('no ck course');
    expect(() => registerCourse(ck)).not.toThrow();
    expect(() => registerCourse({ ...ck })).toThrow(/already registered/);
  });
});

describe('storage per course', () => {
  it('keeps base at its old key and each module under its own', () => {
    expect(tutorialKey('base')).toBe(TUTORIAL_KEY);
    expect(tutorialKey('ck')).toBe('catan:tutorial:ck:v1');
    const ck = courseById('ck');
    if (!ck) throw new Error('no ck course');
    saveTutorial(store, { completed: true, offered: false, run: null }, ck);
    expect(tutorialCompleted(store, 'ck')).toBe(true);
    expect(tutorialCompleted(store, 'base')).toBe(false);
    expect(loadTutorial(store).completed).toBe(false);
    expect(loadTutorial(store, ck).completed).toBe(true);
  });
});

describe('coach with expansion courses', () => {
  it('starts a module course with its badge, lessons and focus', () => {
    coach.begin('ck');
    expect(coach.courseId).toBe('ck');
    expect(host.state?.settings.mode).toBe('ck');
    expect(title()).toBe('Cities & Knights');
    expect(root.querySelector('.tut-badge')?.textContent).toBe('Cities & Knights');
    expect(host.paces).toEqual([900]);
    // The intro offers the base tutorial while it isn't done.
    expect(root.querySelector('[data-k="tut-base"]')).not.toBe(null);
  });

  it('the intro link starts the base tutorial; done, it is not offered', () => {
    coach.begin('seafarers');
    click('tut-base', root);
    expect(coach.courseId).toBe('base');
    expect(title()).toBe('Your goal');
    expect(loadTutorial(store, courseById('seafarers')).run).toBe(null);
    click('tut-skip', root);
    expect(coach.completed).toBe(true);
    coach.begin('seafarers');
    expect(title()).toBe('Seafarers');
    expect(root.querySelector('[data-k="tut-base"]')).toBe(null);
  });

  it('a module course resumes after a reload with its saved game', () => {
    coach.begin('ck');
    click('tut-next', root);
    const saved = host.state;
    const again = new FakeHost();
    const root2 = document.createElement('div');
    const coach2 = new TutorialCoach(root2, again, store);
    again.coach = coach2;
    again.state = saved;
    coach2.update();
    expect(coach2.courseId).toBe('ck');
    expect(coach2.active).toBe(true);
    expect(root2.querySelector('.tut-badge')?.textContent).toBe('Cities & Knights');
    expect(again.paces).toEqual([900]);
  });

  it('finishing or skipping marks only that course done', () => {
    coach.begin('ck');
    click('tut-skip', root);
    expect(coach.isCompleted('ck')).toBe(true);
    expect(coach.isCompleted('seafarers')).toBe(false);
    expect(coach.completed).toBe(false);
    expect(host.paces.at(-1)).toBe(null);
  });

  it('a course draws its own visual and points with its own focus names', () => {
    const lessons: LessonDef<'a' | 'end'>[] = [
      { id: 'a', title: 'A', text: () => 'a', when: () => true, focus: 'my-thing', visual: 'pic' },
      { id: 'end', title: 'End', text: () => 'e', when: () => false },
    ];
    const course = defineCourse({
      id: 'demo',
      name: 'Demo',
      mode: 'demo',
      seed: 'learn-demo-1',
      lessons,
      gate: 'a',
      finish: 'end',
      lastCoachedTurn: 1,
      visuals: { pic: () => Object.assign(document.createElement('i'), { className: 'pic' }) },
    });
    registerCourse(course);
    coach.begin('demo');
    expect(root.querySelector('.tut-panel .pic')).not.toBe(null);
    expect(root.getAttribute(FOCUS_ATTR)).toBe('my-thing');
  });
});

describe('picker', () => {
  it('lists base and every module with a tutorial, ticks the done ones', () => {
    saveTutorial(store, { completed: true, offered: true, run: null });
    const entries = pickerEntries((id) => tutorialCompleted(store, id));
    expect(entries.map((e) => e.id)).toEqual(['base', ...TUTORIAL_MODULES]);
    expect(entries.map((e) => e.name).slice(0, 3)).toEqual([
      'Base game',
      'Cities & Knights',
      'Seafarers',
    ]);
    expect(entries.map((e) => e.done)).toEqual([true, ...TUTORIAL_MODULES.map(() => false)]);
  });

  it('starts the picked course, or cancels (Escape too)', async () => {
    const picked: string[] = [];
    let cancels = 0;
    const open = () =>
      openTutorialPicker(root, {
        isDone: (id) => id === 'base',
        onPick: (id) => void picked.push(id),
        onCancel: () => cancels++,
      });
    const el = open();
    expect(el.querySelectorAll('.tut-pick-row')).toHaveLength(1 + TUTORIAL_MODULES.length);
    expect(el.querySelector('[data-k="tut-pick-base"] .tut-pick-done')).not.toBe(null);
    expect(el.querySelector('.tut-pick-hint')).toBe(null); // base done: no "start with base"
    click('tut-pick-ck', el);
    await Promise.resolve();
    expect(picked).toEqual(['ck']);
    expect(el.isConnected).toBe(false);
    const again = open();
    click('tut-pick-cancel', again);
    expect(cancels).toBe(1);
    expect(again.isConnected).toBe(false);
    const third = open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(cancels).toBe(2);
    expect(third.isConnected).toBe(false);
  });

  it('a failed load stays open with a message', async () => {
    const el = openTutorialPicker(root, {
      isDone: () => false,
      onPick: () => Promise.reject(new Error('offline')),
      onCancel: () => undefined,
    });
    const orig = console.error;
    console.error = () => undefined;
    click('tut-pick-seafarers', el);
    await new Promise((r) => setTimeout(r, 0));
    console.error = orig;
    expect(el.isConnected).toBe(true);
    expect(el.querySelector('.summary.is-error')?.textContent).toMatch(/Could not load Seafarers/);
    expect(el.querySelector('.tut-pick-hint')).not.toBe(null);
  });
});

describe('entry points', () => {
  it('the setup screen offers "New to <expansion>? Learn it" for chips on with a course', () => {
    const asked: (string | undefined)[] = [];
    const screen = new SetupScreen({
      onStart: () => undefined,
      onTutorial: (c) => asked.push(c),
      storage: null,
    });
    document.body.append(screen.element);
    expect(screen.element.querySelector('.su-learn-x')).toBe(null);
    click('chip-ck', screen.element);
    const link = screen.element.querySelector<HTMLButtonElement>('[data-k="learn-ck"]');
    expect(link?.textContent).toContain('New to Cities & Knights?');
    link?.click();
    click('learn', screen.element);
    expect(asked).toEqual(['ck', undefined]);
  });

  it('the HUD passes the picked course on (absent from the header button: the picker)', () => {
    const hudRoot = document.createElement('div');
    document.body.append(hudRoot);
    const hud = new Hud(hudRoot);
    const asked: (string | undefined)[] = [];
    hud.setLearnToPlay((c) => asked.push(c));
    hud.showNewGame();
    click('chip-seafarers', hudRoot);
    click('learn-seafarers', hudRoot);
    expect(asked).toEqual(['seafarers']);
    expect(hud.isCovered()).toBe(false);
    hud.showNewGame();
    click('learn', hudRoot);
    expect(asked).toEqual(['seafarers', undefined]);
    hud.destroy();
  });
});
