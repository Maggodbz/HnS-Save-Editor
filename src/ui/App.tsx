import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { SaveSession } from '../core/save/session.ts';
import { ToastProvider, useToast } from './components/Toasts.tsx';
import type { OpenedSave } from './io.ts';
import { BagView } from './screens/BagView.tsx';
import { PokemonView } from './screens/PokemonView.tsx';
import { ReviewDialog } from './screens/ReviewDialog.tsx';
import { StartScreen } from './screens/StartScreen.tsx';
import { TrainerView } from './screens/TrainerView.tsx';

type Tab = 'pokemon' | 'bag' | 'trainer';

export interface Loaded {
  session: SaveSession;
  opened: OpenedSave;
  /** Bytes of the file as opened (baseline for "changed on disk" detection and backups). */
  original: Uint8Array;
}

export function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}

/** Re-render when the session changes. */
export function useSessionVersion(session: SaveSession): number {
  return useSyncExternalStore(useCallback((cb) => session.subscribe(cb), [session]), () => session.version);
}

function Shell() {
  const [loaded, setLoadedState] = useState<Loaded | null>(null);
  // Bumped on every (re)load so the editor remounts with fresh state after opening or saving.
  const [loadId, setLoadId] = useState(0);
  const setLoaded = (l: Loaded | null) => { setLoadedState(l); setLoadId((n) => n + 1); };
  const toast = useToast();

  const open = (opened: OpenedSave) => {
    try {
      const session = SaveSession.open(opened.bytes, opened.name);
      setLoaded({ session, opened, original: opened.bytes });
      if (session.readOnlyReason) toast('error', `Opened read-only: ${session.readOnlyReason}`);
    } catch (e) {
      toast('error', e instanceof Error ? e.message : String(e));
    }
  };

  if (!loaded) return <StartScreen onOpen={open} />;
  return <Editor key={loadId} loaded={loaded} onReplace={setLoaded} onClose={() => setLoaded(null)} />;
}

function Editor({ loaded, onReplace, onClose }: { loaded: Loaded; onReplace: (l: Loaded) => void; onClose: () => void }) {
  const { session } = loaded;
  useSessionVersion(session);
  const [tab, setTab] = useState<Tab>('pokemon');
  const [reviewing, setReviewing] = useState(false);
  const changeCount = session.isDirty ? session.changes().length : 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); session.undo(); }
      if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); session.redo(); }
      if (e.key.toLowerCase() === 's') { e.preventDefault(); if (session.isDirty) setReviewing(true); }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => { if (session.isDirty) e.preventDefault(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', beforeUnload); };
  }, [session]);

  const t = session.trainer;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden />
          <div>
            <div className="brand-title">Heart &amp; Soul Save Editor</div>
            <div className="brand-sub">{loaded.opened.name} · {t.name} · {t.playTime.hours}h {String(t.playTime.minutes).padStart(2, '0')}m{loaded.opened.handle ? ' · folder mode' : ''}</div>
          </div>
        </div>
        <nav className="tabs" role="tablist">
          {(['pokemon', 'bag', 'trainer'] as Tab[]).map((id) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              {{ pokemon: 'Pokémon', bag: 'Bag', trainer: 'Trainer' }[id]}
            </button>
          ))}
        </nav>
        <div className="actions">
          <button className="ghost" onClick={() => session.undo()} disabled={!session.canUndo} title="Undo (Ctrl+Z)">↶ Undo</button>
          <button className="ghost" onClick={() => session.redo()} disabled={!session.canRedo} title="Redo (Ctrl+Y)">↷ Redo</button>
          <button
            className="primary"
            onClick={() => setReviewing(true)}
            disabled={!session.isDirty || !!session.readOnlyReason}
            title="Review changes and save (Ctrl+S)"
          >
            {changeCount ? `Review & save (${changeCount})` : 'No changes'}
          </button>
          <button className="ghost" onClick={() => { if (!session.isDirty || confirm('Discard unsaved changes and close this file?')) onClose(); }} title="Close file">✕</button>
        </div>
      </header>

      {session.readOnlyReason && <div className="banner error">Read-only: {session.readOnlyReason}</div>}

      <main className="content">
        {tab === 'pokemon' && <PokemonView session={session} />}
        {tab === 'bag' && <BagView session={session} />}
        {tab === 'trainer' && <TrainerView session={session} />}
      </main>

      {reviewing && (
        <ReviewDialog
          loaded={loaded}
          onClose={() => setReviewing(false)}
          onSaved={(next) => { setReviewing(false); if (next) onReplace(next); }}
        />
      )}
    </div>
  );
}
