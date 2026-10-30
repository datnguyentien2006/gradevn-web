<script lang="ts">
  import { onMount } from 'svelte';
  import ScreenHead from './ScreenHead.svelte';
  import Toast from './Toast.svelte';
  import {
    deleteAnswerKey,
    getAnswerKey,
    getContest,
    upsertAnswerKey
  } from '../storage/repositories';
  import type { Contest } from '../core/types';
  import { formatScore, messageOf } from './format';

  let {
    contestId,
    keyId = null
  }: { contestId: number; keyId?: number | null } = $props();

  const EXAM_SLOTS = 3;
  const LETTERS = ['A', 'B', 'C', 'D', 'E'];

  let contest = $state<Contest | null>(null);
  let digits = $state<(number | null)[]>([null, null, null]);
  let answers = $state<(string | null)[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;

  const examCode = $derived(
    digits.map((digit) => (digit == null ? '?' : `${digit}`)).join('')
  );
  const codeComplete = $derived(digits.every((digit) => digit != null));
  const unanswered = $derived(answers.filter((answer) => answer == null).length);
  const eOnPaper = $derived((contest?.answerChoices ?? 4) >= 5);

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
      const current = await getContest(contestId);
      if (!current) throw new Error('Không tìm thấy kỳ thi.');
      contest = current;
      const existing = keyId != null ? await getAnswerKey(keyId) : null;
      if (existing && existing.contestId !== contestId) {
        throw new Error('Bộ đáp án không thuộc kỳ thi này.');
      }
      if (existing) {
        const code = existing.examCode.replace(/\D/g, '').slice(0, EXAM_SLOTS);
        digits = Array.from({ length: EXAM_SLOTS }, (_, index) =>
          code[index] ? Number(code[index]) : null
        );
      }
      const sequence = existing?.answerSequence ?? '';
      answers = Array.from({ length: current.questionCount }, (_, index) => {
        const letter = sequence[index];
        return letter && /[A-Z]/i.test(letter) ? letter.toUpperCase() : null;
      });
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

  function toggleDigit(slot: number, value: number): void {
    digits = digits.map((digit, index) =>
      index === slot ? (digit === value ? null : value) : digit
    );
  }

  function toggleAnswer(question: number, letter: string): void {
    answers = answers.map((answer, index) =>
      index === question ? (answer === letter ? null : letter) : answer
    );
  }

  async function save(): Promise<void> {
    if (!contest || saving) return;
    let code = digits.every((digit) => digit != null)
      ? digits.join('')
      : '';
    if (!codeComplete) {
      const common = window.confirm(
        'Mã đề chưa đủ 3 chữ số.\n\nLưu làm bộ đáp án CHUNG (không dùng mã đề)? ' +
          'Phiếu không đọc được mã đề vẫn chấm được bằng bộ đáp án này.'
      );
      if (!common) {
        notify(`Cần đủ ${EXAM_SLOTS} chữ số của mã đề, hoặc lưu làm đáp án chung.`);
        return;
      }
      code = '';
    }
    if (unanswered > 0) {
      const confirmed = window.confirm(
        `Còn ${unanswered} câu chưa chọn đáp án.\n\nVẫn lưu? Các câu này sẽ được ghi '-' và không tính điểm.`
      );
      if (!confirmed) return;
    }
    saving = true;
    try {
      await upsertAnswerKey({
        id: keyId ?? undefined,
        contestId,
        examCode: code,
        answerSequence: answers.map((answer) => answer ?? '-').join('')
      });
      location.hash = `#/contests/${contestId}`;
    } catch (reason) {
      notify(`Không lưu được: ${messageOf(reason)}`);
    } finally {
      saving = false;
    }
  }

  async function remove(): Promise<void> {
    if (keyId == null) return;
    if (!window.confirm('Xoá bộ đáp án này? Phiếu đã chấm vẫn giữ điểm.')) {
      return;
    }
    try {
      await deleteAnswerKey(keyId);
      location.hash = `#/contests/${contestId}`;
    } catch (reason) {
      notify(messageOf(reason));
    }
  }
</script>

<div class="screen key-editor">
  <ScreenHead
    title={keyId == null ? 'Thêm bộ đáp án' : 'Sửa bộ đáp án'}
    subtitle={contest ? `${contest.name} · ${contest.questionCount} câu` : ''}
    back={`#/contests/${contestId}`}
  >
    {#if keyId != null}
      <button class="icon-button danger" onclick={remove} aria-label="Xoá bộ đáp án">
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
  {:else if contest}
    <section class="card code-card">
      <p class="muted small">MÃ ĐỀ</p>
      <p class="code-preview"><b>{examCode}</b></p>
      <p class="muted small">Chọn từng chữ số 0–9 cho 3 vị trí. Chưa chọn đủ sẽ hỏi lưu làm đáp án chung.</p>
      {#each Array(EXAM_SLOTS) as _, slot}
        <div class="digit-slot">
          <span class="slot-label">Vị trí {slot + 1}</span>
          <div class="digit-grid">
            {#each Array(10) as _, value}
              <button
                type="button"
                class="digit-btn"
                class:active={digits[slot] === value}
                onclick={() => toggleDigit(slot, value)}
                aria-pressed={digits[slot] === value}
                aria-label={`Chữ số ${value} vị trí ${slot + 1}`}
              >
                {value}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </section>

    <section class="card answers-card">
      <div class="spread">
        <h2 class="section-title">Đáp án</h2>
        <span class="pill">{answers.length - unanswered}/{answers.length} câu</span>
      </div>
      {#if !eOnPaper}
        <p class="notice warn small">
          Phiếu của đề này chỉ có {contest.answerChoices} lựa chọn — ô E vẫn chọn được nhưng không có trên phiếu in.
        </p>
      {/if}
      <div class="answers-list">
        {#each answers as answer, question}
          <div class="answer-row">
            <span class="qnum">{question + 1}</span>
            <div class="options">
              {#each LETTERS as letter}
                <button
                  type="button"
                  class="option-btn"
                  class:active={answer === letter}
                  class:dimmed={letter === 'E' && !eOnPaper}
                  onclick={() => toggleAnswer(question, letter)}
                  aria-pressed={answer === letter}
                  aria-label={`Câu ${question + 1} chọn ${letter}`}
                >
                  {letter}
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <p class="muted small note">
        Chạm lần nữa vào ô đã chọn để bỏ. Câu bỏ trống được lưu là “-”.
        Điểm tối đa {formatScore(contest.maxScore)}.
      </p>
    </section>

    <div class="save-bar">
      <button class="btn primary" onclick={save} disabled={saving}>
        {saving ? 'Đang lưu…' : 'Lưu bộ đáp án'}
      </button>
    </div>
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

  .code-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .code-preview {
    font-size: 40px;
    font-weight: 800;
    letter-spacing: 8px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .digit-slot {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 6px;
  }

  .slot-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .answers-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .answers-list {
    display: flex;
    flex-direction: column;
  }

  .options {
    flex: 1;
    display: flex;
    gap: 7px;
    justify-content: flex-end;
  }

  .option-btn.dimmed {
    opacity: 0.55;
    border-style: dashed;
  }

  .note {
    line-height: 1.45;
  }

  .save-bar {
    position: sticky;
    bottom: calc(var(--tabbar, 0px) + env(safe-area-inset-bottom, 0px));
    padding: 10px 0 18px;
    background: linear-gradient(180deg, transparent, var(--bg) 32%);
  }

  .save-bar .btn {
    width: 100%;
  }
</style>
