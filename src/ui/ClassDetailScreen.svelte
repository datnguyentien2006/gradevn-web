<script lang="ts">
  import { onMount } from 'svelte';
  import ScreenHead from './ScreenHead.svelte';
  import Toast from './Toast.svelte';
  import {
    addStudent,
    deleteClassRoom,
    deleteStudent,
    getClassRoom,
    importStudents,
    listContests,
    listStudents,
    updateStudent
  } from '../storage/repositories';
  import type { ClassRoom, Contest, Student } from '../core/types';
  import { contestSubtitle, formatDate, messageOf } from './format';

  let { classId }: { classId: number } = $props();

  let room = $state<ClassRoom | null>(null);
  let students = $state<Student[]>([]);
  let contests = $state<Contest[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;
  let fileInput = $state<HTMLInputElement | null>(null);
  let importing = $state(false);

  let showForm = $state(false);
  let editingId = $state<number | null>(null);
  let formCode = $state('');
  let formName = $state('');
  let formError = $state<string | null>(null);
  let busy = $state(false);

  function notify(message: string): void {
    toast = message;
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, 3200);
  }

  async function load(): Promise<void> {
    try {
      const [current, roster, allContests] = await Promise.all([
        getClassRoom(classId),
        listStudents(classId),
        listContests()
      ]);
      if (!current) throw new Error('Không tìm thấy lớp.');
      room = current;
      students = roster;
      contests = allContests.filter((contest) => contest.classRoomId === classId);
      error = null;
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

  function openAdd(): void {
    editingId = null;
    formCode = '';
    formName = '';
    formError = null;
    showForm = true;
  }

  function openEdit(student: Student): void {
    editingId = student.id;
    formCode = student.code;
    formName = student.fullName;
    formError = null;
    showForm = true;
  }

  async function saveStudent(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    busy = true;
    formError = null;
    try {
      if (editingId == null) {
        await addStudent({ classId, code: formCode, fullName: formName });
      } else {
        await updateStudent(editingId, { code: formCode, fullName: formName });
      }
      showForm = false;
      await load();
      notify(editingId == null ? 'Đã thêm học sinh.' : 'Đã cập nhật học sinh.');
    } catch (reason) {
      formError = messageOf(reason);
    } finally {
      busy = false;
    }
  }

  async function removeStudent(student: Student): Promise<void> {
    if (!window.confirm(`Xoá ${student.fullName || student.code} khỏi lớp?`)) return;
    try {
      await deleteStudent(student.id);
      await load();
      notify('Đã xoá học sinh. Phiếu cũ vẫn được giữ.');
    } catch (reason) {
      notify(messageOf(reason));
    }
  }

  async function removeClass(): Promise<void> {
    if (!room) return;
    if (!window.confirm(`Xoá lớp ${room.name}? Chỉ xoá được khi lớp không còn học sinh.`)) {
      return;
    }
    try {
      await deleteClassRoom(classId);
      location.hash = '#/classes';
    } catch (reason) {
      notify(messageOf(reason));
    }
  }

  function pickFile(): void {
    fileInput?.click();
  }

  async function onFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    importing = true;
    try {
      const { readStudentsWorkbook } = await import('../storage/xlsx');
      const rows = readStudentsWorkbook(await file.arrayBuffer());
      if (rows.length === 0) {
        notify('Không đọc được dòng học sinh nào trong file.');
        return;
      }
      const result = await importStudents(classId, rows);
      await load();
      notify(
        `Đã nhập: ${result.added} mới, ${result.updated} cập nhật` +
          (result.skipped ? `, ${result.skipped} bỏ qua` : '') +
          '.'
      );
    } catch (reason) {
      notify(`Lỗi nhập: ${messageOf(reason)}`);
    } finally {
      importing = false;
    }
  }
</script>

<div class="screen">
  <ScreenHead
    title={room?.name ?? 'Lớp học'}
    subtitle={`${students.length} học sinh · ${contests.length} kỳ thi`}
    back="#/classes"
  >
    <button class="icon-button" onclick={openAdd} aria-label="Thêm học sinh">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
  </ScreenHead>

  {#if error}
    <div class="alert" role="alert">{error}</div>
  {/if}

  {#if room?.description}
    <p class="description muted">{room.description}</p>
  {/if}

  <div class="row">
    <button class="btn small ghost grow" onclick={pickFile} disabled={importing}>
      {importing ? 'Đang import…' : 'Import XLSX học sinh'}
    </button>
    <button class="btn small primary grow" onclick={openAdd}>Thêm học sinh</button>
  </div>

  <section class="stack">
    <h2 class="section-title">Danh sách</h2>
    {#if loading}
      <p class="muted">Đang tải…</p>
    {:else if students.length === 0}
      <div class="empty">
        <p>Chưa có học sinh. Thêm tay hoặc nhập từ file XLSX với cột A = SBD, cột B = họ tên.</p>
      </div>
    {:else}
      <div class="list">
        {#each students as student}
          <div class="list-item roster-row">
            <div class="item-main">
              <div class="item-title">{student.fullName || 'Chưa có tên'}</div>
              <div class="item-sub">SBD {student.code}</div>
            </div>
            <button class="icon-button small" onclick={() => openEdit(student)} aria-label={`Sửa ${student.code}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h4l10-10-4-4L4 16v4zM13 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
              </svg>
            </button>
            <button class="icon-button small danger" onclick={() => removeStudent(student)} aria-label={`Xoá ${student.code}`}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 7h14M10 7V5h4v2M8 7l1 13h6l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
              </svg>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  {#if contests.length > 0}
    <section class="stack">
      <h2 class="section-title">Kỳ thi của lớp</h2>
      <div class="list">
        {#each contests as contest}
          <a class="list-item" href={`#/results?contest=${contest.id}`}>
            <div class="item-main">
              <div class="item-title">{contest.name}</div>
              <div class="item-sub">{contestSubtitle(contest, room?.name ?? null)}</div>
            </div>
            <span class="pill">{formatDate(contest.examDate)}</span>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <section class="card danger-zone">
    <h3>Xoá lớp</h3>
    <p class="muted small">
      Chỉ xoá được khi lớp không còn học sinh. Kỳ thi của lớp sẽ chuyển thành
      “Ngoài lớp”, không bị xoá.
    </p>
    <button class="btn danger small" onclick={removeClass}>Xoá lớp</button>
  </section>
</div>

{#if showForm}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget && !busy) showForm = false;
    }}
  >
    <dialog open class="modal-sheet" aria-label={editingId == null ? 'Thêm học sinh' : 'Sửa học sinh'}>
      <h2>{editingId == null ? 'Thêm học sinh' : 'Sửa học sinh'}</h2>
      <form class="stack" onsubmit={saveStudent}>
        <label class="field">
          <span>SBD / mã học sinh</span>
          <input bind:value={formCode} inputmode="numeric" placeholder="000001" autocomplete="off" required />
        </label>
        <label class="field">
          <span>Họ và tên</span>
          <input bind:value={formName} placeholder="Nguyễn Văn An" autocomplete="off" />
        </label>
        {#if formError}
          <div class="alert" role="alert">{formError}</div>
        {/if}
        <div class="modal-actions">
          <button class="btn primary" type="submit" disabled={busy}>
            {busy ? 'Đang lưu…' : 'Lưu'}
          </button>
          <button class="btn ghost" type="button" onclick={() => (showForm = false)} disabled={busy}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  </div>
{/if}

<input
  bind:this={fileInput}
  type="file"
  accept=".xlsx,.xls,.csv"
  class="hidden-input"
  onchange={onFile}
/>

<Toast message={toast} />

<style>
  .description {
    font-size: 13.5px;
    line-height: 1.45;
    padding: 0 4px;
  }

  .section-title {
    font-size: 15px;
  }

  .roster-row {
    cursor: default;
  }

  .small {
    font-size: 12px;
  }

  .danger-zone {
    display: flex;
    flex-direction: column;
    gap: 10px;
    align-items: flex-start;
  }

  .danger-zone h3 {
    font-size: 14px;
  }

  .hidden-input {
    display: none;
  }
</style>
