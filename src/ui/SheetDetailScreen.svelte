<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import ScreenHead from './ScreenHead.svelte';
  import Toast from './Toast.svelte';
  import {
    deleteGradedSheet,
    getContest,
    getGradedSheet,
    getImageBlob,
    listAnswerKeys,
    listStudents,
    saveGradedSheet
  } from '../storage/repositories';
  import { Grader } from '../core/grader';
  import { OmrDecoder } from '../core/omrDecoder';
  import type {
    AnswerKey,
    Contest,
    GradedSheet,
    Student
  } from '../core/types';
  import {
    formatDateTime,
    formatScore,
    keyLabel,
    messageOf
  } from './format';

  let { sheetId }: { sheetId: number } = $props();

  let sheet = $state<GradedSheet | null>(null);
  let contest = $state<Contest | null>(null);
  let keys = $state<AnswerKey[]>([]);
  let roster = $state<Student[]>([]);
  let studentCode = $state('');
  let examCode = $state('');
  let studentId = $state<number | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;
  let originalUrl = $state<string | null>(null);
  let markedUrl = $state<string | null>(null);

  const keyLetters = $derived.by(() => {
    if (!sheet) return '';
    const key =
      keys.find((candidate) => candidate.id === sheet!.keyId) ??
      keys.find(
        (candidate) =>
          candidate.examCode !== '' &&
          OmrDecoder.normalizeCode(candidate.examCode) ===
            OmrDecoder.normalizeCode(sheet!.examCode)
      ) ??
      keys.find((candidate) => candidate.examCode === '') ??
      null;
    return key?.answerSequence ?? '';
  });
  const changed = $derived.by(() => {
    if (!sheet) return false;
    return (
      studentCode.trim() !== sheet.studentCode ||
      examCode.trim() !== sheet.examCode ||
      studentId !== (sheet.studentId ?? null)
    );
  });

  function notify(message: string): void {
    toast = message;
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, 3400);
  }

  function revokeUrls(): void {
    if (originalUrl) URL.revokeObjectURL(originalUrl);
    if (markedUrl) URL.revokeObjectURL(markedUrl);
    originalUrl = null;
    markedUrl = null;
  }

  async function load(): Promise<void> {
    try {
      const current = await getGradedSheet(sheetId);
      if (!current) throw new Error('Không tìm thấy phiếu.');
      const foundContest = await getContest(current.contestId);
      if (!foundContest) throw new Error('Không tìm thấy kỳ thi của phiếu.');
      const [keyRows, rosterRows] = await Promise.all([
        listAnswerKeys(current.contestId),
        foundContest.classRoomId != null
          ? listStudents(foundContest.classRoomId)
          : Promise.resolve<Student[]>([])
      ]);
      sheet = current;
      contest = foundContest;
      keys = keyRows;
      roster = rosterRows;
      studentCode = current.studentCode;
      examCode = current.examCode;
      studentId = current.studentId ?? null;

      revokeUrls();
      const [original, marked] = await Promise.all([
        getImageBlob(current.originalImagePath),
        getImageBlob(current.markedImagePath)
      ]);
      originalUrl = original ? URL.createObjectURL(original) : null;
      markedUrl = marked ? URL.createObjectURL(marked) : null;
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
      revokeUrls();
    };
  });

  onDestroy(revokeUrls);

  function updateStudentCode(event: Event): void {
    studentCode = (event.currentTarget as HTMLInputElement).value;
    const match = roster.find(
      (student) =>
        student.code.trim() === studentCode.trim() ||
        OmrDecoder.studentCodeKey(student.code) ===
          OmrDecoder.studentCodeKey(studentCode)
    );
    studentId = match?.id ?? null;
  }

  function chooseStudent(event: Event): void {
    const id = Number((event.currentTarget as HTMLSelectElement).value);
    const student = roster.find((candidate) => candidate.id === id) ?? null;
    studentId = student?.id ?? null;
    if (student) studentCode = student.code;
  }

  function updateExamCode(event: Event): void {
    examCode = (event.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 3);
  }

  async function saveAndRegrade(): Promise<void> {
    if (!sheet || !contest || saving) return;
    saving = true;
    try {
      const normalizedCode = examCode.replace(/\D/g, '').slice(0, 3);
      const chosen = sheet.chosen
        .split('')
        .map((char) => (/[A-Z]/i.test(char) ? char.toUpperCase() : null));
      let key =
        normalizedCode.length > 0
          ? Grader.selectKey(keys, normalizedCode)
          : null;
      if (!key) key = keys.find((candidate) => candidate.examCode === '') ?? null;
      const grader = new Grader();
      const result = key
        ? grader.gradeForContest(contest, key.answerSequence, chosen)
        : null;
      const flags = result
        ? result.correctFlags
            .map((flag) => (flag == null ? '?' : flag ? '1' : '0'))
            .join('')
        : sheet.correctFlags;
      const saved = await saveGradedSheet(
        {
          id: sheet.id,
          contestId: sheet.contestId,
          examCode: normalizedCode,
          studentCode: studentCode.trim(),
          chosen: sheet.chosen,
          correctFlags: flags,
          score: result ? result.score : sheet.score,
          keyId: key?.id ?? null,
          studentId,
          partScores: result ? result.partScores : sheet.partScores,
          infoImagePath: sheet.infoImagePath,
          gradedAt: sheet.gradedAt
        },
        {}
      );
      sheet = saved;
      examCode = saved.examCode;
      studentCode = saved.studentCode;
      notify(
        key
          ? `Đã lưu và chấm lại: ${formatScore(saved.score)} điểm (${keyLabel(key.examCode)}).`
          : 'Đã lưu thông tin. Không tìm thấy bộ đáp án phù hợp để chấm lại.'
      );
      await load();
    } catch (reason) {
      notify(`Không lưu được: ${messageOf(reason)}`);
    } finally {
      saving = false;
    }
  }

  async function remove(): Promise<void> {
    if (!sheet) return;
    if (!window.confirm('Xoá phiếu này cùng ảnh đã lưu? Không thể hoàn tác.')) {
      return;
    }
    try {
      const target = sheet.contestId;
      await deleteGradedSheet(sheet.id);
      location.hash = `#/results?contest=${target}`;
    } catch (reason) {
      notify(messageOf(reason));
    }
  }
