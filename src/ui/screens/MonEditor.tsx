import { useMemo, useState } from 'react';
import { game } from '../../core/gamedata/index.ts';
import type { BoxMon } from '../../core/pokemon/boxmon.ts';
import {
  compactMoves, MAX_EV, MAX_TOTAL_EV, restorePP, setLevel, setMove, setNature, setNickname, setPPUps, setShiny,
  setSpecies,
} from '../../core/pokemon/edit.ts';
import { abilityOf, calculateStats, effectiveNature } from '../../core/pokemon/rules.ts';
import type { SlotRef } from '../../core/pokemon/storage.ts';
import { summarize } from '../../core/pokemon/summary.ts';
import type { SaveSession } from '../../core/save/session.ts';
import { useSessionVersion } from '../App.tsx';
import { Combobox, type Option } from '../components/Combobox.tsx';
import { NumberInput } from '../components/NumberInput.tsx';
import { MonFront } from '../components/Sprite.tsx';
import { useGuard } from '../components/Toasts.tsx';
import {
  abilityName, mapsecName, moveName, natureEffect, speciesName, STAT_LABELS, TYPE_COLORS, typeName,
} from '../format.ts';
import { ballOptions, heldItemOptions, moveOptions, natureOptions, speciesOptions } from '../options.ts';

/** Move options with this species' learnable moves first, marked with how they're learned. */
function learnableMoveOptions(species: number, modernMoves: boolean): Option[] {
  const learn = new Map<number, string>();
  for (const [lvl, move] of (modernMoves ? game.learnsets.modern : game.learnsets.original)[species] ?? []) {
    if (!learn.has(move)) learn.set(move, lvl <= 1 ? 'Start' : `Lv ${lvl}`);
  }
  for (const tm of game.tmhmLearnsets[species] ?? []) {
    const move = game.tmhmMoves[tm]!;
    if (!learn.has(move)) learn.set(move, tm < 50 ? `TM${String(tm + 1).padStart(2, '0')}` : `HM${String(tm - 49).padStart(2, '0')}`);
  }
  const mine = moveOptions.filter((o) => learn.has(o.value)).map((o) => ({ ...o, hint: `${learn.get(o.value)} · ${o.hint}` }));
  const rest = moveOptions.filter((o) => !learn.has(o.value));
  return [{ value: 0, label: '— (empty)' }, ...mine, ...rest];
}

