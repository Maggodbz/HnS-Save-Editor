// Minimal ELF32 (little-endian) reader: symbol table + reading bytes at a virtual address.
import fs from 'node:fs';

export interface ElfSymbol {
  name: string;
  value: number;
  size: number;
  local: boolean;
}

interface Segment { vaddr: number; offset: number; filesz: number }

export class Elf {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  private readonly segments: Segment[] = [];
  private readonly globals = new Map<string, ElfSymbol>();
  private readonly locals = new Map<string, ElfSymbol[]>();

  constructor(file: string) {
    this.bytes = new Uint8Array(fs.readFileSync(file));
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    const magic = this.view.getUint32(0, false);
    if (magic !== 0x7f454c46 || this.bytes[4] !== 1 || this.bytes[5] !== 1) {
      throw new Error(`${file} is not a little-endian ELF32 file`);
    }
    this.readSegments();
    this.readSymbols();
  }

  private readSegments() {
    const phoff = this.view.getUint32(0x1c, true);
    const phentsize = this.view.getUint16(0x2a, true);
    const phnum = this.view.getUint16(0x2c, true);
    for (let i = 0; i < phnum; i++) {
      const p = phoff + i * phentsize;
      if (this.view.getUint32(p, true) !== 1) continue; // PT_LOAD
      this.segments.push({
        offset: this.view.getUint32(p + 4, true),
        vaddr: this.view.getUint32(p + 8, true),
        filesz: this.view.getUint32(p + 16, true),
      });
    }
  }

  private readSymbols() {
    const shoff = this.view.getUint32(0x20, true);
    const shentsize = this.view.getUint16(0x2e, true);
    const shnum = this.view.getUint16(0x30, true);
    const section = (i: number) => {
      const s = shoff + i * shentsize;
      return {
        type: this.view.getUint32(s + 4, true),
        offset: this.view.getUint32(s + 16, true),
        size: this.view.getUint32(s + 20, true),
        link: this.view.getUint32(s + 24, true),
        entsize: this.view.getUint32(s + 36, true),
      };
    };
    for (let i = 0; i < shnum; i++) {
      const sh = section(i);
      if (sh.type !== 2) continue; // SHT_SYMTAB
      const strtab = section(sh.link);
      for (let off = sh.offset; off < sh.offset + sh.size; off += sh.entsize) {
        const nameOff = this.view.getUint32(off, true);
        const info = this.bytes[off + 12]!;
        const type = info & 0xf;
        if (type !== 1 && type !== 2) continue; // OBJECT or FUNC
        const sym: ElfSymbol = {
          name: this.cString(strtab.offset + nameOff),
          value: this.view.getUint32(off + 4, true),
          size: this.view.getUint32(off + 8, true),
          local: info >> 4 === 0,
        };
        if (sym.local) {
          const list = this.locals.get(sym.name) ?? [];
          list.push(sym);
          this.locals.set(sym.name, list);
        } else {
          this.globals.set(sym.name, sym);
        }
      }
    }
  }

  private cString(offset: number): string {
    let end = offset;
    while (this.bytes[end] !== 0) end++;
    return new TextDecoder('latin1').decode(this.bytes.subarray(offset, end));
  }

  /** Global symbol, or a static (local) symbol if its name is unique. */
  symbol(name: string): ElfSymbol {
    const g = this.globals.get(name);
    if (g) return g;
    const l = this.locals.get(name);
    if (l && l.length === 1) return l[0]!;
    if (l && l.length > 1) throw new Error(`Symbol ${name} is ambiguous (${l.length} static definitions)`);
    throw new Error(`Symbol ${name} not found in ELF`);
  }

  /** Bytes at a virtual address (ROM data only). */
  read(vaddr: number, length: number): Uint8Array {
    for (const s of this.segments) {
      if (vaddr >= s.vaddr && vaddr + length <= s.vaddr + s.filesz) {
        const start = s.offset + (vaddr - s.vaddr);
        return this.bytes.subarray(start, start + length);
      }
    }
    throw new Error(`Address 0x${vaddr.toString(16)} (+${length}) is not in a loaded segment`);
  }

  /** Up to `maxLength` bytes at an address, clamped to the end of its segment (for compressed data). */
  readAvailable(vaddr: number, maxLength: number): Uint8Array {
    for (const s of this.segments) {
      if (vaddr >= s.vaddr && vaddr < s.vaddr + s.filesz) {
        const start = s.offset + (vaddr - s.vaddr);
        return this.bytes.subarray(start, start + Math.min(maxLength, s.vaddr + s.filesz - vaddr));
      }
    }
    throw new Error(`Address 0x${vaddr.toString(16)} is not in a loaded segment`);
  }

  readSymbol(name: string): Uint8Array {
    const s = this.symbol(name);
    return this.read(s.value, s.size);
  }

  u8(vaddr: number): number {
    return this.read(vaddr, 1)[0]!;
  }

  u16(vaddr: number): number {
    const b = this.read(vaddr, 2);
    return b[0]! | (b[1]! << 8);
  }

  u32(vaddr: number): number {
    const b = this.read(vaddr, 4);
    return (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
  }
}
