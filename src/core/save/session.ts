// An editing session over one save file. All edits are transactional (applied to a copy and committed only if
// they succeed), undoable, summarised as a change list, validated, and verified on export.
import { bytesEqual } from '../binary.ts';
import { constant } from '../layout/index.ts';
import { game } from '../gamedata/index.ts';
import { BOX_MON_SIZE, BoxMon, PARTY_MON_SIZE, PartyMon } from '../pokemon/boxmon.ts';
import { healParty, MAX_EV, MAX_TOTAL_EV, recalcPartyStats } from '../pokemon/edit.ts';
import { expForLevel, HIDDEN_NATURE_NONE, maxPP } from '../pokemon/rules.ts';
import {
  BOX_COUNT, BOX_SLOTS, boxNames, boxRaw, depositToBox, PARTY_MAX, partyCount, partyRaw, type SlotRef, slotKey,
  slotLabel, withdrawToParty, writeBoxRaw, writeParty,
} from '../pokemon/storage.ts';
import { describeMonChanges, summarize } from '../pokemon/summary.ts';
import { POCKETS, type ItemStack, pocketDef, type PocketId, readPocket, writePocket } from './bag.ts';
import { type BlockName, type FlashImage, parseFlash, readBlocks, writeBlocks } from './flash.ts';
import { isCaught, registerCaught } from './pokedex.ts';
import { readSettings, type SaveSettings } from './settings.ts';
import { readTrainer, setBattlePoints, setCoins, setMoney, type TrainerInfo } from './trainer.ts';
import { verifyExport, type VerificationReport } from './verify.ts';

export type Blocks = Record<BlockName, Uint8Array>;

export interface ChangeEntry {
  area: 'Trainer' | 'Bag' | 'Pokémon' | 'Pokédex';
  label: string;
  detail: string;
}

export interface ValidationResult {
  errors: string[];
  warnings: string[];
}

export interface ExportResult {
  bytes: Uint8Array;
  report: VerificationReport;
}

export interface MonAt {
  ref: SlotRef;
  box: BoxMon;
  party?: PartyMon;
}

const cloneBlocks = (b: Blocks): Blocks => ({
  saveBlock1: b.saveBlock1.slice(),
  saveBlock2: b.saveBlock2.slice(),
  storage: b.storage.slice(),
});

const MAX_UNDO = 200;

export class SaveSession {
  readonly fileName: string;
  readonly image: FlashImage;
  readonly settings: SaveSettings;
  /** Non-null when the file can be viewed but must not be written (e.g. a damaged active slot). */
  readonly readOnlyReason: string | null;
  private readonly original: Blocks;
  private blocks: Blocks;
  private undoStack: Blocks[] = [];
  private redoStack: Blocks[] = [];
  private listeners = new Set<() => void>();
  /** Increments on every change; handy as a React dependency. */
  version = 0;

  private constructor(fileName: string, image: FlashImage) {
    this.fileName = fileName;
    this.image = image;
    if (image.activeSlot === null) {
      throw new Error(image.status === 'empty' ? 'This save file is empty (no game has been saved yet).' : 'This save file is corrupted: neither save slot is valid.');
    }
    this.original = readBlocks(image);
    this.blocks = cloneBlocks(this.original);
    this.settings = readSettings(this.original.saveBlock1);
    const active = image.slots[image.activeSlot];
    this.readOnlyReason = active.status !== 'ok' ? 'The active save slot has damaged sectors.' : null;
  }

  static open(bytes: Uint8Array, fileName: string): SaveSession {
    return new SaveSession(fileName, parseFlash(bytes));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Runs `fn` on a copy of the data; commits only if it doesn't throw. */
  private edit(fn: (b: Blocks) => void): void {
    if (this.readOnlyReason) throw new Error(`Read-only: ${this.readOnlyReason}`);
    const next = cloneBlocks(this.blocks);
    fn(next);
    if ((Object.keys(next) as BlockName[]).every((k) => bytesEqual(next[k], this.blocks[k]))) return;
    this.undoStack.push(this.blocks);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.blocks = next;
    this.notify();
  }

  // ---- History ---------------------------------------------------------------------------------------------

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get isDirty() {
    return (Object.keys(this.blocks) as BlockName[]).some((k) => !bytesEqual(this.blocks[k], this.original[k]));
  }

  undo() {
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.blocks);
    this.blocks = prev;
    this.notify();
  }

