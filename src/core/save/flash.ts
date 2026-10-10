// The 128 KiB flash image: sectors, save slots and checksums, mirroring the game's src/save.c.
//
// Flash = 32 sectors of 4 KiB. Sectors 0-13 are save slot A, 14-27 slot B, 28-31 Hall of Fame / Trainer
// Hill / recorded battle (never touched by this editor). Within a slot, each sector carries an id (which
// chunk of which save block it holds), a checksum, a signature and the save counter. The sector order
// inside a slot rotates between saves, so chunks are always located by id.
import { u16, u32, setU16 } from '../binary.ts';
import { constant, struct } from '../layout/index.ts';

export const FLASH_SIZE = 0x20000;

const SECTOR_SIZE = constant('SECTOR_SIZE');
const SECTOR_DATA_SIZE = constant('SECTOR_DATA_SIZE');
const SECTOR_SIGNATURE = constant('SECTOR_SIGNATURE');
const SECTORS_PER_SLOT = constant('NUM_SECTORS_PER_SLOT');
// Footer: u16 id, u16 checksum, u32 signature, u32 counter (src/save.h struct SaveSector)
const OFF_ID = SECTOR_DATA_SIZE;
const OFF_CHECKSUM = SECTOR_DATA_SIZE + 2;
const OFF_SIGNATURE = SECTOR_DATA_SIZE + 4;
const OFF_COUNTER = SECTOR_DATA_SIZE + 8;

export type BlockName = 'saveBlock2' | 'saveBlock1' | 'storage';

export interface Chunk {
  block: BlockName;
  /** Offset of this chunk inside its save block. */
  offset: number;
  /** Bytes of the block stored in this sector (≤ SECTOR_DATA_SIZE). */
  size: number;
}

/** sSaveSlotLayout: sector id → which part of which block it holds. */
export const CHUNKS: Chunk[] = (() => {
  const sizes: [BlockName, number, number][] = [
    ['saveBlock2', struct('SaveBlock2').size, 1],
    ['saveBlock1', struct('SaveBlock1').size, 4],
    ['storage', struct('PokemonStorage').size, 9],
  ];
  const chunks: Chunk[] = [];
  for (const [block, size, count] of sizes) {
    if (size > count * SECTOR_DATA_SIZE) throw new Error(`${block} (${size} bytes) does not fit in ${count} sectors`);
    for (let i = 0; i < count; i++) {
      chunks.push({ block, offset: i * SECTOR_DATA_SIZE, size: Math.max(0, Math.min(size - i * SECTOR_DATA_SIZE, SECTOR_DATA_SIZE)) });
    }
  }
  if (chunks.length !== SECTORS_PER_SLOT) throw new Error('Chunk table does not match NUM_SECTORS_PER_SLOT');
  return chunks;
})();

export const BLOCK_SIZES: Record<BlockName, number> = {
  saveBlock2: struct('SaveBlock2').size,
  saveBlock1: struct('SaveBlock1').size,
  storage: struct('PokemonStorage').size,
};

/** CalculateChecksum: sum of u32 words over `size` bytes, folded to 16 bits. */
export function sectorChecksum(data: Uint8Array, size: number): number {
  let sum = 0;
  for (let i = 0; i + 4 <= size; i += 4) sum = (sum + u32(data, i)) >>> 0;
  return ((sum >>> 16) + sum) & 0xffff;
}

export interface SectorInfo {
  /** Physical sector index in flash (0-31). */
  index: number;
  id: number;
  checksum: number;
  signature: number;
  counter: number;
  signatureOk: boolean;
  checksumOk: boolean;
}

export type SlotStatus = 'ok' | 'error' | 'empty';

export interface SlotInfo {
  slot: 0 | 1;
  status: SlotStatus;
  counter: number;
  sectors: SectorInfo[];
  /** Physical sector index for each chunk id (only when status is ok). */
  sectorById: number[];
}

export type LoadStatus = 'ok' | 'error' | 'empty' | 'corrupt';

export interface FlashImage {
  /** Full file bytes (flash + any emulator trailer, e.g. mGBA's RTC block). Never mutated. */
  raw: Uint8Array;
  slots: [SlotInfo, SlotInfo];
  /** Overall result exactly as the game computes it (GetSaveValidStatus). */
  status: LoadStatus;
  /** Slot the game will load, or null if nothing loadable. */
  activeSlot: 0 | 1 | null;
  /** Save counter of the active slot. */
  counter: number;
}

function readSector(raw: Uint8Array, index: number): SectorInfo {
  const base = index * SECTOR_SIZE;
  const id = u16(raw, base + OFF_ID);
  const signature = u32(raw, base + OFF_SIGNATURE);
  const checksum = u16(raw, base + OFF_CHECKSUM);
  const chunk = CHUNKS[id];
  const signatureOk = signature === SECTOR_SIGNATURE;
  const checksumOk = signatureOk && chunk !== undefined && sectorChecksum(raw.subarray(base), chunk.size) === checksum;
  return { index, id, checksum, signature, counter: u32(raw, base + OFF_COUNTER), signatureOk, checksumOk };
}

