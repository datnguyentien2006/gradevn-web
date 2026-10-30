<script lang="ts">
  import { onMount } from 'svelte';
  import BottomTabs from './BottomTabs.svelte';
  import ScreenHead from './ScreenHead.svelte';
  import {
    addContest,
    listAnswerKeys,
    listClassRooms,
    listContests,
    listGradedSheets,
    type ContestInput
  } from '../storage/repositories';
  import type { ClassRoom, Contest, SheetFormType, SheetOrientation } from '../core/types';
  import {
    FORM_TYPE_LABELS,
    ORIENTATION_LABELS,
    contestSubtitle,
    formatDate,
    messageOf
  } from './format';

  interface ContestForm {
    name: string;
    examDate: string;
    classRoomId: number | null;
    questionCount: number;
    answerChoices: number;
    maxScore: number;
    formType: SheetFormType;
    orientation: SheetOrientation;
    partOneCount: number;
    partTwoCount: number;
    partThreeCount: number;
    partOneWeight: number;
    partTwoWeight: number;
    partThreeWeight: number;
  }

  function emptyForm(): ContestForm {
    return {
      name: '',
      examDate: new Date().toISOString().slice(0, 10),
      classRoomId: null,
      questionCount: 40,
      answerChoices: 4,
      maxScore: 10,
      formType: 'standard',
      orientation: 'portrait',
      partOneCount: 0,
      partTwoCount: 0,
      partThreeCount: 0,
      partOneWeight: 0,
      partTwoWeight: 0,
      partThreeWeight: 0
    };
  }

  let contests = $state<Contest[]>([]);
  let classes = $state<ClassRoom[]>([]);
  let counts = $state<Record<number, { keys: number; sheets: number }>>({});
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showForm = $state(false);
  let form = $state<ContestForm>(emptyForm());
  let formError = $state<string | null>(null);
  let busy = $state(false);

  const classNames = $derived(
    new Map(classes.map((room) => [room.id, room.name]))
  );

  async function load(): Promise<void> {
    try {
      const [list, rooms] = await Promise.all([listContests(), listClassRooms()]);
      const next: Record<number, { keys: number; sheets: number }> = {};
      await Promise.all(
        list.map(async (contest) => {
          const [keys, sheets] = await Promise.all([
            listAnswerKeys(contest.id),
            listGradedSheets(contest.id)
          ]);
          next[contest.id] = { keys: keys.length, sheets: sheets.length };
        })
      );
      contests = list;
      classes = rooms;
      counts = next;
      error = null;
    } catch (reason) {
      error = messageOf(reason);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  function openForm(): void {
    form = emptyForm();
    formError = null;
    showForm = true;
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    busy = true;
    formError = null;
    try {
      const ministry = form.formType === 'ministry';
      const input: ContestInput = {
        name: form.name,
        examDate: form.examDate,
        classRoomId: form.classRoomId,
        questionCount: Number(form.questionCount),
        answerChoices: Number(form.answerChoices),
        maxScore: Number(form.maxScore),
        formType: form.formType,
        orientation: form.orientation,
        partOneCount: ministry ? Number(form.partOneCount) : null,
        partTwoCount: ministry ? Number(form.partTwoCount) : null,
        partThreeCount: ministry ? Number(form.partThreeCount) : null,
        partOneWeight: ministry ? Number(form.partOneWeight) : null,
        partTwoWeight: ministry ? Number(form.partTwoWeight) : null,
        partThreeWeight: ministry ? Number(form.partThreeWeight) : null
      };
      const id = await addContest(input);
      location.hash = `#/contests/${id}`;
    } catch (reason) {
      formError = messageOf(reason);
    } finally {
      busy = false;
    }
  }
</script>

<div class="screen">
  <ScreenHead title="Kỳ thi" subtitle={`${contests.length} kỳ thi`} back={null}>
    <button class="icon-button" onclick={openForm} aria-label="Tạo kỳ thi">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </button>
  </ScreenHead>

  {#if error}
    <div class="alert" role="alert">{error}</div>
  {/if}

  {#if loading}
    <p class="muted">Đang tải…</p>
  {:else if contests.length === 0}
    <div class="empty">
      <p>Chưa có kỳ thi. Tạo đề, nhập đáp án rồi quét phiếu.</p>
      <button class="btn primary" onclick={openForm}>Tạo kỳ thi đầu tiên</button>
    </div>
  {:else}
    <div class="list">
      {#each contests as contest}
        <a class="list-item" href={`#/contests/${contest.id}`}>
          <div class="item-main">
            <div class="item-title">{contest.name}</div>
            <div class="item-sub">
              {contestSubtitle(
                contest,
                contest.classRoomId != null
                  ? classNames.get(contest.classRoomId) ?? null
                  : null
              )}
            </div>
            <div class="item-tags">
              <span class="pill">{counts[contest.id]?.keys ?? 0} đáp án</span>
              <span class="pill">{counts[contest.id]?.sheets ?? 0} phiếu</span>
            </div>
          </div>
          <div class="item-side">
            <span class="date">{formatDate(contest.examDate)}</span>
            <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
            </svg>
          </div>
        </a>
      {/each}
    </div>
  {/if}

  <p class="muted footnote">
    Mọi kiểu phiếu dùng chung khung TN40 như bản Flutter (khác biệt đã ghi trong
    LOGIC_SPEC §7.1).
  </p>
</div>

{#if showForm}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(event) => {
      if (event.target === event.currentTarget && !busy) showForm = false;
    }}
  >
    <dialog open class="modal-sheet" aria-label="Tạo kỳ thi">
      <h2>Tạo kỳ thi</h2>
      <form class="stack" onsubmit={submit}>
        <label class="field">
          <span>Tên kỳ thi</span>
          <input bind:value={form.name} placeholder="Kiểm tra giữa kỳ 1" required />
        </label>

        <div class="form-grid">
          <label class="field">
            <span>Ngày thi</span>
            <input type="date" bind:value={form.examDate} required />
          </label>
          <label class="field">
            <span>Lớp</span>
            <select bind:value={form.classRoomId}>
              <option value={null}>Ngoài lớp</option>
              {#each classes as room}
                <option value={room.id}>{room.name}</option>
              {/each}
            </select>
          </label>

          <label class="field">
            <span>Số câu</span>
            <input type="number" min="1" max="120" bind:value={form.questionCount} required />
          </label>
          <label class="field">
            <span>Số lựa chọn</span>
            <select bind:value={form.answerChoices}>
              <option value={4}>4 (A–D)</option>
              <option value={5}>5 (A–E)</option>
              <option value={2}>2 (A–B)</option>
              <option value={3}>3 (A–C)</option>
            </select>
          </label>
          <label class="field">
            <span>Điểm tối đa</span>
            <input type="number" min="0.1" step="any" bind:value={form.maxScore} required />
          </label>
          <label class="field">
            <span>Kiểu phiếu</span>
            <select bind:value={form.formType}>
              {#each Object.entries(FORM_TYPE_LABELS) as [value, label]}
                <option {value}>{label}</option>
              {/each}
            </select>
          </label>
          <label class="field wide">
            <span>Hướng phiếu</span>
            <select bind:value={form.orientation}>
              {#each Object.entries(ORIENTATION_LABELS) as [value, label]}
                <option {value}>{label}</option>
              {/each}
            </select>
          </label>
        </div>

        {#if form.formType === 'ministry'}
          <div class="ministry">
            <p class="muted small">
              Nhiều phần: nhập số câu mỗi phần và điểm tối đa mỗi phần.
            </p>
            <div class="form-grid">
              <label class="field">
                <span>Phần I — số câu</span>
                <input type="number" min="0" bind:value={form.partOneCount} />
              </label>
              <label class="field">
                <span>Phần I — điểm</span>
                <input type="number" min="0" step="0.25" bind:value={form.partOneWeight} />
              </label>
              <label class="field">
                <span>Phần II — số câu</span>
                <input type="number" min="0" bind:value={form.partTwoCount} />
              </label>
              <label class="field">
                <span>Phần II — điểm</span>
                <input type="number" min="0" step="0.25" bind:value={form.partTwoWeight} />
              </label>
              <label class="field">
                <span>Phần III — số câu</span>
                <input type="number" min="0" bind:value={form.partThreeCount} />
              </label>
              <label class="field">
                <span>Phần III — điểm</span>
                <input type="number" min="0" step="0.25" bind:value={form.partThreeWeight} />
              </label>
            </div>
          </div>
        {/if}

        {#if formError}
          <div class="alert" role="alert">{formError}</div>
        {/if}

        <div class="modal-actions">
          <button class="btn primary" type="submit" disabled={busy}>
            {busy ? 'Đang tạo…' : 'Tạo kỳ thi'}
          </button>
          <button class="btn ghost" type="button" onclick={() => (showForm = false)} disabled={busy}>
            Hủy
          </button>
        </div>
      </form>
    </dialog>
  </div>
{/if}

<BottomTabs active="contests" />

<style>
  .item-tags {
    display: flex;
    gap: 6px;
    margin-top: 6px;
    flex-wrap: wrap;
  }

  .date {
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .footnote {
    padding: 0 4px;
    font-size: 11.5px;
    line-height: 1.5;
  }

  .small {
    font-size: 12px;
  }

  .ministry {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border-radius: 14px;
    border: 1px dashed var(--border);
  }
</style>
