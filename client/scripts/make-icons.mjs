// Génère les icônes PNG de la PWA sans dépendance externe.
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const BLUE = [0x3b, 0x82, 0xd4];
const DARK = [0x1d, 0x4f, 0x91];
const WHITE = [0xff, 0xff, 0xff];

function pixel(u, v, rounded) {
  // u, v dans [0,1]
  if (rounded) {
    const r = 0.22;
    const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0);
    const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0);
    if (dx * dx + dy * dy > r * r) return [0, 0, 0, 0];
  }
  const inBody = u >= 0.22 && u <= 0.78 && v >= 0.25 && v <= 0.77;
  if (!inBody) return [...BLUE, 255];
  if (v <= 0.38) return [...DARK, 255];
  const cell = (cu, cv) => u >= cu && u <= cu + 0.12 && v >= cv && v <= cv + 0.09;
  if (cell(0.31, 0.47) || cell(0.5, 0.47) || cell(0.31, 0.62)) return [...BLUE, 255];
  return [...WHITE, 255];
}

function png(size, rounded) {
  const row = size * 4 + 1;
  const raw = Buffer.alloc(row * size);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size, rounded);
      const o = y * row + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(join(out, 'icon-192.png'), png(192, true));
writeFileSync(join(out, 'icon-512.png'), png(512, true));
writeFileSync(join(out, 'icon-maskable-512.png'), png(512, false));
writeFileSync(join(out, 'apple-touch-icon.png'), png(180, false));
console.log('Icônes générées dans', out);
