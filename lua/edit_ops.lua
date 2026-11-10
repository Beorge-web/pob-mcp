-- Editor operations use the same objects and methods as PoB's UI.
return function(BuildOps)
  local M = {}
  local function recalc()
    build.buildFlag = true
    build.modFlag = true
    build.configTab:BuildModList()
    local output, err = BuildOps.get_main_output()
    if not output then error(err) end
  end

  function M.get_context()
    return { activeSpec = build.treeTab.activeSpec, activeItemSet = build.itemsTab.activeItemSetId,
      activeSkillSet = build.skillsTab.activeSkillSetId, activeConfigSet = build.configTab.activeConfigSetId,
      customModifiers = build.configTab.configSets[build.configTab.activeConfigSetId].customModsList }
  end

  function M.node_details(params)
    local spec = build.spec
    local node = spec.nodes[params.id]
    if not node then return nil, 'node id not found' end
    local function pathIds(target)
      local result = {}
      for _, pathNode in ipairs(target.path or {}) do result[#result + 1] = pathNode.id end
      return result
    end
    local notables = {}
    for _, id in ipairs(node.group and node.group.n or {}) do
      local member = spec.nodes[tonumber(id)]
      if member and member.isNotable then notables[#notables + 1] = { id = member.id, name = member.name, path = pathIds(member) } end
    end
    return { id = node.id, name = node.name, type = node.type, allocated = node.alloc,
      path = pathIds(node), pathAvailable = node.path ~= nil, groupNotables = notables,
      mastery = BuildOps.get_mastery_options({ nodeId = node.id }) }
  end

  function M.edit_node(params)
    local spec = build.spec
    local node = spec.nodes[params.id]
    if not node then return nil, 'node id not found' end
    if params.action == 'allocate' then
      if not node.path then return nil, 'PoB has no allocation path; a mastery may require allocating a notable in its group first' end
      if node.type == 'Mastery' then
        local valid = false
        for _, option in ipairs(node.masteryEffects or {}) do if option.effect == params.masteryEffect then valid = true end end
        if not valid then return nil, 'choose a native mastery effect from pob_mastery_options' end
        spec.masterySelections[node.id] = params.masteryEffect
      end
      spec:AllocNode(node)
    elseif params.action == 'deallocate' then spec:DeallocNode(node)
    else return nil, 'unknown node operation' end
    spec:AddUndoState()
    recalc()
    return { tree = BuildOps.get_tree(), node = M.node_details(params) }
  end

  function M.get_inventory()
    local result = {}
    for _, id in ipairs(build.itemsTab.itemOrderList) do
      local item = build.itemsTab.items[id]
      result[#result + 1] = { id = id, name = item.name, baseName = item.baseName, rarity = item.rarity, raw = item.raw }
    end
    return result
  end

  function M.edit_item(params)
    local tab = build.itemsTab
    local item = tab.items[params.id]
    if params.action ~= 'unequip' and not item then return nil, 'item id not found' end
    if params.action == 'replace' then
      local replacement = new('Item'):Item(params.text)
      if not replacement.baseName then return nil, 'PoB could not parse the replacement item' end
      for slotName, slot in pairs(tab.slots) do
        if slot.selItemId == item.id and not tab:IsItemValidForSlot(replacement, slotName) then
          return nil, 'replacement is incompatible with equipped slot ' .. slotName
        end
      end
      replacement:NormaliseQuality()
      replacement.id = item.id
      tab:AddItem(replacement, true)
    elseif params.action == 'delete' then
      tab:DeleteItem(item)
    elseif params.action == 'equip' or params.action == 'unequip' then
      local slot = tab.slots[params.slot]
      if not slot then return nil, 'unknown slot' end
      if params.action == 'equip' and not tab:IsItemValidForSlot(item, params.slot) then
        return nil, 'PoB does not allow this item in the requested slot'
      end
      slot:SetSelItemId(params.action == 'unequip' and 0 or item.id)
    else return nil, 'unknown item operation' end
    tab:PopulateSlots()
    tab:AddUndoState()
    recalc()
    return { inventory = M.get_inventory(), equipped = BuildOps.get_items() }
  end

  local gemFields = { 'level', 'quality', 'qualityId', 'enabled', 'count', 'enableGlobal1', 'enableGlobal2',
    'skillPart', 'skillStageCount', 'skillMineCount', 'skillMinion', 'skillMinionItemSet', 'skillMinionSkill' }
  function M.edit_gem(params)
    local group = build.skillsTab.socketGroupList[params.groupIndex]
    local gem = group and group.gemList[params.gemIndex]
    if not gem then return nil, 'gem index not found' end
    for _, key in ipairs(gemFields) do
      if params.values[key] ~= nil then gem[key] = params.values[key] end
    end
    build.skillsTab:ProcessSocketGroup(group)
    build.skillsTab:AddUndoState()
    recalc()
    return BuildOps.get_skills()
  end

  function M.edit_skill_group(params)
    local tab = build.skillsTab
    local group = tab.socketGroupList[params.groupIndex]
    if not group then return nil, 'socket group index not found' end
    for _, key in ipairs({ 'label', 'slot', 'enabled', 'includeInFullDPS', 'groupCount', 'mainActiveSkill', 'imbuedSupport' }) do
      if params.values[key] ~= nil then group[key] = params.values[key] end
    end
    tab:ProcessSocketGroup(group)
    tab:RebuildImbuedSupportBySlot()
    tab:AddUndoState()
    recalc()
    return BuildOps.get_skills()
  end

  local function setTab(kind)
    if kind == 'items' then return build.itemsTab, 'itemSets', 'itemSetOrderList', 'activeItemSetId', 'NewItemSet', 'SetActiveItemSet' end
    if kind == 'skills' then return build.skillsTab, 'skillSets', 'skillSetOrderList', 'activeSkillSetId', 'NewSkillSet', 'SetActiveSkillSet' end
    if kind == 'config' then return build.configTab, 'configSets', 'configSetOrderList', 'activeConfigSetId', 'NewConfigSet', 'SetActiveConfigSet' end
    error('unknown set kind')
  end

  function M.manage_sets(params)
    local tab, setsKey, orderKey, activeKey, create, select = setTab(params.kind)
    local sets, order = tab[setsKey], tab[orderKey]
    local selected = params.id and sets[params.id]
    if params.action == 'create' then
      local source = params.copyFrom and sets[params.copyFrom]
      if params.copyFrom and not source then return nil, 'copyFrom set not found' end
      local created = tab[create](tab)
      if source then
        -- Match the native set manager's copy behavior.
        if params.kind == 'items' then
          tab:PopulateSlots()
          source = sets[params.copyFrom]
        end
        local copied
        if params.kind == 'skills' then
          copied = copyTable(source, true)
          copied.socketGroupList = {}
          for index, group in ipairs(source.socketGroupList) do
            local groupCopy = copyTable(group, true)
            groupCopy.gemList = {}
            for gemIndex, gem in ipairs(group.gemList) do groupCopy.gemList[gemIndex] = copyTable(gem, true) end
            copied.socketGroupList[index] = groupCopy
          end
        else copied = copyTable(source) end
        copied.id = created.id
        sets[created.id] = copied
        created = copied
      end
      created.title = params.title or 'MCP set'
      table.insert(order, created.id)
      if params.activate ~= false then tab[select](tab, created.id) end
    elseif params.action == 'select' then
      if not selected then return nil, 'set id not found' end
      tab[select](tab, params.id)
    elseif params.action == 'rename' then
      if not selected then return nil, 'set id not found' end
      selected.title = params.title
    elseif params.action == 'delete' then
      if not selected then return nil, 'set id not found' end
      if #order <= 1 then return nil, 'cannot delete the only remaining set' end
      if tab[activeKey] == params.id then
        for _, id in ipairs(order) do
          if id ~= params.id then tab[select](tab, id); break end
        end
      end
      sets[params.id] = nil
      for index, id in ipairs(order) do if id == params.id then table.remove(order, index); break end end
    elseif params.action ~= 'list' then return nil, 'unknown set operation' end
    if params.kind == 'skills' then tab:UpdateSocketGroups() end
    if params.action ~= 'list' then
      tab:AddUndoState()
      build:SyncLoadouts()
      recalc()
    end
    local result = {}
    for _, id in ipairs(order) do result[#result + 1] = { id = id, title = sets[id].title, active = id == tab[activeKey] } end
    return { sets = result, activeId = tab[activeKey] }
  end

  function M.set_weapon_set(params)
    build.itemsTab.activeItemSet.useSecondWeaponSet = params.secondary
    build.itemsTab:PopulateSlots()
    recalc()
    return BuildOps.list_item_sets()
  end

  function M.set_custom_modifiers(params)
    local tab = build.configTab
    tab.configSets[tab.activeConfigSetId].customModsList = params.groups
    tab:AddUndoState()
    recalc()
    return { groups = tab.configSets[tab.activeConfigSetId].customModsList }
  end

  function M.get_editing_options()
    local classes = {}
    for id, class in pairs(build.spec.tree.classes) do
      local ascendancies = {}
      for ascendId, ascend in pairs(class.classes or {}) do
        ascendancies[#ascendancies + 1] = { id = ascendId, name = ascend.name }
      end
      classes[#classes + 1] = { id = id, name = class.name, ascendancies = ascendancies }
    end
    local configOptions = {}
    for _, option in ipairs(LoadModule('Modules/ConfigOptions')) do
      if option.var then configOptions[#configOptions + 1] = {
        var = option.var, type = option.type, label = option.label,
        list = BuildOps.sanitize_for_json(option.list), tooltip = BuildOps.sanitize_for_json(option.tooltip),
      } end
    end
    return { classes = classes, configOptions = configOptions, gemFields = gemFields,
      customModifiers = build.configTab.configSets[build.configTab.activeConfigSetId].customModsList }
  end

  return M
end
