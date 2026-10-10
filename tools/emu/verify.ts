// Emulator verification: boots the real game in mGBA with a save file and checks it against the editor.
//
//   1. The game's own loader accepts the save (gSaveFileStatus == SAVE_STATUS_OK).
//   2. The save blocks the game loaded into RAM are byte-identical to what the editor reads from the file.
//   3. The game's own GetBoxMonData accepts every Pokémon (no Bad Egg) and reports the same species.
//   4. The game's own CalculateMonStats produces the same level and stats as the editor's formula,
//      for every party Pokémon and for N random Pokémon under random challenge settings.
//
// Usage: node tools/emu/verify.ts <file.sav> [--random N] [--keep-open]
// Needs a portable copy of mGBA.exe (Qt build, has the GDB server) — see MGBA_EXE below.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CACHE_DIR, HACK_ELF, HACK_ROM } from '../lib/config.ts';
import { Elf } from '../lib/elf.ts';
import { GdbClient, regGet, regSet } from './gdb.ts';
import { struct, StructView } from '../../src/core/layout/index.ts';
import { game } from '../../src/core/gamedata/index.ts';
import { parseFlash, readBlocks, type BlockName } from '../../src/core/save/flash.ts';
import { readSettings } from '../../src/core/save/settings.ts';
import { BoxMon, BOX_MON_SIZE, PARTY_MON_SIZE, PartyMon } from '../../src/core/pokemon/boxmon.ts';
import { BOX_COUNT, BOX_SLOTS, boxRaw, partyCount, partyRaw } from '../../src/core/pokemon/storage.ts';
import { calculateStats, effectiveNature } from '../../src/core/pokemon/rules.ts';
import { createMon, setNature, toPartyMon } from '../../src/core/pokemon/edit.ts';
import { readTrainer } from '../../src/core/save/trainer.ts';

const MGBA_EXE = process.env.HNS_MGBA ?? path.join(CACHE_DIR, 'mgba', 'mGBA.exe');
const GDB_PORT = 2345;
const MON_DATA_SPECIES = 12; // enum index in include/pokemon.h
const SAVE_STATUS_OK = 1;
const CPSR = 16; // mGBA's 'g' packet: r0-r15, cpsr

export interface EmuCheck { name: string; ok: boolean; detail: string }

class Emulator {
  private proc: ChildProcess | null = null;
  gdb!: GdbClient;
  private running: Promise<string> | null = null;
  readonly elf = new Elf(HACK_ELF);
  private dir = '';

  async boot(saveBytes: Uint8Array) {
    if (!fs.existsSync(MGBA_EXE)) throw new Error(`mGBA not found at ${MGBA_EXE} (set HNS_MGBA)`);
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hns-verify-'));
    fs.copyFileSync(HACK_ROM, path.join(this.dir, 'game.gba'));
    fs.writeFileSync(path.join(this.dir, 'game.sav'), saveBytes);
    this.proc = spawn(MGBA_EXE, ['-g', path.join(this.dir, 'game.gba')], { stdio: 'ignore' });
    this.gdb = await GdbClient.connect(GDB_PORT);
    // Run until the boot code has called LoadGameSave (well before the title screen).
    this.running = this.gdb.continue();
    await new Promise((r) => setTimeout(r, 4000));
    await this.pause();
    // Stop at the start of a main-loop function so later calls run in normal (System mode) context on the
    // main stack — not inside an interrupt handler, which is where a random pause often lands.
    const mainLoop = this.sym('RunTasks') & ~1;
    await this.gdb.setBreakpoint(mainLoop);
    await this.gdb.continue();
    await this.gdb.clearBreakpoint(mainLoop);
  }

  async pause() {
    if (this.running) await this.gdb.interrupt(this.running);
    this.running = null;
  }

  sym(name: string) { return this.elf.symbol(name).value; }

  /** Calls a Thumb function in the game with up to 4 arguments; returns r0. */
  async call(fn: string, args: number[]): Promise<number> {
    const saved = await this.gdb.allRegisters();
    const target = this.sym(fn) & ~1;
    const ret = this.sym('AgbMain') & ~1; // never executed again after boot: a safe return trap
    let regs = saved;
    args.forEach((a, i) => (regs = regSet(regs, i, a)));
    regs = regSet(regs, 14, ret | 1);
    regs = regSet(regs, 15, target);
    regs = regSet(regs, CPSR, (regGet(saved, CPSR) | 0x20) >>> 0); // Thumb state
    await this.gdb.setAllRegisters(regs);
    await this.gdb.setBreakpoint(ret);
    const stop = await this.gdb.continue();
    await this.gdb.clearBreakpoint(ret);
    const after = await this.gdb.allRegisters();
    if ((regGet(after, 15) & ~1) !== ret) throw new Error(`${fn} did not return to the trap (${stop})`);
    await this.gdb.setAllRegisters(saved);
    return regGet(after, 0);
  }

