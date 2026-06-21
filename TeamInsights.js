import React, { useState, useEffect, useMemo } from 'react';
import { 
    Home, Users, Calendar, LogOut, BarChart3, ChevronLeft, 
    UserCheck, UserMinus, LayoutList, CheckCircle2, AlertTriangle, XCircle, Coffee
} from 'lucide-react';

// ==========================================
// 崗位需求設定參數 (單堂需求人數)
// ==========================================
const POSITION_REQUIREMENTS = {
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
    if (!qStr || qStr === 'BASE') return null;
    let [y, q] = qStr.split('-Q').map(Number);
    if (q === 1) return `${y - 1}-Q4`;
    return `${y}-Q${q - 1}`;
};

const getYoYQuarter = (qStr) => {
    if (!qStr || qStr === 'BASE') return null;
    let [y, q] = qStr.split('-Q').map(Number);
    return `${y - 1}-Q${q}`;
};

// ==========================================
// 視覺元件：歷史趨勢標籤 (紅漲綠跌)
// ==========================================
const TrendIndicator = ({ label, value }) => {
    if (value === null || value === undefined) return <div className="text-[11px] text-slate-400 font-bold flex justify-between items-center w-full"><span>{label}</span><span>無資料</span></div>;
    if (value > 0) return <div className="text-[11px] text-rose-500 font-bold flex justify-between items-center w-full"><span>{label}</span><span>↑ {value} 人</span></div>;
    if (value < 0) return <div className="text-[11px] text-emerald-500 font-bold flex justify-between items-center w-full"><span>{label}</span><span>↓ {Math.abs(value)} 人</span></div>;
    return <div className="text-[11px] text-slate-400 font-bold flex justify-between items-center w-full"><span>{label}</span><span>- 0 人</span></div>;
};

const GlobalStatCard = ({ icon: Icon, title, value, unit, iconBgClass, iconTextClass, qoq, yoy }) => (
    <div className="bg-white rounded-xl shadow-soft border border-slate-100 flex flex-col relative overflow-hidden h-full">
        <div className="p-4 lg:p-5 flex-1 relative z-10 flex flex-col">
            <div className="flex justify-between items-start mb-3">
                <div className={`${iconBgClass} p-2 rounded-lg ${iconTextClass}`}><Icon size={18} strokeWidth={2.5}/></div>
            </div>
            <div className="mb-2">
                <p className="text-xs font-medium text-slate-500 mb-1">{title}</p>
                <p className="text-2xl font-bold text-slate-900 tracking-tight leading-none">{value} <span className="text-sm font-medium text-slate-400 ml-0.5">{unit}</span></p>
            </div>
        </div>
        <div className="pt-2.5 pb-3 px-4 lg:px-5 border-t border-slate-100 flex flex-col gap-1.5 w-full bg-slate-50 relative z-10">
            <TrendIndicator label="QoQ (季)" value={qoq} />
            <TrendIndicator label="YoY (年)" value={yoy} />
        </div>
        <div className={`absolute top-4 right-[-10%] opacity-[0.03] scale-150 ${iconTextClass} pointer-events-none`}><Icon size={100} /></div>
    </div>
);

