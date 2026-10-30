<script lang="ts">
  import { onMount } from 'svelte';

  const KEY = 'gradevn.install-dismissed';
  let visible = $state(false);

  onMount(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const isIOS =
      /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (!standalone && isIOS && localStorage.getItem(KEY) !== '1') {
      const timer = window.setTimeout(() => (visible = true), 900);
      return () => window.clearTimeout(timer);
    }
  });

  function dismiss(): void {
    visible = false;
    localStorage.setItem(KEY, '1');
  }
</script>

{#if visible}
  <aside class="install-banner" aria-label="Hướng dẫn cài đặt">
    <div class="text">
      <strong>Cài GradeVN lên Màn hình chính</strong>
      <span>Nhấn <b>Chia sẻ</b> rồi chọn <b>Thêm vào Màn hình chính</b> để dùng toàn màn hình.</span>
    </div>
    <button class="close" aria-label="Đóng hướng dẫn" onclick={dismiss}>✕</button>
  </aside>
{/if}

<style>
  .install-banner {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: calc(12px + var(--safe-bottom));
    z-index: 40;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    max-width: 430px;
    margin: 0 auto;
    padding: 14px 14px 14px 16px;
    border-radius: 18px;
    border: 1px solid color-mix(in srgb, var(--neon) 28%, var(--border));
    background: color-mix(in srgb, var(--surface) 92%, var(--neon) 8%);
    box-shadow: 0 18px 50px -20px rgba(0, 0, 0, 0.65);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 13.5px;
    color: var(--muted);
  }

  .text strong {
    font-size: 14.5px;
    color: var(--text);
  }

  .text b {
    color: var(--neon-deep);
  }

  .close {
    flex: none;
    width: 44px;
    height: 44px;
    margin: -8px -8px 0 0;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--muted);
    font-size: 15px;
    cursor: pointer;
  }
</style>
