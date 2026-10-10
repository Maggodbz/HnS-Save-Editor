// Game formulas vs. values the real game stored, plus hand-checked cases.
import { describe, expect, it } from 'vitest';
import { game } from '../src/core/gamedata/index.ts';
import { PartyMon } from '../src/core/pokemon/boxmon.ts';
import {
  abilityOf, adjustCurrentHP, calculateStats, effectiveNature, expForLevel, gender, isShiny, levelFromExp,
  maxPP, modifyStatByNature, natureFromPersonality, rerollPersonalityForShiny,
} from '../src/core/pokemon/rules.ts';
import { partyCount, partyRaw } from '../src/core/pokemon/storage.ts';
import { parseFlash, readBlocks } from '../src/core/save/flash.ts';
import { readSettings, type SaveSettings } from '../src/core/save/settings.ts';
import { fixtureSaves, rng } from './helpers.ts';

const defaults: SaveSettings = {
  tx: {}, baseStatEqualizer: 0, newStats: false, modernMoves: true, modernTypes: false, legendaryAbilities: false,
  randomAbilities: false, shinyChance: 0, maxPartyIVs: 0, limitToLevel50: false, finiteTMs: false, pcHeal: false,
};
const id = (name: string) => game.species.find((s) => s.name === name)!.id;

describe.skipIf(fixtureSaves().length === 0)('stats match what the game stored', () => {
  for (const { name, bytes } of fixtureSaves()) {
    it(name, () => {
      const blocks = readBlocks(parseFlash(bytes));
      const settings = readSettings(blocks.saveBlock1);
      for (let i = 0; i < partyCount(blocks.saveBlock1); i++) {
        const p = PartyMon.decode(partyRaw(blocks.saveBlock1, i));
        const r = calculateStats({ species: p.box.species, exp: p.box.sub0.get('experience'), ivs: p.box.ivs, evs: p.box.evs, nature: effectiveNature(p.box) }, settings);
        expect(r.level).toBe(p.level);
        expect(r.stats).toEqual(p.stats);
      }
    });
  }
});

describe('stat formula', () => {
  it('matches the standard Gen 3 formula (Garchomp-style hand check with Bulbasaur)', () => {
    // Bulbasaur 45/49/49/45/65/65, Lv 50, IV 31, EV 0, Adamant (+Atk -SpAtk)
    const bulba = id('BULBASAUR');
    const exp = expForLevel(bulba, 50);
    const r = calculateStats({ species: bulba, exp, ivs: [31, 31, 31, 31, 31, 31], evs: [0, 0, 0, 0, 0, 0], nature: 3 }, defaults);
    expect(r.level).toBe(50);
    // HP = (2*45+31)*50/100 + 50 + 10 = 60 + 60 = 120
    expect(r.stats[0]).toBe(120);
    // Atk = ((2*49+31)*50/100 + 5) * 1.1 = (64 + 5) * 1.1 = 75.9 → 75
    expect(r.stats[1]).toBe(75);
    // SpAtk = ((2*65+31)*50/100 + 5) * 0.9 = (80 + 5) * 0.9 = 76.5 → 76
    expect(r.stats[4]).toBe(76);
  });

  it('applies the Base Stat Equalizer and level-50 options', () => {
    const bulba = id('BULBASAUR');
    const exp = expForLevel(bulba, 30);
    const eq = calculateStats({ species: bulba, exp, ivs: [0, 0, 0, 0, 0, 0], evs: [0, 0, 0, 0, 0, 0], nature: 0 }, { ...defaults, baseStatEqualizer: 1 });
    // All bases 100 at Lv 30: HP = 200*30/100+30+10 = 100; others = 200*30/100+5 = 65
    expect(eq.stats).toEqual([100, 65, 65, 65, 65, 65]);
    const l50 = calculateStats({ species: bulba, exp, ivs: [0, 0, 0, 0, 0, 0], evs: [0, 0, 0, 0, 0, 0], nature: 0 }, { ...defaults, limitToLevel50: true });
    expect(l50.level).toBe(50);
  });

  it('uses Shedinja\'s fixed 1 HP', () => {
    const shed = id('SHEDINJA');
    const r = calculateStats({ species: shed, exp: expForLevel(shed, 40), ivs: [31, 31, 31, 31, 31, 31], evs: [252, 0, 0, 0, 0, 0], nature: 0 }, defaults);
    expect(r.stats[0]).toBe(1);
    expect(adjustCurrentHP(shed, 1, 1, 1)).toBe(1);
  });

  it('keeps current HP relative when max HP changes', () => {
    expect(adjustCurrentHP(1, 50, 100, 120)).toBe(70);
    expect(adjustCurrentHP(1, 0, 0, 120)).toBe(120); // fresh mon: full HP
    expect(adjustCurrentHP(1, 0, 100, 120)).toBe(0); // fainted stays fainted
    expect(adjustCurrentHP(1, 5, 100, 50)).toBe(1); // never drops to 0 (BUGFIX build)
  });

  it('nature modifiers use 10% rounded down', () => {
    expect(modifyStatByNature(1, 100, 1)).toBe(110); // Lonely +Atk
    expect(modifyStatByNature(1, 100, 2)).toBe(90); // Lonely -Def
    expect(modifyStatByNature(1, 100, 0)).toBe(100); // HP never changes
    expect(modifyStatByNature(0, 99, 3)).toBe(99); // Hardy neutral
  });
});

