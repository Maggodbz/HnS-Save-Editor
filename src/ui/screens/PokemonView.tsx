import { useEffect, useState } from 'react';
import type { MonAt, SaveSession } from '../../core/save/session.ts';
import { BOX_COUNT, BOX_SLOTS, PARTY_MAX, type SlotRef, slotKey } from '../../core/pokemon/storage.ts';
import { nickname } from '../../core/pokemon/edit.ts';
import { isShiny, levelFromExp } from '../../core/pokemon/rules.ts';
import { useSessionVersion } from '../App.tsx';
import { MonIcon } from '../components/Sprite.tsx';
import { useGuard } from '../components/Toasts.tsx';
import { speciesName } from '../format.ts';
import { CreateMonDialog } from './CreateMonDialog.tsx';
import { MonEditor } from './MonEditor.tsx';

const DRAG_TYPE = 'application/x-hns-slot';

export function PokemonView({ session }: { session: SaveSession }) {
  useSessionVersion(session);
  const guard = useGuard();
  const [box, setBox] = useState(0);
  const [selected, setSelected] = useState<SlotRef | null>({ area: 'party', index: 0 });
  const [creating, setCreating] = useState<SlotRef | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  const party = session.party();
  const boxMons = session.box(box);
  const names = session.boxNames();
  const current = selected ? session.mon(selected) : null;

  // Keep the selection valid after moves/releases/undo.
  useEffect(() => {
    if (selected && !session.mon(selected)) setSelected(null);
  }, [session.version, selected, session]);

  const onDrop = (to: SlotRef, e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const raw = e.dataTransfer.getData(DRAG_TYPE);
    if (!raw) return;
    const from = JSON.parse(raw) as SlotRef;
    if (guard(() => session.moveMon(from, to))) {
      // Follow the moved Pokémon.
      const landed = to.area === 'party' && !session.mon(to) ? { area: 'party' as const, index: session.party().length - 1 } : to;
      setSelected(landed);
    }
  };

  const slotProps = (ref: SlotRef, mon: MonAt | null) => ({
    draggable: !!mon && !session.readOnlyReason,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ref)); e.dataTransfer.effectAllowed = 'move'; },
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDragOver(slotKey(ref)); } },
    onDragLeave: () => setDragOver((k) => (k === slotKey(ref) ? null : k)),
    onDrop: (e: React.DragEvent) => onDrop(ref, e),
    onClick: () => (mon ? setSelected(ref) : !session.readOnlyReason && setCreating(ref)),
    className: `slot ${mon ? 'filled' : 'empty'} ${selected && slotKey(selected) === slotKey(ref) ? 'selected' : ''} ${dragOver === slotKey(ref) ? 'drop' : ''}`,
  });

  return (
    <div className="pokemon">
      <div className="pokemon-left">
        <section className="card party">
          <div className="section-head">
            <h3>Party</h3>
            <button className="small ghost" onClick={() => guard(() => session.healParty(), 'Party healed')} disabled={!!session.readOnlyReason}>Heal all</button>
          </div>
          <div className="party-list">
            {Array.from({ length: PARTY_MAX }, (_, i) => {
              const ref: SlotRef = { area: 'party', index: i };
              const mon = party[i] ?? null;
              const isNextEmpty = !mon && i === party.length;
              if (!mon && !isNextEmpty) return <div key={i} className="slot party-slot placeholder" />;
              return (
                <button key={i} {...slotProps(ref, mon)} className={`${slotProps(ref, mon).className} party-slot`}>
                  {mon ? <PartyCard mon={mon} session={session} /> : <span className="add-hint">+ Add Pokémon</span>}
                </button>
              );
            })}
          </div>
        </section>

        <section className="card boxes">
          <div className="box-head">
            <button className="icon ghost" onClick={() => setBox((b) => (b + BOX_COUNT - 1) % BOX_COUNT)} aria-label="Previous box">‹</button>
            <select value={box} onChange={(e) => setBox(Number(e.target.value))} aria-label="Box">
              {names.map((n, i) => (
                <option key={i} value={i}>{n} ({session.box(i).filter(Boolean).length}/{BOX_SLOTS})</option>
              ))}
            </select>
            <button className="icon ghost" onClick={() => setBox((b) => (b + 1) % BOX_COUNT)} aria-label="Next box">›</button>
          </div>
          <div className="box-grid">
            {boxMons.map((mon, i) => {
              const ref: SlotRef = { area: 'box', box, index: i };
              return (
                <button key={i} {...slotProps(ref, mon)} title={mon ? `${nickname(mon.box)} (${speciesName(mon.box.species)}) Lv ${levelFromExp(mon.box.species, mon.box.sub0.get('experience'))}` : 'Empty — click to create'}>
                  {mon && <MonIcon species={mon.box.species} egg={mon.box.isEgg} />}
                  {mon && isShiny(mon.box.otId, mon.box.personality, session.settings) && <span className="shiny-dot" aria-label="shiny">★</span>}
                </button>
              );
            })}
          </div>
          <p className="muted small">Drag Pokémon to move or swap them. Click an empty slot to create one.</p>
        </section>
      </div>

      <div className="pokemon-right">
        {current ? (
          <MonEditor key={slotKey(current.ref)} session={session} slot={current.ref} onReleased={() => setSelected(null)} />
        ) : (
          <div className="card empty-editor">
            <p className="muted">Select a Pokémon to edit it, or click an empty slot to create one.</p>
          </div>
        )}
      </div>

      {creating && (
        <CreateMonDialog
          session={session}
          target={creating}
          onClose={() => setCreating(null)}
          onCreated={(ref) => { setCreating(null); setSelected(ref); }}
        />
      )}
    </div>
  );
}

function PartyCard({ mon, session }: { mon: MonAt; session: SaveSession }) {
  const p = mon.party!;
  const hpPct = p.maxHP ? (p.hp / p.maxHP) * 100 : 0;
  const shiny = isShiny(mon.box.otId, mon.box.personality, session.settings);
  return (
    <>
      <MonIcon species={mon.box.species} egg={mon.box.isEgg} />
      <div className="party-text">
        <div className="party-name">{nickname(mon.box)}{shiny && <span className="shiny" title="Shiny"> ★</span>}</div>
        <div className="muted small">{speciesName(mon.box.species)} · Lv {p.level}</div>
        <div className="hpbar" aria-label={`HP ${p.hp}/${p.maxHP}`}>
          <span style={{ width: `${hpPct}%` }} className={hpPct > 50 ? 'good' : hpPct > 20 ? 'warn' : 'bad'} />
        </div>
      </div>
      <span className="muted small hp-text">{p.hp}/{p.maxHP}</span>
    </>
  );
}
