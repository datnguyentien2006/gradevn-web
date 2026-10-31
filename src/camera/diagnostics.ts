// Xuất gói chẩn đoán từ iPhone: PNG (khung gốc, ROI ngưỡng, ảnh nắn) + JSON
// qua share sheet của iOS; nếu trình duyệt không chia sẻ tệp được thì tải về.

export interface DiagnosticFile {
  name: string;
  blob: Blob;
}

export function timestampSlug(date = new Date()): string {
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function jsonBlob(value: unknown): Blob {
  return new Blob([JSON.stringify(value, null, 2)], {
    type: 'application/json'
  });
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Không tạo được PNG từ canvas.'));
    }, 'image/png');
  });
}

/** RGBA (đã transfer từ worker) → PNG, phóng to gần nhất nếu quá nhỏ. */
export async function rgbaToPng(
  data: ArrayBuffer | Uint8ClampedArray,
  width: number,
  height: number,
  minWidth = 0
): Promise<Blob> {
  const sourceData =
    data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data);
  const pixels = new Uint8ClampedArray(sourceData.length);
  pixels.set(sourceData);
  const expected = width * height * 4;
  if (pixels.length !== expected) {
    throw new Error(
      `ROI hỏng: ${width}×${height} cần ${expected} byte nhưng có ${pixels.length}.`
    );
  }
  const scale = minWidth > 0 ? Math.max(1, Math.ceil(minWidth / width)) : 1;
  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const sourceCtx = source.getContext('2d');
  if (!sourceCtx) throw new Error('Canvas 2D không khả dụng.');
  sourceCtx.putImageData(new ImageData(pixels, width, height), 0, 0);
  if (scale === 1) return canvasToPng(source);
  const target = document.createElement('canvas');
  target.width = width * scale;
  target.height = height * scale;
  const targetCtx = target.getContext('2d');
  if (!targetCtx) throw new Error('Canvas 2D không khả dụng.');
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.drawImage(source, 0, 0, target.width, target.height);
  return canvasToPng(target);
}

export interface ShareOutcome {
  shared: boolean;
  downloaded: boolean;
  error: string | null;
}

/**
 * Chia sẻ nhiều tệp qua share sheet iOS. Nếu không hỗ trợ/chia sẻ lỗi thì
 * tải từng tệp xuống (Safari lưu vào Tệp/Downloads).
 */
export async function shareDiagnosticFiles(
  files: DiagnosticFile[],
  title: string,
  text: string
): Promise<ShareOutcome> {
  const shareFiles = files.map(
    (file) => new File([file.blob], file.name, { type: file.blob.type })
  );
  const nav = navigator as Navigator & {
    canShare?: (data: { files?: File[] }) => boolean;
    share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
  };
  if (nav.share && nav.canShare?.({ files: shareFiles })) {
    try {
      await nav.share({ files: shareFiles, title, text });
      return { shared: true, downloaded: false, error: null };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { shared: false, downloaded: false, error: 'abort' };
      }
      // Rơi xuống tải tệp.
    }
  }
  let downloaded = false;
  for (const file of files) {
    try {
      const url = URL.createObjectURL(file.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file.name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      downloaded = true;
    } catch (error) {
      return {
        shared: false,
        downloaded,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
  return { shared: false, downloaded, error: null };
}
