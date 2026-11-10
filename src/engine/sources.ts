import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const sourceRoots = ['Data', 'Modules', 'Classes', 'TreeData', 'GameVersions.lua'];

/** Reports local engine identity without inferring a game patch from a tree identifier. */
export async function engineIdentity(enginePath: string) {
  const git = async (...args: string[]) => {
    try {
      return (await execFileAsync('git', ['-C', enginePath, ...args], { windowsHide: true })).stdout.trim();
    } catch { return null; }
  };
  return {
    enginePath, commit: await git('rev-parse', 'HEAD'),
    workingTreeStatus: await git('status', '--porcelain', '--untracked-files=no'),
    gamePatch: null,
    gamePatchNote: 'Read the matching PoB data and patch notes; a tree version is not a verified game patch.',
  };
}

async function* sourceFiles(root: string): AsyncGenerator<string> {
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(file);
    else if (entry.isFile() && entry.name.endsWith('.lua')) yield file;
  }
}

/** Literal searches return version-local source excerpts, never generated mechanics. */
export async function searchSources(enginePath: string, query: string, limit: number) {
  const matches = [];
  const needle = query.toLowerCase();
  for (const relative of sourceRoots) {
    const root = path.join(enginePath, relative);
    const files = relative.endsWith('.lua') ? [root] : sourceFiles(root);
    for await (const file of files) {
      let text;
      try { text = await fs.readFile(file, 'utf8'); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].toLowerCase().includes(needle)) continue;
        matches.push({ path: path.relative(enginePath, file).replaceAll('\\', '/'), line: i + 1,
          excerpt: lines.slice(Math.max(0, i - 2), i + 3).join('\n') });
        if (matches.length === limit) return { matches, limitReached: true };
      }
    }
  }
  return { matches, limitReached: false };
}

export async function readSource(enginePath: string, relativePath: string, startLine: number, count: number) {
  const normalized = relativePath.replaceAll('\\', '/');
  if (!sourceRoots.some(root => normalized === root || normalized.startsWith(root + '/')) ||
      !normalized.endsWith('.lua') || normalized.split('/').includes('..')) {
    throw new Error('Read a .lua file under Data, Modules, Classes, TreeData, or GameVersions.lua.');
  }
  const engineReal = await fs.realpath(enginePath);
  const file = await fs.realpath(path.resolve(enginePath, normalized));
  const relative = path.relative(engineReal, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Source path leaves the engine directory.');
  const lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/);
  return { path: normalized, startLine, totalLines: lines.length, text: lines.slice(startLine - 1, startLine - 1 + count).join('\n') };
}
