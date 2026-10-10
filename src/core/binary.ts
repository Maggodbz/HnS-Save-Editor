// Little-endian integer and bitfield access on byte buffers.
import type { BitsField } from './layout/types.ts';

export function u16(buf: Uint8Array, offset: number): number {
  return buf[offset]! | (buf[offset + 1]! << 8);
}

export function u32(buf: Uint8Array, offset: number): number {
  return (buf[offset]! | (buf[offset + 1]! << 8) | (buf[offset + 2]! << 16) | (buf[offset + 3]! << 24)) >>> 0;
}

export function setU16(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
}

export function setU32(buf: Uint8Array, offset: number, value: number): void {
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = (value >>> 24) & 0xff;
}

const pow2 = (n: number) => 2 ** n;

/** Reads an unsigned (bit)field. Works for widths up to 32 bits at any bit offset. */
export function readBits(buf: Uint8Array, base: number, f: BitsField): number {
  const byteCount = Math.ceil((f.bit + f.bits) / 8);
  let raw = 0;
  for (let i = byteCount - 1; i >= 0; i--) raw = raw * 256 + buf[base + f.offset + i]!;
  return Math.floor(raw / pow2(f.bit)) % pow2(f.bits);
}

/** Writes an unsigned (bit)field, leaving all neighbouring bits untouched. Throws if the value does not fit. */
export function writeBits(buf: Uint8Array, base: number, f: BitsField, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value >= pow2(f.bits)) {
    throw new RangeError(`Value ${value} does not fit in a ${f.bits}-bit field`);
  }
  const byteCount = Math.ceil((f.bit + f.bits) / 8);
  let raw = 0;
  for (let i = byteCount - 1; i >= 0; i--) raw = raw * 256 + buf[base + f.offset + i]!;
  const low = raw % pow2(f.bit);
  const high = Math.floor(raw / pow2(f.bit + f.bits));
  raw = (high * pow2(f.bits) + value) * pow2(f.bit) + low;
  for (let i = 0; i < byteCount; i++) {
    buf[base + f.offset + i] = raw % 256;
    raw = Math.floor(raw / 256);
  }
}

/** Reads a field as a signed integer (two's complement over its width). */
export function readSignedBits(buf: Uint8Array, base: number, f: BitsField): number {
  const v = readBits(buf, base, f);
  return v >= pow2(f.bits - 1) ? v - pow2(f.bits) : v;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
