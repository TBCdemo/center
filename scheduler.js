/**
 * 教會季排班系統 - 核心引擎 (Scheduler Engine V23 - 終極雙堂預查與天花板解除版)
 * 修正重點：
 * 1. 解除執事輪值硬性 4 次上限：移除 _canAssign 與 _assignDeacons 中的次數阻擋，交由 _getScore 自然平均，解決季末人工指派爆炸。
 * 2. 解除 +0.1 嚴格平均卡控：釋放跨堂與群組同工的排班彈性，解決 0 班次未排問題。
 * 3. 雙堂同崗強制預查 (Lookahead)：dual_service_pref=1 者，若另一堂無相同崗位空缺，直接拒絕單堂排班，100% 保證成雙同崗。
 */

const sessionsToSchedule = ['第一堂', '第二堂'];
const concurrentRoles = ['主餐', '接待', '收奉獻', '新朋友關懷'];
const exclusiveRoles = ['司會', 'PPT', '執事輪值'];

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
    const clonedMembers = JSON.parse(JSON.stringify(effectiveMembers));
    const sundays = this.getSundaysInQuarter(year, quarter);

    clonedMembers.forEach(m => {
        let unDates = Array.isArray(m.unavailable_dates) ? [...m.unavailable_dates] : [];

        if (dbData.memberQuarterSettings && Array.isArray(dbData.memberQuarterSettings)) {
            const qs = dbData.memberQuarterSettings.find(s => s.member_id === m.id && s.quarter === currentQuarterStr);
            if (qs) {
                if (qs.newcomer_rule !== undefined && qs.newcomer_rule !== null) m.newcomer_rule = qs.newcomer_rule;
                if (qs.dual_service_pref !== undefined && qs.dual_service_pref !== null) m.dual_service_pref = qs.dual_service_pref;
                if (qs.availability_status) m.availability_status = qs.availability_status;

                if (qs.unavailable_dates) {
                    const parsedQsDates = typeof qs.unavailable_dates === 'string' ? JSON.parse(qs.unavailable_dates) : qs.unavailable_dates;
                    if (Array.isArray(parsedQsDates)) {
                        parsedQsDates.forEach(d => { if (!unDates.includes(d)) unDates.push(d); });
                    }
                }

                const unavailableWeeks = qs.unavailable_weeks ? (typeof qs.unavailable_weeks === 'string' ? JSON.parse(qs.unavailable_weeks) : qs.unavailable_weeks) : [];
                if (Array.isArray(unavailableWeeks) && unavailableWeeks.length > 0) {
                    sundays.forEach(sunday => {
                        const weekNum = Math.ceil(sunday.getDate() / 7);
                        const dateStr = this.formatDate(sunday);
                        if (unavailableWeeks.includes(weekNum) && !unDates.includes(dateStr)) {
                            unDates.push(dateStr);
                        }
                    });
                }
            }
        }
        m.unavailable_dates = unDates.sort();
        if (['一季三次', '一季一次'].includes(m.availability_status)) {
             m.dual_service_pref = 0; 
        }
    });

    const positions = params.positions || dbData.positions || [];
    const state = {
      draft: [], totalUsage: {}, roleUsage: {}, lastServedWeek: {}, servingHistory: {}, 
      memberSkills: {}, memberGroups: {}, totalWeeks: sundays.length
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
        sunday, weekIndex, dateStr: this.formatDate(sunday),
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
    state.membersList = members; 
    members.forEach((m) => {
      state.totalUsage[m.id] = 0;
      state.roleUsage[m.id] = {};
      state.lastServedWeek[m.id] = -99;
      state.servingHistory[m.id] = []; 
      state.memberSkills[m.id] = new Set(
        memberPositions.filter((mp) => mp.member_id === m.id).map((mp) => mp.position_id)
      );
      if (m.group_id) state.memberGroups[m.id] = String(m.group_id);
    });
  },

  _createAvailableSlots(sunday, positions, roleSettings) {
    const slots = [];
    const isFirstSunday = sunday.getDate() <= 7;
    
    sessionsToSchedule.forEach((sess) => {
      positions.forEach((p) => {
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
    if (m.availability_status === '一季一次' && (state.totalUsage[m.id] || 0) >= 1) return false;
    if (m.availability_status === '一季三次' && (state.totalUsage[m.id] || 0) >= 3) return false;
    if (!state.memberSkills[m.id].has(posId)) return false;

    // V23 修正：已移除「執事輪值」的 4 次硬性上限阻擋，徹底消滅季末人工指派爆炸

    const dayShifts = state.draft.filter((d) => d.service_date === context.dateStr && d.member_id === m.id);
    const dayRoles = dayShifts.map(d => d._positionName);

    // 專兼任防呆隔離
    const isExclusive = exclusiveRoles.includes(roleName);
    const hasExclusive = dayRoles.some(r => exclusiveRoles.includes(r));
    const hasConcurrent = dayRoles.some(r => !exclusiveRoles.includes(r));
    
    if (isExclusive && hasConcurrent) return false;
    if (!isExclusive && hasExclusive) return false;
    if (dayShifts.length >= 2) return false; 

    // --- V23 終極跨堂與同堂邏輯預查 (Lookahead) ---
    const dualPref = parseInt(m.dual_service_pref) || 0;

    if (!isExclusive) { // 專任(執事/PPT等)允許連排，不在此限
        if (dayShifts.length === 1) {
            const firstShift = dayShifts[0];
            if (dualPref === 1) { // 跨堂同崗
                if (firstShift.session === session) return false;
                if (firstShift._positionName !== roleName) return false;
            } else if (dualPref === 2) { // 跨堂異崗
                if (firstShift.session === session) return false;
                if (firstShift._positionName === roleName) return false;
            } else { // 單堂兼任
                if (firstShift.session !== session) return false;
                if (firstShift._positionName === roleName) return false;
            }
        } else if (dayShifts.length === 0) {
            // ⭐ 強制成雙預查機制：第一班車若無成對空缺，直接拒載！
            if (dualPref === 1) {
                const otherSession = session === '第一堂' ? '第二堂' : '第一堂';
                const hasPair = context.availableSlots.some(s => s.session === otherSession && s.roleName === roleName && s.needed > 0);
                if (!hasPair) return false; // 沒同崗位空缺，直接擋掉
            } else if (dualPref === 2) {
                const otherSession = session === '第一堂' ? '第二堂' : '第一堂';
                const hasPair = context.availableSlots.some(s => s.session === otherSession && s.roleName !== roleName && s.needed > 0 && state.memberSkills[m.id].has(s.posId));
                if (!hasPair) return false; // 沒異崗位空缺，直接擋掉
            } else {
                // 單堂兼任檢查偏好
                if (m.preferred_session && m.preferred_session !== '皆可') {
                    const prefStr = String(m.preferred_session);
                    if (!prefStr.includes(session.replace('堂', ''))) return false;
                }
            }
        }
    }

    // 群組同進退檢核
    if (!skipFamilyCheck) {
        const myGroupId = state.memberGroups[m.id];
        if (myGroupId && (myGroupId.startsWith('FA') || myGroupId.startsWith('FB'))) {
            const assignedFamilyIds = Object.keys(context.dailyAssignments).filter(id => id !== m.id && state.memberGroups[id] === myGroupId);
            if (assignedFamilyIds.length > 0) {
                const familyRoles = new Set();
                assignedFamilyIds.forEach(fid => context.dailyAssignments[fid].forEach(r => familyRoles.add(r)));
                if (myGroupId.startsWith('FA') && !familyRoles.has(roleName)) return false;
            }

            if (myGroupId.startsWith('FA') && concurrentRoles.includes(roleName)) {
                const unassignedFamilyIds = Object.keys(state.memberGroups).filter(fid => {
                    if (fid === m.id || state.memberGroups[fid] !== myGroupId) return false;
                    if (context.dailyAssignments[fid] && context.dailyAssignments[fid].includes(roleName)) return false;
                    const famMember = state.membersList.find(mem => mem.id === fid);
                    if (famMember && ['暫停服事', '安息季'].includes(famMember.availability_status)) return false; 
                    return true;
                });
                
                if (slot.needed < (unassignedFamilyIds.length + 1)) return false;

                for (let fid of unassignedFamilyIds) {
                    const famMember = state.membersList.find(mem => mem.id === fid);
                    if (!famMember || !this._isAvailableOnDate(famMember, context.dateStr) || !state.memberSkills[fid]?.has(posId)) return false; 
                    const famUsage = state.totalUsage[fid] || 0;
                    if (famMember.availability_status === '一季一次' && famUsage >= 1) return false;
                    if (famMember.availability_status === '一季三次' && famUsage >= 3) return false;
                    const famDayShifts = state.draft.filter((d) => d.service_date === context.dateStr && d.member_id === fid);
                    if (famDayShifts.length >= 2) return false;
                }
            }
        }
    }

    return true;
  },

  _getScore(m, slot, state, context, members) {
    let effectiveUsage = state.totalUsage[m.id] || 0;
    let weight = 0;

    const history = state.servingHistory[m.id] || [];
    if (history.includes(context.weekIndex - 1) && history.includes(context.weekIndex - 2)) {
        effectiveUsage += 3; // 連續服事軟性勸阻
    }

    const dayShifts = state.draft.filter(d => d.service_date === context.dateStr && d.member_id === m.id);
    const dualPref = parseInt(m.dual_service_pref) || 0;
    
    // Combo Bonus 保護第二班次絕對優先
    if (dayShifts.length === 1) {
        const firstShift = dayShifts[0];
        if (dualPref === 1 && firstShift.session !== slot.session && firstShift._positionName === slot.roleName) {
            effectiveUsage -= 2; 
        } else if (dualPref === 2 && firstShift.session !== slot.session && firstShift._positionName !== slot.roleName) {
            effectiveUsage -= 2; 
        } else if (dualPref === 0 && firstShift.session === slot.session && firstShift._positionName !== slot.roleName) {
            effectiveUsage -= 2; 
        }
    }

    if (exclusiveRoles.includes(slot.roleName)) {
       if ((state.roleUsage[m.id]?.[slot.posId] || 0) === 0) weight -= 2; 
    }

    const myGroupId = state.memberGroups[m.id];
    if (myGroupId && (myGroupId.startsWith('FA') || myGroupId.startsWith('FB'))) {
       const myShiftsCount = (context.dailyAssignments[m.id] || []).length;
       if (myShiftsCount === 0) {
           const assignedFamilyIds = Object.keys(context.dailyAssignments).filter(assignedId => assignedId !== m.id && state.memberGroups[assignedId] === myGroupId);
           if (assignedFamilyIds.length > 0) {
               const familyRoles = new Set();
               assignedFamilyIds.forEach(fid => context.dailyAssignments[fid].forEach(r => familyRoles.add(r)));
               if (myGroupId.startsWith('FA') && familyRoles.has(slot.roleName)) weight -= 1.5; 
               else if (myGroupId.startsWith('FB')) weight -= 1.5; 
           }
       }
    }

    return [effectiveUsage, weight, state.memberSkills[m.id].size, Math.random()];
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
    
    ['司會', 'PPT'].forEach(roleName => {
        const slots = context.availableSlots.filter(s => s.roleName === roleName && s.needed > 0);
        slots.forEach(slot => this._fillSlot(slot, members, state, context, 0));
    });

    this._assignLimitedMembers(state, context, members);
    this._assignDualService(state, context, members);
    this._assignFamilyGroups(state, context, members, specialIds); 
    this._assignConcurrentRolesDynamic(state, context, members, 0);

    this._enforceFO(state, context, members); 
    this._enforceFamily(state, context, members);

    this._assignConcurrentRolesDynamic(state, context, members, 1);
    this._fillEmptyWarnings(state, context);
  },

  _assignLimitedMembers(state, context, members) {
      const remainingWeeks = state.totalWeeks - context.weekIndex;
      if (remainingWeeks <= 0) return;

      members.forEach(m => {
          let targetCount = 0;
          if (m.availability_status === '一季一次') targetCount = 1;
          if (m.availability_status === '一季三次') targetCount = 3;
          if (targetCount === 0) return;

          const needed = targetCount - (state.totalUsage[m.id] || 0);
          if (needed <= 0) return;

          if (Math.random() < (needed / remainingWeeks)) {
              const availableConcurrentSlots = context.availableSlots.filter(s => s.needed > 0 && concurrentRoles.includes(s.roleName) && this._canAssign(m, s, state, context, 0));
              if (availableConcurrentSlots.length > 0) {
                  availableConcurrentSlots.sort((a, b) => members.filter(x => this._canAssign(x, a, state, context, 0, true)).length - members.filter(x => this._canAssign(x, b, state, context, 0, true)).length);
                  this._assign(m, availableConcurrentSlots[0], state, context);
              }
          }
      });
  },

  _assignConcurrentRolesDynamic(state, context, members, strictLevel) {
      let limit = 0;
      while (limit < 100) {
          const pendingSlots = context.availableSlots.filter(s => s.needed > 0 && concurrentRoles.includes(s.roleName));
          if (pendingSlots.length === 0) break;

          let anyAssigned = false;
          pendingSlots.forEach(slot => slot._scarcityScore = members.filter(m => this._canAssign(m, slot, state, context, strictLevel)).length);
          pendingSlots.sort((a, b) => a._scarcityScore - b._scarcityScore);
          
          for (let targetSlot of pendingSlots) {
              const eligibleMembers = members.filter(m => this._canAssign(m, targetSlot, state, context, strictLevel));
              if (eligibleMembers.length > 0) {
                  const scored = eligibleMembers.map(m => ({ m, score: this._getScore(m, targetSlot, state, context, members) }));
                  scored.sort((a, b) => this._compareScore(a.score, b.score));
                  
                  const assignedMember = scored[0].m;
                  this._assign(assignedMember, targetSlot, state, context);
                  this._immediateFOFill(assignedMember, state, context, members);
                  this._immediateFamilyFill(assignedMember, state, context, members);
                  anyAssigned = true;
                  break; 
              }
          }
          if (!anyAssigned) break; 
          limit++;
      }
  },

  _fillSlot(slot, members, state, context, strictLevel) {
    let limit = 0;
    while (slot.needed > 0 && limit < 20) {
      const eligible = members.filter((m) => this._canAssign(m, slot, state, context, strictLevel));
      if (eligible.length === 0) break;

      const scored = eligible.map(m => ({ m, score: this._getScore(m, slot, state, context, members) }));
      scored.sort((a, b) => this._compareScore(a.score, b.score));
      
      this._assign(scored[0].m, slot, state, context);
      this._immediateFOFill(scored[0].m, state, context, members);
      this._immediateFamilyFill(scored[0].m, state, context, members);
      limit++;
    }
  },

  _assignDualService(state, context, members) {
      // V23 修正：拔除嚴苛的平均值卡控，只要是跨堂同工且當天沒班就納入候選，由 _getScore 排序
      const dualMembers = members.filter(m => {
          const p = parseInt(m.dual_service_pref) || 0;
          if (p !== 1 && p !== 2) return false;
          if ((context.dailyAssignments[m.id] || []).length > 0) return false;
          return true;
      });

      dualMembers.sort((a, b) => (state.totalUsage[a.id] || 0) - (state.totalUsage[b.id] || 0));

      for (let m of dualMembers) {
          const p = parseInt(m.dual_service_pref);
          let s1Slots = context.availableSlots.filter(s => s.session === '第一堂' && s.needed > 0);
          
          for (let s1 of s1Slots) {
              if (!this._canAssign(m, s1, state, context, 0)) continue;
              
              let s2 = null;
              const s2Slots = context.availableSlots.filter(s => s.session === '第二堂' && s.needed > 0);
              
              if (p === 1) s2 = s2Slots.find(s => s.roleName === s1.roleName && this._canAssign(m, s, state, context, 0));
              else if (p === 2) s2 = s2Slots.find(s => s.roleName !== s1.roleName && this._canAssign(m, s, state, context, 0));

              if (s2) {
                  this._assign(m, s1, state, context);
                  this._assign(m, s2, state, context);
                  this._immediateFamilyFill(m, state, context, members);
                  break; 
              }
          }
      }
  },

  _assignFamilyGroups(state, context, members, specialIds) {
      const groups = {};
      members.forEach(m => {
          const gid = state.memberGroups[m.id];
          if (gid && (gid.startsWith('FA') || gid.startsWith('FB'))) {
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

          gMembers.sort((a, b) => {
              const aCore = (specialIds && (state.memberSkills[a.id]?.has(specialIds.mc) || state.memberSkills[a.id]?.has(specialIds.ppt) || state.memberSkills[a.id]?.has(specialIds.deacon))) ? 1 : 0;
              const bCore = (specialIds && (state.memberSkills[b.id]?.has(specialIds.mc) || state.memberSkills[b.id]?.has(specialIds.ppt) || state.memberSkills[b.id]?.has(specialIds.deacon))) ? 1 : 0;
              return bCore - aCore;
          });

          const isFA = gid.startsWith('FA');
          let placed = false;
          const m0 = gMembers[0];
          
          for (let sess of sessionsToSchedule) {
              for (let role of concurrentRoles) {
                  const slot0 = context.availableSlots.find(s => s.session === sess && s.roleName === role && s.needed > 0);
                  if (!slot0 || !this._canAssign(m0, slot0, state, context, 0, members)) continue;

                  let allCanBePlaced = true;
                  let plannedSlots = [{ member: m0, slot: slot0 }];
                  let familyRoles = new Set([role]);

                  for (let i = 1; i < gMembers.length; i++) {
                      let m = gMembers[i];
                      let foundSlotForM = false;

                      let targetSessions = [sess, sess === '第一堂' ? '第二堂' : '第一堂'];
                      for (let tSess of targetSessions) {
                          for (let tRole of concurrentRoles) {
                              if (isFA && !familyRoles.has(tRole)) continue; 

                              const slotN = context.availableSlots.find(s => s.session === tSess && s.roleName === tRole);
                              if (!slotN) continue;
                              
                              const plannedCount = plannedSlots.filter(ps => ps.slot === slotN).length;
                              if (slotN.needed - plannedCount <= 0) continue;

                              if (this._canAssign(m, slotN, state, context, 0, true)) {
                                  plannedSlots.push({ member: m, slot: slotN });
                                  familyRoles.add(tRole);
                                  foundSlotForM = true;
                                  break;
                              }
                          }
                          if (foundSlotForM) break;
                      }
                      if (!foundSlotForM) { allCanBePlaced = false; break; }
                  }

                  if (allCanBePlaced) {
                      for (let plan of plannedSlots) this._assign(plan.member, plan.slot, state, context);
                      for (let plan of plannedSlots) this._immediateFOFill(plan.member, state, context, members);
                      placed = true;
                      break; 
                  }
              }
              if (placed) break; 
          }
      }
  },

  _immediateFOFill(baseMember, state, context, members) {
      const pref = parseInt(baseMember.dual_service_pref) || 0;
      if (pref !== 1 && pref !== 2) return;

      const dayShifts = state.draft.filter(d => d.service_date === context.dateStr && d.member_id === baseMember.id);
      if (dayShifts.length >= 2) return;

      const currentShift = dayShifts[0];
      if (!currentShift) return;

      const targetSession = currentShift.session === '第一堂' ? '第二堂' : '第一堂';
      const targetSlots = context.availableSlots.filter(s => s.session === targetSession && s.needed > 0);

      let targetSlot = null;
      if (pref === 1) targetSlot = targetSlots.find(s => s.roleName === currentShift._positionName && this._canAssign(baseMember, s, state, context, 0, true));
      else if (pref === 2) targetSlot = targetSlots.find(s => s.roleName !== currentShift._positionName && this._canAssign(baseMember, s, state, context, 0, true));

      if (targetSlot) this._assign(baseMember, targetSlot, state, context);
  },

  _immediateFamilyFill(baseMember, state, context, members) {
      const groupId = state.memberGroups[baseMember.id];
      if (!groupId || (!groupId.startsWith('FA') && !groupId.startsWith('FB'))) return;

      const baseShift = state.draft.find(d => d.service_date === context.dateStr && d.member_id === baseMember.id);
      if (!baseShift) return;
      const targetSession = baseShift.session;
      const targetRole = baseShift._positionName;

      if (exclusiveRoles.includes(targetRole)) return;

      const unassignedFamily = members.filter(m => m.id !== baseMember.id && state.memberGroups[m.id] === groupId && this._isAvailableOnDate(m, context.dateStr) && !(context.dailyAssignments[m.id] && context.dailyAssignments[m.id].length > 0));
      if (unassignedFamily.length === 0) return;

      unassignedFamily.forEach(famMember => {
          let assigned = false;
          let availableSlots = context.availableSlots.filter(s => s.session === targetSession && s.needed > 0 && concurrentRoles.includes(s.roleName));
          
          for (let slot of availableSlots) {
              if (groupId.startsWith('FA') && slot.roleName !== targetRole) continue;
              if (this._canAssign(famMember, slot, state, context, 0, false)) {
                  this._assign(famMember, slot, state, context);
                  this._immediateFOFill(famMember, state, context, members);
                  assigned = true;
                  break;
              }
          }

          if (!assigned) {
              availableSlots = context.availableSlots.filter(s => s.session !== targetSession && s.needed > 0 && concurrentRoles.includes(s.roleName));
              for (let slot of availableSlots) {
                  if (groupId.startsWith('FA') && slot.roleName !== targetRole) continue;
                  if (this._canAssign(famMember, slot, state, context, 0, false)) {
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
    // V23 修正：已拔除 limit 4 的限制條件，由 _getScore 接管次數平衡
    while (slots.some(s => s.needed > 0) && limit < 10) {
      const eligible = members.filter((m) => {
        const neededSlots = slots.filter(s => s.needed > 0);
        return neededSlots.every(s => this._canAssign(m, s, state, context, 0, true));
      });
      
      if (eligible.length === 0) break;
      const scored = eligible.map(m => ({ m, score: this._getScore(m, slots[0], state, context, members) }));
      scored.sort((a, b) => this._compareScore(a.score, b.score));
      
      slots.filter(s => s.needed > 0).forEach(s => this._assign(scored[0].m, s, state, context));
      this._immediateFamilyFill(scored[0].m, state, context, members);
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
       if (myShifts.length >= 2) return;

       const currentShift = myShifts[0];
       const targetSession = currentShift.session === '第一堂' ? '第二堂' : '第一堂';
       const targetSlots = context.availableSlots.filter(s => s.session === targetSession && s.needed > 0);

       let targetSlot = null;
       if (pref === 1) targetSlot = targetSlots.find(s => s.roleName === currentShift._positionName && this._canAssign(m, s, state, context, 0, true));
       else if (pref === 2) targetSlot = targetSlots.find(s => s.roleName !== currentShift._positionName && this._canAssign(m, s, state, context, 0, true));

       if (targetSlot) this._assign(m, targetSlot, state, context);
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
         const aRoles = context.dailyAssignments[assignedMembers[0].id] || [];
         if (aRoles.some(r => exclusiveRoles.includes(r))) return; 

         const targetSession = state.draft.find(d => d.service_date === context.dateStr && d.member_id === assignedMembers[0].id)?.session;
         if (!targetSession) return;

         unassignedMembers.sort((a, b) => (state.totalUsage[a.id] || 0) - (state.totalUsage[b.id] || 0));
         let currentAssignedCount = assignedMembers.length;

         unassignedMembers.forEach(unM => {
            let assigned = false;
            const targetSlots = context.availableSlots.filter(s => s.session === targetSession && s.needed > 0 && concurrentRoles.includes(s.roleName));
            
            for (let s of targetSlots) {
               if (this._canAssign(unM, s, state, context, 0, true)) {
                  this._assign(unM, s, state, context);
                  assigned = true;
                  break;
               }
            }

            if (!assigned) {
                const otherSlots = context.availableSlots.filter(s => s.session !== targetSession && s.needed > 0 && concurrentRoles.includes(s.roleName));
                for (let s of otherSlots) {
                   if (this._canAssign(unM, s, state, context, 0, true)) {
                      this._assign(unM, s, state, context);
                      assigned = true;
                      break;
                   }
                }
            }

            if (assigned) currentAssignedCount++;
            if (!assigned) {
                if (currentAssignedCount >= 2) return; 
                else {
                    this._forceSwapForFamily(unM, assignedMembers[0], state, context, members);
                    currentAssignedCount++; 
                }
            }
         });
      }
    });
  },

  _forceSwapForFamily(unM, baseMember, state, context, members) {
      const todayShifts = state.draft.filter(d => d.service_date === context.dateStr && !d.is_empty && d.member_id !== unM.id && d.member_id !== baseMember.id);
      let bestSwap = null; let bestScore = -9999;

      for (let shift of todayShifts) {
          if (exclusiveRoles.includes(shift._positionName)) continue;
          const mockSlot = { roleName: shift._positionName, session: shift.session, posId: shift.position_id };
          if (!this._canAssign(unM, mockSlot, state, context, 0, true)) continue;

          const victim = members.find(m => m.id === shift.member_id);
          if (!victim) continue;
          const victimGroupId = state.memberGroups[victim.id];
          if (victimGroupId && (victimGroupId.startsWith('FA') || victimGroupId.startsWith('FB'))) continue;

          const score = (state.totalUsage[victim.id] || 0) - (state.totalUsage[unM.id] || 0);
          if (score > bestScore) { bestScore = score; bestSwap = { shift, victim, mockSlot }; }
      }

      if (bestSwap) this._replaceAssignment(unM, bestSwap.victim.id, bestSwap.shift.temp_id, bestSwap.mockSlot, state, context);
  },

  _replaceAssignment(newMember, oldMemberId, targetTempId, slotInfo, state, context) {
      const draftIdx = state.draft.findIndex(d => d.temp_id === targetTempId);
      if (draftIdx === -1) return;

      state.totalUsage[oldMemberId] = Math.max(0, state.totalUsage[oldMemberId] - 1);
      if (state.roleUsage[oldMemberId][slotInfo.posId]) state.roleUsage[oldMemberId][slotInfo.posId]--;
      const dailyIdx = context.dailyAssignments[oldMemberId].indexOf(slotInfo.roleName);
      if (dailyIdx > -1) context.dailyAssignments[oldMemberId].splice(dailyIdx, 1);

      state.totalUsage[newMember.id] = (state.totalUsage[newMember.id] || 0) + 1;
      state.roleUsage[newMember.id][slotInfo.posId] = (state.roleUsage[newMember.id][slotInfo.posId] || 0) + 1;
      state.lastServedWeek[newMember.id] = context.weekIndex;
      
      if (!state.servingHistory[newMember.id].includes(context.weekIndex)) state.servingHistory[newMember.id].push(context.weekIndex);
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
    
    if (!state.servingHistory[m.id].includes(context.weekIndex)) state.servingHistory[m.id].push(context.weekIndex);
    if (!context.dailyAssignments[m.id]) context.dailyAssignments[m.id] = [];
    context.dailyAssignments[m.id].push(slot.roleName);

    state.draft.push({
      temp_id: `T_${context.dateStr}_${slot.session}_${slot.posId}_${Math.random()}`,
      service_date: context.dateStr, session: slot.session, member_id: m.id, position_id: slot.posId,
      _memberName: m.name, _positionName: slot.roleName, is_emergency: isEmergency
    });
  },

  _fillEmptyWarnings(state, context) {
    context.availableSlots.forEach((slot) => {
      while (slot.needed > 0) {
        state.draft.push({
          temp_id: `EMPTY_${context.dateStr}_${slot.session}_${slot.posId}_${Math.random()}`,
          service_date: context.dateStr, session: slot.session, member_id: 'EMPTY_SLOT', position_id: slot.posId,
          _memberName: '⚠️ 人工指派', _positionName: slot.roleName, is_empty: true
        });
        slot.needed--;
      }
    });
  },

  _applyVisualFlags(draft, members) {
    const memberGroups = {};
    members.forEach(m => { if (m.group_id) memberGroups[m.id] = String(m.group_id); });
    const shiftsByDate = {};
    draft.forEach(d => {
      if (d.is_empty) return;
      if (!shiftsByDate[d.service_date]) shiftsByDate[d.service_date] = [];
      shiftsByDate[d.service_date].push(d);
    });

    Object.keys(shiftsByDate).forEach(dateStr => {
      const dayShifts = shiftsByDate[dateStr];
      const freq = {}; const groupFreq = {}; const groupActiveMembersCount = {};

      dayShifts.forEach(d => {
        freq[d.member_id] = (freq[d.member_id] || 0) + 1;
        const gid = memberGroups[d.member_id];
        if (gid && (gid.startsWith('FA') || gid.startsWith('FB'))) {
          if (!groupFreq[gid]) groupFreq[gid] = new Set();
          groupFreq[gid].add(d.member_id);
          if (!groupActiveMembersCount[gid]) {
              groupActiveMembersCount[gid] = members.filter(m => memberGroups[m.id] === gid && this._isAvailableOnDate(m, dateStr)).length;
          }
        }
      });

      dayShifts.forEach(d => {
        if (freq[d.member_id] >= 2) d.is_duplicate = true;
        const gid = memberGroups[d.member_id];
        if (gid && groupFreq[gid]) {
            const activeCount = groupActiveMembersCount[gid] || 0;
            if (activeCount > 1 && groupFreq[gid].size < 2) {
                if (!exclusiveRoles.includes(d._positionName)) d.is_lonely_family = true;
            }
        }
      });
    });
  },

  _sortFinalDraft(draft, members) {
    const getRule = (m) => {
        if (!m || m.newcomer_rule == null) return 0;
        const val = m.newcomer_rule;
        return (val === 1 || val === '1') ? 1 : 0;
    };

    draft.sort((a, b) => {
      if (a.service_date !== b.service_date) return a.service_date.localeCompare(b.service_date);
      if (a.session !== b.session) return a.session === '第一堂' ? -1 : 1;
      if (a._positionName !== b._positionName) return a._positionName.localeCompare(b._positionName);

      if (a._positionName === '新朋友關懷') {
         const memA = members.find(m => m.id === a.member_id);
         const memB = members.find(m => m.id === b.member_id);
         const ruleA = getRule(memA); const ruleB = getRule(memB);
         if (ruleA !== ruleB) return ruleB - ruleA; 
         if (a.is_empty !== b.is_empty) return a.is_empty ? 1 : -1;
         if (!a.is_empty && !b.is_empty) return (a._memberName || '').localeCompare(b._memberName || '');
      }
      if (a.is_empty !== b.is_empty) return a.is_empty ? 1 : -1;
      return 0;
    });
  },
};

if (typeof window !== 'undefined') window.ScheduleEngine = ScheduleEngine;
else if (typeof module !== 'undefined') module.exports = ScheduleEngine;