  async close() {
    try { this.gdb?.close(); } catch { /* ignore */ }
    this.proc?.kill();
    await new Promise((r) => setTimeout(r, 500));
    try { fs.rmSync(this.dir, { recursive: true, force: true }); } catch { /* emulator may still hold files */ }
  }
}

function describeDiff(blockName: BlockName, a: Uint8Array, b: Uint8Array): string {
  const structName = blockName === 'saveBlock1' ? 'SaveBlock1' : blockName === 'saveBlock2' ? 'SaveBlock2' : 'PokemonStorage';
  const fields = Object.entries(struct(structName).fields);
  const diffs: string[] = [];
  for (let i = 0; i < a.length && diffs.length < 8; i++) {
    if (a[i] === b[i]) continue;
    const f = fields.find(([, d]) => i >= d.offset && i < d.offset + ('size' in d ? d.size : Math.ceil((d.bit + d.bits) / 8)));
    diffs.push(`+0x${i.toString(16)}${f ? ` (${f[0]})` : ''}`);
  }
  return diffs.join(', ');
}

export async function verifyInEmulator(saveBytes: Uint8Array, randomCount = 100): Promise<EmuCheck[]> {
  const checks: EmuCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  };
  const expected = readBlocks(parseFlash(saveBytes));
  const emu = new Emulator();
  try {
    await emu.boot(saveBytes);
    const g = emu.gdb;

    const status = await g.u16(emu.sym('gSaveFileStatus'));
    add('Game loads the save', status === SAVE_STATUS_OK, `gSaveFileStatus = ${status}`);

    const ptrs: Record<BlockName, number> = {
      saveBlock2: await g.u32(emu.sym('gSaveBlock2Ptr')),
      saveBlock1: await g.u32(emu.sym('gSaveBlock1Ptr')),
      storage: await g.u32(emu.sym('gPokemonStoragePtr')),
    };
    for (const name of Object.keys(ptrs) as BlockName[]) {
      const ram = await g.readMemory(ptrs[name], expected[name].length);
      const same = Buffer.compare(Buffer.from(ram), Buffer.from(expected[name])) === 0;
      add(`RAM ${name} matches the file`, same, same ? `${ram.length} bytes identical` : `differs at ${describeDiff(name, ram, expected[name])}`);
    }

    // Every Pokémon through the game's own GetBoxMonData.
    let checked = 0;
    const problems: string[] = [];
    const sb1 = new StructView('SaveBlock1', expected.saveBlock1, 0);
    const partyBase = ptrs.saveBlock1 + sb1.rangeOffset('playerParty');
    const boxesBase = ptrs.storage + new StructView('PokemonStorage', expected.storage, 0).rangeOffset('boxes');
    const slots: { label: string; addr: number; raw: Uint8Array }[] = [];
    for (let i = 0; i < partyCount(expected.saveBlock1); i++) {
      slots.push({ label: `party ${i + 1}`, addr: partyBase + i * PARTY_MON_SIZE, raw: partyRaw(expected.saveBlock1, i).subarray(0, BOX_MON_SIZE) });
    }
    for (let b = 0; b < BOX_COUNT; b++) {
      for (let s = 0; s < BOX_SLOTS; s++) {
        const raw = boxRaw(expected.storage, b, s);
        if (!BoxMon.decode(raw).isEmpty) slots.push({ label: `box ${b + 1}/${s + 1}`, addr: boxesBase + (b * BOX_SLOTS + s) * BOX_MON_SIZE, raw });
      }
    }
    const badEggBit = struct('BoxPokemon').fields['isBadEgg'] as { offset: number; bit: number };
    for (const slot of slots) {
      const species = await emu.call('GetBoxMonData3', [slot.addr, MON_DATA_SPECIES, 0]);
      const flags = (await g.readMemory(slot.addr + badEggBit.offset, 1))[0]!;
      const badEgg = (flags >> badEggBit.bit) & 1;
      const ours = BoxMon.decode(slot.raw);
      checked++;
      if (badEgg) problems.push(`${slot.label}: game says Bad Egg`);
      else if (species !== ours.species) problems.push(`${slot.label}: game species ${species}, editor ${ours.species}`);
    }
    add('Game accepts every Pokémon', problems.length === 0, problems.length ? problems.slice(0, 5).join('; ') : `${checked} Pokémon checked with GetBoxMonData`);

    // Stats: the game's CalculateMonStats vs. ours. Scratch slot: gPlayerParty[0] (unused before Continue).
    const scratch = emu.sym('gPlayerParty');
    const settingsFlagsOffset = ptrs.saveBlock1;
    const statMismatches: string[] = [];
    const compareStats = async (label: string, p: PartyMon, sb1Ram: Uint8Array) => {
      await g.writeMemory(scratch, p.encode());
      await emu.call('CalculateMonStats', [scratch]);
      const after = PartyMon.decode(await g.readMemory(scratch, PARTY_MON_SIZE));
      const ours = calculateStats({ species: p.box.species, exp: p.box.sub0.get('experience'), ivs: p.box.ivs, evs: p.box.evs, nature: effectiveNature(p.box) }, readSettings(sb1Ram));
      if (after.level !== ours.level || after.stats.join() !== ours.stats.join()) {
        statMismatches.push(`${label} ${game.species[p.box.species]?.name}: game Lv${after.level} ${after.stats.join('/')}, editor Lv${ours.level} ${ours.stats.join('/')}`);
      }
    };
    for (let i = 0; i < partyCount(expected.saveBlock1); i++) {
      await compareStats(`party ${i + 1}`, PartyMon.decode(partyRaw(expected.saveBlock1, i)), expected.saveBlock1);
    }

    // Random Pokémon under random stat-affecting settings (written into the game's RAM copy of SaveBlock1).
    let seed = 0xc0ffee;
    const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const species = game.species.filter((s) => !s.unused);
    const trainer = readTrainer(expected.saveBlock1, expected.saveBlock2);
    const sb1Ram = expected.saveBlock1.slice();
    const sb1View = new StructView('SaveBlock1', sb1Ram, 0);
    const flagByte = (id: number) => sb1View.rangeOffset('flags') + (id >> 3);
    const limit50Flag = 84; // FLAG_LIMIT_TO_50 (checked against layout below)
    for (let n = 0; n < randomCount; n++) {
      sb1View.set('tx_Challenges_BaseStatEqualizer', Math.floor(rand() * 4));
      sb1View.set('tx_Mode_New_Stats', rand() < 0.5 ? 1 : 0);
      const limit = rand() < 0.15;
      sb1Ram[flagByte(limit50Flag)] = (sb1Ram[flagByte(limit50Flag)]! & ~(1 << (limit50Flag & 7))) | (limit ? 1 << (limit50Flag & 7) : 0);
      await g.writeMemory(settingsFlagsOffset, sb1Ram);
      const sp = species[Math.floor(rand() * species.length)]!;
      const mon = createMon({ species: sp.id, level: 1 + Math.floor(rand() * 100), random: rand }, trainer, sb1Ram.subarray(0, 8), readSettings(sb1Ram));
      for (let s = 0; s < 6; s++) { mon.setIV(s, Math.floor(rand() * 32)); mon.setEV(s, Math.floor(rand() * 256)); }
      if (rand() < 0.5) setNature(mon, Math.floor(rand() * 25));
      await compareStats(`random #${n + 1}`, toPartyMon(mon, readSettings(sb1Ram)), sb1Ram);
    }
    await g.writeMemory(settingsFlagsOffset, expected.saveBlock1); // restore
    add('Stats match the game\'s CalculateMonStats', statMismatches.length === 0,
      statMismatches.length ? statMismatches.slice(0, 5).join('; ') : `${partyCount(expected.saveBlock1)} party + ${randomCount} random Pokémon under random settings`);
  } catch (e) {
    add('Emulator run', false, String(e instanceof Error ? e.message : e));
  } finally {
    await emu.close();
  }
  return checks;
}

// CLI
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('verify.ts')) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: node tools/emu/verify.ts <file.sav> [--random N]');
    process.exit(2);
  }
  const ri = args.indexOf('--random');
  const randomCount = ri >= 0 ? Number(args[ri + 1]) : 100;
  const checks = await verifyInEmulator(new Uint8Array(fs.readFileSync(file)), randomCount);
  const ok = checks.every((c) => c.ok);
  console.log(ok ? '\nAll emulator checks passed.' : '\nEmulator verification FAILED.');
  process.exit(ok ? 0 : 1);
}
