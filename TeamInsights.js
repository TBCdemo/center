import React, { useState, useEffect, useMemo } from 'react';
import { 
    Home, Users, Calendar, LogOut, BarChart3, ChevronLeft, 
    UserCheck, UserMinus, LayoutList, CheckCircle2, AlertTriangle, XCircle
} from 'lucide-react';

// ==========================================
// 崗位需求設定參數 (單堂需求人數)
// freq: 'weekly' 代表每週常規, 'monthly' 代表每月一次
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

const TeamInsights = ({ session, goBack, goToMembers, goToSchedule, supabase, utils, StatCard }) => {
    const { fetchAllData, getCurrentQuarter } = utils;
    
    const [isLoading, setIsLoading] = useState(true);
    const [viewQuarter, setViewQuarter] = useState('');
    const [availableQuarters, setAvailableQuarters] = useState([]);
    const [dbData, setDbData] = useState({ members: [], positions: [], memberPositions: [], quarterSettings: [] });

    // 取得所有可用季度
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

    // 依據選擇的季度載入資料
    useEffect(() => {
        if (!viewQuarter) return;

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
                    fetchAllData(() => supabase.from('member_quarter_settings').select('*').in('quarter', [viewQuarter]))
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

    const insights = useMemo(() => {
        const { members, positions, memberPositions, quarterSettings } = dbData;
        
        const realMembers = members.filter(m => !m.name.startsWith('SYSTEM_'));
        const totalMembersCount = realMembers.length;

        const qsMap = {};
        quarterSettings.forEach(qs => { if(qs.quarter === viewQuarter) qsMap[qs.member_id] = qs; });

        let suspendedCount = 0;
        const activeMemberIds = new Set();

        realMembers.forEach(m => {
            const status = qsMap[m.id]?.availability_status || '穩定服事';
            if (status === '暫停服事') suspendedCount++;
            else activeMemberIds.add(m.id);
        });

        const activeCount = totalMembersCount - suspendedCount;

        // 3. 崗位人力分布與健康度試算
        const positionDistribution = positions.map(pos => {
            let session1 = 0, session2 = 0, both = 0;
            realMembers.forEach(m => {
                if (!activeMemberIds.has(m.id)) return;
                const hasPos = memberPositions.some(mp => mp.member_id === m.id && mp.position_id === pos.id && mp.is_active !== false);
                if (hasPos) {
                    const pref = qsMap[m.id]?.preferred_session || '第一堂';
                    if (pref === '第一堂') session1++;
                    else if (pref === '第二堂') session2++;
                    else both++;
                }
            });
            const total = session1 + session2 + both;

            // 計算健康度指標
            const req = POSITION_REQUIREMENTS[pos.name] || { singleSession: 0, freq: 'weekly' };
            let weeklyDemand = req.singleSession * 2; // 每週2堂
            let quarterDemand = req.freq === 'monthly' ? weeklyDemand * 3 : weeklyDemand * 13;

            // 公式：理想下限(每人每季4次內)、最低警戒(每人每季6次內)
            const idealMin = Math.ceil(quarterDemand / 4);
            const idealMax = Math.ceil(quarterDemand / 3);
            const minRequired = Math.ceil(quarterDemand / 6);

            let healthStatus = 'gray'; // 預設無資料
            if (req.singleSession > 0) {
                if (total >= idealMin) healthStatus = 'green';
                else if (total >= minRequired) healthStatus = 'yellow';
                else healthStatus = 'red';
            }

            return { 
                id: pos.id, name: pos.name, 
                session1, session2, both, total,
                quarterDemand, idealMin, idealMax, minRequired, healthStatus
            };
        });

        const concurrencyMap = {};
        realMembers.forEach(m => {
            if (!activeMemberIds.has(m.id)) return;
            const posCount = memberPositions.filter(mp => mp.member_id === m.id && mp.is_active !== false).length;
            concurrencyMap[posCount] = (concurrencyMap[posCount] || 0) + 1;
        });

        const concurrencyData = Object.keys(concurrencyMap).map(Number).sort((a, b) => a - b).map(count => ({
            roles: count, people: concurrencyMap[count]
        }));
        const maxConcurrencyPeople = Math.max(0, ...concurrencyData.map(d => d.people));

        return {
            totalMembersCount, suspendedCount, activeCount,
            positionDistribution, concurrencyData, maxConcurrencyPeople
        };
    }, [dbData, viewQuarter]);

    // 渲染健康度徽章
    const renderHealthBadge = (status) => {
        if (status === 'green') return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200 text-xs font-bold"><CheckCircle2 size={14}/> 充裕</span>;
        if (status === 'yellow') return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-amber-50 text-amber-600 border border-amber-200 text-xs font-bold"><AlertTriangle size={14}/> 緊繃</span>;
        if (status === 'red') return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-50 text-rose-600 border border-rose-200 text-xs font-bold"><XCircle size={14}/> 短缺</span>;
        return <span className="text-slate-300 text-xs">-</span>;
    };

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
                    {/* 季度切換器 */}
                    <div className="flex items-center gap-2 bg-slate-50 p-1.5 rounded-lg border border-slate-200 shadow-sm">
                        <span className="text-sm font-bold text-slate-500 pl-2">分析季度:</span>
                        <select 
                            value={viewQuarter} 
                            onChange={e => setViewQuarter(e.target.value)} 
                            className="bg-white border border-slate-200 rounded-md px-3 py-1 font-bold text-indigo-600 text-sm outline-none cursor-pointer focus:ring-2 focus:ring-indigo-500/20 shadow-sm transition-all"
                        >
                            {availableQuarters.map(q => <option key={q} value={q}>{q.replace('-', '')}</option>)}
                        </select>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar pb-24">
                    {isLoading ? (
                        <div className="h-full flex items-center justify-center text-slate-400 font-medium animate-pulse">計算數據中...</div>
                    ) : (
                        <div className="max-w-7xl mx-auto space-y-6">
                            {/* 三大指標卡片 */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <StatCard icon={Users} title="同工總人數" value={insights.totalMembersCount} unit="人" iconBgClass="bg-slate-100" iconTextClass="text-slate-600" />
                                <StatCard icon={CheckCircle2} title="上線服事人數" value={insights.activeCount} unit="人" iconBgClass="bg-emerald-50" iconTextClass="text-emerald-600" />
                                <StatCard icon={UserMinus} title="暫停服事人數" value={insights.suspendedCount} unit="人" iconBgClass="bg-orange-50" iconTextClass="text-orange-600" />
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
                                {/* 左側：崗位人力分布與健康度表格 (佔較寬版面) */}
                                <div className="xl:col-span-3 bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                    <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <LayoutList className="text-indigo-500" size={20} />
                                            <h3 className="text-lg font-bold text-slate-800">崗位人力分布與健康度</h3>
                                        </div>
                                    </div>
                                    <div className="overflow-x-auto flex-1">
                                        <table className="w-full text-left border-collapse min-w-[600px]">
                                            <thead>
                                                <tr>
                                                    <th className="py-3 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50">崗位</th>
                                                    <th className="py-3 px-2 font-semibold text-slate-500 text-[13px] border-b border-slate-200 bg-slate-50 text-center">第一堂</th>
                                                    <th className="py-3 px-2 font-semibold text-slate-500 text-[13px] border-b border-slate-200 bg-slate-50 text-center">第二堂</th>
                                                    <th className="py-3 px-2 font-semibold text-slate-500 text-[13px] border-b border-slate-200 bg-slate-50 text-center">皆可</th>
                                                    <th className="py-3 px-3 font-bold text-slate-700 text-sm border-b border-slate-200 bg-indigo-50/30 text-center shadow-[inset_1px_0_0_rgba(226,232,240,0.5)]">實際人數</th>
                                                    <th className="py-3 px-4 font-semibold text-slate-500 text-[13px] border-b border-slate-200 bg-slate-50 text-center">安全人數標準</th>
                                                    <th className="py-3 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50 text-center">狀態</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {insights.positionDistribution.map((pos, idx) => (
                                                    <tr key={pos.id} className={`${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'} hover:bg-slate-50 transition-colors`}>
                                                        <td className="py-3.5 px-4 font-bold text-slate-700 border-b border-slate-100">{pos.name}</td>
                                                        <td className="py-3.5 px-2 text-center font-medium text-slate-500 border-b border-slate-100">{pos.session1}</td>
                                                        <td className="py-3.5 px-2 text-center font-medium text-slate-500 border-b border-slate-100">{pos.session2}</td>
                                                        <td className="py-3.5 px-2 text-center font-medium text-slate-500 border-b border-slate-100">{pos.both}</td>
                                                        {/* 實際人數 (獨立高亮背景) */}
                                                        <td className={`py-3.5 px-3 text-center font-extrabold text-lg border-b border-slate-100 bg-indigo-50/20 shadow-[inset_1px_0_0_rgba(226,232,240,0.5)] ${pos.healthStatus === 'red' ? 'text-rose-600' : 'text-indigo-600'}`}>
                                                            {pos.total}
                                                        </td>
                                                        <td className="py-3.5 px-4 text-center border-b border-slate-100">
                                                            {pos.idealMin > 0 ? (
                                                                <div className="flex flex-col text-[11px] leading-tight text-slate-500">
                                                                    <span>理想 <strong className="text-slate-700">{pos.idealMin}-{pos.idealMax}</strong> 人</span>
                                                                    <span className="text-slate-400">(最低警戒: {pos.minRequired})</span>
                                                                </div>
                                                            ) : <span className="text-slate-300">-</span>}
                                                        </td>
                                                        <td className="py-3.5 px-4 text-center border-b border-slate-100">
                                                            {renderHealthBadge(pos.healthStatus)}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* 右側：崗位兼任分析長條圖 (佔較窄版面) */}
                                <div className="xl:col-span-2 bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                    <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                                        <UserCheck className="text-violet-500" size={20} />
                                        <h3 className="text-lg font-bold text-slate-800">崗位兼任現況</h3>
                                    </div>
                                    <div className="p-6 flex-1 flex flex-col justify-center min-h-[300px]">
                                        <div className="flex items-end gap-3 sm:gap-6 h-64 border-b border-slate-200 pb-2 relative px-2">
                                            {/* 背景網格線 */}
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
                    )}
                </div>
            </div>
        </div>
    );
};

window.TeamInsights = TeamInsights;
