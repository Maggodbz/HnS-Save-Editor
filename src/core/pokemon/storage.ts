// Party (SaveBlock1.playerParty) and PC boxes (PokemonStorage.boxes): raw slot access plus the
// conversions the game's PC performs when Pokémon move between party and boxes (SetPlacedMonData).
import { bytesEqual } from '../binary.ts';
import { constant, StructView } from '../layout/index.ts';
import { charset } from '../gamedata/index.ts';
import type { SaveSettings } from '../save/settings.ts';
import { BOX_MON_SIZE, BoxMon, PARTY_MON_SIZE, PartyMon } from './boxmon.ts';
import { MAIL_NONE, restorePP, toPartyMon } from './edit.ts';

export const PARTY_MAX = constant('PARTY_SIZE');
export const BOX_COUNT = constant('TOTAL_BOXES_COUNT');
export const BOX_SLOTS = constant('IN_BOX_COUNT');

export type SlotRef = { area: 'party'; index: number } | { area: 'box'; box: number; index: number };

export function slotKey(ref: SlotRef): string {
  return ref.area === 'party' ? `party:${ref.index}` : `box:${ref.box}:${ref.index}`;
}

export function slotLabel(ref: SlotRef, boxNames?: string[]): string {
  return ref.area === 'party'
    ? `Party ${ref.index + 1}`
    : `${boxNames?.[ref.box] ?? `Box ${ref.box + 1}`} · Slot ${ref.index + 1}`;
}

// ---- Party -------------------------------------------------------------------------------------------------

export function partyCount(saveBlock1: Uint8Array): number {
  return Math.min(new StructView('SaveBlock1', saveBlock1, 0).get('playerPartyCount'), PARTY_MAX);
}

export function partyRaw(saveBlock1: Uint8Array, index: number): Uint8Array {
  const r = new StructView('SaveBlock1', saveBlock1, 0).range('playerParty');
  return r.subarray(index * PARTY_MON_SIZE, (index + 1) * PARTY_MON_SIZE);
}

/** An empty party slot as ZeroMonData leaves it (all zero except mail = MAIL_NONE). */
export function emptyPartyRaw(): Uint8Array {
  const p = new PartyMon(BoxMon.empty(), new Uint8Array(PARTY_MON_SIZE - BOX_MON_SIZE));
  p.mail = MAIL_NONE;
  return p.encode();
}

/**
 * Writes the party as a packed list (the game keeps party members contiguous). Slots past the new count that
 * held a Pokémon are cleared like ZeroMonData; slots that were already empty are left byte-for-byte untouched.
 */
export function writeParty(saveBlock1: Uint8Array, mons: Uint8Array[]): void {
  if (mons.length < 1 || mons.length > PARTY_MAX) throw new Error(`Party must have 1-${PARTY_MAX} Pokémon`);
  const sb1 = new StructView('SaveBlock1', saveBlock1, 0);
  const oldCount = partyCount(saveBlock1);
  const region = sb1.range('playerParty');
  for (let i = 0; i < PARTY_MAX; i++) {
    const target = region.subarray(i * PARTY_MON_SIZE, (i + 1) * PARTY_MON_SIZE);
    const next = mons[i] ?? (i < oldCount ? emptyPartyRaw() : null);
    if (next && !bytesEqual(target, next)) target.set(next);
  }
  sb1.set('playerPartyCount', mons.length);
}

// ---- Boxes -------------------------------------------------------------------------------------------------

export function boxRaw(storage: Uint8Array, box: number, index: number): Uint8Array {
  if (box < 0 || box >= BOX_COUNT || index < 0 || index >= BOX_SLOTS) throw new RangeError('Invalid box slot');
  const r = new StructView('PokemonStorage', storage, 0).range('boxes');
  const at = (box * BOX_SLOTS + index) * BOX_MON_SIZE;
  return r.subarray(at, at + BOX_MON_SIZE);
}

export function writeBoxRaw(storage: Uint8Array, box: number, index: number, bytes: Uint8Array): void {
  if (bytes.length !== BOX_MON_SIZE) throw new Error('Box Pokémon must be 80 bytes');
  const target = boxRaw(storage, box, index);
  if (!bytesEqual(target, bytes)) target.set(bytes);
}

export function boxNames(storage: Uint8Array): string[] {
  const names = new StructView('PokemonStorage', storage, 0).range('boxNames');
  const width = constant('BOX_NAME_LENGTH') + 1;
  return Array.from({ length: BOX_COUNT }, (_, i) => charset.decode(names.subarray(i * width, (i + 1) * width)) || `Box ${i + 1}`);
}

export function currentBox(storage: Uint8Array): number {
  return new StructView('PokemonStorage', storage, 0).get('currentBox');
}

// ---- Party ⇄ box conversions (SetPlacedMonData) ------------------------------------------------------------

const AILMENT = { NONE: 0, PSN: 1, PRZ: 2, SLP: 3, FRZ: 4, BRN: 5 };
const STATUS1 = { SLEEP: 0x7, POISON: 0x8, BURN: 0x10, FREEZE: 0x20, PARALYSIS: 0x40, TOXIC: 0x80 };

function ailmentFromStatus(status: number): number {
  if (status & (STATUS1.POISON | STATUS1.TOXIC)) return AILMENT.PSN;
  if (status & STATUS1.PARALYSIS) return AILMENT.PRZ;
  if (status & STATUS1.SLEEP) return AILMENT.SLP;
  if (status & STATUS1.FREEZE) return AILMENT.FRZ;
  if (status & STATUS1.BURN) return AILMENT.BRN;
  return AILMENT.NONE;
}

function statusFromAilment(ailment: number): number {
  switch (ailment) {
    case AILMENT.PSN: return STATUS1.POISON;
    case AILMENT.PRZ: return STATUS1.PARALYSIS;
    case AILMENT.SLP: return 3; // STATUS1_SLEEP_TURN(3)
    case AILMENT.FRZ: return STATUS1.FREEZE;
    case AILMENT.BRN: return STATUS1.BURN;
    default: return 0;
  }
}

/** Party → box. With the PC-heal challenge the box keeps HP/status; otherwise PP is restored. */
export function depositToBox(p: PartyMon, settings: SaveSettings): BoxMon {
  if (p.mail !== MAIL_NONE) throw new Error('A Pokémon holding mail cannot be stored in a box');
  const box = p.box.clone();
  if (settings.pcHeal) {
    const max = p.maxHP;
    let boxHp = max <= 0xff ? p.hp : Math.floor((0xff * p.hp) / max);
    if (p.hp !== 0 && boxHp === 0) boxHp = 1;
    box.header.set('inPC', 1);
    box.sub0.set('box_hp', boxHp & 0xff);
    box.sub0.set('box_ailment', ailmentFromStatus(p.status) & 7);
  } else {
    restorePP(box);
  }
  return box;
}

/** Box → party. Stats are calculated; with the PC-heal challenge HP/status come back from the box fields. */
export function withdrawToParty(box: BoxMon, settings: SaveSettings): PartyMon {
  const p = toPartyMon(box.clone(), settings);
  if (settings.pcHeal) {
    if (p.box.header.get('inPC')) {
      const max = p.maxHP;
      const boxHp = p.box.sub0.get('box_hp');
      p.hp = max <= 0xff ? boxHp : Math.floor((max * boxHp) / 0xff);
      p.status = statusFromAilment(p.box.sub0.get('box_ailment'));
    }
    p.box.header.set('inPC', 0);
    p.box.sub0.set('box_hp', 0);
    p.box.sub0.set('box_ailment', 0);
  }
  return p;
}
