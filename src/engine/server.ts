import fs from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { EngineMutationError, EngineSession } from './session.js';
import { engineIdentity, readSource, searchSources } from './sources.js';

const empty = z.strictObject({});
const nodeIds = z.array(z.number().int().positive());
const groupIndex = z.number().int().positive();
const fields = z.array(z.string().min(1)).min(1).optional();
const configValues = z.record(z.string(), z.union([z.string(), z.number().finite(), z.boolean()]));

function tool<T extends z.ZodType>(name: string, description: string, input: T,
  execute: (args: z.infer<T>) => Promise<unknown>, readOnly = true) {
  return {
    schema: {
      name, description,
      inputSchema: { ...z.toJSONSchema(input), type: 'object' as const },
      annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: false },
    },
    execute: (args: unknown) => execute(input.parse(args)),
  };
}

/** Exposes only direct engine operations and local source evidence. */
export async function createEngineServer(root: string, session = new EngineSession(root)) {
  const guide = await fs.readFile(path.join(root, 'docs', 'assistant.md'), 'utf8');
  const server = new Server({ name: 'pob-engine-mcp', version: '0.1.0' }, {
    capabilities: { tools: {}, resources: {} }, instructions: guide,
  });
  const tools = [
    tool('pob_new_build', 'Create a blank build through PoB. Inspect native class IDs with pob_editing_options, then set the tree and level.', empty,
      () => session.load(c => c.newBuild()), false),
    tool('pob_engine_info', 'Identify the local PoB source revision and bridge capabilities. Does not verify GUI parity.', empty,
      async () => ({ ...await engineIdentity(session.enginePath), bridge: await session.run(c => c.getCapabilities(), false) })),
    tool('pob_load_build', 'Load XML or a local XML file into a separate headless PoB. Discards current in-memory edits.',
      z.strictObject({ xml: z.string().min(1).optional(), file: z.string().min(1).optional(), name: z.string().optional() })
        .refine(a => Number(a.xml !== undefined) + Number(a.file !== undefined) === 1, 'Provide exactly one of xml or file'),
      async a => {
        const xml = a.xml ?? await fs.readFile(a.file!, 'utf8');
        return session.load(c => c.loadBuildXml(xml, a.name, a.file));
      }, false),
    tool('pob_import_code', 'Load a PoB export code. Accepts the code itself, not a pobb.in URL.',
      z.strictObject({ code: z.string().min(1), name: z.string().optional() }),
      a => session.load(c => c.importCode(a.code, a.name)), false),
    tool('pob_get_stats', 'Return PoB output unchanged, including zero values, with the current calculation context. Missing values are not estimates. Requested fields use native PoB names.',
      z.strictObject({ fields }), a => session.run(async c => {
        const stats = await c.getStats(a.fields);
        return {
          source: 'PathOfBuilding', stats,
          missingFields: a.fields?.filter(field => !(field in stats)) ?? [],
          build: await c.getBuildInfo(), config: await c.getConfig(),
          tree: await c.getTree(), skills: await c.getSkills(), items: await c.getItems(),
          context: await c.edit('get_context'),
        };
      })),
    tool('pob_get_build', 'Inspect current build, passive tree, skills, items, and config without scoring them.', empty,
      () => session.run(async c => ({ build: await c.getBuildInfo(), tree: await c.getTree(), skills: await c.getSkills(), items: await c.getItems(), config: await c.getConfig() }))),
    tool('pob_editing_options', 'Read native class/ascendancy IDs, configuration option types and choices, gem fields, and custom modifiers from the current PoB revision.', empty,
      () => session.run(c => c.edit('get_editing_options'))),
    tool('pob_get_inventory', 'Read every item, including unequipped items, with its native PoB item text and ID.', empty,
      () => session.run(c => c.edit('get_inventory'))),
    tool('pob_set_level', 'Set character level through PoB and recalculate.',
      z.strictObject({ level: z.number().int().min(1).max(100) }),
      a => session.mutate(async c => { await c.setLevel(a.level); return c.getBuildInfo(); }), false),
    tool('pob_set_tree', 'Replace the passive allocation, class, ascendancy, and mastery selections through PoB. Read native IDs first. Export a baseline before replacing.',
      z.strictObject({ classId: z.number().int().nonnegative(), ascendClassId: z.number().int().nonnegative(), secondaryAscendClassId: z.number().int().nonnegative().optional(), nodes: nodeIds, masteryEffects: z.record(z.string(), z.number().int()).optional(), treeVersion: z.string().optional() }),
      a => session.mutate(c => c.setTree(a)), false),
    tool('pob_mastery_options', 'Read native mastery effect IDs and descriptions. Supply nodeId to inspect an unallocated mastery; omit it for allocated masteries.',
      z.strictObject({ nodeId: groupIndex.optional() }), a => session.run(c => c.getMasteryOptions(a.nodeId))),
    tool('pob_search_nodes', 'Find native passive nodes by name or modifier text. Returns IDs and descriptions without invented upgrade scores.',
      z.strictObject({ keyword: z.string().min(1), nodeType: z.enum(['normal', 'notable', 'keystone', 'mastery', 'jewel', 'ascendancy']).optional(), maxResults: z.number().int().min(1).max(100).default(20), includeAllocated: z.boolean().default(true) }),
      a => session.run(c => c.searchNodes(a))),
    tool('pob_node_details', 'Read the allocation path calculated by PoB, group notables, and mastery choices for a node.',
      z.strictObject({ id: groupIndex }), a => session.run(c => c.edit('node_details', a))),
    tool('pob_edit_node', 'Allocate a node with the path selected by PoB, or deallocate it and its dependent branch. Masteries require a native effect ID and an eligible notable in their group.',
      z.strictObject({ action: z.enum(['allocate', 'deallocate']), id: groupIndex, masteryEffect: groupIndex.optional() }),
      a => session.mutate(c => c.edit('edit_node', a)), false),
    tool('pob_tree_specs', 'List, create/copy, select, rename, or delete passive-tree specifications.',
      z.discriminatedUnion('action', [
        z.strictObject({ action: z.literal('list') }),
        z.strictObject({ action: z.literal('create'), title: z.string().optional(), copyFrom: groupIndex.optional(), activate: z.boolean().optional() }),
        z.strictObject({ action: z.literal('select'), index: groupIndex }),
        z.strictObject({ action: z.literal('rename'), index: groupIndex, title: z.string().min(1) }),
        z.strictObject({ action: z.literal('delete'), index: groupIndex }),
      ]), a => session.mutate(c => {
        switch (a.action) {
          case 'list': return c.listSpecs();
          case 'create': return c.createSpec(a);
          case 'select': return c.selectSpec(a.index);
          case 'rename': return c.renameSpec(a.index, a.title);
          case 'delete': return c.deleteSpec(a.index);
        }
      }), false),
    tool('pob_manage_sets', 'Manage native item, skill, and configuration sets. Copies preserve the source state. IDs are read from the list result.',
      z.discriminatedUnion('action', [
        z.strictObject({ action: z.literal('list'), kind: z.enum(['items', 'skills', 'config']) }),
        z.strictObject({ action: z.literal('create'), kind: z.enum(['items', 'skills', 'config']), title: z.string().min(1), copyFrom: groupIndex.optional(), activate: z.boolean().optional() }),
        z.strictObject({ action: z.literal('select'), kind: z.enum(['items', 'skills', 'config']), id: groupIndex }),
        z.strictObject({ action: z.literal('rename'), kind: z.enum(['items', 'skills', 'config']), id: groupIndex, title: z.string().min(1) }),
        z.strictObject({ action: z.literal('delete'), kind: z.enum(['items', 'skills', 'config']), id: groupIndex }),
      ]), a => session.mutate(c => c.edit('manage_sets', a)), false),
    tool('pob_set_config', 'Set native PoB configuration values. A recognized option is not proof that its condition is sustainable. Include a concrete justification; inspect applied and rejected keys.',
      z.strictObject({ values: configValues, justification: z.string().min(1) }),
      a => session.mutate(async c => ({ ...await c.setConfig(a.values), justification: a.justification })), false),
    tool('pob_simulate_tree', 'Call PoB MiscCalculator with temporary node/mastery changes. Returns its output without scoring or estimating gains. This does not validate path connectivity or the passive-point budget.',
      z.strictObject({ addNodes: nodeIds.optional(), removeNodes: nodeIds.optional(), masteryEffects: z.record(z.string(), z.number().int()).optional(), useFullDPS: z.boolean().optional() }),
      a => session.run(async c => ({ source: 'PathOfBuilding.GetMiscCalculator', output: await c.calcWith(a), config: await c.getConfig() }))),
    tool('pob_update_tree', 'Apply node/mastery changes through PoB. Inspect returned droppedNodes and re-read the build before claiming success.',
      z.strictObject({ addNodes: nodeIds.optional(), removeNodes: nodeIds.optional(), masteryEffects: z.record(z.string(), z.number().int()).optional() }),
      a => session.mutate(c => c.updateTreeDelta(a)), false),
    tool('pob_select_skill', 'Select the native PoB main socket group, active skill, and optional skill part. Indices are 1-based.',
      z.strictObject({ mainSocketGroup: groupIndex.optional(), mainActiveSkill: groupIndex.optional(), skillPart: groupIndex.optional() }),
      a => session.mutate(async c => { await c.setMainSelection(a); return c.getSkills(); }), false),
    tool('pob_create_socket_group', 'Create a socket group through PoB.',
      z.strictObject({ label: z.string().optional(), slot: z.string().optional(), enabled: z.boolean().optional(), includeInFullDPS: z.boolean().optional() }),
      a => session.mutate(c => c.createSocketGroup(a)), false),
    tool('pob_add_gem', 'Add a gem through PoB. Read skill data afterward and recalculate to evaluate it.',
      z.strictObject({ groupIndex, gemName: z.string().min(1), level: z.number().int().positive().optional(), quality: z.number().int().nonnegative().optional(), enabled: z.boolean().optional() }),
      a => session.mutate(c => c.addGem(a)), false),
    tool('pob_remove_gem', 'Remove one gem through PoB. Indices are 1-based.',
      z.strictObject({ groupIndex, gemIndex: groupIndex }), a => session.mutate(async c => { await c.removeGem(a); return c.getSkills(); }), false),
    tool('pob_edit_gem', 'Edit native gem properties, including level, quality, enabled state, count, skill part/stages, and minion settings. These values specify the scenario; they do not establish uptime.',
      z.strictObject({ groupIndex, gemIndex: groupIndex, values: z.strictObject({
        level: z.number().int().positive().optional(), quality: z.number().nonnegative().optional(), qualityId: z.string().optional(),
        enabled: z.boolean().optional(), count: z.number().nonnegative().optional(), enableGlobal1: z.boolean().optional(), enableGlobal2: z.boolean().optional(),
        skillPart: groupIndex.optional(), skillStageCount: z.number().int().nonnegative().optional(), skillMineCount: z.number().int().nonnegative().optional(),
        skillMinion: z.string().optional(), skillMinionItemSet: groupIndex.optional(), skillMinionSkill: groupIndex.optional(),
      }) }), a => session.mutate(c => c.edit('edit_gem', a)), false),
    tool('pob_edit_skill_group', 'Edit a native socket group: label, equipment slot, enabled state, Full DPS inclusion, group count, main active skill, and imbued support.',
      z.strictObject({ groupIndex, values: z.strictObject({
        label: z.string().optional(), slot: z.string().optional(), enabled: z.boolean().optional(), includeInFullDPS: z.boolean().optional(),
        groupCount: z.number().nonnegative().optional(), mainActiveSkill: groupIndex.optional(), imbuedSupport: z.string().optional(),
      }) }), a => session.mutate(c => c.edit('edit_skill_group', a)), false),
    tool('pob_remove_skill_group', 'Delete a socket group through PoB.', z.strictObject({ groupIndex }),
      a => session.mutate(async c => { await c.removeSkill(a); return c.getSkills(); }), false),
    tool('pob_add_item', 'Parse and add native PoE clipboard item text through PoB. Equips it unless noAutoEquip is true.',
      z.strictObject({ text: z.string().min(1), slot: z.string().optional(), noAutoEquip: z.boolean().optional() }),
      a => session.mutate(c => c.addItem(a.text, a.slot, a.noAutoEquip)), false),
    tool('pob_edit_item', 'Replace item text, equip/unequip an item, or delete it through PoB. Replacement preserves the item ID; deletion affects all sets that use it. Item text may describe a hypothetical crafted item and does not prove craftability.',
      z.discriminatedUnion('action', [
        z.strictObject({ action: z.literal('replace'), id: groupIndex, text: z.string().min(1) }),
        z.strictObject({ action: z.literal('equip'), id: groupIndex, slot: z.string().min(1) }),
        z.strictObject({ action: z.literal('unequip'), slot: z.string().min(1) }),
        z.strictObject({ action: z.literal('delete'), id: groupIndex }),
      ]), a => session.mutate(c => c.edit('edit_item', a)), false),
    tool('pob_set_weapon_set', 'Select the primary or secondary weapon set in PoB.',
      z.strictObject({ secondary: z.boolean() }), a => session.mutate(c => c.edit('set_weapon_set', a)), false),
    tool('pob_set_custom_modifiers', 'Replace native custom modifier groups in the active configuration set. Custom modifiers are explicit hypothetical inputs, not evidence that an item or mechanic exists.',
      z.strictObject({ groups: z.array(z.strictObject({ title: z.string(), enabled: z.boolean(), text: z.string() })).min(1), justification: z.string().min(1) }),
      a => session.mutate(c => c.edit('set_custom_modifiers', a)), false),
    tool('pob_set_flask', 'Set a flask active in PoB. Activation is an assumption, not evidence of uptime.',
      z.strictObject({ index: z.number().int().min(1).max(5), active: z.boolean(), justification: z.string().min(1) }),
      a => session.mutate(async c => { await c.setFlaskActive(a.index, a.active); return { items: await c.getItems(), justification: a.justification }; }), false),
    tool('pob_export_build', 'Return XML from PoB SaveDB without writing a file. Save it explicitly or reload it to restore an experiment.', empty,
      () => session.run(async c => ({ xml: await c.exportBuildXml() }))),
    tool('pob_save_build', 'Save the live build through PoB. Existing files require overwrite: true, except the originally loaded file.',
      z.strictObject({ file: z.string().min(1), overwrite: z.boolean().default(false) }),
      a => session.run(c => c.saveBuild(a.file, a.overwrite)), false),
    tool('pob_search_sources', 'Search literal text in this local PoB revision. Returns source locations and excerpts, not generated mechanics explanations.',
      z.strictObject({ query: z.string().min(2), limit: z.number().int().min(1).max(50).default(10) }),
      a => searchSources(session.enginePath, a.query, a.limit)),
    tool('pob_read_source', 'Read an exact local PoB Lua source excerpt to investigate a mechanic or configuration option.',
      z.strictObject({ path: z.string().min(1), startLine: z.number().int().positive().default(1), count: z.number().int().min(1).max(200).default(80) }),
      a => readSource(session.enginePath, a.path, a.startLine, a.count)),
  ];
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: tools.map(t => t.schema) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    try {
      const selected = tools.find(t => t.schema.name === request.params.name);
      if (!selected) throw new Error(`Unknown tool: ${request.params.name}`);
      const data = { result: await selected.execute(request.params.arguments ?? {}) };
      return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      return { isError: true,
        ...(error instanceof EngineMutationError ? { structuredContent: { feedback: error.feedback } } : {}),
        content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: 'pob://assistant-guide', name: 'PoE build reasoning rules', mimeType: 'text/markdown' }] }));
  server.setRequestHandler(ReadResourceRequestSchema, async request => {
    if (request.params.uri !== 'pob://assistant-guide') throw new Error('Unknown resource');
    return { contents: [{ uri: request.params.uri, mimeType: 'text/markdown', text: guide }] };
  });
  return { server, session };
}
