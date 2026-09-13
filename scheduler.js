/**
 * 教會季排班系統 - 核心引擎 V22
 *
 * V22 核心設計：
 *
 * 1. 二堂同崗／二堂異崗「優先保證」
 *    - 不再採用「先一般排班，再事後補二堂」作為主要策略。
 *    - 先建立 Dual Service Plan，再預留名額，最後才進一般排班。
 *
 * 2. 一季一次／一季三次
 *    - 不再因 availability_status 而強制 dual_service_pref = 0。
 *    - 二堂視為「同一天服務」，不增加 totalDays。
 *
 * 3. 家庭組
 *    - Dual Plan 建立時先檢查家庭組可行性。
 *    - 不允許先排二堂、最後家庭組再把二堂拆掉。
 *
 * 4. 技能
 *    - 技能資格仍為 Hard Constraint。
 *    - 技能平均不再作為二堂的 Hard Block。
 *    - 改成 Score / Penalty，控制誰優先。
 *
 * 5. 出勤節奏
 *    - 一季一次：最多 1 個 service day。
 *    - 一季三次：最多 3 個 service days，每月最多 2 個 service days。
 *    - 二堂同一天只算 1 個 service day。
 *
 * 6. 核心崗位
 *    - 司會、PPT、執事輪值仍與一般庶務嚴格隔離。
 *    - 執事保留二堂包辦特例。
 *
 * 7. Repair
 *    - Dual Plan 無法完成時，可釋放 reservation。
 *    - 最後進行有限度 Dual Repair，不大規模破壞既有排班。
 *
 * 8. Audit
 *    - 產生 state.dualAudit，方便 Dashboard 顯示：
 *      requested / fulfilled / failed / failure reason。
 */

const sessionsToSchedule = ['第一堂', '第二堂'];

const roleOrder = [
  '司會',
  'PPT',
  '主餐',
  '收奉獻',
  '接待',
  '新朋友關懷'
];

const CORE_ROLES = [
  '司會',
  'PPT',
  '執事輪值'
];

const COMBO_ROLES = [
  '接待',
  '收奉獻',
  '主餐',
  '新朋友關懷'
];

const DUAL_SAME_ROLE = 1;
const DUAL_DIFF_ROLE = 2;

