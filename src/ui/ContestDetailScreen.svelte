<script lang="ts">
  import { onMount } from 'svelte';
  import ScreenHead from './ScreenHead.svelte';
  import Toast from './Toast.svelte';
  import {
    deleteAnswerKey,
    deleteContest,
    getClassRoom,
    getContest,
    listAnswerKeys,
    listGradedSheets,
    listStudents,
    upsertAnswerKey
  } from '../storage/repositories';
  import { readFileBytes, shareOrDownload, type ShareOutcome } from './share';
  import type { AnswerKey, ClassRoom, Contest, GradedSheet, Student } from '../core/types';
  import {
    FORM_TYPE_LABELS,
    ORIENTATION_LABELS,
    formatDate,
    formatScore,
    keyLabel,
    messageOf
  } from './format';

  let { contestId }: { contestId: number } = $props();

  let contest = $state<Contest | null>(null);
  let room = $state<ClassRoom | null>(null);
  let keys = $state<AnswerKey[]>([]);
  let sheets = $state<GradedSheet[]>([]);
  let students = $state<Student[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;
  let fileInput = $state<HTMLInputElement | null>(null);
  let importing = $state(false);
  let exporting = $state(false);

  const gradedCount = $derived(sheets.filter((sheet) => sheet.keyId != null).length);
  const average = $derived.by(() => {
    if (!contest || gradedCount === 0) return null;
    const total = sheets
      .filter((sheet) => sheet.keyId != null)
      .reduce(
        (sum, sheet) =>
          sum + Math.max(0, Math.min(10, (sheet.score / contest!.maxScore) * 10)),
        0
      );
    return total / gradedCount;
  });
  const subtitle = $derived(
    contest
      ? `${formatDate(contest.examDate)} · ${
          contest.classRoomId == null ? 'Ngoài lớp' : room?.name ?? 'Lớp'
        }`
      : ''
  );

  function notify(message: string): void {
    toast = message;
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, 3600);
  }

  function outcomeText(outcome: ShareOutcome): string {
    if (outcome === 'shared') return 'Đã mở bảng chia sẻ.';
    if (outcome === 'cancelled') return 'Đã hủy chia sẻ.';
    return 'Đã tải file xuống.';
  }

  async function load(): Promise<void> {
    try {
      const current = await getContest(contestId);
      if (!current) throw new Error('Không tìm thấy kỳ thi.');
      const [rosterClass, keyRows, sheetRows] = await Promise.all([
        current.classRoomId != null ? getClassRoom(current.classRoomId) : Promise.resolve(null),
        listAnswerKeys(contestId),
        listGradedSheets(contestId)
      ]);
      const roster =
        current.classRoomId != null ? await listStudents(current.classRoomId) : [];
      contest = current;
      room = rosterClass;
      keys = keyRows;
      sheets = sheetRows;
      students = roster;
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

  function pickKeysFile(): void {
    fileInput?.click();
  }

  async function onKeysFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || importing) return;
    importing = true;
    try {
      const { readKeysWorkbook } = await import('../storage/xlsx');
      const rows = readKeysWorkbook(await readFileBytes(file));
      if (rows.length === 0) {
        notify('Không đọc được bộ đáp án nào trong file.');
        return;
      }
      for (const row of rows) {
        await upsertAnswerKey({
          contestId,
          examCode: row.examCode,
          answerSequence: row.answerSequence
        });
      }
      await load();
      notify(`Đã nhập ${rows.length} bộ đáp án (trùng mã đề được ghi đè).`);
    } catch (reason) {
      notify(`Lỗi nhập đáp án: ${messageOf(reason)}`);
    } finally {
      importing = false;
    }
  }

  async function exportKeys(): Promise<void> {
    if (!contest || keys.length === 0 || exporting) return;
    exporting = true;
    try {
      const { sanitizeFileName, workbookBytes, writeKeysWorkbook } =
        await import('../storage/xlsx');
      const bytes = workbookBytes(writeKeysWorkbook(keys));
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const outcome = await shareOrDownload(
        blob,
        `${sanitizeFileName(contest.name)}-dap-an.xlsx`
      );
      notify(outcomeText(outcome));
    } catch (reason) {
      notify(`Không xuất được: ${messageOf(reason)}`);
    } finally {
      exporting = false;
    }
  }

  async function exportResults(): Promise<void> {
    if (!contest || sheets.length === 0 || exporting) return;
    exporting = true;
    try {
      const { sanitizeFileName, workbookBytes, writeResultsWorkbook } =
        await import('../storage/xlsx');
      const bytes = workbookBytes(writeResultsWorkbook(contest, sheets));
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

  async function removeKey(key: AnswerKey): Promise<void> {
    if (!window.confirm(`Xoá ${keyLabel(key.examCode)}? Phiếu đã chấm vẫn giữ điểm.`)) {
      return;
    }
    try {
      await deleteAnswerKey(key.id);
      await load();
      notify('Đã xoá bộ đáp án.');
    } catch (reason) {
      notify(messageOf(reason));
    }
  }

  async function removeContest(): Promise<void> {
    if (!contest) return;
    if (
      !window.confirm(
        `Xoá kỳ thi “${contest.name}” cùng toàn bộ đáp án, phiếu và ảnh đã lưu? Không thể hoàn tác.`
      )
    ) {
      return;
    }
    try {
      await deleteContest(contestId);
      location.hash = '#/contests';
    } catch (reason) {
      notify(messageOf(reason));
    }
  }
</script>

<div class="screen">
  <ScreenHead title={contest?.name ?? 'Kỳ thi'} subtitle={subtitle} back="#/contests">
    <a class="icon-button" href={`#/contests/${contestId}/key`} aria-label="Thêm đáp án">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </a>
  </ScreenHead>

  {#if error}
    <div class="alert" role="alert">{error}</div>
  {:else if loading}
    <p class="muted">Đang tải…</p>
  {:else if contest}
    <section class="contest-card">
      <div class="contest-tags">
        <span class="pill neon">{FORM_TYPE_LABELS[contest.formType]}</span>
        <span class="pill">{ORIENTATION_LABELS[contest.orientation]}</span>
        <span class="pill">{contest.questionCount} câu · {contest.answerChoices} lựa chọn</span>
        <span class="pill">Tối đa {formatScore(contest.maxScore)} điểm</span>
      </div>
      <div class="quick-stats">
        <div><b>{students.length}</b><span>học sinh</span></div>
        <div><b>{keys.length}</b><span>đáp án</span></div>
        <div><b>{sheets.length}</b><span>phiếu</span></div>
        <div><b>{average == null ? '—' : average.toFixed(1)}</b><span>TB /10</span></div>
      </div>
      <a class="btn primary" href={`#/scan/${contest.id}`}>Quét phiếu</a>
      <p class="muted scan-hint">
        {#if keys.length === 0}
          Chưa có đáp án — phiếu sẽ chỉ được quét, chưa có điểm.
        {:else if students.length === 0 && contest.classRoomId != null}
          Lớp chưa có học sinh — SBD sẽ không được ghép với sổ điểm.
        {:else}
          {keys.length} bộ đáp án sẵn sàng · {students.length} học sinh trong sổ.
        {/if}
      </p>
    </section>

    {#if keys.length === 0}
      <div class="notice warn">
        Kỳ thi chưa có đáp án. Nhập tay hoặc nhập từ XLSX (cột A mã đề, cột B.. đáp án).
      </div>
    {/if}

    <section class="stack">
      <div class="spread">
        <h2 class="section-title">Bộ đáp án</h2>
        <a class="link" href={`#/contests/${contestId}/key`}>Thêm</a>
      </div>
      {#if keys.length === 0}
        <div class="empty"><p>Chưa có bộ đáp án nào.</p></div>
      {:else}
        <div class="list">
          {#each keys as key}
            <div class="list-item key-row">
              <a class="item-main" href={`#/contests/${contestId}/key/${key.id}`}>
                <div class="item-title">{keyLabel(key.examCode)}</div>
                <div class="item-sub">
                  {key.answerSequence.replace(/[^A-Z]/g, '').length}/{contest.questionCount} câu đã nhập
                </div>
              </a>
              <button class="icon-button small danger" onclick={() => removeKey(key)} aria-label="Xoá đáp án">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M5 7h14M10 7V5h4v2M8 7l1 13h6l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
                </svg>
              </button>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <section class="stack">
      <h2 class="section-title">Kết quả & dữ liệu</h2>
      <a class="list-item" href={`#/results?contest=${contestId}`}>
        <div class="item-main">
          <div class="item-title">Xem kết quả</div>
          <div class="item-sub">{sheets.length} phiếu · {gradedCount} đã chấm</div>
        </div>
        <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
        </svg>
      </a>
      <button class="list-item" onclick={exportResults} disabled={sheets.length === 0 || exporting}>
        <div class="item-main">
          <div class="item-title">Xuất kết quả XLSX</div>
          <div class="item-sub">Sheet “Results” đúng định dạng bản Flutter</div>
        </div>
        <span class="pill">XLSX</span>
      </button>
      <button class="list-item" onclick={pickKeysFile} disabled={importing}>
        <div class="item-main">
          <div class="item-title">Nhập đáp án XLSX</div>
          <div class="item-sub">Cột A mã đề, cột B.. đáp án</div>
        </div>
        <span class="pill">{importing ? 'Đang đọc…' : 'XLSX'}</span>
      </button>
      <button class="list-item" onclick={exportKeys} disabled={keys.length === 0 || exporting}>
        <div class="item-main">
          <div class="item-title">Xuất đáp án XLSX</div>
          <div class="item-sub">Sheet “Exam code”</div>
        </div>
        <span class="pill">XLSX</span>
      </button>
    </section>

    <section class="card danger-zone">
      <h3>Xoá kỳ thi</h3>
      <p class="muted small">
        Xoá luôn đáp án, phiếu đã chấm và ảnh phiếu. Không thể hoàn tác.
      </p>
      <button class="btn danger small" onclick={removeContest}>Xoá kỳ thi</button>
    </section>
  {/if}
</div>

<input
  bind:this={fileInput}
  type="file"
  accept=".xlsx,.xls,.csv"
  class="hidden-input"
  onchange={onKeysFile}
/>

<Toast message={toast} />

<style>
  .contest-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border-radius: 20px;
    border: 1px solid var(--border);
    background:
      radial-gradient(90% 120% at 100% 0%, color-mix(in srgb, var(--neon) 12%, transparent), transparent 60%),
      linear-gradient(160deg, var(--surface), var(--surface-alt));
  }

  .contest-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .quick-stats {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    padding: 6px 0;
  }

  .quick-stats div {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .quick-stats b {
    font-size: 19px;
    letter-spacing: -0.4px;
    font-variant-numeric: tabular-nums;
  }

  .quick-stats span {
    font-size: 10.5px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .scan-hint {
    font-size: 12px;
    line-height: 1.45;
  }

  .section-title {
    font-size: 15px;
  }

  .key-row {
    padding: 0;
    cursor: default;
    overflow: hidden;
  }

  .key-row .item-main {
    display: block;
    padding: 12px 14px;
    color: var(--text);
    min-width: 0;
  }

  .key-row .icon-button {
    margin-right: 8px;
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

  .link {
    font-size: 13px;
    font-weight: 600;
    color: var(--neon-deep);
  }
</style>
