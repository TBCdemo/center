// ... existing code ...
  _createAvailableSlots(sunday, positions, roleSettings) {
    const slots = [];
    const isFirstSunday = sunday.getDate() <= 7;
    
    sessionsToSchedule.forEach((sess) => {
      positions.forEach((p) => {
        // 安全防護：避免 p.name 是 null 或 undefined 導致 .trim() 崩潰
        const roleName = (p.name || '').trim();
        if (!roleName) return;

        const needed = roleSettings[roleName] !== undefined ? roleSettings[roleName] : p.max_people || 0;
        if (needed <= 0) return;
        if (roleName === '主餐' && !isFirstSunday) return;
        
        slots.push({ session: sess, roleName: roleName, posId: p.id, needed: needed, assigned: [] });
      });
    });
    return slots;
  },

  /**
   * 【新增工具函式】計算擁有特定技能(單一崗位)的人員目前平均服事次數
   * 用來防止家庭群組或雙堂服事的人「壟斷」該崗位
   */
  _getSkillAvgUsage(state, members, posId) {
      const capable = members.filter(m => 
          state.memberSkills[m.id] && 
          state.memberSkills[m.id].has(posId) && 
          !['暫停服事', '安息季'].includes(m.availability_status)
      );
      if (capable.length === 0) return 0;
      const total = capable.reduce((sum, m) => sum + (state.totalUsage[m.id] || 0), 0);
      return total / capable.length;
  },

  /**
   * 【新增工具函式】判斷某人在指定日期是否「可以排班」(非暫停、非請假)
   */
  _isAvailableOnDate(m, dateStr) {
// ... existing code ...
  _assignDualService(state, context, members) {
      const activeMembers = members.filter(m => !['暫停服事', '安息季'].includes(m.availability_status));
      const avgUsage = activeMembers.length > 0 
          ? activeMembers.reduce((sum, m) => sum + (state.totalUsage[m.id] || 0), 0) / activeMembers.length 
          : 0;

      const dualMembers = members.filter(m => {
          const p = parseInt(m.dual_service_pref) || 0;
          if (p !== 1 && p !== 2) return false;
          if ((context.dailyAssignments[m.id] || []).length > 0) return false;

          if (state.lastServedWeek[m.id] === context.weekIndex - 1) return false;
          if ((state.totalUsage[m.id] || 0) > avgUsage + 1.5) return false;

          return true;
      });

      dualMembers.sort((a, b) => (state.totalUsage[a.id] || 0) - (state.totalUsage[b.id] || 0));

      for (let m of dualMembers) {
          const p = parseInt(m.dual_service_pref);
          let s1Slots = context.availableSlots.filter(s => s.session === '第一堂' && s.needed > 0);
          
          for (let s1 of s1Slots) {
              if (!this._canAssign(m, s1, state, context, 0)) continue;
              
              // 【防壟斷修正】確保這項指派不會讓該成員在該崗位的服事次數遠高於同技能平均
              if ((state.totalUsage[m.id] || 0) > this._getSkillAvgUsage(state, members, s1.posId) + 1) continue;
              
              let s2 = null;
              const s2Slots = context.availableSlots.filter(s => s.session === '第二堂' && s.needed > 0);
              
              if (p === 1) { 
                  s2 = s2Slots.find(s => s.roleName === s1.roleName && this._canAssign(m, s, state, context, 0) && (state.totalUsage[m.id] || 0) <= this._getSkillAvgUsage(state, members, s.posId) + 1);
              } else if (p === 2) { 
                  s2 = s2Slots.find(s => s.roleName !== s1.roleName && this._canAssign(m, s, state, context, 0) && (state.totalUsage[m.id] || 0) <= this._getSkillAvgUsage(state, members, s.posId) + 1);
              }

              if (s2) {
                  this._assign(m, s1, state, context);
                  this._assign(m, s2, state, context);
                  this._immediateFamilyFill(m, state, context, members);
                  break; 
              }
          }
      }
  },

  _assignFamilyGroups(state, context, members) {
// ... existing code ...
      for (let gid of sortedGroupIds) {
          const gMembers = groups[gid];
          // 【核心修正】如果今天全家只剩 1 個人有空，就不啟動原子綁定，放生他去一般單堂填充區
          if (gMembers.length < 2) continue;

          const isFA = gid.startsWith('FA');

          let placed = false;
          const m0 = gMembers[0];
          
          for (let sess of sessionsToSchedule) {
              for (let role of roleOrder) {
                  const slot0 = context.availableSlots.find(s => s.session === sess && s.roleName === role && s.needed > 0);
                  if (!slot0 || !this._canAssign(m0, slot0, state, context, 0, members)) continue;

                  // 【防壟斷修正】家庭主排：確保家庭不會因為優先進場而壟斷了單一崗位 (讓單一崗位的其他人也有機會)
                  if ((state.totalUsage[m0.id] || 0) > this._getSkillAvgUsage(state, members, slot0.posId) + 1) continue;

                  let allCanBePlaced = true;
                  let plannedSlots = [{ member: m0, slot: slot0 }];
                  let familyRoles = new Set([role]);

                  for (let i = 1; i < gMembers.length; i++) {
                      let m = gMembers[i];
                      let foundSlotForM = false;

                      let targetSessions = [sess, sess === '第一堂' ? '第二堂' : '第一堂'];
                      for (let tSess of targetSessions) {
                          for (let tRole of roleOrder) {
                              if (isFA && !familyRoles.has(tRole)) continue; 

                              const slotN = context.availableSlots.find(s => s.session === tSess && s.roleName === tRole);
                              if (!slotN) continue;
                              
                              const plannedCount = plannedSlots.filter(ps => ps.slot === slotN).length;
                              if (slotN.needed - plannedCount <= 0) continue;

                              if (this._canAssign(m, slotN, state, context, 0, true)) {
                                  // 【防壟斷修正】其他家庭成員也需做防壟斷檢查
                                  if ((state.totalUsage[m.id] || 0) > this._getSkillAvgUsage(state, members, slotN.posId) + 1) continue;

                                  plannedSlots.push({ member: m, slot: slotN });
                                  familyRoles.add(tRole);
                                  foundSlotForM = true;
                                  break;
                              }
                          }
                          if (foundSlotForM) break;
                      }

                      if (!foundSlotForM) {
                          allCanBePlaced = false;
                          break; 
                      }
                  }

                  if (allCanBePlaced) {
// ... existing code ...
