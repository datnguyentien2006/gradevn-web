<script lang="ts">
  import { onMount } from 'svelte';
  import { applyUpdate } from '../pwa';

  let visible = $state(false);

  onMount(() => {
    const onUpdate = () => (visible = true);
    window.addEventListener('pwa:update-available', onUpdate);
    return () => window.removeEventListener('pwa:update-available', onUpdate);
  });
</script>

{#if visible}
  <div class="update-toast" role="status">
    <span>Đã có bản cập nhật.</span>
    <button
      class="btn small"
      onclick={() => {
        visible = false;
        applyUpdate();
      }}>Tải lại</button
    >
    <button class="close" aria-label="Để sau" onclick={() => (visible = false)}>✕</button>
  </div>
{/if}

<style>
  .update-toast {
    position: fixed;
    top: calc(10px + var(--safe-top));
    left: 12px;
    right: 12px;
    z-index: 50;
    max-width: 430px;
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 16px;
    border-radius: 16px;
    border: 1px solid var(--border);
    background: var(--surface);
    box-shadow: 0 18px 50px -22px rgba(0, 0, 0, 0.7);
    font-size: 14px;
  }

  .update-toast span {
    flex: 1;
  }

  .close {
    width: 44px;
    height: 44px;
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
</style>
