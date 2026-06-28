import React, { useState, useEffect, useMemo } from 'react';
import { 
    Home, Users, Calendar, LogOut, BarChart3, ChevronLeft, 
    UserCheck, LayoutList, TrendingUp, Lightbulb, X, Target, 
    Zap, UserPlus, AlertCircle, CheckCircle2,
    UsersRound, Settings
} from 'lucide-react';

// ==========================================
// 崗位需求預設設定參數
// ==========================================
const INITIAL_REQUIREMENTS = {
    '司會': { singleSession: 1, freq: 'weekly' },
    '執事輪值': { singleSession: 1, freq: 'weekly' },
    'PPT': { singleSession: 1, freq: 'weekly' },
    '新朋友關懷': { singleSession: 3, freq: 'weekly' },
    '接待': { singleSession: 4, freq: 'weekly' },
    '收奉獻': { singleSession: 5, freq: 'weekly' },
    '主餐': { singleSession: 6, freq: 'monthly' }
};

const INITIAL_POLICY_LIMITS = {
    '司會': 6, '執事輪值': 6, 'PPT': 6,
    '新朋友關懷': 6, '接待': 6, '收奉獻': 6, '主餐': 3
};

const COMPATIBLE_GROUP = ['新朋友關懷', '主餐', '接待', '收奉獻'];

const POSITION_ORDER = [
    '新朋友關懷', '接待', '收奉獻', '主餐', '司會', 'PPT', '執事輪值'
];

const getPrevQuarter = (qStr) => {
    if (!qStr || qStr === 'BASE' || qStr === 'SYSTEM') return null;
    let [y, q] = qStr.split('-Q').map(Number);
    if (q === 1) return `${y - 1}-Q4`;
    return `${y}-Q${q - 1}`;
};

const getYoYQuarter = (qStr) => {
    if (!qStr || qStr === 'BASE' || qStr === 'SYSTEM') return null;
    let [y, q] = qStr.split('-Q').map(Number);
    return `${y - 1}-Q${q}`;
};

const DiffCell = ({ diff }) => {
    const baseClass = "px-2 py-2.5 text-center text-[12px] font-bold border-b border-slate-100/50";
    if (diff === null || diff === undefined) return <td className={`${baseClass} text-slate-300`}>-</td>;
    if (diff > 0) return <td className={`${baseClass} text-rose-500`}>↑ {diff} 人</td>;
    if (diff < 0) return <td className={`${baseClass} text-emerald-500`}>↓ {Math.abs(diff)} 人</td>;
    return <td className={`${baseClass} text-slate-400 font-medium`}>- 0 人</td>;
};

const FteTooltip = () => (
    <div className="relative group cursor-help ml-1 inline-flex items-center">
        <span className="text-[10px] text-slate-400 font-normal border border-slate-300 rounded-full w-3.5 h-3.5 flex items-center justify-center group-hover:bg-indigo-100 group-hover:text-indigo-600 group-hover:border-indigo-300 transition-colors">?</span>
        <div className="absolute z-50 hidden group-hover:block w-[320px] p-4 bg-slate-800 text-slate-50 text-[12px] leading-relaxed rounded-xl shadow-2xl top-full left-1/2 -translate-x-1/2 mt-2 text-left font-normal normal-case pointer-events-none border border-slate-700">
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-slate-800"></div>
            <div className="font-bold text-white mb-2 pb-2 border-b border-slate-600">
                FTE（人力貢獻值）：同工對單一崗位的實際貢獻度
            </div>
            <div className="space-y-1">
                <div className="text-slate-300">
                    FTE = 1 ÷ 同日服事崗位數
                </div>
                <div className="text-slate-400 text-[11px] bg-slate-900/50 p-2 mt-2 rounded border border-slate-600">
                    <strong className="text-rose-300">範例：</strong>服事 1 個崗位 = 1.0 FTE；服事 2 個崗位 = 各 0.5 FTE。
                </div>
            </div>
        </div>
    </div>
);

