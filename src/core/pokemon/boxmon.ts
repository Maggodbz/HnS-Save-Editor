// BoxPokemon (80 bytes) and Pokemon (party, 100 bytes) encoding — mirrors src/pokemon.c.
//
// The 48-byte "secure" area holds four 12-byte substructs whose order depends on personality % 24 and
// which are XOR-encrypted with (personality ^ otId). Internally we keep a decrypted copy with the
// substructs in canonical order 0,1,2,3; `encode()` recomputes the checksum and re-applies order + crypto.
//
// Safety: a mon that is never modified is never re-encoded — callers keep the original raw bytes.
import { u16, u32, setU32 } from '../binary.ts';
import { struct, StructView } from '../layout/index.ts';

const BOX_SIZE = struct('BoxPokemon').size;
const PARTY_SIZE_BYTES = struct('Pokemon').size;
const SECURE = struct('BoxPokemon').fields['secure'] as { offset: number; size: number };
const SUB_SIZE = SECURE.size / 4;

export { BOX_SIZE as BOX_MON_SIZE, PARTY_SIZE_BYTES as PARTY_MON_SIZE };

/** Position (0-3) of substruct type 0..3 for each personality % 24 — GetSubstruct's SUBSTRUCT_CASE table. */
export const SUBSTRUCT_POSITIONS: readonly (readonly [number, number, number, number])[] = [
  [0, 1, 2, 3], [0, 1, 3, 2], [0, 2, 1, 3], [0, 3, 1, 2], [0, 2, 3, 1], [0, 3, 2, 1],
  [1, 0, 2, 3], [1, 0, 3, 2], [2, 0, 1, 3], [3, 0, 1, 2], [2, 0, 3, 1], [3, 0, 2, 1],
  [1, 2, 0, 3], [1, 3, 0, 2], [2, 1, 0, 3], [3, 1, 0, 2], [2, 3, 0, 1], [3, 2, 0, 1],
  [1, 2, 3, 0], [1, 3, 2, 0], [2, 1, 3, 0], [3, 1, 2, 0], [2, 3, 1, 0], [3, 2, 1, 0],
];

function crypt(secure: Uint8Array, key: number) {
  for (let i = 0; i < secure.length; i += 4) setU32(secure, i, (u32(secure, i) ^ key) >>> 0);
}

/** CalculateBoxMonChecksum: 16-bit sum of all u16 words of the four (decrypted) substructs. */
export function substructChecksum(canonicalSecure: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < canonicalSecure.length; i += 2) sum = (sum + u16(canonicalSecure, i)) & 0xffff;
  return sum;
}

/**
 * A decrypted BoxPokemon. `buf` is a full 80-byte BoxPokemon image whose secure area is decrypted and
 * in canonical substruct order. Field access goes through generated layouts, so unknown bits are preserved.
 */
export class BoxMon {
  readonly buf: Uint8Array;
  /** Header fields (personality, otId, nickname, …). */
  readonly header: StructView;
  readonly sub0: StructView; // species, item, exp, ppBonuses, friendship, hiddenNature, box hp/ailment
  readonly sub1: StructView; // moves, pp
  readonly sub2: StructView; // EVs, contest stats
  readonly sub3: StructView; // met data, IVs, egg/ability bits, ribbons
  /** Whether the stored checksum matched when decoded (false = the game treats it as a Bad Egg). */
  readonly checksumValid: boolean;

  private constructor(buf: Uint8Array, checksumValid: boolean) {
    this.buf = buf;
    this.checksumValid = checksumValid;
    this.header = new StructView('BoxPokemon', buf, 0);
    this.sub0 = new StructView('PokemonSubstruct0', buf, SECURE.offset);
    this.sub1 = new StructView('PokemonSubstruct1', buf, SECURE.offset + SUB_SIZE);
    this.sub2 = new StructView('PokemonSubstruct2', buf, SECURE.offset + SUB_SIZE * 2);
    this.sub3 = new StructView('PokemonSubstruct3', buf, SECURE.offset + SUB_SIZE * 3);
  }

