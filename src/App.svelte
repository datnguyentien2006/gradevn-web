<script lang="ts">
  import { onMount } from 'svelte';
  import CameraTest from './camera/CameraTest.svelte';
  import ScanScreen from './camera/ScanScreen.svelte';
  import HomeScreen from './ui/HomeScreen.svelte';
  import ClassesScreen from './ui/ClassesScreen.svelte';
  import ClassDetailScreen from './ui/ClassDetailScreen.svelte';
  import ContestsScreen from './ui/ContestsScreen.svelte';
  import ContestDetailScreen from './ui/ContestDetailScreen.svelte';
  import KeyEditorScreen from './ui/KeyEditorScreen.svelte';
  import ResultsScreen from './ui/ResultsScreen.svelte';
  import SheetDetailScreen from './ui/SheetDetailScreen.svelte';
  import StatsScreen from './ui/StatsScreen.svelte';
  import SettingsScreen from './ui/SettingsScreen.svelte';
  import InstallBanner from './ui/InstallBanner.svelte';
  import UpdateToast from './ui/UpdateToast.svelte';

  type Route =
    | { name: 'home' }
    | { name: 'classes' }
    | { name: 'class'; id: number }
    | { name: 'contests' }
    | { name: 'contest'; id: number }
    | { name: 'key'; contestId: number; keyId: number | null }
    | { name: 'scan'; contestId: number | null }
    | { name: 'results'; contestId: number | null }
    | { name: 'sheet'; id: number }
    | { name: 'stats' }
    | { name: 'settings' }
    | { name: 'camera-test' }
    | { name: 'missing' };

  function positiveId(value: string | undefined): number | null {
    if (value == null) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function parseRoute(): Route {
    const raw = location.hash.replace(/^#\/?/, '');
    const queryIndex = raw.indexOf('?');
    const path = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
    const query = new URLSearchParams(queryIndex >= 0 ? raw.slice(queryIndex + 1) : '');
    const parts = path.split('/').filter(Boolean);

    if (parts.length === 0 || (parts.length === 1 && parts[0] === 'home')) {
      return { name: 'home' };
    }
    if (parts.length === 1 && parts[0] === 'classes') return { name: 'classes' };
    if (parts.length === 2 && parts[0] === 'classes') {
      const id = positiveId(parts[1]);
      return id == null ? { name: 'missing' } : { name: 'class', id };
    }
    if (parts.length === 1 && parts[0] === 'contests') return { name: 'contests' };
    if (parts.length === 2 && parts[0] === 'contests') {
      const id = positiveId(parts[1]);
      return id == null ? { name: 'missing' } : { name: 'contest', id };
    }
    if (parts[0] === 'contests' && parts[2] === 'key') {
      const contestId = positiveId(parts[1]);
      if (contestId == null) return { name: 'missing' };
      if (parts.length === 3) return { name: 'key', contestId, keyId: null };
      if (parts.length === 4) {
        const keyId = positiveId(parts[3]);
        return keyId == null ? { name: 'missing' } : { name: 'key', contestId, keyId };
      }
      return { name: 'missing' };
    }
    if (parts.length === 1 && parts[0] === 'scan') {
      return { name: 'scan', contestId: null };
    }
    if (parts.length === 2 && parts[0] === 'scan') {
      const id = positiveId(parts[1]);
      return id == null ? { name: 'missing' } : { name: 'scan', contestId: id };
    }
    if (parts.length === 1 && parts[0] === 'results') {
      return { name: 'results', contestId: positiveId(query.get('contest') ?? undefined) };
    }
    if (parts.length === 2 && parts[0] === 'sheets') {
      const id = positiveId(parts[1]);
      return id == null ? { name: 'missing' } : { name: 'sheet', id };
    }
    if (parts.length === 1 && parts[0] === 'stats') return { name: 'stats' };
    if (parts.length === 1 && parts[0] === 'settings') return { name: 'settings' };
    if (parts.length === 1 && parts[0] === 'camera-test') return { name: 'camera-test' };
    return { name: 'missing' };
  }

  let route = $state.raw<Route>(parseRoute());

  const isFullscreen = $derived(route.name === 'scan' || route.name === 'camera-test');
  const routeKey = $derived(location.hash || '#/');

  onMount(() => {
    const onHash = () => {
      route = parseRoute();
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  });
</script>

<div class="app">
  {#key routeKey}
    {#if route.name === 'home'}
      <HomeScreen />
    {:else if route.name === 'classes'}
      <ClassesScreen />
    {:else if route.name === 'class'}
      <ClassDetailScreen classId={route.id} />
    {:else if route.name === 'contests'}
      <ContestsScreen />
    {:else if route.name === 'contest'}
      <ContestDetailScreen contestId={route.id} />
    {:else if route.name === 'key'}
      <KeyEditorScreen contestId={route.contestId} keyId={route.keyId} />
    {:else if route.name === 'scan'}
      <ScanScreen contestId={route.contestId} />
    {:else if route.name === 'results'}
      <ResultsScreen contestId={route.contestId} />
    {:else if route.name === 'sheet'}
      <SheetDetailScreen sheetId={route.id} />
    {:else if route.name === 'stats'}
      <StatsScreen />
    {:else if route.name === 'settings'}
      <SettingsScreen />
    {:else if route.name === 'camera-test'}
      <CameraTest />
    {:else}
      <main class="page missing">
        <div class="card">
          <h1>Không tìm thấy trang</h1>
          <p class="muted">Đường dẫn không hợp lệ hoặc nội dung đã bị xoá.</p>
          <a class="btn primary" href="#/">Về Tổng quan</a>
        </div>
      </main>
    {/if}
  {/key}

  {#if !isFullscreen}
    <InstallBanner />
  {/if}
  <UpdateToast />
</div>

<style>
  .missing {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: calc(100dvh - var(--safe-top));
  }

  .missing .card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  .missing h1 {
    font-size: 20px;
    letter-spacing: -0.3px;
  }

  .missing p {
    font-size: 14px;
  }

  .missing .btn {
    margin-top: 6px;
  }
</style>
