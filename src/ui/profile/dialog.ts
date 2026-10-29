/**
 * The Profile dialog (PR1): nickname, profile picture (gallery or own upload, cropped in the
 * browser) and piece style with a preview. The home screen and the lobby open it for the local
 * profile; the setup screen opens it per seat (without the nickname).
 */
import { h } from '../dom';
import { glyph } from '../icons';
import { playerStyle } from '../widgets';
import { AVATAR_ART } from './gallery';
import { avatarPicture } from './looks';
import {
  AVATAR_IDS,
  AVATAR_LIMITS,
  isImageAvatar,
  PIECE_STYLE_IDS,
  PIECE_STYLE_LABEL,
  PROFILE_NAME_MAX,
  type AvatarRef,
  type PieceStyleId,
  type Profile,
} from './model';
import {
  CENTER_CROP,
  drawCrop,
  encodeAvatar,
  loadImageFile,
  MAX_ZOOM,
  panCrop,
  type Crop,
} from './upload';

/**
 * Renders a piece-style preview (src/render/stylePreview.ts): a canvas to copy (s18: no PNG to
 * encode) or an image URL; main.ts installs it.
 */
export type StylePreview = (
  style: PieceStyleId,
  color: string,
) => Promise<HTMLCanvasElement | string | null>;

let preview: StylePreview | null = null;
/** Finished previews, so re-rendered screens (lobby updates) show them without a flicker. */
const ready = new Map<string, HTMLCanvasElement | string>();

/** Install the piece-style preview renderer (null = names only). */
export function setStylePreview(fn: StylePreview | null): void {
  preview = fn;
  ready.clear();
}

/** A preview (a canvas, or an <img> for a URL) of `style` in `color`, filled in when ready. */
export function stylePreviewImg(style: PieceStyleId, color: string): HTMLElement {
  const box = h('span', { class: 'pf-style-art', attrs: { 'aria-hidden': 'true' } });
  const show = (art: HTMLCanvasElement | string) => {
    if (typeof art === 'string') {
      const img = h('img', { attrs: { alt: '', draggable: 'false' } }) as HTMLImageElement;
      img.src = art;
      box.replaceChildren(img);
      return;
    }
    const copy = document.createElement('canvas');
    copy.width = art.width;
    copy.height = art.height;
    copy.getContext('2d')?.drawImage(art, 0, 0);
    box.replaceChildren(copy);
  };
  const key = `${style}|${color}`;
  const done = ready.get(key);
  if (done) show(done);
  else {
    void preview?.(style, color).then((art) => {
      if (!art) return;
      ready.set(key, art);
      show(art);
    });
  }
  return box;
}

/** A round picture of `ref` with a `color` ring, or the person icon (`.avatar`). */
export function profileAvatar(ref: AvatarRef | null, color: string, size: number): HTMLElement {
  const pic = avatarPicture(ref);
  return h(
    'span',
    {
      class: `avatar${pic ? ' has-pic' : ''}`,
      style: { ...playerStyle(color), '--av': `${size}px` },
    },
    pic ?? glyph('person', Math.round(size * 0.62)),
  );
}

/** "[picture] Profile" button (home screen, lobby). */
export function profileChip(
  ref: AvatarRef | null,
  onClick: () => void,
  color = '#d64541',
  label = 'Profile',
): HTMLButtonElement {
  return h(
    'button',
    {
      class: 'pf-chip',
      title: 'Nickname, picture and pieces',
      attrs: { 'data-k': 'profile' },
      on: { click: onClick },
    },
    profileAvatar(ref, color, 28),
    h('span', {}, label),
  );
}

export interface ProfileDialogOptions {
  /** Dialog title (default 'Profile'). */
  title?: string;
  profile: Profile;
  /** Show the nickname field (default true). */
  showName?: boolean;
  /** Show the picture section (default true; bot seats only pick pieces). */
  showAvatar?: boolean;
  /** Colour of the ring and of the piece previews (CSS). */
  color?: string;
  onSave: (p: Profile) => void;
  onCancel?: () => void;
  /** Where the dialog goes (default document.body). */
  layer?: HTMLElement;
}

export interface ProfileDialogHandle {
  readonly element: HTMLElement;
  close(): void;
}

const STAGE = 220;

