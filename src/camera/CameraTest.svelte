<script lang="ts">
  import { onMount } from 'svelte';

  type LogEntry = { id: number; time: string; text: string };

  let video = $state<HTMLVideoElement | null>(null);
  let canvas = $state<HTMLCanvasElement | null>(null);
  let stream = $state<MediaStream | null>(null);
  let starting = $state(false);
  let error = $state<string | null>(null);
  let logs = $state<LogEntry[]>([]);
  let settings = $state<Record<string, unknown> | null>(null);
  let capabilities = $state<Record<string, unknown> | null>(null);
  let snapshotUrl = $state<string | null>(null);
  let snapshotInfo = $state<string | null>(null);
  let fileInfo = $state<string | null>(null);
  let videoSize = $state('—');
  let wakeState = $state('Chưa bật');

  let logId = 0;
  let wanted = false;
  let wakeLock: WakeLockSentinel | null = null;

  function log(text: string): void {
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    logs = [...logs.slice(-59), { id: ++logId, time, text }];
  }

  function describeError(e: unknown): string {
    if (!(e instanceof DOMException)) return String(e);
    switch (e.name) {
      case 'NotAllowedError':
        return 'Quyền camera bị từ chối. Vào Cài đặt → Safari → Camera để bật lại, hoặc dùng nút chọn ảnh bên dưới.';
      case 'NotFoundError':
        return 'Không tìm thấy camera trên thiết bị.';
      case 'NotReadableError':
        return 'Camera đang bị ứng dụng khác sử dụng. Đóng ứng dụng đó rồi thử lại.';
      case 'OverconstrainedError':
        return 'Không có camera phù hợp với cấu hình yêu cầu.';
      case 'SecurityError':
        return 'Cần HTTPS (hoặc localhost) để dùng camera.';
      default:
        return `${e.name}: ${e.message}`;
    }
  }

  async function acquireWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) {
      wakeState = 'Không được hỗ trợ';
      log('Screen Wake Lock không được hỗ trợ trên trình duyệt này.');
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeState = 'Đang bật';
      log('Đã bật Screen Wake Lock.');
      wakeLock.addEventListener('release', () => {
        wakeState = 'Đã tắt';
        log('Screen Wake Lock đã tắt.');
      });
    } catch (e) {
      wakeState = 'Lỗi';
      log('Wake Lock lỗi: ' + String(e));
    }
  }

  function stopStream(): void {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) video.srcObject = null;
    settings = null;
    capabilities = null;
    videoSize = '—';
    if (wakeLock) {
      void wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  async function start(): Promise<void> {
    if (starting || stream) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      error = 'Trình duyệt không hỗ trợ camera. Cần Safari iOS 16.4+ và trang chạy HTTPS.';
      return;
    }

    starting = true;
    error = null;
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 3840 },
          height: { ideal: 2160 }
        }
      });
      stream = media;
      wanted = true;

      const el = video;
      if (el) {
        el.srcObject = media;
        await el.play().catch((e) => log('play() bị chặn: ' + String(e)));
      }

      const track = media.getVideoTracks()[0];
      if (track) {
        settings = track.getSettings() as Record<string, unknown>;
        capabilities =
          typeof track.getCapabilities === 'function'
            ? (track.getCapabilities() as Record<string, unknown>)
            : null;
        track.addEventListener('ended', () =>
          log('Track camera kết thúc — có thể bị ứng dụng khác chiếm.')
        );
        log(
          `getUserMedia OK: ${String(settings.width)}×${String(settings.height)} @ ${String(
            settings.frameRate ?? '?'
          )} fps`
        );
        log(`video element: ${el?.videoWidth ?? 0}×${el?.videoHeight ?? 0}`);
        videoSize = `${el?.videoWidth ?? 0} × ${el?.videoHeight ?? 0}`;
      }
      await acquireWakeLock();
    } catch (e) {
      error = describeError(e);
      log('LỖI: ' + error);
    } finally {
      starting = false;
    }
  }

  function stopAll(): void {
    wanted = false;
    stopStream();
    log('Đã đóng camera.');
  }

  async function capture(): Promise<void> {
    const el = video;
    const c = canvas;
    if (!el || !c || !el.videoWidth) {
      log('Chưa có khung hình để chụp.');
      return;
    }
    const width = el.videoWidth;
    const height = el.videoHeight;
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const drawStart = performance.now();
    ctx.drawImage(el, 0, 0, width, height);
    const drawMs = performance.now() - drawStart;

    const encodeStart = performance.now();
    const blob = await new Promise<Blob | null>((resolve) =>
      c.toBlob(resolve, 'image/jpeg', 0.9)
    );
    const encodeMs = performance.now() - encodeStart;

    if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
    snapshotUrl = blob ? URL.createObjectURL(blob) : null;
    snapshotInfo = blob
      ? `JPEG ${width}×${height} · ${Math.round(blob.size / 1024)} KB · vẽ ${drawMs.toFixed(
          0
        )} ms · mã hoá ${encodeMs.toFixed(0)} ms`
      : 'Không tạo được JPEG.';
    log('Chụp thử: ' + snapshotInfo);
  }

  async function onFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    error = null;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const c = canvas;
      if (c) {
        c.width = bitmap.width;
        c.height = bitmap.height;
        c.getContext('2d')?.drawImage(bitmap, 0, 0);
        const blob = await new Promise<Blob | null>((resolve) =>
          c.toBlob(resolve, 'image/jpeg', 0.9)
        );
        if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
        snapshotUrl = blob ? URL.createObjectURL(blob) : null;
      }
      fileInfo = `${file.name} · ${file.type || 'MIME không rõ'} · ${bitmap.width}×${
        bitmap.height
      } · ${Math.round(file.size / 1024)} KB`;
      log('Ảnh chọn từ thư viện: ' + fileInfo);
      bitmap.close();
    } catch (e) {
      error =
        'Không giải mã được ảnh. HEIC có thể chưa được Safari hỗ trợ trong trình duyệt: ' +
        String(e);
      log('LỖI ảnh: ' + error);
    }
  }

  function handleVisibility(): void {
    if (document.visibilityState === 'hidden') {
      log('App vào nền — đóng camera để nhường thiết bị.');
      stopStream();
    } else if (wanted) {
      log('App quay lại — mở lại camera.');
      void start();
    }
  }

  onMount(() => {
    document.addEventListener('visibilitychange', handleVisibility);
    if (!window.isSecureContext) {
      error = 'Trang không chạy trong secure context — Safari yêu cầu HTTPS để mở camera.';
    }
    log('Sẵn sàng. Nhấn “Mở camera” hoặc chọn ảnh từ thư viện.');
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      wanted = false;
      stopStream();
      if (snapshotUrl) URL.revokeObjectURL(snapshotUrl);
    };
  });
