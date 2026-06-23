import React, { useState, useEffect, useMemo } from 'react';
import { 
    Home, Users, Calendar, LogOut, BarChart3, ChevronLeft, 
    UserCheck, LayoutList, TrendingUp, Lightbulb, X, Target, 
    Zap, UserPlus, AlertCircle, CheckCircle2, Wand2, Undo2,
    UsersRound
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
// 視覺元件：歷史趨勢儲格
// ==========================================
const DiffCell = ({ diff }) => {
    const baseClass = "px-2 py-2.5 text-center text-[12px] font-bold border-b border-slate-100/50";
    if (diff === null || diff === undefined) return <td className={`${baseClass} text-slate-300`}>-</td>;
    if (diff > 0) return <td className={`${baseClass} text-rose-500`}>↑ {diff} 人</td>;
    if (diff < 0) return <td className={`${baseClass} text-emerald-500`}>↓ {Math.abs(diff)} 人</td>;
    return <td className={`${baseClass} text-slate-400 font-medium`}>- 0 人</td>;
};

// ==========================================
// 視覺元件：FTE 懸浮提示框 (Tooltip)
// ==========================================
const FteTooltip = () => (
    <div className="relative group cursor-help ml-1 inline-flex items-center">
        <span className="text-[10px] text-slate-400 font-normal border border-slate-300 rounded-full w-3.5 h-3.5 flex items-center justify-center group-hover:bg-indigo-100 group-hover:text-indigo-600 group-hover:border-indigo-300 transition-colors">?</span>
        <div className="absolute z-50 hidden group-hover:block w-[320px] p-4 bg-slate-800 text-slate-50 text-[12px] leading-relaxed rounded-xl shadow-2xl bottom-full left-1/2 -translate-x-1/2 mb-2 text-left font-normal normal-case pointer-events-none border border-slate-700">
            <div className="font-bold text-white mb-2 pb-2 border-b border-slate-600">
                FTE (有效人力) ：同工對單一崗位的實際貢獻度
            </div>
            <div className="mb-3 space-y-1">
                <div className="font-bold text-rose-300">🛡️ 【專任崗位】司會、PPT、執事輪值</div>
                <div className="text-slate-300">無法崗位兼任，FTE被崗位數平分</div>
                <div className="text-slate-400 text-[11px] bg-slate-900/50 p-1.5 rounded">範例：具備司會、PPT技能的同工，兩個崗位的FTE=1/2=0.5</div>
            </div>
            <div className="space-y-1">
                <div className="font-bold text-amber-300">⚡ 【崗位兼任】接待、收奉獻、主餐、新朋友關懷</div>
                <div className="text-slate-300">支援崗位兼任，FTE不被崗位數影響</div>
                <div className="text-slate-400 text-[11px] bg-slate-900/50 p-1.5 rounded">範例：具備接待、收奉獻技能的同工，兩個崗位的FTE=1</div>
            </div>
            {/* 小箭頭 */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
        </div>
    </div>
);

const TeamInsights = ({ session, goBack, goToMembers, goToSchedule, supabase, utils }) => {
    const { fetchAllData, getCurrentQuarter } = utils;
    
    const [isLoading, setIsLoading] = useState(true);
    const [availableQuarters, setAvailableQuarters] = useState([]);
    const [viewQuarter, setViewQuarter] = useState('');
    const [dbData, setDbData] = useState({ members: [], positions: [], memberPositions: [], quarterSettings: [] });

    // 沙盤推演狀態
    const [requirements, setRequirements] = useState(INITIAL_REQUIREMENTS);
    const [drawerPos, setDrawerPos] = useState(null);
    
    // 魔術棒狀態：紀錄各崗位調用的順序 { '接待': ['s1', 's2'] }
    const [wandState, setWandState] = useState({});

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

    // 切換智能面板
    const toggleDrawer = (posName) => {
        setDrawerPos(prev => prev === posName ? null : posName);
    };

    // 切換魔術棒調度
    const toggleWand = (posName, sessionType) => {
        setWandState(prev => {
            const current = prev[posName] || [];
            if (current.includes(sessionType)) {
                return { ...prev, [posName]: current.filter(s => s !== sessionType) };
            } else {
                return { ...prev, [posName]: [...current, sessionType] };
            }
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
    // 計算 2：單季操作洞察 (含魔術棒連動)
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
            
            const baseS1Gap = req.singleSession > 0 ? Math.round((s1FTE - sessionMinRequired) * 10) / 10 : 0;
            const baseS2Gap = req.singleSession > 0 ? Math.round((s2FTE - sessionMinRequired) * 10) / 10 : 0;
            
            const totalRequirement = sessionMinRequired * 2;
            const gap = req.singleSession > 0 ? Math.round((totalFTE - totalRequirement) * 10) / 10 : 0;

            // 魔術棒調度邏輯
            let currentPool = bothFTE;
            let displayS1Gap = baseS1Gap;
            let displayS2Gap = baseS2Gap;
            const activeWands = wandState[pos.name] || [];

            activeWands.forEach(session => {
                if (session === 's1' && displayS1Gap < 0 && currentPool > 0) {
                    const transfer = Math.min(Math.abs(displayS1Gap), currentPool);
                    displayS1Gap = Math.round((displayS1Gap + transfer) * 10) / 10;
                    currentPool = Math.round((currentPool - transfer) * 10) / 10;
                } else if (session === 's2' && displayS2Gap < 0 && currentPool > 0) {
                    const transfer = Math.min(Math.abs(displayS2Gap), currentPool);
                    displayS2Gap = Math.round((displayS2Gap + transfer) * 10) / 10;
                    currentPool = Math.round((currentPool - transfer) * 10) / 10;
                }
            });

            return { 
                id: pos.id, name: pos.name, 
                s1Count, s2Count, bothCount, totalCount,
                s1FTE, s2FTE, bothFTE, gap,
                baseS1Gap, baseS2Gap,
                displayS1Gap, displayS2Gap,
                sessionMinRequired,
                activeWands, currentPool,
                currentReq: req.singleSession
            };
        });

        const concurrencyMap = {};
        realMembers.forEach(m => {
            const realCount = memberPositions.filter(mp => mp.member_id === m.id && mp.is_active !== false).length;
            concurrencyMap[realCount] = (concurrencyMap[realCount] || 0) + 1;
        });

        const concurrencyData = Object.keys(concurrencyMap).map(Number).sort((a, b) => a - b).map(count => ({
            roles: count, people: concurrencyMap[count]
        }));
        const maxConcurrencyPeople = Math.max(0, ...concurrencyData.map(d => d.people));

        return { positionDistribution, concurrencyData, maxConcurrencyPeople, activeMemberIds };
    }, [dbData, viewQuarter, requirements, wandState]);

    // ==========================================
    // 計算 3：動態側邊欄內容渲染引擎
    // ==========================================
    const renderDrawerContent = () => {
        if (!drawerPos) return null;
        const posData = insights.positionDistribution.find(p => p.name === drawerPos);
        if (!posData) return null;

        const req = requirements[drawerPos] || { maxLimit: 6 };
        const gap = posData.gap;
        const missingSessions = gap < 0 ? Math.round(Math.abs(gap) * req.maxLimit) : 0;
        const isCompat = COMPATIBLE_GROUP.includes(drawerPos);

        let potentialHelpersCount = 0;
        if (isCompat) {
            const { members, memberPositions, positions } = dbData;
            const realMembers = members.filter(m => !m.name.startsWith('SYSTEM_') && insights.activeMemberIds.has(m.id));
            
            realMembers.forEach(m => {
                const activePos = memberPositions.filter(mp => mp.member_id === m.id && mp.is_active !== false);
                if (activePos.length === 1) {
                    const pName = positions.find(p => p.id === activePos[0].position_id)?.name;
                    if (COMPATIBLE_GROUP.includes(pName) && pName !== drawerPos) {
                        potentialHelpersCount++;
                    }
                }
            });
        }

        const actionPlans = [];

        if (isCompat) {
            actionPlans.push({
                title: "啟動「崗位兼任」",
                icon: <Zap size={16} className={potentialHelpersCount > 0 ? "text-amber-500" : "text-slate-400"} />,
                isPriority: potentialHelpersCount > 0,
                content: (
                    <div className="text-sm text-slate-600 space-y-2">
                        <p><strong className="text-slate-700">📍 數據支持：</strong>目前共有 <strong className="text-amber-600 text-base">{potentialHelpersCount} 位</strong> 同工屬於單一崗位同工。</p>
                        <p><strong className="text-slate-700">👉 具體行動：</strong>培訓{potentialHelpersCount} 位同工，兼任「{drawerPos}」。</p>
                        <p className="text-amber-700 bg-amber-50 p-2 rounded text-xs leading-relaxed"><strong className="font-bold">預期效益：</strong>不增加同工服事天數，100%高效率轉換率補齊缺口。</p>
                    </div>
                )
            });
        }

        actionPlans.push({
            title: "調高服事上限",
            icon: <TrendingUp size={16} className="text-indigo-500" />,
            isPriority: false,
            content: (
                <div className="text-sm text-slate-600 space-y-2">
                    <p><strong className="text-slate-700">📍 數據支持：</strong>若您將本崗位的上限從 {req.maxLimit} 次適度調高。</p>
                    <p className="text-indigo-700 bg-indigo-50 p-2 rounded text-xs leading-relaxed"><strong className="font-bold">預期效益：</strong>缺口將瞬間縮小或歸零！請在會議中評估同工的疲勞度。</p>
                </div>
            )
        });

        if (posData.currentReq > 1) {
            actionPlans.push({
                title: "減少服事人數",
                icon: <UsersRound size={16} className="text-cyan-500" />,
                isPriority: false,
                content: (
                    <div className="text-sm text-slate-600 space-y-2">
                        <p><strong className="text-slate-700">📍 數據支持：</strong>本崗位目前設定每堂需安排 <strong className="text-slate-800">{posData.currentReq} 人</strong>。</p>
                        <p><strong className="text-slate-700">👉 具體行動：</strong>評估是否能將單堂需求人數縮減至 <strong className="text-cyan-600">{posData.currentReq - 1} 人</strong>（可在左側點擊 - 推演）。</p>
                        <p className="text-cyan-800 bg-cyan-50 p-2 rounded text-xs leading-relaxed"><strong className="font-bold">預期效益：</strong>立即降低整體人力負擔，有效緩解缺口壓力。</p>
                    </div>
                )
            });
        }

        actionPlans.push({
            title: "招募新人",
            icon: <UserPlus size={16} className="text-emerald-500" />,
            isPriority: false,
            content: (
                <div className="text-sm text-slate-600 space-y-2">
                    <p><strong className="text-slate-700">📍 數據支持：</strong>若不希望現有同工違規加班。</p>
                    <p><strong className="text-slate-700">👉 具體行動：</strong>請針對本崗位啟動招募新人計畫，預計需要招募 <strong className="text-emerald-600 text-base">{Math.abs(gap)} 位</strong> 新血。</p>
                </div>
            )
        });

        return (
            <div className="h-full flex flex-col">
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-indigo-50/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 rounded-lg text-indigo-600"><Lightbulb size={20} /></div>
                        <h3 className="text-xl font-extrabold text-slate-800 tracking-tight">智能策略分析</h3>
                    </div>
                    <button onClick={() => setDrawerPos(null)} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"><X size={20} /></button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
                        <div className="flex items-center gap-2 mb-3">
                            <Target size={18} className="text-slate-500" />
                            <h4 className="font-bold text-slate-700 text-sm">人力診斷：<span className="text-indigo-600 text-base ml-1">【{drawerPos}】</span></h4>
                        </div>
                        {gap < 0 ? (
                            <div>
                                <div className="text-2xl font-extrabold text-rose-600 mb-1 flex items-center gap-2">
                                    <AlertCircle size={22} />人力短缺 ({gap} FTE)
                                </div>
                                <p className="text-sm text-slate-600 leading-relaxed mt-2">
                                    每季服事上限 <strong className="text-slate-800">{req.maxLimit} 次</strong>，共缺 <strong className="text-rose-600 bg-rose-50 px-1 rounded">{missingSessions} 次</strong> 的服事次數。
                                </p>
                            </div>
                        ) : gap === 0 ? (
                            <div>
                                <div className="text-2xl font-extrabold text-slate-500 mb-1 flex items-center gap-2">
                                    <CheckCircle2 size={22} />人力平衡 (0.0 FTE)
                                </div>
                                <p className="text-sm text-slate-600 leading-relaxed mt-2">
                                    每季服事上限 {req.maxLimit} 次，人力供需平衡。
                                </p>
                            </div>
                        ) : (
                            <div>
                                <div className="text-2xl font-extrabold text-emerald-500 mb-1 flex items-center gap-2">
                                    <CheckCircle2 size={22} />人力充足 (+{gap} FTE)
                                </div>
                                <p className="text-sm text-slate-600 leading-relaxed mt-2">
                                    人手充足！可以將「服事上限」調降，或進行崗位兼任計畫。
                                </p>
                            </div>
                        )}
                    </div>

                    {gap < 0 && (
                        <div className="space-y-4">
                            <h4 className="font-bold text-slate-800 border-b border-slate-100 pb-2">🎯 分析建議：</h4>
                            
                            {actionPlans.map((plan, index) => (
                                <div key={index} className={`p-4 rounded-xl border ${plan.isPriority ? 'bg-amber-50/50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
                                    <h5 className="font-bold text-sm text-slate-800 flex items-center gap-2 mb-2">
                                        {plan.icon}
                                        方案{['一', '二', '三', '四'][index]}：{plan.title}
                                        {plan.isPriority && <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold ml-1">優先推薦</span>}
                                    </h5>
                                    {plan.content}
                                </div>
                            ))}
                            {!isCompat && (
                                <div className="text-xs text-slate-400 italic px-2">
                                    *備註：此崗位屬專任崗位，無法啟動「崗位兼任」策略。
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden relative">
            {/* 側邊導覽列 */}
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

            {/* 主要內容區 */}
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
                            
                            {/* 上半部：左右並排佈局 */}
                            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                                {/* 左側：人力總覽大表 */}
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

                                {/* 右側：全域崗位技能分布圖 */}
                                <div className="xl:col-span-1 bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col h-full">
                                    <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                                        <UserCheck className="text-violet-500" size={20} />
                                        <h3 className="text-lg font-bold text-slate-800">崗位技能分布</h3>
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

                            {/* 下半部全寬：人力需求分析 */}
                            <div className="bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col w-full">
                                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <LayoutList className="text-indigo-500" size={20} />
                                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                            人力需求分析
                                            <span className="text-sm font-normal text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded-full ml-2">{viewQuarter.replace('-', '')}</span>
                                        </h3>
                                    </div>
                                </div>
                                <div className="overflow-x-auto w-full">
                                    <table className="w-full text-left border-collapse min-w-[1050px]">
                                        <thead>
                                            <tr>
                                                <th rowSpan="2" className="py-2 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50 align-middle">崗位</th>
                                                <th rowSpan="2" className="py-2 px-2 font-semibold text-indigo-600 text-[13px] border-b border-slate-200 bg-indigo-50/30 text-center align-middle">人數(堂)</th>
                                                <th rowSpan="2" className="py-2 px-2 font-semibold text-emerald-700 text-[13px] border-b border-slate-200 bg-emerald-50/50 text-center align-middle">服事上限<br/><span className="text-[10px] font-normal text-emerald-600">(次/季)</span></th>
                                                
                                                <th colSpan="3" className="py-2 px-3 font-bold text-sky-900 text-sm border-b border-slate-200 bg-sky-50/60 text-center border-r-2 border-slate-200">第一堂</th>
                                                <th colSpan="3" className="py-2 px-3 font-bold text-violet-900 text-sm border-b border-slate-200 bg-violet-50/60 text-center border-r-2 border-slate-200">第二堂</th>
                                                <th colSpan="2" className="py-2 px-3 font-bold text-slate-700 text-sm border-b border-slate-200 bg-slate-100/80 text-center border-r-2 border-slate-200">皆可</th>
                                                
                                                <th rowSpan="2" className="py-2 px-3 font-extrabold text-slate-800 text-sm border-b border-slate-200 bg-slate-100/50 text-center align-middle">總人數</th>
                                                <th rowSpan="2" className="py-2 px-4 font-extrabold text-slate-800 text-sm border-b border-slate-200 bg-slate-100/50 text-center align-middle">智能策略分析</th>
                                            </tr>
                                            <tr>
                                                <th className="py-1.5 px-2 font-semibold text-slate-400 text-[11px] border-b-2 border-slate-200 bg-sky-50/30 text-center">人數</th>
                                                <th className="py-1.5 px-2 font-bold text-sky-700 text-[11px] border-b-2 border-slate-200 bg-sky-50/30 text-center">
                                                    <div className="flex items-center justify-center">FTE <FteTooltip /></div>
                                                </th>
                                                <th className="py-1.5 px-2 font-bold text-sky-800 text-[11px] border-b-2 border-slate-200 bg-sky-50/30 text-center border-r-2 border-slate-200">缺口</th>
                                                
                                                <th className="py-1.5 px-2 font-semibold text-slate-400 text-[11px] border-b-2 border-slate-200 bg-violet-50/30 text-center">人數</th>
                                                <th className="py-1.5 px-2 font-bold text-violet-700 text-[11px] border-b-2 border-slate-200 bg-violet-50/30 text-center">
                                                    <div className="flex items-center justify-center">FTE <FteTooltip /></div>
                                                </th>
                                                <th className="py-1.5 px-2 font-bold text-violet-800 text-[11px] border-b-2 border-slate-200 bg-violet-50/30 text-center border-r-2 border-slate-200">缺口</th>
                                                
                                                <th className="py-1.5 px-2 font-semibold text-slate-400 text-[11px] border-b-2 border-slate-200 bg-slate-50 text-center">人數</th>
                                                <th className="py-1.5 px-2 font-bold text-slate-700 text-[11px] border-b-2 border-slate-200 bg-slate-50 text-center border-r-2 border-slate-200">
                                                    <div className="flex items-center justify-center">FTE <FteTooltip /></div>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {insights.positionDistribution.map((pos, idx) => {
                                                const currentReq = requirements[pos.name]?.singleSession || 0;
                                                const currentMaxLimit = requirements[pos.name]?.maxLimit || 6;
                                                
                                                const showS1Wand = currentReq > 0 && ((pos.baseS1Gap < 0 && pos.currentPool > 0) || pos.activeWands.includes('s1'));
                                                const showS2Wand = currentReq > 0 && ((pos.baseS2Gap < 0 && pos.currentPool > 0) || pos.activeWands.includes('s2'));

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

                                                        {/* 第一堂區塊 */}
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-sky-50/20">
                                                            <div className="text-slate-400 font-normal text-xs">{pos.s1Count}人</div>
                                                        </td>
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-sky-50/20">
                                                            <div className="font-bold text-sm text-sky-700">{pos.s1FTE}</div>
                                                        </td>
                                                        <td className="py-3.5 px-1 text-center border-b border-slate-100 bg-sky-50/20 border-r-2 border-slate-200">
                                                            {currentReq > 0 ? (
                                                                <div className="flex items-center justify-center gap-1.5">
                                                                    <span className={`font-extrabold text-[13px] ${pos.displayS1Gap < 0 ? 'text-rose-600' : pos.displayS1Gap > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                                        {pos.displayS1Gap > 0 ? `+${pos.displayS1Gap}` : pos.displayS1Gap === 0 ? '0.0' : pos.displayS1Gap}
                                                                    </span>
                                                                    {showS1Wand && (
                                                                        <button 
                                                                            onClick={() => toggleWand(pos.name, 's1')}
                                                                            className={`p-1 rounded transition-colors ${pos.activeWands.includes('s1') ? 'bg-sky-100 text-sky-700 hover:bg-sky-200' : 'bg-white text-slate-400 hover:text-sky-600 shadow-sm border border-slate-200'}`}
                                                                            title={pos.activeWands.includes('s1') ? '復原資源' : '由皆可池智能支援'}
                                                                        >
                                                                            {pos.activeWands.includes('s1') ? <Undo2 size={11} /> : <Wand2 size={11} />}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ) : <span className="text-slate-300">-</span>}
                                                        </td>

                                                        {/* 第二堂區塊 */}
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-violet-50/20">
                                                            <div className="text-slate-400 font-normal text-xs">{pos.s2Count}人</div>
                                                        </td>
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-violet-50/20">
                                                            <div className="font-bold text-sm text-violet-700">{pos.s2FTE}</div>
                                                        </td>
                                                        <td className="py-3.5 px-1 text-center border-b border-slate-100 bg-violet-50/20 border-r-2 border-slate-200">
                                                            {currentReq > 0 ? (
                                                                <div className="flex items-center justify-center gap-1.5">
                                                                    <span className={`font-extrabold text-[13px] ${pos.displayS2Gap < 0 ? 'text-rose-600' : pos.displayS2Gap > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                                                        {pos.displayS2Gap > 0 ? `+${pos.displayS2Gap}` : pos.displayS2Gap === 0 ? '0.0' : pos.displayS2Gap}
                                                                    </span>
                                                                    {showS2Wand && (
                                                                        <button 
                                                                            onClick={() => toggleWand(pos.name, 's2')}
                                                                            className={`p-1 rounded transition-colors ${pos.activeWands.includes('s2') ? 'bg-violet-100 text-violet-700 hover:bg-violet-200' : 'bg-white text-slate-400 hover:text-violet-600 shadow-sm border border-slate-200'}`}
                                                                            title={pos.activeWands.includes('s2') ? '復原資源' : '由皆可池智能支援'}
                                                                        >
                                                                            {pos.activeWands.includes('s2') ? <Undo2 size={11} /> : <Wand2 size={11} />}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ) : <span className="text-slate-300">-</span>}
                                                        </td>

                                                        {/* 皆可區塊：方案 A 直接取代 */}
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-slate-100/40">
                                                            <div className="text-slate-400 font-normal text-xs">{pos.bothCount}人</div>
                                                        </td>
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-slate-100/40 border-r-2 border-slate-200">
                                                            <div className={`font-bold text-sm ${pos.currentPool !== pos.bothFTE ? 'text-amber-600 animate-pulse' : 'text-slate-700'}`}>
                                                                {pos.currentPool}
                                                            </div>
                                                        </td>
                                                        
                                                        {/* 總計人數 */}
                                                        <td className="py-3.5 px-2 text-center border-b border-slate-100 bg-slate-50 font-bold text-sm text-slate-500">
                                                            {pos.totalCount}人
                                                        </td>

                                                        {/* 智能策略分析 */}
                                                        <td className="py-3.5 px-4 text-center border-b border-slate-100 bg-slate-50">
                                                            {currentReq > 0 ? (
                                                                <button 
                                                                    onClick={() => toggleDrawer(pos.name)}
                                                                    className={`flex items-center justify-center w-8 h-8 mx-auto rounded-full shadow-sm transition-all transform hover:scale-110 active:scale-95 
                                                                        ${drawerPos === pos.name ? 'ring-2 ring-offset-1 ring-slate-300' : ''}
                                                                        ${pos.gap < 0 ? 'bg-rose-50 text-rose-500 hover:bg-rose-100' : 
                                                                          pos.gap === 0 ? 'bg-slate-100 text-slate-400 hover:bg-slate-200' : 
                                                                          'bg-emerald-50 text-emerald-500 hover:bg-emerald-100'}`}
                                                                    title="點擊展開智能策略決策面板"
                                                                >
                                                                    <Lightbulb size={17} className={drawerPos === pos.name ? 'fill-current' : ''} />
                                                                </button>
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
                        </div>
                    )}
                </div>

                {/* 右側滑出層 (AI 智能策略分析 Drawer) */}
                {drawerPos && (
                    <div 
                        className="absolute inset-0 bg-slate-900/20 z-40 backdrop-blur-[1px] transition-opacity" 
                        onClick={() => setDrawerPos(null)} 
                    />
                )}
                <div className={`absolute top-0 right-0 w-full max-w-[400px] h-full bg-white shadow-2xl z-50 transform transition-transform duration-300 ease-out ${drawerPos ? 'translate-x-0' : 'translate-x-full'}`}>
                    {renderDrawerContent()}
                </div>
            </div>
        </div>
    );
};

window.TeamInsights = TeamInsights;