export function openProfileDialog(opts: ProfileDialogOptions): ProfileDialogHandle {
  const color = opts.color ?? '#d64541';
  const draft: Profile = { ...opts.profile };
  /** The last uploaded picture stays pickable after choosing a gallery one. */
  let upload: AvatarRef | null = draft.avatar && isImageAvatar(draft.avatar) ? draft.avatar : null;

  const status = h('p', { class: 'pf-status', attrs: { role: 'status' } });
  const big = h('span', { class: 'pf-big', style: { '--pc': color } });
  const nameInput = h('input', {
    class: 'input pf-name',
    value: draft.name,
    maxLength: PROFILE_NAME_MAX,
    placeholder: 'Your nickname',
    attrs: { 'aria-label': 'Nickname', 'data-k': 'profile-name', autocomplete: 'nickname' },
  });
  const grid = h('div', {
    class: 'pf-avatars',
    attrs: { role: 'radiogroup', 'aria-label': 'Picture' },
  });
  const styles = h('div', {
    class: 'pf-styles',
    attrs: { role: 'radiogroup', 'aria-label': 'Pieces' },
  });
  const file = h('input', {
    type: 'file',
    class: 'pf-file',
    attrs: { accept: 'image/*', 'aria-label': 'Upload a picture', 'data-k': 'profile-file' },
  }) as HTMLInputElement;

  // ---- crop stage (shown while an upload is being framed) ----
  const stage = h('canvas', {
    class: 'pf-stage',
    attrs: { width: String(STAGE), height: String(STAGE), 'aria-label': 'Drag to frame' },
  }) as HTMLCanvasElement;
  const zoom = h('input', {
    type: 'range',
    class: 'pf-zoom',
    attrs: { min: '1', max: String(MAX_ZOOM), step: '0.01', value: '1', 'aria-label': 'Zoom' },
  }) as HTMLInputElement;
  const cropBox = h(
    'div',
    { class: 'pf-crop', attrs: { hidden: '' } },
    h('div', { class: 'pf-stage-wrap' }, stage),
    h('label', { class: 'pf-zoom-row' }, h('span', {}, 'Zoom'), zoom),
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { class: 'btn btn-ghost', on: { click: () => endCrop() } }, 'Cancel'),
      h(
        'button',
        {
          class: 'btn btn-primary',
          attrs: { 'data-k': 'profile-crop' },
          on: { click: () => useCrop() },
        },
        'Use picture',
      ),
    ),
  );
  let img: HTMLImageElement | null = null;
  let crop: Crop = CENTER_CROP;

  const paintStage = () => {
    if (img) drawCrop(stage, img, crop, STAGE);
  };
  const endCrop = () => {
    img = null;
    cropBox.hidden = true;
    main.hidden = false;
  };
  const useCrop = () => {
    if (!img) return;
    const out = document.createElement('canvas');
    if (!drawCrop(out, img, crop, AVATAR_LIMITS.size)) {
      say('Your browser could not resize that picture.', true);
      return;
    }
    const url = encodeAvatar(out);
    if (!url) {
      say('That picture could not be made small enough. Try another one.', true);
      return;
    }
    upload = url;
    draft.avatar = url;
    endCrop();
    say(`Picture ready (${Math.round((url.length * 3) / 4 / 1024)} KB).`);
    refresh();
  };
  zoom.addEventListener('input', () => {
    crop = { ...crop, zoom: Number(zoom.value) };
    paintStage();
  });
  let drag: { x: number; y: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    stage.setPointerCapture?.(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || !img) return;
    const scale = STAGE / (stage.getBoundingClientRect().width || STAGE);
    crop = panCrop(
      img.naturalWidth,
      img.naturalHeight,
      crop,
      (e.clientX - drag.x) * scale,
      (e.clientY - drag.y) * scale,
      STAGE,
    );
    drag = { x: e.clientX, y: e.clientY };
    paintStage();
  });
  const stopDrag = () => (drag = null);
  stage.addEventListener('pointerup', stopDrag);
  stage.addEventListener('pointercancel', stopDrag);
  stage.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const z = Math.min(MAX_ZOOM, Math.max(1, crop.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      crop = { ...crop, zoom: z };
      zoom.value = String(z);
      paintStage();
    },
    { passive: false },
  );
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    say('Reading picture…');
    loadImageFile(f).then(
      (loaded) => {
        img = loaded;
        crop = CENTER_CROP;
        zoom.value = '1';
        main.hidden = true;
        cropBox.hidden = false;
        say('Drag to frame your face, zoom to fit.');
        paintStage();
      },
      (e: unknown) => say(e instanceof Error ? e.message : String(e), true),
    );
  });

  function say(text: string, bad = false): void {
    status.textContent = text;
    status.classList.toggle('is-bad', bad);
  }

  function pick(ref: AvatarRef | null): void {
    draft.avatar = ref;
    refresh();
  }

  function avatarTile(ref: AvatarRef | null, label: string, content: Node): HTMLElement {
    const on = draft.avatar === ref;
    return h(
      'button',
      {
        class: `pf-av${on ? ' is-on' : ''}`,
        title: label,
        style: { '--pc': color },
        attrs: {
          role: 'radio',
          'aria-checked': String(on),
          'aria-label': label,
          'data-avatar': ref === null ? 'none' : isImageAvatar(ref) ? 'upload' : ref,
        },
        on: { click: () => pick(ref) },
      },
      content,
    );
  }

  function refresh(): void {
    big.replaceChildren(avatarPicture(draft.avatar) ?? h('span', { class: 'pf-none' }, '?'));
    grid.replaceChildren(
      avatarTile(null, 'No picture', h('span', { class: 'pf-none' }, '—')),
      ...(upload ? [avatarTile(upload, 'Your picture', avatarPicture(upload) ?? h('span'))] : []),
      ...AVATAR_IDS.map((id) =>
        avatarTile(id, AVATAR_ART[id].label, avatarPicture(id) ?? h('span')),
      ),
      h(
        'button',
        {
          class: 'pf-av pf-upload',
          title: 'Upload your own picture',
          attrs: { 'aria-label': 'Upload your own picture', 'data-k': 'profile-upload' },
          on: { click: () => file.click() },
        },
        h('span', { class: 'pf-plus' }, '+'),
      ),
    );
    for (const btn of styles.querySelectorAll<HTMLElement>('.pf-style')) {
      const on = btn.dataset.style === draft.pieceStyle;
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-checked', String(on));
    }
  }

  styles.append(
    ...PIECE_STYLE_IDS.map((id) =>
      h(
        'button',
        {
          class: 'pf-style',
          attrs: { role: 'radio', 'aria-checked': 'false', 'data-style': id },
          on: {
            click: () => {
              draft.pieceStyle = id;
              refresh();
            },
          },
        },
        stylePreviewImg(id, color),
        h('span', { class: 'pf-style-name' }, PIECE_STYLE_LABEL[id]),
      ),
    ),
  );

  const showName = opts.showName ?? true;
  const showAvatar = opts.showAvatar ?? true;
  const main = h(
    'div',
    { class: 'pf-main' },
    showAvatar &&
      h(
        'div',
        { class: 'pf-head' },
        big,
        showName
          ? h('label', { class: 'pf-field' }, h('span', { class: 'sub' }, 'Nickname'), nameInput)
          : h('p', { class: 'pf-hint' }, 'Picture and pieces for this seat.'),
      ),
    showAvatar && h('div', { class: 'sub' }, 'Picture'),
    showAvatar && grid,
    !showAvatar && h('p', { class: 'pf-hint' }, 'Bots show a bot picture; pick their pieces.'),
    h('div', { class: 'sub' }, 'Pieces'),
    styles,
    h(
      'div',
      { class: 'dialog-actions' },
      h('button', { class: 'btn btn-ghost', on: { click: () => cancel() } }, 'Cancel'),
      h(
        'button',
        {
          class: 'btn btn-primary',
          attrs: { 'data-k': 'profile-save' },
          on: { click: () => save() },
        },
        'Save',
      ),
    ),
  );

  const dialog = h(
    'div',
    {
      class: 'dialog wide pf-dialog enter',
      attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title ?? 'Profile' },
    },
    h('h2', {}, opts.title ?? 'Profile'),
    main,
    cropBox,
    status,
    file,
  );
  const element = h(
    'div',
    {
      class: 'pf-scrim',
      on: {
        mousedown: (e) => {
          if (e.target === element) cancel();
        },
        keydown: (e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            if (img) endCrop();
            else cancel();
          }
        },
      },
    },
    dialog,
  );

  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    element.remove();
  };
  const cancel = () => {
    close();
    opts.onCancel?.();
  };
  const save = () => {
    const name = nameInput.value.trim();
    if (showName && name === '') {
      say('Pick a nickname.', true);
      nameInput.focus();
      return;
    }
    close();
    opts.onSave({ ...draft, name: showName ? name : draft.name });
  };

  refresh();
  (opts.layer ?? document.body).append(element);
  (showName ? nameInput : (grid.querySelector('.is-on') as HTMLElement | null))?.focus();
  return { element, close };
}
