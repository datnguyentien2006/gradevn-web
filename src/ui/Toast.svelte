<script lang="ts">
  let { message }: { message: string | null } = $props();
</script>

{#if message}
  <div class="toast-bar" role="status" aria-live="polite">{message}</div>
{/if}
