// GBA graphics helpers: BIOS LZ77 decompression, BGR555 palettes and 4bpp tiled images → RGBA.

export function lz77Decompress(src: Uint8Array): Uint8Array {
  if (src[0] !== 0x10) throw new Error(`Not LZ77 data (header 0x${src[0]?.toString(16)})`);
  const size = src[1]! | (src[2]! << 8) | (src[3]! << 16);
  const out = new Uint8Array(size);
  let s = 4;
  let d = 0;
  while (d < size) {
    const flags = src[s++]!;
    for (let bit = 7; bit >= 0 && d < size; bit--) {
      if (flags & (1 << bit)) {
        const b1 = src[s++]!;
        const b2 = src[s++]!;
        const length = (b1 >> 4) + 3;
        const disp = (((b1 & 0xf) << 8) | b2) + 1;
        for (let i = 0; i < length && d < size; i++, d++) out[d] = out[d - disp]!;
      } else {
        out[d++] = src[s++]!;
      }
    }
  }
  return out;
}

export type Rgba = [number, number, number, number];

/** 16-colour BGR555 palette; index 0 is transparent. */
export function decodePalette(data: Uint8Array): Rgba[] {
  const colors: Rgba[] = [];
  const expand = (v: number) => (v << 3) | (v >> 2);
  for (let i = 0; i < 16; i++) {
    const c = data[i * 2]! | (data[i * 2 + 1]! << 8);
    colors.push([expand(c & 0x1f), expand((c >> 5) & 0x1f), expand((c >> 10) & 0x1f), i === 0 ? 0 : 255]);
  }
  return colors;
}

/** Decodes a 4bpp image laid out as 8x8 tiles, `widthPx` wide, into RGBA pixels. */
export function decode4bpp(tiles: Uint8Array, widthPx: number, heightPx: number, palette: Rgba[]): Uint8Array {
  const rgba = new Uint8Array(widthPx * heightPx * 4);
  const tilesPerRow = widthPx / 8;
  for (let ty = 0; ty < heightPx / 8; ty++) {
    for (let tx = 0; tx < tilesPerRow; tx++) {
      const tileBase = (ty * tilesPerRow + tx) * 32;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const byte = tiles[tileBase + y * 4 + (x >> 1)] ?? 0;
          const index = x & 1 ? byte >> 4 : byte & 0xf;
          rgba.set(palette[index]!, ((ty * 8 + y) * widthPx + tx * 8 + x) * 4);
        }
      }
    }
  }
  return rgba;
}

/** RGBA canvas used to assemble sprite atlases (fixed-size cells in a grid). */
export class Atlas {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly cell: number;
  readonly columns: number;

  constructor(cell: number, columns: number, count: number) {
    this.cell = cell;
    this.columns = columns;
    this.width = cell * columns;
    this.height = cell * Math.ceil(count / columns);
    this.pixels = new Uint8Array(this.width * this.height * 4);
  }

  put(index: number, src: Uint8Array, srcWidth: number, srcHeight: number) {
    const dx = (index % this.columns) * this.cell;
    const dy = Math.floor(index / this.columns) * this.cell;
    const w = Math.min(srcWidth, this.cell);
    const h = Math.min(srcHeight, this.cell);
    for (let y = 0; y < h; y++) {
      this.pixels.set(src.subarray(y * srcWidth * 4, y * srcWidth * 4 + w * 4), ((dy + y) * this.width + dx) * 4);
    }
  }
}
