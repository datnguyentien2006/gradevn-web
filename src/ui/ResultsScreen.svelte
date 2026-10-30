<script lang="ts">
  import { onMount } from 'svelte';
  import BottomTabs from './BottomTabs.svelte';
  import ScreenHead from './ScreenHead.svelte';
  import Toast from './Toast.svelte';
  import {
    deleteGradedSheet,
    listAllGradedSheets,
    listAllStudents,
    listClassRooms,
    listContests
  } from '../storage/repositories';
  import { shareOrDownload, type ShareOutcome } from './share';
  import type { ClassRoom, Contest, GradedSheet, Student } from '../core/types';
  import {
    contestSubtitle,
    formatDateTime,
    formatScore,
    messageOf
  } from './format';

  let { contestId: requestedContestId = null }: { contestId?: number | null } =
    $props();

  let contests = $state<Contest[]>([]);
  let classes = $state<ClassRoom[]>([]);
  let students = $state<Student[]>([]);
  let sheets = $state<GradedSheet[]>([]);
  // Router remounts this screen when the route changes, so the filter is fixed at mount.
  // svelte-ignore state_referenced_locally
  let selectedContestId = $state<number | null>(requestedContestId);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;
  let selecting = $state(false);
  let selectedIds = $state<Set<number>>(new Set());
  let exporting = $state(false);
  let deleting = $state(false);

  const classById = $derived(new Map(classes.map((room) => [room.id, room])));
  const studentById = $derived(new Map(students.map((student) => [student.id, student])));
  const selectedContest = $derived(
    contests.find((contest) => contest.id === selectedContestId) ?? null
  );
  const contestSheets = $derived(
    selectedContestId == null
      ? []
      : sheets
          .filter((sheet) => sheet.contestId === selectedContestId)
          .sort(
            (a, b) =>
              a.studentCode.localeCompare(b.studentCode, 'vi', { numeric: true }) ||
              String(a.gradedAt).localeCompare(String(b.gradedAt))
          )
  );
  const gradedSheets = $derived(contestSheets.filter((sheet) => sheet.keyId != null));
  const average = $derived.by(() => {
    const contest = selectedContest;
    if (!contest || gradedSheets.length === 0) return null;
    const total = gradedSheets.reduce(
      (sum, sheet) =>
        sum + Math.max(0, Math.min(10, (sheet.score / contest.maxScore) * 10)),
      0
    );
    return total / gradedSheets.length;
  });
  const allSelected = $derived(
    contestSheets.length > 0 && contestSheets.every((sheet) => selectedIds.has(sheet.id))
  );

  function notify(message: string): void {
    toast = message;
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, 3400);
  }

  function outcomeText(outcome: ShareOutcome): string {
    if (outcome === 'shared') return 'Đã mở bảng chia sẻ.';
    if (outcome === 'cancelled') return 'Đã hủy chia sẻ.';
    return 'Đã tải file xuống.';
  }

  function score10(sheet: GradedSheet): number {
    const contest = selectedContest;
    if (!contest) return sheet.score;
    return Math.max(0, Math.min(10, (sheet.score / contest.maxScore) * 10));
  }

  async function load(): Promise<void> {
    try {
      const [contestRows, classRows, studentRows, sheetRows] = await Promise.all([
        listContests(),
        listClassRooms(),
        listAllStudents(),
        listAllGradedSheets()
      ]);
      contests = contestRows;
      classes = classRows;
      students = studentRows;
      sheets = sheetRows;
      if (
        selectedContestId == null ||
        !contestRows.some((contest) => contest.id === selectedContestId)
      ) {
        selectedContestId = contestRows[0]?.id ?? null;
      }
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

  function selectContest(event: Event): void {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    selectedContestId = value > 0 ? value : null;
    selectedIds = new Set();
    selecting = false;
  }

  function classNameFor(contest: Contest | null): string | null {
    if (!contest || contest.classRoomId == null) return null;
    return classById.get(contest.classRoomId)?.name ?? null;
  }

  function nameFor(sheet: GradedSheet): string {
    if (sheet.studentId != null) {
      return studentById.get(sheet.studentId)?.fullName ?? '';
    }
    return '';
  }

  function toggleSelecting(): void {
    selecting = !selecting;
    if (!selecting) selectedIds = new Set();
  }

  function toggleSheet(id: number): void {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selectedIds = next;
  }

  function toggleAll(): void {
    if (allSelected) {
      selectedIds = new Set();
    } else {
      selectedIds = new Set(contestSheets.map((sheet) => sheet.id));
    }
  }

  async function removeSelected(): Promise<void> {
    if (selectedIds.size === 0 || deleting) return;
    if (
      !window.confirm(
        `Xoá ${selectedIds.size} phiếu đã lưu cùng ảnh phiếu? Không thể hoàn tác.`
      )
    ) {
      return;
    }
    deleting = true;
    try {
      for (const id of selectedIds) await deleteGradedSheet(id);
      selectedIds = new Set();
      selecting = false;
      await load();
      notify('Đã xoá các phiếu đã chọn.');
    } catch (reason) {
      notify(`Không xoá được: ${messageOf(reason)}`);
    } finally {
      deleting = false;
    }
  }

  async function exportResults(): Promise<void> {
    const contest = selectedContest;
    if (!contest || contestSheets.length === 0 || exporting) return;
    exporting = true;
    try {
      const { sanitizeFileName, workbookBytes, writeResultsWorkbook } =
        await import('../storage/xlsx');
      const roster = contest.classRoomId != null
        ? students.filter((student) => student.classId === contest.classRoomId)
        : [];
      const bytes = workbookBytes(writeResultsWorkbook(contest, contestSheets, roster));
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const outcome = await shareOrDownload(
        blob,
        `${sanitizeFileName(contest.name)}-ket-qua.xlsx`
      );
      notify(outcomeText(outcome));
    } catch (reason) {
      notify(`Không xuất được: ${messageOf(reason)}`);
    } finally {
      exporting = false;
    }
  }
</script>

<div class="screen results-screen">
  <ScreenHead title="Kết quả" subtitle={`${contests.length} kỳ thi · ${sheets.length} phiếu đã lưu`}>
    {#if contestSheets.length > 0}
      <button
        class="icon-button"
        onclick={toggleSelecting}
        aria-label={selecting ? 'Xong chọn' : 'Chọn phiếu để xoá'}
      >
        {#if selecting}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 7h14M5 12h14M5 17h9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
        {/if}
      </button>
    {/if}
  </ScreenHead>

  {#if error}
    <div class="alert" role="alert">{error}</div>
  {:else if loading}
    <p class="muted">Đang tải…</p>
  {:else if contests.length === 0}
    <div class="empty">
      <p>Chưa có kỳ thi nào.</p>
      <a class="btn primary" href="#/contests">Tạo kỳ thi</a>
    </div>
  {:else}
    <label class="field contest-select">
      <span>Kỳ thi</span>
      <select value={selectedContestId ?? ''} onchange={selectContest}>
        {#each contests as contest}
          <option value={contest.id}>
            {contest.name} — {classById.get(contest.classRoomId ?? -1)?.name ?? 'Ngoài lớp'}
          </option>
        {/each}
      </select>
    </label>

    {#if selectedContest}
      <section class="card summary">
        <div class="summary-head">
          <div>
            <h2>{selectedContest.name}</h2>
            <p class="muted small">
              {contestSubtitle(selectedContest, classNameFor(selectedContest))}
            </p>
          </div>
          <a class="pill neon" href={`#/contests/${selectedContest.id}`}>Kỳ thi</a>
        </div>
        <div class="kpi-grid">
          <div class="kpi"><b>{contestSheets.length}</b><span>phiếu</span></div>
          <div class="kpi"><b>{gradedSheets.length}</b><span>đã chấm</span></div>
          <div class="kpi"><b>{average == null ? '—' : average.toFixed(1)}</b><span>TB /10</span></div>
          <div class="kpi"><b>{formatScore(selectedContest.maxScore)}</b><span>điểm tối đa</span></div>
        </div>
        <div class="summary-actions">
          <a class="btn primary small" href={`#/scan/${selectedContest.id}`}>Quét thêm</a>
          <button class="btn ghost small" onclick={exportResults} disabled={contestSheets.length === 0 || exporting}>
            {exporting ? 'Đang xuất…' : 'Xuất XLSX'}
          </button>
        </div>
      </section>

      {#if contestSheets.length === 0}
        <div class="empty">
          <p>Chưa có phiếu nào cho kỳ thi này.</p>
          <a class="btn primary" href={`#/scan/${selectedContest.id}`}>Quét phiếu đầu tiên</a>
        </div>
      {:else}
        {#if selecting}
          <div class="select-bar">
            <label class="check-all">
              <input type="checkbox" checked={allSelected} onchange={toggleAll} />
              <span>Chọn tất cả ({contestSheets.length})</span>
            </label>
            <button class="btn danger small" onclick={removeSelected} disabled={selectedIds.size === 0 || deleting}>
              {deleting ? 'Đang xoá…' : `Xoá ${selectedIds.size}`}
            </button>
          </div>
        {/if}

        <div class="list sheet-list">
          {#each contestSheets as sheet}
            <div class="list-item sheet-row" class:selected={selectedIds.has(sheet.id)}>
              {#if selecting}
                <button
                  type="button"
                  class="sheet-check"
                  onclick={() => toggleSheet(sheet.id)}
                  aria-pressed={selectedIds.has(sheet.id)}
                  aria-label={`Chọn phiếu ${sheet.studentCode || 'không SBD'}`}
                >
                  <span class="box" class:on={selectedIds.has(sheet.id)}>
                    {#if selectedIds.has(sheet.id)}
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    {/if}
                  </span>
                </button>
                <button type="button" class="item-main plain" onclick={() => toggleSheet(sheet.id)}>
                  {@render sheetInfo(sheet)}
                </button>
              {:else}
                <a class="item-main" href={`#/sheets/${sheet.id}`}>
                  {@render sheetInfo(sheet)}
                </a>
                {#if sheet.keyId == null}
                  <span class="pill warn">Chưa chấm</span>
                {:else}
                  <span class="score-pill">{formatScore(score10(sheet))}</span>
                {/if}
                <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
                </svg>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  {/if}
</div>

{#snippet sheetInfo(sheet: GradedSheet)}
  <div class="item-title">
    SBD {sheet.studentCode || '—'}
    {#if nameFor(sheet)}
      <span class="sheet-name">· {nameFor(sheet)}</span>
    {/if}
  </div>
  <div class="item-sub">
    Mã đề {sheet.examCode || 'chung'} · {formatDateTime(sheet.gradedAt)}
  </div>
{/snippet}

<BottomTabs active="results" />
<Toast message={toast} />

<style>
  .small {
    font-size: 12px;
  }

  .contest-select {
    gap: 6px;
  }

  .summary {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .summary-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .summary-head h2 {
    font-size: 18px;
    letter-spacing: -0.3px;
  }

  .summary-actions {
    display: flex;
    gap: 8px;
  }

  .summary-actions .btn {
    flex: 1;
  }

  .select-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--surface);
    font-size: 13px;
  }

  .check-all {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .sheet-row {
    gap: 8px;
  }

  .sheet-row.selected {
    border-color: color-mix(in srgb, var(--neon) 45%, var(--border));
    background: color-mix(in srgb, var(--neon) 7%, var(--surface));
  }

  .sheet-row .item-main {
    display: flex;
    flex-direction: column;
    justify-content: center;
    min-width: 0;
    min-height: 44px;
    color: var(--text);
  }

  .plain {
    border: 0;
    background: none;
    padding: 0;
    text-align: left;
    font: inherit;
    color: var(--text);
    cursor: pointer;
  }

  .sheet-check {
    width: 44px;
    height: 44px;
    flex: none;
    display: grid;
    place-items: center;
    border: 0;
    background: none;
    cursor: pointer;
  }

  .box {
    width: 24px;
    height: 24px;
    border-radius: 8px;
    border: 1.8px solid var(--border-strong, var(--border));
    display: grid;
    place-items: center;
    color: var(--ink);
  }

  .box.on {
    background: var(--neon);
    border-color: var(--neon);
  }

  .box svg {
    width: 17px;
    height: 17px;
  }

  .sheet-name {
    font-weight: 500;
    color: var(--muted);
    font-size: 12.5px;
  }

  .score-pill {
    flex: none;
    min-width: 46px;
    padding: 5px 8px;
    border-radius: 10px;
    text-align: center;
    font-weight: 800;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    background: color-mix(in srgb, var(--neon) 16%, var(--surface));
    color: var(--neon-deep);
  }

  .empty {
    padding: 30px 16px;
  }
</style>
