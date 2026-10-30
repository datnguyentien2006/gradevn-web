// Kiểm tra hình học: homography, detector mốc, warp — đối chiếu Dart.
// Nguồn Dart: lib/data/cv/sheet_alignment.dart.

import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { AlignmentQuad, Offset, Size } from '../../src/core/geometry';
import {
  applyHomography,
  PerspectiveWarper,
  SheetMarkerDetector,
  solveHomography
} from '../../src/core/sheetAlignment';
import { SheetLayout } from '../../src/core/sheetLayout';

const fixtureRoot = join(process.cwd(), 'tests', 'fixtures');

async function loadRgba(name: string) {
  const { data, info } = await sharp(join(fixtureRoot, 'generated', `${name}.png`))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

describe('homography', () => {
  it('maps the four corners exactly (same formula as Dart)', () => {
    const from = [
      new Offset(10, 20),
      new Offset(300, 25),
      new Offset(295, 410),
      new Offset(12, 400)
    ];
    const to = [new Offset(0, 0), new Offset(100, 0), new Offset(100, 140), new Offset(0, 140)];
    const h = solveHomography(from, to);
    for (let i = 0; i < 4; i++) {
      const p = applyHomography(h, from[i].dx, from[i].dy);
      expect(p.dx).toBeCloseTo(to[i].dx, 6);
      expect(p.dy).toBeCloseTo(to[i].dy, 6);
    }
  });
});

describe('SheetMarkerDetector on standard fixture', () => {
  it('finds four corner markers close to the template positions', async () => {
    const image = await loadRgba('standard40');
    const detector = new SheetMarkerDetector();
    const detection = detector.detectRgba(image.data, image.width, image.height);

    expect(detection.candidates.length).toBeGreaterThanOrEqual(4);
    expect(detection.quad).not.toBeNull();

    const layout = SheetLayout.forSpec(
      { formType: 'standard', orientation: 'portrait', questionCount: 40, answerChoices: 4, maxScore: 10 },
      SheetLayout.standardPage
    );
    const expected = layout.cornerMarkerCenters;
    const actual = detection.quad!.corners;
    for (let i = 0; i < 4; i++) {
      expect(actual[i].distanceTo(expected[i])).toBeLessThan(3);
    }
  });
});

describe('PerspectiveWarper', () => {
  it('identity warp keeps the standard page pixels (detector quad → template)', async () => {
    const image = await loadRgba('standard40');
    const layout = SheetLayout.forSpec(
      { formType: 'standard', orientation: 'portrait', questionCount: 40, answerChoices: 4, maxScore: 10 },
      SheetLayout.standardPage
    );
    const corners = layout.cornerMarkerCenters;
    const quad = new AlignmentQuad(corners[0], corners[1], corners[2], corners[3]);
    const warped = new PerspectiveWarper().warpGrayPlanar({
      srcGray: image.data,
      srcWidth: image.width,
      srcHeight: image.height,
      srcChannels: 4,
      quad,
      targetQuad: quad,
      outputSize: new Size(image.width, image.height)
    });
    expect(warped.width).toBe(1576);
    expect(warped.height).toBe(2205);
    for (let i = 0; i < image.width * image.height; i += 997) {
      expect(warped.gray[i]).toBe(image.data[i * 4]);
    }
  });
});
