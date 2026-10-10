// Low-level format: bitfields, sectors/slots, Pokémon encryption.
import { describe, expect, it } from 'vitest';
import { readBits, writeBits } from '../src/core/binary.ts';
import { struct } from '../src/core/layout/index.ts';
import { CHUNKS, parseFlash, readBlocks, sectorChecksum, writeBlocks } from '../src/core/save/flash.ts';
import { BoxMon, BOX_MON_SIZE, PartyMon, SUBSTRUCT_POSITIONS } from '../src/core/pokemon/boxmon.ts';
import { boxRaw, partyCount, partyRaw, BOX_COUNT, BOX_SLOTS } from '../src/core/pokemon/storage.ts';
import { buildFlash, fixtureSaves, rng, syntheticBlocks, syntheticSave } from './helpers.ts';

describe('bitfields', () => {
  it('round-trips random values without touching neighbouring bits', () => {
    const r = rng(42);
    for (let n = 0; n < 2000; n++) {
      const bits = 1 + Math.floor(r() * 32);
      const bit = Math.floor(r() * 8);
      const buf = new Uint8Array(8).map(() => Math.floor(r() * 256));
      const before = buf.slice();
      const value = Math.floor(r() * 2 ** bits);
      const f = { offset: 1, bit, bits };
      writeBits(buf, 0, f, value);
      expect(readBits(buf, 0, f)).toBe(value);
      // Every bit outside the field is unchanged.
      for (let i = 0; i < 64; i++) {
        const inField = i >= 8 + bit && i < 8 + bit + bits;
        if (!inField) expect((buf[i >> 3]! >> (i & 7)) & 1).toBe((before[i >> 3]! >> (i & 7)) & 1);
      }
    }
  });

  it('rejects values that do not fit', () => {
    expect(() => writeBits(new Uint8Array(4), 0, { offset: 0, bit: 0, bits: 5 }, 32)).toThrow();
    expect(() => writeBits(new Uint8Array(4), 0, { offset: 0, bit: 0, bits: 5 }, -1)).toThrow();
  });
});

describe('layout', () => {
  it('has the struct sizes the save format depends on', () => {
    expect(struct('BoxPokemon').size).toBe(80);
    expect(struct('Pokemon').size).toBe(100);
    expect(CHUNKS).toHaveLength(14);
    expect(CHUNKS.every((c) => c.size > 0 && c.size <= 4084)).toBe(true);
  });
});

describe('flash: synthetic saves', () => {
  it('picks the newer slot, like GetSaveValidStatus', () => {
    const a = syntheticBlocks({ seed: 1 });
    const b = syntheticBlocks({ seed: 2 });
    expect(parseFlash(buildFlash({ blocks: a, counter: 10 }, { blocks: b, counter: 11 })).activeSlot).toBe(1);
    expect(parseFlash(buildFlash({ blocks: a, counter: 12 }, { blocks: b, counter: 11 })).activeSlot).toBe(0);
    // Counter wrap-around: 0 is newer than 0xFFFFFFFF
    expect(parseFlash(buildFlash({ blocks: a, counter: 0xffffffff }, { blocks: b, counter: 0 })).activeSlot).toBe(1);
    expect(parseFlash(buildFlash({ blocks: a, counter: 0 }, { blocks: b, counter: 0xffffffff })).activeSlot).toBe(0);
  });

  it('finds chunks by id regardless of sector rotation', () => {
    const blocks = syntheticBlocks();
    for (let rotation = 0; rotation < 14; rotation++) {
      const img = parseFlash(buildFlash({ blocks, counter: 1, rotation }, null));
      expect(img.status).toBe('ok');
      const read = readBlocks(img);
      expect(read.saveBlock1).toEqual(blocks.saveBlock1);
      expect(read.storage).toEqual(blocks.storage);
    }
  });

  it('falls back to the other slot when a sector is damaged', () => {
    const file = buildFlash({ blocks: syntheticBlocks(), counter: 20 }, { blocks: syntheticBlocks({ seed: 3 }), counter: 19 });
    file[100] = file[100]! ^ 0xff; // corrupt a sector of slot A (checksum no longer matches)
    const img = parseFlash(file);
    expect(img.slots[0].status).toBe('error');
    expect(img.activeSlot).toBe(1);
    expect(img.status).toBe('error'); // the game reports this too, but loads slot B
  });

  it('reports empty and corrupt files', () => {
    expect(parseFlash(new Uint8Array(0x20000).fill(0xff)).status).toBe('empty');
    const file = buildFlash({ blocks: syntheticBlocks(), counter: 1 }, null);
    file[10] = file[10]! ^ 1;
    expect(parseFlash(file).status).toBe('corrupt');
    expect(() => parseFlash(new Uint8Array(1000))).toThrow();
  });

  it('writes only changed sectors and keeps everything else byte-identical', () => {
    const file = syntheticSave();
    const img = parseFlash(file);
    const blocks = readBlocks(img);
    expect(writeBlocks(img, blocks).changedSectors).toEqual([]);
    blocks.storage[5000] = blocks.storage[5000]! ^ 0x55;
    const { bytes, changedSectors } = writeBlocks(img, blocks);
    expect(changedSectors).toHaveLength(1);
    const [sector] = changedSectors;
    for (let i = 0; i < bytes.length; i++) {
      if (i >= sector! * 4096 && i < (sector! + 1) * 4096) continue;
      if (bytes[i] !== file[i]) throw new Error(`byte ${i} changed outside the edited sector`);
    }
    const re = parseFlash(bytes);
    expect(re.status).toBe('ok');
    expect(re.activeSlot).toBe(img.activeSlot);
    expect(readBlocks(re).storage).toEqual(blocks.storage);
    expect(Array.from(bytes.subarray(0x20000))).toEqual(Array(16).fill(0xab)); // emulator trailer kept
  });

  it('computes the folded 16-bit checksum', () => {
    const data = new Uint8Array(8);
    data.set([0xff, 0xff, 0xff, 0xff, 0x01, 0x00, 0x00, 0x00]);
    // sum = 0xffffffff + 1 = 0 (mod 2^32) → folded 0
    expect(sectorChecksum(data, 8)).toBe(0);
    data.set([0x34, 0x12, 0x78, 0x56], 4);
    // sum = 0xffffffff + 0x56781234 = 0x56781233 → 0x5678 + 0x1233
    expect(sectorChecksum(data, 8)).toBe((0x5678 + 0x1233) & 0xffff);
  });
});

