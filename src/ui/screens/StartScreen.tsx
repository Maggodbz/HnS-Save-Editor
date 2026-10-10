import { useState } from 'react';
import { useToast } from '../components/Toasts.tsx';
import { listSaves, type OpenedSave, pickFolder, readFile, readHandle, supportsFolderMode } from '../io.ts';

type SaveEntry = Awaited<ReturnType<typeof listSaves>>[number];

export function StartScreen({ onOpen }: { onOpen: (o: OpenedSave) => void }) {
  const toast = useToast();
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [saves, setSaves] = useState<SaveEntry[]>([]);
  const [dragging, setDragging] = useState(false);

  const chooseFolder = async () => {
    try {
      const d = await pickFolder();
      const list = await listSaves(d);
      if (!list.length) toast('info', 'No .sav files in that folder.');
      setDir(d);
      setSaves(list);
    } catch (e) {
      if ((e as DOMException).name !== 'AbortError') toast('error', String(e));
    }
  };

  const openFile = async (file: File) => onOpen({ name: file.name, bytes: await readFile(file) });

  return (
    <div
      className={`start ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) void openFile(file);
      }}
    >
      <div className="start-card">
        <div className="start-hero">
          <span className="logo big" aria-hidden />
          <h1>Heart &amp; Soul Save Editor</h1>
          <p className="muted">For Pokémon Heart &amp; Soul v1.2.1. Edits only your <code>.sav</code> file — the ROM is never touched.</p>
        </div>

        <div className="start-actions">
          {supportsFolderMode && (
            <button className="primary big" onClick={chooseFolder}>
              Open save folder
              <span className="sub">Saves in place with an automatic backup</span>
            </button>
          )}
          <label className="button big">
            Open a .sav file
            <span className="sub">Download the edited file afterwards</span>
            <input type="file" accept=".sav" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); }} />
          </label>
        </div>

        {dir && (
          <div className="save-list">
            <h3>Saves in “{dir.name}”</h3>
            {saves.map((s) => (
              <button key={s.name} className="save-item" onClick={async () => onOpen({ name: s.name, bytes: await readHandle(s.handle), handle: s.handle, dir })}>
                <span className="save-name">{s.name}</span>
                <span className="muted">{new Date(s.modified).toLocaleString()} · {(s.size / 1024).toFixed(0)} KB</span>
              </button>
            ))}
          </div>
        )}

        <ul className="start-notes">
          <li><strong>Close the game in mGBA before saving.</strong> A running emulator writes its own copy and would overwrite your edit.</li>
          <li>Your original is backed up before every save (in <code>backups/</code> next to the save in folder mode).</li>
          <li>Everything runs locally in your browser. Nothing is uploaded.</li>
        </ul>
        <p className="muted small">Tip: you can also drop a .sav file anywhere on this page.</p>
      </div>
    </div>
  );
}
