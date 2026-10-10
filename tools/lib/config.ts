// Paths and settings shared by the data tools. Override with environment variables.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EDITOR_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Root of the Heart & Soul source tree (the pokeemerald-based decomp). Default: Repos/pokemonHnS next to Repos/private. */
export const HACK_ROOT = path.resolve(process.env.HNS_SOURCE ?? path.join(EDITOR_ROOT, '..', '..', 'pokemonHnS'));

/** ELF produced by building the hack; the source of all game data tables. */
export const HACK_ELF = path.resolve(process.env.HNS_ELF ?? path.join(HACK_ROOT, 'pokemonHnS.elf'));
export const HACK_ROM = path.resolve(process.env.HNS_ROM ?? path.join(HACK_ROOT, 'pokemonHnS.gba'));

/** Docker image + context that contain the devkitARM toolchain (see the hack's build.ps1). */
export const DOCKER_IMAGE = process.env.HNS_DOCKER_IMAGE ?? 'hns-build';
export const DOCKER_CONTEXT = process.env.HNS_DOCKER_CONTEXT ?? 'desktop-linux';

export const CACHE_DIR = path.join(EDITOR_ROOT, '.cache');
export const DATA_DIR = path.join(EDITOR_ROOT, 'src', 'data');
