// Independent verification of an exported save. Runs after every write; any failed check aborts the save.
import { bytesEqual } from '../binary.ts';
import { BoxMon, PartyMon } from '../pokemon/boxmon.ts';
import { BOX_COUNT, BOX_SLOTS, boxRaw, partyCount, partyRaw } from '../pokemon/storage.ts';
import { CHUNKS, type BlockName, type FlashImage, parseFlash, readBlocks, sectorRange } from './flash.ts';

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerificationReport {
  ok: boolean;
  checks: Check[];
  changedSectors: number[];
}

export function verifyExport(
  original: FlashImage,
  output: Uint8Array,
  expected: Record<BlockName, Uint8Array>,
  changedSectors: number[],
): VerificationReport {
  const originalBlocks = original.activeSlot === null ? null : readBlocks(original);
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  add('File size unchanged', output.length === original.raw.length, `${output.length} bytes`);

  let reparsed: FlashImage | null = null;
  try {
    reparsed = parseFlash(output);
  } catch (e) {
    add('Save parses', false, String(e));
  }
  if (reparsed) {
    add('Game would load it', reparsed.status === 'ok' || reparsed.status === original.status,
      `status ${reparsed.status} (was ${original.status})`);
    add('Same save slot is loaded', reparsed.activeSlot === original.activeSlot && reparsed.counter === original.counter,
      `slot ${reparsed.activeSlot}, counter ${reparsed.counter}`);
    const active = reparsed.activeSlot === null ? null : reparsed.slots[reparsed.activeSlot];
    add('All sector checksums valid', active?.status === 'ok', active ? `active slot ${active.status}` : 'no active slot');

    if (reparsed.activeSlot !== null && active?.status === 'ok') {
      const blocks = readBlocks(reparsed);
      const same = (Object.keys(expected) as BlockName[]).every((k) => bytesEqual(blocks[k], expected[k]));
      add('Read-back matches every edit', same, same ? 'save blocks identical to the edited data' : 'save blocks differ after write');
      checks.push(verifyMons(blocks, originalBlocks));
    }
  }

  // Bytes outside the rewritten sectors must be identical to the original file.
  const touched = changedSectors.map(sectorRange);
  let outsideDiffs = 0;
  for (let i = 0; i < output.length; i++) {
    if (output[i] === original.raw[i]) continue;
    if (!touched.some(([s, e]) => i >= s && i < e)) outsideDiffs++;
  }
  add('Nothing else in the file changed', outsideDiffs === 0,
    outsideDiffs === 0 ? `${changedSectors.length} of ${CHUNKS.length} sectors rewritten; other slot, Hall of Fame and emulator data untouched`
      : `${outsideDiffs} unexpected byte(s) differ`);

  return { ok: checks.every((c) => c.ok), checks, changedSectors };
}

/**
 * Every party and box Pokémon decodes with a valid checksum (empty slots included). A slot that was already
 * invalid in the original file and is byte-identical now (e.g. a pre-existing Bad Egg) is reported, not failed.
 */
function verifyMons(blocks: Record<BlockName, Uint8Array>, originalBlocks: Record<BlockName, Uint8Array> | null): Check {
  const bad: string[] = [];
  const preexisting: string[] = [];
  const count = partyCount(blocks.saveBlock1);
  if (count < 1) bad.push('party is empty');
  for (let i = 0; i < count; i++) {
    const m = PartyMon.decode(partyRaw(blocks.saveBlock1, i));
    if (!m.box.checksumValid) bad.push(`party ${i + 1}: bad checksum`);
    if (m.box.species === 0) bad.push(`party ${i + 1}: empty slot inside party`);
  }
  let total = 0;
  for (let b = 0; b < BOX_COUNT; b++) {
    for (let s = 0; s < BOX_SLOTS; s++) {
      const raw = boxRaw(blocks.storage, b, s);
      const m = BoxMon.decode(raw);
      if (!m.checksumValid) {
        const unchanged = originalBlocks && bytesEqual(raw, boxRaw(originalBlocks.storage, b, s));
        (unchanged ? preexisting : bad).push(`box ${b + 1} slot ${s + 1}: bad checksum`);
      }
      else if (m.species) total++;
    }
  }
  return {
    name: 'Every Pokémon is valid',
    ok: bad.length === 0,
    detail: bad.length
      ? bad.slice(0, 5).join('; ')
      : `${count} in party, ${total} in boxes — all checksums valid`
        + (preexisting.length ? ` (${preexisting.length} pre-existing Bad Egg slot(s) left untouched)` : ''),
  };
}