describe('Pokémon encoding', () => {
  it('round-trips every substruct order', () => {
    expect(SUBSTRUCT_POSITIONS).toHaveLength(24);
    const base = PartyMon.decode(partyRaw(syntheticBlocks().saveBlock1, 0)).box;
    for (let order = 0; order < 24; order++) {
      const m = base.clone();
      m.personality = (base.personality - (base.personality % 24)) + order;
      m.setIV(3, order % 32);
      const encoded = m.encode();
      const back = BoxMon.decode(encoded);
      expect(back.checksumValid).toBe(true);
      expect(back.species).toBe(base.species);
      expect(back.ivs[3]).toBe(order % 32);
      expect(back.moves).toEqual(base.moves);
      expect(back.encode()).toEqual(encoded);
    }
  });

  it('detects corruption via the checksum', () => {
    const raw = PartyMon.decode(partyRaw(syntheticBlocks().saveBlock1, 0)).box.encode();
    raw[40] = raw[40]! ^ 0x10;
    expect(BoxMon.decode(raw).checksumValid).toBe(false);
  });

  it('treats an all-zero slot as empty and valid', () => {
    const empty = BoxMon.decode(new Uint8Array(BOX_MON_SIZE));
    expect(empty.isEmpty).toBe(true);
    expect(empty.checksumValid).toBe(true);
  });
});

describe.skipIf(fixtureSaves().length === 0)('real saves (tests/fixtures)', () => {
  for (const { name, bytes } of fixtureSaves()) {
    it(`${name}: loads, and a no-op write is byte-identical`, () => {
      const img = parseFlash(bytes);
      expect(img.status).toBe('ok');
      const { bytes: out, changedSectors } = writeBlocks(img, readBlocks(img));
      expect(changedSectors).toEqual([]);
      expect(out).toEqual(bytes);
    });

    it(`${name}: every Pokémon decodes and re-encodes byte-identically`, () => {
      const blocks = readBlocks(parseFlash(bytes));
      for (let i = 0; i < partyCount(blocks.saveBlock1); i++) {
        const raw = partyRaw(blocks.saveBlock1, i);
        const p = PartyMon.decode(raw);
        expect(p.box.checksumValid).toBe(true);
        expect(p.encode()).toEqual(raw);
      }
      for (let b = 0; b < BOX_COUNT; b++) {
        for (let s = 0; s < BOX_SLOTS; s++) {
          const raw = boxRaw(blocks.storage, b, s);
          const m = BoxMon.decode(raw);
          expect(m.checksumValid).toBe(true);
          expect(m.encode()).toEqual(raw);
        }
      }
    });
  }
});
