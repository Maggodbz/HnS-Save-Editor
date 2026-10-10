import { useMemo, useState } from 'react';
import { game } from '../../core/gamedata/index.ts';
import { constant } from '../../core/layout/index.ts';
import { type ItemStack, itemsForPocket, maxQuantityFor, pocketCapacity, pocketDef, POCKETS, type PocketId } from '../../core/save/bag.ts';
import type { SaveSession } from '../../core/save/session.ts';
import { useSessionVersion } from '../App.tsx';
import { Combobox } from '../components/Combobox.tsx';
import { NumberInput } from '../components/NumberInput.tsx';
import { ItemIcon } from '../components/Sprite.tsx';
import { useGuard } from '../components/Toasts.tsx';
import { itemName, moveName } from '../format.ts';
import { itemOptionsFor } from '../options.ts';

export function BagView({ session }: { session: SaveSession }) {
  useSessionVersion(session);
  const guard = useGuard();
  const [pocketId, setPocketId] = useState<PocketId>('items');
  const def = pocketDef(pocketId);
  const stacks = session.pocket(pocketId);
  const capacity = pocketCapacity(def);
  const candidates = useMemo(() => itemsForPocket(def), [def]);
  const addable = useMemo(
    () => itemOptionsFor(candidates.filter((it) => !stacks.some((s) => s.itemId === it.id))),
    [candidates, stacks],
  );

  const write = (next: ItemStack[], msg?: string) => guard(() => session.setPocket(pocketId, next), msg);
  const maxFor = (id: number) => maxQuantityFor(game.items[id]!, def, session.settings);
  const setQty = (id: number, q: number) => write(stacks.map((s) => (s.itemId === id ? { ...s, quantity: q } : s)));
  const remove = (id: number) => write(stacks.filter((s) => s.itemId !== id));
  const add = (id: number) => write([...stacks, { itemId: id, quantity: 1 }]);

  // TM/HM quick actions; numbered order like the game's bag.
  const tmRange = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
  const addMany = (ids: number[], label: string) => {
    const missing = ids.filter((id) => !stacks.some((s) => s.itemId === id));
    if (!missing.length) return guard(() => { throw new Error(`You already have all ${label}`); });
    const next = [...stacks, ...missing.map((id) => ({ itemId: id, quantity: 1 }))].sort((a, b) => a.itemId - b.itemId);
    write(next, `Added ${missing.length} ${label}`);
  };
  const sortByNumber = () => write([...stacks].sort((a, b) => a.itemId - b.itemId), 'Sorted');
  const maxAll = () => write(stacks.map((s) => ({ ...s, quantity: maxFor(s.itemId) })), 'All quantities set to max');

  return (
    <div className="bag">
      <aside className="pocket-nav">
        {POCKETS.map((p) => (
          <button key={p.id} className={p.id === pocketId ? 'active' : ''} onClick={() => setPocketId(p.id)}>
            <span>{p.label}</span>
            <span className="count">{session.pocket(p.id).length}</span>
          </button>
        ))}
      </aside>

      <section className="card pocket">
        <div className="pocket-head">
          <h2>{def.label}</h2>
          <span className="muted">{stacks.length} / {capacity} slots</span>
          <div className="spacer" />
          {pocketId === 'tmhm' && (
            <>
              <button onClick={() => addMany(tmRange(constant('ITEM_TM01'), constant('NUM_TECHNICAL_MACHINES')), 'TMs')}>Add all TMs</button>
              <button onClick={() => addMany(tmRange(constant('ITEM_HM01'), constant('NUM_HIDDEN_MACHINES')), 'HMs')}>Add all HMs</button>
            </>
          )}
          {stacks.length > 1 && <button className="ghost" onClick={sortByNumber}>Sort</button>}
          {stacks.some((s) => s.quantity < maxFor(s.itemId)) && <button className="ghost" onClick={maxAll}>Max all</button>}
        </div>

        <div className="add-row">
          <Combobox
            key={stacks.length}
            ariaLabel="Add item"
            options={addable}
            value={null}
            placeholder={stacks.length >= capacity ? 'Pocket is full' : `Add an item to ${def.label}…`}
            disabled={stacks.length >= capacity || session.readOnlyReason !== null}
            onChange={(id) => add(id)}
          />
        </div>

        {stacks.length === 0 ? (
          <p className="empty">This pocket is empty.</p>
        ) : (
          <ul className="item-list">
            {stacks.map((s) => {
              const it = game.items[s.itemId];
              const max = maxFor(s.itemId);
              return (
                <li key={s.itemId} className="item-row">
                  <ItemIcon item={s.itemId} />
                  <div className="item-text">
                    <div className="item-name">
                      {itemName(s.itemId)}
                      {it?.tmMove !== undefined && <span className="muted"> · {moveName(it.tmMove)}</span>}
                    </div>
                    <div className="muted small item-desc">{it?.description}</div>
                  </div>
                  {max === 1 ? (
                    <span className="muted small qty-fixed" title="This item always has quantity 1">×1</span>
                  ) : (
                    <div className="qty">
                      <span className="muted">×</span>
                      <NumberInput value={s.quantity} min={1} max={max} ariaLabel={`${itemName(s.itemId)} quantity`} width={64} onCommit={(q) => setQty(s.itemId, q)} />
                      <button className="small ghost" onClick={() => setQty(s.itemId, max)} disabled={s.quantity === max}>Max</button>
                    </div>
                  )}
                  <button className="icon ghost danger" onClick={() => remove(s.itemId)} aria-label={`Remove ${itemName(s.itemId)}`} title="Remove">✕</button>
                </li>
              );
            })}
          </ul>
        )}
        {pocketId === 'keyItems' && <p className="muted small">Removing story key items can block progress in the game. Change these only if you know what you are doing.</p>}
      </section>
    </div>
  );
}
