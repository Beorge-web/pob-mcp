# Verification record

Tested on Windows on 2026-11-10 with Node.js 22.17.1 and Python 3.12.10.

- MCP base: `ianderse/pob-mcp@67c3404fc6062bcfe3f690073ec25fd0daa454de`.
- Engine: `PathOfBuildingCommunity/PathOfBuilding@a69391d6daaaea1aaf8054668a094aad88dd7eaa`.
- Runtime: the engine checkout's own Windows `runtime/lua51.dll`.
- Fixture: `tests/engine/fireball.xml`, a level-90 Witch with Fireball on tree 3.29.
- PoB working tree was clean at the start of the live check.

The live test calls upstream `HeadlessWrapper.lua` and `BuildOutput()` directly
in an independent process. It compares the resulting damage, Life/ES, resistance,
mana, EHP, and max-hit fields with MCP output without rounding. Missing values
are omitted by the native Lua table and reported explicitly by the MCP layer.

The MCP stdio check also exercises gem level/quality edits, support addition,
socket group editing, item creation/replacement/equip/unequip/deletion, native
allocation paths and mastery effect selection, passive-spec copying/deletion,
item/skill/config set operations, config acceptance/rejection, persisted enemy
level, custom modifier groups, blank build creation, level selection, XML
export/restore, and local source research. It checks mutation feedback against
the actual before/after PoB outputs.

The contract tests use a controlled engine response to check that zero, negative,
fractional, nested, and missing values survive the MCP transport. They also check
that inherited heuristic tools cannot be discovered or called, and a failed native
edit reports partial changes rather than claiming the original state is intact.

This establishes the paths exercised by those tests. GUI comparison, complex
trigger/minion/timeless-jewel builds, all configuration option types, and external
patch/wiki research have not been verified by this first test suite.
