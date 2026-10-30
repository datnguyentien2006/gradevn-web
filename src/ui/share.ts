// Chia sẻ file qua Web Share API (iOS) và fallback tải xuống.

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function shareOrDownload(
  blob: Blob,
  filename: string
): Promise<ShareOutcome> {
  const data = new File([blob], filename, {
    type: blob.type || 'application/octet-stream'
  });
  const nav = navigator as Navigator & {
    canShare?: (shareData?: ShareData) => boolean;
  };
  if (nav.share && nav.canShare?.({ files: [data] })) {
    try {
      await nav.share({ files: [data], title: filename });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export async function readFileBytes(file: File): Promise<ArrayBuffer> {
  return file.arrayBuffer();
}
