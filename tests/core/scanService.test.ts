// Quét ảnh fixture qua đúng đường warp/verify/đo của service.
// Nguồn Dart: lib/data/cv/scan_service.dart, lib/data/cv/scan_flow.dart.

import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { AlignmentQuad, Rect, Size } from '../../src/core/geometry';
import { OmrScanService } from '../../src/core/scanService';
import { SheetLayout } from '../../src/core/sheetLayout';
import type { SheetSpec } from '../../src/core/types';
import { readFileSync } from 'node:fs';

interface ExpectedFixture {
  spec: SheetSpec;
  studentCodeRaw: string;
  examCodeRaw: string;
  answers: (string | null)[];
  expected: { score: number };
}

const fixtureRoot = join(process.cwd(), 'tests', 'fixtures');

function loadExpected(name: string): ExpectedFixture {
  return JSON.parse(readFileSync(join(fixtureRoot, 'expected', `${name}.json`), 'utf8')) as ExpectedFixture;
}

async function loadRgba(name: string) {
  const { data, info } = await sharp(join(fixtureRoot, 'generated', `${name}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

describe('OmrScanService.scanPhoto', () => {
  it('knownQuad (already rectified page) reproduces fixture answers exactly', async () => {
    const expected = loadExpected('standard40');
    const image = await loadRgba('standard40');
    const layout = SheetLayout.forSpec(expected.spec, SheetLayout.standardPage);
    const corners = layout.cornerMarkerCenters;
    const quad = new AlignmentQuad(corners[0], corners[1], corners[2], corners[3]);

    const photo = new OmrScanService().scanPhoto(image, {
      spec: expected.spec,
      knownQuad: quad
    });
    expect(photo).not.toBeNull();
    expect(photo!.verification).toBeNull();
    expect(photo!.scan.studentCodeRaw).toBe(expected.studentCodeRaw);
    expect(photo!.scan.examCodeRaw).toBe(expected.examCodeRaw);
    expect(photo!.scan.answers).toEqual(expected.answers);
  });

  it('detector path finds the marker frame and verifies the warp', async () => {
    const expected = loadExpected('standard40');
    const image = await loadRgba('standard40');

    const photo = new OmrScanService().scanPhoto(image, {
      spec: expected.spec
    });
    expect(photo).not.toBeNull();
    expect(photo!.verification).not.toBeNull();
    expect(photo!.verification!.passed).toBe(true);
    expect(photo!.scan.studentCodeRaw).toBe(expected.studentCodeRaw);
    expect(photo!.scan.examCodeRaw).toBe(expected.examCodeRaw);
    expect(photo!.scan.answers).toEqual(expected.answers);
  });

  it('pinned overlayRects locate the four blobs and reproduce fixture answers', async () => {
    const expected = loadExpected('standard40');
    const image = await loadRgba('standard40');
    const layout = SheetLayout.forSpec(expected.spec, SheetLayout.standardPage);
    const centers = layout.cornerMarkerCenters;
    // Ô ghim rộng 10% ảnh quanh từng mốc — mô phỏng ô giáo viên canh tay.
    const rects = centers.map(
      (c) =>
        new Rect(
          c.dx / image.width - 0.05,
          c.dy / image.height - 0.05,
          c.dx / image.width + 0.05,
          c.dy / image.height + 0.05
        )
    );

    const photo = new OmrScanService().scanPhoto(image, {
      spec: expected.spec,
      overlayRects: rects,
      frameSize: new Size(image.width, image.height)
    });
    expect(photo).not.toBeNull();
    // Quad quét-trong-ô là quad TIN CẬY → bỏ kiểm chứng round-trip.
    expect(photo!.verification).toBeNull();
    const corners = photo!.quad.corners;
    for (let i = 0; i < 4; i++) {
      expect(Math.hypot(corners[i].dx - centers[i].dx, corners[i].dy - centers[i].dy)).toBeLessThan(6);
    }
    expect(photo!.scan.answers).toEqual(expected.answers);
  });
});
