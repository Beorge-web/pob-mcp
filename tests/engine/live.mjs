import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolvePoBLayout } from '../../build/utils/pobLayout.js';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const layout = resolvePoBLayout(process.env.POB_PATH);
const fixture = path.join(root, 'tests', 'engine', 'fireball.xml');
const oracleScript = path.join(root, 'tests', 'engine', 'oracle.lua');
const nativeWindows = process.platform === 'win32' && !process.env.POB_CMD;
const command = nativeWindows ? (process.env.POB_PYTHON || 'python') : (process.env.POB_CMD || 'luajit');
const args = nativeWindows
  ? [path.join(root, 'scripts', 'windows-lua.py'), path.resolve(layout.src, '..', 'runtime'), oracleScript, fixture]
  : [oracleScript, fixture];
const { stdout } = await execFileAsync(command, args, {
  cwd: layout.src, windowsHide: true, timeout: 60000,
  env: { ...process.env, LUA_PATH: layout.luaPath.join(';') + ';;', LUA_CPATH: layout.luaCPath.join(';') + ';;' },
});
const oracleLine = stdout.split(/\r?\n/).find(line => line.startsWith('POB_ORACLE '));
assert.ok(oracleLine, 'direct upstream calculation must return its output');
const oracle = JSON.parse(oracleLine.slice('POB_ORACLE '.length));
const client = new Client({ name: 'live-engine-check', version: '1' });
const transport = new StdioClientTransport({
  command: process.execPath, args: [path.join(root, 'build', 'index.js')], stderr: 'inherit',
  env: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
});
await client.connect(transport);
const call = async (name, args = {}) => {
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, JSON.stringify(response.content));
  return response.structuredContent.result;
};
try {
  const identity = await call('pob_engine_info');
  const load = await call('pob_load_build', { file: fixture, name: 'engine-fireball' });
  assert.equal(load.build.className, 'Witch');
  const initial = await call('pob_get_stats', { fields: [...Object.keys(oracle), 'UnavailableStat'] });
  assert.deepEqual(initial.stats, oracle, 'MCP must exactly match independent calls to upstream PoB');
  assert.deepEqual(initial.missingFields, ['UnavailableStat']);
  assert.ok(initial.stats.TotalDPS > 0, 'fixture must have a real calculated skill');
  assert.equal(initial.stats.EnergyShield, 0, 'zero values must survive the complete transport');
  const full = await call('pob_get_stats');
  assert.ok(Object.keys(full.stats).length > Object.keys(oracle).length);
  const baseline = (await call('pob_export_build')).xml;

  const add = await call('pob_add_gem', { groupIndex: 1, gemName: 'Added Lightning Damage', level: 20 });
  assert.ok(add);
  const supported = await call('pob_get_stats', { fields: ['TotalDPS'] });
  assert.ok(supported.stats.TotalDPS > initial.stats.TotalDPS, 'a native support change must change real damage');
  assert.equal(add.feedback.changes.TotalDPS.before, initial.stats.TotalDPS);
  assert.equal(add.feedback.changes.TotalDPS.after, supported.stats.TotalDPS);
  assert.equal(add.feedback.changes.TotalDPS.delta, supported.stats.TotalDPS - initial.stats.TotalDPS);
  await call('pob_load_build', { xml: baseline, name: 'restored' });
  const restored = await call('pob_get_stats', { fields: Object.keys(oracle) });
  assert.deepEqual(restored.stats, oracle, 'export/reload must restore the same calculated stats');

  const treeBefore = (await call('pob_get_build')).tree;
  const simulation = await call('pob_simulate_tree');
  assert.equal(simulation.output.Life, oracle.Life);
  assert.deepEqual((await call('pob_get_build')).tree, treeBefore, 'simulation must preserve the original tree');
  const known = await call('pob_set_config', { values: { enemyIsBoss: 'Pinnacle' }, justification: 'Live test scenario' });
  assert.equal(known.applied.enemyIsBoss, 'Pinnacle');
  const rejected = await call('pob_set_config', { values: { nonexistentMechanic: true }, justification: 'Verify rejection' });
  assert.ok(rejected.rejected.nonexistentMechanic);
  const changedConfig = await call('pob_get_stats', { fields: ['TotalDPS'] });
  assert.equal(changedConfig.config.enemyIsBoss, 'Pinnacle');
  const source = await call('pob_search_sources', { query: 'Fireball', limit: 3 });
  assert.ok(source.matches.length > 0);

  await call('pob_load_build', { xml: baseline });
  const gemEdit = await call('pob_edit_gem', { groupIndex: 1, gemIndex: 1, values: { level: 18, quality: 20 } });
  assert.equal(gemEdit.groups[0].gems[0].level, 18);
  assert.equal(gemEdit.groups[0].gems[0].quality, 20);
  assert.ok(gemEdit.feedback.changes.TotalDPS.delta !== null);
  const groupEdit = await call('pob_edit_skill_group', { groupIndex: 1, values: { label: 'Edited by MCP', includeInFullDPS: true, groupCount: 1 } });
  assert.equal(groupEdit.groups[0].label, 'Edited by MCP');
  const helmet = life => `Rarity: RARE\nMCP Test\nLeather Cap\n--------\n+${life} to maximum Life`;
  const item = await call('pob_add_item', { text: helmet(100), slot: 'Helmet' });
  assert.ok(item.id > 0);
  assert.ok(item.feedback.changes.Life.delta > 0);
  assert.ok(item.feedback.changes.PhysicalMaximumHitTaken.delta > 0);
  assert.ok(item.feedback.changes.TotalEHP.delta > 0);
  const replaced = await call('pob_edit_item', { action: 'replace', id: item.id, text: helmet(200) });
  assert.ok(replaced.inventory.some(i => i.id === item.id && i.raw.includes('+200')));
  assert.ok(replaced.feedback.changes.Life.delta > 0);
  const unequipped = await call('pob_edit_item', { action: 'unequip', slot: 'Helmet' });
  assert.ok(unequipped.feedback.changes.Life.delta < 0);
  await call('pob_edit_item', { action: 'equip', id: item.id, slot: 'Helmet' });
  await call('pob_edit_item', { action: 'delete', id: item.id });
  assert.equal((await call('pob_get_inventory')).length, 0);

  for (const kind of ['items', 'skills', 'config']) {
    const original = await call('pob_manage_sets', { kind, action: 'list' });
    const copied = await call('pob_manage_sets', { kind, action: 'create', copyFrom: original.activeId, title: 'MCP copy' });
    assert.equal(copied.sets.length, original.sets.length + 1);
    assert.notEqual(copied.activeId, original.activeId);
    await call('pob_manage_sets', { kind, action: 'rename', id: copied.activeId, title: 'Renamed' });
    await call('pob_manage_sets', { kind, action: 'select', id: original.activeId });
    await call('pob_manage_sets', { kind, action: 'delete', id: copied.activeId });
  }
  const specs = await call('pob_tree_specs', { action: 'list' });
  const copy = await call('pob_tree_specs', { action: 'create', copyFrom: specs.activeSpec, title: 'Copied tree' });
  assert.equal(copy.specs.length, specs.specs.length + 1);
  await call('pob_tree_specs', { action: 'delete', index: copy.activeSpec });
  const options = await call('pob_editing_options');
  assert.ok(options.classes.some(c => c.name === 'Witch'));
  assert.ok(options.configOptions.some(c => c.var === 'enemyLevel'));
  assert.ok(options.configOptions.find(c => c.var === 'enemyIsBoss').list.some(entry => entry.val === 'Pinnacle'));
  const enemyLevel = await call('pob_set_config', { values: { enemyLevel: 83 }, justification: 'Test native persisted enemy level' });
  assert.equal(enemyLevel.config.enemyLevel, 83);
  assert.equal(enemyLevel.feedback.configChanged, true);
  const custom = await call('pob_set_custom_modifiers', { groups: [{ title: 'Explicit test modifier', enabled: true, text: '+100 to maximum Life' }], justification: 'Test native custom-mod editor, not a real item' });
  assert.ok(custom.feedback.changes.Life.delta > 0);
  const masterySearch = await call('pob_search_nodes', { keyword: 'Fire Mastery', nodeType: 'mastery', maxResults: 1 });
  assert.ok(masterySearch.nodes.length > 0);
  const masteryNode = Number(masterySearch.nodes[0].id);
  const mastery = await call('pob_mastery_options', { nodeId: masteryNode });
  assert.ok(mastery.masteries[0].availableEffects.length > 0);
  const effect = mastery.masteries[0].availableEffects[0].effectId;
  const nodeDetails = await call('pob_node_details', { id: masteryNode });
  const notable = nodeDetails.groupNotables.find(n => n.path.length > 0);
  assert.ok(notable, 'PoB must provide a path to a notable in the mastery group');
  await call('pob_edit_node', { action: 'allocate', id: notable.id });
  const allocated = await call('pob_edit_node', { action: 'allocate', id: masteryNode, masteryEffect: effect });
  assert.equal(allocated.tree.masteryEffects[masteryNode], effect);
  await call('pob_update_tree', { removeNodes: [masteryNode] });
  await call('pob_new_build');
  await call('pob_set_tree', { classId: 3, ascendClassId: 0, nodes: [], treeVersion: '3_29' });
  const level = await call('pob_set_level', { level: 90 });
  assert.equal(level.level, 90);
  const group = await call('pob_create_socket_group', { label: 'Created skill' });
  await call('pob_add_gem', { groupIndex: group.index, gemName: 'Fireball', level: 20 });
  await call('pob_select_skill', { mainSocketGroup: group.index, mainActiveSkill: 1 });
  assert.ok((await call('pob_get_stats', { fields: ['TotalDPS'] })).stats.TotalDPS > 0);
  console.log(JSON.stringify({
    engineCommit: identity.commit, workingTreeStatus: identity.workingTreeStatus,
    verified: ['direct PoB parity', 'zero/missing preservation', 'native gem/group/item edits', 'automatic DPS/EHP/max-hit feedback', 'XML restoration', 'nonmutating tree simulation', 'native mastery allocation', 'tree/item/skill/config sets', 'config apply/reject', 'custom modifiers', 'new build and level', 'local mechanics search'],
    guiParity: 'not tested',
  }, null, 2));
} finally { await client.close(); }
