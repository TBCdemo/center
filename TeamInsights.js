import React, { useState, useEffect, useMemo } from 'react';
import { 
    Home, Users, Calendar, LogOut, BarChart3, ChevronLeft, 
    UserCheck, LayoutList, TrendingUp
} from 'lucide-react';

// ==========================================
// 崗位需求預設設定參數 (初始沙盤數值)
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

// ==========================================
// 輔助函式：計算歷史季度
// ==========================================
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

// ==========================================
// 視覺元件：歷史趨勢儲存格 (紅漲綠跌)
// ==========================================
const DiffCell = ({ diff }) => {
    const baseClass = "px-2 py-2.5 text-center text-[12px] font-bold border-b border-slate-100/50";
    if (diff === null || diff === undefined) return <td className={`${baseClass} text-slate-300`}>-</td>;
    if (diff > 0) return <td className={`${baseClass} text-rose-500`}>↑ {diff} 人</td>;
    if (diff < 0) return <td className={`${baseClass} text-emerald-500`}>↓ {Math.abs(diff)} 人</td>;
    return <td className={`${baseClass} text-slate-400 font-medium`}>- 0 人</td>;
};

const TeamInsights = ({ session, goBack, goToMembers, goToSchedule, supabase, utils }) => {
    const { fetchAllData, getCurrentQuarter } = utils;
    
    const [isLoading, setIsLoading] = useState(true);
    const [availableQuarters, setAvailableQuarters] = useState([]);
    const [viewQuarter, setViewQuarter] = useState('');
    const [dbData, setDbData] = useState({ members: [], positions: [], memberPositions: [], quarterSettings: [] });

    // 沙盤推演狀態：可動態調整的單堂需求人數
    const [requirements, setRequirements] = useState(INITIAL_REQUIREMENTS);

    // 處理沙盤數值微調
    const handleUpdateReq = (posName, delta) => {
        setRequirements(prev => {
            const current = prev[posName] || { singleSession: 0, freq: 'weekly' };
            const newValue = Math.max(0, current.singleSession + delta);
            return { ...prev, [posName]: { ...current, singleSession: newValue } };
        });
    };

    // 1. 初始化：取得所有季度
    useEffect(() => {
        const fetchQuarters = async () => {
            try {
                const { data } = await supabase.from('member_quarter_settings').select('quarter');
                if (data) {
                    const qs = [...new Set(data.map(d => d.quarter))]
                        .filter(q => q !== 'SYSTEM' && q !== 'BASE')
                        .sort()
                        .reverse();
                    
                    if (qs.length > 0) {
                        setAvailableQuarters(qs);
                        setViewQuarter(qs[0]); 
                    } else {
                        const currentQ = getCurrentQuarter();
                        setAvailableQuarters([currentQ]);
                        setViewQuarter(currentQ);
                    }
                }
            } catch (err) { console.error('抓取季度失敗', err); }
        };
        fetchQuarters();
    }, []);

    // 2. 載入所需數據
    useEffect(() => {
        const loadQuarterData = async () => {
            setIsLoading(true);
            try {
                const [
                    { data: mData }, 
                    { data: pData }, 
                    { data: mpData }, 
                    { data: qsData }
                ] = await Promise.all([
                    fetchAllData(() => supabase.from('members').select('*').order('name')),
                    fetchAllData(() => supabase.from('positions').select('*').order('id')),
                    fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', viewQuarter)),
                    fetchAllData(() => supabase.from('member_quarter_settings').select('*')) 
                ]);

                setDbData({
                    members: mData || [],
                    positions: pData || [],
                    memberPositions: mpData || [],
                    quarterSettings: qsData || []
                });
            } catch (err) {
                console.error('載入洞察資料失敗', err);
            } finally {
                setIsLoading(false);
            }
        };
        loadQuarterData();
    }, [viewQuarter]);

    // ==========================================
    // 計算 1：全年度戰略矩陣數據 (Matrix Table)
    // ==========================================
    const matrixStats = useMemo(() => {
        if (dbData.members.length === 0 || availableQuarters.length === 0) return [];

        const realMembers = dbData.members.filter(m => !m.name.startsWith('SYSTEM_'));
        const { quarterSettings } = dbData;

        const getQuarterStat = (qStr) => {
            if (!qStr) return null;
            const hasData = quarterSettings.some(qs => qs.quarter === qStr);
            if (!hasData) return null;

            let suspended = 0;
            let sabbatical = 0;
            const qsMap = {};
            quarterSettings.forEach(qs => { if(qs.quarter === qStr) qsMap[qs.member_id] = qs; });

            realMembers.forEach(m => {
                const status = qsMap[m.id]?.availability_status || '穩定服事';
                if (status === '暫停服事') suspended++;
                else if (status === '安息季') sabbatical++;
            });

            const total = realMembers.length;
            const active = total - suspended - sabbatical;
            return { total, active, suspended, sabbatical };
        };

        return availableQuarters.map(qStr => {
            const current = getQuarterStat(qStr) || { total: 0, active: 0, suspended: 0, sabbatical: 0 };
            const prevQ = getPrevQuarter(qStr);
            const yoyQ = getYoYQuarter(qStr);
            
            const qoqStat = getQuarterStat(prevQ);
            const yoyStat = getQuarterStat(yoyQ);

            const calcDiff = (currVal, pastStat, key) => pastStat ? (currVal - pastStat[key]) : null;

            return {
                quarter: qStr,
                total: current.total,
                totalQoQ: calcDiff(current.total, qoqStat, 'total'),
                totalYoY: calcDiff(current.total, yoyStat, 'total'),
                
                active: current.active,
                activeQoQ: calcDiff(current.active, qoqStat, 'active'),
                activeYoY: calcDiff(current.active, yoyStat, 'active'),
                
                suspended: current.suspended,
                suspendedQoQ: calcDiff(current.suspended, qoqStat, 'suspended'),
                suspendedYoY: calcDiff(current.suspended, yoyStat, 'suspended'),
                
                sabbatical: current.sabbatical,
                sabbaticalQoQ: calcDiff(current.sabbatical, qoqStat, 'sabbatical'),
                sabbaticalYoY: calcDiff(current.sabbatical, yoyStat, 'sabbatical'),
            };
        });
    }, [dbData, availableQuarters]);

    // ==========================================
    // 計算 2：單季操作洞察 (含 FTE 與相容群組精算)
    // ==========================================
    const insights = useMemo(() => {
        const { members, positions, memberPositions, quarterSettings } = dbData;
        const realMembers = members.filter(m => !m.name.startsWith('SYSTEM_'));
        const qsMap = {};
        quarterSettings.forEach(qs => { if(qs.quarter === viewQuarter) qsMap[qs.member_id] = qs; });

        const activeMemberIds = new Set();
        realMembers.forEach(m => {
            const status = qsMap[m.id]?.availability_status || '穩定服事';
            if (status !== '暫停服事' && status !== '安息季') {
                activeMemberIds.add(m.id);
            }
        });

        // ----------------------------------------------------------------
        // [核心邏輯] 預先計算每位同工的 FTE 權重 (套用「相容群組」同堂雙開規則)
        // ----------------------------------------------------------------
        const memberWeights = {};
        const COMPATIBLE_GROUP = ['新朋友關懷', '主餐', '接待', '收奉獻'];

        realMembers.forEach(m => {
            if (!activeMemberIds.has(m.id)) return;
            
            // 取出該同工所有的有效崗位 ID
            const activePosIds = memberPositions
                .filter(mp => mp.member_id === m.id && mp.is_active !== false)
                .map(mp => mp.position_id);
            
            let compatCount = 0;
            let incompatCount = 0;
            
            activePosIds.forEach(pId => {
                const pName = positions.find(p => p.id === pId)?.name;
                if (COMPATIBLE_GROUP.includes(pName)) {
                    compatCount++;
                } else {
                    incompatCount++;
                }
            });
            
            // 相容群組的崗位：每 2 個折算為 1 次主日出勤消耗 (向上取整)
            // 一般群組的崗位：每 1 個折算為 1 次主日出勤消耗
            const effectiveSessionsNeeded = Math.ceil(compatCount / 2) + incompatCount;
            
            // 將總貢獻力 1 攤提給實際需要的出勤次數，得出每個崗位的 FTE 權重
            memberWeights[m.id] = 1 / (effectiveSessionsNeeded || 1);
        });

        // 崗位人力分布試算
        const positionDistribution = positions.map(pos => {
            let s1Count = 0, s2Count = 0, bothCount = 0;
            let s1FTE = 0, s2FTE = 0, bothFTE = 0;
            
            realMembers.forEach(m => {
                if (!activeMemberIds.has(m.id)) return; 
                const hasPos = memberPositions.some(mp => mp.member_id === m.id && mp.position_id === pos.id && mp.is_active !== false);
                
                if (hasPos) {
                    const weight = memberWeights[m.id] || 0;
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

            // 取得目前的動態沙盤設定
            const req = requirements[pos.name] || { singleSession: 0, freq: 'weekly' };
            let sessionQuarterDemand = req.freq === 'monthly' ? req.singleSession * 3 : req.singleSession * 13; 
            const sessionMinRequired = Math.ceil(sessionQuarterDemand / 6); // 在背景做為健康度判定低標

            // 精算整體人力缺口 (總有效戰力 - 兩堂總需求)
            const totalRequirement = sessionMinRequired * 2;
            const gap = req.singleSession > 0 ? Math.round((totalFTE - totalRequirement) * 10) / 10 : 0;

            // 判斷單堂健康度 (以動態 FTE 為硬性指標)
            let s1Health = 'gray';
            let s2Health = 'gray';

            if (req.singleSession > 0) {
                s1Health = s1FTE >= sessionMinRequired ? 'green' : 'red';
                s2Health = s2FTE >= sessionMinRequired ? 'green' : 'red';
            }

            return { 
                id: pos.id, name: pos.name, 
                s1Count, s2Count, bothCount, totalCount,
                s1FTE, s2FTE, bothFTE, gap,
                sessionMinRequired, s1Health, s2Health
            };
        });

        // 崗位兼任分析 (無條件全體同工)
        const concurrencyMap = {};
        realMembers.forEach(m => {
            const posCount = memberPositions.filter(mp => mp.member_id === m.id).length;
            concurrencyMap[posCount] = (concurrencyMap[posCount] || 0) + 1;
        });

        const concurrencyData = Object.keys(concurrencyMap).map(Number).sort((a, b) => a - b).map(count => ({
            roles: count, people: concurrencyMap[count]
        }));
        const maxConcurrencyPeople = Math.max(0, ...concurrencyData.map(d => d.people));

        return { positionDistribution, concurrencyData, maxConcurrencyPeople };
    }, [dbData, viewQuarter, requirements]);

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden relative">
            {/* 左側導覽列 */}
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
                <div className="p-4 border-t border-slate-800">
                    <button onClick={async () => { if (supabase?.auth?.signOut) await supabase.auth.signOut(); window.location.reload(); }} className="w-full flex items-center gap-3 px-4 py-3 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl font-normal text-sm transition-all text-left group">
                        <LogOut size={18} className="text-rose-400 group-hover:translate-x-0.5 transition-transform" /><span>Sign Out</span>
                    </button>
                </div>
            </div>

            {/* 主要內容區 */}
            <div className="flex-1 flex flex-col relative bg-slate-50 overflow-hidden animate-fade-in">
                <div className="bg-white px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0 shadow-sm z-20">
                    <div className="flex items-center gap-3">
                        <button onClick={goBack} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-500 transition-colors hidden md:block" title="返回首頁">
                            <ChevronLeft size={24} />
                        </button>
                        <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 flex items-center gap-2 tracking-tight">
                            <BarChart3 className="text-indigo-600" size={28}/> 人力洞察中心
                        </h2>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar pb-24">
                    {isLoading || matrixStats.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-400 font-medium animate-pulse">Loading...</div>
                    ) : (
                        <div className="max-w-7xl mx-auto space-y-8">
                            
                            {/* 頂部：全年度戰略矩陣 (13 欄表格) */}
                            <div className="bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                                    <div className="flex items-center gap-2">
                                        <TrendingUp className="text-indigo-600" size={20} />
                                        <h3 className="text-lg font-extrabold text-slate-800 tracking-tight">人力總覽</h3>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse min-w-[900px]">
                                        <thead>
                                            <tr>
                                                <th rowSpan="2" className="py-3 px-4 font-bold text-slate-700 text-sm border-b-2 border-slate-200 bg-white shadow-[1px_0_0_rgba(226,232,240,1)] sticky left-0 z-10 w-[100px]">季度</th>
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
                                                    <tr 
                                                        key={row.quarter} 
                                                        onClick={() => setViewQuarter(row.quarter)}
                                                        className={`cursor-pointer transition-all duration-150 ${isSelected ? 'bg-indigo-50/60 shadow-[inset_3px_0_0_rgba(79,70,229,1)]' : 'hover:bg-slate-50 bg-white'}`}
                                                    >
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

                            <hr className="border-slate-200/60 my-2" />

                            {/* 底部：單季操作沙盤 */}
                            <div>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4 justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-slate-500">季度：<strong className="text-violet-700 ml-1">{viewQuarter.replace('-', '')}</strong></span>
                                    </div>
                                </div>
                                
                                <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                                    {/* 左側：人力需求分析 */}
                                    <div className="xl:col-span-3 bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <LayoutList className="text-indigo-500" size={20} />
                                                <h3 className="text-lg font-bold text-slate-800">人力需求分析</h3>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto flex-1">
                                            <table className="w-full text-left border-collapse min-w-[700px]">
                                                <thead>
                                                    {/* 第一層大區塊 */}
                                                    <tr>
                                                        <th rowSpan="2" className="py-2 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50 align-middle">崗位</th>
                                                        <th rowSpan="2" className="py-2 px-2 font-semibold text-indigo-600 text-[13px] border-b border-slate-200 bg-indigo-50/30 text-center align-middle">人數(堂)</th>
                                                        <th colSpan="2" className="py-2 px-3 font-bold text-slate-700 text-sm border-b border-slate-200 bg-indigo-50/60 text-center">第一堂</th>
                                                        <th colSpan="2" className="py-2 px-3 font-bold text-slate-700 text-sm border-b border-slate-200 bg-indigo-50/60 text-center">第二堂</th>
                                                        <th colSpan="2" className="py-2 px-3 font-bold text-slate-600 text-sm border-b border-slate-200 bg-slate-100/50 text-center">皆可</th>
                                                        <th rowSpan="2" className="py-2 px-4 font-extrabold text-slate-800 text-sm border-b border-slate-200 bg-slate-100/80 text-center align-middle">總計</th>
                                                        <th rowSpan="2" className="py-2 px-4 font-extrabold text-slate-800 text-sm border-b border-slate-200 bg-slate-100/80 text-center align-middle">人力缺口</th>
                                                    </tr>
                                                    {/* 第二層細部指標 */}
                                                    <tr>
                                                        <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-indigo-50/30 text-center">人數</th>
                                                        <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-indigo-50/30 text-center">FTE</th>
                                                        <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-indigo-50/30 text-center">人數</th>
                                                        <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-indigo-50/30 text-center">FTE</th>
                                                        <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-slate-50/80 text-center">人數</th>
                                                        <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-slate-50/80 text-center">FTE</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {insights.positionDistribution.map((pos, idx) => {
                                                        const currentReq = requirements[pos.name]?.singleSession || 0;
                                                        return (
                                                            <tr key={pos.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} hover:bg-slate-50 transition-colors`}>
                                                                <td className="py-3.5 px-4 font-bold text-slate-700 border-b border-slate-100">{pos.name}</td>
                                                                
                                                                {/* 動態調整：人數(堂) */}
                                                                <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-indigo-50/10">
                                                                    <div className="flex items-center justify-center gap-2">
                                                                        <button 
                                                                            onClick={() => handleUpdateReq(pos.name, -1)} 
                                                                            disabled={currentReq <= 0}
                                                                            className="w-6 h-6 flex items-center justify-center bg-white hover:bg-slate-200 text-slate-500 rounded border border-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                                                        >-</button>
                                                                        <span className="font-extrabold text-indigo-700 w-4 text-center">{currentReq}</span>
                                                                        <button 
                                                                            onClick={() => handleUpdateReq(pos.name, 1)} 
                                                                            className="w-6 h-6 flex items-center justify-center bg-white hover:bg-slate-200 text-slate-500 rounded border border-slate-200 transition-colors"
                                                                        >+</button>
                                                                    </div>
                                                                </td>

                                                                {/* 第一堂：若 FTE 不足，則人數與 FTE 兩格皆亮紅字紅底 */}
                                                                <td className={`py-3.5 px-2 text-center border-b border-slate-100 ${pos.s1Health === 'red' ? 'bg-rose-50/70 text-rose-600' : 'bg-indigo-50/10 text-slate-700'}`}>
                                                                    <div className="font-bold text-base leading-none">{pos.s1Count}</div>
                                                                </td>
                                                                <td className={`py-3.5 px-2 text-center border-b border-slate-100 ${pos.s1Health === 'red' ? 'bg-rose-50/70 text-rose-600' : 'bg-indigo-50/10 text-indigo-600'}`}>
                                                                    <div className="font-semibold text-sm leading-none">{pos.s1FTE}</div>
                                                                </td>

                                                                {/* 第二堂：若 FTE 不足，則人數與 FTE 兩格皆亮紅字紅底 */}
                                                                <td className={`py-3.5 px-2 text-center border-b border-slate-100 ${pos.s2Health === 'red' ? 'bg-rose-50/70 text-rose-600' : 'bg-indigo-50/10 text-slate-700'}`}>
                                                                    <div className="font-bold text-base leading-none">{pos.s2Count}</div>
                                                                </td>
                                                                <td className={`py-3.5 px-2 text-center border-b border-slate-100 ${pos.s2Health === 'red' ? 'bg-rose-50/70 text-rose-600' : 'bg-indigo-50/10 text-indigo-600'}`}>
                                                                    <div className="font-semibold text-sm leading-none">{pos.s2FTE}</div>
                                                                </td>

                                                                {/* 皆可 */}
                                                                <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-slate-50">
                                                                    <div className="font-bold text-base leading-none text-slate-600">{pos.bothCount}</div>
                                                                </td>
                                                                <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-slate-50">
                                                                    <div className="font-semibold text-sm leading-none text-slate-500">{pos.bothFTE}</div>
                                                                </td>
                                                                
                                                                {/* 總計：純人數計數 */}
                                                                <td className="py-3.5 px-3 text-center border-b border-slate-100 bg-slate-100/30 font-extrabold text-base text-slate-800">
                                                                    {pos.totalCount}
                                                                </td>

                                                                {/* 人力缺口：正數綠字、負數紅字、零灰字 */}
                                                                <td className="py-3.5 px-3 text-center border-b border-slate-100 font-bold text-base">
                                                                    {currentReq > 0 ? (
                                                                        pos.gap > 0 ? (
                                                                            <span className="text-emerald-600">+{pos.gap}</span>
                                                                        ) : pos.gap < 0 ? (
                                                                            <span className="text-rose-600">{pos.gap}</span>
                                                                        ) : (
                                                                            <span className="text-slate-400">0.0</span>
                                                                        )
                                                                    ) : (
                                                                        <span className="text-slate-300">-</span>
                                                                    )}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* 右側：崗位技能分布長條圖 */}
                                    <div className="xl:col-span-2 bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                                            <UserCheck className="text-violet-500" size={20} />
                                            <h3 className="text-lg font-bold text-slate-800">崗位技能分布</h3>
                                        </div>
                                        <div className="p-6 flex-1 flex flex-col justify-center min-h-[300px]">
                                            <div className="flex items-end gap-3 sm:gap-6 h-64 border-b border-slate-200 pb-2 relative px-2">
                                                <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-2 opacity-10">
                                                    <div className="border-t border-slate-500 w-full"></div>
                                                    <div className="border-t border-slate-500 w-full"></div>
                                                    <div className="border-t border-slate-500 w-full"></div>
                                                    <div className="border-t border-slate-500 w-full"></div>
                                                </div>

                                                {insights.concurrencyData.map((data, idx) => {
                                                    const heightPct = insights.maxConcurrencyPeople > 0 
                                                        ? (data.people / insights.maxConcurrencyPeople) * 100 
                                                        : 0;
                                                    return (
                                                        <div key={idx} className="flex-1 h-full flex flex-col items-center justify-end gap-2 group relative z-10">
                                                            <span className="text-sm font-bold text-slate-600 transition-transform group-hover:-translate-y-1">{data.people} 人</span>
                                                            <div 
                                                                className="w-full max-w-[40px] bg-violet-500 rounded-t-md transition-all duration-500 hover:bg-violet-400 shadow-sm"
                                                                style={{ height: `${heightPct}%`, minHeight: data.people > 0 ? '4px' : '0' }}
                                                            ></div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            <div className="flex gap-3 sm:gap-6 mt-3 px-2">
                                                {insights.concurrencyData.map((data, idx) => (
                                                    <div key={idx} className="flex-1 text-center text-[11px] sm:text-xs font-medium text-slate-500 leading-tight">
                                                        {data.roles} 個<br/>崗位
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

window.TeamInsights = TeamInsights;