const TeamInsights = ({ session, goBack, goToMembers, goToSchedule, supabase, utils }) => {
    const { fetchAllData, getCurrentQuarter } = utils;
    
    const [isLoading, setIsLoading] = useState(true);
    
    // 季度狀態管理
    const [availableQuarters, setAvailableQuarters] = useState([]);
    const [latestQuarter, setLatestQuarter] = useState('');
    const [viewQuarter, setViewQuarter] = useState('');
    
    const qoqQuarter = useMemo(() => getPrevQuarter(latestQuarter), [latestQuarter]);
    const yoyQuarter = useMemo(() => getYoYQuarter(latestQuarter), [latestQuarter]);

    const [dbData, setDbData] = useState({ members: [], positions: [], memberPositions: [], quarterSettings: [] });

    // 1. 初始化：取得資料庫中所有季度並定義「最新一季 (Latest)」
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
                        setLatestQuarter(qs[0]);
                        setViewQuarter(qs[0]); 
                    } else {
                        const currentQ = getCurrentQuarter();
                        setAvailableQuarters([currentQ]);
                        setLatestQuarter(currentQ);
                        setViewQuarter(currentQ);
                    }
                }
            } catch (err) { console.error('抓取季度失敗', err); }
        };
        fetchQuarters();
    }, []);

    // 2. 載入所需數據 (包含視圖季度與全局指標需要的歷史季度)
    useEffect(() => {
        if (!viewQuarter || !latestQuarter) return;

        const targetQuarters = [...new Set([viewQuarter, latestQuarter, qoqQuarter, yoyQuarter])].filter(Boolean);

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
                    fetchAllData(() => supabase.from('member_quarter_settings').select('*').in('quarter', targetQuarters))
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
    }, [viewQuarter, latestQuarter, qoqQuarter, yoyQuarter]);

    // ==========================================
    // 計算 1：全局戰略指標 (鎖定 latestQuarter)
    // ==========================================
    const globalStats = useMemo(() => {
        if (!latestQuarter || dbData.members.length === 0) return null;

        const realMembers = dbData.members.filter(m => !m.name.startsWith('SYSTEM_'));
        const { quarterSettings } = dbData;

        const getQuarterStat = (qStr) => {
            if (!qStr) return null;
            const hasData = quarterSettings.some(qs => qs.quarter === qStr);
            if (!hasData && qStr !== latestQuarter) return null; 

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

        const current = getQuarterStat(latestQuarter);
        if (!current) return null;

        const qoq = getQuarterStat(qoqQuarter);
        const yoy = getQuarterStat(yoyQuarter);

        const calcDiff = (curr, past, key) => past ? (curr[key] - past[key]) : null;

        return {
            current,
            qoqDiff: {
                total: calcDiff(current, qoq, 'total'),
                active: calcDiff(current, qoq, 'active'),
                suspended: calcDiff(current, qoq, 'suspended'),
                sabbatical: calcDiff(current, qoq, 'sabbatical'),
            },
            yoyDiff: {
                total: calcDiff(current, yoy, 'total'),
                active: calcDiff(current, yoy, 'active'),
                suspended: calcDiff(current, yoy, 'suspended'),
                sabbatical: calcDiff(current, yoy, 'sabbatical'),
            }
        };
    }, [dbData, latestQuarter, qoqQuarter, yoyQuarter]);

    // ==========================================
    // 計算 2：單季操作洞察 (依據 viewQuarter)
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

        // 崗位人力分布與單堂健康度試算
        const positionDistribution = positions.map(pos => {
            let session1 = 0, session2 = 0, both = 0;
            realMembers.forEach(m => {
                if (!activeMemberIds.has(m.id)) return; // 實質可排班人力，排除安息/暫停同工
                const hasPos = memberPositions.some(mp => mp.member_id === m.id && mp.position_id === pos.id && mp.is_active !== false); // 排除暫停崗位
                if (hasPos) {
                    const pref = qsMap[m.id]?.preferred_session || '第一堂';
                    if (pref === '第一堂') session1++;
                    else if (pref === '第二堂') session2++;
                    else both++;
                }
            });
            const total = session1 + session2 + both;

            // 計算單堂低標指標
            const req = POSITION_REQUIREMENTS[pos.name] || { singleSession: 0, freq: 'weekly' };
            let sessionQuarterDemand = req.freq === 'monthly' ? req.singleSession * 3 : req.singleSession * 13; 
            const sessionMinRequired = Math.ceil(sessionQuarterDemand / 6);

            // 判斷單堂健康度 (只看純第一堂/第二堂數字)
            let s1Health = 'gray';
            let s2Health = 'gray';

            if (req.singleSession > 0) {
                s1Health = session1 >= sessionMinRequired ? 'green' : 'red';
                s2Health = session2 >= sessionMinRequired ? 'green' : 'red';
            }

            return { 
                id: pos.id, name: pos.name, 
                session1, session2, both, total,
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
    }, [dbData, viewQuarter]);

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
                    {isLoading || !globalStats ? (
                        <div className="h-full flex items-center justify-center text-slate-400 font-medium animate-pulse">計算數據中...</div>
                    ) : (
                        <div className="max-w-7xl mx-auto space-y-6">
                            
                            {/* 頂部：全局戰略指標 (鎖定最新季度) */}
                            <div>
                                <div className="flex items-center gap-2 mb-4">
                                    <span className="bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider uppercase">全局戰略指標</span>
                                    <span className="text-sm font-bold text-slate-400">數據基準：{latestQuarter}</span>
                                </div>
                                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
                                    <GlobalStatCard 
                                        icon={Users} title="同工總人數" value={globalStats.current.total} unit="人" 
                                        iconBgClass="bg-slate-100" iconTextClass="text-slate-600" 
                                        qoq={globalStats.qoqDiff.total} yoy={globalStats.yoyDiff.total} 
                                    />
                                    <GlobalStatCard 
                                        icon={CheckCircle2} title="上線服事人數" value={globalStats.current.active} unit="人" 
                                        iconBgClass="bg-emerald-50" iconTextClass="text-emerald-600" 
                                        qoq={globalStats.qoqDiff.active} yoy={globalStats.yoyDiff.active} 
                                    />
                                    <GlobalStatCard 
                                        icon={UserMinus} title="暫停服事人數" value={globalStats.current.suspended} unit="人" 
                                        iconBgClass="bg-orange-50" iconTextClass="text-orange-600" 
                                        qoq={globalStats.qoqDiff.suspended} yoy={globalStats.yoyDiff.suspended} 
                                    />
                                    <GlobalStatCard 
                                        icon={Coffee} title="安息季人數" value={globalStats.current.sabbatical} unit="人" 
                                        iconBgClass="bg-sky-50" iconTextClass="text-sky-600" 
                                        qoq={globalStats.qoqDiff.sabbatical} yoy={globalStats.yoyDiff.sabbatical} 
                                    />
                                </div>
                            </div>

                            <hr className="border-slate-200 my-8" />

                            {/* 底部：單季操作沙盤 (受下拉選單控制) */}
                            <div>
                                <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4 justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="bg-violet-100 text-violet-700 px-2.5 py-1 rounded-md text-[11px] font-bold tracking-wider uppercase">單季操作沙盤</span>
                                        <span className="text-sm font-bold text-slate-400">檢視個別季度細節</span>
                                    </div>
                                    <select 
                                        value={viewQuarter} 
                                        onChange={e => setViewQuarter(e.target.value)} 
                                        className="bg-white border border-slate-200 rounded-lg px-4 py-2 font-bold text-violet-600 text-sm outline-none cursor-pointer focus:ring-2 focus:ring-violet-500/20 shadow-sm transition-all"
                                    >
                                        {availableQuarters.map(q => <option key={q} value={q}>{q.replace('-', '')}</option>)}
                                    </select>
                                </div>
                                
                                <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                                    {/* 左側：崗位人力分布與單堂健康度 (佔3格) */}
                                    <div className="xl:col-span-3 bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                                <LayoutList className="text-indigo-500" size={20} />
                                                <h3 className="text-lg font-bold text-slate-800">單堂人力分布現況</h3>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto flex-1">
                                            <table className="w-full text-left border-collapse min-w-[550px]">
                                                <thead>
                                                    <tr>
                                                        <th className="py-3 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50">崗位</th>
                                                        <th className="py-3 px-2 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50 text-center">單堂低標</th>
                                                        <th className="py-3 px-3 font-semibold text-slate-700 text-sm border-b border-slate-200 bg-indigo-50/30 text-center">第一堂</th>
                                                        <th className="py-3 px-3 font-semibold text-slate-700 text-sm border-b border-slate-200 bg-indigo-50/30 text-center">第二堂</th>
                                                        <th className="py-3 px-3 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50 text-center">皆可</th>
                                                        <th className="py-3 px-4 font-bold text-slate-700 text-sm border-b border-slate-200 bg-slate-50 text-center">總計</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {insights.positionDistribution.map((pos, idx) => (
                                                        <tr key={pos.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} hover:bg-slate-50 transition-colors`}>
                                                            <td className="py-3.5 px-4 font-bold text-slate-700 border-b border-slate-100">{pos.name}</td>
                                                            
                                                            <td className="py-3.5 px-2 text-center border-b border-slate-100 font-bold text-slate-400">
                                                                {pos.sessionMinRequired > 0 ? `${pos.sessionMinRequired}` : '-'}
                                                            </td>

                                                            <td className={`py-3.5 px-3 text-center border-b border-slate-100 ${pos.s1Health === 'red' ? 'bg-rose-50/70' : 'bg-indigo-50/10'}`}>
                                                                <div className={`font-bold text-lg leading-none ${pos.s1Health === 'red' ? 'text-rose-600' : 'text-slate-700'}`}>
                                                                    {pos.session1}
                                                                </div>
                                                            </td>

                                                            <td className={`py-3.5 px-3 text-center border-b border-slate-100 ${pos.s2Health === 'red' ? 'bg-rose-50/70' : 'bg-indigo-50/10'}`}>
                                                                <div className={`font-bold text-lg leading-none ${pos.s2Health === 'red' ? 'text-rose-600' : 'text-slate-700'}`}>
                                                                    {pos.session2}
                                                                </div>
                                                            </td>

                                                            <td className="py-3.5 px-3 text-center font-bold text-slate-500 border-b border-slate-100 bg-slate-50">{pos.both}</td>
                                                            
                                                            <td className="py-3.5 px-4 text-center font-extrabold text-lg text-indigo-600 border-b border-slate-100 bg-slate-50">{pos.total}</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>

                                    {/* 右側：崗位兼任分析長條圖 (佔2格) */}
                                    <div className="xl:col-span-2 bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                        <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                                            <UserCheck className="text-violet-500" size={20} />
                                            <h3 className="text-lg font-bold text-slate-800">崗位兼任現況 <span className="text-sm text-slate-400 font-normal ml-1">(全體同工)</span></h3>
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
