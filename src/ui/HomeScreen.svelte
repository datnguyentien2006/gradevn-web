<script lang="ts">
  import { onMount } from 'svelte';
  import BottomTabs from './BottomTabs.svelte';
  import ScreenHead from './ScreenHead.svelte';
  import {
    listAllGradedSheets,
    listAllStudents,
    listClassRooms,
    listContests
  } from '../storage/repositories';
  import type { Contest } from '../core/types';
  import { contestSubtitle, messageOf } from './format';

  let counts = $state({ classes: 0, students: 0, contests: 0, sheets: 0 });
  let contests = $state<Contest[]>([]);
  let quickId = $state<number | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  const recent = $derived(contests.slice(0, 3));
  const quickContest = $derived(
    contests.find((contest) => contest.id === quickId) ?? null
  );
  const setupDone = $derived({
    classes: counts.classes > 0,
    students: counts.students > 0,
    contests: counts.contests > 0,
    sheets: counts.sheets > 0
  });

  async function load(): Promise<void> {
    loading = true;
    try {
      const [classes, students, list, sheets] = await Promise.all([
        listClassRooms(),
        listAllStudents(),
        listContests(),
        listAllGradedSheets()
      ]);
      counts = {
        classes: classes.length,
        students: students.length,
        contests: list.length,
        sheets: sheets.length
      };
      contests = list;
      if (quickId == null || !list.some((contest) => contest.id === quickId)) {
        quickId = list[0]?.id ?? null;
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
  });

  function scan(): void {
    if (quickId == null) return;
    location.hash = `#/scan/${quickId}`;
  }
</script>

<div class="screen">
  <ScreenHead title="GradeVN" subtitle="Chấm phiếu trắc nghiệm trên iPhone" back={null}>
    <a class="icon-button" href="#/settings" aria-label="Cài đặt">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
        />
        <path
          d="M19 13.5l1.7 1-.9 2-2-.4a7.6 7.6 0 01-1.7 1.7l.4 2-2 .9-1-1.7a7.7 7.7 0 01-2.4 0l-1 1.7-2-.9.4-2a7.6 7.6 0 01-1.7-1.7l-2 .4-.9-2 1.7-1a7.7 7.7 0 010-2.4l-1.7-1 .9-2 2 .4A7.6 7.6 0 018.2 5l-.4-2 2-.9 1 1.7a7.7 7.7 0 012.4 0l1-1.7 2 .9-.4 2a7.6 7.6 0 011.7 1.7l2-.4.9 2-1.7 1a7.7 7.7 0 010 2.4z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.4"
          stroke-linejoin="round"
        />
      </svg>
    </a>
  </ScreenHead>

  {#if error}
    <div class="alert" role="alert">{error}</div>
  {/if}

  <section class="hero-scan">
    <p class="eyebrow">QUÉT NHANH</p>
    <h2>Chấm phiếu bằng camera</h2>
    <p class="muted hero-copy">
      Chọn kỳ thi, đưa phiếu vào 4 ô căn mốc — GradeVN tự chụp và chấm.
    </p>

    {#if loading}
      <p class="muted">Đang tải dữ liệu…</p>
    {:else if contests.length === 0}
      <p class="muted">
        Chưa có kỳ thi. Tạo đề và nhập đáp án trước khi quét phiếu.
      </p>
      <a class="btn primary" href="#/contests">Tạo kỳ thi đầu tiên</a>
    {:else}
      <select class="select" bind:value={quickId} aria-label="Chọn kỳ thi để quét">
        {#each contests as contest}
          <option value={contest.id}>{contest.name}</option>
        {/each}
      </select>
      {#if quickContest}
        <p class="muted small">{contestSubtitle(quickContest, null)}</p>
      {/if}
      <div class="hero-actions">
        <button class="btn primary" onclick={scan} disabled={quickId == null}>
          Quét phiếu
        </button>
        {#if quickContest}
          <a class="btn ghost" href={`#/contests/${quickContest.id}`}>Chi tiết đề</a>
        {/if}
      </div>
    {/if}
  </section>

  <section class="kpi-grid" aria-label="Số liệu">
    <a class="kpi" href="#/classes">
      <b>{counts.classes}</b><span>Lớp học</span>
    </a>
    <a class="kpi" href="#/classes">
      <b>{counts.students}</b><span>Học sinh</span>
    </a>
    <a class="kpi" href="#/contests">
      <b>{counts.contests}</b><span>Kỳ thi</span>
    </a>
    <a class="kpi" href="#/results">
      <b>{counts.sheets}</b><span>Phiếu đã lưu</span>
    </a>
  </section>

  {#if recent.length > 0}
    <section class="stack">
      <div class="spread">
        <h2 class="section-title">Kỳ thi gần đây</h2>
        <a class="link" href="#/contests">Tất cả</a>
      </div>
      <div class="list">
        {#each recent as contest}
          <a class="list-item" href={`#/contests/${contest.id}`}>
            <div class="item-main">
              <div class="item-title">{contest.name}</div>
              <div class="item-sub">{contestSubtitle(contest, null)}</div>
            </div>
            <div class="item-side">
              <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </div>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <section class="card">
    <h2 class="section-title">Bắt đầu trong 5 bước</h2>
    <ol class="steps">
      <li class:done={setupDone.classes}>
        <a href="#/classes">Tạo lớp học</a>
        <span>Hoặc thi ngoài lớp, bỏ qua bước này.</span>
      </li>
      <li class:done={setupDone.students}>
        <a href="#/classes">Thêm học sinh</a>
        <span>Nhập tay hoặc nhập từ XLSX (cột A SBD, cột B họ tên).</span>
      </li>
      <li class:done={setupDone.contests}>
        <a href="#/contests">Tạo kỳ thi</a>
        <span>40 câu, 4 lựa chọn, thang điểm 10 mặc định.</span>
      </li>
      <li class:done={setupDone.contests}>
        <a href={quickId != null ? `#/contests/${quickId}` : '#/contests'}>Nhập đáp án</a>
        <span>Mỗi mã đề một bộ; lưu không mã đề = đáp án chung.</span>
      </li>
      <li class:done={setupDone.sheets}>
        <span>Quét phiếu và lưu kết quả</span>
        <span>Dữ liệu nằm trong IndexedDB của máy.</span>
      </li>
    </ol>
  </section>

  <p class="footnote muted">
    Ảnh và kết quả chỉ lưu trên thiết bị của bạn. Hãy sao lưu JSON định kỳ
    trong Cài đặt.
  </p>
</div>

<BottomTabs active="home" />

<style>
  .hero-scan {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 20px;
    border-radius: 24px;
    border: 1px solid var(--border);
    background:
      radial-gradient(95% 120% at 100% 0%, color-mix(in srgb, var(--neon) 15%, transparent), transparent 60%),
      linear-gradient(160deg, var(--surface), var(--surface-alt));
  }

  .eyebrow {
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 1.5px;
    color: var(--neon-deep);
  }

  .hero-scan h2 {
    font-size: 25px;
    letter-spacing: -0.6px;
    line-height: 1.18;
  }

  .hero-copy {
    font-size: 13.5px;
    line-height: 1.45;
  }

  .hero-actions {
    display: flex;
    gap: 8px;
    padding-top: 2px;
  }

  .hero-actions .btn {
    flex: 1;
  }

  .small {
    font-size: 12px;
  }

  .section-title {
    font-size: 15px;
    letter-spacing: -0.2px;
  }

  .kpi {
    color: var(--text);
  }

  .steps {
    margin: 12px 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 12px;
    counter-reset: step;
  }

  .steps li {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-left: 30px;
    font-size: 14px;
  }

  .steps li::before {
    counter-increment: step;
    content: counter(step);
    position: absolute;
    left: 0;
    top: 1px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-size: 11px;
    font-weight: 700;
    color: var(--muted);
    border: 1px solid var(--border);
  }

  .steps li.done::before {
    content: '✓';
    color: var(--ink);
    background: var(--neon);
    border-color: transparent;
  }

  .steps a {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    min-height: 44px;
    margin: -12px 0;
    font-weight: 650;
    color: var(--text);
  }

  .steps span {
    font-size: 12.5px;
    color: var(--muted);
    line-height: 1.4;
  }

  .footnote {
    font-size: 11.5px;
    line-height: 1.5;
    padding: 0 4px;
  }
</style>
