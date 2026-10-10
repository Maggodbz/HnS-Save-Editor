// End-to-end editing: every edit is exported, re-opened from bytes and checked.
import { describe, expect, it } from 'vitest';
import { constant } from '../src/core/layout/index.ts';
import { game } from '../src/core/gamedata/index.ts';
import { createMon, setLevel, setMove, setNature, setShiny } from '../src/core/pokemon/edit.ts';
import { calculateStats, effectiveNature } from '../src/core/pokemon/rules.ts';
import { itemsForPocket, pocketDef } from '../src/core/save/bag.ts';
import { parseFlash } from '../src/core/save/flash.ts';
import { SaveSession } from '../src/core/save/session.ts';
import { fixtureSaves, syntheticSave } from './helpers.ts';

const itemId = (name: string) => game.items.find((i) => i.name === name && !i.unused)!.id;
const speciesId = (name: string) => game.species.find((s) => s.name === name)!.id;

/** Export, check the verification report, and reopen the result as a fresh session. */
function roundTrip(s: SaveSession): SaveSession {
  const { bytes, report } = s.export();
  expect(report.ok).toBe(true);
  return SaveSession.open(bytes, s.fileName);
}

const saves = [{ name: 'synthetic', bytes: syntheticSave() }, ...fixtureSaves()];

describe.each(saves)('$name', ({ name, bytes }) => {
  const open = () => SaveSession.open(bytes, name);

  it('opens clean and exports byte-identical when nothing changed', () => {
    const s = open();
    expect(s.isDirty).toBe(false);
    expect(s.changes()).toEqual([]);
    const { bytes: out, report } = s.export();
    expect(report.changedSectors).toEqual([]);
    expect(out).toEqual(bytes);
  });

  it('edits money, coins and Battle Points', () => {
    const s = open();
    s.setMoney(999_999);
    s.setCoins(9999);
    s.setBattlePoints(500);
    const r = roundTrip(s);
    expect(r.trainer.money).toBe(999_999);
    expect(r.trainer.coins).toBe(9999);
    expect(r.trainer.battlePoints).toBe(500);
    expect(() => s.setMoney(-1)).toThrow();
    expect(() => s.setBattlePoints(10_000)).toThrow();
  });

  it('adds all TMs, 99 Heart Scales and 99 Rare Candies', () => {
    const s = open();
    const tmhm = itemsForPocket(pocketDef('tmhm'));
    s.setPocket('tmhm', tmhm.map((it) => ({ itemId: it.id, quantity: 1 })));
    const items = s.pocket('items').filter((x) => x.itemId !== itemId('HEART SCALE') && x.itemId !== itemId('RARE CANDY'));
    s.setPocket('items', [...items, { itemId: itemId('HEART SCALE'), quantity: 99 }, { itemId: itemId('RARE CANDY'), quantity: 99 }]);
    const r = roundTrip(s);
    expect(r.pocket('tmhm').map((x) => x.itemId)).toEqual(tmhm.map((it) => it.id));
    expect(r.pocket('items').find((x) => x.itemId === itemId('HEART SCALE'))?.quantity).toBe(99);
    expect(r.pocket('items').find((x) => x.itemId === itemId('RARE CANDY'))?.quantity).toBe(99);
    // Other pockets untouched
    expect(r.pocket('keyItems')).toEqual(open().pocket('keyItems'));
  });

  it('rejects invalid bag contents without changing anything', () => {
    const s = open();
    expect(() => s.setPocket('items', [{ itemId: itemId('POKé BALL'), quantity: 1 }])).toThrow(/another pocket/);
    expect(() => s.setPocket('items', [{ itemId: itemId('POTION'), quantity: 1000 }])).toThrow(/quantity/);
    expect(() => s.setPocket('items', [{ itemId: itemId('POTION'), quantity: 1 }, { itemId: itemId('POTION'), quantity: 2 }])).toThrow(/twice/);
    expect(s.isDirty).toBe(false);
  });

  it('edits a party Pokémon and recalculates its stats', () => {
    const s = open();
    const ref = { area: 'party' as const, index: 0 };
    const tackle = game.moves.find((m) => m.name === 'SURF')!.id;
    s.updateMon(ref, (m) => {
      setLevel(m, 55);
      setNature(m, 3);
      [31, 31, 31, 31, 31, 31].forEach((v, i) => m.setIV(i, v));
      setMove(m, 3, m.moves.includes(tackle) ? 0 : tackle);
      setShiny(m, true, s.settings);
    });
    const r = roundTrip(s);
    const p = r.party()[0]!;
    expect(p.party!.level).toBe(55);
    expect(effectiveNature(p.box)).toBe(3);
    expect(p.box.ivs).toEqual([31, 31, 31, 31, 31, 31]);
    const expected = calculateStats({ species: p.box.species, exp: p.box.sub0.get('experience'), ivs: p.box.ivs, evs: p.box.evs, nature: 3 }, r.settings);
    expect(p.party!.stats).toEqual(expected.stats);
    expect(s.changes().some((c) => c.area === 'Pokémon' && c.detail.includes('level'))).toBe(true);
  });

  it('creates Pokémon in a box and in the party, registering them in the Pokédex', () => {
    const s = open();
    const mon = createMon({ species: speciesId('DRATINI'), level: 20, shiny: true, nature: 10 }, s.trainer, s.playerNameBytes, s.settings);
    const emptyBoxSlot = s.box(14).findIndex((m) => m === null);
    s.addMon({ area: 'box', box: 14, index: emptyBoxSlot }, mon, true);
    if (s.party().length < 6) s.addMon({ area: 'party', index: s.party().length }, mon.clone(), true);
    const r = roundTrip(s);
    const boxed = r.box(14)[emptyBoxSlot]!;
    expect(boxed.box.species).toBe(speciesId('DRATINI'));
    expect(r.isCaught(speciesId('DRATINI'))).toBe(true);
    expect(boxed.box.moves.filter(Boolean).length).toBeGreaterThan(0);
    const inParty = r.party().find((p) => p.box.species === speciesId('DRATINI'));
    if (inParty) expect(inParty.party!.hp).toBe(inParty.party!.stats[0]);
  });

  it('moves Pokémon between party and boxes, with undo/redo', () => {
    const s = open();
    const partyBefore = s.party().length;
    const target = { area: 'box' as const, box: 13, index: s.box(13).findIndex((m) => m === null) };
    if (partyBefore === 1) {
      expect(() => s.moveMon({ area: 'party', index: 0 }, target)).toThrow(/at least one/);
      return;
    }
    const species = s.party()[0]!.box.species;
    s.moveMon({ area: 'party', index: 0 }, target);
    expect(s.party().length).toBe(partyBefore - 1);
    expect(s.box(13)[target.index]!.box.species).toBe(species);
    s.moveMon(target, { area: 'party', index: 5 });
    expect(s.party().at(-1)!.box.species).toBe(species);
    const r = roundTrip(s);
    expect(r.party().length).toBe(partyBefore);
    s.undo();
    expect(s.party().length).toBe(partyBefore - 1);
    s.redo();
    expect(s.party().length).toBe(partyBefore);
    s.revertAll();
    expect(s.isDirty).toBe(false);
  });

  it('keeps the other save slot and the rest of the file untouched', () => {
    const s = open();
    s.setMoney(1234);
    const { bytes: out, report } = s.export();
    const before = parseFlash(bytes);
    const after = parseFlash(out);
    const other = before.activeSlot === 0 ? 1 : 0;
    expect(after.slots[other].sectors.map((x) => x.checksum)).toEqual(before.slots[other].sectors.map((x) => x.checksum));
    expect(report.checks.every((c) => c.ok)).toBe(true);
    expect(out.subarray(0x20000)).toEqual(bytes.subarray(0x20000));
  });

  it('refuses to export invalid Pokémon', () => {
    const s = open();
    s.updateMon({ area: 'party', index: 0 }, (m) => {
      m.setMove(0, 0); m.setMove(1, 0); m.setMove(2, 0); m.setMove(3, 0);
    });
    expect(s.validate().errors.join()).toMatch(/at least one move/);
    expect(() => s.export()).toThrow(/Fix these first/);
  });
});

