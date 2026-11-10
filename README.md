# PoB Engine MCP

Personal PoE1 MCP fork of [ianderse/pob-mcp](https://github.com/ianderse/pob-mcp).
The server edits builds and returns calculations from an unmodified
[Path of Building Community](https://github.com/PathOfBuildingCommunity/PathOfBuilding)
checkout. It runs a separate headless build, not the build currently open in the GUI.

All game calculations belong to PoB. This fork's active server excludes upstream
heuristic gem recommendations, defense scores, boss thresholds, and estimated DPS.
The only derived numbers are arithmetic differences between native PoB outputs.

## Start

Use Node.js 20 or later. Clone this fork, then run:

```powershell
npm ci
npm run build
```

Set `POB_PATH` to the `src` directory of a stock PoB source checkout. Release
installations may omit `HeadlessWrapper.lua`; the source checkout includes it.
Keep the engine revision matched to the game patch you intend to analyze.

On Windows, Python 3 of the same architecture as PoB's runtime loads the checkout's
own `runtime/lua51.dll`. The small runner uses only Python's standard library.
It opens the standard Lua libraries and executes PoB's files unchanged. This
avoids requiring a separately patched LuaJIT CLI. Set `POB_PYTHON` to an absolute
`python.exe` path if Python is not available to the MCP host.

On other platforms, or to supply a compatible CLI on Windows, set `POB_CMD` to
the LuaJIT executable. Its syntax support and native modules must match that PoB
revision. The bundled Windows runtime is not usable on Linux or macOS.

Example MCP configuration for this machine:

```json
{
  "mcpServers": {
    "pob": {
      "command": "node",
      "args": ["E:/Projects/pob-mcp/build/index.js"],
      "env": {
        "POB_PATH": "E:/Projects/PathOfBuilding/src"
      }
    }
  }
}
```

See [mcp.example.json](mcp.example.json). No model API key is needed by this MCP
server. The connected MCP client supplies the assistant and any web research tools.
`POB_LUA_ENABLED` and upstream Trade/API flags do not select another tool surface.

## Editing and feedback

The explicit tool registry is in [src/engine/server.ts](src/engine/server.ts).
Use MCP tool discovery for each input schema.

- Load XML, a local XML file, or an export code; create blank builds; export/save.
- Inspect native stats, equipment and unequipped inventory, skills, and config.
- Set character level, class, ascendancy, passive allocation, and mastery effects.
  Search nodes, inspect PoB's allocation paths, allocate paths, deallocate branches,
  and manage passive-tree specifications.
- Create/delete socket groups and add/remove gems. Edit level, quality, enabled
  state, counts, skill parts/stages, minion settings, and Full DPS inclusion.
- Create items from native item text, replace their text, equip/unequip/delete
  them, select weapon sets, and toggle flasks. PoB parses and calculates items;
  accepting hypothetical text does not establish that it can be crafted in game.
- Set native configuration parameters and explicit custom-modifier groups.
  List/create/copy/select/rename/delete item, skill, and configuration sets.
- Search and read exact Lua source excerpts from the selected PoB checkout.

Successful mutations return `feedback` alongside their operation result:

```text
feedback.before.stats    native PoB results before the edit
feedback.after.stats     native PoB results after the edit
feedback.changes         before / after / delta / percent for each tracked field
feedback.configChanged   whether native config values changed
feedback.contextChanged  whether selected specs/sets or custom modifiers changed
```

Tracked fields include `TotalDPS`, `CombinedDPS`, `FullDPS`, `TotalEHP`, physical,
fire, cold, lightning, and chaos maximum hit, Life, ES, and mana cost/recovery
outputs. A missing value stays unavailable. A percentage against a zero baseline
is `null`. This comparison does not add uptime assumptions or score a build.
The snapshots also include native configuration, skills, and equipped items.
If a native edit fails after partially changing state, the error response includes
feedback where the remaining state can be read, or explicitly requires a reload.

`pob_simulate_tree` returns PoB's own temporary calculator result. It is a raw
mechanical probe; use allocation paths and actual edits to verify a legal tree.
Export baseline XML before independent experiments and reload it between variants.
Typed tools cover the operations above; full native XML load/export remains the
route for other build fields until dedicated tools are added.

## Assistant knowledge

[docs/assistant.md](docs/assistant.md) is sent as MCP initialization instructions
and exposed as `pob://assistant-guide`. It requires patch-specific source evidence,
justified conditions, fixed comparison scenarios, and defense/resource checks.
Temporary buffs and baseline defenses are separate PoB scenarios.

Local source search is available now. A curated patch-versioned knowledge base,
dedicated wiki retrieval, and automated uptime validation are future work. These
instructions help guide an assistant; they do not certify every gameplay claim.

## Verification

```powershell
npm test
$env:POB_PATH = 'E:\Projects\PathOfBuilding\src'
npm run test:live
```

`npm test` builds and checks the MCP contract, exact value preservation, mutation
feedback, operation ordering, stale-state rejection, and UTF-8 source research.
`test:live` compares MCP results with an independent direct call to upstream PoB,
then exercises edits, mastery allocation, set management, export/restore, and
automatic DPS/EHP/max-hit feedback through MCP stdio.

See [docs/verification.md](docs/verification.md) for the revision actually tested.
GUI parity and broad coverage of complex builds remain separate checks.

## Upstream

This fork retains the upstream Lua build-operation wrappers, process client,
supporting utilities, history, and GPL-3.0 license. Adapter changes address current
PoB APIs and expose direct editing. PoB engine source and formulas are unchanged.
Upstream advisory modules remain as historical reference and are unreachable from
the default entry point. Its old README is [docs/UPSTREAM_README.md](docs/UPSTREAM_README.md).
Historical Jest tests are available as `npm run test:upstream`; they describe the
upstream interface rather than this fork's active MCP contract.