function readSlot(raw: Uint8Array, slot: 0 | 1): SlotInfo {
  const sectors: SectorInfo[] = [];
  let anySignature = false;
  let validMask = 0;
  let counter = 0;
  const sectorById: number[] = new Array(SECTORS_PER_SLOT).fill(-1);
  for (let i = 0; i < SECTORS_PER_SLOT; i++) {
    const s = readSector(raw, slot * SECTORS_PER_SLOT + i);
    sectors.push(s);
    if (!s.signatureOk) continue;
    anySignature = true;
    if (s.checksumOk) {
      counter = s.counter; // the game keeps the counter of the last valid sector it reads
      validMask |= 1 << s.id;
      sectorById[s.id] = s.index;
    }
  }
  const status: SlotStatus = !anySignature ? 'empty' : validMask === (1 << SECTORS_PER_SLOT) - 1 ? 'ok' : 'error';
  return { slot, status, counter, sectors, sectorById };
}

/** Parses a .sav file. Throws only if the file is too small to be a flash save. */
export function parseFlash(file: Uint8Array): FlashImage {
  if (file.length < FLASH_SIZE) {
    throw new Error(`File is ${file.length} bytes; a Heart & Soul save is ${FLASH_SIZE} bytes (plus optional emulator data).`);
  }
  const raw = file.slice();
  const a = readSlot(raw, 0);
  const b = readSlot(raw, 1);

  // GetSaveValidStatus
  let status: LoadStatus;
  let activeSlot: 0 | 1 | null;
  if (a.status === 'ok' && b.status === 'ok') {
    let newer: 0 | 1;
    if ((a.counter === 0xffffffff && b.counter === 0) || (a.counter === 0 && b.counter === 0xffffffff)) {
      newer = ((a.counter + 1) >>> 0) < ((b.counter + 1) >>> 0) ? 1 : 0;
    } else {
      newer = a.counter < b.counter ? 1 : 0;
    }
    status = 'ok';
    activeSlot = newer;
  } else if (a.status === 'ok') {
    status = b.status === 'error' ? 'error' : 'ok';
    activeSlot = 0;
  } else if (b.status === 'ok') {
    status = a.status === 'error' ? 'error' : 'ok';
    activeSlot = 1;
  } else if (a.status === 'empty' && b.status === 'empty') {
    status = 'empty';
    activeSlot = null;
  } else {
    status = 'corrupt';
    activeSlot = null;
  }
  const slots: [SlotInfo, SlotInfo] = [a, b];
  return { raw, slots, status, activeSlot, counter: activeSlot === null ? 0 : slots[activeSlot].counter };
}

/** Assembles the three save blocks from the active slot (copies; safe to mutate). */
export function readBlocks(image: FlashImage): Record<BlockName, Uint8Array> {
  if (image.activeSlot === null) throw new Error('Save has no loadable slot');
  const slot = image.slots[image.activeSlot];
  const blocks: Record<BlockName, Uint8Array> = {
    saveBlock2: new Uint8Array(BLOCK_SIZES.saveBlock2),
    saveBlock1: new Uint8Array(BLOCK_SIZES.saveBlock1),
    storage: new Uint8Array(BLOCK_SIZES.storage),
  };
  CHUNKS.forEach((chunk, id) => {
    const base = slot.sectorById[id]! * SECTOR_SIZE;
    blocks[chunk.block].set(image.raw.subarray(base, base + chunk.size), chunk.offset);
  });
  return blocks;
}

export interface WriteResult {
  bytes: Uint8Array;
  /** Physical sector indices that were rewritten. */
  changedSectors: number[];
}

/**
 * Writes modified blocks back into the active slot, in place: same sectors, same ids, same counter.
 * Only sectors whose chunk bytes actually changed are touched; their checksum is recomputed.
 * Everything else in the file (the other slot, Hall of Fame, padding, emulator trailer) is left byte-identical.
 */
export function writeBlocks(image: FlashImage, blocks: Record<BlockName, Uint8Array>): WriteResult {
  if (image.activeSlot === null) throw new Error('Save has no loadable slot');
  const slot = image.slots[image.activeSlot];
  if (slot.status !== 'ok') throw new Error('Active slot is not fully valid; refusing to write');
  const out = image.raw.slice();
  const changedSectors: number[] = [];
  CHUNKS.forEach((chunk, id) => {
    if (blocks[chunk.block].length !== BLOCK_SIZES[chunk.block]) throw new Error(`${chunk.block} has the wrong size`);
    const base = slot.sectorById[id]! * SECTOR_SIZE;
    const next = blocks[chunk.block].subarray(chunk.offset, chunk.offset + chunk.size);
    const current = out.subarray(base, base + chunk.size);
    let differs = false;
    for (let i = 0; i < chunk.size; i++) if (current[i] !== next[i]) { differs = true; break; }
    if (!differs) return;
    current.set(next);
    setU16(out, base + OFF_CHECKSUM, sectorChecksum(out.subarray(base), chunk.size));
    changedSectors.push(slot.sectorById[id]!);
  });
  return { bytes: out, changedSectors };
}

/** Byte range [start, end) of the data+footer region of a sector, for diff checks. */
export function sectorRange(index: number): [number, number] {
  return [index * SECTOR_SIZE, (index + 1) * SECTOR_SIZE];
}
