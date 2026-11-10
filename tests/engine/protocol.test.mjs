import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createEngineServer } from '../../build/engine/server.js';
import { EngineSession } from '../../build/engine/session.js';
import { readSource, searchSources } from '../../build/engine/sources.js';
import { statChanges } from '../../build/engine/feedback.js';

const fakeEngine = () => ({
  isAlive: () => true, stop: async () => {},
  getStats: async () => ({ Life: 100, TotalDPS: 10 }), getConfig: async () => ({}),
  getBuildInfo: async () => ({}), getItems: async () => [], getSkills: async () => ({ groups: [] }),
  edit: async () => ({}),
});

test('feedback compares native values without substituting missing values or dividing by zero', () => {
  const result = statChanges({ TotalDPS: 100, TotalEHP: 0, Life: 1 }, { TotalDPS: 125, TotalEHP: 300, Life: 1 });
  assert.deepEqual(result.TotalDPS, { before: 100, after: 125, delta: 25, percent: 25 });
  assert.deepEqual(result.TotalEHP, { before: 0, after: 300, delta: 300, percent: null });
  assert.equal(result.Life.delta, 0);
  assert.equal(result.PhysicalMaximumHitTaken.delta, null);
  assert.equal(statChanges(null, { TotalDPS: 50 }).TotalDPS.delta, null);
});

test('MCP only exposes engine operations and preserves native output exactly', async () => {
  const native = { Life: 1, EnergyShield: 8300, TotalDPS: 0, ChaosResist: -17, Minion: { TotalDPS: 123.4567890123 } };
  const config = { enemyIsBoss: 'Pinnacle', conditionOnslaught: false };
  const fake = {
    enginePath: process.cwd(),
    run: async operation => operation({
      getStats: async () => native, getConfig: async () => config,
      getBuildInfo: async () => ({ name: 'CI fixture' }),
      getTree: async () => ({ nodes: [123] }), getSkills: async () => ({ groups: [] }), getItems: async () => [],
      edit: async () => ({}),
    }),
  };
  const { server } = await createEngineServer(process.cwd(), fake);
  const client = new Client({ name: 'contract-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const names = (await client.listTools()).tools.map(t => t.name);
    assert.ok(names.includes('pob_get_stats'));
    assert.ok(names.every(n => n.startsWith('pob_')));
    for (const forbidden of ['suggest_support_gems', 'find_optimal_links', 'analyze_defenses', 'optimize_tree', 'check_boss_readiness']) {
      assert.ok(!names.includes(forbidden));
      assert.equal((await client.callTool({ name: forbidden, arguments: {} })).isError, true);
    }
    const result = await client.callTool({ name: 'pob_get_stats', arguments: { fields: ['Life', 'TotalDPS', 'Unavailable'] } });
    assert.deepEqual(result.structuredContent.result.stats, native);
    assert.deepEqual(result.structuredContent.result.config, config);
    assert.deepEqual(result.structuredContent.result.missingFields, ['Unavailable']);
    const invalid = await client.callTool({ name: 'pob_set_config', arguments: { values: { conditionOnslaught: true } } });
    assert.equal(invalid.isError, true);
    const guide = await client.readResource({ uri: 'pob://assistant-guide' });
    assert.match(guide.contents[0].text, /sole numerical authority/);
  } finally { await client.close(); await server.close(); }
});

test('the session queues whole operations and continues after a failed one', async () => {
  const session = new EngineSession(process.cwd());
  session.loaded = true;
  session.client = fakeEngine();
  const order = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const first = session.run(async () => { order.push('first-start'); await pending; order.push('first-end'); });
  const failure = session.run(async () => { order.push('failure'); throw new Error('engine error'); });
  const failed = assert.rejects(failure, /engine error/);
  const last = session.run(async () => { order.push('last'); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['first-start']);
  release();
  await Promise.all([first, failed, last]);
  assert.deepEqual(order, ['first-start', 'first-end', 'failure', 'last']);
  await session.close();
});

test('a failed load prevents stale build observations', async () => {
  const session = new EngineSession(process.cwd());
  session.loaded = true;
  session.client = fakeEngine();
  await assert.rejects(session.load(async () => { throw new Error('invalid build'); }), /invalid build/);
  await assert.rejects(session.run(async () => 'stale stats'), /No build loaded/);
  await session.close();
});

test('a failed native edit reports partial changes instead of hiding them', async () => {
  const session = new EngineSession(process.cwd());
  session.loaded = true;
  session.client = fakeEngine();
  await assert.rejects(session.mutate(async client => {
    client.getStats = async () => ({ Life: 200, TotalDPS: 10 });
    throw new Error('native failure after edit');
  }), error => {
    assert.equal(error.feedback.changes.Life.delta, 100);
    return /native failure after edit/.test(error.message);
  });
  await session.close();
});

test('source research returns exact UTF-8 lines from the selected local engine', async () => {
  const root = await fs.mkdtemp(path.join(process.cwd(), '.engine-test-'));
  try {
    await fs.mkdir(path.join(root, 'Data'));
    await fs.writeFile(path.join(root, 'Data', 'Skills.lua'), '-- Механика\nFireball\nvalue = 0\n');
    const result = await searchSources(root, 'fireball', 5);
    assert.equal(result.matches[0].line, 2);
    assert.match(result.matches[0].excerpt, /Механика/);
    const source = await readSource(root, 'Data/Skills.lua', 2, 1);
    assert.equal(source.text, 'Fireball');
    await assert.rejects(readSource(root, 'Data/../../secret.lua', 1, 10));
  } finally {
    assert.equal(path.dirname(path.resolve(root)), process.cwd());
    await fs.rm(root, { recursive: true, force: true });
  }
});
