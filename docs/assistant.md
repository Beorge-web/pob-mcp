# PoE build reasoning

Use Path of Building as the sole numerical authority. Every reported damage,
defense, recovery, cost, duration, or rate must come from its output or its
version-local data. Quote native field names. Preserve zero and missing values.
Report an unavailable calculation as unavailable.
Mutation tools return native before/after snapshots and arithmetic differences.
Use that feedback to explain DPS, EHP, and maximum-hit changes. A null percentage
means the baseline is zero or a native value is missing; it is not a zero gain.

## Establish the build and scenario

1. Identify the engine revision with `pob_engine_info`. Confirm the user's game
   patch and intended content; a passive-tree version does not establish either.
2. Load the build and inspect its skills, items, tree, and full configuration.
   Establish the selected skill, enemy, item set, and passive spec before comparing.
3. Agree on constraints appropriate to the build and content: defense, recovery,
   resource sustain, passive points, level, budget, and acceptable manual actions.
4. Keep that scenario fixed while comparing changes. Record configuration changes
   separately, with their justification. Numerical improvement under different
   assumptions is a different scenario.

## Support mechanics claims with evidence

Search and read the matching local PoB source for skills, items, modifiers, and
configuration options. Use the MCP client's research tools for official patch
notes and PoE Wiki explanations when local data does not explain an interaction.
Record the source URL or local file/line and its applicable patch. Treat a guide
or another player's build as a hypothesis until its interaction is verified.

The model's memory is a search hint. When a mechanic or its current behavior is
unverified, say which claim is unresolved and keep it out of the confirmed result.
The source-search tools are literal code search, not a complete rules database.

## Validate the conditions, then ask PoB to calculate

For each conditional effect, identify its source in the build and what maintains
it in the chosen encounter. Check on-kill versus single-target availability,
flask charge generation, charges and debuffs, trigger conditions, cooldowns,
resource consumption, ramp time, and required player actions where relevant.
An enabled config checkbox proves what PoB was asked to calculate; it does not
prove that the character can maintain it. Keep unknown uptime explicit.

Compare baseline and candidate through the same PoB engine and configuration.
For temporary effects, compare separate PoB scenarios with the effect active and
inactive. Label burst and sustained scenarios separately. Use PoB's available
calculations for durations and resource rates. Leave unsupported timing questions
unresolved instead of inventing a combat simulator or multiplying DPS by a guessed
uptime.

Evaluate defense using the relevant native maximum-hit, mitigation, avoidance,
and recovery outputs. Check temporary defenses both active and inactive and
respect build-specific mechanics. A single EHP number or universal Life threshold
does not establish that a build meets the user's defensive constraints.

## Present and preserve the result

Before experiments, export a baseline XML. Restore it between independent
candidates so edits do not accumulate accidentally. Re-read applied changes and
rejected configuration keys. Tree simulation returns mechanical stat impact;
check connected paths and total passive-point cost before recommending allocation.

For each recommendation, give the exact edit, the relevant before/after PoB
outputs, the scenario, defensive and resource tradeoffs, evidence for conditional
mechanics, and unresolved assumptions. Distinguish a tested candidate from a
proven global optimum. Save to a new file unless the user requested replacement.
