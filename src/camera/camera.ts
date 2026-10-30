// Mở/đóng camera và Screen Wake Lock — các phần iOS Safari dễ vỡ.

export class CameraOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CameraOpenError';
  }
}

export function describeCameraError(error: unknown): string {
  if (!(error instanceof DOMException)) return String(error);
  switch (error.name) {
    case 'NotAllowedError':
      return 'Quyền camera bị từ chối. Vào Cài đặt → Safari → Camera để bật lại, hoặc chọn ảnh từ thư viện.';
    case 'NotFoundError':
      return 'Không tìm thấy camera trên thiết bị.';
    case 'NotReadableError':
      return 'Camera đang bị ứng dụng khác sử dụng. Đóng ứng dụng đó rồi thử lại.';
    case 'OverconstrainedError':
      return 'Không có camera phù hợp với cấu hình yêu cầu.';
    case 'SecurityError':
      return 'Cần HTTPS (hoặc localhost) để dùng camera.';
    default:
      return `${error.name}: ${error.message}`;
  }
}

/**
 * Mở camera sau, yêu cầu ideal 1920×1080 (cao hơn nếu máy hỗ trợ).
 * Trả stream đã gắn vào video; ném CameraOpenError với thông báo tiếng Việt.
 */
export async function openCameraStream(
  video: HTMLVideoElement
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraOpenError(
      'Trình duyệt không hỗ trợ camera. Cần Safari iOS 16.4+ và trang chạy HTTPS.'
    );
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      }
    });
  } catch (error) {
    throw new CameraOpenError(describeCameraError(error));
  }

  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch {
    // iOS có thể cần thêm một cú chạm; UI sẽ hiện nút "Bật camera".
    stream.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
    throw new CameraOpenError(
      'Safari chặn phát video. Nhấn “Bật camera” để thử lại.'
    );
  }
  return stream;
}

export function stopCameraStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export interface TrackDescription {
  width: number;
  height: number;
  frameRate: number | null;
  facingMode: string | null;
  label: string;
}

export function describeTrack(stream: MediaStream | null): TrackDescription | null {
  const track = stream?.getVideoTracks()[0];
  if (!track) return null;
  const settings = track.getSettings();
  return {
    width: Math.round(settings.width ?? 0),
    height: Math.round(settings.height ?? 0),
    frameRate: settings.frameRate ?? null,
    facingMode: settings.facingMode ?? null,
    label: track.label || 'camera'
  };
}

export class WakeLockKeeper {
  private sentinel: WakeLockSentinel | null = null;
  private supported =
    typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  private active = false;

  get available(): boolean {
    return this.supported;
  }

  get held(): boolean {
    return this.sentinel != null && !this.sentinel.released;
  }

  async acquire(): Promise<boolean> {
    this.active = true;
    if (!this.supported || this.sentinel) return this.held;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
      return true;
    } catch {
      return false;
    }
  }

  async release(): Promise<void> {
    this.active = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel) {
      try {
        await sentinel.release();
      } catch {
        // bỏ qua — thiết bị đã tự nhả khoá.
      }
    }
  }

  /** Gọi khi quay lại foreground: chỉ xin lại nếu đang trong màn quét. */
  async reacquireIfActive(): Promise<void> {
    if (this.active && !this.held) await this.acquire();
  }
}
