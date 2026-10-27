/** How main.ts shows game notices (`notices.ts`): awards as a banner (#36), the rest as toasts. */
import { showAwardBanner } from '../ui/awardBanner';
import type { NoticeSink } from './notices';
import { showToast } from './overlays';

export const showNotice: NoticeSink = (n, state, viewer) => {
  if (n.kind === 'award') showAwardBanner(n, state.players, viewer);
  else showToast(n.text, 'info');
};
