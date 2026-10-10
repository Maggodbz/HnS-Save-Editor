import { useState } from 'react';
import { game } from '../../core/gamedata/index.ts';
import { createMon } from '../../core/pokemon/edit.ts';
import { abilityOf } from '../../core/pokemon/rules.ts';
import type { SlotRef } from '../../core/pokemon/storage.ts';
import type { SaveSession } from '../../core/save/session.ts';
import { Combobox } from '../components/Combobox.tsx';
import { NumberInput } from '../components/NumberInput.tsx';
import { MonFront } from '../components/Sprite.tsx';
import { useGuard } from '../components/Toasts.tsx';
import { abilityName, speciesName } from '../format.ts';
import { ballOptions, natureOptions, speciesOptions } from '../options.ts';

export function CreateMonDialog({ session, target, onClose, onCreated }: {
  session: SaveSession;
  target: SlotRef;
  onClose: () => void;
  onCreated: (ref: SlotRef) => void;
}) {
  const guard = useGuard();
  const [species, setSpeciesId] = useState<number | null>(null);
  const [level, setLevel] = useState(5);
  const [nature, setNature] = useState<number | null>(null);
  const [abilityNum, setAbilityNum] = useState<0 | 1>(0);
  const [shiny, setShiny] = useState(false);
  const [gender, setGender] = useState<'random' | 'male' | 'female'>('random');
  const [ball, setBall] = useState(4);
  const [maxIVs, setMaxIVs] = useState(false);
  const [register, setRegister] = useState(true);
  const sp = species !== null ? game.species[species] : undefined;
  const gendered = sp && sp.genderRatio > 0 && sp.genderRatio < 254;
  const where = target.area === 'party' ? 'your party' : `${session.boxNames()[target.box]}, slot ${target.index + 1}`;

  const create = () => {
    if (species === null) return;
    const ok = guard(() => {
      const mon = createMon({
        species, level, shiny, ball,
        nature: nature ?? undefined,
        abilityNum: sp?.abilities[1] ? abilityNum : 0,
        gender: gendered && gender !== 'random' ? gender : undefined,
        ivs: maxIVs ? [31, 31, 31, 31, 31, 31] : undefined,
      }, session.trainer, session.playerNameBytes, session.settings);
      session.addMon(target, mon, register);
    }, `${speciesName(species)} added to ${where}`);
    if (ok) onCreated(target.area === 'party' ? { area: 'party', index: session.party().length - 1 } : target);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal aria-label="Create Pokémon">
        <h2>New Pokémon</h2>
        <p className="muted small">Goes to {where}. You are the Original Trainer; it starts with the moves it would know at this level. Met location: “fateful encounter”.</p>
        <div className="create-grid">
          <div className="create-preview">{species !== null ? <MonFront species={species} shiny={shiny} scale={2} /> : <div className="sprite-placeholder" />}</div>
          <div className="form">
            <label>Species</label>
            <Combobox ariaLabel="Species" options={speciesOptions} value={species} placeholder="Search Pokémon…" autoFocus onChange={(v) => { setSpeciesId(v); setAbilityNum(0); }} />
            <label>Level</label>
            <NumberInput value={level} min={1} max={100} ariaLabel="Level" width={64} onCommit={setLevel} />
            <label>Nature</label>
            <Combobox ariaLabel="Nature" options={[{ value: -1, label: 'Random' }, ...natureOptions]} value={nature ?? -1} onChange={(v) => setNature(v < 0 ? null : v)} />
            <label>Ability</label>
            <div className="seg">
              {[0, 1].map((n) => (
                <button key={n} className={abilityNum === n ? 'active' : ''} disabled={!sp || (n === 1 && !sp.abilities[1])} onClick={() => setAbilityNum(n as 0 | 1)}>
                  {sp ? (n === 1 && !sp.abilities[1] ? '—' : abilityName(abilityOf(sp.id, n, session.settings))) : `Slot ${n + 1}`}
                </button>
              ))}
            </div>
            <label>Gender</label>
            <div className="seg">
              {(['random', 'male', 'female'] as const).map((g) => (
                <button key={g} className={gender === g ? 'active' : ''} disabled={!gendered && g !== 'random'} onClick={() => setGender(g)}>
                  {g === 'random' ? (gendered || !sp ? 'Random' : 'Fixed') : g === 'male' ? '♂ Male' : '♀ Female'}
                </button>
              ))}
            </div>
            <label>Poké Ball</label>
            <Combobox ariaLabel="Poké Ball" options={ballOptions} value={ball} onChange={setBall} />
            <label>Options</label>
            <div className="checks">
              <label><input type="checkbox" checked={shiny} onChange={(e) => setShiny(e.target.checked)} /> Shiny</label>
              <label><input type="checkbox" checked={maxIVs} onChange={(e) => setMaxIVs(e.target.checked)} /> Perfect IVs</label>
              <label><input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} /> Register as caught in the Pokédex</label>
            </div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={species === null} onClick={create}>Create</button>
        </div>
      </div>
    </div>
  );
}