  redo() {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.blocks);
    this.blocks = next;
    this.notify();
  }

  revertAll() {
    if (!this.isDirty) return;
    this.undoStack.push(this.blocks);
    this.redoStack = [];
    this.blocks = cloneBlocks(this.original);
    this.notify();
  }

  // ---- Reads -----------------------------------------------------------------------------------------------

  get trainer(): TrainerInfo { return readTrainer(this.blocks.saveBlock1, this.blocks.saveBlock2); }
  get originalTrainer(): TrainerInfo { return readTrainer(this.original.saveBlock1, this.original.saveBlock2); }
  pocket(id: PocketId): ItemStack[] { return readPocket(this.blocks.saveBlock1, this.blocks.saveBlock2, pocketDef(id)); }
  boxNames(): string[] { return boxNames(this.blocks.storage); }
  isCaught(species: number): boolean { return isCaught(this.blocks.saveBlock1, this.blocks.saveBlock2, species); }
  get playerNameBytes(): Uint8Array { return this.blocks.saveBlock2.slice(0, constant('PLAYER_NAME_LENGTH') + 1); }

  party(): MonAt[] {
    const out: MonAt[] = [];
    for (let i = 0; i < partyCount(this.blocks.saveBlock1); i++) {
      const p = PartyMon.decode(partyRaw(this.blocks.saveBlock1, i));
      out.push({ ref: { area: 'party', index: i }, box: p.box, party: p });
    }
    return out;
  }

  /** The 30 slots of a box; null = empty. */
  box(b: number): (MonAt | null)[] {
    return Array.from({ length: BOX_SLOTS }, (_, i) => {
      const mon = BoxMon.decode(boxRaw(this.blocks.storage, b, i));
      return mon.isEmpty ? null : { ref: { area: 'box', box: b, index: i } as SlotRef, box: mon };
    });
  }

  mon(ref: SlotRef): MonAt | null {
    if (ref.area === 'party') return this.party()[ref.index] ?? null;
    return this.box(ref.box)[ref.index] ?? null;
  }

  // ---- Trainer & bag edits ---------------------------------------------------------------------------------

  setMoney(v: number) { this.edit((b) => setMoney(b.saveBlock1, b.saveBlock2, v)); }
  setCoins(v: number) { this.edit((b) => setCoins(b.saveBlock1, b.saveBlock2, v)); }
  setBattlePoints(v: number) { this.edit((b) => setBattlePoints(b.saveBlock2, v)); }

  setPocket(id: PocketId, stacks: ItemStack[]) {
    this.edit((b) => writePocket(b.saveBlock1, b.saveBlock2, pocketDef(id), stacks, this.settings));
  }

  // ---- Pokémon edits ---------------------------------------------------------------------------------------

  private readParty(b: Blocks): Uint8Array[] {
    return Array.from({ length: partyCount(b.saveBlock1) }, (_, i) => partyRaw(b.saveBlock1, i).slice());
  }

  /** Applies `fn` to the Pokémon in `ref`. Party Pokémon get their stats recalculated afterwards. */
  updateMon(ref: SlotRef, fn: (mon: BoxMon, party?: PartyMon) => void, opts: { heal?: boolean } = {}) {
    this.edit((b) => {
      if (ref.area === 'party') {
        const raws = this.readParty(b);
        const raw = raws[ref.index];
        if (!raw) throw new Error('No Pokémon in that party slot');
        const p = PartyMon.decode(raw);
        if (!p.box.checksumValid) throw new Error('This Pokémon is corrupted (Bad Egg) and cannot be edited');
        fn(p.box, p);
        recalcPartyStats(p, this.settings);
        if (opts.heal) healParty(p);
        raws[ref.index] = p.encode();
        writeParty(b.saveBlock1, raws);
      } else {
        const mon = BoxMon.decode(boxRaw(b.storage, ref.box, ref.index));
        if (mon.isEmpty) throw new Error('No Pokémon in that box slot');
        if (!mon.checksumValid) throw new Error('This Pokémon is corrupted (Bad Egg) and cannot be edited');
        fn(mon);
        writeBoxRaw(b.storage, ref.box, ref.index, mon.encode());
      }
    });
  }

  /** Places a new Pokémon in an empty slot (party: appended). Optionally registers it in the Pokédex. */
  addMon(ref: SlotRef, mon: BoxMon, registerInDex: boolean) {
    this.edit((b) => {
      if (ref.area === 'party') {
        const raws = this.readParty(b);
        if (raws.length >= PARTY_MAX) throw new Error('The party is full');
        raws.push(withdrawToParty(mon, this.settings).encode());
        writeParty(b.saveBlock1, raws);
      } else {
        if (!BoxMon.decode(boxRaw(b.storage, ref.box, ref.index)).isEmpty) throw new Error('That box slot is not empty');
        writeBoxRaw(b.storage, ref.box, ref.index, mon.encode());
      }
      if (registerInDex) registerCaught(b.saveBlock1, b.saveBlock2, mon.species, mon.personality);
    });
  }

  releaseMon(ref: SlotRef) {
    this.edit((b) => {
      if (ref.area === 'party') {
        const raws = this.readParty(b);
        if (!raws[ref.index]) throw new Error('No Pokémon in that party slot');
        raws.splice(ref.index, 1);
        this.assertPartyUsable(raws);
        writeParty(b.saveBlock1, raws);
      } else {
        writeBoxRaw(b.storage, ref.box, ref.index, new Uint8Array(BOX_MON_SIZE));
      }
    });
  }

  /** Moves a Pokémon; if the destination is occupied the two are swapped. Handles party ⇄ box conversion. */
  moveMon(from: SlotRef, to: SlotRef) {
    if (slotKey(from) === slotKey(to)) return;
    this.edit((b) => {
      const party = this.readParty(b);
      const take = (ref: SlotRef): BoxMon | PartyMon | null => {
        if (ref.area === 'party') return party[ref.index] ? PartyMon.decode(party[ref.index]!) : null;
        const m = BoxMon.decode(boxRaw(b.storage, ref.box, ref.index));
        return m.isEmpty ? null : m;
      };
      const a = take(from);
      if (!a) throw new Error('Nothing to move');
      const c = take(to);
      const asParty = (m: BoxMon | PartyMon) => (m instanceof PartyMon ? m : withdrawToParty(m, this.settings));
      const asBox = (m: BoxMon | PartyMon) => (m instanceof PartyMon ? depositToBox(m, this.settings) : m);

      if (from.area === 'box' && to.area === 'box') {
        writeBoxRaw(b.storage, to.box, to.index, (a as BoxMon).encode());
        writeBoxRaw(b.storage, from.box, from.index, c ? (c as BoxMon).encode() : new Uint8Array(BOX_MON_SIZE));
        return;
      }
      if (from.area === 'party' && to.area === 'party') {
        const target = Math.min(to.index, party.length - 1);
        const [moved] = party.splice(from.index, 1);
        party.splice(target, 0, moved!);
        writeParty(b.saveBlock1, party);
        return;
      }
      if (from.area === 'party' && to.area === 'box') {
        writeBoxRaw(b.storage, to.box, to.index, asBox(a).encode());
        if (c) party[from.index] = asParty(c).encode();
        else party.splice(from.index, 1);
        this.assertPartyUsable(party);
        writeParty(b.saveBlock1, party);
        return;
      }
      // box → party
      const fromBox = from as Extract<SlotRef, { area: 'box' }>;
      if (c) {
        party[to.index] = asParty(a).encode();
        writeBoxRaw(b.storage, fromBox.box, fromBox.index, asBox(c).encode());
      } else {
        if (party.length >= PARTY_MAX) throw new Error('The party is full');
        party.push(asParty(a).encode());
        writeBoxRaw(b.storage, fromBox.box, fromBox.index, new Uint8Array(BOX_MON_SIZE));
      }
      writeParty(b.saveBlock1, party);
    });
  }

  healParty() {
    this.edit((b) => {
      const raws = this.readParty(b).map((raw) => {
        const p = PartyMon.decode(raw);
        if (!p.box.checksumValid || p.box.isEgg) return raw;
        healParty(p);
        return p.encode();
      });
      writeParty(b.saveBlock1, raws);
    });
  }

  private assertPartyUsable(raws: Uint8Array[]) {
    const usable = raws.some((r) => {
      const p = PartyMon.decode(r);
      return p.box.checksumValid && !p.box.isEgg && p.box.species !== 0;
    });
    if (!usable) throw new Error('The party must keep at least one Pokémon that is not an Egg');
  }

  // ---- Changes, validation, export ------------------------------------------------------------------------

  changes(): ChangeEntry[] {
    const out: ChangeEntry[] = [];
    const t0 = readTrainer(this.original.saveBlock1, this.original.saveBlock2);
    const t1 = this.trainer;
    if (t0.money !== t1.money) out.push({ area: 'Trainer', label: 'Money', detail: `₽${t0.money.toLocaleString()} → ₽${t1.money.toLocaleString()}` });
    if (t0.coins !== t1.coins) out.push({ area: 'Trainer', label: 'Coins', detail: `${t0.coins} → ${t1.coins}` });
    if (t0.battlePoints !== t1.battlePoints) out.push({ area: 'Trainer', label: 'Battle Points', detail: `${t0.battlePoints} → ${t1.battlePoints}` });

    for (const def of POCKETS) {
      const before = new Map(readPocket(this.original.saveBlock1, this.original.saveBlock2, def).map((s) => [s.itemId, s.quantity]));
      const after = new Map(this.pocket(def.id).map((s) => [s.itemId, s.quantity]));
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const q0 = before.get(id) ?? 0;
        const q1 = after.get(id) ?? 0;
        if (q0 !== q1) out.push({ area: 'Bag', label: `${def.label}: ${game.items[id]?.name ?? `#${id}`}`, detail: q0 === 0 ? `added ×${q1}` : q1 === 0 ? 'removed' : `×${q0} → ×${q1}` });
      }
    }

    const names = this.boxNames();
    const compare = (ref: SlotRef, raw0: Uint8Array, raw1: Uint8Array, isParty: boolean) => {
      if (bytesEqual(raw0, raw1)) return;
      const decode = (raw: Uint8Array) => {
        if (isParty) { const p = PartyMon.decode(raw); return p.box.species ? summarize(p.box, this.settings, p) : null; }
        const m = BoxMon.decode(raw);
        return m.isEmpty ? null : summarize(m, this.settings);
      };
      const s0 = decode(raw0);
      const s1 = decode(raw1);
      const label = slotLabel(ref, names);
      if (!s0 && s1) out.push({ area: 'Pokémon', label, detail: `added ${s1.speciesName} Lv ${s1.level}` });
      else if (s0 && !s1) out.push({ area: 'Pokémon', label, detail: `removed ${s0.speciesName} Lv ${s0.level}` });
      else if (s0 && s1) {
        // Same individual (edited in place) vs. a different Pokémon now in this slot (moved/swapped).
        const sameMon = s0.otId === s1.otId && s0.metLocation === s1.metLocation && s0.metLevel === s1.metLevel;
        const diffs = sameMon ? describeMonChanges(s0, s1) : [];
        out.push({
          area: 'Pokémon',
          label,
          detail: sameMon ? `${s1.speciesName}: ${diffs.join('; ') || 'changed'}` : `now ${s1.speciesName} Lv ${s1.level} (was ${s0.speciesName} Lv ${s0.level})`,
        });
      }
    };
    const n0 = partyCount(this.original.saveBlock1);
    const n1 = partyCount(this.blocks.saveBlock1);
    for (let i = 0; i < Math.max(n0, n1); i++) {
      const empty = new Uint8Array(PARTY_MON_SIZE);
      compare({ area: 'party', index: i }, i < n0 ? partyRaw(this.original.saveBlock1, i) : empty,
        i < n1 ? partyRaw(this.blocks.saveBlock1, i) : empty, true);
    }
    for (let bx = 0; bx < BOX_COUNT; bx++) {
      for (let s = 0; s < BOX_SLOTS; s++) compare({ area: 'box', box: bx, index: s }, boxRaw(this.original.storage, bx, s), boxRaw(this.blocks.storage, bx, s), false);
    }

    const newlyCaught = game.species.filter((sp) => !sp.unused && !isCaught(this.original.saveBlock1, this.original.saveBlock2, sp.id) && this.isCaught(sp.id));
    if (newlyCaught.length) out.push({ area: 'Pokédex', label: 'Registered as caught', detail: newlyCaught.map((s) => s.name).join(', ') });
    return out;
  }

  /** Errors block saving; warnings are shown. Only Pokémon that differ from the original file are checked. */
  validate(): ValidationResult {
    // Bag pockets and trainer values are validated when they are written, so only Pokémon are checked here.
    const errors: string[] = [];
    const warnings: string[] = [];
    const originalRaws = new Set<string>();
    const hex = (r: Uint8Array) => Array.from(r.subarray(0, BOX_MON_SIZE), (x) => x.toString(16).padStart(2, '0')).join('');
    for (let i = 0; i < partyCount(this.original.saveBlock1); i++) originalRaws.add(hex(partyRaw(this.original.saveBlock1, i)));
    for (let bx = 0; bx < BOX_COUNT; bx++) for (let s = 0; s < BOX_SLOTS; s++) originalRaws.add(hex(boxRaw(this.original.storage, bx, s)));

    const names = this.boxNames();
    const check = (at: MonAt) => {
      if (originalRaws.has(hex(at.box.encode()))) return;
      const where = slotLabel(at.ref, names);
      const r = validateMon(at.box, at.party);
      errors.push(...r.errors.map((e) => `${where}: ${e}`));
      warnings.push(...r.warnings.map((w) => `${where}: ${w}`));
    };
    this.party().forEach(check);
    for (let bx = 0; bx < BOX_COUNT; bx++) this.box(bx).forEach((m) => m && check(m));
    return { errors, warnings };
  }

  /** Builds the edited file and verifies it independently. Throws if validation or verification fails. */
  export(): ExportResult {
    if (this.readOnlyReason) throw new Error(`Read-only: ${this.readOnlyReason}`);
    const { errors } = this.validate();
    if (errors.length) throw new Error(`Fix these first:\n${errors.join('\n')}`);
    const { bytes, changedSectors } = writeBlocks(this.image, this.blocks);
    const report = verifyExport(this.image, bytes, this.blocks, changedSectors);
    if (!report.ok) {
      const failed = report.checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join('\n');
      throw new Error(`Verification failed — nothing was saved.\n${failed}`);
    }
    return { bytes, report };
  }
}