  static decode(raw: Uint8Array): BoxMon {
    if (raw.length !== BOX_SIZE) throw new Error(`BoxPokemon must be ${BOX_SIZE} bytes`);
    const buf = raw.slice();
    const personality = u32(buf, 0);
    const otId = u32(buf, 4);
    const secure = buf.subarray(SECURE.offset, SECURE.offset + SECURE.size);
    crypt(secure, (personality ^ otId) >>> 0);
    const positions = SUBSTRUCT_POSITIONS[personality % 24]!;
    const ordered = secure.slice();
    for (let type = 0; type < 4; type++) {
      const pos = positions[type]!;
      secure.set(ordered.subarray(pos * SUB_SIZE, (pos + 1) * SUB_SIZE), type * SUB_SIZE);
    }
    const valid = substructChecksum(secure) === new StructView('BoxPokemon', buf, 0).get('checksum');
    return new BoxMon(buf, valid);
  }

  /** A blank, all-zero BoxPokemon (what an empty PC/party slot contains). */
  static empty(): BoxMon {
    return BoxMon.decode(new Uint8Array(BOX_SIZE));
  }

  clone(): BoxMon {
    return new BoxMon(this.buf.slice(), this.checksumValid);
  }

  secureCanonical(): Uint8Array {
    return this.buf.subarray(SECURE.offset, SECURE.offset + SECURE.size);
  }

  /** Re-encrypts into the 80-byte save format, recomputing the checksum (as SetBoxMonData does). */
  encode(): Uint8Array {
    const out = this.buf.slice();
    const outHeader = new StructView('BoxPokemon', out, 0);
    const canonical = out.subarray(SECURE.offset, SECURE.offset + SECURE.size);
    outHeader.set('checksum', substructChecksum(canonical));
    const personality = u32(out, 0);
    const otId = u32(out, 4);
    const positions = SUBSTRUCT_POSITIONS[personality % 24]!;
    const source = canonical.slice();
    for (let type = 0; type < 4; type++) {
      const pos = positions[type]!;
      canonical.set(source.subarray(type * SUB_SIZE, (type + 1) * SUB_SIZE), pos * SUB_SIZE);
    }
    crypt(canonical, (personality ^ otId) >>> 0);
    return out;
  }

  get personality(): number { return this.header.get('personality'); }
  set personality(v: number) { this.header.set('personality', v >>> 0); }
  get otId(): number { return this.header.get('otId'); }
  set otId(v: number) { this.header.set('otId', v >>> 0); }

  get species(): number { return this.sub0.get('species'); }
  /** Sets species and the header's hasSpecies flag, like SetBoxMonData(MON_DATA_SPECIES). */
  set species(v: number) {
    this.sub0.set('species', v);
    this.header.set('hasSpecies', v ? 1 : 0);
  }

  get isEgg(): boolean { return this.sub3.get('isEgg') === 1; }
  /** Sets both egg bits, like SetBoxMonData(MON_DATA_IS_EGG). */
  set isEgg(v: boolean) {
    this.sub3.set('isEgg', v ? 1 : 0);
    this.header.set('isEgg', v ? 1 : 0);
  }

  /** True for an empty slot (the game checks species == SPECIES_NONE). */
  get isEmpty(): boolean { return this.checksumValid && this.species === 0; }
  get isBadEgg(): boolean { return !this.checksumValid || this.header.get('isBadEgg') === 1; }

  get moves(): number[] { return [0, 1, 2, 3].map((i) => u16(this.sub1.range('moves'), i * 2)); }
  setMove(slot: number, move: number) {
    const r = this.sub1.range('moves');
    r[slot * 2] = move & 0xff;
    r[slot * 2 + 1] = move >> 8;
  }
  get pp(): number[] { return [...this.sub1.range('pp')]; }
  setPP(slot: number, pp: number) {
    if (pp < 0 || pp > 255) throw new RangeError('PP out of range');
    this.sub1.range('pp')[slot] = pp;
  }

