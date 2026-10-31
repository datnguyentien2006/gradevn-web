// Lấy pixel từ camera/thư viện ảnh. Chỉ phần decode + vẽ khung chạy trên
// main thread (video element của Safari không chuyển sang worker được);
// toàn bộ xử lý ảnh nặng nằm trong worker.

/** Giới hạn tiền giải mã, khớp `_kPredecodeMaxWidth` của Dart. */
export const PREDECODE_MAX_WIDTH = 2000;

/**
 * Bề rộng khung quét mốc live — khớp `_previewTargetWidth = 640` của
 * scan_screen.dart. Cùng cỡ mẫu với APK để ngưỡng cỡ blob (tính theo px
 * của ô) hành xử như nhau.
 */
export const PROBE_MAX_WIDTH = 640;

export interface DecodedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export class ImageDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageDecodeError';
  }
}

let sharedCanvas: HTMLCanvasElement | null = null;
let sharedContext: CanvasRenderingContext2D | null = null;

function context(width: number, height: number): CanvasRenderingContext2D {
  if (!sharedCanvas) sharedCanvas = document.createElement('canvas');
  if (!sharedContext) {
    const ctx = sharedCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new ImageDecodeError('Trình duyệt không tạo được canvas 2D.');
    sharedContext = ctx;
  }
  sharedCanvas.width = width;
  sharedCanvas.height = height;
  return sharedContext;
}

/** Lấy 1 khung từ video, thu về tối đa [maxWidth] px. */
export function captureVideoFrame(
  video: HTMLVideoElement,
  maxWidth = PREDECODE_MAX_WIDTH
): DecodedImage {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) {
    throw new ImageDecodeError('Camera chưa có khung hình.');
  }
  const scale = Math.min(1, maxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = context(width, height);
  ctx.drawImage(video, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

/** Thu nhỏ ảnh đã decode (dùng cho ảnh debug + hậu kỳ). */
export function downscaleImage(
  image: DecodedImage,
  maxWidth: number
): DecodedImage {
  if (image.width <= maxWidth) return image;
  const scale = maxWidth / image.width;
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.width;
  sourceCanvas.height = image.height;
  const sourceCtx = sourceCanvas.getContext('2d');
  if (!sourceCtx) throw new ImageDecodeError('Trình duyệt không tạo được canvas 2D.');
  sourceCtx.putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0
  );
  const targetCanvas = document.createElement('canvas');
  targetCanvas.width = width;
  targetCanvas.height = height;
  const targetCtx = targetCanvas.getContext('2d');
  if (!targetCtx) throw new ImageDecodeError('Trình duyệt không tạo được canvas 2D.');
  targetCtx.drawImage(sourceCanvas, 0, 0, width, height);
  return {
    data: targetCtx.getImageData(0, 0, width, height).data,
    width,
    height
  };
}

/**
 * Decode ảnh từ thư viện (JPEG/PNG/HEIC nếu Safari hỗ trợ), áp EXIF đúng
 * chiều. Ưu tiên `createImageBitmap({ imageOrientation: 'from-image' })`;
 * lùi về `createImageBitmap(file)` rồi `<img>` — cả hai đường đều để trình
 * duyệt tự áp EXIF khi vẽ canvas.
 */
export async function decodeImageFile(
  file: File,
  maxWidth = PREDECODE_MAX_WIDTH
): Promise<DecodedImage> {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      bitmap = null;
    }
  }
  if (bitmap) {
    try {
      return drawSource(bitmap, bitmap.width, bitmap.height, maxWidth);
    } finally {
      bitmap.close();
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return drawSource(image, image.naturalWidth, image.naturalHeight, maxWidth);
  } catch {
    throw new ImageDecodeError(
      'Không giải mã được ảnh này. HEIC có thể chưa được Safari hỗ trợ — hãy chụp bằng camera hoặc chọn ảnh JPEG/PNG.'
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawSource(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  maxWidth: number
): DecodedImage {
  if (!sourceWidth || !sourceHeight) {
    throw new ImageDecodeError('Ảnh không có kích thước hợp lệ.');
  }
  const scale = Math.min(1, maxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = context(width, height);
  ctx.drawImage(source, 0, 0, width, height);
  return { data: ctx.getImageData(0, 0, width, height).data, width, height };
}

/** Ảnh xám planar (kết quả nắn phẳng) → ImageData xám để vẽ canvas. */
export function grayToImageData(
  gray: Uint8ClampedArray,
  width: number,
  height: number
): ImageData {
  const image = new ImageData(width, height);
  const out = image.data;
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const value = gray[i];
    out[j] = value;
    out[j + 1] = value;
    out[j + 2] = value;
    out[j + 3] = 255;
  }
  return image;
}
