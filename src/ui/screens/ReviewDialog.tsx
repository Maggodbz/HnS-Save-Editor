import { useMemo, useState } from 'react';
import { SaveSession } from '../../core/save/session.ts';
import type { VerificationReport } from '../../core/save/verify.ts';
import type { Loaded } from '../App.tsx';
import { download, saveInFolder } from '../io.ts';

type Phase = { kind: 'review' } | { kind: 'saving' } | { kind: 'done'; report: VerificationReport; message: string; next: Loaded | null } | { kind: 'error'; message: string };

export function ReviewDialog({ loaded, onClose, onSaved }: { loaded: Loaded; onClose: () => void; onSaved: (next: Loaded | null) => void }) {
  const { session, opened } = loaded;
  const changes = useMemo(() => session.changes(), [session, session.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const validation = useMemo(() => session.validate(), [session, session.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [phase, setPhase] = useState<Phase>({ kind: 'review' });
  const [emulatorClosed, setEmulatorClosed] = useState(false);
  const folderMode = !!opened.handle;
  const groups = ['Trainer', 'Bag', 'Pokémon', 'Pokédex'] as const;

  const save = async () => {
    setPhase({ kind: 'saving' });
    try {
      const { bytes, report } = session.export();
      let message: string;
      if (folderMode) {
        const { backupName } = await saveInFolder(opened, loaded.original, bytes);
        message = `Saved to ${opened.name}. The previous version is in backups/${backupName}.`;
      } else {
        download(opened.name, bytes);
        message = `Downloaded the edited ${opened.name}. Replace your save with it (keep your old file as a backup).`;
      }
      // Continue editing from the saved file as the new baseline.
      const next: Loaded = { session: SaveSession.open(bytes, opened.name), opened: { ...opened, bytes }, original: bytes };
      setPhase({ kind: 'done', report, message, next });
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && phase.kind !== 'saving' && onClose()}>
      <div className="modal wide" role="dialog" aria-modal aria-label="Review and save">
        {phase.kind === 'review' && (
          <>
            <h2>Review changes</h2>
            <div className="changes">
              {groups.map((g) => {
                const items = changes.filter((c) => c.area === g);
                if (!items.length) return null;
                return (
                  <div key={g} className="change-group">
                    <h4>{g} <span className="muted">({items.length})</span></h4>
                    <ul>
                      {items.map((c, i) => <li key={i}><strong>{c.label}</strong> <span className="muted">—</span> {c.detail}</li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
            {validation.errors.length > 0 && (
              <div className="banner error">
                <strong>Fix these before saving:</strong>
                <ul>{validation.errors.map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            {validation.warnings.length > 0 && (
              <div className="banner warn">
                <strong>Heads-up (allowed, but unusual):</strong>
                <ul>{validation.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              </div>
            )}
            <label className="confirm-check">
              <input type="checkbox" checked={emulatorClosed} onChange={(e) => setEmulatorClosed(e.target.checked)} />
              The game is closed in mGBA (otherwise it may overwrite this save).
            </label>
            <div className="modal-actions">
              <button className="ghost" onClick={onClose}>Keep editing</button>
              <button className="primary" disabled={!emulatorClosed || validation.errors.length > 0} onClick={save}>
                {folderMode ? 'Back up & save' : 'Download edited save'}
              </button>
            </div>
          </>
        )}

        {phase.kind === 'saving' && <div className="saving"><span className="spinner" /> Writing and verifying…</div>}

        {phase.kind === 'done' && (
          <>
            <h2>Saved ✓</h2>
            <p>{phase.message}</p>
            <ul className="checks-list">
              {phase.report.checks.map((c) => (
                <li key={c.name} className={c.ok ? 'ok' : 'bad'}>
                  <span className="mark">{c.ok ? '✓' : '✗'}</span> <strong>{c.name}</strong> <span className="muted">— {c.detail}</span>
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button className="primary" onClick={() => onSaved(phase.next)}>Continue</button>
            </div>
          </>
        )}

        {phase.kind === 'error' && (
          <>
            <h2>Not saved</h2>
            <div className="banner error"><pre>{phase.message}</pre></div>
            <p className="muted">Your save file was not changed. Your edits are still here.</p>
            <div className="modal-actions">
              <button className="primary" onClick={() => setPhase({ kind: 'review' })}>Back</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
