import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

const SRC =
  'C:/Marker-td/gradevn/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png';
const OUT = 'public/icons';
const BG = '#0B0F14';

await mkdir(OUT, { recursive: true });

const meta = await sharp(SRC).metadata();
console.log(`source: ${meta.width}x${meta.height}`);

async function icon(size, file, dir = OUT) {
  await sharp(SRC)
    .resize(size, size, { fit: 'contain', background: BG })
    .flatten({ background: BG })
    .png()
    .toFile(`${dir}/${file}`);
  console.log(`wrote ${dir}/${file} (${size}x${size})`);
}

await icon(192, 'icon-192.png');
await icon(512, 'icon-512.png');
await icon(180, 'apple-touch-icon.png', 'public');

const innerSize = Math.round(512 * 0.8);
const inner = await sharp(SRC)
  .resize(innerSize, innerSize, { fit: 'contain', background: BG })
  .flatten({ background: BG })
  .png()
  .toBuffer();

await sharp({
  create: { width: 512, height: 512, channels: 3, background: BG }
})
  .composite([{ input: inner, gravity: 'center' }])
  .png()
  .toFile(`${OUT}/maskable-512.png`);
console.log(`wrote ${OUT}/maskable-512.png (512x512 maskable)`);
