-- JSON-lines adapter for an unmodified PathOfBuildingCommunity checkout.
-- Run with cwd set to its src/ directory: luajit /path/to/vanilla_stdio_bridge.lua
-- All build operations live in pob_ops.lua (repo-owned); no PoB patches required.
local json = require('dkjson')

-- Locate this script's directory so repo-owned modules load regardless of cwd
local ADAPTER_DIR = (arg and arg[0] or ''):gsub('[^/\\]*$', '')
if ADAPTER_DIR == '' then ADAPTER_DIR = './' end

-- Stock HeadlessWrapper does not define this render stub; define it before the
-- dofile so an upstream version, if one is ever added, takes precedence.
if not GetVirtualScreenSize then
  function GetVirtualScreenSize() return 1920, 1080 end
end

-- The upstream wrapper initializes PoB and exposes newBuild/loadBuildFromXML plus `build`.
dofile('HeadlessWrapper.lua')

-- HeadlessWrapper stubs Inflate() to return "", which makes PoB's timeless jewel
-- loader overwrite its .bin cache with an empty file and skip conquered nodes.
-- Provide a real implementation via the system zlib (LuaJIT FFI).
do
  local ok, err = pcall(function()
    local ffi = require('ffi')
    ffi.cdef[[
      int uncompress(uint8_t *dest, unsigned long *destLen, const uint8_t *source, unsigned long sourceLen);
    ]]
    local zlib
    for _, name in ipairs({ 'z', 'libz.so.1', 'libz.dylib', 'zlib1' }) do
      local loaded, lib = pcall(ffi.load, name)
      if loaded then zlib = lib break end
    end
    if not zlib then error('zlib not found') end
    function Inflate(data)
      if not data or #data == 0 then return '' end
      local size = math.max(#data * 4, 65536)
      while size <= 1024 * 1024 * 1024 do
        local buf = ffi.new('uint8_t[?]', size)
        local len = ffi.new('unsigned long[1]', size)
        local rc = zlib.uncompress(buf, len, data, #data)
        if rc == 0 then return ffi.string(buf, len[0]) end
        if rc ~= -5 then error('zlib Inflate failed: ' .. tostring(rc)) end
        size = size * 2
      end
      error('zlib Inflate exceeded the supported buffer size')
    end
  end)
  if not ok then
    error('Real Inflate is required for faithful PoB calculations: ' .. tostring(err))
  end
end

local BuildOps = dofile(ADAPTER_DIR .. 'pob_ops.lua')

-- json.encode raises on cycles, NaN and functions. An uncaught raise here kills
-- the process and takes the caller's loaded build with it, so a payload we
-- cannot serialise must degrade into an error response, never a crash.
local function reply(value)
  local ok, encoded = pcall(json.encode, value)
  if not ok then
    encoded = json.encode({
      ok = false,
      error = 'response could not be serialised: ' .. tostring(encoded),
    })
  end
  io.write(encoded, '\n')
  io.flush()
end

-- Wrap a BuildOps function that returns (result, err) into the JSON envelope.
-- resultKey names the field the TS bridge reads the payload from.
local function op(fn, resultKey)
  return function(params)
    local res, err = fn(params or {})
    if res == nil then return { ok = false, error = err or 'operation failed' } end
    local envelope = { ok = true }
    if resultKey then envelope[resultKey] = res end
    return envelope
  end
end

local handlers = {}

handlers.ping = function() return { ok = true, pong = true } end
handlers.new_build = function()
  _G.newBuild()
  return { ok = true }
end

handlers.version = function()
  return { ok = true, version = {
    number = _G.launch and launch.versionNumber or '?',
    branch = _G.launch and launch.versionBranch or '?',
    platform = _G.launch and launch.versionPlatform or '?',
    adapter = 'vanilla-stdio-v2',
  } }
end

handlers.load_build_xml = function(params)
  if not params or type(params.xml) ~= 'string' then return { ok = false, error = 'missing xml' } end
  if not _G.loadBuildFromXML then return { ok = false, error = 'headless wrapper not initialized' } end
  local ok, err = pcall(_G.loadBuildFromXML, params.xml, (params.name and tostring(params.name)) or 'API Build')
  if not ok then return { ok = false, error = tostring(err) } end
  -- PoB can close the build or stop at a conversion popup without throwing.
  -- Shutdown clears savers, so stale build fields alone do not prove a load.
  if not build or not build.savers or not build.spec then
    return { ok = false, error = 'PoB did not initialize the build; check the XML and supported build version' }
  end
  return { ok = true, build_id = 1 }
end

handlers.get_stats = function(params)
  local stats, err = BuildOps.export_stats(params and params.fields or nil)
  if not stats then return { ok = false, error = err } end
  return { ok = true, stats = stats }
end

handlers.set_tree = function(params)
  local ok2, err = BuildOps.set_tree(params or {})
  if not ok2 then return { ok = false, error = err } end
  return { ok = true, tree = (BuildOps.get_tree()) }
end

handlers.update_tree_delta = function(params)
  local result, err = BuildOps.update_tree_delta(params or {})
  if not result then return { ok = false, error = err } end
  return { ok = true, tree = result.tree, droppedNodes = result.droppedNodes }
end

handlers.set_config = function(params)
  local result, err = BuildOps.set_config(params or {})
  if not result then return { ok = false, error = err } end
  -- Report per-key outcomes so the caller can tell an applied change from a
  -- rejected one instead of assuming success.
  return {
    ok = true,
    applied = result.applied,
    rejected = result.rejected,
    config = (BuildOps.get_config()),
  }
end

handlers.set_main_selection = function(params)
  local ok2, err = BuildOps.set_main_selection(params or {})
  if not ok2 then return { ok = false, error = err } end
  return { ok = true, skills = (BuildOps.get_skills()) }
end

handlers.set_level = function(params)
  if not params or params.level == nil then return { ok = false, error = 'missing level' } end
  local ok2, err = BuildOps.set_level(params.level)
  if not ok2 then return { ok = false, error = err } end
  return { ok = true }
end

handlers.set_flask_active = op(BuildOps.set_flask_active)
handlers.set_gem_level = op(BuildOps.set_gem_level)
handlers.set_gem_quality = op(BuildOps.set_gem_quality)
handlers.set_gem_enabled = op(BuildOps.set_gem_enabled)
handlers.remove_skill = op(BuildOps.remove_skill)
handlers.remove_gem = op(BuildOps.remove_gem)

handlers.get_tree = op(BuildOps.get_tree, 'tree')
handlers.get_items = op(BuildOps.get_items, 'items')
handlers.get_skills = op(BuildOps.get_skills, 'skills')
handlers.get_build_info = op(BuildOps.get_build_info, 'info')
handlers.get_config = function()
  local cfg, err = BuildOps.get_config()
  if cfg == nil then return { ok = false, error = err or 'operation failed' } end
  return { ok = true, config = cfg, labels = (BuildOps.get_config_labels()) }
end
handlers.calc_with = op(BuildOps.calc_with, 'output')
handlers.export_build_xml = op(BuildOps.export_build_xml, 'xml')
handlers.add_item_text = op(BuildOps.add_item_text, 'item')
handlers.create_socket_group = op(BuildOps.create_socket_group, 'socketGroup')
handlers.add_gem = op(BuildOps.add_gem, 'gem')
handlers.search_nodes = op(BuildOps.search_nodes, 'results')
handlers.get_mastery_options = op(BuildOps.get_mastery_options, 'result')
handlers.get_ailments = op(BuildOps.get_ailments, 'result')
handlers.save_build = op(BuildOps.save_build, 'result')
handlers.list_specs = op(BuildOps.list_specs, 'result')
handlers.select_spec = op(BuildOps.select_spec, 'result')
handlers.create_spec = op(BuildOps.create_spec, 'result')
handlers.delete_spec = op(BuildOps.delete_spec, 'result')
handlers.rename_spec = op(BuildOps.rename_spec, 'result')
handlers.list_item_sets = op(BuildOps.list_item_sets, 'result')
handlers.select_item_set = op(BuildOps.select_item_set, 'result')
handlers.set_socket_group_enabled = op(BuildOps.set_socket_group_enabled, 'result')
local EditOps = dofile(ADAPTER_DIR .. 'edit_ops.lua')(BuildOps)
for name, fn in pairs(EditOps) do handlers[name] = op(fn, 'result') end


handlers.get_capabilities = function()
  local actions = { 'quit' }
  for name in pairs(handlers) do table.insert(actions, name) end
  table.sort(actions)
  return { ok = true, capabilities = { mode = 'vanilla', adapter = 'vanilla-stdio-v2', actions = actions } }
end

reply({ ok = true, ready = true, version = { adapter = 'vanilla-stdio-v2' } })
for line in io.lines() do
  local request = json.decode(line)
  -- dkjson happily decodes scalars ("5", "\"ping\""); indexing them would
  -- raise OUTSIDE the handler pcall and kill the bridge — the one failure
  -- mode reply() promises to prevent.
  if type(request) ~= 'table' then
    reply({ ok = false, error = 'invalid request: expected a JSON object' })
  else
    local action, params = request.action, request.params or {}
    if action == 'quit' then
      reply({ ok = true, quit = true })
      break
    end
    local handler = handlers[action]
    if not handler then
      reply({ ok = false, error = 'unknown action: ' .. tostring(action) })
    else
      local ok, res = pcall(handler, params)
      if not ok then
        reply({ ok = false, error = tostring(res) })
      elseif type(res) ~= 'table' then
        reply({ ok = false, error = 'handler returned no response' })
      else
        reply(res)
      end
    end
  end
end
