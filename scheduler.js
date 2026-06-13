/**
 * 教會季排班系統 - 核心引擎 (Scheduler Engine V17)
 * 依據 Logic_Analysis.md 實作：
 * 1. L=2 新朋友禁排邏輯 (每月 8-14 號)
 * 2. 嚴格的分數排序演算法 ([權重分, 歷史次數, 技能數量, 隨機/索引])
 * 3. 執行流程：執事 -> 跨堂預排 -> 家庭預排 -> 單堂填充 -> 補位 -> 最終 Refill
 * 4. FA 絕對同日同崗位，FB 同日即可
 * 5. FA/FB 終極防落單替換機制 (依服事次數踢人)
 * 6. 完美平衡：配對預查機制 (Lookahead)，兼顧配對與次數平均。
 * 7. FA/FB 家庭優先進場機制，徹底解決 FB 在第二堂尾聲找不到異崗位而落單的問題。
 * 8. 動態剔除無效家人：若家人請假或暫停服事，另一人不連坐，可獨立正常排班且不亮落單藍燈！
 * 9. 一季三次排班限制
 * 10. 終極防壟斷機制：保護單技能一般人，強制家庭達平均次數即刻退讓。
 */

const sessionsToSchedule = ['第一堂', '第二堂'];
const roleOrder = ['司會', 'PPT', '主餐', '收奉獻', '接待', '新朋友關懷'];

