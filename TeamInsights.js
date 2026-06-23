import React, { useState, useEffect, useMemo } from 'react';
import { 
    Home, Users, Calendar, LogOut, BarChart3, ChevronLeft, 
    UserCheck, LayoutList, TrendingUp
} from 'lucide-react';

// ==========================================
// 崗位需求預設設定參數 (初始沙盤數值)
// ==========================================
const INITIAL_REQUIREMENTS = {
    '司會': { singleSession: 1, freq: 'weekly', maxLimit: 6 },
    '執事輪值': { singleSession: 1, freq: 'weekly', maxLimit: 6 },
    'PPT': { singleSession: 1, freq: 'weekly', maxLimit: 6 },
    '新朋友關懷': { singleSession: 3, freq: 'weekly', maxLimit: 6 },
    '接待': { singleSession: 4, freq: 'weekly', maxLimit: 6 },
    '收奉獻': { singleSession: 5, freq: 'weekly', maxLimit: 6 },
    '主餐': { singleSession: 6, freq: 'monthly', maxLimit: 3 }
};

// 宣告相容群組常數
const COMPATIBLE_GROUP = ['新朋友關懷', '主餐', '接待', '收奉獻'];

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
// 視覺元件：歷史趨勢儲存格
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

    // 沙盤推演狀態：可動態調整的【人數(堂)】與【服事上限】
    const [requirements, setRequirements] = useState(INITIAL_REQUIREMENTS);

    // 處理人數(堂)沙盤微調
    const handleUpdateReq = (posName, delta) => {
        setRequirements(prev => {
            const current = prev[posName] || { singleSession: 0, freq: 'weekly', maxLimit: 6 };
            const newValue = Math.max(0, current.singleSession + delta);
            return { ...prev, [posName]: { ...current, singleSession: newValue } };
        });
    };

    // 處理服事上限沙盤微調
    const handleUpdateLimit = (posName, delta) => {
        setRequirements(prev => {
            const current = prev[posName] || { singleSession: 0, freq: 'weekly', maxLimit: 6 };
            const newValue = Math.max(1, current.maxLimit + delta); 
            return { ...prev, [posName]: { ...current, maxLimit: newValue } };
        });
    };

    // 1. 初始化
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

    // 2. 載入數據
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
    // 計算 1：全年度戰略矩陣
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
                total: current.total, totalQoQ: calcDiff(current.total, qoqStat, 'total'), totalYoY: calcDiff(current.total, yoyStat, 'total'),
                active: current.active, activeQoQ: calcDiff(current.active, qoqStat, 'active'), activeYoY: calcDiff(current.active, yoyStat, 'active'),
                suspended: current.suspended, suspendedQoQ: calcDiff(current.suspended, qoqStat, 'suspended'), suspendedYoY: calcDiff(current.suspended, yoyStat, 'suspended'),
                sabbatical: current.sabbatical, sabbaticalQoQ: calcDiff(current.sabbatical, qoqStat, 'sabbatical'), sabbaticalYoY: calcDiff(current.sabbatical, yoyStat, 'sabbatical'),
            };
        });
    }, [dbData, availableQuarters]);

    // ==========================================
    // 計算 2：單季操作洞察 (含動態智能策略提示)
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

        // 崗位人力分布試算
        const positionDistribution = positions.map(pos => {
            let s1Count = 0, s2Count = 0, bothCount = 0;
            let s1FTE = 0, s2FTE = 0, bothFTE = 0;
            
            realMembers.forEach(m => {
                if (!activeMemberIds.has(m.id)) return; 
                const hasPos = memberPositions.some(mp => mp.member_id === m.id && mp.position_id === pos.id && mp.is_active !== false);
                
                if (hasPos) {
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

            const req = requirements[pos.name] || { singleSession: 0, freq: 'weekly', maxLimit: 6 };
            let sessionQuarterDemand = req.freq === 'monthly' ? req.singleSession * 3 : req.singleSession * 13; 
            
            const sessionMinRequired = Math.ceil(sessionQuarterDemand / req.maxLimit);
            const totalRequirement = sessionMinRequired * 2;
            const gap = req.singleSession > 0 ? Math.round((totalFTE - totalRequirement) * 10) / 10 : 0;

            let s1Health = 'gray', s2Health = 'gray';
            if (req.singleSession > 0) {
                s1Health = s1FTE >= sessionMinRequired ? 'green' : 'red';
                s2Health = s2FTE >= sessionMinRequired ? 'green' : 'red';
            }

            // 🤖 動態生成策略提示 (Strategy Tip)
            let strategyTip = "";
            if (gap < 0) {
                if (COMPATIBLE_GROUP.includes(pos.name)) {
                    strategyTip = `【優先推薦：相容技能擴充】\n此屬相容群組。建議尋找只會「收奉獻、主餐、新朋友關懷」的單一專職同工進行雙開培訓，可獲 100% 戰力轉換，且不增加出勤天數。\n\n【次要推薦：對外招募】\n若無法調度，需招募 ${Math.abs(gap)} 位純專職新人。`;
                } else {
                    strategyTip = `【唯一解方：對外招募】\n此屬獨立崗位，跨界兼任會使戰力砍半。要補足 ${Math.abs(gap)} 的缺口，強烈建議直接招募對應數量的純專職新人，避免現有同工過勞。`;
                }
            } else if (gap === 0) {
                strategyTip = `【目前評估：完美平衡】\n在「每季上限 ${req.maxLimit} 次」的排班策略下，目前戰力剛好緊繃平衡。一旦有人請假即有開天窗風險。`;
            } else {
                strategyTip = `【目前評估：戰力充裕】\n有 +${gap} 的專職戰力餘裕！您可以考慮降低本崗位的服事上限，讓同工多休息，或是將多餘人力調度至其他缺乏的崗位。`;
            }

            return { 
                id: pos.id, name: pos.name, 
                s1Count, s2Count, bothCount, totalCount,
                s1FTE, s2FTE, bothFTE, gap,
                sessionMinRequired, s1Health, s2Health, strategyTip
            };
        });

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

                <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar pb-24">
                    {isLoading || matrixStats.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-slate-400 font-medium animate-pulse">Loading...</div>
                    ) : (
                        <div className="max-w-7xl mx-auto space-y-8">
                            
                            {/* 頂部全域：崗位技能分布長條圖 */}
                            <div className="bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                                    <UserCheck className="text-violet-500" size={20} />
                                    <h3 className="text-lg font-bold text-slate-800">全域崗位技能分布</h3>
                                </div>
                                <div className="p-6 flex flex-col justify-center">
                                    <div className="flex items-end gap-3 sm:gap-6 h-40 border-b border-slate-200 pb-2 relative px-2">
                                        <div className="absolute inset-0 flex flex-col justify-between pointer-events-none pb-2 opacity-10">
                                            <div className="border-t border-slate-500 w-full"></div>
                                            <div className="border-t border-slate-500 w-full"></div>
                                        </div>
                                        {insights.concurrencyData.map((data, idx) => {
                                            const heightPct = insights.maxConcurrencyPeople > 0 ? (data.people / insights.maxConcurrencyPeople) * 100 : 0;
                                            return (
                                                <div key={idx} className="flex-1 h-full flex flex-col items-center justify-end gap-2 group relative z-10">
                                                    <span className="text-sm font-bold text-slate-600 transition-transform group-hover:-translate-y-1">{data.people} 人</span>
                                                    <div className="w-full max-w-[60px] bg-violet-500 rounded-t-md transition-all duration-500 hover:bg-violet-400 shadow-sm" style={{ height: `${heightPct}%`, minHeight: data.people > 0 ? '4px' : '0' }}></div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="flex gap-3 sm:gap-6 mt-3 px-2">
                                        {insights.concurrencyData.map((data, idx) => (
                                            <div key={idx} className="flex-1 text-center text-[12px] font-medium text-slate-500 leading-tight">
                                                {data.roles} 個技能標籤
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* 核心戰情區：100% 全寬人力需求分析 */}
                            <div className="bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col w-full">
                                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <LayoutList className="text-indigo-500" size={20} />
                                        <h3 className="text-lg font-bold text-slate-800">沙盤推演：人力需求與缺口精算</h3>
                                    </div>
                                </div>
                                <div className="overflow-x-auto w-full">
                                    <table className="w-full text-left border-collapse min-w-[1000px]">
                                        <thead>
                                            <tr>
                                                <th rowSpan="2" className="py-2 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50 align-middle">崗位</th>
                                                <th rowSpan="2" className="py-2 px-2 font-semibold text-indigo-600 text-[13px] border-b border-slate-200 bg-indigo-50/30 text-center align-middle">人數(堂)</th>
                                                <th rowSpan="2" className="py-2 px-2 font-semibold text-emerald-700 text-[13px] border-b border-slate-200 bg-emerald-50/50 text-center align-middle">服事上限<br/><span className="text-[10px] font-normal text-emerald-600">(次/季)</span></th>
                                                <th colSpan="2" className="py-2 px-3 font-bold text-slate-700 text-sm border-b border-slate-200 bg-indigo-50/60 text-center">第一堂</th>
                                                <th colSpan="2" className="py-2 px-3 font-bold text-slate-700 text-sm border-b border-slate-200 bg-indigo-50/60 text-center">第二堂</th>
                                                <th colSpan="2" className="py-2 px-3 font-bold text-slate-600 text-sm border-b border-slate-200 bg-slate-100/50 text-center">皆可</th>
                                                <th rowSpan="2" className="py-2 px-3 font-extrabold text-slate-800 text-sm border-b border-slate-200 bg-slate-100/80 text-center align-middle">總計人數</th>
                                                <th rowSpan="2" className="py-2 px-4 font-extrabold text-slate-800 text-sm border-b border-slate-200 bg-slate-100/80 text-center align-middle">人力缺口 (FTE)</th>
                                            </tr>
                                            <tr>
                                                <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-indigo-50/30 text-center">人頭</th>
                                                <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-indigo-50/30 text-center">FTE</th>
                                                <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-indigo-50/30 text-center">人頭</th>
                                                <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-indigo-50/30 text-center">FTE</th>
                                                <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-slate-50/80 text-center">人頭</th>
                                                <th className="py-1.5 px-2 font-semibold text-slate-500 text-[11px] border-b-2 border-slate-200 bg-slate-50/80 text-center">FTE</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {insights.positionDistribution.map((pos, idx) => {
                                                const currentReq = requirements[pos.name]?.singleSession || 0;
                                                const currentMaxLimit = requirements[pos.name]?.maxLimit || 6;
                                                return (
                                                    <tr key={pos.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} hover:bg-slate-50 transition-colors`}>
                                                        <td className="py-3.5 px-4 font-bold text-slate-700 border-b border-slate-100">{pos.name}</td>
                                                        
                                                        {/* 動態調整：人數(堂) */}
                                                        <td className="py-3.5 px-1 text-center border-b border-slate-100 bg-indigo-50/10">
                                                            <div className="flex items-center justify-center gap-1.5">
                                                                <button onClick={() => handleUpdateReq(pos.name, -1)} disabled={currentReq <= 0} className="w-5 h-5 flex items-center justify-center bg-white hover:bg-slate-200 text-slate-500 rounded border border-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed leading-none pb-0.5">-</button>
                                                                <span className="font-extrabold text-indigo-700 w-3 text-center">{currentReq}</span>
                                                                <button onClick={() => handleUpdateReq(pos.name, 1)} className="w-5 h-5 flex items-center justify-center bg-white hover:bg-slate-200 text-slate-500 rounded border border-slate-200 transition-colors leading-none pb-0.5">+</button>
                                                            </div>
                                                        </td>

                                                        {/* 動態調整：服事上限(次/季) */}
                                                        <td className="py-3.5 px-1 text-center border-b border-slate-100 bg-emerald-50/30">
                                                            <div className="flex items-center justify-center gap-1.5">
                                                                <button onClick={() => handleUpdateLimit(pos.name, -1)} disabled={currentMaxLimit <= 1} className="w-5 h-5 flex items-center justify-center bg-white hover:bg-slate-200 text-slate-500 rounded border border-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed leading-none pb-0.5">-</button>
                                                                <span className="font-extrabold text-emerald-700 w-4 text-center">{currentMaxLimit}</span>
                                                                <button onClick={() => handleUpdateLimit(pos.name, 1)} className="w-5 h-5 flex items-center justify-center bg-white hover:bg-slate-200 text-slate-500 rounded border border-slate-200 transition-colors leading-none pb-0.5">+</button>
                                                            </div>
                                                        </td>

                                                        {/* 第一堂 */}
                                                        <td className={`py-3.5 px-2 text-center border-b border-slate-100 ${pos.s1Health === 'red' ? 'bg-rose-50/70 text-rose-600' : 'bg-indigo-50/10 text-slate-700'}`}>
                                                            <div className="font-bold text-base leading-none">{pos.s1Count}</div>
                                                        </td>
                                                        <td className={`py-3.5 px-2 text-center border-b border-slate-100 ${pos.s1Health === 'red' ? 'bg-rose-50/70 text-rose-600' : 'bg-indigo-50/10 text-indigo-600'}`}>
                                                            <div className="font-semibold text-sm leading-none">{pos.s1FTE}</div>
                                                        </td>

                                                        {/* 第二堂 */}
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
                                                        
                                                        {/* 總計人數 */}
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-slate-100/30 font-extrabold text-base text-slate-800">
                                                            {pos.totalCount}
                                                        </td>

                                                        {/* 人力缺口 + 💡智能策略提示 */}
                                                        <td className="py-3.5 px-4 text-center border-b border-slate-100 font-bold text-base">
                                                            <div className="flex items-center justify-center gap-2 relative group cursor-help">
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
                                                                
                                                                {currentReq > 0 && (
                                                                    <div title={pos.strategyTip} className="flex items-center justify-center w-6 h-6 rounded-full bg-amber-50 text-amber-500 hover:bg-amber-100 transition-colors shadow-sm">
                                                                        <span className="text-sm">💡</span>
                                                                    </div>
                                                                )}
                                                            </div>
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
            </div>
        </div>
    );
};

window.TeamInsights = TeamInsights;
