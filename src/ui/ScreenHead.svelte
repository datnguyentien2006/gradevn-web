<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    subtitle = '',
    back = null,
    children
  }: {
    title: string;
    subtitle?: string;
    back?: string | null;
    children?: Snippet;
  } = $props();
</script>

<header class="screen-head">
  {#if back}
    <a class="icon-button" href={back} aria-label="Quay lại">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M15 5l-7 7 7 7"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </a>
  {/if}
  <div class="titles">
    <h1>{title}</h1>
    {#if subtitle}<p>{subtitle}</p>{/if}
  </div>
  {#if children}
    <div class="head-actions">{@render children()}</div>
  {/if}
</header>
