/** A byte range inside a struct (arrays, strings, nested structs). */
export interface RangeField {
  offset: number;
  size: number;
}

/** An integer field, possibly a bitfield: `bits` bits starting at bit `bit` of byte `offset` (little-endian). */
export interface BitsField {
  offset: number;
  bit: number;
  bits: number;
}

export type LayoutField = RangeField | BitsField;

export interface StructLayout {
  size: number;
  fields: Record<string, LayoutField>;
}

export interface Layout {
  generator: string;
  source: string;
  constants: Record<string, number>;
  structs: Record<string, StructLayout>;
}
