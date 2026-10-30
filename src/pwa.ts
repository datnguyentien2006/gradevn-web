import { registerSW } from 'virtual:pwa-register';

type UpdateFn = (reloadPage?: boolean) => Promise<void>;
let updateSW: UpdateFn | undefined;

export function initPwa(): void {
  if (updateSW) return;
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new Event('pwa:update-available'));
    },
    onOfflineReady() {
      window.dispatchEvent(new Event('pwa:offline-ready'));
    },
    onRegisterError(error) {
      console.warn('[pwa] register error', error);
    }
  });
}

export function applyUpdate(): void {
  void updateSW?.(true);
}
