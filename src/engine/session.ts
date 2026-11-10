import path from 'node:path';
import fs from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { PoBLuaApiClient } from '../pobLuaBridge.js';
import { resolvePoBLayout } from '../utils/pobLayout.js';
import { feedbackFields, statChanges } from './feedback.js';

async function observation(client: PoBLuaApiClient) {
  return { stats: await client.getStats(feedbackFields), config: await client.getConfig(),
    build: await client.getBuildInfo(), items: await client.getItems(), skills: await client.getSkills(),
    context: await client.edit('get_context') };
}

function withFeedback(result: unknown, before: Awaited<ReturnType<typeof observation>> | null, after: Awaited<ReturnType<typeof observation>>) {
  const operation = result !== null && typeof result === 'object' && !Array.isArray(result)
    ? result : { value: result };
  return { ...operation, feedback: {
    source: 'PathOfBuilding', before, after,
    changes: statChanges(before?.stats ?? null, after.stats),
    configChanged: before === null ? null : !isDeepStrictEqual(before.config, after.config),
    contextChanged: before === null ? null : !isDeepStrictEqual(before.context, after.context),
    interpretation: 'Before and after are native PoB outputs. Delta and percent are arithmetic comparisons only; they do not establish uptime or gameplay viability.',
  } };
}

export class EngineMutationError extends Error {
  constructor(error: unknown, readonly feedback: unknown) {
    super(`Mutation failed; inspect feedback for partial changes. ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Serializes complete operations so build edits and their observations stay together. */
export class EngineSession {
  readonly enginePath;
  private client?: PoBLuaApiClient;
  private loaded = false;
  private queue = Promise.resolve();

  constructor(private readonly root: string) {
    this.enginePath = resolvePoBLayout(process.env.POB_PATH).src;
  }

  run<T>(operation: (client: PoBLuaApiClient) => Promise<T>, requiresBuild = true): Promise<T> {
    const result = this.queue.then(async () => {
      if (!this.client?.isAlive()) {
        this.loaded = false;
        await this.client?.stop();
        try { await fs.access(path.join(this.enginePath, 'HeadlessWrapper.lua')); }
        catch { throw new Error(`PoB source not found at ${this.enginePath}. Set POB_PATH to its src directory.`); }
        const adapter = path.join(this.root, 'lua', 'vanilla_stdio_bridge.lua');
        const useNativeWindowsRuntime = process.platform === 'win32' && !process.env.POB_CMD;
        this.client = new PoBLuaApiClient({
          cwd: this.enginePath,
          cmd: useNativeWindowsRuntime ? (process.env.POB_PYTHON || 'python') : process.env.POB_CMD,
          args: useNativeWindowsRuntime
            ? [path.join(this.root, 'scripts', 'windows-lua.py'), path.resolve(this.enginePath, '..', 'runtime'), adapter]
            : [adapter],
          env: { POB_API_STDIO: '0' },
        });
        await this.client.start();
      }
      if (requiresBuild && !this.loaded) {
        throw new Error('No build loaded. Load XML or an import code. A crashed engine loses its in-memory build.');
      }
      return operation(this.client);
    });
    this.queue = result.then(() => {}, () => {});
    return result;
  }

  load(operation: (client: PoBLuaApiClient) => Promise<unknown>) {
    return this.run(async client => {
      const before = this.loaded ? await observation(client) : null;
      this.loaded = false;
      await operation(client);
      this.loaded = true;
      return withFeedback({ loaded: true, build: await client.getBuildInfo() }, before, await observation(client));
    }, false);
  }

  mutate(operation: (client: PoBLuaApiClient) => Promise<unknown>) {
    return this.run(async client => {
      const before = await observation(client);
      try {
        const result = await operation(client);
        return withFeedback(result, before, await observation(client));
      } catch (error) {
        let after;
        try { after = await observation(client); } catch { this.loaded = false; }
        const feedback = after ? withFeedback({}, before, after).feedback
          : { before, after: null, reloadRequired: true };
        throw new EngineMutationError(error, feedback);
      }
    });
  }

  async close() {
    await this.queue;
    await this.client?.stop();
    this.client = undefined;
    this.loaded = false;
  }
}
