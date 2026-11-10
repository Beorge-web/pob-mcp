-- Independent reference: calls only upstream PoB, never the MCP adapter.
local fixturePath = arg[1]
dofile('HeadlessWrapper.lua')
local json = require('dkjson')
local file = assert(io.open(fixturePath, 'rb'))
local xml = file:read('*a'); file:close()
loadBuildFromXML(xml, 'engine-fireball')
build.calcsTab:BuildOutput()
local fields = { 'Life', 'EnergyShield', 'CombinedDPS', 'TotalDPS', 'FullDPS', 'TotalEHP',
  'ManaCost', 'ManaRegen', 'PhysicalMaximumHitTaken', 'FireMaximumHitTaken',
  'ColdMaximumHitTaken', 'LightningMaximumHitTaken', 'ChaosMaximumHitTaken', 'SpellSuppressionChance', 'FireResist' }
local result = {}
for _, field in ipairs(fields) do result[field] = build.calcsTab.mainOutput[field] end
io.write('\nPOB_ORACLE ', json.encode(result), '\n'); io.flush()