const TeamInsights = ({ session, goBack, goToMembers, goToSchedule, supabase, utils }) => {
    const { fetchAllData, getCurrentQuarter } = utils;
    
    const [isLoading, setIsLoading] = useState(true);
    const [availableQuarters, setAvailableQuarters] = useState([]);
    const [viewQuarter, setViewQuarter] = useState('');
    const [dbData, setDbData] = useState({ members: [], positions: [], memberPositions: [], quarterSettings: [] });

    const [requirements, setRequirements] = useState(INITIAL_REQUIREMENTS);
    const [policyLimits, setPolicyLimits] = useState(INITIAL_POLICY_LIMITS);
    const [drawerPos, setDrawerPos] = useState(null);
    
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [tempLimits, setTempLimits] = useState(INITIAL_POLICY_LIMITS);

    const handleUpdateReq = (posName, delta) => {
        setRequirements(prev => {
            const current = prev[posName] || { singleSession: 0, freq: 'weekly' };
            const newValue = Math.max(0, current.singleSession + delta);
            return { ...prev, [posName]: { ...current, singleSession: newValue } };
        });
    };

    const toggleDrawer = (posName) => setDrawerPos(prev => prev === posName ? null : posName);

    useEffect(() => {
        const fetchQuarters = async () => {
            try {
                const { data } = await supabase.from('member_quarter_settings').select('quarter');
                if (data) {
                    const qs = [...new Set(data.map(d => d.quarter))].filter(q => q !== 'SYSTEM' && q !== 'BASE').sort().reverse();
                    if (qs.length > 0) { setAvailableQuarters(qs); setViewQuarter(qs[0]); } 
                    else { const currentQ = getCurrentQuarter(); setAvailableQuarters([currentQ]); setViewQuarter(currentQ); }
                }
            } catch (err) { console.error('抓取季度失敗', err); }
        };
        fetchQuarters();
    }, []);

    useEffect(() => {
        const loadQuarterData = async () => {
            setIsLoading(true);
            try {
                const [ { data: mData }, { data: pData }, { data: mpData }, { data: qsData } ] = await Promise.all([
                    fetchAllData(() => supabase.from('members').select('*').order('name')),
                    fetchAllData(() => supabase.from('positions').select('*').order('id')),
                    fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', viewQuarter)),
                    fetchAllData(() => supabase.from('member_quarter_settings').select('*')) 
                ]);
                setDbData({ members: mData || [], positions: pData || [], memberPositions: mpData || [], quarterSettings: qsData || [] });
            } catch (err) { console.error('載入洞察資料失敗', err); } 
            finally { setIsLoading(false); }
        };
        loadQuarterData();
    }, [viewQuarter]);

    const matrixStats = useMemo(() => {
        if (dbData.members.length === 0 || availableQuarters.length === 0) return [];
        const realMembers = dbData.members.filter(m => !m.name.startsWith('SYSTEM_'));
        const { quarterSettings } = dbData;

        const getQuarterStat = (qStr) => {
            if (!qStr) return null;
            const hasData = quarterSettings.some(qs => qs.quarter === qStr);
            if (!hasData) return null;

            let suspended = 0, sabbatical = 0;
            const qsMap = {};
            quarterSettings.forEach(qs => { if(qs.quarter === qStr) qsMap[qs.member_id] = qs; });

            realMembers.forEach(m => {
                const status = qsMap[m.id]?.availability_status || '穩定服事';
                if (status === '暫停服事') suspended++;
                else if (status === '安息季') sabbatical++;
            });

            return { total: realMembers.length, active: realMembers.length - suspended - sabbatical, suspended, sabbatical };
        };

        return availableQuarters.map(qStr => {
            const current = getQuarterStat(qStr) || { total: 0, active: 0, suspended: 0, sabbatical: 0 };
            const qoqStat = getQuarterStat(getPrevQuarter(qStr));
            const yoyStat = getQuarterStat(getYoYQuarter(qStr));
            const calcDiff = (currVal, pastStat, key) => pastStat ? (currVal - pastStat[key]) : null;

            return {
                quarter: qStr,
                total: current.total, totalQoQ: calcDiff(current.total, qoqStat, 'total'), totalYoY: calcDiff(current.total, yoyStat, 'total'),
                active: current.active, activeQoQ: calcDiff(current.active, qoqStat, 'active'), activeYoY: calcDiff(current.active, yoyStat, 'active'),
                suspended: current.suspended, suspendedQoQ: calcDiff(current.suspended, qoqStat, 'suspended'), suspendedYoY: calcDiff(current.suspended, yoyStat, 'suspended'),
                sabbatical: current.sabbatical, sabbaticalQoQ: calcDiff(current.sabbatical, qoqStat, 'sabbatical'), sabbaticalYoY: calcDiff(current.sabbatical, yoyStat, 'sabbatical'),
            };
        });
    }, [dbData, availableQuarters]);

    const insights = useMemo(() => {
        const { members, positions, memberPositions, quarterSettings } = dbData;
        const realMembers = members.filter(m => !m.name.startsWith('SYSTEM_'));
        const qsMap = {};
        quarterSettings.forEach(qs => { if(qs.quarter === viewQuarter) qsMap[qs.member_id] = qs; });

        const activeMemberIds = new Set();
        realMembers.forEach(m => {
            const status = qsMap[m.id]?.availability_status || '穩定服事';
            if (status !== '暫停服事' && status !== '安息季') activeMemberIds.add(m.id);
        });

        let globalDemandSessions = 0;

        const rawPositions = positions.map(pos => {
            let s1Count = 0, s2Count = 0, bothCount = 0;
            let s1FTE = 0, s2FTE = 0, bothFTE = 0;
            
            realMembers.forEach(m => {
                if (!activeMemberIds.has(m.id)) return; 
                const hasPos = memberPositions.some(mp => mp.member_id === m.id && mp.position_id === pos.id && mp.is_active !== false);
                if (hasPos) {
                    // 核心物理法則：同一天站兩個崗位就算 2 次，因此 FTE 貢獻度被活躍崗位數平分
                    const activePosCount = memberPositions.filter(mp => mp.member_id === m.id && mp.is_active !== false).length;
                    const weight = 1 / (activePosCount || 1); 
                    const pref = qsMap[m.id]?.preferred_session || '第一堂';
                    if (pref === '第一堂') { s1Count++; s1FTE += weight; }
                    else if (pref === '第二堂') { s2Count++; s2FTE += weight; }
                    else { bothCount++; bothFTE += weight; }
                }
            });

            s1FTE = Math.round(s1FTE * 10) / 10;
            s2FTE = Math.round(s2FTE * 10) / 10;
            bothFTE = Math.round(bothFTE * 10) / 10;
            const totalCount = s1Count + s2Count + bothCount;
            const totalFTE = Math.round((s1FTE + s2FTE + bothFTE) * 10) / 10;

            const reqObj = requirements[pos.name] || { singleSession: 0, freq: 'weekly' };
            const currentReq = reqObj.singleSession;
            const policyLimit = policyLimits[pos.name] || 6;
            
            const demandSessions = currentReq * (reqObj.freq === 'monthly' ? 3 : 13) * 2; 
            globalDemandSessions += demandSessions;

            const requiredTotalFTE = demandSessions / policyLimit;
            const requiredPerSession = requiredTotalFTE / 2;

            // 🌟 內部消化：該崗位的「皆可池」優先自動填補本崗位第一/第二堂的缺額
            let rawS1Gap = currentReq > 0 ? (s1FTE - requiredPerSession) : s1FTE;
            let rawS2Gap = currentReq > 0 ? (s2FTE - requiredPerSession) : s2FTE;
            let pool = bothFTE;

            if (rawS1Gap < 0 && pool > 0) {
                const fill = Math.min(Math.abs(rawS1Gap), pool);
                rawS1Gap += fill;
                pool -= fill;
            }
            if (rawS2Gap < 0 && pool > 0) {
                const fill = Math.min(Math.abs(rawS2Gap), pool);
                rawS2Gap += fill;
                pool -= fill;
            }

            const displayS1Gap = Math.round(rawS1Gap * 10) / 10;
            const displayS2Gap = Math.round(rawS2Gap * 10) / 10;
            const displayRemainingBoth = Math.round(pool * 10) / 10;
            const displayGap = currentReq > 0 ? Math.round((displayS1Gap + displayS2Gap + displayRemainingBoth) * 10) / 10 : Math.round(totalFTE * 10) / 10;
            
            const s1ShortageSessions = displayS1Gap < 0 ? Math.abs(displayS1Gap) * policyLimit : 0;
            const s2ShortageSessions = displayS2Gap < 0 ? Math.abs(displayS2Gap) * policyLimit : 0;
            const totalShortageSessions = Math.round((s1ShortageSessions + s2ShortageSessions) * 10) / 10;
            
            const s1RecruitCount = Math.ceil(s1ShortageSessions / policyLimit);
            const s2RecruitCount = Math.ceil(s2ShortageSessions / policyLimit);
            const recruitCount = s1RecruitCount + s2RecruitCount;

            const totalQuarterSlots = demandSessions;
            const avgBurden = totalFTE > 0 ? (totalQuarterSlots / totalFTE) : totalQuarterSlots;
            const displayAvgBurden = Math.round(avgBurden * 10) / 10;
            const isOverloaded = displayAvgBurden > policyLimit;

            return { 
                id: pos.id, name: pos.name, s1Count, s2Count, bothCount, totalCount,
                s1FTE, s2FTE, bothFTE, totalFTE, displayS1Gap, displayS2Gap, displayRemainingBoth, displayGap,
                currentReq, policyLimit, demandSessions, shortageSessions: totalShortageSessions, 
                recruitCount, s1RecruitCount, s2RecruitCount, displayAvgBurden, isOverloaded
            };
        });

        let positionDistribution = [...rawPositions];

        positionDistribution.sort((a, b) => {
            const indexA = POSITION_ORDER.indexOf(a.name);
            const indexB = POSITION_ORDER.indexOf(b.name);
            return (indexA === -1 ? 99 : indexA) - (indexB === -1 ? 99 : indexB);
        });

        const activeMembersCount = activeMemberIds.size;
        const globalAvgBurden = activeMembersCount > 0 ? Math.round((globalDemandSessions / activeMembersCount) * 10) / 10 : 0;
        const recruitmentList = positionDistribution.filter(p => p.recruitCount > 0);

        const concurrencyMap = {};
        realMembers.forEach(m => {
            if (!activeMemberIds.has(m.id)) return;
            const realCount = memberPositions.filter(mp => mp.member_id === m.id && mp.is_active !== false).length;
            if (realCount > 0) concurrencyMap[realCount] = (concurrencyMap[realCount] || 0) + 1;
        });
        const concurrencyData = Object.keys(concurrencyMap).map(Number).sort((a, b) => a - b).map(count => ({ roles: count, people: concurrencyMap[count] }));
        const maxConcurrencyPeople = Math.max(0, ...concurrencyData.map(d => d.people));

        return { 
            positionDistribution, concurrencyData, maxConcurrencyPeople, activeMemberIds,
            globalAvgBurden, recruitmentList, globalDemandSessions 
        };
    }, [dbData, viewQuarter, requirements, policyLimits]);

    // 🎯 嚴謹的缺口：只加總紅字，破除跨崗調度的幻覺
    const globalGap = useMemo(() => {
        let gap = 0;
        insights.positionDistribution.forEach(p => {
            if (p.displayS1Gap < 0) gap += p.displayS1Gap;
            if (p.displayS2Gap < 0) gap += p.displayS2Gap;
        });
        return Math.round(gap * 10) / 10;
    }, [insights]);

    const dynamicGlobalLimit = useMemo(() => {
        let perfectTotalFTE = 0;
        let totalDemandSessions = 0;
        insights.positionDistribution.forEach(p => {
            perfectTotalFTE += (p.demandSessions / p.policyLimit);
            totalDemandSessions += p.demandSessions;
        });
        return perfectTotalFTE > 0 ? Math.round((totalDemandSessions / perfectTotalFTE) * 10) / 10 : 6.0;
    }, [insights]);

    const burdenHealthStatus = insights.globalAvgBurden > dynamicGlobalLimit 
        ? 'danger' 
        : (insights.globalAvgBurden === dynamicGlobalLimit ? 'warning' : 'healthy');

    const burdenStyles = {
        danger: { iconBg: 'bg-rose-100', iconText: 'text-rose-600', valText: 'text-rose-600', badge: 'bg-rose-50 text-rose-600 border border-rose-200', label: '危險' },
        warning: { iconBg: 'bg-amber-100', iconText: 'text-amber-600', valText: 'text-amber-600', badge: 'bg-amber-50 text-amber-600 border border-amber-200', label: '警戒' },
        healthy: { iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', valText: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-600 border border-emerald-200', label: '健康' }
    }[burdenHealthStatus];

    const saveSettings = () => {
        setPolicyLimits(tempLimits);
        setIsSettingsOpen(false);
    };

    const renderDrawerContent = () => {
        if (!drawerPos) return null;
        const posData = insights.positionDistribution.find(p => p.name === drawerPos);
        if (!posData) return null;

        const isCompat = COMPATIBLE_GROUP.includes(drawerPos);
        let potentialHelpersCount = 0;
        if (isCompat) {
            const { members, memberPositions, positions } = dbData;
            const realMembers = members.filter(m => !m.name.startsWith('SYSTEM_') && insights.activeMemberIds.has(m.id));
            realMembers.forEach(m => {
                const activePos = memberPositions.filter(mp => mp.member_id === m.id && mp.is_active !== false);
                if (activePos.length === 1) {
                    const pName = positions.find(p => p.id === activePos[0].position_id)?.name;
                    if (COMPATIBLE_GROUP.includes(pName) && pName !== drawerPos) potentialHelpersCount++;
                }
            });
        }

        const actionPlans = [];

        if (posData.currentReq > 1) {
            actionPlans.push({
                title: "減少崗位人力",
                icon: <UsersRound size={16} className="text-cyan-500" />,
                isPriority: true,
                content: (
                    <div className="text-sm text-slate-600 space-y-2">
                        <p><strong className="text-slate-700">📍 數據支持：</strong>單堂安排 {posData.currentReq} 人，負擔過重。</p>
                        <p><strong className="text-slate-700">👉 具體行動：</strong>單堂人力需求減少至 <strong className="text-cyan-600">{posData.currentReq - 1} 人</strong>。</p>
                        <p className="text-cyan-800 bg-cyan-50 p-2 rounded text-xs leading-relaxed"><strong className="font-bold">預期效益：</strong>降低同工的服事頻率與過勞風險。</p>
                    </div>
                )
            });
        }

        if (isCompat) {
            // 1. 先在這裡加上這行：動態計算要顯示的相容崗位
            const sourcePositions = COMPATIBLE_GROUP.filter(p => p !== drawerPos).join('、');

            actionPlans.push({
                title: "推動「崗位兼任」",
                icon: <Zap size={16} className={potentialHelpersCount > 0 ? "text-amber-500" : "text-slate-400"} />,
                isPriority: potentialHelpersCount > 0 && posData.currentReq <= 1,
                content: (
                    <div className="text-sm text-slate-600 space-y-2">
                        <p><strong className="text-slate-700">📍 數據支持：</strong>共有 <strong className="text-amber-600 text-base">{potentialHelpersCount} 位</strong> 同工屬於單一崗位。</p>
                        
                        {/* 2. 然後在這裡替換內文 */}
                        <p><strong className="text-slate-700">👉 具體行動：</strong>鼓勵同工 ({sourcePositions}) 解鎖新技能，兼任「{drawerPos}」。</p>
                        
                        <p className="text-amber-700 bg-amber-50 p-2 rounded text-xs leading-relaxed"><strong className="font-bold">預期效益：</strong>100%高效率轉換補齊人力缺口。</p>
                    </div>
                )
            });
        }

        if (posData.recruitCount > 0) {
            let detailArr = [];
            if (posData.s1RecruitCount > 0) detailArr.push(`第一堂 ${posData.s1RecruitCount}`);
            if (posData.s2RecruitCount > 0) detailArr.push(`第二堂 ${posData.s2RecruitCount}`);
            const detailText = detailArr.join(' / ');

            actionPlans.push({
                title: "招募新人",
                icon: <UserPlus size={16} className="text-emerald-500" />,
                isPriority: false,
                content: (
                    <div className="text-sm text-slate-600 space-y-2">
                        <p><strong className="text-slate-700">📍 數據支持：</strong>每人每季服事 {posData.policyLimit} 次，短缺 <strong className="text-rose-600">{posData.shortageSessions.toFixed(1)} 次</strong>。</p>
                        <p><strong className="text-slate-700">👉 具體行動：</strong>招募新人，共 <strong className="text-emerald-600 text-base">{posData.recruitCount} 位</strong> 。
                        <span className="block mt-1 text-emerald-700 bg-emerald-50 p-1.5 rounded text-xs font-bold">(需求：{detailText})</span>
                        </p>
                    </div>
                )
            });
        }

        return (
            <div className="h-full flex flex-col">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-50/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600"><Lightbulb size={20} /></div>
                        <h3 className="text-xl font-extrabold text-slate-800 tracking-tight">智能策略</h3>
                    </div>
                    <button onClick={() => setDrawerPos(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X size={20} /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                            <Target size={18} className="text-slate-500" />
                            <h4 className="font-bold text-slate-700 text-sm">人力診斷：<span className="text-indigo-600 text-base ml-1">【{drawerPos}】</span></h4>
                        </div>
                        {posData.displayGap < 0 ? (
                            <div>
                                <div className="text-2xl font-extrabold text-rose-600 mb-1 flex items-center gap-2">
                                    <AlertCircle size={22} />人力不足 ({posData.displayGap} FTE)
                                </div>
                                <p className="text-sm text-slate-600 leading-relaxed mt-2">
                                    依 <strong className="text-slate-800">{posData.policyLimit} 次/季</strong> 計算，人力緊急待補。
                                </p>
                            </div>
                        ) : posData.displayGap === 0 ? (
                            <div>
                                <div className="text-2xl font-extrabold text-slate-500 mb-1 flex items-center gap-2">
                                    <CheckCircle2 size={22} />人力平衡 (0.0 FTE)
                                </div>
                                <p className="text-sm text-slate-600 leading-relaxed mt-2">
                                    人力正常！若有同工暫停服事或休假，可能造成短期人力不足。
                                </p>
                            </div>
                        ) : (
                            <div>
                                <div className="text-2xl font-extrabold text-emerald-500 mb-1 flex items-center gap-2">
                                    <CheckCircle2 size={22} />人力充足 (+{posData.displayGap} FTE)
                                </div>
                                <p className="text-sm text-slate-600 leading-relaxed mt-2">
                                    人力充足！多餘的 FTE 可作為彈性備用人力。
                                </p>
                            </div>
                        )}
                    </div>

                    {(posData.displayGap < 0 || posData.recruitCount > 0) && (
                        <div className="space-y-4">
                            <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">🎯 解決方案：</h4>
                            {actionPlans.map((plan, index) => (
                                <div key={index} className={`p-4 rounded-xl border ${plan.isPriority ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                                    <h5 className="font-bold text-sm text-slate-800 flex items-center gap-2 mb-2">
                                        {plan.icon} 方案{['一', '二', '三'][index]}：{plan.title}
                                        {plan.isPriority && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold ml-1">優先推薦</span>}
                                    </h5>
                                    {plan.content}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden relative">
            
            {isSettingsOpen && (
                <div className="fixed inset-0 bg-slate-900/40 z-[100] backdrop-blur-sm flex items-center justify-center p-4 transition-opacity">
                    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in">
                        <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <h3 className="text-lg font-extrabold text-slate-800 flex items-center gap-2">
                                <Settings className="text-indigo-600" size={20} /> 崗位服事次數設定
                            </h3>
                            <button onClick={() => setIsSettingsOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                        </div>
                        <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                            <p className="text-xs text-slate-500 mb-4 bg-amber-50 p-3 rounded-lg border border-amber-100">
                                💡 <b>提示：</b>健康服事次數設定，連動影響警示燈號與招募人數
                            </p>
                            {Object.keys(INITIAL_POLICY_LIMITS).map(posName => (
                                <div key={posName} className="flex items-center justify-between p-3 bg-slate-50/50 rounded-xl border border-slate-100">
                                    <span className="font-bold text-slate-700 text-sm">{posName}</span>
                                    <div className="flex items-center gap-3">
                                        <button onClick={() => setTempLimits(p => ({...p, [posName]: Math.max(1, p[posName] - 1)}))} className="w-7 h-7 flex items-center justify-center bg-white rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100">-</button>
                                        <span className="w-12 text-center font-extrabold text-indigo-700">{tempLimits[posName]}</span>
                                        <button onClick={() => setTempLimits(p => ({...p, [posName]: p[posName] + 1}))} className="w-7 h-7 flex items-center justify-center bg-white rounded-md border border-slate-200 text-slate-500 hover:bg-slate-100">+</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="p-5 border-t border-slate-100 bg-slate-50 flex justify-end gap-3">
                            <button onClick={() => setIsSettingsOpen(false)} className="px-5 py-2 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-200 transition-colors">取消</button>
                            <button onClick={saveSettings} className="px-5 py-2 rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm">儲存</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="hidden md:flex inset-y-0 left-0 w-64 bg-slate-900 flex-col justify-between shrink-0 border-r border-slate-800 z-30 h-full">
                <div className="flex flex-col">
                    <div className="p-6 border-b border-slate-800 flex items-center justify-between gap-3 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-indigo-500/10 to-transparent pointer-events-none"></div>
                        <span className="text-white font-bold text-base tracking-wider relative z-10">TBC Serve Manager</span>
                    </div>
                    <nav className="p-4 space-y-1.5">
                        <button onClick={goBack} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-normal text-sm transition-all text-left group">
                            <Home size={18} className="text-slate-400 group-hover:text-indigo-400 transition-colors" /><span>Home</span>
                        </button>
                        <button onClick={goToMembers} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-normal text-sm transition-all text-left group">
                            <Users size={18} className="text-slate-400 group-hover:text-violet-400 transition-colors" /><span>同工資料中心</span>
                        </button>
                        <button onClick={goToSchedule} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-normal text-sm transition-all text-left group">
                            <Calendar size={18} className="text-slate-400 group-hover:text-violet-400 transition-colors" /><span>排班作業中心</span>
                        </button>
                        <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-medium text-sm shadow-button">
                            <BarChart3 size={18} /><span>人力洞察中心</span>
                        </div>
                    </nav>
                </div>
            </div>

            <div className="flex-1 flex flex-col relative bg-slate-50 overflow-hidden animate-fade-in">
                <div className="bg-white px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 shadow-sm z-20">
                    <div className="flex items-center gap-3">
                        <button onClick={goBack} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-500 transition-colors hidden md:block">
                            <ChevronLeft size={24} />
                        </button>
                        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 flex items-center gap-2 tracking-tight">
                            <BarChart3 className="text-indigo-600" size={28}/> 人力洞察中心
                        </h2>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar pb-24 relative">
                    {isLoading || matrixStats.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-400 font-medium animate-pulse">Loading...</div>
                    ) : (
                        <div className="max-w-7xl mx-auto space-y-6">
                            
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                                <div className="xl:col-span-2 bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                    <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                                        <div className="flex items-center gap-2">
                                            <TrendingUp className="text-indigo-600" size={20} />
                                            <h3 className="text-lg font-extrabold text-slate-800 tracking-tight">人力總覽</h3>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse min-w-[700px]">
                                            <thead>
                                                <tr>
                                                    <th rowSpan="2" className="py-3 px-4 font-bold text-slate-700 text-sm border-b-2 border-slate-200 bg-white shadow-[1px_0_0_rgba(226,232,240,1)] sticky left-0 z-10 w-[80px]">季度</th>
                                                    <th colSpan="3" className="py-2.5 px-3 font-extrabold text-slate-700 text-[13px] border-b border-slate-200 bg-slate-100/70 text-center tracking-widest shadow-[1px_0_0_rgba(226,232,240,1)]">同工總人數</th>
                                                    <th colSpan="3" className="py-2.5 px-3 font-extrabold text-emerald-800 text-[13px] border-b border-emerald-200/50 bg-emerald-50/70 text-center tracking-widest shadow-[1px_0_0_rgba(226,232,240,1)]">上線服事人數</th>
                                                    <th colSpan="3" className="py-2.5 px-3 font-extrabold text-orange-800 text-[13px] border-b border-orange-200/50 bg-orange-50/70 text-center tracking-widest shadow-[1px_0_0_rgba(226,232,240,1)]">暫停服事人數</th>
                                                    <th colSpan="3" className="py-2.5 px-3 font-extrabold text-sky-800 text-[13px] border-b border-sky-200/50 bg-sky-50/70 text-center tracking-widest">安息季人數</th>
                                                </tr>
                                                <tr>
                                                    <th className="py-2 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-slate-50/50 text-center">總計</th>
                                                    <th className="py-2 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-slate-50/50 text-center">QoQ</th>
                                                    <th className="py-2 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-slate-50/50 text-center shadow-[1px_0_0_rgba(226,232,240,1)]">YoY</th>
                                                    <th className="py-2 px-2 font-semibold text-emerald-600/80 text-[11px] border-b-2 border-emerald-200/50 bg-emerald-50/30 text-center">總計</th>
                                                    <th className="py-2 px-2 font-semibold text-emerald-600/80 text-[11px] border-b-2 border-emerald-200/50 bg-emerald-50/30 text-center">QoQ</th>
                                                    <th className="py-2 px-2 font-semibold text-emerald-600/80 text-[11px] border-b-2 border-emerald-200/50 bg-emerald-50/30 text-center shadow-[1px_0_0_rgba(226,232,240,1)]">YoY</th>
                                                    <th className="py-2 px-2 font-semibold text-orange-600/80 text-[11px] border-b-2 border-orange-200/50 bg-orange-50/30 text-center">總計</th>
                                                    <th className="py-2 px-2 font-semibold text-orange-600/80 text-[11px] border-b-2 border-orange-200/50 bg-orange-50/30 text-center">QoQ</th>
                                                    <th className="py-2 px-2 font-semibold text-orange-600/80 text-[11px] border-b-2 border-orange-200/50 bg-orange-50/30 text-center shadow-[1px_0_0_rgba(226,232,240,1)]">YoY</th>
                                                    <th className="py-2 px-2 font-semibold text-sky-600/80 text-[11px] border-b-2 border-sky-200/50 bg-sky-50/30 text-center">總計</th>
                                                    <th className="py-2 px-2 font-semibold text-sky-600/80 text-[11px] border-b-2 border-sky-200/50 bg-sky-50/30 text-center">QoQ</th>
                                                    <th className="py-2 px-2 font-semibold text-sky-600/80 text-[11px] border-b-2 border-sky-200/50 bg-sky-50/30 text-center">YoY</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {matrixStats.map((row) => {
                                                    const isSelected = viewQuarter === row.quarter;
                                                    return (
                                                        <tr key={row.quarter} onClick={() => setViewQuarter(row.quarter)} className={`cursor-pointer transition-all duration-150 ${isSelected ? 'bg-indigo-50/60 shadow-[inset_3px_0_0_rgba(79,70,229,1)]' : 'hover:bg-slate-50 bg-white'}`}>
                                                            <td className={`py-3 px-4 font-extrabold text-[13px] border-b border-slate-100/50 shadow-[1px_0_0_rgba(226,232,240,1)] sticky left-0 z-10 ${isSelected ? 'text-indigo-700 bg-indigo-50/60' : 'text-slate-600 bg-inherit'}`}>
                                                                {row.quarter.replace('-', '')}
                                                            </td>
                                                            <td className="px-3 py-2.5 text-center font-bold text-[14px] text-slate-700 border-b border-slate-100/50">{row.total}</td>
                                                            <DiffCell diff={row.totalQoQ} />
                                                            <td className="p-0 border-b border-slate-100/50 shadow-[1px_0_0_rgba(226,232,240,1)]"><DiffCell diff={row.totalYoY} /></td>
                                                            <td className="px-3 py-2.5 text-center font-bold text-[14px] text-slate-700 border-b border-slate-100/50">{row.active}</td>
                                                            <DiffCell diff={row.activeQoQ} />
                                                            <td className="p-0 border-b border-slate-100/50 shadow-[1px_0_0_rgba(226,232,240,1)]"><DiffCell diff={row.activeYoY} /></td>
                                                            <td className="px-3 py-2.5 text-center font-bold text-[14px] text-slate-700 border-b border-slate-100/50">{row.suspended}</td>
                                                            <DiffCell diff={row.suspendedQoQ} />
                                                            <td className="p-0 border-b border-slate-100/50 shadow-[1px_0_0_rgba(226,232,240,1)]"><DiffCell diff={row.suspendedYoY} /></td>
                                                            <td className="px-3 py-2.5 text-center font-bold text-[14px] text-slate-700 border-b border-slate-100/50">{row.sabbatical}</td>
                                                            <DiffCell diff={row.sabbaticalQoQ} />
                                                            <DiffCell diff={row.sabbaticalYoY} />
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="xl:col-span-1 bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col h-full">
                                    <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                                        <UserCheck className="text-violet-500" size={20} />
                                        <h3 className="text-lg font-bold text-slate-800">上線服事人員技能分布</h3>
                                    </div>
                                    <div className="p-6 flex flex-col justify-center flex-1">
                                        <div className="flex items-end gap-3 sm:gap-4 h-36 border-b border-slate-200 pb-2 relative px-2">
                                            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-2 opacity-10">
                                                <div className="border-t border-slate-500 w-full"></div>
                                                <div className="border-t border-slate-500 w-full"></div>
                                            </div>
                                            {insights.concurrencyData.map((data, idx) => {
                                                const heightPct = insights.maxConcurrencyPeople > 0 ? (data.people / insights.maxConcurrencyPeople) * 100 : 0;
                                                return (
                                                    <div key={idx} className="flex-1 h-full flex flex-col items-center justify-end gap-2 group relative z-10">
                                                        <span className="text-sm font-bold text-slate-600 transition-transform group-hover:-translate-y-1">{data.people} 人</span>
                                                        <div className="w-full max-w-[50px] bg-violet-500 rounded-t-md transition-all duration-500 hover:bg-violet-400 shadow-sm" style={{ height: `${heightPct}%`, minHeight: data.people > 0 ? '4px' : '0' }}></div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="flex gap-3 sm:gap-4 mt-3 px-2">
                                            {insights.concurrencyData.map((data, idx) => (
                                                <div key={idx} className="flex-1 text-center text-[11px] font-medium text-slate-500 leading-tight">
                                                    {data.roles} 個<br/>崗位
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* 📊 頂部大盤：全域健康指標與招募精算清單 */}
                            <div className="bg-white rounded-xl shadow-soft border border-slate-100 p-5 flex flex-col xl:flex-row gap-5 items-start xl:items-center justify-between">
                                <div className="flex items-center gap-4 w-full xl:w-auto">
                                    <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${burdenStyles.iconBg} ${burdenStyles.iconText}`}>
                                        <TrendingUp size={28} />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-bold text-slate-800 mb-0.5">平均服事次數</h3>
                                        <div className="flex items-baseline gap-2">
                                            <span className={`text-2xl font-black tracking-tight ${burdenStyles.valText}`}>
                                                {insights.globalAvgBurden} <span className="text-sm font-bold text-slate-500">次/季</span>
                                            </span>
                                            <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${burdenStyles.badge}`}>
                                                {burdenStyles.label}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                
                                <div className="w-full h-px xl:w-px xl:h-12 bg-slate-200"></div>
                                
                                <div className="flex-1 w-full flex flex-col justify-center">
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-1.5">
                                            🚨 人力招募目標
                                        </h3>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {insights.recruitmentList.length > 0 ? (
                                            insights.recruitmentList.map(r => (
                                                <span key={r.name} className="px-3 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-sm font-bold rounded-full shadow-sm flex items-center gap-1.5">
                                                    {r.name} 
                                                    <span className="bg-amber-500 text-white px-2 py-0.5 rounded text-[13px] font-bold flex items-center gap-1">
                                                         {r.recruitCount} 人：
                                                        <span className="text-[13px] font-bold">
                                                            {
  r.s1RecruitCount > 0 && r.s2RecruitCount > 0
    ? `第一堂 ${r.s1RecruitCount} / 第二堂 ${r.s2RecruitCount}`
    : r.s1RecruitCount > 0
      ? `第一堂 ${r.s1RecruitCount}`
      : r.s2RecruitCount > 0
        ? `第二堂 ${r.s2RecruitCount}`
        : ''
}
                                                        </span>
                                                    </span>
                                                </span>
                                            ))
                                        ) : (
                                            <span className="px-3 py-1 bg-slate-50 border border-slate-200 text-slate-500 text-sm font-medium rounded-full flex items-center gap-1.5">
                                                <CheckCircle2 size={16} className="text-emerald-500"/> 無需招募
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* 下半部全寬：人力模擬大表 */}
                            <div className="bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col w-full">
                                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                    <div className="flex items-center flex-wrap gap-2">
                                        <LayoutList className="text-indigo-500" size={20} />
                                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                            人力模擬
                                            <span className="text-sm font-normal text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full ml-1">{viewQuarter.replace('-', '')}</span>
                                        </h3>
                                        
                                        <div className={`ml-2 flex items-center gap-1.5 px-3 py-1 rounded-full border shadow-sm ${globalGap < 0 ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
                                            {globalGap < 0 ? <AlertCircle size={14} className="text-rose-500"/> : <CheckCircle2 size={14} className="text-emerald-500"/>}
                                            <span className={`text-xs font-extrabold ${globalGap < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                人力缺口 {globalGap < 0 ? globalGap : '0.0'} FTE
                                            </span>
                                        </div>
                                    </div>

                                    {/* 🌟 操作區 (已拔除調度按鈕) */}
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => setIsSettingsOpen(true)} className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-600 hover:bg-slate-200 text-xs font-bold rounded-lg shadow-sm transition-all ml-2">
                                            <Settings size={14}/> 設定
                                        </button>
                                    </div>
                                </div>
                                <div className="overflow-x-auto w-full">
                                    <table className="w-full text-left border-collapse min-w-[950px]">
                                        <thead>
                                            <tr>
                                                <th rowSpan="2" className="py-2 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50 align-middle w-28">崗位</th>
                                                <th rowSpan="2" className="py-2 px-2 font-semibold text-indigo-600 text-[13px] border-b border-slate-200 bg-indigo-50/30 text-center align-middle">人數需求<br/><span className="text-[10px] font-normal text-indigo-500">(單堂)</span></th>
                                                
                                                <th colSpan="3" className="py-2 px-3 font-bold text-sky-900 text-sm border-b border-slate-200 bg-sky-50/60 text-center border-r-2 border-slate-200">第一堂</th>
                                                <th colSpan="3" className="py-2 px-3 font-bold text-violet-900 text-sm border-b border-slate-200 bg-violet-50/60 text-center border-r-2 border-slate-200">第二堂</th>
                                                <th colSpan="2" className="py-2 px-3 font-bold text-slate-700 text-sm border-b border-slate-200 bg-slate-100/80 text-center border-r-2 border-slate-200">皆可</th>
                                                
                                                <th rowSpan="2" className="py-2 px-3 font-extrabold text-slate-800 text-sm border-b border-slate-200 bg-slate-100/50 text-center align-middle">崗位總人力</th>
                                                <th rowSpan="2" className="py-2 px-4 font-extrabold text-slate-800 text-sm border-b border-slate-200 bg-slate-100/50 text-center align-middle">智能策略</th>
                                            </tr>
                                            <tr>
                                                <th className="py-1.5 px-2 font-semibold text-slate-400 text-[11px] border-b-2 border-slate-200 bg-sky-50/30 text-center">人數</th>
                                                <th className="py-1.5 px-2 font-bold text-sky-700 text-[11px] border-b-2 border-slate-200 bg-sky-50/30 text-center">
                                                    <div className="flex items-center justify-center">FTE <FteTooltip /></div>
                                                </th>
                                                <th className="py-1.5 px-2 font-bold text-sky-800 text-[11px] border-b-2 border-slate-200 bg-sky-50/30 text-center border-r-2 border-slate-200">FTE 缺口</th>
                                                
                                                <th className="py-1.5 px-2 font-semibold text-slate-400 text-[11px] border-b-2 border-slate-200 bg-violet-50/30 text-center">人數</th>
                                                <th className="py-1.5 px-2 font-bold text-violet-700 text-[11px] border-b-2 border-slate-200 bg-violet-50/30 text-center">
                                                    <div className="flex items-center justify-center">FTE <FteTooltip /></div>
                                                </th>
                                                <th className="py-1.5 px-2 font-bold text-violet-800 text-[11px] border-b-2 border-slate-200 bg-violet-50/30 text-center border-r-2 border-slate-200">FTE 缺口</th>
                                                
                                                <th className="py-1.5 px-2 font-semibold text-slate-400 text-[11px] border-b-2 border-slate-200 bg-slate-50 text-center">人數</th>
                                                <th className="py-1.5 px-2 font-bold text-slate-700 text-[11px] border-b-2 border-slate-200 bg-slate-50 text-center border-r-2 border-slate-200">
                                                    <div className="flex items-center justify-center">FTE <FteTooltip /></div>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {insights.positionDistribution.map((pos, idx) => {
                                                return (
                                                    <tr key={pos.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} hover:bg-slate-50 transition-colors`}>
                                                        <td className="py-3.5 px-4 font-bold text-slate-700 border-b border-slate-100 h-full align-middle">
                                                            {pos.name}
                                                        </td>
                                                        
                                                        <td className="py-3.5 px-1 text-center border-b border-slate-100 bg-indigo-50/10">
                                                            <div className="flex items-center justify-center gap-1.5">
                                                                <button onClick={() => handleUpdateReq(pos.name, -1)} disabled={pos.currentReq <= 0} className="w-5 h-5 flex items-center justify-center bg-white hover:bg-slate-200 text-slate-500 rounded border border-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed leading-none pb-0.5">-</button>
                                                                <span className="font-extrabold text-indigo-700 w-3 text-center">{pos.currentReq}</span>
                                                                <button onClick={() => handleUpdateReq(pos.name, 1)} className="w-5 h-5 flex items-center justify-center bg-white hover:bg-slate-200 text-slate-500 rounded border border-slate-200 transition-colors leading-none pb-0.5">+</button>
                                                            </div>
                                                        </td>

                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-sky-50/20">
                                                            <div className="text-slate-400 font-normal text-xs">{pos.s1Count}人</div>
                                                        </td>
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-sky-50/20">
                                                            <div className="font-bold text-sm text-sky-700">{pos.s1FTE}</div>
                                                        </td>
                                                        <td className="py-3.5 px-1 text-center border-b border-slate-100 bg-sky-50/20 border-r-2 border-slate-200">
                                                            {pos.currentReq > 0 ? (
                                                                <span className={`font-extrabold text-[13px] ${pos.displayS1Gap < 0 ? 'text-rose-600' : pos.displayS1Gap > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                                    {pos.displayS1Gap > 0 ? `+${pos.displayS1Gap}` : pos.displayS1Gap === 0 ? '0.0' : pos.displayS1Gap}
                                                                </span>
                                                            ) : <span className="text-slate-300">-</span>}
                                                        </td>

                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-violet-50/20">
                                                            <div className="text-slate-400 font-normal text-xs">{pos.s2Count}人</div>
                                                        </td>
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-violet-50/20">
                                                            <div className="font-bold text-sm text-violet-700">{pos.s2FTE}</div>
                                                        </td>
                                                        <td className="py-3.5 px-1 text-center border-b border-slate-100 bg-violet-50/20 border-r-2 border-slate-200">
                                                            {pos.currentReq > 0 ? (
                                                                <span className={`font-extrabold text-[13px] ${pos.displayS2Gap < 0 ? 'text-rose-600' : pos.displayS2Gap > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                                    {pos.displayS2Gap > 0 ? `+${pos.displayS2Gap}` : pos.displayS2Gap === 0 ? '0.0' : pos.displayS2Gap}
                                                                </span>
                                                            ) : <span className="text-slate-300">-</span>}
                                                        </td>

                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-slate-100/40">
                                                            <div className="text-slate-400 font-normal text-xs">{pos.bothCount}人</div>
                                                        </td>
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-slate-100/40 border-r-2 border-slate-200">
                                                            <div className={`font-bold text-sm ${pos.displayRemainingBoth !== pos.bothFTE ? 'text-amber-600' : 'text-slate-700'}`}>
                                                                {pos.displayRemainingBoth}
                                                            </div>
                                                        </td>
                                                        
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-slate-50 font-bold text-sm text-slate-500">
                                                            {pos.totalCount}人
                                                        </td>

                                                        <td className="py-3.5 px-4 text-center border-b border-slate-100 bg-slate-50">
                                                            {pos.currentReq > 0 ? (
                                                                <button onClick={() => toggleDrawer(pos.name)} className={`flex items-center justify-center w-8 h-8 mx-auto rounded-full shadow-sm transition-all transform hover:scale-110 active:scale-95 ${drawerPos === pos.name ? 'ring-2 ring-offset-1 ring-slate-300' : ''} ${pos.displayGap < 0 ? 'bg-rose-50 text-rose-500 hover:bg-rose-100' : pos.displayGap === 0 ? 'bg-slate-100 text-slate-400 hover:bg-slate-200' : 'bg-emerald-50 text-emerald-500 hover:bg-emerald-100'}`} title="點擊展開智能策略面板">
                                                                    <Lightbulb size={17} className={drawerPos === pos.name ? 'fill-current' : ''} />
                                                                </button>
                                                            ) : <span className="text-slate-300">-</span>}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {drawerPos && (
                    <div className="absolute inset-0 bg-slate-900/20 z-40 backdrop-blur-[1px] transition-opacity" onClick={() => setDrawerPos(null)} />
                )}
                <div className={`absolute top-0 right-0 w-full max-w-[400px] h-full bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-out ${drawerPos ? 'translate-x-0' : 'translate-x-full'}`}>
                    {renderDrawerContent()}
                </div>
            </div>
        </div>
    );
};

window.TeamInsights = TeamInsights;
