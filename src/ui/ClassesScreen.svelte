<script lang="ts">
  import { onMount } from 'svelte';
  import BottomTabs from './BottomTabs.svelte';
  import ScreenHead from './ScreenHead.svelte';
  import Toast from './Toast.svelte';
  import {
    addClassRoom,
    listAllStudents,
    listClassRooms,
    listContests
  } from '../storage/repositories';
  import type { ClassRoom } from '../core/types';
  import { messageOf } from './format';

  let rooms = $state<ClassRoom[]>([]);
  let counts = $state<Record<number, { students: number; contests: number }>>({});
  let loading = $state(true);
  let showForm = $state(false);
  let name = $state('');
  let description = $state('');
  let error = $state<string | null>(null);
  let busy = $state(false);
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;

  function notify(message: string): void {
    toast = message;
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, 3000);
  }

  async function load(): Promise<void> {
    try {
      const [list, students, contests] = await Promise.all([
        listClassRooms(),
        listAllStudents(),
        listContests()
      ]);
      rooms = list;
      const next: Record<number, { students: number; contests: number }> = {};
      for (const room of list) {
        next[room.id] = { students: 0, contests: 0 };
      }
      for (const student of students) {
        if (next[student.classId]) next[student.classId].students += 1;
      }
      for (const contest of contests) {
        if (contest.classRoomId != null && next[contest.classRoomId]) {
          next[contest.classRoomId].contests += 1;
        }
      }
      counts = next;
    } catch (reason) {
      error = messageOf(reason);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
    return () => {
      if (toastTimer != null) window.clearTimeout(toastTimer);
    };
  });

  function openForm(): void {
    name = '';
    description = '';
    error = null;
    showForm = true;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    busy = true;
    error = null;
    try {
      await addClassRoom({ name, description });
      showForm = false;
      await load();
      notify('Đã tạo lớp.');
    } catch (reason) {
      error = messageOf(reason);
    } finally {
      busy = false;
    }
  }
</script>

<div class="screen">
  <ScreenHead title="Lớp học" subtitle={`${rooms.length} lớp`} back={null}>
    <button class="icon-button" onclick={openForm} aria-label="Thêm lớp">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
  </ScreenHead>

  {#if error && !showForm}
    <div class="alert" role="alert">{error}</div>
  {/if}

  {#if loading}
    <p class="muted">Đang tải…</p>
  {:else if rooms.length === 0}
    <div class="empty">
      <p>Chưa có lớp học. Tạo lớp để quản lý sổ điểm và nhập học sinh.</p>
      <button class="btn primary" onclick={openForm}>Tạo lớp đầu tiên</button>
    </div>
  {:else}
    <div class="list">
      {#each rooms as room}
        <a class="list-item" href={`#/classes/${room.id}`}>
          <div class="avatar" aria-hidden="true">{room.name.trim().charAt(0).toUpperCase()}</div>
          <div class="item-main">
            <div class="item-title">{room.name}</div>
            <div class="item-sub">
              {counts[room.id]?.students ?? 0} học sinh ·
              {counts[room.id]?.contests ?? 0} kỳ thi
            </div>
          </div>
          <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        </a>
      {/each}
    </div>
  {/if}
</div>

{#if showForm}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget && !busy) showForm = false;
    }}
  >
    <dialog open class="modal-sheet" aria-label="Tạo lớp học">
      <h2>Tạo lớp học</h2>
      <form class="stack" onsubmit={submit}>
        <label class="field">
          <span>Tên lớp</span>
          <input bind:value={name} placeholder="10A1" autocomplete="off" required />
        </label>
        <label class="field">
          <span>Ghi chú (không bắt buộc)</span>
          <input bind:value={description} placeholder="Ví dụ: Ca sáng, phòng 12" autocomplete="off" />
        </label>
        {#if error}
          <div class="alert" role="alert">{error}</div>
        {/if}
        <div class="modal-actions">
          <button class="btn primary" type="submit" disabled={busy}>
            {busy ? 'Đang tạo…' : 'Tạo lớp'}
          </button>
          <button class="btn ghost" type="button" onclick={() => (showForm = false)} disabled={busy}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  </div>
{/if}

<Toast message={toast} />
<BottomTabs active="classes" />

<style>
  .avatar {
    width: 42px;
    height: 42px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 14px;
    background: color-mix(in srgb, var(--neon) 16%, var(--surface-alt));
    color: var(--neon-deep);
    font-weight: 750;
    font-size: 17px;
    border: 1px solid color-mix(in srgb, var(--neon) 30%, var(--border));
  }
</style>
