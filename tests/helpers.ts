// Test helpers: real-save fixtures (git-ignored, optional) and a builder for synthetic saves.
import fs from 'node:fs';
import path from 'node:path';
import { setU16, setU32 } from '../src/core/binary.ts';
import { constant, StructView } from '../src/core/layout/index.ts';
import { BLOCK_SIZES, CHUNKS, FLASH_SIZE, sectorChecksum, type BlockName } from '../src/core/save/flash.ts';
import { charset } from '../src/core/gamedata/index.ts';
import { createMon } from '../src/core/pokemon/edit.ts';
import { toPartyMon } from '../src/core/pokemon/edit.ts';
import { readSettings } from '../src/core/save/settings.ts';
import { readTrainer } from '../src/core/save/trainer.ts';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

/** Real saves copied into tests/fixtures (not committed). */
export function fixtureSaves(): { name: string; bytes: Uint8Array }[] {
  if (!fs.existsSync(FIXTURES)) return [];
  return fs.readdirSync(FIXTURES)
    .filter((f) => f.endsWith('.sav'))
    .map((f) => ({ name: f, bytes: new Uint8Array(fs.readFileSync(path.join(FIXTURES, f))) }));
}

export type Blocks = Record<BlockName, Uint8Array>;

/** Seeded PRNG (mulberry32) so property tests are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Minimal but valid save blocks: a named trainer with one Pokémon in the party. */
export function syntheticBlocks(opts: { species?: number; level?: number; seed?: number } = {}): Blocks {
  const blocks: Blocks = {
    saveBlock2: new Uint8Array(BLOCK_SIZES.saveBlock2),
    saveBlock1: new Uint8Array(BLOCK_SIZES.saveBlock1),
    storage: new Uint8Array(BLOCK_SIZES.storage),
  };
  const sb2 = new StructView('SaveBlock2', blocks.saveBlock2, 0);
  sb2.range('playerName').set(charset.encode('TESTER', sb2.range('playerName').length));
  sb2.range('playerTrainerId').set([0x39, 0x30, 0x34, 0x12]); // TID 12345, SID 4660
  sb2.set('encryptionKey', 0x1a2b3c4d);
  // Empty bag slots hold quantity 0 XOR key, as the game leaves them.
  const sb1 = new StructView('SaveBlock1', blocks.saveBlock1, 0);
  for (const field of ['bagPocket_Items', 'bagPocket_KeyItems', 'bagPocket_PokeBalls', 'bagPocket_TMHM', 'bagPocket_Berries']) {
    const r = sb1.range(field);
    for (let i = 0; i < r.length; i += 4) setU16(r, i + 2, 0x3c4d);
  }
  sb1.set('money', (3000 ^ 0x1a2b3c4d) >>> 0);
  sb1.set('coins', (0 ^ 0x1a2b3c4d) & 0xffff);
  // Empty party slots as ZeroMonData leaves them (mail = MAIL_NONE).
  const party = sb1.range('playerParty');
  const mailOffset = new StructView('Pokemon', new Uint8Array(100), 0).def.fields['mail']!.offset;
  for (let i = 0; i < constant('PARTY_SIZE'); i++) party[i * 100 + mailOffset] = 0xff;

  const settings = readSettings(blocks.saveBlock1);
  const trainer = readTrainer(blocks.saveBlock1, blocks.saveBlock2);
  const mon = createMon({ species: opts.species ?? 158, level: opts.level ?? 12, random: rng(opts.seed ?? 1) }, trainer,
    sb2.range('playerName'), settings);
  party.set(toPartyMon(mon, settings).encode(), 0);
  sb1.set('playerPartyCount', 1);
  return blocks;
}

/**
 * Assembles a 128 KiB flash image the way the game writes it: two slots, rotated sector order,
 * per-sector id/checksum/signature/counter. `extra` bytes are appended (e.g. an mGBA RTC trailer).
 */
export function buildFlash(slotA: { blocks: Blocks; counter: number; rotation?: number } | null,
  slotB: { blocks: Blocks; counter: number; rotation?: number } | null, extra = new Uint8Array()): Uint8Array {
  const out = new Uint8Array(FLASH_SIZE + extra.length).fill(0xff);
  out.set(extra, FLASH_SIZE);
  const SECTOR_SIZE = constant('SECTOR_SIZE');
  const DATA = constant('SECTOR_DATA_SIZE');
  [slotA, slotB].forEach((slot, s) => {
    if (!slot) return;
    CHUNKS.forEach((chunk, id) => {
      const phys = s * 14 + ((id + (slot.rotation ?? 0)) % 14);
      const base = phys * SECTOR_SIZE;
      out.fill(0, base, base + DATA);
      out.set(slot.blocks[chunk.block].subarray(chunk.offset, chunk.offset + chunk.size), base);
      setU16(out, base + DATA, id);
      setU16(out, base + DATA + 2, sectorChecksum(out.subarray(base), chunk.size));
      setU32(out, base + DATA + 4, constant('SECTOR_SIGNATURE'));
      setU32(out, base + DATA + 8, slot.counter);
    });
  });
  return out;
}

export function syntheticSave(seed = 1): Uint8Array {
  const blocks = syntheticBlocks({ seed });
  return buildFlash({ blocks, counter: 6, rotation: 3 }, { blocks: syntheticBlocks({ seed: seed + 1 }), counter: 5, rotation: 9 },
    new Uint8Array(16).fill(0xab));
}