export function MonEditor({ session, slot, onReleased }: { session: SaveSession; slot: SlotRef; onReleased: () => void }) {
  useSessionVersion(session);
  const guard = useGuard();
  const at = session.mon(slot);
  const settings = session.settings;
  const [nick, setNick] = useState<string | null>(null);
  const moveOpts = useMemo(() => (at ? learnableMoveOptions(at.box.species, settings.modernMoves) : []), [at?.box.species, settings.modernMoves]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!at) return null;
  const s = summarize(at.box, settings, at.party);
  const sp = game.species[s.species]!;
  const readOnly = !!session.readOnlyReason;
  const edit = (fn: (m: BoxMon) => void, opts?: { heal?: boolean }) => guard(() => session.updateMon(slot, fn, opts));
  // Live preview of stats for boxed Pokémon (party stats are stored and recalculated on every edit).
  const stats = at.party ? s.stats : calculateStats({ species: s.species, exp: s.exp, ivs: s.ivs, evs: s.evs, nature: effectiveNature(at.box) }, settings).stats;
  const evTotal = s.evs.reduce((a, b) => a + b, 0);
  const types = [...new Set(sp.types)].map(typeName);
  const natureInfo = game.natures[s.nature]!;

  if (s.isBadEgg) {
    return <div className="card editor"><h2>Bad Egg</h2><p className="muted">This slot holds corrupted data. The editor leaves it untouched.</p></div>;
  }

  return (
    <div className="card editor">
      <div className="editor-head">
        <div className="portrait">
          <MonFront species={s.species} shiny={s.shiny} scale={2} title={speciesName(s.species)} />
          <button
            className={`shiny-toggle ${s.shiny ? 'on' : ''}`}
            onClick={() => edit((m) => setShiny(m, !s.shiny, settings))}
            disabled={readOnly || s.isEgg}
            title={s.shiny ? 'Shiny — click to make normal' : 'Make shiny (keeps gender and nature)'}
          >★ {s.shiny ? 'Shiny' : 'Normal'}</button>
        </div>
        <div className="editor-title">
          <input
            className="nickname"
            aria-label="Nickname"
            value={nick ?? s.nickname}
            maxLength={10}
            disabled={readOnly}
            onChange={(e) => setNick(e.target.value)}
            onBlur={() => { if (nick !== null && nick !== s.nickname) edit((m) => setNickname(m, nick)); setNick(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setNick(null); (e.target as HTMLInputElement).blur(); } }}
          />
          <div className="title-row">
            <div className="species-pick">
              <Combobox ariaLabel="Species" options={speciesOptions} value={s.species} disabled={readOnly} onChange={(v) => edit((m) => setSpecies(m, v))} />
            </div>
            <span className={`gender ${s.gender}`} title={s.gender}>{s.gender === 'male' ? '♂' : s.gender === 'female' ? '♀' : '—'}</span>
          </div>
          <div className="types">
            {types.map((t) => <span key={t} className="type" style={{ background: TYPE_COLORS[t] }}>{t}</span>)}
          </div>
          <div className="muted small">
            OT {s.otId === session.trainer.otId ? session.trainer.name : `ID ${s.otId & 0xffff}`} · Met {mapsecName(s.metLocation)}{s.metLevel ? ` at Lv ${s.metLevel}` : ' (hatched)'}
          </div>
        </div>
        <div className="level-box">
          <label className="muted small">Level</label>
          <NumberInput value={s.level} min={1} max={100} ariaLabel="Level" width={64} disabled={readOnly} onCommit={(v) => edit((m) => setLevel(m, v))} />
          {at.party && settings.limitToLevel50 && <span className="muted small">shown as 50 (level-50 rule)</span>}
        </div>
      </div>

      <div className="editor-grid">
        <section>
          <h4>Details</h4>
          <div className="form">
            <label>Nature</label>
            <div>
              <Combobox ariaLabel="Nature" options={natureOptions} value={s.nature} disabled={readOnly} onChange={(v) => edit((m) => setNature(m, v))} />
              <div className="muted small">{natureEffect(s.nature)}{s.natureFromMint ? ' · via Mint (hidden nature)' : ''}</div>
            </div>

            <label>Ability</label>
            <div className="seg">
              {[0, 1].map((n) => {
                const id = abilityOf(s.species, n, settings);
                const exists = n === 0 || sp.abilities[1] !== 0;
                return (
                  <button key={n} className={s.abilityNum === n ? 'active' : ''} disabled={readOnly || !exists} onClick={() => edit((m) => m.sub3.set('abilityNum', n))}>
                    {exists ? abilityName(id) : '—'}
                  </button>
                );
              })}
            </div>
            {s.ability !== null && <div />}
            {s.ability !== null && <div className="muted small">{game.abilities[s.ability]?.description}</div>}

            <label>Held item</label>
            <Combobox ariaLabel="Held item" options={heldItemOptions} value={s.heldItem} disabled={readOnly} onChange={(v) => edit((m) => m.sub0.set('heldItem', v))} />

            <label>Poké Ball</label>
            <Combobox ariaLabel="Poké Ball" options={ballOptions} value={s.ball} disabled={readOnly} onChange={(v) => edit((m) => m.sub3.set('pokeball', v))} />

            <label>Friendship</label>
            <div className="inline">
              <NumberInput value={s.friendship} min={0} max={255} ariaLabel="Friendship" width={64} disabled={readOnly} onCommit={(v) => edit((m) => m.sub0.set('friendship', v))} />
              <button className="small ghost" disabled={readOnly || s.friendship === 255} onClick={() => edit((m) => m.sub0.set('friendship', 255))}>Max</button>
            </div>

            {at.party && (
              <>
                <label>HP</label>
                <div className="inline">
                  <NumberInput value={s.hp ?? 0} min={0} max={stats[0]!} ariaLabel="Current HP" width={64} disabled={readOnly}
                    onCommit={(v) => guard(() => session.updateMon(slot, (_m, p) => { if (p) p.hp = v; }))} />
                  <span className="muted">/ {stats[0]}</span>
                  {s.status ? <span className="chip warn">status</span> : null}
                  <button className="small ghost" disabled={readOnly} onClick={() => edit(() => {}, { heal: true })}>Heal</button>
                </div>
              </>
            )}
          </div>
        </section>

        <section>
          <div className="section-head">
            <h4>Moves</h4>
            <button className="small ghost" disabled={readOnly || s.pp.every((p, i) => p === s.maxPP[i])} onClick={() => edit((m) => restorePP(m))}>Restore PP</button>
          </div>
          <div className="moves">
            {[0, 1, 2, 3].map((i) => {
              const moveId = s.moves[i]!;
              const mv = game.moves[moveId];
              const t = mv ? typeName(mv.type) : '';
              return (
                <div key={i} className="move-row" style={{ borderLeftColor: moveId ? TYPE_COLORS[t] : 'transparent' }}>
                  <Combobox
                    ariaLabel={`Move ${i + 1}`}
                    options={moveOpts}
                    value={moveId}
                    disabled={readOnly}
                    onChange={(v) => edit((m) => { setMove(m, i, v); compactMoves(m); })}
                    renderValue={() => (
                      <span className="move-label">
                        <span className="combobox-label">{moveId ? moveName(moveId) : '— (empty)'}</span>
                        {mv && <span className="muted small">{t} · {['Phys', 'Spec', 'Status'][mv.category]}{mv.power > 1 ? ` ${mv.power}` : ''}</span>}
                      </span>
                    )}
                  />
                  <span className="pp" title="Current PP / max PP">{moveId ? `${s.pp[i]}/${s.maxPP[i]}` : ''}</span>
                  <select
                    aria-label={`PP Ups for move ${i + 1}`}
                    value={s.ppUps[i]}
                    disabled={readOnly || !moveId}
                    onChange={(e) => edit((m) => setPPUps(m, i, Number(e.target.value)))}
                    title="PP Ups used"
                  >
                    {[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n === 0 ? 'No PP Up' : `PP Up ×${n}`}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
        </section>

        <section className="stats-section">
          <div className="section-head">
            <h4>Stats</h4>
            <div className="inline">
              <button className="small ghost" disabled={readOnly || s.ivs.every((v) => v === 31)} onClick={() => edit((m) => [0, 1, 2, 3, 4, 5].forEach((i) => m.setIV(i, 31)))}>Max IVs</button>
              <button className="small ghost" disabled={readOnly || evTotal === 0} onClick={() => edit((m) => [0, 1, 2, 3, 4, 5].forEach((i) => m.setEV(i, 0)))}>Clear EVs</button>
            </div>
          </div>
          <table className="stats">
            <thead>
              <tr><th /><th>Base</th><th>IV</th><th>EV</th><th>Stat</th><th className="bar-col" /></tr>
            </thead>
            <tbody>
              {STAT_LABELS.map((label, i) => {
                const mod = i === 0 ? 0 : natureInfo.up === i ? 1 : natureInfo.down === i ? -1 : 0;
                return (
                  <tr key={label}>
                    <th className={mod > 0 ? 'up' : mod < 0 ? 'down' : ''}>{label}{mod > 0 ? ' ▲' : mod < 0 ? ' ▼' : ''}</th>
                    <td className="muted">{sp.baseStats[i]}</td>
                    <td><NumberInput value={s.ivs[i]!} min={0} max={31} ariaLabel={`${label} IV`} width={48} disabled={readOnly} onCommit={(v) => edit((m) => m.setIV(i, v))} /></td>
                    <td><NumberInput value={s.evs[i]!} min={0} max={255} ariaLabel={`${label} EV`} width={56} disabled={readOnly} onCommit={(v) => edit((m) => m.setEV(i, v))} /></td>
                    <td className="stat-value">{stats[i]}</td>
                    <td className="bar-col"><span className="statbar"><span style={{ width: `${Math.min(100, (stats[i]! / (i === 0 ? 400 : 300)) * 100)}%` }} /></span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={`muted small ${evTotal > MAX_TOTAL_EV || s.evs.some((e) => e > MAX_EV) ? 'warn-text' : ''}`}>
            EV total {evTotal} / {MAX_TOTAL_EV}{s.evs.some((e) => e > MAX_EV) ? ` · an EV is above ${MAX_EV}` : ''}
          </div>
        </section>
      </div>

      <div className="editor-foot">
        <span className="muted small">Changes apply immediately — use Undo (Ctrl+Z) to step back. Nothing is written until you save.</span>
        <button
          className="danger"
          disabled={readOnly}
          onClick={() => {
            if (confirm(`Release ${s.nickname}? (You can still undo this before saving.)`) && guard(() => session.releaseMon(slot))) onReleased();
          }}
        >Release</button>
      </div>
    </div>
  );
}
