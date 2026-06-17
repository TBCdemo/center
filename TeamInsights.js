import React, { useState, useEffect, useMemo } from 'react';
import { 
    Home, Users, Calendar, LogOut, BarChart3, ChevronLeft, 
    UserCheck, UserMinus, LayoutList, CheckCircle2 
} from 'lucide-react';

const TeamInsights = ({ session, goBack, goToMembers, goToSchedule, supabase, utils, StatCard }) => {
    const { fetchAllData } = utils;
    
    const [isLoading, setIsLoading] = useState(true);
    const [dbData, setDbData] = useState({ members: [], positions: [], memberPositions: [], quarterSettings: [] });

    useEffect(() => {
        const loadBaseData = async () => {
            setIsLoading(true);
            try {
                // 專注抓取基礎版 (BASE) 數據
                const [
                    { data: mData }, 
                    { data: pData }, 
                    { data: mpData }, 
                    { data: qsData }
                ] = await Promise.all([
                    fetchAllData(() => supabase.from('members').select('*').order('name')),
                    fetchAllData(() => supabase.from('positions').select('*').order('id')),
                    fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', 'BASE')),
                    fetchAllData(() => supabase.from('member_quarter_settings').select('*').eq('quarter', 'BASE'))
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
        loadBaseData();
    }, []);

    const insights = useMemo(() => {
        const { members, positions, memberPositions, quarterSettings } = dbData;
        
        // 1. 過濾有效同工 (排除系統帳號)
        const realMembers = members.filter(m => !m.name.startsWith('SYSTEM_'));
        const totalMembersCount = realMembers.length;

        // 建立 settings mapping 以加速查找
        const qsMap = {};
        quarterSettings.forEach(qs => qsMap[qs.member_id] = qs);

        // 2. 計算狀態人數
        let suspendedCount = 0;
        let activeCount = 0;

        const activeMemberIds = new Set();

        realMembers.forEach(m => {
            const status = qsMap[m.id]?.availability_status || '穩定服事';
            if (['暫停服事', '安息季'].includes(status)) {
                suspendedCount++;
            } else {
                activeCount++;
                activeMemberIds.add(m.id);
            }
        });

        // 3. 崗位人力分布
        const positionDistribution = positions.map(pos => {
            let session1 = 0;
            let session2 = 0;
            let both = 0;

            realMembers.forEach(m => {
                if (!activeMemberIds.has(m.id)) return; // 僅計算上線服事的同工

                const hasPos = memberPositions.some(mp => mp.member_id === m.id && mp.position_id === pos.id && mp.is_active !== false);
                if (hasPos) {
                    const pref = qsMap[m.id]?.preferred_session || '第一堂';
                    if (pref === '第一堂') session1++;
                    else if (pref === '第二堂') session2++;
                    else both++;
                }
            });

            return {
                id: pos.id,
                name: pos.name,
                session1,
                session2,
                both,
                total: session1 + session2 + both
            };
        });

        // 4. 崗位兼任分析 (X軸=崗位數，Y軸=人數)
        const concurrencyMap = {};
        realMembers.forEach(m => {
            if (!activeMemberIds.has(m.id)) return;

            const posCount = memberPositions.filter(mp => mp.member_id === m.id && mp.is_active !== false).length;
            concurrencyMap[posCount] = (concurrencyMap[posCount] || 0) + 1;
        });

        const concurrencyData = Object.keys(concurrencyMap)
            .map(Number)
            .sort((a, b) => a - b)
            .map(count => ({
                roles: count,
                people: concurrencyMap[count]
            }));
            
        const maxConcurrencyPeople = Math.max(0, ...concurrencyData.map(d => d.people));

        return {
            totalMembersCount,
            suspendedCount,
            activeCount,
            positionDistribution,
            concurrencyData,
            maxConcurrencyPeople
        };

    }, [dbData]);

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden relative">
            {/* 左側導覽列 */}
            <div className="hidden md:flex inset-y-0 left-0 w-64 bg-slate-900 flex-col justify-between shrink-0 border-r border-slate-800 z-30 h-full">
                <div className="flex flex-col">
                    <div className="p-6 border-b border-slate-800 flex items-center justify-between gap-3">
                        <span className="text-white font-bold text-base tracking-wider">TBC Serve Manager</span>
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
                        <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-sky-500 to-blue-600 shadow-button text-white rounded-xl font-medium text-sm">
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
                <div className="bg-white px-6 py-4 border-b border-slate-100 flex items-center gap-3 shrink-0 shadow-sm z-20">
                    <button onClick={goBack} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-500 transition-colors hidden md:block" title="返回首頁">
                        <ChevronLeft size={24} />
                    </button>
                    <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 flex items-center gap-2 tracking-tight">
                        <BarChart3 className="text-sky-500" size={28}/> 
                        人力洞察中心 <span className="text-sm text-slate-400 font-medium ml-2">基於 BASE (基礎版) 分析</span>
                    </h2>
                </div>

                <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar">
                    {isLoading ? (
                        <div className="h-full flex items-center justify-center text-slate-400 font-medium animate-pulse">計算數據中...</div>
                    ) : (
                        <div className="max-w-6xl mx-auto space-y-6">
                            {/* 三大指標卡片 */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <StatCard icon={Users} title="同工總人數" value={insights.totalMembersCount} unit="人" iconBgClass="bg-slate-100" iconTextClass="text-slate-600" />
                                <StatCard icon={CheckCircle2} title="上線服事人數" value={insights.activeCount} unit="人" iconBgClass="bg-emerald-50" iconTextClass="text-emerald-600" />
                                <StatCard icon={UserMinus} title="暫停 / 安息人數" value={insights.suspendedCount} unit="人" iconBgClass="bg-orange-50" iconTextClass="text-orange-600" />
                            </div>

                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                                {/* 左側：崗位人力分布表格 */}
                                <div className="bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                    <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                                        <LayoutList className="text-indigo-500" size={20} />
                                        <h3 className="text-lg font-bold text-slate-800">崗位人力分布現況</h3>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr>
                                                    <th className="py-3 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50">崗位</th>
                                                    <th className="py-3 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50 text-center">第一堂</th>
                                                    <th className="py-3 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50 text-center">第二堂</th>
                                                    <th className="py-3 px-4 font-semibold text-slate-500 text-sm border-b border-slate-200 bg-slate-50 text-center">皆可</th>
                                                    <th className="py-3 px-4 font-bold text-slate-700 text-sm border-b border-slate-200 bg-slate-100 text-center">小計</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {insights.positionDistribution.map((pos, idx) => (
                                                    <tr key={pos.id} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}>
                                                        <td className="py-3 px-4 font-bold text-slate-700 border-b border-slate-100">{pos.name}</td>
                                                        <td className="py-3 px-4 text-center font-medium text-slate-600 border-b border-slate-100">{pos.session1}</td>
                                                        <td className="py-3 px-4 text-center font-medium text-slate-600 border-b border-slate-100">{pos.session2}</td>
                                                        <td className="py-3 px-4 text-center font-medium text-slate-600 border-b border-slate-100">{pos.both}</td>
                                                        <td className="py-3 px-4 text-center font-bold text-indigo-600 bg-indigo-50/30 border-b border-slate-100">{pos.total}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                {/* 右側：崗位兼任分析長條圖 */}
                                <div className="bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden flex flex-col">
                                    <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-center gap-2">
                                        <UserCheck className="text-sky-500" size={20} />
                                        <h3 className="text-lg font-bold text-slate-800">崗位兼任分析 <span className="text-sm text-slate-400 font-normal ml-1">(上線同工)</span></h3>
                                    </div>
                                    <div className="p-6 flex-1 flex flex-col justify-center min-h-[300px]">
                                        <div className="flex items-end gap-4 h-64 border-b border-slate-200 pb-2 relative">
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
                                                    <div key={idx} className="flex-1 flex flex-col items-center gap-2 group relative z-10">
                                                        {/* 柱狀圖上方的數字 */}
                                                        <span className="text-sm font-bold text-slate-600 transition-transform group-hover:-translate-y-1">{data.people} 人</span>
                                                        {/* 柱狀體 */}
                                                        <div 
                                                            className="w-full max-w-[60px] bg-sky-500 rounded-t-md transition-all duration-500 hover:bg-sky-400 shadow-sm"
                                                            style={{ height: `${heightPct}%`, minHeight: data.people > 0 ? '4px' : '0' }}
                                                        ></div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        {/* X 軸標籤 */}
                                        <div className="flex gap-4 mt-3">
                                            {insights.concurrencyData.map((data, idx) => (
                                                <div key={idx} className="flex-1 text-center text-sm font-medium text-slate-500">
                                                    {data.roles} 個崗位
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