/** Structural checks for one Pokémon. */
export function validateMon(mon: BoxMon, party?: PartyMon): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!mon.checksumValid) return { errors: ['data is corrupted (bad checksum)'], warnings };
  const sp = game.species[mon.species];
  if (!sp || sp.unused) errors.push('invalid species');
  if (sp && mon.sub0.get('experience') > expForLevel(mon.species, 100)) errors.push('EXP above level 100');
  const moves = mon.moves.filter(Boolean);
  if (!moves.length && !mon.isEgg) errors.push('needs at least one move');
  if (new Set(moves).size !== moves.length) errors.push('the same move is known twice');
  mon.moves.forEach((m, i) => {
    if (m && !game.moves[m]) errors.push(`move ${i + 1} is invalid`);
    else if (m && mon.pp[i]! > maxPP(m, mon.ppUps[i]!)) errors.push(`move ${i + 1} has more PP than its maximum`);
  });
  const hidden = mon.sub0.get('hiddenNature');
  if (hidden !== HIDDEN_NATURE_NONE && hidden >= game.natures.length) errors.push('invalid nature');
  const item = mon.sub0.get('heldItem');
  if (item) {
    const it = game.items[item];
    if (!it || it.unused) errors.push('invalid held item');
    else if (it.pocket === constant('POCKET_KEY_ITEMS')) errors.push(`can't hold a key item (${it.name})`);
  }
  const ball = game.items[mon.sub3.get('pokeball')];
  if (!ball || ball.pocket !== constant('POCKET_POKE_BALLS')) errors.push('invalid Poké Ball');
  if (sp && mon.sub3.get('abilityNum') === 1 && !sp.abilities[1]) warnings.push(`${sp.name} has no second ability`);
  const evs = mon.evs;
  const total = evs.reduce((a, b) => a + b, 0);
  if (total > MAX_TOTAL_EV) warnings.push(`EV total ${total} is above the normal maximum of ${MAX_TOTAL_EV}`);
  if (evs.some((e) => e > MAX_EV)) warnings.push(`an EV is above the normal maximum of ${MAX_EV}`);
  if (party && party.hp > party.maxHP) errors.push('HP above maximum');
  return { errors, warnings };
}
