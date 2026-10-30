<script lang="ts">
  import { onMount } from 'svelte';
  import BottomTabs from './BottomTabs.svelte';
  import ScreenHead from './ScreenHead.svelte';
  import Toast from './Toast.svelte';
  import {
    listAllGradedSheets,
    listAllStudents,
    listClassRooms,
    listContests
  } from '../storage/repositories';
  import {
    PASS_THRESHOLD,
    buildStatsSnapshot,
    type AttentionKind,
    type StatsScope
  } from '../storage/stats';
  import { shareOrDownload, type ShareOutcome } from './share';
  import type { ClassRoom, Contest, GradedSheet, Student } from '../core/types';
  import { formatDate, percent, messageOf } from './format';

  type ScopeKind = 'all' | 'class' | 'outside';

  const ATTENTION_LABELS: Record<AttentionKind, string> = {
    incorrectStudentId: 'SBD không khớp sổ điểm',
    ungraded: 'Đã lưu nhưng chưa chấm',
    missingSubmission: 'Chưa nộp phiếu'
  };

  let classes = $state<ClassRoom[]>([]);
  let students = $state<Student[]>([]);
  let contests = $state<Contest[]>([]);
  let sheets = $state<GradedSheet[]>([]);
  let scopeKind = $state<ScopeKind>('all');
  let selectedClassId = $state<number | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;
  let exporting = $state(false);

  const scope = $derived<StatsScope>(
    scopeKind === 'class'
      ? { kind: 'class', classId: selectedClassId ?? -1 }
      : scopeKind === 'outside'
        ? { kind: 'outside' }
        : { kind: 'all' }
  );
  const snapshot = $derived(
    buildStatsSnapshot(
      { classes, students, contests, sheets },
      scope
    )
  );
  const scopeLabel = $derived.by(() => {
    if (scopeKind === 'all') return 'Toàn bộ dữ liệu';
    if (scopeKind === 'outside') return 'Ngoài lớp';
    const room = classes.find((candidate) => candidate.id === selectedClassId);
    return room ? `Lớp ${room.name}` : 'Theo lớp';
  });
  const attentionVisible = $derived(
    snapshot.attention.filter((item) => item.count > 0)
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

  async function load(): Promise<void> {
    try {
      const [classRows, studentRows, contestRows, sheetRows] = await Promise.all([
        listClassRooms(),
        listAllStudents(),
        listContests(),
        listAllGradedSheets()
      ]);
      classes = classRows;
      students = studentRows;
      contests = contestRows;
      sheets = sheetRows;
      if (selectedClassId == null) selectedClassId = classRows[0]?.id ?? null;
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

  function setScope(kind: ScopeKind): void {
    scopeKind = kind;
    if (kind === 'class' && selectedClassId == null) {
      selectedClassId = classes[0]?.id ?? null;
    }
  }

  function selectClass(event: Event): void {
    const value = Number((event.currentTarget as HTMLSelectElement).value);
    selectedClassId = value > 0 ? value : null;
  }

  function barHeight(value: number, bins: number[]): string {
    const max = Math.max(1, ...bins);
    return `${Math.max(2, Math.round((value / max) * 100))}%`;
  }

  async function exportStats(): Promise<void> {
    if (exporting) return;
    exporting = true;
    try {
      const { sanitizeFileName, workbookBytes, writeStatsWorkbook } =
        await import('../storage/xlsx');
      const bytes = workbookBytes(
        writeStatsWorkbook(snapshot, scopeLabel, PASS_THRESHOLD)
      );
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const outcome = await shareOrDownload(
        blob,
        `${sanitizeFileName(`thong-ke-${scopeLabel}`)}.xlsx`
      );
      notify(outcomeText(outcome));
    } catch (reason) {
      notify(`Không xuất được: ${messageOf(reason)}`);
    } finally {
      exporting = false;
    }
  }
</script>

<div class="screen stats-screen">
  <ScreenHead title="Thống kê" subtitle={scopeLabel}>
    <button class="icon-button" onclick={exportStats} disabled={exporting} aria-label="Xuất báo cáo XLSX">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v12M8 11l4 4 4-4M5 20h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
  </ScreenHead>

  {#if error}
    <div class="alert" role="alert">{error}</div>
  {:else if loading}
    <p class="muted">Đang tải…</p>
  {:else}
    <div class="scope-tabs" role="tablist" aria-label="Phạm vi thống kê">
      <button class:active={scopeKind === 'all'} onclick={() => setScope('all')} role="tab" aria-selected={scopeKind === 'all'}>
        Tất cả
      </button>
      <button class:active={scopeKind === 'class'} onclick={() => setScope('class')} role="tab" aria-selected={scopeKind === 'class'}>
        Theo lớp
      </button>
      <button class:active={scopeKind === 'outside'} onclick={() => setScope('outside')} role="tab" aria-selected={scopeKind === 'outside'}>
        Ngoài lớp
      </button>
    </div>

    {#if scopeKind === 'class'}
      <label class="field">
        <span>Lớp</span>
        <select value={selectedClassId ?? ''} onchange={selectClass}>
          {#each classes as room}
            <option value={room.id}>{room.name}</option>
          {/each}
        </select>
      </label>
    {/if}

    <section class="kpi-grid">
      <div class="kpi"><b>{snapshot.totalSheets}</b><span>phiếu đã lưu</span></div>
      <div class="kpi"><b>{snapshot.gradedSheets}</b><span>đã chấm</span></div>
      <div class="kpi"><b>{snapshot.average10 == null ? '—' : snapshot.average10.toFixed(1)}</b><span>TB /10</span></div>
      <div class="kpi"><b>{percent(snapshot.completion)}</b><span>hoàn thành</span></div>
    </section>

    <section class="card meta-card">
      <div class="meta-row">
        <div><b>{snapshot.classCount}</b><span>lớp</span></div>
        <div><b>{snapshot.studentCount}</b><span>học sinh</span></div>
        <div><b>{snapshot.contestCount}</b><span>kỳ thi</span></div>
        <div><b>{snapshot.completedSlots}/{snapshot.expectedSlots}</b><span>lượt nộp</span></div>
      </div>
      <p class="muted small">
        Ngưỡng đạt {PASS_THRESHOLD}/10 · điểm chuẩn hoá theo điểm tối đa từng kỳ thi.
      </p>
    </section>

    {#if attentionVisible.length > 0}
      <section class="card attention-card">
        <h2 class="section-title">Cần chú ý</h2>
        {#each attentionVisible as item}
          <div class="attention-row">
            <div class="attention-head">
              <span>{ATTENTION_LABELS[item.kind]}</span>
              <span class="pill warn">{item.count}</span>
            </div>
            {#if item.samples.length > 0}
              <p class="muted small samples">{item.samples.join(' · ')}</p>
            {/if}
          </div>
        {/each}
      </section>
    {/if}

    <section class="stack">
      <div class="spread">
        <h2 class="section-title">Theo kỳ thi</h2>
        <span class="muted small">{snapshot.exams.length} kỳ thi</span>
      </div>
      {#if snapshot.exams.length === 0}
        <div class="empty"><p>Chưa có kỳ thi trong phạm vi này.</p></div>
      {:else}
        {#each snapshot.exams as exam}
          <article class="exam-card card">
            <header class="exam-head">
              <div class="exam-title">
                <h3>{exam.contest.name}</h3>
                <p class="muted small">
                  {exam.className ?? 'Ngoài lớp'} · {formatDate(exam.contest.examDate)}
                </p>
              </div>
              <a class="pill neon" href={`#/results?contest=${exam.contest.id}`}>Xem</a>
            </header>
            <div class="exam-stats">
              <div><b>{exam.sheetCount}</b><span>phiếu</span></div>
              <div><b>{exam.gradedCount}</b><span>đã chấm</span></div>
              <div><b>{exam.average10 == null ? '—' : exam.average10.toFixed(1)}</b><span>TB</span></div>
              <div><b>{percent(exam.passRate)}</b><span>đạt</span></div>
            </div>
            {#if exam.gradedCount > 0}
              <div class="histogram" aria-label="Phân bố điểm">
                {#each exam.histogram as count}
                  <i style={`height:${barHeight(count, exam.histogram)}`} title={`${count} phiếu`}></i>
                {/each}
              </div>
              <div class="axis"><span>0</span><span>5</span><span>10</span></div>
              {#if exam.hardest.length > 0}
                <div class="hardest">
                  {#each exam.hardest.slice(0, 4) as question}
                    <span class="pill">Câu {question.question} · {percent(question.rate)}</span>
                  {/each}
                </div>
              {/if}
            {:else}
              <p class="muted small">Chưa có phiếu được chấm cho kỳ thi này.</p>
            {/if}
          </article>
        {/each}
      {/if}
    </section>

    {#if snapshot.trend.length > 0}
      <section class="card trend-card">
        <h2 class="section-title">Xu hướng điểm trung bình</h2>
        <div class="trend-bars">
          {#each snapshot.trend as point}
            <div class="trend-row">
              <span class="trend-label">
                <b>{point.name}</b>
                <span class="muted small">{formatDate(point.examDate)}</span>
              </span>
              <span class="trend-track">
                <i style={`width:${Math.max(2, (point.average10 / 10) * 100)}%`}></i>
              </span>
              <span class="trend-value">{point.average10.toFixed(1)}</span>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <button class="btn ghost" onclick={exportStats} disabled={exporting}>
      {exporting ? 'Đang xuất…' : 'Xuất báo cáo XLSX'}
    </button>
  {/if}
</div>

<BottomTabs active="stats" />
<Toast message={toast} />

<style>
  .small {
    font-size: 12px;
  }

  .section-title {
    font-size: 15px;
  }

  .scope-tabs {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 4px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--surface-alt);
  }

  .scope-tabs button {
    min-height: 44px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--muted);
    font-weight: 650;
    font-size: 13px;
    cursor: pointer;
  }

  .scope-tabs button.active {
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 2px 10px -6px rgba(0, 0, 0, 0.5);
  }

  .meta-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .meta-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .meta-row div {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .meta-row b {
    font-size: 18px;
    font-variant-numeric: tabular-nums;
  }

  .meta-row span {
    font-size: 10.5px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .attention-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .attention-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }

  .attention-row:first-of-type {
    border-top: 0;
    padding-top: 0;
  }

  .attention-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13.5px;
    font-weight: 600;
  }

  .samples {
    line-height: 1.45;
  }

  .exam-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .exam-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
  }

  .exam-title h3 {
    font-size: 15.5px;
    letter-spacing: -0.2px;
  }

  .exam-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .exam-stats div {
    display: flex;
    flex-direction: column;
  }

  .exam-stats b {
    font-size: 16px;
    font-variant-numeric: tabular-nums;
  }

  .exam-stats span {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .histogram {
    height: 56px;
  }

  .trend-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .trend-bars {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .trend-row {
    display: flex;
    align-items: center;
    gap: 9px;
    font-size: 12px;
  }

  .trend-label {
    width: 34%;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .trend-label b {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
  }

  .trend-track {
    flex: 1;
    height: 8px;
    border-radius: 999px;
    background: var(--surface-alt);
    overflow: hidden;
  }

  .trend-track i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--neon-deep), var(--neon));
  }

  .trend-value {
    width: 30px;
    text-align: right;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
</style>