const ScheduleEngine = {
  formatDate(date) {
    const d = new Date(date);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  },

  getSundaysInQuarter(y, q) {
    const sundays = [];
    const startMonth = (q - 1) * 3;
    let d = new Date(y, startMonth, 1);
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    while (d.getMonth() >= startMonth && d.getMonth() < startMonth + 3) {
      sundays.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }
    return sundays;
  },

  // 取得特定職位的所有成員之平均服事次數
  _getSkillAvgUsage(state, members, posId) {
    const skilledMembers = members.filter(m => state.memberSkills[m.id]?.has(posId));
    if (skilledMembers.length === 0) return 0;
    
    const sum = skilledMembers.reduce((acc, m) => acc + (state.totalUsage[m.id] || 0), 0);
    return sum / skilledMembers.length;
  },

  generate(params) {
    const {
      year = new Date().getFullYear(),
      quarter = 1,
      effectiveMembers = [],
      effectiveMemberPositions = [],
      dbData = {},
      roleSettings = {},
    } = params;

    const currentQuarterStr = `${year}-Q${quarter}`;

    // 【修正】深拷貝 members 避免修改原始 Props 導致 Vue/React 狀態崩潰
    const clonedMembers = JSON.parse(JSON.stringify(effectiveMembers));

    clonedMembers.forEach(m => {
        if (dbData.memberQuarterSettings && Array.isArray(dbData.memberQuarterSettings)) {
            const qs = dbData.memberQuarterSettings.find(s => s.member_id === m.id && s.quarter === currentQuarterStr);
            if (qs) {
                if (qs.newcomer_rule !== undefined && qs.newcomer_rule !== null) m.newcomer_rule = qs.newcomer_rule;
                if (qs.dual_service_pref !== undefined && qs.dual_service_pref !== null) m.dual_service_pref = qs.dual_service_pref;
                
                if (qs.availability_status) m.availability_status = qs.availability_status;
            }
        }
        
        // 將一季三次的人強制轉為單堂，保留配額
        if (['一季三次', '一季一次'].includes(m.availability_status)) {
             m.dual_service_pref = 0; 
        }
    });

    const positions = params.positions || dbData.positions || [];
    const sundays = this.getSundaysInQuarter(year, quarter);

    const state = {
      draft: [],
      totalUsage: {},
      roleUsage: {},
      lastServedWeek: {},
      memberSkills: {},
      memberGroups: {}, 
    };

    this._prepareData(state, clonedMembers, effectiveMemberPositions);

    const specialIds = {
      deacon: positions.find((p) => String(p?.name || '').trim() === '執事輪值')?.id,
      mc: positions.find((p) => String(p?.name || '').trim() === '司會')?.id,
      ppt: positions.find((p) => String(p?.name || '').trim() === 'PPT')?.id,
      newcomer: positions.find((p) => String(p?.name || '').trim() === '新朋友關懷')?.id,
    };

    sundays.forEach((sunday, weekIndex) => {
      const context = {
        sunday,
        weekIndex,
        dateStr: this.formatDate(sunday),
        dailyAssignments: {},
        availableSlots: this._createAvailableSlots(sunday, positions, roleSettings),
      };

      this._runSchedulingPipeline(state, context, clonedMembers, specialIds);
    });

    this._applyVisualFlags(state.draft, clonedMembers);
    this._sortFinalDraft(state.draft, clonedMembers);

    return state.draft;
  },

  _prepareData(state, members, memberPositions) {
    members.forEach((m) => {
      state.totalUsage[m.id] = 0;
      state.roleUsage[m.id] = {};
      state.lastServedWeek[m.id] = -99;
      state.memberSkills[m.id] = new Set(
        memberPositions.filter((mp) => mp.member_id === m.id).map((mp) => mp.position_id)
      );
      if (m.group_id) {
          state.memberGroups[m.id] = String(m.group_id);
      }
    });
  },

  _createAvailableSlots(sunday, positions, roleSettings) {
    const slots = [];
    const isFirstSunday = sunday.getDate() <= 7;
    
    sessionsToSchedule.forEach((sess) => {
      positions.forEach((p) => {
        // 安全防護：轉型為字串
        const roleName = String(p.name || '').trim();
        if (!roleName) return;

        const needed = roleSettings[roleName] !== undefined ? roleSettings[roleName] : p.max_people || 0;
        if (needed <= 0) return;
        if (roleName === '主餐' && !isFirstSunday) return;
        
        slots.push({ session: sess, roleName: roleName, posId: p.id, needed: needed, assigned: [] });
      });
    });
    return slots;
  },

  _isAvailableOnDate(m, dateStr) {
      if (['暫停服事', '安息季'].includes(m.availability_status)) return false;
      if (Array.isArray(m.unavailable_dates) && m.unavailable_dates.includes(dateStr)) return false;
      return true;
  },

  _canAssign(m, slot, state, context, strictLevel = 0, skipFamilyCheck = false) {
    const { roleName, session, posId } = slot;
    
    if (!this._isAvailableOnDate(m, context.dateStr)) return false;
    
    if (m.availability_status === '一季一次' && (state.totalUsage[m.id] || 0) >= 1) {
        return false;
    }

    if (m.availability_status === '一季三次' && (state.totalUsage[m.id] || 0) >= 3) {
        return false;
    }

    if (!state.memberSkills[m.id].has(posId)) return false;

    if (roleName === '執事輪值') {
      if ((state.roleUsage[m.id][posId] || 0) >= 4) return false;
    }

    if (roleName === '新朋友關懷') {
      const val = m.newcomer_rule;
      const isRule2or3 = (val === 2 || val === '2' || val === 3 || val === '3');
      if (isRule2or3 && context.sunday.getDate() >= 8 && context.sunday.getDate() <= 14) {
        return false;
      }
    }

    const dayShifts = state.draft.filter((d) => d.service_date === context.dateStr && d.member_id === m.id);
    const dayRoles = dayShifts.map(d => d._positionName);

    if (dayShifts.length >= 2) return false; 

    const dualPref = parseInt(m.dual_service_pref) || 0;

    if (roleName !== '執事輪值') {
        if (dayShifts.length === 1) {
            const firstShift = dayShifts[0];
            if (dualPref === 1) {
                if (firstShift.session === session) return false; 
                if (firstShift._positionName !== roleName) return false; 
            } else if (dualPref === 2) {
                if (firstShift.session === session) return false; 
                if (firstShift._positionName === roleName) return false; 
            } else {
                if (firstShift.session !== session) return false; 
                if (firstShift._positionName === roleName) return false; 
            }
        }

        if (dualPref === 0) {
            const leaderRoles = ['司會', 'PPT'];
            if (leaderRoles.includes(roleName) && dayShifts.length > 0) return false;
            if (dayRoles.some(r => leaderRoles.includes(r))) return false;
        }

        if (dayShifts.length === 0) {
            if (dualPref === 0 && m.preferred_session && m.preferred_session !== '皆可') {
                const prefStr = String(m.preferred_session);
                if (!prefStr.includes(session.replace('堂', ''))) return false;
            }
        }
    }

    if (!skipFamilyCheck) {
        const myGroupId = state.memberGroups[m.id];
        if (myGroupId && (myGroupId.startsWith('FA') || myGroupId.startsWith('FB'))) {
            const assignedFamilyIds = Object.keys(context.dailyAssignments).filter(
                id => id !== m.id && state.memberGroups[id] === myGroupId
            );
            
            if (assignedFamilyIds.length > 0) {
                const familyRoles = new Set();
                assignedFamilyIds.forEach(fid => {
                    context.dailyAssignments[fid].forEach(r => familyRoles.add(r));
                });
                
                if (myGroupId.startsWith('FA')) {
                    if (!familyRoles.has(roleName)) return false;
                } 
            }
        }
    }

    return true;
  },

  _getScore(m, slot, state, context, members) {
    let weight = 0;

    if (['執事輪值', '司會'].includes(slot.roleName)) {
       const currentUsage = state.roleUsage[m.id]?.[slot.posId] || 0;
       if (currentUsage === 0) weight -= 20000;
    }

    const myGroupId = state.memberGroups[m.id];
    if (myGroupId && (myGroupId.startsWith('FA') || myGroupId.startsWith('FB'))) {
       const myShiftsCount = (context.dailyAssignments[m.id] || []).length;
       if (myShiftsCount === 0) {
           const assignedFamilyIds = Object.keys(context.dailyAssignments).filter(
               assignedId => assignedId !== m.id && state.memberGroups[assignedId] === myGroupId
           );
           
           if (assignedFamilyIds.length > 0) {
               const familyRoles = new Set();
               assignedFamilyIds.forEach(fid => context.dailyAssignments[fid].forEach(r => familyRoles.add(r)));
               
               if (myGroupId.startsWith('FA') && familyRoles.has(slot.roleName)) {
                   weight -= 15000; 
               } else if (myGroupId.startsWith('FB')) {
                   weight -= 15000; 
               }
           }
       }
    }

    const dayRoles = context.dailyAssignments[m.id] || [];
    const comboRoles = ['接待', '收奉獻', '主餐', '新朋友關懷'];
    if (dayRoles.length === 1 && comboRoles.includes(slot.roleName) && comboRoles.includes(dayRoles[0])) {
       weight -= 5000;
    }

    if (state.lastServedWeek[m.id] === context.weekIndex - 1) {
       weight += 1000;
    }

    // 【終極防壟斷保護】：保護單一技能的一般人
    const isFamily = myGroupId && (String(myGroupId).startsWith('FA') || String(myGroupId).startsWith('FB'));
    if (!isFamily && state.memberSkills[m.id].size === 1) {
        weight -= 800; // 單技能非家庭者，給予強力優先權，保證他們能搶到班
    }

    // 【終極防壟斷懲罰】：家庭成員若次數已高於該技能平均值，則大幅退讓
    if (isFamily && members) {
        const skillAvg = this._getSkillAvgUsage(state, members, slot.posId);
        if ((state.totalUsage[m.id] || 0) > skillAvg + 0.1) {
            weight += 2000; 
        }
    }

    return [
        weight, 
        state.totalUsage[m.id] || 0, 
        state.memberSkills[m.id].size, 
        Math.random()
    ];
  },

  _compareScore(scoreA, scoreB) {
    for (let i = 0; i < scoreA.length; i++) {
      if (scoreA[i] < scoreB[i]) return -1;
      if (scoreA[i] > scoreB[i]) return 1;
    }
    return 0;
  },

  _runSchedulingPipeline(state, context, members, specialIds) {
    this._assignDeacons(state, context, members, specialIds.deacon);
    this._assignDualService(state, context, members);
    this._assignFamilyGroups(state, context, members);

    sessionsToSchedule.forEach((sess) => {
      roleOrder.forEach(roleName => {
        const slots = context.availableSlots.filter(s => s.session === sess && s.roleName === roleName && s.needed > 0);
        slots.forEach(slot => {
             this._fillSlot(slot, members, state, context, 0);
        });
      });
    });

    this._enforceFO(state, context, members); 
    this._enforceFamily(state, context, members);

    sessionsToSchedule.forEach((sess) => {
      roleOrder.forEach(roleName => {
        const slots = context.availableSlots.filter(s => s.session === sess && s.roleName === roleName && s.needed > 0);
        slots.forEach(slot => {
            this._fillSlot(slot, members, state, context, 1);
        });
      });
    });

    this._fillEmptyWarnings(state, context);
  },

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
              
              // 【防壟斷修正】嚴格限制 + 0.1
              if ((state.totalUsage[m.id] || 0) > this._getSkillAvgUsage(state, members, s1.posId) + 0.1) continue;
              
              let s2 = null;
              const s2Slots = context.availableSlots.filter(s => s.session === '第二堂' && s.needed > 0);
              
              if (p === 1) { 
                  s2 = s2Slots.find(s => s.roleName === s1.roleName && this._canAssign(m, s, state, context, 0) && (state.totalUsage[m.id] || 0) <= this._getSkillAvgUsage(state, members, s.posId) + 0.1);
              } else if (p === 2) { 
                  s2 = s2Slots.find(s => s.roleName !== s1.roleName && this._canAssign(m, s, state, context, 0) && (state.totalUsage[m.id] || 0) <= this._getSkillAvgUsage(state, members, s.posId) + 0.1);
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
      const activeMembers = members.filter(m => !['暫停服事', '安息季'].includes(m.availability_status));
      const avgUsage = activeMembers.length > 0 
          ? activeMembers.reduce((sum, m) => sum + (state.totalUsage[m.id] || 0), 0) / activeMembers.length 
          : 0;

      const groups = {};
      members.forEach(m => {
          const gid = state.memberGroups[m.id];
          if (gid && (gid.startsWith('FA') || gid.startsWith('FB'))) {
              if (state.lastServedWeek[m.id] === context.weekIndex - 1) return;
              if ((state.totalUsage[m.id] || 0) > avgUsage + 1.5) return;
              if ((context.dailyAssignments[m.id] || []).length > 0) return;

              if (this._isAvailableOnDate(m, context.dateStr)) {
                  if (!groups[gid]) groups[gid] = [];
                  groups[gid].push(m);
              }
          }
      });

      const sortedGroupIds = Object.keys(groups).sort((a, b) => {
          const avgA = groups[a].reduce((s, m) => s + (state.totalUsage[m.id] || 0), 0) / groups[a].length;
          const avgB = groups[b].reduce((s, m) => s + (state.totalUsage[m.id] || 0), 0) / groups[b].length;
          return avgA - avgB;
      });

      for (let gid of sortedGroupIds) {
          const gMembers = groups[gid];
          if (gMembers.length < 2) continue;

          const isFA = gid.startsWith('FA');

          let placed = false;
          const m0 = gMembers[0];
          
          for (let sess of sessionsToSchedule) {
              for (let role of roleOrder) {
                  const slot0 = context.availableSlots.find(s => s.session === sess && s.roleName === role && s.needed > 0);
                  if (!slot0 || !this._canAssign(m0, slot0, state, context, 0, members)) continue;

                  // 【防壟斷修正】確保家庭不會因為優先進場而壟斷了單一崗位 (改為嚴格的 + 0.1)
                  if ((state.totalUsage[m0.id] || 0) > this._getSkillAvgUsage(state, members, slot0.posId) + 0.1) continue;

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
                                  // 【防壟斷修正】其他家庭成員也需做防壟斷檢查 (改為嚴格的 + 0.1)
                                  if ((state.totalUsage[m.id] || 0) > this._getSkillAvgUsage(state, members, slotN.posId) + 0.1) continue;

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
                      for (let plan of plannedSlots) {
                          this._assign(plan.member, plan.slot, state, context);
                      }
                      for (let plan of plannedSlots) {
                          this._immediateFOFill(plan.member, state, context, members);
                      }
                      placed = true;
                      break; 
                  }
              }
              if (placed) break; 
          }
      }
  },

  _fillSlot(slot, members, state, context, strictLevel) {
    let limit = 0;
    while (slot.needed > 0 && limit < 20) {
      const eligible = members.filter((m) => this._canAssign(m, slot, state, context, strictLevel));
      if (eligible.length === 0) break;

      // 傳入 members 供 _getScore 進行防壟斷計算
      const scored = eligible.map(m => ({ m, score: this._getScore(m, slot, state, context, members) }));
      scored.sort((a, b) => this._compareScore(a.score, b.score));
      
      const assignedMember = scored[0].m;
      this._assign(assignedMember, slot, state, context);
      
      this._immediateFOFill(assignedMember, state, context, members);
      this._immediateFamilyFill(assignedMember, state, context, members);
      
      limit++;
    }
  },

  _immediateFOFill(baseMember, state, context, members) {
      const pref = parseInt(baseMember.dual_service_pref) || 0;
      if (pref !== 1 && pref !== 2) return;

      const dayShifts = state.draft.filter(d => d.service_date === context.dateStr && d.member_id === baseMember.id);
      if (dayShifts.length >= 2 || dayShifts.some(s => s._positionName === '執事輪值')) return;

      const currentShift = dayShifts[0];
      if (!currentShift) return;

      const targetSession = currentShift.session === '第一堂' ? '第二堂' : '第一堂';
      const targetSlots = context.availableSlots.filter(s => s.session === targetSession && s.needed > 0);

      let targetSlot = null;
      if (pref === 1) { 
          targetSlot = targetSlots.find(s => s.roleName === currentShift._positionName && this._canAssign(baseMember, s, state, context, 0, true));
      } else if (pref === 2) { 
          targetSlot = targetSlots.find(s => s.roleName !== currentShift._positionName && this._canAssign(baseMember, s, state, context, 0, true));
      }

      if (targetSlot) {
          this._assign(baseMember, targetSlot, state, context);
      }
  },

  _immediateFamilyFill(baseMember, state, context, members) {
      const groupId = state.memberGroups[baseMember.id];
      if (!groupId || (!groupId.startsWith('FA') && !groupId.startsWith('FB'))) return;

      const unassignedFamily = members.filter(m => 
          m.id !== baseMember.id && 
          state.memberGroups[m.id] === groupId && 
          this._isAvailableOnDate(m, context.dateStr) &&
          !(context.dailyAssignments[m.id] && context.dailyAssignments[m.id].length > 0)
      );

      if (unassignedFamily.length === 0) return;

      const baseShift = state.draft.find(d => d.service_date === context.dateStr && d.member_id === baseMember.id);
      if (!baseShift) return;
      const targetSession = baseShift.session;

      unassignedFamily.forEach(famMember => {
          let assigned = false;
          
          let availableSlots = context.availableSlots.filter(s => s.session === targetSession && s.needed > 0);
          for (let slot of availableSlots) {
              if (this._canAssign(famMember, slot, state, context, 0, true)) {
                  this._assign(famMember, slot, state, context);
                  this._immediateFOFill(famMember, state, context, members);
                  assigned = true;
                  break;
              }
          }

          if (!assigned) {
              availableSlots = context.availableSlots.filter(s => s.session !== targetSession && s.needed > 0);
              for (let slot of availableSlots) {
                  if (this._canAssign(famMember, slot, state, context, 0, true)) {
                      this._assign(famMember, slot, state, context);
                      this._immediateFOFill(famMember, state, context, members); 
                      break;
                  }
              }
          }
      });
  },

  _assignDeacons(state, context, members, deaconId) {
    if (!deaconId) return;
    const slots = context.availableSlots.filter((s) => s.posId === deaconId);
    if (slots.length === 0) return;
    
    let limit = 0;
    while (slots.some(s => s.needed > 0) && limit < 10) {
      const eligible = members.filter((m) => {
        const currentUsage = state.roleUsage[m.id]?.[deaconId] || 0;
        const neededSlots = slots.filter(s => s.needed > 0);
        if (currentUsage + neededSlots.length > 4) return false; 
        
        return neededSlots.every(s => this._canAssign(m, s, state, context, 0, true));
      });
      
      if (eligible.length === 0) break;
      
      // 傳入 members 供 _getScore 進行防壟斷計算
      const scored = eligible.map(m => ({ m, score: this._getScore(m, slots[0], state, context, members) }));
      scored.sort((a, b) => this._compareScore(a.score, b.score));
      const best = scored[0].m;
      
      slots.filter(s => s.needed > 0).forEach(s => this._assign(best, s, state, context));
      this._immediateFamilyFill(best, state, context, members);
      limit++;
    }
  },

  _enforceFO(state, context, members) {
    const todayShifts = state.draft.filter(d => d.service_date === context.dateStr);
    const assignedIds = [...new Set(todayShifts.map(d => d.member_id))];

    assignedIds.forEach(mId => {
       const m = members.find(x => x.id === mId);
       if (!m) return;
       const pref = parseInt(m.dual_service_pref);
       if (pref !== 1 && pref !== 2) return; 

       const myShifts = todayShifts.filter(d => d.member_id === m.id);
       if (myShifts.length >= 2 || myShifts.some(s => s._positionName === '執事輪值')) return;

       const currentShift = myShifts[0];
       const targetSession = currentShift.session === '第一堂' ? '第二堂' : '第一堂';
       const targetSlots = context.availableSlots.filter(s => s.session === targetSession && s.needed > 0);

       let targetSlot = null;
       if (pref === 1) { 
         targetSlot = targetSlots.find(s => s.roleName === currentShift._positionName && this._canAssign(m, s, state, context, 0, true));
       } else if (pref === 2) { 
         targetSlot = targetSlots.find(s => s.roleName !== currentShift._positionName && this._canAssign(m, s, state, context, 0, true));
       }

       if (targetSlot) {
         this._assign(m, targetSlot, state, context);
       }
    });
  },

  _enforceFamily(state, context, members) {
    const groups = {};
    members.forEach(m => {
      if (m.group_id && (m.group_id.startsWith('FA') || m.group_id.startsWith('FB'))) {
        if (this._isAvailableOnDate(m, context.dateStr)) {
            if (!groups[m.group_id]) groups[m.group_id] = [];
            groups[m.group_id].push(m);
        }
      }
    });

    const sortedGroupIds = Object.keys(groups).sort((a, b) => {
        const avgA = groups[a].reduce((s, m) => s + (state.totalUsage[m.id] || 0), 0) / groups[a].length;
        const avgB = groups[b].reduce((s, m) => s + (state.totalUsage[m.id] || 0), 0) / groups[b].length;
        return avgA - avgB;
    });

    sortedGroupIds.forEach(gid => {
      const gMembers = groups[gid];
      if (gMembers.length < 2) return;

      const assignedMembers = gMembers.filter(m => context.dailyAssignments[m.id]);
      const unassignedMembers = gMembers.filter(m => !context.dailyAssignments[m.id]);

      if (assignedMembers.length > 0 && unassignedMembers.length > 0) {
         const targetSession = state.draft.find(d => d.service_date === context.dateStr && d.member_id === assignedMembers[0].id)?.session;
         if (!targetSession) return;

         unassignedMembers.sort((a, b) => (state.totalUsage[a.id] || 0) - (state.totalUsage[b.id] || 0));

         let currentAssignedCount = assignedMembers.length;

         unassignedMembers.forEach(unM => {
            let assigned = false;
            
            const targetSlots = context.availableSlots.filter(s => s.session === targetSession && s.needed > 0);
            for (let s of targetSlots) {
               if (this._canAssign(unM, s, state, context, 0, true)) {
                  this._assign(unM, s, state, context);
                  assigned = true;
                  break;
               }
            }

            if (!assigned) {
                const otherSlots = context.availableSlots.filter(s => s.session !== targetSession && s.needed > 0);
                for (let s of otherSlots) {
                   if (this._canAssign(unM, s, state, context, 0, true)) {
                      this._assign(unM, s, state, context);
                      assigned = true;
                      break;
                   }
                }
            }

            if (assigned) {
                currentAssignedCount++;
            }

            if (!assigned) {
                if (currentAssignedCount >= 2) {
                    return; 
                } else {
                    this._forceSwapForFamily(unM, assignedMembers[0], state, context, members);
                    currentAssignedCount++; 
                }
            }
         });
      }
    });
  },

  _forceSwapForFamily(unM, baseMember, state, context, members) {
      const todayShifts = state.draft.filter(d => 
          d.service_date === context.dateStr && 
          !d.is_empty && 
          d.member_id !== unM.id && 
          d.member_id !== baseMember.id
      );
      
      let bestSwap = null;
      let bestScore = -9999;

      for (let shift of todayShifts) {
          // 修復錯字，避免出錯
          if (shift._positionName === '執事輪值') continue;

          const mockSlot = { roleName: shift._positionName, session: shift.session, posId: shift.position_id };
          if (!this._canAssign(unM, mockSlot, state, context, 0, true)) continue;

          const victim = members.find(m => m.id === shift.member_id);
          if (!victim) continue;

          const victimGroupId = state.memberGroups[victim.id];
          if (victimGroupId && (victimGroupId.startsWith('FA') || victimGroupId.startsWith('FB'))) continue;

          const victimUsage = state.totalUsage[victim.id] || 0;
          const unMUsage = state.totalUsage[unM.id] || 0;
          const score = victimUsage - unMUsage;

          if (score > bestScore) {
              bestScore = score;
              bestSwap = { shift, victim, mockSlot };
          }
      }

      if (bestSwap) {
          this._replaceAssignment(unM, bestSwap.victim.id, bestSwap.shift.temp_id, bestSwap.mockSlot, state, context);
      }
  },

  _replaceAssignment(newMember, oldMemberId, targetTempId, slotInfo, state, context) {
      const draftIdx = state.draft.findIndex(d => d.temp_id === targetTempId);
      if (draftIdx === -1) return;

      state.totalUsage[oldMemberId] = Math.max(0, state.totalUsage[oldMemberId] - 1);
      if (state.roleUsage[oldMemberId][slotInfo.posId]) {
          state.roleUsage[oldMemberId][slotInfo.posId]--;
      }
      const dailyIdx = context.dailyAssignments[oldMemberId].indexOf(slotInfo.roleName);
      if (dailyIdx > -1) context.dailyAssignments[oldMemberId].splice(dailyIdx, 1);

      state.totalUsage[newMember.id] = (state.totalUsage[newMember.id] || 0) + 1;
      state.roleUsage[newMember.id][slotInfo.posId] = (state.roleUsage[newMember.id][slotInfo.posId] || 0) + 1;
      state.lastServedWeek[newMember.id] = context.weekIndex;
      if (!context.dailyAssignments[newMember.id]) context.dailyAssignments[newMember.id] = [];
      context.dailyAssignments[newMember.id].push(slotInfo.roleName);

      state.draft[draftIdx].member_id = newMember.id;
      state.draft[draftIdx]._memberName = newMember.name;
      state.draft[draftIdx].is_emergency = 2; 
  },

  _assign(m, slot, state, context, isEmergency = 0) {
    slot.assigned.push(m);
    slot.needed--;
    state.totalUsage[m.id]++;
    state.roleUsage[m.id][slot.posId] = (state.roleUsage[m.id][slot.posId] || 0) + 1;
    state.lastServedWeek[m.id] = context.weekIndex;
    
    if (!context.dailyAssignments[m.id]) context.dailyAssignments[m.id] = [];
    context.dailyAssignments[m.id].push(slot.roleName);

    state.draft.push({
      temp_id: `T_${context.dateStr}_${slot.session}_${slot.posId}_${Math.random()}`,
      service_date: context.dateStr, 
      session: slot.session, 
      member_id: m.id, 
      position_id: slot.posId,
      _memberName: m.name, 
      _positionName: slot.roleName, 
      is_emergency: isEmergency
    });
  },

  _fillEmptyWarnings(state, context) {
    context.availableSlots.forEach((slot) => {
      while (slot.needed > 0) {
        state.draft.push({
          temp_id: `EMPTY_${context.dateStr}_${slot.session}_${slot.posId}_${Math.random()}`,
          service_date: context.dateStr, 
          session: slot.session, 
          member_id: 'EMPTY_SLOT', 
          position_id: slot.posId,
          _memberName: '⚠️ 需手動指派', 
          _positionName: slot.roleName, 
          is_empty: true
        });
        slot.needed--;
      }
    });
  },

  _applyVisualFlags(draft, members) {
    const memberGroups = {};
    members.forEach(m => {
      if (m.group_id) memberGroups[m.id] = String(m.group_id);
    });

    const shiftsByDate = {};
    draft.forEach(d => {
      if (d.is_empty) return;
      if (!shiftsByDate[d.service_date]) shiftsByDate[d.service_date] = [];
      shiftsByDate[d.service_date].push(d);
    });

    Object.keys(shiftsByDate).forEach(dateStr => {
      const dayShifts = shiftsByDate[dateStr];
      const freq = {};
      const groupFreq = {};
      const groupActiveMembersCount = {};

      dayShifts.forEach(d => {
        freq[d.member_id] = (freq[d.member_id] || 0) + 1;
        
        const gid = memberGroups[d.member_id];
        if (gid && (gid.startsWith('FA') || gid.startsWith('FB'))) {
          if (!groupFreq[gid]) groupFreq[gid] = new Set();
          groupFreq[gid].add(d.member_id);
          
          if (!groupActiveMembersCount[gid]) {
              groupActiveMembersCount[gid] = members.filter(m => 
                  memberGroups[m.id] === gid && this._isAvailableOnDate(m, dateStr)
              ).length;
          }
        }
      });

      dayShifts.forEach(d => {
        if (freq[d.member_id] >= 2) {
          d.is_duplicate = true;
        }

        const gid = memberGroups[d.member_id];
        if (gid && groupFreq[gid]) {
            const activeCount = groupActiveMembersCount[gid] || 0;
            if (activeCount > 1 && groupFreq[gid].size < 2) {
                d.is_lonely_family = true;
            }
        }
      });
    });
  },

  _sortFinalDraft(draft, members) {
    const getRule = (m) => {
        if (!m || m.newcomer_rule == null) return 0;
        const val = m.newcomer_rule;
        if (val === 1 || val === '1') return 1;
        if (val === 2 || val === '2') return 2;
        if (val === 3 || val === '3') return 3;
        return 0;
    };

    draft.sort((a, b) => {
      if (a.service_date !== b.service_date) return a.service_date.localeCompare(b.service_date);
      if (a.session !== b.session) return a.session === '第一堂' ? -1 : 1;
      if (a._positionName !== b._positionName) return a._positionName.localeCompare(b._positionName);

      if (a._positionName === '新朋友關懷') {
         const memA = members.find(m => m.id === a.member_id);
         const memB = members.find(m => m.id === b.member_id);
         
         const ruleA = getRule(memA);
         const ruleB = getRule(memB);
         
         const prioA = (ruleA === 1 || ruleA === 3) ? 1 : 0;
         const prioB = (ruleB === 1 || ruleB === 3) ? 1 : 0;
         
         if (prioA !== prioB) return prioB - prioA; 

         if (a.is_empty !== b.is_empty) return a.is_empty ? 1 : -1;
         if (!a.is_empty && !b.is_empty) return (a._memberName || '').localeCompare(b._memberName || '');
      }

      if (a.is_empty !== b.is_empty) return a.is_empty ? 1 : -1;

      return 0;
    });
  },
};

if (typeof window !== 'undefined') {
  window.ScheduleEngine = ScheduleEngine;
} else if (typeof module !== 'undefined') {
  module.exports = ScheduleEngine;
}