describe('random edit sequences always produce a verified, re-loadable save', () => {
  it('fuzz', () => {
    const base = SaveSession.open(syntheticSave(9), 'fuzz');
    let seed = 1234;
    const r = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    const species = game.species.filter((sp) => !sp.unused);
    for (let round = 0; round < 40; round++) {
      const s = SaveSession.open(base.export().bytes, 'fuzz');
      for (let step = 0; step < 6; step++) {
        const op = Math.floor(r() * 5);
        try {
          if (op === 0) s.setMoney(Math.floor(r() * 9_999_999));
          if (op === 1) {
            const sp = species[Math.floor(r() * species.length)]!;
            const mon = createMon({ species: sp.id, level: 1 + Math.floor(r() * 100), random: r }, s.trainer, s.playerNameBytes, s.settings);
            const box = Math.floor(r() * 14);
            const slot = s.box(box).findIndex((m) => m === null);
            if (slot >= 0) s.addMon({ area: 'box', box, index: slot }, mon, r() < 0.5);
          }
          if (op === 2 && s.party().length) s.updateMon({ area: 'party', index: 0 }, (m) => setLevel(m, 1 + Math.floor(r() * 100)));
          if (op === 3) {
            const filled = Array.from({ length: 14 }, (_, b) => s.box(b).filter(Boolean)).flat();
            const pick = filled[Math.floor(r() * filled.length)];
            if (pick && s.party().length < 6) s.moveMon(pick.ref, { area: 'party', index: 5 });
          }
          if (op === 4) s.setPocket('berries', [{ itemId: itemsForPocket(pocketDef('berries'))[0]!.id, quantity: 1 + Math.floor(r() * 999) }]);
        } catch (e) {
          // Rejected edits are fine (e.g. party full) — they must leave the session unchanged.
          void e;
        }
      }
      const { bytes, report } = s.export();
      expect(report.ok).toBe(true);
      const again = SaveSession.open(bytes, 'fuzz');
      expect(again.trainer).toEqual(s.trainer);
      expect(again.party().map((p) => p.party!.encode())).toEqual(s.party().map((p) => p.party!.encode()));
    }
    expect(constant('PARTY_SIZE')).toBe(6);
  });
});
