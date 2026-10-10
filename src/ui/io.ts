// File access. Two modes:
//  - Folder mode (Chrome/Edge, File System Access API): pick the folder with your saves. Saving writes a
//    timestamped backup into "<folder>/backups/" first, refuses if the file changed on disk since it was opened
//    (e.g. the game saved meanwhile), writes, then reads the file back to confirm.
//  - File mode (any browser): open a .sav, download the edited file.
import { bytesEqual } from '../core/binary.ts';
import { formatTimestamp } from './format.ts';

export interface OpenedSave {
  name: string;
  bytes: Uint8Array;
  /** Present in folder mode. */
  handle?: FileSystemFileHandle;
  dir?: FileSystemDirectoryHandle;
}

type DirPicker = (opts?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<FileSystemDirectoryHandle>;

export const supportsFolderMode = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  return (window as unknown as { showDirectoryPicker: DirPicker }).showDirectoryPicker({ mode: 'readwrite', id: 'hns-saves' });
}

export async function listSaves(dir: FileSystemDirectoryHandle): Promise<{ name: string; handle: FileSystemFileHandle; size: number; modified: number }[]> {
  const out: { name: string; handle: FileSystemFileHandle; size: number; modified: number }[] = [];
  for await (const [name, handle] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.sav')) continue;
    const file = await (handle as FileSystemFileHandle).getFile();
    out.push({ name, handle: handle as FileSystemFileHandle, size: file.size, modified: file.lastModified });
  }
  return out.sort((a, b) => b.modified - a.modified);
}

export async function readHandle(handle: FileSystemFileHandle): Promise<Uint8Array> {
  return new Uint8Array(await (await handle.getFile()).arrayBuffer());
}

export async function readFile(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

export interface SaveOutcome {
  backupName: string;
}

/** Folder mode save with backup and read-back. `original` = bytes as they were when opened. */
export async function saveInFolder(opened: OpenedSave, original: Uint8Array, next: Uint8Array): Promise<SaveOutcome> {
  if (!opened.handle || !opened.dir) throw new Error('Not opened from a folder');
  const onDisk = await readHandle(opened.handle);
  if (!bytesEqual(onDisk, original)) {
    throw new Error('The save file changed on disk since you opened it (did the game save?). Nothing was written — reopen the file to edit the latest version.');
  }
  const backups = await opened.dir.getDirectoryHandle('backups', { create: true });
  const base = opened.name.replace(/\.sav$/i, '');
  const backupName = `${base} ${formatTimestamp()}.sav`;
  const backup = await backups.getFileHandle(backupName, { create: true });
  await writeAll(backup, onDisk);
  if (!bytesEqual(await readHandle(backup), onDisk)) throw new Error('Backup could not be verified. Nothing was written.');

  await writeAll(opened.handle, next);
  const readBack = await readHandle(opened.handle);
  if (!bytesEqual(readBack, next)) {
    // Try to restore the original before reporting.
    await writeAll(opened.handle, onDisk);
    throw new Error(`Writing failed verification; the original was restored. A backup is in backups/${backupName}.`);
  }
  return { backupName };
}

async function writeAll(handle: FileSystemFileHandle, bytes: Uint8Array) {
  const w = await (handle as unknown as { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
  await w.write(bytes as unknown as BufferSource);
  await w.close();
}

export function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
