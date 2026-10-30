<script lang="ts">
  import { onMount } from 'svelte';
  import ScreenHead from './ScreenHead.svelte';
  import Toast from './Toast.svelte';
  import {
    createBackup,
    clearAllData,
    restoreBackup
  } from '../storage/backup';
  import {
    requestPersistence,
    storageStatus,
    type StorageStatus
  } from '../storage/db';
  import { shareOrDownload, type ShareOutcome } from './share';
  import { messageOf } from './format';

  let status = $state<StorageStatus | null>(null);
  let includeImages = $state(true);
  let busy = $state<string | null>(null);
  let toast = $state<string | null>(null);
  let toastTimer: number | null = null;
  let restoreInput = $state<HTMLInputElement | null>(null);
  let counts = $state<Record<string, number> | null>(null);
  let standalone = $state(false);

  function notify(message: string): void {
    toast = message;
    if (toastTimer != null) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast = null;
      toastTimer = null;
    }, 3800);
  }

  function outcomeText(outcome: ShareOutcome): string {
    if (outcome === 'shared') return 'Đã mở bảng chia sẻ.';
    if (outcome === 'cancelled') return 'Đã hủy chia sẻ.';
    return 'Đã tải file xuống.';
  }

  function formatBytes(value: number | null): string {
    if (value == null) return '—';
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function refresh(): Promise<void> {
    status = await storageStatus();
  }

  onMount(() => {
    void refresh();
    standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return () => {
      if (toastTimer != null) window.clearTimeout(toastTimer);
    };
  });

  async function persist(): Promise<void> {
    const granted = await requestPersistence();
    await refresh();
    notify(
      granted
        ? 'Đã xin được lưu trữ bền vững — trình duyệt ít xoá dữ liệu hơn.'
        : 'Trình duyệt chưa cấp lưu trữ bền vững. Hãy cài app lên Màn hình chính rồi thử lại.'
    );
  }

  async function exportBackup(): Promise<void> {
    if (busy) return;
    busy = 'backup';
    try {
      const backup = await createBackup({ images: includeImages });
      counts = backup.counts;
      const outcome = await shareOrDownload(backup.blob, backup.filename);
      notify(outcomeText(outcome));
    } catch (reason) {
      notify(`Không tạo được bản sao lưu: ${messageOf(reason)}`);
    } finally {
      busy = null;
    }
  }

  function pickRestore(): void {
    restoreInput?.click();
  }

  async function onRestoreFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || busy) return;
    if (
      !window.confirm(
        'Phục hồi sẽ THAY THẾ toàn bộ dữ liệu hiện tại bằng nội dung file sao lưu.\n\nTiếp tục?'
      )
    ) {
      return;
    }
    busy = 'restore';
    try {
      const result = await restoreBackup(file);
      await refresh();
      location.hash = '#/';
      notify(
        `Đã phục hồi: ${result.classes} lớp, ${result.students} học sinh, ${result.contests} kỳ thi, ${result.keys} đáp án, ${result.sheets} phiếu.`
      );
    } catch (reason) {
      notify(`Không phục hồi được: ${messageOf(reason)}`);
    } finally {
      busy = null;
    }
  }

  async function clearData(): Promise<void> {
    if (busy) return;
    const typed = window.prompt(
      'Xoá TOÀN BỘ lớp, học sinh, kỳ thi, đáp án, phiếu và ảnh trên máy này?\n\n' +
        'Không thể hoàn tác. Gõ XOA để xác nhận.'
    );
    if (typed?.trim().toUpperCase() !== 'XOA') return;
    busy = 'clear';
    try {
      await clearAllData();
      await refresh();
      counts = null;
      notify('Đã xoá toàn bộ dữ liệu trên máy.');
    } catch (reason) {
      notify(`Không xoá được: ${messageOf(reason)}`);
    } finally {
      busy = null;
    }
  }

  function enableDebug(): void {
    const url = new URL(location.href);
    url.searchParams.set('debug', '1');
    url.hash = '#/settings';
    location.href = url.toString();
  }
</script>

