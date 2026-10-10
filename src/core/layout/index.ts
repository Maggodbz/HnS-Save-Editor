// Typed access to the generated layout (src/data/layout.json).
import layoutJson from '../../data/layout.json' with { type: 'json' };
import { readBits, readSignedBits, writeBits } from '../binary.ts';
import type { BitsField, Layout, LayoutField, RangeField, StructLayout } from './types.ts';

export const layout = layoutJson as Layout;

export function constant(name: string): number {
  const value = layout.constants[name];
  if (value === undefined) throw new Error(`Layout constant ${name} is missing — run npm run gen:layout`);
  return value;
}

export function struct(name: string): StructLayout {
  const s = layout.structs[name];
  if (!s) throw new Error(`Layout struct ${name} is missing — run npm run gen:layout`);
  return s;
}

const isBits = (f: LayoutField): f is BitsField => 'bits' in f;

export function bitsField(structName: string, field: string): BitsField {
  const f = struct(structName).fields[field];
  if (!f || !isBits(f)) throw new Error(`${structName}.${field} is not an integer field in the layout`);
  return f;
}

export function rangeField(structName: string, field: string): RangeField {
  const f = struct(structName).fields[field];
  if (!f || isBits(f)) throw new Error(`${structName}.${field} is not a byte range in the layout`);
  return f;
}

/**
 * A view of one struct instance inside a byte buffer. All reads/writes go straight to the buffer,
 * so several views can share the same underlying save block.
 */
export class StructView {
  readonly def: StructLayout;
  readonly structName: string;
  readonly buf: Uint8Array;
  readonly base: number;

  constructor(structName: string, buf: Uint8Array, base: number) {
    this.structName = structName;
    this.buf = buf;
    this.base = base;
    this.def = struct(structName);
  }

  get(field: string): number {
    return readBits(this.buf, this.base, bitsField(this.structName, field));
  }

  getSigned(field: string): number {
    return readSignedBits(this.buf, this.base, bitsField(this.structName, field));
  }

  set(field: string, value: number): void {
    writeBits(this.buf, this.base, bitsField(this.structName, field), value);
  }

  /** A live subarray over a byte-range field. */
  range(field: string): Uint8Array {
    const f = rangeField(this.structName, field);
    return this.buf.subarray(this.base + f.offset, this.base + f.offset + f.size);
  }

  rangeOffset(field: string): number {
    return this.base + rangeField(this.structName, field).offset;
  }

  bytes(): Uint8Array {
    return this.buf.subarray(this.base, this.base + this.def.size);
  }
}
