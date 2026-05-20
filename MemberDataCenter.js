import React, { useState, useEffect } from 'react';
import { 
    Users, Copy, Trash2, CalendarX, Search, X, Edit2, ShieldCheck, 
    Check, Save, CheckCircle2, AlertCircle, UserPlus, User, ChevronLeft,
    Home, LogOut, Calendar 
} from 'lucide-react';

const MemberDataCenter = ({ session, goBack, goToSchedule, supabase, utils, constants }) => {
    const { fetchAllData, extractAccountFromEmail, generateBaseQuarters, getNextQuarter, getCurrentQuarter, getSundaysInQuarter, getHolidayName } = utils;
    const { ADMIN_ACCOUNT, DEFAULT_MEMBER, SESSION_OPTIONS, STATUS_OPTIONS } = constants;

    const FINAL_STATUS_OPTIONS = [...new Set([
        ...(STATUS_OPTIONS || []), 
        '穩定服事', 
        '暫停服事', 
        '安息季', 
        '一季一次', 
        '一季三次'
    ])];

    const currentUserEmail = session.user.email;
    const currentUserAccount = extractAccountFromEmail(currentUserEmail);
    const isAdmin = currentUserAccount === ADMIN_ACCOUNT || currentUserEmail === ADMIN_ACCOUNT;

    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentDate = now.getDate();
    const isSubmissionOpen = [3, 6, 9, 12].includes(currentMonth) && currentDate >= 1 && currentDate <= 20;

    let deadlineMonth = currentMonth;
    if (![3, 6, 9, 12].includes(currentMonth)) {
        if (currentMonth < 3) deadlineMonth = 12;
        else if (currentMonth < 6) deadlineMonth = 3;
        else if (currentMonth < 9) deadlineMonth = 6;
        else if (currentMonth < 12) deadlineMonth = 9;
    }

    const [quarterOptions, setQuarterOptions] = useState(generateBaseQuarters());
    const initialQuarter = isAdmin ? getCurrentQuarter() : getNextQuarter(getCurrentQuarter());
    const [viewQuarter, setViewQuarter] = useState(initialQuarter); 
    
    const [members, setMembers] = useState([]);
    const [positions, setPositions] = useState([]);
    const [memberPositions, setMemberPositions] = useState([]);
    const [quarterSettings, setQuarterSettings] = useState([]);
    
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [message, setMessage] = useState({ type: '', text: '' });
    const [confirmAction, setConfirmAction] = useState(null);

    const [isDeleteQuarterModalOpen, setIsDeleteQuarterModalOpen] = useState(false);
    const [detectedQuarters, setDetectedQuarters] = useState([]);
    const [quartersToDelete, setQuartersToDelete] = useState([]);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isHolidayManagerOpen, setIsHolidayManagerOpen] = useState(false); 
    const [customHolidays, setCustomHolidays] = useState({});
    const [newHolidayDate, setNewHolidayDate] = useState('');
    const [newHolidayName, setNewHolidayName] = useState('');

    const [editingMember, setEditingMember] = useState(null); 
    const [formData, setFormData] = useState({ ...DEFAULT_MEMBER });
    const [formPositions, setFormPositions] = useState({}); 

    const loadData = async () => {
        setIsLoading(true);
        try {
            const { data: allSettingsQs } = await fetchAllData(() => supabase.from('member_quarter_settings').select('quarter'));
            const [
                { data: mData }, { data: pData }, { data: mpData }, { data: qsData }, { data: sysSettingsData } 
            ] = await Promise.all([
                fetchAllData(() => supabase.from('members').select('*').order('name')),
                fetchAllData(() => supabase.from('positions').select('*').order('id')),
                fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', viewQuarter)),
                fetchAllData(() => supabase.from('member_quarter_settings').select('*').eq('quarter', viewQuarter)),
                fetchAllData(() => supabase.from('member_quarter_settings').select('*').eq('quarter', 'SYSTEM'))
            ]);

            setMembers(mData || []);
            setPositions(pData || []);
            setMemberPositions(mpData || []);
            setQuarterSettings(qsData || []);

            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            let parsedHolidays = {};
            let needsUpdate = false;

            if (sysSettingsData && sysSettingsData.length > 0) {
                const datesArr = sysSettingsData[0].unavailable_dates;
                if (Array.isArray(datesArr)) {
                    datesArr.forEach(item => {
                        const [d, n] = item.split('|');
                        if (d && n) {
                            if (d >= todayStr) { parsedHolidays[d] = n; } else { needsUpdate = true; }
                        }
                    });
                }
                if (needsUpdate) {
                    const sysMemId = sysSettingsData[0].member_id;
                    const updatedArr = Object.entries(parsedHolidays).map(([d, n]) => `${d}|${n}`);
                    supabase.from('member_quarter_settings').upsert({ member_id: sysMemId, quarter: 'SYSTEM', unavailable_dates: updatedArr }, { onConflict: 'member_id, quarter' }).then();
                }
            }
            setCustomHolidays(parsedHolidays);

            if (allSettingsQs) {
                const dbQuarters = allSettingsQs.map(d => d.quarter).filter(q => q !== 'SYSTEM');
                const combinedQs = [...new Set([...generateBaseQuarters(), ...dbQuarters, viewQuarter])].sort();
                setQuarterOptions(combinedQs);
            }
        } catch (err) { showMessage('error', '載入資料失敗，請確認連線。'); } finally { setIsLoading(false); }
    };

    useEffect(() => { loadData(); }, [viewQuarter]);

    const showMessage = (type, text) => { setMessage({ type, text }); setTimeout(() => setMessage({ type: '', text: '' }), 4000); };

    const triggerCreateNextQuarter = () => {
        const targetQ = getNextQuarter(viewQuarter);
        setConfirmAction({
            title: '建立同工資料', message: `完整複製【${viewQuarter.replace('-', '')}】同工資料至【${targetQ.replace('-', '')}】`, confirmText: '複製',
            onConfirm: () => executeCreateNextQuarter(viewQuarter, targetQ)
        });
    };

    const executeCreateNextQuarter = async (sourceQ, targetQ) => {
        setConfirmAction(null); setIsLoading(true);
        try {
            const { data: oldSettings, error: err1 } = await fetchAllData(() => supabase.from('member_quarter_settings').select('*').eq('quarter', sourceQ));
            const { data: oldPos, error: err2 } = await fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', sourceQ));
            if (err1) throw err1; if (err2) throw err2;
            if ((!oldSettings || oldSettings.length === 0) && (!oldPos || oldPos.length === 0)) throw new Error(`【${sourceQ}】目前沒有任何資料可供複製！`);

            const uniqueSettingsMap = new Map();
            if (oldSettings) oldSettings.forEach(s => uniqueSettingsMap.set(s.member_id, s));
            const filteredOldSettings = Array.from(uniqueSettingsMap.values());

            const uniquePosMap = new Map();
            if (oldPos) oldPos.forEach(p => uniquePosMap.set(`${p.member_id}_${p.position_id}`, p));
            const filteredOldPos = Array.from(uniquePosMap.values());

            await supabase.from('member_quarter_settings').delete().eq('quarter', targetQ);
            await supabase.from('member_positions').delete().eq('quarter', targetQ);
            
            if (filteredOldSettings.length > 0) {
                const newSettings = filteredOldSettings.map(s => ({
                    member_id: s.member_id, preferred_session: s.preferred_session,
                    availability_status: s.availability_status === '安息季' ? '穩定服事' : s.availability_status,
                    dual_service_pref: s.dual_service_pref, newcomer_rule: s.newcomer_rule,
                    unavailable_dates: [], quarter: targetQ
                }));
                const { error: insErr1 } = await supabase.from('member_quarter_settings').upsert(newSettings, { onConflict: 'member_id, quarter' });
                if (insErr1) throw new Error("寫入設定失敗: " + insErr1.message);
            }

            if (filteredOldPos.length > 0) {
                const newPos = filteredOldPos.map(p => ({
                    member_id: p.member_id, position_id: p.position_id, is_active: p.is_active, quarter: targetQ
                }));
                const { error: insErr2 } = await supabase.from('member_positions').upsert(newPos, { onConflict: 'member_id, position_id, quarter' });
                if (insErr2) throw new Error("寫入資格失敗: " + insErr2.message);
            }
            showMessage('success', `${targetQ.replace('-', '')}資料建立成功`);
            setViewQuarter(targetQ);
        } catch (err) { showMessage('error', '建立失敗: ' + err.message); } finally { setIsLoading(false); }
    };

    const openDeleteQuarterModal = async () => {
        setIsLoading(true);
        try {
            const { data: allSettingsQs } = await fetchAllData(() => supabase.from('member_quarter_settings').select('quarter'));
            const { data: allPosQs } = await fetchAllData(() => supabase.from('member_positions').select('quarter'));
            const combined = [...(allSettingsQs || []), ...(allPosQs || [])].map(d => d.quarter);
            const currentQ = getCurrentQuarter(); 
            const uniqueQs = [...new Set(combined)].filter(q => q !== 'SYSTEM' && q !== currentQ).sort().reverse();
            setDetectedQuarters(uniqueQs); setQuartersToDelete([]); setIsDeleteQuarterModalOpen(true);
        } catch (err) { showMessage('error', '無法載入現有季度清單'); } finally { setIsLoading(false); }
    };

    const executeDeleteQuarter = async () => {
        if (quartersToDelete.length === 0) return;
        setIsLoading(true);
        try {
            const { data: delSettings, error: err1 } = await supabase.from('member_quarter_settings').delete().in('quarter', quartersToDelete).select();
            const { data: delPos, error: err2 } = await supabase.from('member_positions').delete().in('quarter', quartersToDelete).select();
            if (err1) throw err1; if (err2) throw err2;
            if ((!delSettings || delSettings.length === 0) && (!delPos || delPos.length === 0)) throw new Error("未能刪除資料！請確認權限。");
            
            const deletedNames = quartersToDelete.map(q => q.replace('-', '')).join('、');
            showMessage('success', `${deletedNames}資料刪除成功`);
            setIsDeleteQuarterModalOpen(false);
            loadData(); 
        } catch (err) { showMessage('error', '刪除失敗: ' + err.message); } finally { setIsLoading(false); }
    };

    const openAddModal = () => { setEditingMember(null); setFormData({ ...DEFAULT_MEMBER }); setFormPositions({}); setIsModalOpen(true); };

    const handleAddCustomHoliday = async () => {
        if (!newHolidayDate || !newHolidayName.trim()) return showMessage('error', '選擇日期，填寫節日提醒內容');
        const todayStr = new Date().toISOString().split('T')[0];
        if (newHolidayDate < todayStr) return showMessage('error', '日期逾期，無法新增');

        setIsLoading(true);
        try {
            const updatedHolidays = { ...customHolidays, [newHolidayDate]: newHolidayName.trim() };
            const holidaysArr = Object.entries(updatedHolidays).map(([d, n]) => `${d}|${n}`);
            const sysMem = members.find(m => m.name === 'SYSTEM_CUSTOM_HOLIDAYS_DB');
            if (sysMem) {
                const { error } = await supabase.from('member_quarter_settings').upsert({ member_id: sysMem.id, quarter: 'SYSTEM', unavailable_dates: holidaysArr }, { onConflict: 'member_id, quarter' });
                if (error) throw error;
            } else {
                const { data: newMem, error: insErr } = await supabase.from('members').insert({ name: 'SYSTEM_CUSTOM_HOLIDAYS_DB' }).select();
                if (insErr) throw insErr;
                await supabase.from('member_quarter_settings').insert({ member_id: newMem[0].id, quarter: 'SYSTEM', unavailable_dates: holidaysArr });
            }
            setCustomHolidays(updatedHolidays); setNewHolidayDate(''); setNewHolidayName(''); loadData();
            showMessage('success', '自訂節日新增成功');
        } catch (error) { showMessage('error', '儲存失敗: ' + error.message); } finally { setIsLoading(false); }
    };

    const handleDeleteCustomHoliday = async (dateToDelete) => {
        setIsLoading(true);
        try {
            const updatedHolidays = { ...customHolidays };
            delete updatedHolidays[dateToDelete];
            const holidaysArr = Object.entries(updatedHolidays).map(([d, n]) => `${d}|${n}`);
            const sysMem = members.find(m => m.name === 'SYSTEM_CUSTOM_HOLIDAYS_DB');
            if (sysMem) {
                const { error } = await supabase.from('member_quarter_settings').upsert({ member_id: sysMem.id, quarter: 'SYSTEM', unavailable_dates: holidaysArr }, { onConflict: 'member_id, quarter' });
                if (error) throw error;
            }
            setCustomHolidays(updatedHolidays); loadData();
        } catch (error) { showMessage('error', '刪除失敗: ' + error.message); } finally { setIsLoading(false); }
    };

    const openEditModal = (member) => {
        const settings = quarterSettings.find(s => s.member_id === member.id) || DEFAULT_MEMBER;
        let safeDates = [];
        if (Array.isArray(settings.unavailable_dates)) safeDates = settings.unavailable_dates;
        else if (typeof settings.unavailable_dates === 'string') {
            try { const parsed = JSON.parse(settings.unavailable_dates); safeDates = Array.isArray(parsed) ? parsed : [settings.unavailable_dates]; }
            catch(err) { safeDates = settings.unavailable_dates ? [settings.unavailable_dates] : []; }
        }
        setEditingMember(member);
        setFormData({ 
            ...member, email: member.email || '', preferred_session: settings.preferred_session,
            availability_status: settings.availability_status, dual_service_pref: settings.dual_service_pref || 0,
            unavailable_dates: safeDates, newcomer_rule: settings.newcomer_rule === null ? '' : settings.newcomer_rule
        });
        const posMap = {};
        memberPositions.filter(mp => mp.member_id === member.id).forEach(mp => { posMap[mp.position_id] = mp.is_active !== false ? 'active' : 'inactive'; });
        setFormPositions(posMap); setIsModalOpen(true);
    };

    const closeModal = () => { setIsModalOpen(false); setEditingMember(null); setFormData({ ...DEFAULT_MEMBER }); };

    const togglePosition = (posId) => {
        if (!isAdmin) return showMessage('error', '崗位變更請洽行政辦公室');
        setFormPositions(prev => {
            const currentStatus = prev[posId];
            if (!currentStatus) return { ...prev, [posId]: 'active' };
            if (currentStatus === 'active') return { ...prev, [posId]: 'inactive' };
            const newState = { ...prev }; delete newState[posId]; return newState;
        });
    };

    const handleSave = async () => {
        if (!formData.name || !formData.name.trim()) return showMessage('error', '姓名不可為空！');
        setIsLoading(true);
        try {
            let memberId = editingMember ? editingMember.id : null;
            const cleanedGroupId = (formData.group_id || '').trim().toUpperCase();
            const finalGroupId = cleanedGroupId === '' ? null : cleanedGroupId;
            const parsedNewcomerRule = formData.newcomer_rule === '' ? null : parseInt(formData.newcomer_rule);

            const memberPayload = { name: formData.name.trim() };
            if (isAdmin) { memberPayload.group_id = finalGroupId; memberPayload.email = formData.email ? formData.email.trim() : null; }

            if (memberId) await supabase.from('members').update(memberPayload).eq('id', memberId);
            else {
                if (!isAdmin) throw new Error("只有管理員可以新增同工");
                const { data, error } = await supabase.from('members').insert(memberPayload).select();
                if (error) throw error; memberId = data[0].id;
            }

            await supabase.from('member_quarter_settings').upsert({
                member_id: memberId, quarter: viewQuarter, preferred_session: formData.preferred_session,
                availability_status: formData.availability_status, dual_service_pref: parseInt(formData.dual_service_pref),
                newcomer_rule: parsedNewcomerRule, unavailable_dates: formData.unavailable_dates
            }, { onConflict: 'member_id, quarter' });

            if (isAdmin && memberId) {
                await supabase.from('member_positions').delete().eq('member_id', memberId).eq('quarter', viewQuarter);
                const posKeys = Object.keys(formPositions);
                if (posKeys.length > 0) {
                    const insertPosPayload = posKeys.map(pid => ({ 
                        member_id: memberId, position_id: pid, quarter: viewQuarter, is_active: formPositions[pid] === 'active'
                    }));
                    await supabase.from('member_positions').insert(insertPosPayload);
                }
            }
            showMessage('success', editingMember ? '更新成功！' : '新增成功！'); closeModal(); loadData();
        } catch (err) { showMessage('error', `儲存失敗：${err.message}`); } finally { setIsLoading(false); }
    };

    const handleDelete = async (id, name) => {
        if (!isAdmin) return;
        setConfirmAction({
            title: '警告', message: `永久刪除「${name}」無法恢復，確認刪除？`, confirmText: '刪除',
            onConfirm: async () => {
                setConfirmAction(null); setIsLoading(true);
                try {
                    const { data, error } = await supabase.from('members').delete().eq('id', id).select();
                    if (error) throw error; if (!data || data.length === 0) throw new Error("無權限刪除！");
                    showMessage('success', '已刪除同工資料。'); loadData();
                } catch (err) { showMessage('error', '刪除失敗: ' + err.message); } finally { setIsLoading(false); }
            }
        });
    };

    let displayMembers = members.filter(m => {
        if (m.name === 'SYSTEM_CUSTOM_HOLIDAYS_DB' || m.name === 'SYSTEM_SCHEDULE_ARCHIVE') return false;
        if (!isAdmin && m.email !== currentUserAccount && m.email !== currentUserEmail) return false;
        const term = searchTerm.toLowerCase();
        if (m.name.toLowerCase().includes(term)) return true;
        if (m.group_id && m.group_id.toLowerCase().includes(term)) return true;
        const hasMatchingPosition = memberPositions.filter(mp => mp.member_id === m.id).some(mp => {
            const p = positions.find(pos => pos.id === mp.position_id);
            return p && p.name.toLowerCase().includes(term);
        });
        if (hasMatchingPosition) return true;
        const settings = quarterSettings.find(s => s.member_id === m.id);
        if (settings && settings.preferred_session && settings.preferred_session.toLowerCase().includes(term)) return true;
        if (settings && settings.availability_status && settings.availability_status.toLowerCase().includes(term)) return true;
        
        // 增強搜尋：輸入「暫停」時同時過濾出有被設定「暫停」崗位的同工
        if (term.includes('暫停')) {
            const hasSuspendedPosition = memberPositions.filter(mp => mp.member_id === m.id).some(mp => mp.is_active === false);
            if (hasSuspendedPosition) return true;
        }
        return false;
    });

    displayMembers.sort((a, b) => {
        const groupA = a.group_id || 'ZZZ_NO_GROUP'; const groupB = b.group_id || 'ZZZ_NO_GROUP';
        if (groupA !== groupB) return groupA.localeCompare(groupB);
        const setA = quarterSettings.find(s => s.member_id === a.id) || {};
        const setB = quarterSettings.find(s => s.member_id === b.id) || {};
        const isTopA = (setA.newcomer_rule === 1 || setA.newcomer_rule === 3) ? -1 : 1;
        const isTopB = (setB.newcomer_rule === 1 || setB.newcomer_rule === 3) ? -1 : 1;
        if (isTopA !== isTopB) return isTopA - isTopB;
        return a.name.localeCompare(b.name);
    });

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden select-none">
            {/* 左側整合式現代功能導覽列 */}
            <div className="w-64 bg-slate-900 flex flex-col justify-between shrink-0 border-r border-slate-800 z-30">
                <div className="flex flex-col">
                    {/* 系統識別標誌 */}
                    <div className="p-6 border-b border-slate-800 flex items-center gap-3">
                        <span className="text-white font-black text-base tracking-wider">TBC Serve Manager</span>
                    </div>
                    
                    {/* 功能導航項目 */}
                    <nav className="p-4 space-y-1.5">
                        <button onClick={goBack} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-bold text-sm transition-all text-left group">
                            <Home size={18} className="text-slate-400 group-hover:text-indigo-400 transition-colors" />
                            <span>Home</span>
                        </button>
                        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl font-black text-sm shadow-lg shadow-indigo-600/10">
                            <Users size={18} />
                            <span>同工資料中心</span>
                        </div>
                        <button onClick={goToSchedule} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-bold text-sm transition-all text-left group">
                            <Calendar size={18} className="text-slate-400 group-hover:text-indigo-400 transition-colors" />
                            <span>排班作業中心</span>
                        </button>
                    </nav>
                </div>
                
                {/* 底部安全登出按鈕 */}
                <div className="p-4 border-t border-slate-800">
                    <button 
                        onClick={async () => { 
                            if (supabase?.auth?.signOut) { await supabase.auth.signOut(); } 
                            window.location.reload(); 
                        }} 
                        className="w-full flex items-center gap-3 px-4 py-3 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl font-bold text-sm transition-all text-left group"
                    >
                        <LogOut size={18} className="text-rose-400 group-hover:translate-x-0.5 transition-transform" />
                        <span>Log Out</span>
                    </button>
                </div>
            </div>

            {/* 右側主工作視窗容器 */}
            <div className="flex-1 flex flex-col relative bg-slate-50 overflow-hidden animate-fade-in">
                <div className="bg-white px-6 py-4 border-b border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0 shadow-sm z-20">
                    <div className="flex items-center gap-3">
                        <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3 tracking-tight">
                            <Users className="text-indigo-500" size={28}/> 同工資料中心
                        </h2>
                    </div>
                    <div className="flex items-center gap-3 overflow-x-auto w-full md:w-auto no-scrollbar pb-1 md:pb-0">
                        {isAdmin && (
                            <div className="flex items-center bg-slate-50 rounded-lg px-2 py-1.5 border border-slate-200">
                                <select value={viewQuarter} onChange={(e) => setViewQuarter(e.target.value)} className="bg-transparent border-none font-bold text-indigo-600 text-sm outline-none cursor-pointer">
                                    {quarterOptions.map(q => <option key={q} value={q}>{q.replace('-', '')}</option>)}
                                </select>
                            </div>
                        )}
                        {!isAdmin && (
                            <div className={`whitespace-nowrap text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-1.5 ${isSubmissionOpen ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                                {isSubmissionOpen ? `🟢 ${deadlineMonth}/20日截止更新` : `🔴 已截止更新，僅供閱覽`}
                            </div>
                        )}
                        {isAdmin && (
                            <>
                                <button onClick={triggerCreateNextQuarter} className="whitespace-nowrap flex items-center gap-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 text-xs font-bold px-3 py-1.5 rounded-full transition-colors"><Copy size={14} /> 新增季度</button>
                                <button onClick={openDeleteQuarterModal} className="whitespace-nowrap flex items-center gap-1.5 bg-red-50 text-red-600 hover:bg-red-100 text-xs font-bold px-3 py-1.5 rounded-full transition-colors"><Trash2 size={14} /> 刪除季度</button>
                                <button onClick={() => setIsHolidayManagerOpen(true)} className="whitespace-nowrap flex items-center gap-1.5 bg-sky-50 text-sky-600 hover:bg-sky-100 text-xs font-bold px-3 py-1.5 rounded-full transition-colors"><CalendarX size={14} /> 節日提醒</button>
                            </>
                        )}
                    </div>
                </div>

                {isAdmin && (
                    <div className="px-6 pt-4 pb-2 bg-slate-50 z-10 shrink-0">
                        <div className="bg-white p-2 rounded-2xl shadow-sm border border-slate-200 flex items-center relative">
                            <Search className="absolute left-4 text-slate-400" size={20} />
                            <input type="text" placeholder="搜尋姓名、群組、崗位、堂別或狀態..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-10 py-2.5 bg-transparent outline-none font-bold text-slate-700 text-sm" />
                            {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-4 text-slate-400 hover:text-slate-600 transition-colors p-1"><X size={18} /></button>}
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-6 pt-2 custom-scrollbar pb-24">
                    {isLoading && members.length === 0 ? (
                        <div className="text-center py-20 text-slate-400 font-bold animate-pulse">載入資料庫中...</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                            {displayMembers.map(member => {
                                const settings = quarterSettings.find(s => s.member_id === member.id) || DEFAULT_MEMBER;
                                const ownedPosList = memberPositions.filter(mp => mp.member_id === member.id).map(mp => {
                                    const p = positions.find(pos => pos.id === mp.position_id);
                                    return p ? { name: p.name, isActive: mp.is_active !== false } : null;
                                }).filter(Boolean);

                                return (
                                    <div key={member.id} className="bg-white rounded-2xl p-4 sm:p-6 shadow-sm border border-slate-200 hover:shadow-md transition-shadow relative">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <h3 className="text-lg sm:text-xl font-black text-slate-800 flex items-center gap-2 flex-wrap leading-tight">
                                                    {member.name}
                                                    {isAdmin && settings.dual_service_pref === 1 && <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded border border-purple-100">二堂同崗</span>}
                                                    {isAdmin && settings.dual_service_pref === 2 && <span className="text-[10px] bg-purple-50 text-purple-600 px-2 py-0.5 rounded border border-purple-100">二堂異崗</span>}
                                                    {isAdmin && member.group_id && <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded border border-indigo-100">{member.group_id}</span>}
                                                </h3>
                                                <div className="flex items-center flex-wrap gap-1.5 text-xs font-bold mt-2">
                                                    <span className={`px-2 py-0.5 rounded-full ${settings.availability_status === '穩定服事' ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}`}>
                                                        {settings.availability_status}
                                                    </span>
                                                    <span className="text-slate-300">|</span>
                                                    <span className="text-slate-500">{settings.preferred_session}</span>
                                                </div>
                                            </div>
                                            <div className="flex gap-1.5">
                                                {(isAdmin || isSubmissionOpen) && <button onClick={() => openEditModal(member)} className="p-2.5 bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-xl transition-colors"><Edit2 size={16}/></button>}
                                                {isAdmin && <button onClick={() => handleDelete(member.id, member.name)} className="p-2.5 bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-xl transition-colors"><Trash2 size={16}/></button>}
                                            </div>
                                        </div>
                                        <div className="space-y-2.5">
                                            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                                                <p className="text-[10px] font-bold text-slate-400 mb-1.5 flex items-center gap-1"><ShieldCheck size={12}/> 服事崗位 ({ownedPosList.length})</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {ownedPosList.length > 0 ? ownedPosList.map(p => (
                                                        <span key={p.name} className={`text-xs font-bold px-2 py-1 rounded-lg border flex items-center gap-1 ${p.isActive ? 'bg-white border-slate-200 text-slate-600 shadow-sm' : 'bg-slate-100 border-slate-200 border-dashed text-slate-400'}`}>
                                                            {p.name} 
                                                            {isAdmin && !p.isActive && <span className="text-[10px] bg-slate-200 text-slate-500 px-1 rounded">暫停</span>}
                                                            {isAdmin && (p.name.includes('新朋友') && settings.newcomer_rule > 0) && (
                                                                <span className="text-[10px] text-indigo-500 ml-0.5">
                                                                    {settings.newcomer_rule === 1 ? "(主責)" : settings.newcomer_rule === 2 ? "(禁排)" : "(主責+禁排)"}
                                                                </span>
                                                            )}
                                                        </span>
                                                    )) : <span className="text-xs text-slate-400">尚未設定</span>}
                                                </div>
                                            </div>
                                            {(settings.unavailable_dates && settings.unavailable_dates.length > 0) && (
                                                <div className="bg-orange-50/60 p-3 rounded-xl border border-orange-100">
                                                    <p className="text-[10px] font-bold text-orange-400 mb-1.5 flex items-center gap-1"><CalendarX size={12}/> 不可排班日 ({settings.unavailable_dates.length})</p>
                                                    <div className="flex flex-wrap gap-1.5">
                                                        {settings.unavailable_dates.map(d => (
                                                            <span key={d} className="text-[11px] font-bold bg-white text-orange-600 px-2 py-0.5 rounded-md border border-orange-200 shadow-sm">{d.split('-').slice(1).join('/')}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {!isLoading && displayMembers.length === 0 && (
                        <div className="text-center py-20 px-4">
                            <div className="bg-slate-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"><Users size={24} className="text-slate-400"/></div>
                            <p className="text-slate-500 font-bold mb-2">{!isAdmin ? '尚未完成帳號設定，請洽詢行政辦公室' : '找不到符合的同工資料'}</p>
                        </div>
                    )}
                </div>

                {isAdmin && (
                    <button onClick={openAddModal} className="absolute bottom-8 right-8 z-40 bg-indigo-600 hover:bg-indigo-700 text-white w-14 h-14 rounded-full shadow-[0_8px_16px_rgba(79,70,229,0.4)] flex items-center justify-center transition-transform active:scale-90" title="新增同工">
                        <UserPlus size={24} />
                    </button>
                )}

                {isModalOpen && (
                    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm">
                        <div className="bg-white w-full h-[95vh] sm:h-auto sm:max-h-[90vh] sm:max-w-2xl rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-slide-up sm:animate-fade-in">
                            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-white shrink-0 sticky top-0 z-10">
                                <h2 className="text-lg font-black text-slate-800 flex items-center gap-2">
                                    {editingMember ? <Edit2 size={20} className="text-indigo-600"/> : <UserPlus size={20} className="text-indigo-600"/>}
                                    {editingMember ? '編輯同工資料' : '新增同工'}
                                </h2>
                                <button onClick={closeModal} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"><X size={20}/></button>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto p-5 space-y-6 pb-8">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 uppercase">姓名 <span className="text-red-500">*</span></label>
                                        <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-semibold text-slate-700" placeholder="請輸入姓名" />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 uppercase">服事意願</label>
                                        <select value={formData.availability_status} onChange={e => setFormData({...formData, availability_status: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-semibold text-slate-700">
                                            {FINAL_STATUS_OPTIONS.filter(opt => isAdmin || (opt !== '安息季' && opt !== '一季一次' && opt !== '一季三次')).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-bold text-slate-500 uppercase">堂別</label>
                                        <select value={formData.preferred_session} onChange={e => setFormData({...formData, preferred_session: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-semibold text-slate-700">
                                            {SESSION_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                        </select>
                                    </div>
                                    {isAdmin && (
                                        <>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-bold text-slate-500 uppercase">群組 ID <span className="text-slate-400 font-normal">(選填)</span></label>
                                                <input type="text" value={formData.group_id} onChange={e => setFormData({...formData, group_id: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-semibold text-slate-700 uppercase" placeholder="例如：FA" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-bold text-slate-500 uppercase">同日二堂服事 <span className="text-slate-400 font-normal">(選填)</span></label>
                                                <select value={formData.dual_service_pref} onChange={e => setFormData({...formData, dual_service_pref: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-semibold text-slate-700">
                                                    <option value="0">無</option><option value="1">二堂同崗</option><option value="2">二堂異崗</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-bold text-slate-500 uppercase">新朋友關懷設定 <span className="text-slate-400 font-normal">(選填)</span></label>
                                                <select value={formData.newcomer_rule === null ? '' : formData.newcomer_rule} onChange={e => setFormData({...formData, newcomer_rule: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-semibold text-slate-700">
                                                    <option value="">預設(正常排班)</option><option value="1">主責</option><option value="2">禁排第二週</option><option value="3">主責 ＋ 禁排第二週</option>
                                                </select>
                                            </div>
                                        </>
                                    )}
                                </div>
                                {isAdmin && (
                                    <div className="space-y-2 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                                        <label className="text-xs font-bold text-indigo-600 flex items-center gap-1.5 flex-wrap"><User size={14}/> 帳號 <span className="text-[10px] text-indigo-400 font-normal">(忘記密碼需變更帳號，再重新綁定)</span></label>
                                        <input type="text" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-white border border-indigo-200 rounded-xl px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 font-semibold text-slate-700" placeholder="電話號碼或電子郵件" />
                                    </div>
                                )}
                                <div className="pt-2 border-t border-slate-100">
                                    <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5 mb-3">
                                        <ShieldCheck size={18} className="text-indigo-500"/> 服事崗位 {!isAdmin && <span className="text-[10px] text-slate-400 font-normal ml-1">(僅供檢視)</span>}
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {positions.map(pos => {
                                            const status = formPositions[pos.id];
                                            if (!isAdmin && !status) return null;
                                            const isBtnActive = status === 'active';
                                            const isBtnInactive = status === 'inactive';
                                            return (
                                                <button key={pos.id} type="button" onClick={() => togglePosition(pos.id)} className={`px-4 py-2.5 sm:py-2 rounded-xl text-sm font-bold border-2 transition-all flex items-center gap-1.5 ${!isAdmin ? 'cursor-default' : 'active:scale-95'} ${isBtnActive ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : isBtnInactive ? 'bg-white border-slate-300 text-slate-500 border-dashed' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                                                    {pos.name}
                                                    {isAdmin && isBtnActive && <span className="w-2 h-2 rounded-full bg-indigo-500 ml-1"></span>}
                                                    {isAdmin && isBtnInactive && <span className="text-[10px] ml-1 opacity-60">暫停</span>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                <div className="pt-4 border-t border-slate-100">
                                    <label className="text-sm font-bold text-slate-700 flex items-center gap-1.5 mb-3">
                                        <CalendarX size={18} className="text-orange-500"/> 不可排班日 <span className="text-xs text-slate-400 font-normal ml-1">(點擊選取)</span>
                                    </label>
                                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                                        {getSundaysInQuarter(viewQuarter).map(date => {
                                            const isChecked = Array.isArray(formData.unavailable_dates) && formData.unavailable_dates.includes(date);
                                            const holidayName = getHolidayName(date, customHolidays);
                                            const shortDate = date.split('-').slice(1).join('/');
                                            return (
                                                <label key={date} className={`relative flex flex-col items-center justify-center p-3 sm:p-2 rounded-2xl border-2 transition-all cursor-pointer select-none active:scale-[0.97] ${isChecked ? 'bg-orange-50 border-orange-500 shadow-md' : 'bg-white border-slate-200 hover:border-orange-200'}`}>
                                                    <input type="checkbox" className="sr-only" checked={isChecked} onChange={(e) => {
                                                        let newDates = Array.isArray(formData.unavailable_dates) ? [...formData.unavailable_dates] : [];
                                                        if (e.target.checked) { if (!newDates.includes(date)) newDates.push(date); } else { newDates = newDates.filter(d => d !== date); }
                                                        setFormData({ ...formData, unavailable_dates: newDates.sort() });
                                                    }} />
                                                    {isChecked && <Check className="absolute top-1 right-1 text-orange-500" size={14} strokeWidth={3} />}
                                                    <span className={`text-base sm:text-sm font-black ${isChecked ? 'text-orange-600' : 'text-slate-600'}`}>{shortDate}</span>
                                                    {holidayName && <span className={`text-[10px] font-bold mt-1 text-center leading-tight ${isChecked ? 'text-orange-500' : 'text-slate-400'}`}>{holidayName}</span>}
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                            <div className="px-5 py-4 border-t border-slate-100 bg-white flex gap-3 shrink-0 pb-8 sm:pb-4 sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                                <button onClick={closeModal} className="flex-1 py-3.5 sm:py-2.5 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">取消</button>
                                <button onClick={handleSave} disabled={isLoading} className="flex-[2] py-3.5 sm:py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold flex items-center justify-center gap-2 shadow-md transition-all active:scale-95 disabled:opacity-50">
                                    <Save size={18}/> {isLoading ? '儲存中...' : '儲存設定'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {isHolidayManagerOpen && isAdmin && (
                    <div className="fixed inset-0 z-50 flex flex-col justify-end sm:justify-center sm:p-4 bg-slate-900/60 backdrop-blur-sm">
                        <div className="bg-white w-full h-[90vh] sm:h-auto sm:max-h-[90vh] sm:max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-slide-up sm:animate-fade-in">
                            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-white shrink-0 sticky top-0">
                                <h3 className="text-lg font-black text-slate-800 flex items-center gap-2"><CalendarX className="text-sky-500" size={20} /> 自訂節日提醒</h3>
                                <button onClick={() => setIsHolidayManagerOpen(false)} className="p-2 bg-slate-100 rounded-full text-slate-500"><X size={20}/></button>
                            </div>
                            <div className="p-5 overflow-y-auto space-y-6 flex-1">
                                <div className="bg-sky-50 p-4 rounded-2xl border border-sky-100 text-sm font-bold text-sky-700 leading-relaxed">
                                    系統內建至 2030 年的節日。手動新增節日提醒，編輯同工資料時會自動標示！
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-bold text-slate-500 uppercase">新增節日提醒</label>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <input type="date" value={newHolidayDate} onChange={e => {
                                            const val = e.target.value; if (val && new Date(val).getDay() !== 0) { showMessage('error', '只能選週日'); setNewHolidayDate(''); return; }
                                            setNewHolidayDate(val);
                                        }} className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-sky-500 focus:ring-2 w-full sm:w-auto font-bold text-slate-700" />
                                        <input type="text" placeholder="輸入節日提醒" value={newHolidayName} onChange={e => setNewHolidayName(e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 outline-none focus:border-sky-500 focus:ring-2 font-bold text-slate-700 w-full" />
                                        <button onClick={handleAddCustomHoliday} disabled={isLoading} className="bg-sky-500 hover:bg-sky-600 text-white font-bold px-4 py-3 rounded-xl active:scale-95 w-full sm:w-auto">新增</button>
                                    </div>
                                </div>
                                <div className="space-y-3 pb-8">
                                    <label className="text-xs font-bold text-slate-500 uppercase flex items-center gap-2">自訂節日提醒清單 <span className="bg-slate-200 text-slate-500 px-2 rounded-full text-[10px]">{Object.keys(customHolidays).length}</span></label>
                                    {Object.keys(customHolidays).length === 0 ? (
                                        <div className="text-center py-8 text-slate-400 font-bold bg-slate-50 rounded-2xl border border-dashed border-slate-200">尚無自訂提醒</div>
                                    ) : (
                                        <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                                            {Object.entries(customHolidays).sort(([a], [b]) => a.localeCompare(b)).map(([date, name]) => (
                                                <div key={date} className="flex justify-between items-center bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
                                                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                                                        <span className="text-sky-600 font-black text-sm">{date}</span>
                                                        <span className="font-bold text-slate-700 text-sm">{name}</span>
                                                    </div>
                                                    <button onClick={() => handleDeleteCustomHoliday(date)} className="p-3 bg-red-50 text-red-500 rounded-lg active:scale-95"><Trash2 size={18}/></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {message.text && (
                    <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[80] px-5 py-3 rounded-2xl font-bold shadow-xl animate-fade-in flex items-start gap-2 max-w-[90vw] w-max ${message.type === 'success' ? 'bg-slate-800 text-emerald-400' : 'bg-red-600 text-white'}`}>
                        <div className="shrink-0 mt-0.5">{message.type === 'success' ? <CheckCircle2 size={18}/> : <AlertCircle size={18}/>}</div>
                        <div className="text-sm leading-snug break-words flex-1">{message.text}</div>
                    </div>
                )}
                
                {(confirmAction || isDeleteQuarterModalOpen) && (
                    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
                        <div className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl flex flex-col overflow-hidden animate-fade-in">
                            <div className="p-8 text-center">
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${confirmAction?.title === '警告' || isDeleteQuarterModalOpen ? 'bg-red-100 text-red-500' : 'bg-amber-100 text-amber-500'}`}>
                                    {isDeleteQuarterModalOpen ? <Trash2 size={32}/> : <AlertCircle size={32}/>}
                                </div>
                                <h3 className="text-xl font-black text-slate-800 mb-3">{isDeleteQuarterModalOpen ? '刪除同工資料' : confirmAction?.title}</h3>
                                {isDeleteQuarterModalOpen ? (
                                    <>
                                        <p className="text-sm font-bold text-slate-500 mb-4"><span className="text-red-500">同步刪除同工與排班資料，無法復原！</span></p>
                                        {detectedQuarters.length === 0 ? (
                                            <div className="py-6 text-slate-400 font-bold bg-slate-50 rounded-xl border border-dashed border-slate-200">尚無可刪除的季度資料</div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2.5 max-h-[40vh] overflow-y-auto p-1 custom-scrollbar">
                                                {detectedQuarters.map(q => {
                                                    const isSelected = quartersToDelete.includes(q);
                                                    return (
                                                        <label key={q} className={`relative flex items-center justify-center p-3 rounded-2xl border-2 transition-all cursor-pointer select-none active:scale-[0.97] ${isSelected ? 'bg-red-50 border-red-500 shadow-md' : 'bg-white border-slate-200 hover:border-red-200'}`}>
                                                            <input type="checkbox" className="sr-only" value={q} checked={isSelected} onChange={(e) => {
                                                                if (e.target.checked) setQuartersToDelete([...quartersToDelete, q]);
                                                                else setQuartersToDelete(quartersToDelete.filter(item => item !== q));
                                                            }} />
                                                            {isSelected && <Check className="absolute top-1 right-1 text-red-500" size={14} strokeWidth={3} />}
                                                            <span className={`text-sm font-black ${isSelected ? 'text-red-600' : 'text-slate-600'}`}>{q.replace('-', '')}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-sm font-bold text-slate-500 whitespace-pre-line">{confirmAction?.message}</p>
                                )}
                            </div>
                            <div className="p-3 bg-slate-50 flex gap-2 border-t border-slate-100">
                                <button onClick={() => {setConfirmAction(null); setIsDeleteQuarterModalOpen(false);}} className="flex-1 py-3.5 font-black text-slate-600 bg-slate-200 rounded-xl">取消</button>
                                <button onClick={executeDeleteQuarter} disabled={isDeleteQuarterModalOpen && quartersToDelete.length === 0} className={`flex-1 py-3.5 font-black text-white rounded-xl transition-all ${isDeleteQuarterModalOpen || confirmAction?.title === '警告' ? 'bg-red-500 hover:bg-red-600 disabled:bg-red-300' : 'bg-amber-500 hover:bg-amber-600'} disabled:opacity-50 disabled:cursor-not-allowed`}>
                                    {isDeleteQuarterModalOpen ? '刪除' : (confirmAction?.confirmText || '確定')}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

window.MemberDataCenter = MemberDataCenter;
