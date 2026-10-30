<script lang="ts">
  let { active }: { active: string } = $props();

  const tabs = [
    {
      id: 'home',
      label: 'Tổng quan',
      href: '#/',
      icon: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z'
    },
    {
      id: 'classes',
      label: 'Lớp',
      href: '#/classes',
      icon: 'M4 6h16M4 12h16M4 18h10'
    },
    {
      id: 'contests',
      label: 'Đề',
      href: '#/contests',
      icon: 'M6 4h12v16l-6-3-6 3z'
    },
    {
      id: 'results',
      label: 'Kết quả',
      href: '#/results',
      icon: 'M5 20V10M12 20V4M19 20v-7'
    },
    {
      id: 'stats',
      label: 'Thống kê',
      href: '#/stats',
      icon: 'M4 19h16M7 16V9M12 16V5M17 16v-4'
    }
  ];
</script>

<nav class="tabbar" aria-label="Điều hướng chính">
  {#each tabs as tab}
    <a
      href={tab.href}
      class:active={active === tab.id}
      aria-current={active === tab.id ? 'page' : undefined}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d={tab.icon}
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>{tab.label}</span>
    </a>
  {/each}
</nav>

<style>
  .tabbar {
    position: fixed;
    z-index: 40;
    left: 0;
    right: 0;
    bottom: 0;
    display: flex;
    align-items: stretch;
    height: calc(var(--tabbar) + env(safe-area-inset-bottom, 0px));
    padding: 0 6px env(safe-area-inset-bottom, 0px);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    border-top: 1px solid var(--border);
    backdrop-filter: blur(18px);
    -webkit-backdrop-filter: blur(18px);
  }

  a {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.1px;
    border-radius: 12px;
  }

  a.active {
    color: var(--neon-deep);
  }

  svg {
    width: 23px;
    height: 23px;
  }
</style>