  /** PP Up count (0-3) per move slot. */
  get ppUps(): number[] {
    const b = this.sub0.get('ppBonuses');
    return [0, 1, 2, 3].map((i) => (b >> (i * 2)) & 3);
  }
  setPPUps(slot: number, count: number) {
    if (count < 0 || count > 3) throw new RangeError('PP Ups must be 0-3');
    const b = this.sub0.get('ppBonuses');
    this.sub0.set('ppBonuses', (b & ~(3 << (slot * 2))) | (count << (slot * 2)));
  }

  static readonly EV_FIELDS = ['hpEV', 'attackEV', 'defenseEV', 'speedEV', 'spAttackEV', 'spDefenseEV'];
  static readonly IV_FIELDS = ['hpIV', 'attackIV', 'defenseIV', 'speedIV', 'spAttackIV', 'spDefenseIV'];

  get evs(): number[] { return BoxMon.EV_FIELDS.map((f) => this.sub2.get(f)); }
  setEV(stat: number, v: number) { this.sub2.set(BoxMon.EV_FIELDS[stat]!, v); }
  get ivs(): number[] { return BoxMon.IV_FIELDS.map((f) => this.sub3.get(f)); }
  setIV(stat: number, v: number) { this.sub3.set(BoxMon.IV_FIELDS[stat]!, v); }
}

/** A party Pokémon: BoxMon + the battle-ready fields (level, HP, stats, status). */
export class PartyMon {
  readonly box: BoxMon;
  /**
   * A 100-byte struct Pokemon buffer of which only the party fields after the BoxPokemon part
   * (status, level, mail, hp, stats) are used; the BoxPokemon part lives in `box`.
   */
  private readonly partyBuf: Uint8Array;
  readonly view: StructView;

  /** `partyFields` = the bytes of struct Pokemon that follow the embedded BoxPokemon. */
  constructor(box: BoxMon, partyFields: Uint8Array) {
    this.box = box;
    this.partyBuf = new Uint8Array(PARTY_SIZE_BYTES);
    this.partyBuf.set(partyFields, BOX_SIZE);
    this.view = new StructView('Pokemon', this.partyBuf, 0);
  }

  static decode(raw: Uint8Array): PartyMon {
    if (raw.length !== PARTY_SIZE_BYTES) throw new Error(`Pokemon must be ${PARTY_SIZE_BYTES} bytes`);
    return new PartyMon(BoxMon.decode(raw.subarray(0, BOX_SIZE)), raw.subarray(BOX_SIZE));
  }

  clone(): PartyMon {
    return new PartyMon(this.box.clone(), this.partyBuf.subarray(BOX_SIZE));
  }

  encode(): Uint8Array {
    const out = this.partyBuf.slice();
    out.set(this.box.encode(), 0);
    return out;
  }

  get level(): number { return this.view.get('level'); }
  set level(v: number) { this.view.set('level', v); }
  get hp(): number { return this.view.get('hp'); }
  set hp(v: number) { this.view.set('hp', v); }
  get maxHP(): number { return this.view.get('maxHP'); }
  get status(): number { return this.view.get('status'); }
  set status(v: number) { this.view.set('status', v); }
  get mail(): number { return this.view.get('mail'); }
  set mail(v: number) { this.view.set('mail', v); }

  static readonly STAT_FIELDS = ['maxHP', 'attack', 'defense', 'speed', 'spAttack', 'spDefense'];
  get stats(): number[] { return PartyMon.STAT_FIELDS.map((f) => this.view.get(f)); }
  setStats(stats: number[]) { PartyMon.STAT_FIELDS.forEach((f, i) => this.view.set(f, stats[i]! & 0xffff)); }
}