const ScheduleEngine = {

  /* =========================================================
   * 基礎工具
   * ======================================================= */

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

    while (d.getDay() !== 0) {
      d.setDate(d.getDate() + 1);
    }

    while (
      d.getMonth() >= startMonth &&
      d.getMonth() < startMonth + 3
    ) {
      sundays.push(new Date(d));
      d.setDate(d.getDate() + 7);
    }

    return sundays;
  },

  _getSkillAvgUsage(state, members, posId) {
    const skilledMembers = members.filter(
      m => state.memberSkills[m.id]?.has(posId)
    );

    if (skilledMembers.length === 0) return 0;

    const sum = skilledMembers.reduce(
      (acc, m) => acc + (state.totalUsage[m.id] || 0),
      0
    );

    return sum / skilledMembers.length;
  },

  _isCoreRole(roleName) {
    return CORE_ROLES.includes(roleName);
  },

  _isComboRole(roleName) {
    return COMBO_ROLES.includes(roleName);
  },

  _getDualPref(m) {
    const p = parseInt(m?.dual_service_pref, 10);
    return [1, 2].includes(p) ? p : 0;
  },

  _getDayShifts(state, context, memberId) {
    return state.draft.filter(
      d =>
        !d.is_empty &&
        d.service_date === context.dateStr &&
        d.member_id === memberId
    );
  },

  _getMonthServiceDays(state, memberId, dateStr) {
    const target = new Date(dateStr);
    const year = target.getFullYear();
    const month = target.getMonth();

    return new Set(
      state.draft
        .filter(d => {
          if (d.is_empty || d.member_id !== memberId) return false;

          const dt = new Date(d.service_date);

          return (
            dt.getFullYear() === year &&
            dt.getMonth() === month
          );
        })
        .map(d => d.service_date)
    );
  },

  _hasServedThisDay(state, context, memberId) {
    return this._getDayShifts(state, context, memberId).length > 0;
  },

  /* =========================================================
   * Generate
   * ======================================================= */

  generate(params) {

    const {
      year = new Date().getFullYear(),
      quarter = 1,
      effectiveMembers = [],
      effectiveMemberPositions = [],
      dbData = {},
      roleSettings = {}
    } = params;

    const currentQuarterStr = `${year}-Q${quarter}`;

    const clonedMembers = JSON.parse(
      JSON.stringify(effectiveMembers)
    );

    /*
     * 讀取季度設定
     *
     * ★ V22：
     * 不再因「一季一次／一季三次」而取消 dual_service_pref。
     */
    clonedMembers.forEach(m => {

      let unDates = Array.isArray(m.unavailable_dates)
        ? [...m.unavailable_dates]
        : [];

      if (
        dbData.memberQuarterSettings &&
        Array.isArray(dbData.memberQuarterSettings)
      ) {

        const qs = dbData.memberQuarterSettings.find(
          s =>
            s.member_id === m.id &&
            s.quarter === currentQuarterStr
        );

        if (qs) {

          if (
            qs.newcomer_rule !== undefined &&
            qs.newcomer_rule !== null
          ) {
            m.newcomer_rule = qs.newcomer_rule;
          }

          if (
            qs.dual_service_pref !== undefined &&
            qs.dual_service_pref !== null
          ) {
            m.dual_service_pref = qs.dual_service_pref;
          }

          if (qs.availability_status) {
            m.availability_status = qs.availability_status;
          }

          if (qs.unavailable_dates) {

            const parsedQsDates =
              typeof qs.unavailable_dates === 'string'
                ? JSON.parse(qs.unavailable_dates)
                : qs.unavailable_dates;

            if (Array.isArray(parsedQsDates)) {

              parsedQsDates.forEach(d => {

                if (!unDates.includes(d)) {
                  unDates.push(d);
                }

              });
            }
          }

          const unavailableWeeks =
            qs.unavailable_weeks
              ? (
                  typeof qs.unavailable_weeks === 'string'
                    ? JSON.parse(qs.unavailable_weeks)
                    : qs.unavailable_weeks
                )
              : [];

          if (
            Array.isArray(unavailableWeeks) &&
            unavailableWeeks.length > 0
          ) {

            const sundays =
              this.getSundaysInQuarter(year, quarter);

            sundays.forEach(sunday => {

              const weekNum =
                Math.ceil(sunday.getDate() / 7);

              const dateStr =
                this.formatDate(sunday);

              if (
                unavailableWeeks.includes(weekNum) &&
                !unDates.includes(dateStr)
              ) {
                unDates.push(dateStr);
              }

            });
          }
        }
      }

      m.unavailable_dates = unDates.sort();

      /*
       * ★ V22 不再：
       *
       * if 一季三次 / 一季一次
       *    dual_service_pref = 0
       *
       * 二堂偏好正式保留。
       */
    });

    const positions =
      params.positions ||
      dbData.positions ||
      [];

    const sundays =
      this.getSundaysInQuarter(year, quarter);

    const state = {

      draft: [],

      totalUsage: {},
      totalDays: {},
      roleUsage: {},
      lastServedWeek: {},

      memberSkills: {},
      memberGroups: {},
      openingWeek: {},

      /*
       * V22 Dual Service
       */
      dualPlans: [],
      reservedSlots: {},
      dualAudit: {
        requested: 0,
        sameRoleRequested: 0,
        diffRoleRequested: 0,
        fulfilled: 0,
        sameRoleFulfilled: 0,
        diffRoleFulfilled: 0,
        failed: [],
        byMember: {}
      },

      /*
       * 當季所有日期
       */
      sundays
    };

    this._prepareData(
      state,
      clonedMembers,
      effectiveMemberPositions,
      sundays
    );

    const specialIds = {

      deacon: positions.find(
        p =>
          String(p?.name || '').trim() === '執事輪值'
      )?.id,

      mc: positions.find(
        p =>
          String(p?.name || '').trim() === '司會'
      )?.id,

      ppt: positions.find(
        p =>
          String(p?.name || '').trim() === 'PPT'
      )?.id,

      newcomer: positions.find(
        p =>
          String(p?.name || '').trim() === '新朋友關懷'
      )?.id
    };

    sundays.forEach((sunday, weekIndex) => {

      const context = {

        sunday,
        weekIndex,
        totalWeeks: sundays.length,

        dateStr:
          this.formatDate(sunday),

        dailyAssignments: {},

        availableSlots:
          this._createAvailableSlots(
            sunday,
            positions,
            roleSettings
          )
      };

      this._runSchedulingPipeline(
        state,
        context,
        clonedMembers,
        specialIds
      );

    });

    /*
     * 最後 Audit
     */
    this._finalizeDualAudit(
      state,
      clonedMembers
    );

    this._applyVisualFlags(
      state.draft,
      clonedMembers
    );

    this._sortFinalDraft(
      state.draft,
      clonedMembers
    );

    return state.draft;
  },

  /* =========================================================
   * Prepare Data
   * ======================================================= */

  _prepareData(
    state,
    members,
    memberPositions,
    sundays
  ) {

    state.membersList = members;

    members.forEach(m => {

      state.totalUsage[m.id] = 0;

      /*
       * totalDays = 出勤日，不是堂數
       */
      state.totalDays[m.id] = 0;

      state.roleUsage[m.id] = {};

      state.lastServedWeek[m.id] = -99;

      state.memberSkills[m.id] = new Set(
        memberPositions
          .filter(
            mp => mp.member_id === m.id
          )
          .map(
            mp => mp.position_id
          )
      );

      if (m.group_id) {
        state.memberGroups[m.id] =
          String(m.group_id);
      }

      /*
       * 一季一次：隨機產生理想週
       */
      if (
        m.availability_status === '一季一次'
      ) {

        const availableWeeks = [];

        sundays.forEach(
          (sunday, idx) => {

            const dateStr =
              this.formatDate(sunday);

            if (
              this._isAvailableOnDate(
                m,
                dateStr
              )
            ) {
              availableWeeks.push(idx);
            }

          }
        );

        if (availableWeeks.length > 0) {

          const randomIdx =
            Math.floor(
              Math.random() *
              availableWeeks.length
            );

          state.openingWeek[m.id] =
            availableWeeks[randomIdx];

        } else {

          state.openingWeek[m.id] = 0;

        }
      }

    });
  },

  /* =========================================================
   * Slot
   * ======================================================= */

  _createAvailableSlots(
    sunday,
    positions,
    roleSettings
  ) {

    const slots = [];

    const isFirstSunday =
      sunday.getDate() <= 7;

    sessionsToSchedule.forEach(
      sess => {

        positions.forEach(p => {

          const roleName =
            String(p.name || '').trim();

          if (!roleName) return;

          const needed =
            roleSettings[roleName] !== undefined
              ? roleSettings[roleName]
              : p.max_people || 0;

          if (needed <= 0) return;

          /*
           * 原 V21：
           * 主餐只在第一個 Sunday 建立
           */
          if (
            roleName === '主餐' &&
            !isFirstSunday
          ) {
            return;
          }

          slots.push({

            session: sess,
            roleName,
            posId: p.id,

            needed,

            assigned: []
          });

        });

      }
    );

    return slots;
  },

  _isAvailableOnDate(m, dateStr) {

    if (
      ['暫停服事', '安息季']
        .includes(m.availability_status)
    ) {
      return false;
    }

    if (
      Array.isArray(m.unavailable_dates) &&
      m.unavailable_dates.includes(dateStr)
    ) {
      return false;
    }

    return true;
  },

  /* =========================================================
   * Hard Constraint
   * ======================================================= */

  _canAssign(
    m,
    slot,
    state,
    context,
    strictLevel = 0,
    skipFamilyCheck = false,
    options = {}
  ) {

    const {
      roleName,
      session,
      posId
    } = slot;

    if (
      !this._isAvailableOnDate(
        m,
        context.dateStr
      )
    ) {
      return false;
    }

    const dayShifts =
      this._getDayShifts(
        state,
        context,
        m.id
      );

    const hasShiftToday =
      dayShifts.length > 0;

    /*
     * 一季一次
     *
     * 二堂同一天不增加 totalDays
     */
    if (
      m.availability_status === '一季一次' &&
      (state.totalDays[m.id] || 0) >= 1 &&
      !hasShiftToday
    ) {
      return false;
    }

    /*
     * 一季三次
     */
    if (
      m.availability_status === '一季三次'
    ) {

      if (
        (state.totalDays[m.id] || 0) >= 3 &&
        !hasShiftToday
      ) {
        return false;
      }

      if (!hasShiftToday) {

        const monthDays =
          this._getMonthServiceDays(
            state,
            m.id,
            context.dateStr
          );

        if (monthDays.size >= 2) {
          return false;
        }
      }
    }

    /*
     * 技能資格：Hard Constraint
     */
    if (
      !state.memberSkills[m.id]?.has(posId)
    ) {
      return false;
    }

    /*
     * 執事一季最多 4 次
     */
    if (
      roleName === '執事輪值'
    ) {

      if (
        (state.roleUsage[m.id][posId] || 0) >= 4
      ) {
        return false;
      }
    }

    /*
     * 每人每日最多兩個 assignment
     */
    if (dayShifts.length >= 2) {
      return false;
    }

    const dualPref =
      this._getDualPref(m);

    /*
     * preferred_session
     *
     * ★ V22：
     * 如果是 Dual Plan，第一堂與第二堂配對
     * 不讓 preferred_session 阻止第二堂。
     */
    const isDualPlan =
      options.isDualPlan === true;

    if (
      dayShifts.length === 0 &&
      roleName !== '執事輪值' &&
      !isDualPlan
    ) {

      if (
        dualPref === 0 &&
        m.preferred_session &&
        m.preferred_session !== '皆可'
      ) {

        const prefStr =
          String(m.preferred_session);

        if (
          !prefStr.includes(
            session.replace('堂', '')
          )
        ) {
          return false;
        }
      }
    }

    /*
     * 核心崗位隔離
     */
    const dayRoles =
      dayShifts.map(
        d => d._positionName
      );

    if (
      dayRoles.some(
        r => CORE_ROLES.includes(r)
      )
    ) {
      return false;
    }

    if (
      CORE_ROLES.includes(roleName) &&
      dayShifts.length > 0
    ) {
      return false;
    }

    /*
     * 一般崗位第二堂規則
     *
     * ★ 注意：
     * Dual Plan 進入時，不依賴這裡判斷。
     * Dual Plan 自己會完整驗證。
     */
    if (
      !CORE_ROLES.includes(roleName) &&
      dayShifts.length === 1 &&
      !isDualPlan
    ) {

      const firstShift =
        dayShifts[0];

      if (dualPref === 1) {

        if (
          firstShift.session === session
        ) {
          return false;
        }

        if (
          firstShift._positionName !== roleName
        ) {
          return false;
        }

      } else if (dualPref === 2) {

        if (
          firstShift.session === session
        ) {
          return false;
        }

        if (
          firstShift._positionName === roleName
        ) {
          return false;
        }

      } else {

        /*
         * 非二堂偏好：
         * 保留原 V21 同堂兼任
         */
        if (
          firstShift.session !== session
        ) {
          return false;
        }

        if (
          firstShift._positionName === roleName
        ) {
          return false;
        }
      }
    }

    /*
     * 預留名額：
     * 一般排班不能搶 Dual Plan
     */
    if (
      !options.ignoreReservation &&
      this._isSlotReserved(
        state,
        context.dateStr,
        session,
        posId,
        m.id
      )
    ) {
      return false;
    }

    /*
     * 家庭組
     */
    if (!skipFamilyCheck) {

      if (
        !this._familyHardCheck(
          m,
          slot,
          state,
          context
        )
      ) {
        return false;
      }
    }

    return true;
  },

  /* =========================================================
   * Family Hard Check
   * ======================================================= */

  _familyHardCheck(
    m,
    slot,
    state,
    context
  ) {

    const myGroupId =
      state.memberGroups[m.id];

    if (
      !myGroupId ||
      (
        !myGroupId.startsWith('FA') &&
        !myGroupId.startsWith('FB')
      )
    ) {
      return true;
    }

    const assignedFamilyIds =
      Object.keys(
        context.dailyAssignments
      ).filter(
        id =>
          id !== m.id &&
          state.memberGroups[id] === myGroupId
      );

    /*
     * FA：
     * 家庭成員已有角色時，
     * 優先同角色。
     */
    if (
      assignedFamilyIds.length > 0 &&
      myGroupId.startsWith('FA')
    ) {

      const familyRoles = new Set();

      assignedFamilyIds.forEach(
        fid => {

          (
            context.dailyAssignments[fid] ||
            []
          ).forEach(
            r => familyRoles.add(r)
          );

        }
      );

      if (
        !familyRoles.has(slot.roleName)
      ) {
        return false;
      }
    }

    /*
     * FA 庶務：
     * 必須保留足夠容量給其他家庭成員。
     */
    if (
      myGroupId.startsWith('FA') &&
      COMBO_ROLES.includes(slot.roleName)
    ) {

      const unassignedFamilyIds =
        Object.keys(
          state.memberGroups
        ).filter(fid => {

          if (
            fid === m.id ||
            state.memberGroups[fid] !== myGroupId
          ) {
            return false;
          }

          if (
            context.dailyAssignments[fid] &&
            context.dailyAssignments[fid]
              .includes(slot.roleName)
          ) {
            return false;
          }

          const famMember =
            state.membersList.find(
              mem => mem.id === fid
            );

          if (
            famMember &&
            ['暫停服事', '安息季']
              .includes(
                famMember.availability_status
              )
          ) {
            return false;
          }

          return true;
        });

      /*
       * 保留家庭空間
       */
      if (
        slot.needed <
        unassignedFamilyIds.length + 1
      ) {
        return false;
      }

      /*
       * 檢查每一個家庭成員
       */
      for (
        const fid of unassignedFamilyIds
      ) {

        const famMember =
          state.membersList.find(
            mem => mem.id === fid
          );

        if (!famMember) continue;

        if (
          !this._isAvailableOnDate(
            famMember,
            context.dateStr
          )
        ) {
          return false;
        }

        if (
          !state.memberSkills[fid]?.has(
            slot.posId
          )
        ) {
          return false;
        }

        const famDays =
          state.totalDays[fid] || 0;

        const famHasShiftToday =
          this._hasServedThisDay(
            state,
            context,
            fid
          );

        if (
          famMember.availability_status ===
            '一季一次' &&
          famDays >= 1 &&
          !famHasShiftToday
        ) {
          return false;
        }

        if (
          famMember.availability_status ===
            '一季三次'
        ) {

          if (
            famDays >= 3 &&
            !famHasShiftToday
          ) {
            return false;
          }

          if (!famHasShiftToday) {

            const monthDays =
              this._getMonthServiceDays(
                state,
                fid,
                context.dateStr
              );

            if (monthDays.size >= 2) {
              return false;
            }
          }
        }

        const famDayShifts =
          this._getDayShifts(
            state,
            context,
            fid
          );

        if (famDayShifts.length >= 2) {
          return false;
        }
      }
    }

    return true;
  },

  /* =========================================================
   * Score
   * ======================================================= */

  _getScore(
    m,
    slot,
    state,
    context,
    members
  ) {

    let criticalWeight = 0;
    let softWeight = 0;

    /*
     * 一季一次
     */
    if (
      m.availability_status === '一季一次' &&
      state.totalDays[m.id] === 0
    ) {

      const openingWeek =
        state.openingWeek[m.id] || 0;

      const isSafetyNetActive =
        (
          context.totalWeeks -
          context.weekIndex
        ) <= 3;

      if (
        context.weekIndex < openingWeek &&
        !isSafetyNetActive
      ) {

        criticalWeight += 20000;

      } else {

        criticalWeight -= 10000;

      }
    }

    /*
     * 核心技能首次使用
     */
    if (
      ['執事輪值', '司會']
        .includes(slot.roleName)
    ) {

      const currentUsage =
        state.roleUsage[m.id]?.[slot.posId] || 0;

      if (currentUsage === 0) {
        criticalWeight -= 20000;
      }
    }

    /*
     * 家庭組
     */
    const myGroupId =
      state.memberGroups[m.id];

    if (
      myGroupId &&
      (
        myGroupId.startsWith('FA') ||
        myGroupId.startsWith('FB')
      )
    ) {

      const myShiftsCount =
        (
          context.dailyAssignments[m.id] ||
          []
        ).length;

      if (myShiftsCount === 0) {

        const assignedFamilyIds =
          Object.keys(
            context.dailyAssignments
          ).filter(
            assignedId =>
              assignedId !== m.id &&
              state.memberGroups[assignedId] ===
                myGroupId
          );

        if (
          assignedFamilyIds.length > 0
        ) {

          const familyRoles =
            new Set();

          assignedFamilyIds.forEach(
            fid =>
              (
                context.dailyAssignments[fid] ||
                []
              ).forEach(
                r => familyRoles.add(r)
              )
          );

          if (
            myGroupId.startsWith('FA') &&
            familyRoles.has(slot.roleName)
          ) {
            criticalWeight -= 15000;

          } else if (
            myGroupId.startsWith('FB')
          ) {
            criticalWeight -= 15000;
          }
        }
      }
    }

    /*
     * 連週：
     * 保留原 V21 的策略。
     */
    if (
      state.lastServedWeek[m.id] ===
      context.weekIndex - 1
    ) {
      criticalWeight += 5000;
    }

    /*
     * 技能 singleton
     */
    const isFamily =
      myGroupId &&
      (
        String(myGroupId).startsWith('FA') ||
        String(myGroupId).startsWith('FB')
      );

    if (
      !isFamily &&
      state.memberSkills[m.id].size === 1
    ) {
      softWeight -= 800;
    }

    /*
     * ★ V22 技能平衡：
     * 不再 Hard Block
     */
    const skillAvg =
      this._getSkillAvgUsage(
        state,
        members,
        slot.posId
      );

    const skillGap =
      (state.totalUsage[m.id] || 0) -
      skillAvg;

    if (skillGap > 0) {
      softWeight +=
        Math.round(skillGap * 1500);
    }

    /*
     * Combo opportunity
     */
    const dayRoles =
      context.dailyAssignments[m.id] || [];

    const isComboOpportunity =
      dayRoles.length > 0 &&
      COMBO_ROLES.includes(slot.roleName) &&
      dayRoles.some(
        r => COMBO_ROLES.includes(r)
      );

    /*
     * ★ Dual candidate bonus
     */
    let dualPriority = 1;

    const dualPref =
      this._getDualPref(m);

    if (
      dualPref === 1 ||
      dualPref === 2
    ) {
      dualPriority = 0;
    }

    return [

      /*
       * 1. 二堂偏好最高
       */
      dualPriority,

      /*
       * 2. 同堂兼任
       */
      isComboOpportunity ? 0 : 1,

      /*
       * 3. Critical
       */
      criticalWeight,

      /*
       * 4. 出勤日數
       */
      state.totalDays[m.id] || 0,

      /*
       * 5. 技能平衡
       */
      softWeight,

      /*
       * 6. 堂數
       */
      state.totalUsage[m.id] || 0,

      /*
       * 7. 技能數
       */
      state.memberSkills[m.id].size,

      Math.random()
    ];
  },

  _compareScore(scoreA, scoreB) {

    for (
      let i = 0;
      i < scoreA.length;
      i++
    ) {

      if (
        scoreA[i] < scoreB[i]
      ) {
        return -1;
      }

      if (
        scoreA[i] > scoreB[i]
      ) {
        return 1;
      }
    }

    return 0;
  },

  /* =========================================================
   * V22 Pipeline
   * ======================================================= */

  _runSchedulingPipeline(
    state,
    context,
    members,
    specialIds
  ) {

    /*
     * Phase 1
     * 執事二堂特例
     */
    this._assignDeacons(
      state,
      context,
      members,
      specialIds.deacon
    );

    /*
     * Phase 2
     * 建立 Dual Plan
     */
    this._buildDualServicePlans(
      state,
      context,
      members
    );

    /*
     * Phase 3
     * Dual Plan 排序
     */
    this._scoreDualServicePlans(
      state,
      context,
      members
    );

    /*
     * Phase 4
     * 預留名額
     */
    this._reserveDualServicePlans(
      state,
      context
    );

    /*
     * Phase 5
     * 鎖定二堂
     */
    this._commitDualServicePlans(
      state,
      context,
      members
    );

    /*
     * Phase 6
     * 家庭組
     */
    this._assignFamilyGroups(
      state,
      context,
      members,
      specialIds
    );

    /*
     * Phase 7
     * 一般排班
     */
    sessionsToSchedule.forEach(
      sess => {

        roleOrder.forEach(
          roleName => {

            const slots =
              context.availableSlots.filter(
                s =>
                  s.session === sess &&
                  s.roleName === roleName &&
                  s.needed > 0
              );

            slots.forEach(
              slot => {

                this._fillSlot(
                  slot,
                  members,
                  state,
                  context,
                  0
                );

              }
            );

          }
        );

      }
    );

    /*
     * Phase 8
     * 家庭補足
     */
    this._enforceFamily(
      state,
      context,
      members
    );

    /*
     * Phase 9
     * Dual Repair
     */
    this._repairDualService(
      state,
      context,
      members
    );

    /*
     * Phase 10
     * 最後低優先填補
     */
    sessionsToSchedule.forEach(
      sess => {

        roleOrder.forEach(
          roleName => {

            const slots =
              context.availableSlots.filter(
                s =>
                  s.session === sess &&
                  s.roleName === roleName &&
                  s.needed > 0
              );

            slots.forEach(
              slot =>
                this._fillSlot(
                  slot,
                  members,
                  state,
                  context,
                  1
                )
            );

          }
        );

      }
    );

    /*
     * Phase 11
     * Warning
     */
    this._fillEmptyWarnings(
      state,
      context
    );
  },

  /* =========================================================
   * Dual Service Plan
   * ======================================================= */

  _buildDualServicePlans(
    state,
    context,
    members
  ) {

    const dualMembers =
      members.filter(m => {

        const pref =
          this._getDualPref(m);

        if (
          pref !== DUAL_SAME_ROLE &&
          pref !== DUAL_DIFF_ROLE
        ) {
          return false;
        }

        if (
          !this._isAvailableOnDate(
            m,
            context.dateStr
          )
        ) {
          return false;
        }

        /*
         * 已經有服事者不再建立完整 Dual Plan
         */
        if (
          this._hasServedThisDay(
            state,
            context,
            m.id
          )
        ) {
          return false;
        }

        /*
         * 上週服事：
         * 不是 Hard Block，
         * 但降低排序優先。
         */
        return true;
      });

    /*
     * 服務日較少者優先
     */
    dualMembers.sort(
      (a, b) => {

        const dayDiff =
          (state.totalDays[a.id] || 0) -
          (state.totalDays[b.id] || 0);

        if (dayDiff !== 0) {
          return dayDiff;
        }

        return (
          (state.totalUsage[a.id] || 0) -
          (state.totalUsage[b.id] || 0)
        );
      }
    );

    dualMembers.forEach(
      m => {

        const pref =
          this._getDualPref(m);

        let plans = [];

        if (
          pref === DUAL_SAME_ROLE
        ) {

          plans =
            this._findSameRoleDualPlans(
              m,
              state,
              context,
              members
            );

        } else {

          plans =
            this._findDifferentRoleDualPlans(
              m,
              state,
              context,
              members
            );

        }

        /*
         * 只保留最佳幾個方案
         */
        plans
          .slice(0, 10)
          .forEach(
            plan => {

              plan.memberId = m.id;
              plan.pref = pref;

              state.dualPlans.push(
                plan
              );
            }
          );
      }
    );

    /*
     * Audit request
     */
    dualMembers.forEach(
      m => {

        const pref =
          this._getDualPref(m);

        state.dualAudit.requested++;

        if (
          pref === DUAL_SAME_ROLE
        ) {
          state.dualAudit.sameRoleRequested++;
        } else {
          state.dualAudit.diffRoleRequested++;
        }

        state.dualAudit.byMember[m.id] = {
          member_id: m.id,
          member_name: m.name,
          preference: pref,
          date: context.dateStr,
          fulfilled: false
        };
      }
    );
  },

  _findSameRoleDualPlans(
    member,
    state,
    context,
    members
  ) {

    const plans = [];

    const firstSlots =
      context.availableSlots.filter(
        s =>
          s.session === '第一堂' &&
          s.needed > 0 &&
          COMBO_ROLES.includes(
            s.roleName
          )
      );

    firstSlots.forEach(
      firstSlot => {

        const secondSlot =
          context.availableSlots.find(
            s =>
              s.session === '第二堂' &&
              s.roleName ===
                firstSlot.roleName &&
              s.needed > 0
          );

        if (!secondSlot) return;

        if (
          !this._canAssign(
            member,
            firstSlot,
            state,
            context,
            0,
            false,
            {
              isDualPlan: true,
              ignoreReservation: true
            }
          )
        ) {
          return;
        }

        if (
          !this._canAssign(
            member,
            secondSlot,
            state,
            context,
            0,
            false,
            {
              isDualPlan: true,
              ignoreReservation: true
            }
          )
        ) {
          return;
        }

        /*
         * 家庭組雙堂可行性
         */
        if (
          !this._isDualFamilyFeasible(
            member,
            firstSlot,
            secondSlot,
            state,
            context,
            members
          )
        ) {
          return;
        }

        plans.push({

          type: 'SAME_ROLE',

          member,

          first: firstSlot,
          second: secondSlot,

          score:
            this._getDualPlanScore(
              member,
              firstSlot,
              secondSlot,
              state,
              context,
              members
            )
        });

      }
    );

    plans.sort(
      (a, b) =>
        this._compareScore(
          a.score,
          b.score
        )
    );

    return plans;
  },

  _findDifferentRoleDualPlans(
    member,
    state,
    context,
    members
  ) {

    const plans = [];

    const firstSlots =
      context.availableSlots.filter(
        s =>
          s.session === '第一堂' &&
          s.needed > 0 &&
          COMBO_ROLES.includes(
            s.roleName
          )
      );

    const secondSlots =
      context.availableSlots.filter(
        s =>
          s.session === '第二堂' &&
          s.needed > 0 &&
          COMBO_ROLES.includes(
            s.roleName
          )
      );

    firstSlots.forEach(
      firstSlot => {

        secondSlots.forEach(
          secondSlot => {

            if (
              firstSlot.roleName ===
              secondSlot.roleName
            ) {
              return;
            }

            if (
              !this._canAssign(
                member,
                firstSlot,
                state,
                context,
                0,
                false,
                {
                  isDualPlan: true,
                  ignoreReservation: true
                }
              )
            ) {
              return;
            }

            if (
              !this._canAssign(
                member,
                secondSlot,
                state,
                context,
                0,
                false,
                {
                  isDualPlan: true,
                  ignoreReservation: true
                }
              )
            ) {
              return;
            }

            if (
              !this._isDualFamilyFeasible(
                member,
                firstSlot,
                secondSlot,
                state,
                context,
                members
              )
            ) {
              return;
            }

            plans.push({

              type: 'DIFF_ROLE',

              member,

              first: firstSlot,
              second: secondSlot,

              score:
                this._getDualPlanScore(
                  member,
                  firstSlot,
                  secondSlot,
                  state,
                  context,
                  members
                )
            });

          }
        );

      }
    );

    plans.sort(
      (a, b) =>
        this._compareScore(
          a.score,
          b.score
        )
    );

    return plans;
  },

  _getDualPlanScore(
    member,
    firstSlot,
    secondSlot,
    state,
    context,
    members
  ) {

    let score = [
      0,
      0,
      0,
      state.totalDays[member.id] || 0,
      0,
      state.totalUsage[member.id] || 0,
      state.memberSkills[member.id].size,
      Math.random()
    ];

    /*
     * 技能平衡：
     * 只影響排序，不阻擋。
     */
    const avg1 =
      this._getSkillAvgUsage(
        state,
        members,
        firstSlot.posId
      );

    const avg2 =
      this._getSkillAvgUsage(
        state,
        members,
        secondSlot.posId
      );

    const gap =
      Math.max(
        0,
        (state.totalUsage[member.id] || 0) - avg1
      ) +
      Math.max(
        0,
        (state.totalUsage[member.id] || 0) - avg2
      );

    score[4] =
      Math.round(gap * 1000);

    /*
     * 連週是軟性懲罰
     */
    if (
      state.lastServedWeek[member.id] ===
      context.weekIndex - 1
    ) {
      score[2] += 5000;
    }

    /*
     * 一季一次優先安排
     */
    if (
      member.availability_status ===
      '一季一次' &&
      state.totalDays[member.id] === 0
    ) {
      score[2] -= 10000;
    }

    return score;
  },

  /* =========================================================
   * Dual Family Feasibility
   * ======================================================= */

  _isDualFamilyFeasible(
    member,
    firstSlot,
    secondSlot,
    state,
    context,
    members
  ) {

    const gid =
      state.memberGroups[member.id];

    if (
      !gid ||
      (
        !gid.startsWith('FA') &&
        !gid.startsWith('FB')
      )
    ) {
      return true;
    }

    /*
     * FA：
     * 如果需要家庭同步角色，
     * 至少第一堂有可能補足。
     */
    if (
      gid.startsWith('FA')
    ) {

      const familyMembers =
        members.filter(
          m =>
            m.id !== member.id &&
            state.memberGroups[m.id] === gid
        );

      for (
        const fm of familyMembers
      ) {

        if (
          !this._isAvailableOnDate(
            fm,
            context.dateStr
          )
        ) {
          continue;
        }

        /*
         * 如果家人完全沒有任何可安排角色，
         * 這個 Dual Plan 不安全。
         */
        const hasAnyRole =
          context.availableSlots.some(
            slot => {

              if (
                slot.needed <= 0
              ) {
                return false;
              }

              if (
                !COMBO_ROLES.includes(
                  slot.roleName
                )
              ) {
                return false;
              }

              if (
                !state.memberSkills[
                  fm.id
                ]?.has(slot.posId)
              ) {
                return false;
              }

              return this._canAssign(
                fm,
                slot,
                state,
                context,
                0,
                true,
                {
                  isDualPlan: true,
                  ignoreReservation: true
                }
              );
            }
          );

        if (!hasAnyRole) {
          return false;
        }
      }
    }

    return true;
  },

  /* =========================================================
   * Reservation
   * ======================================================= */

  _slotKey(
    dateStr,
    session,
    posId
  ) {

    return [
      dateStr,
      session,
      posId
    ].join('|');
  },

  _reserveSlot(
    state,
    dateStr,
    session,
    posId,
    memberId
  ) {

    const key =
      this._slotKey(
        dateStr,
        session,
        posId
      );

    if (
      !state.reservedSlots[key]
    ) {
      state.reservedSlots[key] = [];
    }

    if (
      !state.reservedSlots[key]
        .includes(memberId)
    ) {
      state.reservedSlots[key]
        .push(memberId);
    }
  },

  _isSlotReserved(
    state,
    dateStr,
    session,
    posId,
    memberId = null
  ) {

    const key =
      this._slotKey(
        dateStr,
        session,
        posId
      );

    const reserved =
      state.reservedSlots[key] || [];

    /*
     * 沒人保留
     */
    if (
      reserved.length === 0
    ) {
      return false;
    }

    /*
     * 指定 member 自己的 reservation
     * 不阻擋。
     */
    if (
      memberId &&
      reserved.includes(memberId)
    ) {
      return false;
    }

    return true;
  },

  _reserveDualServicePlans(
    state,
    context
  ) {

    /*
     * 按 score 排序
     */
    state.dualPlans.sort(
      (a, b) =>
        this._compareScore(
          a.score,
          b.score
        )
    );

    const usedMembers =
      new Set();

    state.dualPlans.forEach(
      plan => {

        /*
         * 同一天同一人只能有一組 Dual Plan
         */
        if (
          usedMembers.has(
            plan.memberId
          )
        ) {
          return;
        }

        /*
         * reservation 衝突
         */
        if (
          this._isSlotReserved(
            state,
            context.dateStr,
            plan.first.session,
            plan.first.posId
          )
        ) {
          return;
        }

        if (
          this._isSlotReserved(
            state,
            context.dateStr,
            plan.second.session,
            plan.second.posId
          )
        ) {
          return;
        }

        /*
         * capacity 再確認
         */
        if (
          plan.first.needed <= 0 ||
          plan.second.needed <= 0
        ) {
          return;
        }

        /*
         * 預留
         */
        this._reserveSlot(
          state,
          context.dateStr,
          plan.first.session,
          plan.first.posId,
          plan.memberId
        );

        this._reserveSlot(
          state,
          context.dateStr,
          plan.second.session,
          plan.second.posId,
          plan.memberId
        );

        plan.reserved = true;

        usedMembers.add(
          plan.memberId
        );
      }
    );
  },

  /* =========================================================
   * Commit Dual Plans
   * ======================================================= */

  _scoreDualServicePlans(
    state,
    context,
    members
  ) {

    state.dualPlans =
      state.dualPlans.filter(
        plan => {

          const member =
            members.find(
              m => m.id === plan.memberId
            );

          if (!member) {
            return false;
          }

          plan.score =
            this._getDualPlanScore(
              member,
              plan.first,
              plan.second,
              state,
              context,
              members
            );

          return true;
        }
      );

    state.dualPlans.sort(
      (a, b) =>
        this._compareScore(
          a.score,
          b.score
        )
    );
  },

  _commitDualServicePlans(
    state,
    context,
    members
  ) {

    const plans =
      state.dualPlans.filter(
        p =>
          p.reserved &&
          !p.committed
      );

    plans.forEach(
      plan => {

        const member =
          members.find(
            m => m.id === plan.memberId
          );

        if (!member) {
          return;
        }

        /*
         * 二次 Hard Check
         */
        if (
          !this._canAssign(
            member,
            plan.first,
            state,
            context,
            0,
            true,
            {
              isDualPlan: true,
              ignoreReservation: true
            }
          )
        ) {
          this._releaseDualPlan(
            state,
            context,
            plan
          );
          return;
        }

        if (
          !this._canAssign(
            member,
            plan.second,
            state,
            context,
            0,
            true,
            {
              isDualPlan: true,
              ignoreReservation: true
            }
          )
        ) {
          this._releaseDualPlan(
            state,
            context,
            plan
          );
          return;
        }

        /*
         * 直接 assignment
         */
        this._assign(
          member,
          plan.first,
          state,
          context,
          0,
          true
        );

        this._assign(
          member,
          plan.second,
          state,
          context,
          0,
          true
        );

        plan.committed = true;

        /*
         * Audit
         */
        const audit =
          state.dualAudit.byMember[
            member.id
          ];

        if (audit) {

          audit.fulfilled = true;

          audit.type =
            plan.type;

          audit.roles = [
            plan.first.roleName,
            plan.second.roleName
          ];
        }

        state.dualAudit.fulfilled++;

        if (
          plan.type === 'SAME_ROLE'
        ) {
          state.dualAudit
            .sameRoleFulfilled++;
        } else {
          state.dualAudit
            .diffRoleFulfilled++;
        }

        /*
         * 二堂後才補家庭
         */
        this._immediateFamilyFill(
          member,
          state,
          context,
          members
        );
      }
    );
  },

  _releaseDualPlan(
    state,
    context,
    plan
  ) {

    const keys = [
      this._slotKey(
        context.dateStr,
        plan.first.session,
        plan.first.posId
      ),
      this._slotKey(
        context.dateStr,
        plan.second.session,
        plan.second.posId
      )
    ];

    keys.forEach(
      key => {

        if (
          state.reservedSlots[key]
        ) {

          state.reservedSlots[key] =
            state.reservedSlots[key]
              .filter(
                id =>
                  id !== plan.memberId
              );

          if (
            state.reservedSlots[key]
              .length === 0
          ) {
            delete state.reservedSlots[key];
          }
        }
      }
    );

    plan.reserved = false;
  },

  /* =========================================================
   * General Fill
   * ======================================================= */

  _fillSlot(
    slot,
    members,
    state,
    context,
    strictLevel
  ) {

    let limit = 0;

    while (
      slot.needed > 0 &&
      limit < 20
    ) {

      const eligible =
        members.filter(
          m =>
            this._canAssign(
              m,
              slot,
              state,
              context,
              strictLevel
            )
        );

      if (
        eligible.length === 0
      ) {
        break;
      }

      const scored =
        eligible.map(
          m => ({
            m,
            score:
              this._getScore(
                m,
                slot,
                state,
                context,
                members
              )
          })
        );

      scored.sort(
        (a, b) =>
          this._compareScore(
            a.score,
            b.score
          )
      );

      const assignedMember =
        scored[0].m;

      this._assign(
        assignedMember,
        slot,
        state,
        context
      );

      /*
       * 一般同堂兼任
       */
      this._immediateComboFill(
        assignedMember,
        state,
        context,
        members
      );

      /*
       * 非 Dual Plan 的自然二堂補足
       * 保留作為 repair / fallback。
       */
      this._immediateFOFill(
        assignedMember,
        state,
        context,
        members
      );

      this._immediateFamilyFill(
        assignedMember,
        state,
        context,
        members
      );

      limit++;
    }
  },

  /* =========================================================
   * Same-session Combo
   * ======================================================= */

  _immediateComboFill(
    baseMember,
    state,
    context,
    members
  ) {

    const dayShifts =
      this._getDayShifts(
        state,
        context,
        baseMember.id
      );

    if (
      dayShifts.length >= 2
    ) {
      return;
    }

    const currentShift =
      dayShifts[0];

    if (
      !currentShift ||
      !COMBO_ROLES.includes(
        currentShift._positionName
      )
    ) {
      return;
    }

    const targetSession =
      currentShift.session;

    const targetSlots =
      context.availableSlots.filter(
        s =>
          s.session === targetSession &&
          s.needed > 0 &&
          COMBO_ROLES.includes(
            s.roleName
          ) &&
          s.roleName !==
            currentShift._positionName
      );

    for (
      const slot of targetSlots
    ) {

      if (
        this._canAssign(
          baseMember,
          slot,
          state,
          context,
          0,
          true
        )
      ) {

        this._assign(
          baseMember,
          slot,
          state,
          context
        );

        break;
      }
    }
  },

  /* =========================================================
   * Fallback FO
   * ======================================================= */

  _immediateFOFill(
    baseMember,
    state,
    context,
    members
  ) {

    const pref =
      this._getDualPref(
        baseMember
      );

    if (
      pref !== 1 &&
      pref !== 2
    ) {
      return;
    }

    /*
     * 已有兩堂
     */
    const dayShifts =
      this._getDayShifts(
        state,
        context,
        baseMember.id
      );

    if (
      dayShifts.length >= 2
    ) {
      return;
    }

    /*
     * 核心崗位不走普通 FO
     */
    if (
      dayShifts.some(
        s =>
          CORE_ROLES.includes(
            s._positionName
          )
      )
    ) {
      return;
    }

    const currentShift =
      dayShifts[0];

    if (!currentShift) return;

    const targetSession =
      currentShift.session ===
        '第一堂'
        ? '第二堂'
        : '第一堂';

    const targetSlots =
      context.availableSlots.filter(
        s =>
          s.session === targetSession &&
          s.needed > 0 &&
          COMBO_ROLES.includes(
            s.roleName
          )
      );

    let targetSlot = null;

    if (pref === 1) {

      targetSlot =
        targetSlots.find(
          s =>
            s.roleName ===
              currentShift._positionName &&
            this._canAssign(
              baseMember,
              s,
              state,
              context,
              0,
              true
            )
        );

    } else {

      targetSlot =
        targetSlots.find(
          s =>
            s.roleName !==
              currentShift._positionName &&
            this._canAssign(
              baseMember,
              s,
              state,
              context,
              0,
              true
            )
        );
    }

    if (targetSlot) {

      this._assign(
        baseMember,
        targetSlot,
        state,
        context
      );
    }
  },

  /* =========================================================
   * Family Immediate
   * ======================================================= */

  _immediateFamilyFill(
    baseMember,
    state,
    context,
    members
  ) {

    const groupId =
      state.memberGroups[
        baseMember.id
      ];

    if (
      !groupId ||
      (
        !groupId.startsWith('FA') &&
        !groupId.startsWith('FB')
      )
    ) {
      return;
    }

    const baseShift =
      state.draft.find(
        d =>
          !d.is_empty &&
          d.service_date ===
            context.dateStr &&
          d.member_id ===
            baseMember.id
      );

    if (!baseShift) return;

    const targetSession =
      baseShift.session;

    const targetRole =
      baseShift._positionName;

    if (
      groupId.startsWith('FA') &&
      CORE_ROLES.includes(
        targetRole
      )
    ) {
      return;
    }

    const unassignedFamily =
      members.filter(
        m =>
          m.id !== baseMember.id &&
          state.memberGroups[m.id] ===
            groupId &&
          this._isAvailableOnDate(
            m,
            context.dateStr
          ) &&
          !(
            context.dailyAssignments[
              m.id
            ] &&
            context.dailyAssignments[
              m.id
            ].length > 0
          )
      );

    if (
      unassignedFamily.length === 0
    ) {
      return;
    }

    unassignedFamily.forEach(
      famMember => {

        let assigned = false;

        const availableSlots =
          context.availableSlots.filter(
            s =>
              s.session ===
                targetSession &&
              s.needed > 0
          );

        for (
          const slot of availableSlots
        ) {

          if (
            groupId.startsWith('FA') &&
            slot.roleName !== targetRole
          ) {
            continue;
          }

          if (
            this._canAssign(
              famMember,
              slot,
              state,
              context,
              0,
              false
            )
          ) {

            this._assign(
              famMember,
              slot,
              state,
              context
            );

            assigned = true;

            break;
          }
        }

        /*
         * 若同堂無法，再嘗試另一堂
         */
        if (!assigned) {

          const otherSlots =
            context.availableSlots.filter(
              s =>
                s.session !==
                  targetSession &&
                s.needed > 0
            );

          for (
            const slot of otherSlots
          ) {

            if (
              groupId.startsWith('FA') &&
              slot.roleName !== targetRole
            ) {
              continue;
            }

            if (
              this._canAssign(
                famMember,
                slot,
                state,
                context,
                0,
                false
              )
            ) {

              this._assign(
                famMember,
                slot,
                state,
                context
              );

              assigned = true;

              break;
            }
          }
        }

      }
    );
  },

  /* =========================================================
   * Deacon
   * ======================================================= */

  _assignDeacons(
    state,
    context,
    members,
    deaconId
  ) {

    if (!deaconId) return;

    const slots =
      context.availableSlots.filter(
        s =>
          s.posId === deaconId
      );

    if (
      slots.length === 0
    ) {
      return;
    }

    let limit = 0;

    while (
      slots.some(
        s => s.needed > 0
      ) &&
      limit < 10
    ) {

      const neededSlots =
        slots.filter(
          s => s.needed > 0
        );

      const eligible =
        members.filter(
          m => {

            const currentUsage =
              state.roleUsage[m.id]?.[
                deaconId
              ] || 0;

            if (
              currentUsage +
              neededSlots.length >
              4
            ) {
              return false;
            }

            /*
             * 執事必須兩堂都能吃下
             */
            return neededSlots.every(
              s =>
                this._canAssign(
                  m,
                  s,
                  state,
                  context,
                  0,
                  true,
                  {
                    isDualPlan: true,
                    ignoreReservation: true
                  }
                )
            );
          }
        );

      if (
        eligible.length === 0
      ) {
        break;
      }

      const scored =
        eligible.map(
          m => ({
            m,
            score:
              this._getScore(
                m,
                neededSlots[0],
                state,
                context,
                members
              )
          })
        );

      scored.sort(
        (a, b) =>
          this._compareScore(
            a.score,
            b.score
          )
      );

      const best =
        scored[0].m;

      neededSlots.forEach(
        slot =>
          this._assign(
            best,
            slot,
            state,
            context
          )
      );

      limit++;
    }
  },

  /* =========================================================
   * Family Groups
   * ======================================================= */

  _assignFamilyGroups(
    state,
    context,
    members,
    specialIds
  ) {

    const activeMembers =
      members.filter(
        m =>
          ![
            '暫停服事',
            '安息季'
          ].includes(
            m.availability_status
          )
      );

    const avgUsage =
      activeMembers.length > 0
        ? activeMembers.reduce(
            (sum, m) =>
              sum +
              (state.totalUsage[m.id] || 0),
            0
          ) /
          activeMembers.length
        : 0;

    const groups = {};

    members.forEach(
      m => {

        const gid =
          state.memberGroups[m.id];

        if (
          gid &&
          (
            gid.startsWith('FA') ||
            gid.startsWith('FB')
          )
        ) {

          if (
            state.lastServedWeek[m.id] ===
              context.weekIndex - 1
          ) {
            /*
             * 不直接禁止，
             * 但讓 Dual Plan 優先處理。
             */
          }

          if (
            (context.dailyAssignments[
              m.id
            ] || []).length > 0
          ) {
            return;
          }

          if (
            this._isAvailableOnDate(
              m,
              context.dateStr
            )
          ) {

            if (!groups[gid]) {
              groups[gid] = [];
            }

            groups[gid].push(m);
          }
        }
      }
    );

    const sortedGroupIds =
      Object.keys(groups).sort(
        (a, b) => {

          const avgA =
            groups[a].reduce(
              (s, m) =>
                s +
                (state.totalUsage[m.id] || 0),
              0
            ) /
            groups[a].length;

          const avgB =
            groups[b].reduce(
              (s, m) =>
                s +
                (state.totalUsage[m.id] || 0),
              0
            ) /
            groups[b].length;

          return avgA - avgB;
        }
      );

    for (
      const gid of sortedGroupIds
    ) {

      const gMembers =
        groups[gid];

      if (
        gMembers.length < 2
      ) {
        continue;
      }

      gMembers.sort(
        (a, b) => {

          const aCore =
            specialIds &&
            (
              state.memberSkills[a.id]
                ?.has(specialIds.mc) ||
              state.memberSkills[a.id]
                ?.has(specialIds.ppt) ||
              state.memberSkills[a.id]
                ?.has(specialIds.deacon)
            )
              ? 1
              : 0;

          const bCore =
            specialIds &&
            (
              state.memberSkills[b.id]
                ?.has(specialIds.mc) ||
              state.memberSkills[b.id]
                ?.has(specialIds.ppt) ||
              state.memberSkills[b.id]
                ?.has(specialIds.deacon)
            )
              ? 1
              : 0;

          return bCore - aCore;
        }
      );

      const isFA =
        gid.startsWith('FA');

      let placed = false;

      const m0 =
        gMembers[0];

      for (
        const sess of sessionsToSchedule
      ) {

        for (
          const role of roleOrder
        ) {

          const slot0 =
            context.availableSlots.find(
              s =>
                s.session === sess &&
                s.roleName === role &&
                s.needed > 0 &&
                !this._isSlotReserved(
                  state,
                  context.dateStr,
                  s.session,
                  s.posId
                )
            );

          if (
            !slot0
          ) {
            continue;
          }

          if (
            !this._canAssign(
              m0,
              slot0,
              state,
              context,
              0,
              true
            )
          ) {
            continue;
          }

          if (
            isFA &&
            CORE_ROLES.includes(role)
          ) {

            this._assign(
              m0,
              slot0,
              state,
              context
            );

            placed = true;
            break;
          }

          let allCanBePlaced =
            true;

          const plannedSlots = [
            {
              member: m0,
              slot: slot0
            }
          ];

          const familyRoles =
            new Set([role]);

          for (
            let i = 1;
            i < gMembers.length;
            i++
          ) {

            const m =
              gMembers[i];

            let found =
              false;

            const targetSessions = [
              sess,
              sess === '第一堂'
                ? '第二堂'
                : '第一堂'
            ];

            for (
              const tSess of
              targetSessions
            ) {

              for (
                const tRole of roleOrder
              ) {

                if (
                  isFA &&
                  !familyRoles.has(
                    tRole
                  )
                ) {
                  continue;
                }

                const slotN =
                  context.availableSlots.find(
                    s =>
                      s.session === tSess &&
                      s.roleName === tRole &&
                      s.needed > 0 &&
                      !this._isSlotReserved(
                        state,
                        context.dateStr,
                        s.session,
                        s.posId
                      )
                  );

                if (
                  !slotN
                ) {
                  continue;
                }

                const plannedCount =
                  plannedSlots.filter(
                    ps =>
                      ps.slot === slotN
                  ).length;

                if (
                  slotN.needed -
                    plannedCount <= 0
                ) {
                  continue;
                }

                if (
                  this._canAssign(
                    m,
                    slotN,
                    state,
                    context,
                    0,
                    true
                  )
                ) {

                  plannedSlots.push({
                    member: m,
                    slot: slotN
                  });

                  familyRoles.add(
                    tRole
                  );

                  found = true;

                  break;
                }
              }

              if (found) break;
            }

            if (!found) {
              allCanBePlaced = false;
              break;
            }
          }

          if (allCanBePlaced) {

            plannedSlots.forEach(
              plan =>
                this._assign(
                  plan.member,
                  plan.slot,
                  state,
                  context
                )
            );

            placed = true;
            break;
          }
        }

        if (placed) break;
      }
    }
  },

  /* =========================================================
   * Family Enforce
   * ======================================================= */

  _enforceFamily(
    state,
    context,
    members
  ) {

    const groups = {};

    members.forEach(
      m => {

        if (
          m.group_id &&
          (
            m.group_id.startsWith('FA') ||
            m.group_id.startsWith('FB')
          )
        ) {

          if (
            this._isAvailableOnDate(
              m,
              context.dateStr
            )
          ) {

            if (
              !groups[m.group_id]
            ) {
              groups[m.group_id] = [];
            }

            groups[m.group_id]
              .push(m);
          }
        }
      }
    );

    Object.keys(groups)
      .forEach(
        gid => {

          const gMembers =
            groups[gid];

          if (
            gMembers.length < 2
          ) {
            return;
          }

          const assignedMembers =
            gMembers.filter(
              m =>
                context.dailyAssignments[
                  m.id
                ] &&
                context.dailyAssignments[
                  m.id
                ].length > 0
            );

          const unassignedMembers =
            gMembers.filter(
              m =>
                !(
                  context.dailyAssignments[
                    m.id
                  ] &&
                  context.dailyAssignments[
                    m.id
                  ].length > 0
                )
            );

          if (
            assignedMembers.length === 0 ||
            unassignedMembers.length === 0
          ) {
            return;
          }

          const firstAssigned =
            assignedMembers[0];

          const assignedRoles =
            context.dailyAssignments[
              firstAssigned.id
            ] || [];

          if (
            assignedRoles.some(
              r =>
                CORE_ROLES.includes(r)
            )
          ) {
            return;
          }

          const firstShift =
            state.draft.find(
              d =>
                !d.is_empty &&
                d.service_date ===
                  context.dateStr &&
                d.member_id ===
                  firstAssigned.id
            );

          if (!firstShift) {
            return;
          }

          const targetSession =
            firstShift.session;

          unassignedMembers.sort(
            (a, b) =>
              (
                state.totalUsage[a.id] || 0
              ) -
              (
                state.totalUsage[b.id] || 0
              )
          );

          unassignedMembers.forEach(
            unM => {

              let assigned = false;

              const targetSlots =
                context.availableSlots.filter(
                  s =>
                    s.session ===
                      targetSession &&
                    s.needed > 0 &&
                    !this._isSlotReserved(
                      state,
                      context.dateStr,
                      s.session,
                      s.posId
                    )
                );

              for (
                const s of targetSlots
              ) {

                if (
                  this._canAssign(
                    unM,
                    s,
                    state,
                    context,
                    0,
                    true
                  )
                ) {

                  this._assign(
                    unM,
                    s,
                    state,
                    context
                  );

                  assigned = true;

                  break;
                }
              }

              /*
               * 另一堂
               */
              if (!assigned) {

                const otherSlots =
                  context.availableSlots.filter(
                    s =>
                      s.session !==
                        targetSession &&
                      s.needed > 0 &&
                      !this._isSlotReserved(
                        state,
                        context.dateStr,
                        s.session,
                        s.posId
                      )
                  );

                for (
                  const s of otherSlots
                ) {

                  if (
                    this._canAssign(
                      unM,
                      s,
                      state,
                      context,
                      0,
                      true
                    )
                  ) {

                    this._assign(
                      unM,
                      s,
                      state,
                      context
                    );

                    assigned = true;

                    break;
                  }
                }
              }

              /*
               * 如果家庭補位失敗：
               * 不強制 swap Dual Plan。
               *
               * 這是 V22 的重要保護。
               */
            }
          );
        }
      );
  },

  /* =========================================================
   * Dual Repair
   * ======================================================= */

  _repairDualService(
    state,
    context,
    members
  ) {

    const dualMembers =
      members.filter(
        m =>
          (
            this._getDualPref(m) === 1 ||
            this._getDualPref(m) === 2
          ) &&
          this._isAvailableOnDate(
            m,
            context.dateStr
          )
      );

    dualMembers.forEach(
      member => {

        const dayShifts =
          this._getDayShifts(
            state,
            context,
            member.id
          );

        /*
         * 已完成二堂
         */
        if (
          dayShifts.length >= 2
        ) {
          return;
        }

        /*
         * 如果目前只有一堂：
         * 優先補另一堂。
         */
        if (
          dayShifts.length === 1
        ) {

          const pref =
            this._getDualPref(
              member
            );

          const current =
            dayShifts[0];

          if (
            CORE_ROLES.includes(
              current._positionName
            )
          ) {
            return;
          }

          const targetSession =
            current.session ===
              '第一堂'
              ? '第二堂'
              : '第一堂';

          const targetSlots =
            context.availableSlots.filter(
              s =>
                s.session ===
                  targetSession &&
                s.needed > 0 &&
                COMBO_ROLES.includes(
                  s.roleName
                ) &&
                !this._isSlotReserved(
                  state,
                  context.dateStr,
                  s.session,
                  s.posId,
                  member.id
                )
            );

          let target = null;

          if (
            pref === DUAL_SAME_ROLE
          ) {

            target =
              targetSlots.find(
                s =>
                  s.roleName ===
                    current._positionName &&
                  this._canAssign(
                    member,
                    s,
                    state,
                    context,
                    0,
                    true
                  )
              );

          } else {

            target =
              targetSlots.find(
                s =>
                  s.roleName !==
                    current._positionName &&
                  this._canAssign(
                    member,
                    s,
                    state,
                    context,
                    0,
                    true
                  )
              );
          }

          if (target) {

            this._assign(
              member,
              target,
              state,
              context
            );

            const audit =
              state.dualAudit.byMember[
                member.id
              ];

            if (audit) {
              audit.fulfilled = true;
              audit.type =
                pref === 1
                  ? 'SAME_ROLE'
                  : 'DIFF_ROLE';
            }
          }
        }

        /*
         * 如果仍然沒有二堂，
         * 不做破壞性 swap。
         */
      }
    );
  },

  /* =========================================================
   * Force Swap
   * ======================================================= */

  _forceSwapForFamily(
    unM,
    baseMember,
    state,
    context,
    members
  ) {

    /*
     * V22：
     * 不允許家庭補位任意拆掉 Dual Plan。
     */

    const todayShifts =
      state.draft.filter(
        d =>
          !d.is_empty &&
          d.service_date ===
            context.dateStr &&
          d.member_id !== unM.id &&
          d.member_id !==
            baseMember.id
      );

    let bestSwap = null;
    let bestScore = -Infinity;

    for (
      const shift of todayShifts
    ) {

      if (
        CORE_ROLES.includes(
          shift._positionName
        )
      ) {
        continue;
      }

      /*
       * 不拆二堂人
       */
      const victimDayShifts =
        this._getDayShifts(
          state,
          context,
          shift.member_id
        );

      if (
        victimDayShifts.length >= 2
      ) {
        continue;
      }

      const victim =
        members.find(
          m =>
            m.id ===
            shift.member_id
        );

      if (!victim) continue;

      const mockSlot = {
        roleName:
          shift._positionName,
        session:
          shift.session,
        posId:
          shift.position_id,
        needed: 1,
        assigned: []
      };

      if (
        !this._canAssign(
          unM,
          mockSlot,
          state,
          context,
          0,
          true
        )
      ) {
        continue;
      }

      const victimGroupId =
        state.memberGroups[
          victim.id
        ];

      if (
        victimGroupId &&
        (
          victimGroupId.startsWith('FA') ||
          victimGroupId.startsWith('FB')
        )
      ) {
        continue;
      }

      const score =
        (
          state.totalUsage[victim.id] || 0
        ) -
        (
          state.totalUsage[unM.id] || 0
        );

      if (
        score > bestScore
      ) {

        bestScore = score;

        bestSwap = {
          shift,
          victim,
          mockSlot
        };
      }
    }

    if (bestSwap) {

      this._replaceAssignment(
        unM,
        bestSwap.victim.id,
        bestSwap.shift.temp_id,
        bestSwap.mockSlot,
        state,
        context
      );
    }
  },

  _replaceAssignment(
    newMember,
    oldMemberId,
    targetTempId,
    slotInfo,
    state,
    context
  ) {

    const draftIdx =
      state.draft.findIndex(
        d =>
          d.temp_id ===
          targetTempId
      );

    if (
      draftIdx === -1
    ) {
      return;
    }

    state.totalUsage[
      oldMemberId
    ] = Math.max(
      0,
      state.totalUsage[
        oldMemberId
      ] - 1
    );

    if (
      state.roleUsage[
        oldMemberId
      ][slotInfo.posId]
    ) {

      state.roleUsage[
        oldMemberId
      ][slotInfo.posId]--;

    }

    if (
      context.dailyAssignments[
        oldMemberId
      ]
    ) {

      const dailyIdx =
        context.dailyAssignments[
          oldMemberId
        ].indexOf(
          slotInfo.roleName
        );

      if (
        dailyIdx > -1
      ) {
        context.dailyAssignments[
          oldMemberId
        ].splice(
          dailyIdx,
          1
        );
      }

      if (
        context.dailyAssignments[
          oldMemberId
        ].length === 0
      ) {

        state.totalDays[
          oldMemberId
        ] =
          Math.max(
            0,
            (
              state.totalDays[
                oldMemberId
              ] || 0
            ) - 1
          );
      }
    }

    if (
      !context.dailyAssignments[
        newMember.id
      ] ||
      context.dailyAssignments[
        newMember.id
      ].length === 0
    ) {

      state.totalDays[
        newMember.id
      ] =
        (
          state.totalDays[
            newMember.id
          ] || 0
        ) + 1;
    }

    state.totalUsage[
      newMember.id
    ] =
      (
        state.totalUsage[
          newMember.id
        ] || 0
      ) + 1;

    state.roleUsage[
      newMember.id
    ][slotInfo.posId] =
      (
        state.roleUsage[
          newMember.id
        ][slotInfo.posId
        ] || 0
      ) + 1;

    state.lastServedWeek[
      newMember.id
    ] = context.weekIndex;

    if (
      !context.dailyAssignments[
        newMember.id
      ]
    ) {
      context.dailyAssignments[
        newMember.id
      ] = [];
    }

    context.dailyAssignments[
      newMember.id
    ].push(
      slotInfo.roleName
    );

    state.draft[
      draftIdx
    ].member_id =
      newMember.id;

    state.draft[
      draftIdx
    ]._memberName =
      newMember.name;

    state.draft[
      draftIdx
    ].is_emergency = 2;
  },

  /* =========================================================
   * Assign
   * ======================================================= */

  _assign(
    m,
    slot,
    state,
    context,
    isEmergency = 0,
    isDualPlan = false
  ) {

    if (
      slot.needed <= 0
    ) {
      return;
    }

    slot.assigned.push(m);

    slot.needed--;

    /*
     * ★ totalDays：
     * 同一天第一堂 + 第二堂只算一天。
     */
    if (
      !context.dailyAssignments[m.id] ||
      context.dailyAssignments[m.id]
        .length === 0
    ) {

      state.totalDays[m.id] =
        (
          state.totalDays[m.id] || 0
        ) + 1;
    }

    state.totalUsage[m.id] =
      (
        state.totalUsage[m.id] || 0
      ) + 1;

    state.roleUsage[m.id][
      slot.posId
    ] =
      (
        state.roleUsage[m.id][
          slot.posId
        ] || 0
      ) + 1;

    state.lastServedWeek[m.id] =
      context.weekIndex;

    if (
      !context.dailyAssignments[
        m.id
      ]
    ) {
      context.dailyAssignments[
        m.id
      ] = [];
    }

    context.dailyAssignments[
      m.id
    ].push(
      slot.roleName
    );

    state.draft.push({

      temp_id:
        `T_${context.dateStr}_${slot.session}_${slot.posId}_${Math.random()}`,

      service_date:
        context.dateStr,

      session:
        slot.session,

      member_id:
        m.id,

      position_id:
        slot.posId,

      _memberName:
        m.name,

      _positionName:
        slot.roleName,

      is_emergency:
        isEmergency,

      is_dual_service:
        isDualPlan
    });
  },

  /* =========================================================
   * Empty Warning
   * ======================================================= */

  _fillEmptyWarnings(
    state,
    context
  ) {

    context.availableSlots.forEach(
      slot => {

        while (
          slot.needed > 0
        ) {

          state.draft.push({

            temp_id:
              `EMPTY_${context.dateStr}_${slot.session}_${slot.posId}_${Math.random()}`,

            service_date:
              context.dateStr,

            session:
              slot.session,

            member_id:
              'EMPTY_SLOT',

            position_id:
              slot.posId,

            _memberName:
              '⚠️ 人工指派',

            _positionName:
              slot.roleName,

            is_empty:
              true
          });

          slot.needed--;
        }
      }
    );
  },

  /* =========================================================
   * Dual Audit
   * ======================================================= */

  _finalizeDualAudit(
    state,
    members
  ) {

    Object.keys(
      state.dualAudit.byMember
    ).forEach(
      memberId => {

        const audit =
          state.dualAudit.byMember[
            memberId
          ];

        if (
          audit.fulfilled
        ) {
          return;
        }

        const shifts =
          state.draft.filter(
            d =>
              !d.is_empty &&
              d.member_id ===
                memberId &&
              d.service_date ===
                audit.date
          );

        if (
          shifts.length === 0
        ) {

          audit.failure_reason =
            '當日沒有可行服事組合';

        } else if (
          shifts.length === 1
        ) {

          audit.failure_reason =
            '只找到一堂可行名額，另一堂無法完成';

        } else {

          audit.fulfilled = true;
        }

        state.dualAudit.failed.push(
          audit
        );
      }
    );

    /*
     * 修正 fulfilled 計數
     */
    state.dualAudit.fulfilled =
      Object.values(
        state.dualAudit.byMember
      ).filter(
        x => x.fulfilled
      ).length;

    state.dualAudit.sameRoleFulfilled =
      Object.values(
        state.dualAudit.byMember
      ).filter(
        x =>
          x.fulfilled &&
          x.preference === 1
      ).length;

    state.dualAudit.diffRoleFulfilled =
      Object.values(
        state.dualAudit.byMember
      ).filter(
        x =>
          x.fulfilled &&
          x.preference === 2
      ).length;
  },

  /* =========================================================
   * Visual Flags
   * ======================================================= */

  _applyVisualFlags(
    draft,
    members
  ) {

    const memberGroups = {};

    members.forEach(
      m => {

        if (m.group_id) {
          memberGroups[m.id] =
            String(m.group_id);
        }

      }
    );

    const shiftsByDate = {};

    draft.forEach(
      d => {

        if (d.is_empty) {
          return;
        }

        if (
          !shiftsByDate[
            d.service_date
          ]
        ) {
          shiftsByDate[
            d.service_date
          ] = [];
        }

        shiftsByDate[
          d.service_date
        ].push(d);
      }
    );

    Object.keys(
      shiftsByDate
    ).forEach(
      dateStr => {

        const dayShifts =
          shiftsByDate[
            dateStr
          ];

        const freq = {};

        const groupFreq = {};

        const groupActiveMembersCount =
          {};

        dayShifts.forEach(
          d => {

            freq[d.member_id] =
              (
                freq[d.member_id] || 0
              ) + 1;

            const gid =
              memberGroups[
                d.member_id
              ];

            if (
              gid &&
              (
                gid.startsWith('FA') ||
                gid.startsWith('FB')
              )
            ) {

              if (
                !groupFreq[gid]
              ) {
                groupFreq[gid] =
                  new Set();
              }

              groupFreq[gid]
                .add(
                  d.member_id
                );

              if (
                !groupActiveMembersCount[
                  gid
                ]
              ) {

                groupActiveMembersCount[
                  gid
                ] =
                  members.filter(
                    m =>
                      memberGroups[m.id] ===
                        gid &&
                      this._isAvailableOnDate(
                        m,
                        dateStr
                      )
                  ).length;
              }
            }
          }
        );

        dayShifts.forEach(
          d => {

            /*
             * 同日二堂
             */
            if (
              freq[d.member_id] >= 2
            ) {
              d.is_duplicate = true;
            }

            const gid =
              memberGroups[
                d.member_id
              ];

            if (
              gid &&
              groupFreq[gid]
            ) {

              const activeCount =
                groupActiveMembersCount[
                  gid
                ] || 0;

              if (
                activeCount > 1 &&
                groupFreq[gid].size < 2
              ) {

                if (
                  !CORE_ROLES.includes(
                    d._positionName
                  )
                ) {

                  d.is_lonely_family =
                    true;
                }
              }
            }
          }
        );
      }
    );
  },

  /* =========================================================
   * Final Sort
   * ======================================================= */

  _sortFinalDraft(
    draft,
    members
  ) {

    const getRule =
      m => {

        if (
          !m ||
          m.newcomer_rule == null
        ) {
          return 0;
        }

        const val =
          m.newcomer_rule;

        if (
          val === 1 ||
          val === '1'
        ) {
          return 1;
        }

        return 0;
      };

    draft.sort(
      (a, b) => {

        if (
          a.service_date !==
          b.service_date
        ) {

          return a.service_date
            .localeCompare(
              b.service_date
            );
        }

        if (
          a.session !==
          b.session
        ) {

          return a.session ===
            '第一堂'
            ? -1
            : 1;
        }

        if (
          a._positionName !==
          b._positionName
        ) {

          return a._positionName
            .localeCompare(
              b._positionName
            );
        }

        if (
          a._positionName ===
          '新朋友關懷'
        ) {

          const memA =
            members.find(
              m =>
                m.id ===
                a.member_id
            );

          const memB =
            members.find(
              m =>
                m.id ===
                b.member_id
            );

          const ruleA =
            getRule(memA);

          const ruleB =
            getRule(memB);

          const prioA =
            ruleA === 1 ? 1 : 0;

          const prioB =
            ruleB === 1 ? 1 : 0;

          if (
            prioA !== prioB
          ) {
            return prioB - prioA;
          }

          if (
            a.is_empty !==
            b.is_empty
          ) {
            return a.is_empty
              ? 1
              : -1;
          }

          if (
            !a.is_empty &&
            !b.is_empty
          ) {

            return (
              a._memberName || ''
            ).localeCompare(
              b._memberName || ''
            );
          }
        }

        if (
          a.is_empty !==
          b.is_empty
        ) {

          return a.is_empty
            ? 1
            : -1;
        }

        return 0;
      }
    );
  }
};


/* =========================================================
 * Export
 * ======================================================= */

if (
  typeof window !== 'undefined'
) {

  window.ScheduleEngine =
    ScheduleEngine;

} else if (
  typeof module !== 'undefined'
) {

  module.exports =
    ScheduleEngine;
}
```