</script>

<main class="page camera-test">
  <header class="head">
    <a class="back" href="#/" aria-label="Về trang chủ">‹</a>
    <div>
      <h1>Kiểm tra camera</h1>
      <p class="muted">Đo độ phân giải và chất lượng thật trên iPhone</p>
    </div>
  </header>

  {#if error}
    <div class="alert" role="alert">{error}</div>
  {/if}

  <div class="stage" class:live={!!stream}>
    <video
      bind:this={video}
      class="preview"
      playsinline
      muted
      autoplay
      onloadedmetadata={() => {
        videoSize = `${video?.videoWidth ?? 0} × ${video?.videoHeight ?? 0}`;
        log(`loadedmetadata: ${videoSize}`);
      }}
    ></video>
    {#if !stream}
      <div class="placeholder">
        <span>{starting ? 'Đang mở camera…' : 'Camera chưa mở'}</span>
      </div>
    {/if}
    {#if snapshotUrl}
      <img class="snapshot" src={snapshotUrl} alt="Ảnh chụp thử" />
    {/if}
    <span class="size-chip">video {videoSize} · wake {wakeState}</span>
  </div>

  <div class="actions">
    {#if !stream}
      <button class="btn primary" onclick={start} disabled={starting}>
        {starting ? 'Đang mở…' : 'Mở camera'}
      </button>
    {:else}
      <button class="btn primary" onclick={capture}>Chụp thử</button>
      <button class="btn" onclick={stopAll}>Đóng camera</button>
    {/if}
  </div>

  <label class="btn file-btn">
    Chọn ảnh từ thư viện
    <input
      type="file"
      accept="image/*"
      capture="environment"
      onchange={onFile}
    />
  </label>

  {#if snapshotUrl}
    <a class="btn download" href={snapshotUrl} download="gradevn-camera-test.jpg">
      Tải ảnh thử xuống
    </a>
  {/if}

  <section class="card">
    <h2>Thông số track</h2>
    <pre class="selectable">{settings ? JSON.stringify(settings, null, 2) : '—'}</pre>
    <h2>Capabilities</h2>
    <pre class="selectable">{capabilities ? JSON.stringify(capabilities, null, 2) : '—'}</pre>
    {#if snapshotInfo}<p class="info">{snapshotInfo}</p>{/if}
    {#if fileInfo}<p class="info">{fileInfo}</p>{/if}
  </section>

  <section class="card">
    <div class="log-head">
      <h2>Nhật ký</h2>
      <button class="link" onclick={() => (logs = [])}>Xoá</button>
    </div>
    {#if logs.length === 0}
      <p class="muted small">Chưa có sự kiện.</p>
    {:else}
      <ol class="logs">
        {#each logs as entry (entry.id)}
          <li><span>{entry.time}</span>{entry.text}</li>
        {/each}
      </ol>
    {/if}
  </section>

  <canvas bind:this={canvas} class="hidden-canvas"></canvas>
</main>

<style>
  .camera-test {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding-top: 6px;
  }

  .head h1 {
    font-size: 21px;
    letter-spacing: -0.4px;
  }

  .head p {
    font-size: 13px;
  }

  .back {
    width: 44px;
    height: 44px;
    flex: none;
    display: grid;
    place-items: center;
    border-radius: 14px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 28px;
    line-height: 1;
    padding-bottom: 4px;
  }

  .stage {
    position: relative;
    aspect-ratio: 3 / 4;
    border-radius: 20px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: #05080b;
  }

  .preview {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }

  .placeholder {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--muted);
    font-size: 14px;
    background:
      repeating-linear-gradient(45deg, transparent 0 14px, rgba(255, 255, 255, 0.02) 14px 28px);
  }

  .snapshot {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #05080b;
  }

  .size-chip {
    position: absolute;
    left: 10px;
    bottom: 10px;
    max-width: calc(100% - 20px);
    padding: 5px 9px;
    border-radius: 8px;
    background: rgba(3, 6, 9, 0.72);
    color: #e8f0e0;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .actions {
    display: flex;
    gap: 10px;
  }

  .actions .btn {
    flex: 1;
  }

  .file-btn,
  .download {
    cursor: pointer;
    text-align: center;
  }

  .file-btn input {
    display: none;
  }

  .download {
    color: var(--muted);
    font-weight: 500;
    font-size: 14px;
    min-height: 44px;
  }

  .card h2 {
    font-size: 12px;
    letter-spacing: 0.7px;
    text-transform: uppercase;
    color: var(--muted);
    margin: 4px 0 6px;
  }

  .card h2:first-child {
    margin-top: 0;
  }

  pre {
    margin: 0 0 10px;
    padding: 10px;
    border-radius: 12px;
    background: var(--surface-alt);
    border: 1px solid var(--border);
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11.5px;
    line-height: 1.5;
    overflow-x: auto;
    max-height: 220px;
  }

  .info {
    margin-top: 8px;
    font-size: 12.5px;
    color: var(--neon-deep);
    word-break: break-word;
  }

  .log-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .logs {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    max-height: 240px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 12.5px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .logs li {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }

  .logs span {
    flex: none;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 11px;
    color: var(--muted);
    opacity: 0.75;
  }

  .small {
    font-size: 13px;
  }
</style>
