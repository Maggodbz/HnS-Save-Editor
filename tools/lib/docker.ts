// Runs shell commands inside the hack's ARM build container.
// The hack source is mounted at /src (working dir) and the editor's .cache folder at /cache.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { CACHE_DIR, DOCKER_CONTEXT, DOCKER_IMAGE, HACK_ROOT } from './config.ts';

export function runInToolchain(script: string): string {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const args = [
    '--context', DOCKER_CONTEXT, 'run', '--rm',
    '-v', `${HACK_ROOT}:/src`, '-v', `${CACHE_DIR}:/cache`, '-w', '/src',
    DOCKER_IMAGE, 'sh', '-c', `export PATH=/opt/devkitpro/devkitARM/bin:$PATH; set -e; ${script}`,
  ];
  const result = spawnSync('docker', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Toolchain command failed (exit ${result.status}):\n${result.stderr}\n${result.stdout}`);
  }
  return result.stdout;
}