</script>

<div class="screen sheet-screen">
  <ScreenHead
    title="Chi tiết phiếu"
    subtitle={sheet ? `SBD ${sheet.studentCode || '—'} · ${formatDateTime(sheet.gradedAt)}` : ''}
    back={contest ? `#/results?contest=${contest.id}` : '#/results'}
  >
    {#if sheet}
      <button class="icon-button danger" onclick={remove} aria-label="Xoá phiếu">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7h14M10 7V5h4v2M8 7l1 13h6l1-13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" />
        </svg>
      </button>
    {/if}
  </ScreenHead>

  {#if error}
    <div class="alert" role="alert">{error}</div>
  {:else if loading}
    <p class="muted">Đang tải…</p>
  {:else if sheet && contest}
    <section class="score-card card">
      {#if sheet.keyId == null}
        <h2 class="ungraded">Chưa chấm được</h2>
        <p class="muted small">Không có bộ đáp án khớp khi quét. Chọn bộ đáp án và chấm lại bên dưới.</p>
      {:else}
        <div class="score-line">
          <span class="score">{formatScore(sheet.score)}</span>
          <span class="muted">/ {formatScore(contest.maxScore)}</span>
        </div>
        <div class="chips">
          <span class="pill neon">{sheet.correctFlags.split('').filter((flag) => flag === '1').length} đúng</span>
          <span class="pill bad">{sheet.correctFlags.split('').filter((flag) => flag === '0').length} sai</span>
          <span class="pill">{sheet.correctFlags.split('').filter((flag) => flag === '?').length} trống</span>
        </div>
      {/if}
      <p class="muted small">
        {contest.name} · Mã đề {sheet.examCode || 'chung'}
        {#if keyLetters} · Đáp án {keyLetters.length} câu{/if}
      </p>
    </section>

    {#if originalUrl || markedUrl}
      <section class="card images-card">
        <h2 class="section-title">Ảnh phiếu</h2>
        <div class="sheet-images">
          {#if originalUrl}
            <figure>
              <img src={originalUrl} alt="Ảnh phiếu gốc" />
              <figcaption>Ảnh gốc</figcaption>
            </figure>
          {/if}
          {#if markedUrl}
            <figure>
              <img src={markedUrl} alt="Ảnh phiếu đã nắn phẳng" />
              <figcaption>Đã nắn phẳng</figcaption>
            </figure>
          {/if}
        </div>
      </section>
    {/if}

    <section class="card edit-card">
      <h2 class="section-title">Sửa thông tin & chấm lại</h2>
      <div class="form-grid">
        <label class="field">
          <span>Số báo danh</span>
          <input
            type="text"
            inputmode="numeric"
            value={studentCode}
            oninput={updateStudentCode}
            placeholder="000001"
          />
        </label>
        <label class="field">
          <span>Ghép học sinh trong lớp</span>
          <select value={studentId ?? ''} onchange={chooseStudent}>
            <option value="">— Không ghép —</option>
            {#each roster as student}
              <option value={student.id}>{student.code} · {student.fullName}</option>
            {/each}
          </select>
        </label>
        <label class="field">
          <span>Mã đề</span>
          <input
            type="text"
            inputmode="numeric"
            maxlength="3"
            value={examCode}
            oninput={updateExamCode}
            placeholder="001"
          />
        </label>
      </div>
      <p class="muted small">
        {#if keys.length === 0}
          Kỳ thi chưa có bộ đáp án — chỉ lưu được thông tin, chưa chấm lại được.
        {:else}
          Chấm lại dùng đúng bộ đáp án của mã đề (hoặc đáp án chung) và giữ nguyên ảnh đã lưu.
        {/if}
      </p>
      <button class="btn primary" onclick={saveAndRegrade} disabled={saving || (!changed && keys.length === 0)}>
        {saving ? 'Đang lưu…' : 'Lưu & chấm lại'}
      </button>
    </section>

    <section class="card">
      <h2 class="section-title">Đáp án từng câu</h2>
      <div class="answer-grid">
        {#each sheet.chosen.split('') as chosen, index}
          {@const flag = sheet.correctFlags[index]}
          {@const keyLetter = keyLetters[index] ?? ''}
          <div class="answer-cell" class:ok={flag === '1'} class:bad={flag === '0'} class:blank={flag === '?'}>
            <span class="q">{index + 1}</span>
            <span class="chosen">{(/[A-Z]/i.test(chosen) ? chosen : '–')}</span>
            <span class="key">{keyLetter}</span>
          </div>
        {/each}
      </div>
      <p class="muted small">Số câu · đáp án đọc được · đáp án đúng (nếu có key).</p>
    </section>
  {/if}
</div>

<Toast message={toast} />

<style>
  .small {
    font-size: 12px;
  }

  .section-title {
    font-size: 15px;
  }

  .score-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .score-line {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .score {
    font-size: 38px;
    font-weight: 800;
    letter-spacing: -1px;
    color: var(--neon-deep);
    font-variant-numeric: tabular-nums;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .images-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .edit-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .edit-card .btn {
    width: 100%;
  }

  .ungraded {
    font-size: 19px;
  }
</style>
