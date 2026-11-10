# Development rules

PoB is the numerical authority. Keep its calculation engine unchanged. Expose
native outputs and source data faithfully; an unavailable value stays unavailable.
MCP orchestration may select scenarios and pass edits to PoB. It must not estimate
game stats, synthesize DPS gains, replace EHP, or score builds using invented rules.
Arithmetic differences between native before/after outputs are allowed and must
remain labelled as comparisons, with missing values and zero denominators explicit.

The active server is `src/engine/server.ts`, reached through `src/index.ts`.
Inherited upstream advisory modules remain for reference in this first revision;
they are not registered or imported by the active server. New tools belong in the
explicit engine tool registry. Reject unknown tools even if inherited code defines
them. Keep source research tied to the selected engine revision.

When changing the assistant workflow, read `docs/assistant.md`. When changing the
Lua bridge, compare output with direct calls to the same PoB revision and preserve
configuration, skill selection, zero values, and failed-operation semantics. Report
transport tests separately from live-engine and GUI-parity evidence.

Use inferred types and validate external input at the adapter boundary. Keep
orchestration simple. Source files are UTF-8; use UTF-8-aware reads for Cyrillic.
