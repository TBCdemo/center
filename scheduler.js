import React, { useState, useEffect } from 'react';
import { 
    Calendar, Home, Users, ChevronLeft, LogOut, Cpu, Save, RefreshCw, 
    CheckCircle2, AlertCircle, AlertTriangle, Shield, Clock, Grid
} from 'lucide-react';

const ScheduleCenter = ({ session, goBack, goToMembers, supabase, utils, ScheduleEngine }) => {
    const { fetchAllData, extractAccountFromEmail, generateBaseQuarters, getCurrentQuarter } = utils;
    const { ADMIN_ACCOUNT } = { ADMIN_ACCOUNT: 'admin' }; // 可替換為系統常數

    const currentUserEmail = session.user.email;
    const currentUserAccount = extractAccountFromEmail(currentUserEmail);
    const isAdmin = currentUserAccount === ADMIN_ACCOUNT || currentUserEmail === ADMIN_ACCOUNT;

    // 季度選擇狀態
    const [selectedQuarter, setSelectedQuarter] = useState(getCurrentQuarter());
    const [quarterOptions, setQuarterOptions] = useState(generateBaseQuarters());
    
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    
    // 核心排班所需原始資料
    const [members, setMembers] = useState([]);
    const [positions, setPositions] = useState([]);
    const [memberPositions, setMemberPositions] = useState([]);
    const [quarterSettings, setQuarterSettings] = useState([]);
    
    // 生成後的暫存草稿班表與過濾
    const [scheduleDraft, setScheduleDraft] = useState([]);
    const [selectedDateFilter, setSelectedDateFilter] = useState('ALL');
    const [uniqueDates, setUniqueDates] = useState([]);

    const showMessage = (type, text) => { setMessage({ type, text }); setTimeout(() => setMessage({ type: '', text: '' }), 4000); };

    // 載入排班所需的一切原始資料
    const loadRequiredData = async () => {
        setIsLoading(true);
        try {
            const [
                { data: mData }, { data: pData }, { data: mpData }, { data: qsData }
            ] = await Promise.all([
                fetchAllData(() => supabase.from('members').select('*')),
                fetchAllData(() => supabase.from('positions').select('*')),
                fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', selectedQuarter)),
                fetchAllData(() => supabase.from('member_quarter_settings').select('*').eq('quarter', selectedQuarter))
            ]);

            setMembers(mData || []);
            setPositions(pData || []);
            setMemberPositions(mpData || []);
            setQuarterSettings(qsData || []);

            // 嘗試載入資料庫內已儲存的現成班表
            const { data: existingSchedule } = await supabase
                .from('schedules')
                .select('*')
                .eq('quarter', selectedQuarter);
            
            if (existingSchedule && existingSchedule.length > 0) {
                // 還原輔助展示名稱
                const Hydrated = existingSchedule.map(s => {
                    const mem = (mData || []).find(m => m.id === s.member_id);
                    const pos = (pData || []).find(p => p.id === s.position_id);
                    return {
                        ...s,
                        _memberName: mem ? mem.name : (s.member_id === 'EMPTY_SLOT' ? '⚠️ 需手動指派' : '未知'),
                        _positionName: pos ? pos.name : '未知崗位'
                    };
                });
                setScheduleDraft(Hydrated);
                extractUniqueDates(Hydrated);
            } else {
                setScheduleDraft([]);
                setUniqueDates([]);
            }
        } catch (err) {
            showMessage('error', '原始資料載入失敗: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isAdmin) loadRequiredData();
    }, [selectedQuarter]);

    const extractUniqueDates = (draft) => {
        const dates = [...new Set(draft.map(d => d.service_date))].sort();
        setUniqueDates(dates);
        if (dates.length > 0) setSelectedDateFilter(dates[0]);
    };

    // 核心驅動：點擊觸發自動排班
    const handleAutoSchedule = () => {
        if (members.length === 0 || positions.length === 0) {
            return showMessage('error', '缺乏基礎同工或崗位資料，無法排班！');
        }

        setIsLoading(true);
        try {
            // 解析年與季字串，例如 "2026-Q2"
            const [yearStr, qStr] = selectedQuarter.split('-Q');
            const year = parseInt(yearStr);
            const quarter = parseInt(qStr);

            // 包裝給核心引擎的封裝資料庫物件庫
            const dbData = {
                positions: positions,
                memberQuarterSettings: quarterSettings
            };

            // 呼叫排班核心引擎 (Scheduler Engine V17)
            // 引擎內部 _canAssign 會自動處理每位同工的 allow_concurrent 設定！
            const generatedDraft = ScheduleEngine.generate({
                year,
                quarter,
                effectiveMembers: members,
                effectiveMemberPositions: memberPositions,
                dbData,
                roleSettings: {} // 可擴充手動崗位人數權重
            });

            setScheduleDraft(generatedDraft);
            extractUniqueDates(generatedDraft);
            showMessage('success', '核心引擎排班成功！請檢視下方產出');
        } catch (err) {
            showMessage('error', '排班運行失敗: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // 儲存班表至 Supabase 資料庫
    const handleSaveSchedule = async () => {
        if (scheduleDraft.length === 0) return showMessage('error', '目前無任何排班表可供存檔');
        setIsLoading(true);
        try {
            // 清除當季舊班表
            await supabase.from('schedules').delete().eq('quarter', selectedQuarter);

            // 清理暫存結構，準備寫入正式 Schema
            const payload = scheduleDraft.map(d => ({
                quarter: selectedQuarter,
                service_date: d.service_date,
                session: d.session,
                member_id: d.member_id,
                position_id: d.position_id,
                is_emergency: d.is_emergency || 0,
                is_empty: d.is_empty || false
            }));

            const { error } = await supabase.from('schedules').insert(payload);
            if (error) throw error;

            showMessage('success', `【${selectedQuarter}】班表已成功發布並儲存至資料庫！`);
        } catch (err) {
            showMessage('error', '發布失敗: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    // 按日期與堂別過濾呈現
    const filteredDisplayDraft = scheduleDraft.filter(d => {
        if (selectedDateFilter !== 'ALL' && d.service_date !== selectedDateFilter) return false;
        return true;
    });

    return (
        <div className="flex h-[100dvh] w-full bg-slate-50 overflow-hidden relative">
            {/* 左側導覽列 */}
            <div className="w-64 bg-slate-900 flex flex-col justify-between shrink-0 border-r border-slate-800 z-30">
                <div className="flex flex-col">
                    <div className="p-6 border-b border-slate-800 flex items-center gap-3">
                        <span className="text-white font-bold text-base tracking-wider">TBC Serve Manager</span>
                    </div>
                    <nav className="p-4 space-y-1.5">
                        <button onClick={goBack} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-normal text-sm transition-all text-left group">
                            <Home size={18} className="text-slate-400 group-hover:text-indigo-400 transition-colors" />
                            <span>Home</span>
                        </button>
                        <button onClick={goToMembers} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-normal text-sm transition-all text-left group">
                            <Users size={18} className="text-slate-400 group-hover:text-indigo-400 transition-colors" />
                            <span>同工資料中心</span>
                        </button>
                        <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-violet-600 to-indigo-600 shadow-button text-white rounded-xl font-medium text-sm">
                            <Calendar size={18} />
                            <span>排班作業中心</span>
                        </div>
                    </nav>
                </div>
                <div className="p-4 border-t border-slate-800">
                    <button onClick={async () => { if (supabase?.auth?.signOut) { await supabase.auth.signOut(); } window.location.reload(); }} className="w-full flex items-center gap-3 px-4 py-3 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl font-normal text-sm transition-all text-left group">
                        <LogOut size={18} className="text-rose-400" />
                        <span>Sign Out</span>
                    </button>
                </div>
            </div>

            {/* 主工作區 */}
            <div className="flex-1 flex flex-col relative bg-slate-50 overflow-hidden">
                {/* 頂部控制列 */}
                <div className="bg-white px-6 py-4 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0 shadow-sm z-20">
                    <div className="flex items-center gap-3">
                        <button onClick={goBack} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-500 transition-colors">
                            <ChevronLeft size={24} />
                        </button>
                        <h2 className="text-2xl font-extrabold text-slate-900 flex items-center gap-3 tracking-tight">
                            <Calendar className="text-violet-600" size={28}/> 排班作業中心
                        </h2>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap w-full md:w-auto">
                        <div className="flex items-center bg-slate-50 rounded-lg px-2 py-1.5 border border-slate-200">
                            <select value={selectedQuarter} onChange={(e) => setSelectedQuarter(e.target.value)} className="bg-transparent border-none font-medium text-violet-600 text-sm outline-none cursor-pointer">
                                {quarterOptions.map(q => <option key={q} value={q}>{q.replace('-', '')}</option>)}
                            </select>
                        </div>

                        <button onClick={handleAutoSchedule} disabled={isLoading} className="flex items-center gap-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium px-4 py-2 rounded-lg transition-all shadow-sm disabled:opacity-50">
                            <Cpu size={14} /> 自動排班引擎
                        </button>

                        <button onClick={handleSaveSchedule} disabled={isLoading || scheduleDraft.length === 0} className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium px-4 py-2 rounded-lg transition-all shadow-sm disabled:opacity-50">
                            <Save size={14} /> 發布並儲存
                        </button>
                    </div>
                </div>

                {/* 日期切換 Tab 區塊 */}
                {uniqueDates.length > 0 && (
                    <div className="px-6 py-2 bg-white border-b border-slate-100 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
                        <Grid size={16} className="text-slate-400 shrink-0 ml-1" />
                        <button 
                            onClick={() => setSelectedDateFilter('ALL')} 
                            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${selectedDateFilter === 'ALL' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                            全部顯示
                        </button>
                        {uniqueDates.map(date => (
                            <button
                                key={date}
                                onClick={() => setSelectedDateFilter(date)}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-all whitespace-nowrap ${selectedDateFilter === date ? 'bg-violet-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                {date.split('-').slice(1).join('/')}
                            </button>
                        ))}
                    </div>
                )}

                {/* 班表主要渲染面板 */}
                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar pb-24">
                    {isLoading ? (
                        <div className="text-center py-20 text-slate-400 font-medium animate-pulse flex flex-col items-center justify-center gap-3">
                            <RefreshCw className="animate-spin text-violet-500" size={32} />
                            <span>排班中心與核心運算處理中...</span>
                        </div>
                    ) : filteredDisplayDraft.length > 0 ? (
                        <div className="space-y-8">
                            {/* 按日期分組渲染 */}
                            {[...new Set(filteredDisplayDraft.map(d => d.service_date))].sort().map(dateStr => {
                                const dayItems = filteredDisplayDraft.filter(d => d.service_date === dateStr);
                                return (
                                    <div key={dateStr} className="bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden">
                                        <div className="bg-slate-900 px-6 py-3.5 flex justify-between items-center">
                                            <span className="text-white font-bold tracking-wide flex items-center gap-2">
                                                <Calendar size={18} className="text-violet-400" /> {dateStr} 主日服事表
                                            </span>
                                        </div>

                                        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                                            {/* 第一堂與第二堂 */}
                                            {['第一堂', '第二堂'].map(sessionName => {
                                                const sessionItems = dayItems.filter(d => d.session === sessionName);
                                                return (
                                                    <div key={sessionName} className="bg-slate-50 rounded-lg p-4 border border-slate-100 space-y-3">
                                                        <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2 pb-2 border-b border-slate-200">
                                                            <Clock size={16} className="text-slate-500" /> {sessionName}
                                                        </h4>
                                                        
                                                        <div className="space-y-2">
                                                            {sessionItems.length > 0 ? sessionItems.map((item, idx) => (
                                                                <div key={idx} className={`flex justify-between items-center p-3 bg-white rounded-lg border shadow-sm transition-all ${item.is_empty ? 'border-dashed border-red-300 bg-red-50/20' : 'border-slate-200 hover:border-slate-300'}`}>
                                                                    <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-2 py-1 rounded">
                                                                        {item._positionName}
                                                                    </span>
                                                                    <div className="flex items-center gap-1.5">
                                                                        <span className={`text-sm font-bold ${item.is_empty ? 'text-red-500 font-semibold animate-pulse' : 'text-slate-800'}`}>
                                                                            {item._memberName}
                                                                        </span>
                                                                        {item.is_duplicate && (
                                                                            <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded flex items-center gap-0.5" title="此同工本日兼任多職/跨堂">
                                                                                <AlertTriangle size={10} /> 兼任
                                                                            </span>
                                                                        )}
                                                                        {item.is_lonely_family && (
                                                                            <span className="text-[10px] bg-sky-50 text-sky-600 border border-sky-200 px-1.5 py-0.5 rounded" title="家庭配對落單提醒">
                                                                                落單
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )) : (
                                                                <p className="text-xs text-slate-400 text-center py-4">無排班要求</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="text-center py-20 px-4">
                            <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                                <Calendar size={24} className="text-slate-400"/>
                            </div>
                            <p className="text-slate-500 font-normal mb-2">本季度目前沒有排班快照</p>
                            <p className="text-slate-400 text-xs max-w-sm mx-auto">請確認同工已填寫不可排班日，並點擊右上角「自動排班引擎」按鈕產出全新季度班表。</p>
                        </div>
                    )}
                </div>

                {/* 全域訊息通知 */}
                {message.text && (
                    <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[110] px-5 py-3 rounded-xl font-medium shadow-soft animate-fade-in flex items-start gap-2 max-w-[90vw] w-max ${message.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                        <div className="shrink-0 mt-0.5">
                            {message.type === 'success' ? <CheckCircle2 size={18}/> : <AlertCircle size={18}/>}
                        </div>
                        <div className="text-sm leading-snug break-words flex-1">{message.text}</div>
                    </div>
                )}
            </div>
        </div>
    );
};

window.ScheduleCenter = ScheduleCenter;
export default ScheduleCenter;