describe('level & EXP', () => {
  it('is consistent for every growth rate and level', () => {
    for (const sp of game.species.filter((s) => !s.unused).slice(0, 60)) {
      for (let lvl = 1; lvl <= 100; lvl++) expect(levelFromExp(sp.id, expForLevel(sp.id, lvl))).toBe(lvl);
    }
  });
});

describe('gender, shiny, ability, PP', () => {
  it('derives gender from the personality low byte', () => {
    const torchic = id('TORCHIC'); // 87.5% male → ratio 31
    expect(gender(torchic, 0x00)).toBe('female');
    expect(gender(torchic, 0xff)).toBe('male');
    expect(gender(id('MAGNEMITE'), 0x00)).toBe('genderless');
  });

  it('rerolls shininess while keeping gender and (when possible) nature', () => {
    const r = rng(7);
    for (const shinyChance of [0, 4]) {
      const settings = { ...defaults, shinyChance };
      for (let i = 0; i < 300; i++) {
        const otId = Math.floor(r() * 2 ** 32) >>> 0;
        const pid = Math.floor(r() * 2 ** 32) >>> 0;
        const shiny = rerollPersonalityForShiny(otId, pid, true, settings);
        expect(isShiny(otId, shiny.personality, settings)).toBe(true);
        expect(shiny.personality & 0xffff).toBe(pid & 0xffff);
        if (shiny.natureKept) expect(natureFromPersonality(shiny.personality)).toBe(natureFromPersonality(pid));
        const plain = rerollPersonalityForShiny(otId, shiny.personality, false, settings);
        expect(isShiny(otId, plain.personality, settings)).toBe(false);
        expect(plain.personality & 0xffff).toBe(pid & 0xffff);
      }
    }
  });

  it('returns abilities per slot, honouring the legendary-ability option', () => {
    const lugia = id('LUGIA');
    const sp = game.species[lugia]!;
    expect(abilityOf(lugia, 0, { ...defaults, legendaryAbilities: true })).toBe(sp.abilities[0]);
    expect(abilityOf(lugia, 0, defaults)).toBe(sp.abilitiesOld[0]);
    expect(abilityOf(lugia, 0, { ...defaults, randomAbilities: true })).toBeNull();
  });

  it('adds 20% of base PP per PP Up', () => {
    const tackle = game.moves.find((m) => m.name === 'TACKLE')!;
    expect(maxPP(tackle.id, 0)).toBe(tackle.pp);
    expect(maxPP(tackle.id, 3)).toBe(tackle.pp + Math.floor((tackle.pp * 60) / 100));
  });
});
