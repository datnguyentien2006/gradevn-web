// Client gọi Web Worker chấm ảnh. Singleton — worker sống suốt phiên.
// Ảnh RGBA được transfer (zero-copy) sang worker; buffer phía gọi bị detach.

import type { AnswerKey, Contest, Student } from '../core/types';
import type {
  FrameSizeDto,
  GradeRequest,
  GradeResponse,
  GradeSuccessResponse,
  ImageBufferDto,
  ProbeRequest,
  ProbeResponse,
  RectDto,
  WorkerRequest,
  WorkerResponse
} from './protocol';

export interface ImageLike {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface GradeParams {
  image: ImageLike;
  contest: Contest;
  keys: AnswerKey[];
  students: Student[];
  overlayRects: RectDto[] | null;
  frameSize: FrameSizeDto | null;
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export class OmrWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OmrWorkerError';
  }
}

export class OmrWorkerClient {
  private worker: Worker | null = null;
  private sequence = 0;
  private pending = new Map<number, Pending>();

  probe(
    image: ImageLike,
    rects: RectDto[],
    frameSize: FrameSizeDto
  ): Promise<ProbeResponse> {
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    const message: ProbeRequest = {
      type: 'probe',
      id,
      image: toImageBuffer(image),
      rects,
      frameSize
    };
    return this.send(worker, message, [message.image.data]) as Promise<ProbeResponse>;
  }

  async grade(params: GradeParams): Promise<GradeSuccessResponse | null> {
    const worker = this.ensureWorker();
    const id = ++this.sequence;
    const message: GradeRequest = {
      type: 'grade',
      id,
      image: toImageBuffer(params.image),
      contest: params.contest,
      keys: params.keys,
      students: params.students,
      overlayRects: params.overlayRects,
      frameSize: params.frameSize
    };
    const response = (await this.send(worker, message, [
      message.image.data
    ])) as GradeResponse;
    return response.type === 'grade-result' ? response : null;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./omr.worker.ts', import.meta.url), {
      type: 'module',
      name: 'gradevn-omr'
    });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.type === 'error') {
        pending.reject(new OmrWorkerError(message.message));
      } else {
        pending.resolve(message);
      }
    };
    worker.onerror = (event) => {
      const error = new OmrWorkerError(
        event.message || 'Worker xử lý ảnh gặp lỗi.'
      );
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      worker.terminate();
      this.worker = null;
    };
    this.worker = worker;
    return worker;
  }

  private send(
    worker: Worker,
    message: WorkerRequest,
    transfer: Transferable[]
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, { resolve, reject });
      try {
        worker.postMessage(message, transfer);
      } catch (error) {
        this.pending.delete(message.id);
        reject(error instanceof Error ? error : new OmrWorkerError(String(error)));
      }
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      pending.reject(new OmrWorkerError('Worker đã đóng.'));
    }
    this.pending.clear();
  }
}

function toImageBuffer(image: ImageLike): ImageBufferDto {
  const { data } = image;
  let buffer: ArrayBuffer;
  if (
    data.byteOffset === 0 &&
    data.byteLength === data.buffer.byteLength &&
    data.buffer instanceof ArrayBuffer
  ) {
    buffer = data.buffer;
  } else {
    buffer = data.slice().buffer as ArrayBuffer;
  }
  return { data: buffer, width: image.width, height: image.height };
}

export const omrWorker = new OmrWorkerClient();

if (import.meta.hot) {
  import.meta.hot.dispose(() => omrWorker.dispose());
}