<div class="screen settings-screen">
  <ScreenHead title="Cài đặt" subtitle="Dữ liệu chỉ nằm trên máy của bạn" back="#/" />

  <section class="card storage-card">
    <div class="spread">
      <h2 class="section-title">Lưu trữ</h2>
      <span class="pill" class:neon={status?.persisted}>
        {status == null
          ? 'Đang kiểm tra…'
          : !status.supported
            ? 'Không hỗ trợ'
            : status.persisted
              ? 'Bền vững'
              : 'Tạm thời'}
      </span>
    </div>
    <div class="usage">
      <div><b>{formatBytes(status?.usage ?? null)}</b><span>đang dùng</span></div>
      <div><b>{formatBytes(status?.quota ?? null)}</b><span>hạn mức</span></div>
    </div>
    <p class="muted small">
      Ảnh phiếu chiếm nhiều dung lượng nhất. Nếu chưa bền vững, trình duyệt có thể
      tự xoá dữ liệu khi máy thiếu chỗ — hãy sao lưu định kỳ.
    </p>
    {#if status?.supported && !status.persisted}
      <button class="btn ghost small" onclick={persist}>Xin lưu trữ bền vững</button>
    {/if}
  </section>

  <section class="stack">
    <h2 class="section-title">Sao lưu & khôi phục</h2>
    <label class="toggle-row">
      <span>
        <b>Kèm ảnh phiếu</b>
        <small class="muted">File JSON lớn hơn nhưng phục hồi đủ ảnh gốc/đã nắn.</small>
      </span>
      <input type="checkbox" bind:checked={includeImages} />
    </label>
    <button class="list-item" onclick={exportBackup} disabled={busy != null}>
      <div class="item-main">
        <div class="item-title">Xuất bản sao lưu JSON</div>
        <div class="item-sub">
          {counts
            ? `${counts.classes} lớp · ${counts.students} học sinh · ${counts.contests} kỳ thi · ${counts.sheets} phiếu`
            : 'Toàn bộ dữ liệu, chia sẻ qua Files hoặc tải xuống'}
        </div>
      </div>
      <span class="pill">{busy === 'backup' ? 'Đang tạo…' : 'JSON'}</span>
    </button>
    <button class="list-item" onclick={pickRestore} disabled={busy != null}>
      <div class="item-main">
        <div class="item-title">Phục hồi từ file JSON</div>
        <div class="item-sub">Thay thế toàn bộ dữ liệu hiện tại</div>
      </div>
      <span class="pill">{busy === 'restore' ? 'Đang đọc…' : 'Chọn file'}</span>
    </button>
  </section>

  <section class="stack">
    <h2 class="section-title">Cài trên iPhone</h2>
    <div class="card install-card">
      {#if standalone}
        <p><b>Đang chạy dạng app.</b> GradeVN đã được thêm vào Màn hình chính và mở toàn màn hình.</p>
      {:else}
        <ol>
          <li>Mở trang này bằng <b>Safari</b>.</li>
          <li>Nhấn nút <b>Chia sẻ</b> (ô vuông có mũi tên lên).</li>
          <li>Chọn <b>Thêm vào Màn hình chính</b>.</li>
          <li>Mở GradeVN từ biểu tượng để chạy toàn màn hình và dùng offline.</li>
        </ol>
      {/if}
    </div>
  </section>

  <section class="stack">
    <h2 class="section-title">Kiểm tra & gỡ lỗi</h2>
    <a class="list-item" href="#/camera-test">
      <div class="item-main">
        <div class="item-title">Kiểm tra camera</div>
        <div class="item-sub">Độ phân giải, frame rate, chụp thử</div>
      </div>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </a>
    <a class="list-item" href="#/scan">
      <div class="item-main">
        <div class="item-title">Chế độ đề thử</div>
        <div class="item-sub">Quét bằng mã đề và đáp án nhập tay, không lưu vào kỳ thi</div>
      </div>
      <svg class="chev" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
    </a>
    <button class="list-item" onclick={enableDebug}>
      <div class="item-main">
        <div class="item-title">Bật bảng gỡ lỗi eruda</div>
        <div class="item-sub">Mở lại trang với ?debug=1 — dùng khi không có Safari Inspector</div>
      </div>
      <span class="pill">Debug</span>
    </button>
  </section>

  <section class="card danger-zone">
    <h3>Xoá toàn bộ dữ liệu</h3>
    <p class="muted small">
      Xoá lớp, học sinh, kỳ thi, đáp án, phiếu và ảnh đã lưu trên thiết bị này.
      Hãy xuất bản sao lưu trước. Không thể hoàn tác.
    </p>
    <button class="btn danger small" onclick={clearData} disabled={busy != null}>
      {busy === 'clear' ? 'Đang xoá…' : 'Xoá toàn bộ dữ liệu'}
    </button>
  </section>

  <p class="about muted small">
    GradeVN Web 0.1.0 · Thuật toán chấm điểm port từ bản Flutter.
    Không có máy chủ — ảnh và điểm không rời khỏi thiết bị.
  </p>
</div>

<input
  bind:this={restoreInput}
  type="file"
  accept=".json,application/json"
  class="hidden-input"
  onchange={onRestoreFile}
/>

<Toast message={toast} />

<style>
  .small {
    font-size: 12px;
  }

  .section-title {
    font-size: 15px;
  }

  .storage-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .usage {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .usage div {
    display: flex;
    flex-direction: column;
  }

  .usage b {
    font-size: 18px;
    font-variant-numeric: tabular-nums;
  }

  .usage span {
    font-size: 10.5px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }

  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--surface);
  }

  .toggle-row span {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13.5px;
  }

  .toggle-row input {
    width: 24px;
    height: 24px;
    accent-color: var(--neon-deep);
    flex: none;
  }

  .install-card {
    font-size: 13.5px;
    line-height: 1.55;
  }

  .install-card ol {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
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

  .about {
    text-align: center;
    padding: 6px 12px 10px;
    line-height: 1.5;
  }
</style>
