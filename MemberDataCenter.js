import React, { useState, useEffect } from 'react';
import { 
    Users, Copy, Trash2, CalendarX, Search, X, Edit2, ShieldCheck, 
    Check, Save, CheckCircle2, AlertCircle, UserPlus, User, ChevronLeft,
    Home, LogOut, Calendar, Lock, Unlock
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

    const [isSubmissionOpen, setIsSubmissionOpen] = useState(false);
    const [isLargeFont, setIsLargeFont] = useState(false); 

    // 修改1：初始只載入 BASE，實際季度由資料庫決定
    const [quarterOptions, setQuarterOptions] = useState(['BASE']);
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

    const [isCreateQuarterModalOpen, setIsCreateQuarterModalOpen] = useState(false);
    const [createSourceQ, setCreateSourceQ] = useState('BASE');
    const [createTargetQ, setCreateTargetQ] = useState('');

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

            const todayStr = new Date().toISOString().split('T')[0];
            let parsedHolidays = {};
            let needsUpdate = false;
            let currentSubmissionStatus = false;

            const sysMem = mData ? mData.find(m => m.name === 'SYSTEM_CUSTOM_HOLIDAYS_DB') : null;

            if (sysSettingsData && sysMem) {
                const sysSetting = sysSettingsData.find(s => s.member_id === sysMem.id);
                if (sysSetting) {
                    if (sysSetting.availability_status === 'OPEN') {
                        currentSubmissionStatus = true;
                    }
                    
                    const datesArr = sysSetting.unavailable_dates;
                    if (Array.isArray(datesArr)) {
                        datesArr.forEach(item => {
                            const [d, n] = item.split('|');
                            if (d && n) {
                                if (d >= todayStr) { parsedHolidays[d] = n; } else { needsUpdate = true; }
                            }
                        });
                    }
                    if (needsUpdate) {
                        const updatedArr = Object.entries(parsedHolidays).map(([d, n]) => `${d}|${n}`);
                        supabase.from('member_quarter_settings').update({ unavailable_dates: updatedArr }).eq('member_id', sysMem.id).eq('quarter', 'SYSTEM').then();
                    }
                }
            }
            
            setIsSubmissionOpen(currentSubmissionStatus);
            setCustomHolidays(parsedHolidays);

            if (allSettingsQs) {
                // 修改1：過濾資料庫中實際季度
                const dbQuarters = allSettingsQs.map(d => d.quarter).filter(q => q !== 'SYSTEM' && q !== 'BASE');
                const viewQFiltered = viewQuarter === 'BASE' ? [] : [viewQuarter];
                const combinedQs = [...new Set([...dbQuarters, ...viewQFiltered])].sort();
                setQuarterOptions(['BASE', ...combinedQs]);
            }
        } catch (err) { showMessage('error', '載入資料失敗，請確認連線。'); } finally { setIsLoading(false); }
    };

    useEffect(() => { loadData(); }, [viewQuarter]);

    const showMessage = (type, text) => { setMessage({ type, text }); setTimeout(() => setMessage({ type: '', text: '' }), 4000); };

    const toggleSubmissionStatus = async () => {
        if (!isAdmin) return;
        setIsLoading(true);
        try {
            const newStatus = isSubmissionOpen ? 'CLOSED' : 'OPEN';
            
            let sysMem = members.find(m => m.name === 'SYSTEM_CUSTOM_HOLIDAYS_DB');
            if (!sysMem) {
                const { data, error } = await supabase.from('members').insert({ name: 'SYSTEM_CUSTOM_HOLIDAYS_DB' }).select();
                if (error) throw error;
                sysMem = data[0];
            }

            const { data: sysSettings } = await supabase.from('member_quarter_settings')
                .select('*').eq('member_id', sysMem.id).eq('quarter', 'SYSTEM');
                
            let existingDates = [];
            if (sysSettings && sysSettings.length > 0 && Array.isArray(sysSettings[0].unavailable_dates)) {
                existingDates = sysSettings[0].unavailable_dates;
            }

            const { error } = await supabase.from('member_quarter_settings').upsert({
                member_id: sysMem.id,
                quarter: 'SYSTEM',
                availability_status: newStatus,
                unavailable_dates: existingDates
            }, { onConflict: 'member_id, quarter' });

            if (error) throw error;
            setIsSubmissionOpen(!isSubmissionOpen);
            showMessage('success', `已${!isSubmissionOpen ? '開放' : '關閉'}同工填寫權限`);
        } catch (err) {
            showMessage('error', '權限切換失敗: ' + err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const openCreateQuarterModal = () => {
        setCreateSourceQ('BASE');
        setCreateTargetQ(getNextQuarter(viewQuarter === 'BASE' ? getCurrentQuarter() : viewQuarter));
        setIsCreateQuarterModalOpen(true);
    };

    const copyQuarterData = async (sourceQ, targetQ) => {
        setIsLoading(true);
        try {
            const { data: oldSettings, error: err1 } = await fetchAllData(() => supabase.from('member_quarter_settings').select('*').eq('quarter', sourceQ));
            const { data: oldPos, error: err2 } = await fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', sourceQ));
            if (err1) throw err1; if (err2) throw err2;
            
            const sourceName = sourceQ === 'BASE' ? '基礎版' : sourceQ;
            if ((!oldSettings || oldSettings.length === 0) && (!oldPos || oldPos.length === 0)) throw new Error(`【${sourceName}】目前沒有任何資料可供複製！`);

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
            
            const targetName = targetQ === 'BASE' ? '基礎版' : targetQ.replace('-', '');
            showMessage('success', `${targetName} 新增完成`);
            
            if (targetQ !== 'BASE') {
                setViewQuarter(targetQ);
            } else {
                loadData();
            }
        } catch (err) { showMessage('error', '處理失敗: ' + err.message); } finally { setIsLoading(false); }
    };

    const handleExecuteCreateQuarter = () => {
        if (!createSourceQ || !createTargetQ) return showMessage('error', '請選擇來源與目標季度');
        setIsCreateQuarterModalOpen(false);
        copyQuarterData(createSourceQ, createTargetQ);
    };

    const triggerSaveToBase = () => {
        setConfirmAction({
            title: '儲存同工資料基礎版',
            message: `將【${viewQuarter.replace('-', '')}】覆寫至「基礎版」？`,
            confirmText: '儲存',
            onConfirm: () => {
                setConfirmAction(null);
                copyQuarterData(viewQuarter, 'BASE');
            }
        });
    };

    const openDeleteQuarterModal = async () => {
        setIsLoading(true);
        try {
            const { data: allSettingsQs } = await fetchAllData(() => supabase.from('member_quarter_settings').select('quarter'));
            const { data: allPosQs } = await fetchAllData(() => supabase.from('member_positions').select('quarter'));
            const combined = [...(allSettingsQs || []), ...(allPosQs || [])].map(d => d.quarter);
            const uniqueQs = [...new Set(combined)].filter(q => q !== 'SYSTEM' && q !== 'BASE').sort().reverse();
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
            
            if (quartersToDelete.includes(viewQuarter)) {
                setViewQuarter(isAdmin ? getCurrentQuarter() : getNextQuarter(getCurrentQuarter()));
            } else {
                loadData(); 
            }
        } catch (err) { showMessage('error', '刪除失敗: ' + err.message); } finally { setIsLoading(false); }
    };

    // 修改2：確保 dual_service_pref 被重置為空字串（預設狀態）
    const openAddModal = () => { 
        setEditingMember(null); 
        setFormData({ ...DEFAULT_MEMBER, dual_service_pref: '' }); 
        setFormPositions({}); 
        setIsModalOpen(true); 
    };

    const handleAddCustomHoliday = async () => {
        if (!newHolidayDate || !newHolidayName.trim()) return showMessage('error', '選擇日期，填寫節日提醒內容');
        const todayStr = new Date().toISOString().split('T')[0];
        if (newHolidayDate < todayStr) return showMessage('error', '歷史日期，無法新增');

        setIsLoading(true);
        try {
            const updatedHolidays = { ...customHolidays, [newHolidayDate]: newHolidayName.trim() };
            const holidaysArr = Object.entries(updatedHolidays).map(([d, n]) => `${d}|${n}`);
            const sysMem = members.find(m => m.name === 'SYSTEM_CUSTOM_HOLIDAYS_DB');
            
            const systemStatus = isSubmissionOpen ? 'OPEN' : 'CLOSED';
            
            if (sysMem) {
                const { error } = await supabase.from('member_quarter_settings').upsert({ member_id: sysMem.id, quarter: 'SYSTEM', unavailable_dates: holidaysArr, availability_status: systemStatus }, { onConflict: 'member_id, quarter' });
                if (error) throw error;
            } else {
                const { data: newMem, error: insErr } = await supabase.from('members').insert({ name: 'SYSTEM_CUSTOM_HOLIDAYS_DB' }).select();
                if (insErr) throw insErr;
                await supabase.from('member_quarter_settings').insert({ member_id: newMem[0].id, quarter: 'SYSTEM', unavailable_dates: holidaysArr, availability_status: systemStatus });
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
                const systemStatus = isSubmissionOpen ? 'OPEN' : 'CLOSED';
                const { error } = await supabase.from('member_quarter_settings').upsert({ member_id: sysMem.id, quarter: 'SYSTEM', unavailable_dates: holidaysArr, availability_status: systemStatus }, { onConflict: 'member_id, quarter' });
                if (error) throw error;
            }
            setCustomHolidays(updatedHolidays); loadData();
        } catch (error) { showMessage('error', '刪除失敗: ' + error.message); } finally { setIsLoading(false); }
    };

    const openEditModal = (member) => {
        const settings = quarterSettings.find(s => s.member_id === member.id) || {};
        let safeDates = [];
        if (Array.isArray(settings.unavailable_dates)) safeDates = settings.unavailable_dates;
        else if (typeof settings.unavailable_dates === 'string') {
            try { const parsed = JSON.parse(settings.unavailable_dates); safeDates = Array.isArray(parsed) ? parsed : [settings.unavailable_dates]; }
            catch(err) { safeDates = settings.unavailable_dates ? [settings.unavailable_dates] : []; }
        }
        
        setEditingMember(member);
        setFormData({ 
            ...DEFAULT_MEMBER,
            ...member,
            name: member.name ?? '',
            email: member.email ?? '', 
            group_id: member.group_id ?? '',
            preferred_session: settings.preferred_session ?? '第一堂',
            availability_status: settings.availability_status ?? '穩定服事', 
            dual_service_pref: settings.dual_service_pref ?? '',
            unavailable_dates: safeDates, 
            newcomer_rule: settings.newcomer_rule ?? ''
        });

        const posMap = {};
        memberPositions.filter(mp => mp.member_id === member.id).forEach(mp => { posMap[mp.position_id] = mp.is_active !== false ? 'active' : 'inactive'; });
        setFormPositions(posMap); 
        setIsModalOpen(true);
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
        if (!isAdmin && !isSubmissionOpen) {
            return showMessage('error', '非開放填寫期間無法儲存變更！');
        }

        if (!formData.name || !formData.name.trim()) return showMessage('error', '姓名不可為空！');
        setIsLoading(true);
        try {
            let memberId = editingMember ? editingMember.id : null;
            const cleanedGroupId = (formData.group_id || '').trim().toUpperCase();
            const finalGroupId = cleanedGroupId === '' ? null : cleanedGroupId;
            const parsedNewcomerRule = formData.newcomer_rule === '' ? null : parseInt(formData.newcomer_rule);
            
            const finalDualPref = formData.dual_service_pref === '' ? null : parseInt(formData.dual_service_pref);

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
                availability_status: formData.availability_status, dual_service_pref: finalDualPref,
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
        if (m.name && m.name.startsWith('SYSTEM_')) return false;
    
        if (!isAdmin) {
            const memberEmail = m.email ? m.email.trim() : '';
            if (memberEmail !== currentUserAccount && memberEmail !== currentUserEmail) return false;
        }
        const term = searchTerm.toLowerCase();
        
        if (m.name.toLowerCase().includes(term)) return true;
        if (m.group_id && m.group_id.toLowerCase().includes(term)) return true;
        
        const hasMatchingPosition = memberPositions.filter(mp => mp.member_id === m.id).some(mp => {
            const p = positions.find(pos => pos.id === mp.position_id);
            return p && p.name.toLowerCase().includes(term);
        });
        if (hasMatchingPosition) return true;
        
        const settings = quarterSettings.find(s => s.member_id === m.id);
        if (settings) {
            if (settings.preferred_session && settings.preferred_session.toLowerCase().includes(term)) return true;
            if (settings.availability_status && settings.availability_status.toLowerCase().includes(term)) return true;
            
            let dualPrefText = '預設兼任 開啟兼任'; 
            if (settings.dual_service_pref === 0) dualPrefText = '關閉兼任';
            if (settings.dual_service_pref === 1) dualPrefText = '二堂同崗';
            if (settings.dual_service_pref === 2) dualPrefText = '二堂異崗';
            
            if (dualPrefText.includes(term)) return true;
        }
        
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
        <div className="flex h-[100dvh] w-full bg-slate-50 overflow-hidden relative">
            {isAdmin && (
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
                            <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 shadow-button text-white rounded-xl font-medium text-sm">
                                <Users size={18} />
                                <span>同工資料中心</span>
                            </div>
                            <button onClick={goToSchedule} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-normal text-sm transition-all text-left group">
                                <Calendar size={18} className="text-slate-400 group-hover:text-violet-400 transition-colors" />
                                <span>排班作業中心</span>
                            </button>
                        </nav>
                    </div>
                    
                    <div className="p-4 border-t border-slate-800">
                        <button 
                            onClick={async () => { 
                                if (supabase?.auth?.signOut) { await supabase.auth.signOut(); } 
                                window.location.reload(); 
                            }} 
                            className="w-full flex items-center gap-3 px-4 py-3 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-xl font-normal text-sm transition-all text-left group"
                        >
                            <LogOut size={18} className="text-rose-400 group-hover:translate-x-0.5 transition-transform" />
                            <span>Sign Out</span>
                        </button>
                    </div>
                </div>
            )}

            <div className="flex-1 flex flex-col relative bg-slate-50 overflow-hidden animate-fade-in">
                <div className="bg-white px-6 py-4 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0 shadow-sm z-20">
                    <div className="flex items-center gap-3 w-full md:w-auto">
                        <button onClick={goBack} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-500 transition-colors" title={isAdmin ? "返回首頁" : "登出系統"}>
                            {isAdmin ? <ChevronLeft size={24} /> : <LogOut size={22} className="ml-0.5" />}
                        </button>
                        <h2 className="text-2xl font-extrabold text-slate-900 flex items-center gap-3 tracking-tight">
                            <Users className="text-indigo-600" size={28}/> 同工資料中心
                        </h2>
                    </div>
                    <div className="flex items-center gap-3 overflow-x-auto w-full md:w-auto no-scrollbar pb-1 md:pb-0">
                        
                        {/* 非管理員狀態標籤 */}
                        {!isAdmin && (
                            <div className="flex items-center bg-slate-50 p-1.5 rounded-lg border border-slate-200 shadow-sm shrink-0">
                                <div className={`h-8 px-4 rounded-md text-xs font-medium whitespace-nowrap flex items-center gap-2 shadow-sm bg-white ${isSubmissionOpen ? 'text-emerald-600' : 'text-red-600'}`}>
                                    {isSubmissionOpen ? (
                                        <>
                                            <span className="relative flex h-2.5 w-2.5">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                                            </span>
                                            Open Now
                                        </>
                                    ) : (
                                        <>
                                            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
                                            View Only
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Admin 季度選單 */}
                        {isAdmin && (
                            <div className="flex items-center bg-slate-50 rounded-lg px-2 py-1.5 border border-slate-200">
                                <select value={viewQuarter} onChange={(e) => setViewQuarter(e.target.value)} className="bg-transparent border-none font-medium text-indigo-600 text-sm outline-none cursor-pointer">
                                    {quarterOptions.map(q => <option key={q} value={q}>{q === 'BASE' ? '基礎版' : q.replace('-', '')}</option>)}
                                </select>
                            </div>
                        )}

                        {/* Group 1: 動作按鈕 (新增、刪除、儲存) */}
                        {isAdmin && (
                            <div className="flex items-center bg-slate-50 p-1.5 rounded-lg border border-slate-200 overflow-x-auto custom-scrollbar shadow-sm shrink-0">
                                <button onClick={openCreateQuarterModal} className="h-8 px-4 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 flex items-center gap-1.5">
                                    <Copy size={14} className="text-slate-500" /> 新增
                                </button>
                                
                                {viewQuarter !== 'BASE' && (
                                    <>
                                        <button onClick={openDeleteQuarterModal} className="h-8 px-4 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 flex items-center gap-1.5">
                                            <Trash2 size={14} className="text-slate-500" /> 刪除
                                        </button>
                                        <button onClick={triggerSaveToBase} className="h-8 px-4 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 flex items-center gap-1.5">
                                            <Save size={14} className="text-slate-500" /> 儲存
                                        </button>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Group 2: 狀態切換 (節日提醒、開放填寫) */}
                        {isAdmin && (
                            <div className="flex items-center bg-slate-50 p-1.5 rounded-lg border border-slate-200 overflow-x-auto custom-scrollbar shadow-sm shrink-0">
                                <button 
                                    onClick={() => setIsHolidayManagerOpen(true)} 
                                    className="h-8 px-4 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap text-slate-500 hover:text-slate-700 hover:bg-slate-200/50 flex items-center gap-1.5"
                                >
                                    <CalendarX size={14} className="text-slate-500" /> 節日提醒
                                </button>
                                
                                <div className="w-px h-5 bg-slate-200 mx-2 self-center"></div>
                                
                                <button 
                                    onClick={toggleSubmissionStatus} 
                                    className={`h-8 px-4 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap flex items-center gap-1.5 ${isSubmissionOpen ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                                >
                                    {isSubmissionOpen ? <><Unlock size={14} className="text-emerald-500" /> 開放填寫</> : <><Lock size={14} className="text-slate-500" /> 關閉填寫</>}
                                </button>
                            </div>
                        )}

                        {/* Group 3: Aa 放大獨立按鈕 (保有膠囊外觀) */}
                        <div className="flex items-center bg-slate-50 p-1.5 rounded-lg border border-slate-200 shadow-sm shrink-0">
                            <button 
                                onClick={() => setIsLargeFont(!isLargeFont)} 
                                className={`h-8 px-4 rounded-md text-xs font-medium transition-all duration-200 whitespace-nowrap flex items-center gap-1.5 ${isLargeFont ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                            >
                                <span className="font-bold text-[14px] leading-none">Aa</span> {isLargeFont ? '標準' : '較大'}
                            </button>
                        </div>
                    </div>
                </div>

                {isAdmin && (
                    <div className="px-6 pt-4 pb-2 bg-slate-50 z-10 shrink-0">
                        <div className="bg-white p-2 rounded-xl shadow-soft border border-slate-100 flex items-center relative transition-all focus-within:ring-2 focus-within:ring-indigo-500/20">
                            <Search className="absolute left-4 text-slate-400" size={20} />
                            <input type="text" placeholder="搜尋姓名、群組、崗位、堂別或狀態..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-10 py-2.5 bg-transparent outline-none font-normal text-slate-800 text-sm" />
                            {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-4 text-slate-400 hover:text-slate-600 transition-colors p-1"><X size={18} /></button>}
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-6 pt-2 custom-scrollbar pb-24">
                    {isLoading && members.length === 0 ? (
                        <div className="text-center py-20 text-slate-400 font-medium animate-pulse">載入資料庫中...</div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
                            {displayMembers.map(member => {
                                const settings = quarterSettings.find(s => s.member_id === member.id) || DEFAULT_MEMBER;
                                const ownedPosList = memberPositions.filter(mp => mp.member_id === member.id).map(mp => {
                                    const p = positions.find(pos => pos.id === mp.position_id);
                                    return p ? { name: p.name, isActive: mp.is_active !== false } : null;
                                }).filter(Boolean);

                                return (
                                    <div key={member.id} className="bg-white rounded-xl p-4 sm:p-6 shadow-soft border border-slate-100 hover:shadow-hover-soft hover:-translate-y-1 transition-all duration-200 relative group">
                                        <div className="flex justify-between items-start mb-3">
                                            <div>
                                                <h3 className={`${isLargeFont ? 'text-2xl sm:text-3xl' : 'text-xl sm:text-2xl'} font-bold text-slate-900 flex items-center gap-2 flex-wrap leading-tight`}>
                                                    {member.name}
                                                    {isAdmin && settings.dual_service_pref === 0 && <span className={`${isLargeFont ? 'text-xs px-2.5 py-1' : 'text-[10px] px-2 py-0.5'} bg-red-50 text-red-600 rounded border border-red-100 font-bold`}>關閉兼任</span>}
                                                    {isAdmin && settings.dual_service_pref === 1 && <span className={`${isLargeFont ? 'text-xs px-2.5 py-1' : 'text-[10px] px-2 py-0.5'} bg-violet-50 text-violet-600 rounded border border-violet-100 font-bold`}>二堂同崗</span>}
                                                    {isAdmin && settings.dual_service_pref === 2 && <span className={`${isLargeFont ? 'text-xs px-2.5 py-1' : 'text-[10px] px-2 py-0.5'} bg-violet-50 text-violet-600 rounded border border-violet-100 font-bold`}>二堂異崗</span>}
                                                    {isAdmin && member.group_id && <span className={`${isLargeFont ? 'text-xs px-2.5 py-1' : 'text-[10px] px-2 py-0.5'} bg-indigo-50 text-indigo-600 rounded border border-indigo-100 font-bold`}>{member.group_id}</span>}
                                                </h3>
                                                <div className={`flex items-center flex-wrap gap-1.5 ${isLargeFont ? 'text-sm' : 'text-xs'} font-normal mt-3`}>
                                                    <span className={`px-2 py-0.5 rounded-full ${settings.availability_status === '穩定服事' ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'}`}>
                                                        {settings.availability_status}
                                                    </span>
                                                    <span className="text-slate-300">|</span>
                                                    <span className="text-slate-500">{settings.preferred_session}</span>
                                                </div>
                                            </div>
                                            <div className={`flex gap-1.5 transition-opacity ${!isAdmin ? 'opacity-100' : 'opacity-100 sm:opacity-0 sm:group-hover:opacity-100'}`}>
                                                {(isAdmin || isSubmissionOpen) && <button onClick={() => openEditModal(member)} className="p-2.5 bg-slate-50 hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 rounded-lg transition-colors"><Edit2 size={16}/></button>}
                                                {isAdmin && <button onClick={() => handleDelete(member.id, member.name)} className="p-2.5 bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors"><Trash2 size={16}/></button>}
                                            </div>
                                        </div>
                                        <div className="space-y-3">
                                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                                <p className={`${isLargeFont ? 'text-base' : 'text-sm'} font-medium text-slate-700 mb-2 flex items-center gap-1.5`}><ShieldCheck size={isLargeFont ? 16 : 12}/> 服事崗位 ({ownedPosList.length})</p>
                                                <div className="flex flex-wrap gap-2">
                                                    {ownedPosList.length > 0 ? ownedPosList.map(p => (
                                                        <span key={p.name} className={`${isLargeFont ? 'text-base px-3 py-2' : 'text-sm px-2.5 py-1.5'} font-medium rounded-lg border flex items-center gap-1.5 ${p.isActive ? 'bg-white border-slate-200 text-slate-700 shadow-sm' : 'bg-slate-100 border-slate-200 border-dashed text-slate-400'}`}>
                                                            {p.name} 
                                                            {isAdmin && !p.isActive && <span className={`${isLargeFont ? 'text-xs px-1.5' : 'text-[10px] px-1'} bg-slate-200 text-slate-500 rounded`}>暫停</span>}
                                                            {isAdmin && (p.name.includes('新朋友') && settings.newcomer_rule > 0) && (
                                                                <span className={`${isLargeFont ? 'text-xs' : 'text-[10px]'} text-indigo-500 ml-0.5`}>
                                                                    {settings.newcomer_rule === 1 ? "(主責)" : settings.newcomer_rule === 2 ? "(禁排)" : "(主責+禁排)"}
                                                                </span>
                                                            )}
                                                        </span>
                                                    )) : <span className={`${isLargeFont ? 'text-sm' : 'text-xs'} text-slate-400`}>尚未設定</span>}
                                                </div>
                                            </div>
                                            {(settings.unavailable_dates && settings.unavailable_dates.length > 0) && (
                                                <div className="bg-orange-50/60 p-3 rounded-lg border border-orange-100">
                                                    <p className={`${isLargeFont ? 'text-base' : 'text-sm'} font-medium text-orange-500 mb-2 flex items-center gap-1.5`}><CalendarX size={isLargeFont ? 16 : 12}/> 不可排班日 ({settings.unavailable_dates.length})</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {settings.unavailable_dates.map(d => (
                                                            <span key={d} className={`${isLargeFont ? 'text-base px-4 py-1.5' : 'text-sm px-3 py-1'} font-medium bg-white text-orange-600 rounded-md border border-orange-200 shadow-sm`}>{d.split('-').slice(1).join('/')}</span>
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
                            <p className="text-slate-500 font-normal mb-2">{!isAdmin ? '未完成註冊或找不到帳號' : '找不到符合的同工資料'}</p>
                        </div>
                    )}
                </div>

                {isAdmin && (
                    <button onClick={openAddModal} className="absolute bottom-8 right-8 z-40 bg-gradient-to-r from-indigo-600 to-violet-600 text-white w-14 h-14 rounded-full shadow-button hover:-translate-y-1 transition-all duration-200 active:scale-95" title="新增同工">
                        <UserPlus size={24} className="mx-auto" />
                    </button>
                )}

                {isModalOpen && (
                    <div className="fixed inset-0 z-[100] flex flex-col justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                        <div className="bg-white w-full mx-auto max-w-2xl max-h-[85dvh] rounded-2xl shadow-hover-soft overflow-hidden flex flex-col animate-fade-in border border-slate-100">
                            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-white shrink-0 sticky top-0 z-10">
                                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                    {editingMember ? <Edit2 size={20} className="text-indigo-600"/> : <UserPlus size={20} className="text-indigo-600"/>}
                                    {editingMember ? '編輯同工資料' : '新增同工'}
                                </h2>
                                <button onClick={closeModal} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"><X size={20}/></button>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-6 touch-pan-y overscroll-contain">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-slate-500 uppercase">姓名 <span className="text-red-500">*</span></label>
                                        <input 
                                            type="text" 
                                            value={formData.name ?? ''} 
                                            onChange={e => setFormData({...formData, name: e.target.value})} 
                                            className={`w-full border border-slate-200 rounded-lg px-4 py-3 sm:py-2.5 outline-none font-normal text-slate-900 transition-all ${!isAdmin && !!editingMember ? 'bg-slate-100 text-slate-500 cursor-not-allowed pointer-events-none' : 'bg-slate-50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20'}`} 
                                            placeholder="請輸入姓名" 
                                            readOnly={!isAdmin && !!editingMember} 
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-slate-500 uppercase">服事意願</label>
                                        <select value={formData.availability_status ?? '穩定服事'} onChange={e => setFormData({...formData, availability_status: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 font-normal text-slate-900 transition-all">
                                            {FINAL_STATUS_OPTIONS.filter(opt => isAdmin || (opt !== '安息季' && opt !== '一季一次' && opt !== '一季三次')).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-slate-500 uppercase">堂別</label>
                                        <select value={formData.preferred_session ?? '第一堂'} onChange={e => setFormData({...formData, preferred_session: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 font-normal text-slate-900 transition-all">
                                            {SESSION_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                        </select>
                                    </div>
                                    {isAdmin && (
                                        <>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-slate-500 uppercase">群組 ID <span className="text-slate-400 font-normal">(選填)</span></label>
                                                <input type="text" value={formData.group_id ?? ''} onChange={e => setFormData({...formData, group_id: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 font-normal text-slate-900 uppercase transition-all" placeholder="例如：FA" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-slate-500 uppercase">崗位兼任 <span className="text-slate-400 font-normal">(選填)</span></label>
                                                <select value={formData.dual_service_pref ?? ''} onChange={e => setFormData({...formData, dual_service_pref: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 font-normal text-slate-900 transition-all">
                                                    <option value="">預設 (開啟兼任)</option>
                                                    <option value="0">關閉兼任</option>
                                                    <option value="1">二堂同崗</option>
                                                    <option value="2">二堂異崗</option>
                                                </select>
                                            </div>
                                            <div className="space-y-1.5">
                                                <label className="text-xs font-medium text-slate-500 uppercase">新朋友關懷設定 <span className="text-slate-400 font-normal">(選填)</span></label>
                                                <select value={formData.newcomer_rule ?? ''} onChange={e => setFormData({...formData, newcomer_rule: e.target.value})} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 font-normal text-slate-900 transition-all">
                                                    <option value="">預設(正常排班)</option><option value="1">主責</option><option value="2">禁排第二週</option><option value="3">主責 ＋ 禁排第二週</option>
                                                </select>
                                            </div>
                                        </>
                                    )}
                                </div>
                                {isAdmin && (
                                    <div className="space-y-2 bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                                        <label className="text-xs font-medium text-indigo-600 flex items-center gap-1.5 flex-wrap">
                                            <User size={14}/> 帳號 
                                            <span className="text-xs text-indigo-400 font-normal">(忘記密碼需通知「管理員」重設密碼)</span>
                                        </label>
                                        <input type="text" value={formData.email ?? ''} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full bg-white border border-indigo-200 rounded-lg px-4 py-3 sm:py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 font-normal text-slate-900 transition-all" placeholder="電話號碼或電子郵件" />
                                    </div>
                                )}
                                <div className="pt-2 border-t border-slate-100">
                                    <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5 mb-3">
                                        <ShieldCheck size={18} className="text-indigo-500"/> 服事崗位 {!isAdmin && <span className="text-[10px] text-slate-400 font-normal ml-1">(僅供檢視)</span>}
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        {positions.map(pos => {
                                            const status = formPositions[pos.id];
                                            if (!isAdmin && !status) return null;
                                            const isBtnActive = status === 'active';
                                            const isBtnInactive = status === 'inactive';
                                            return (
                                                <button key={pos.id} type="button" onClick={() => togglePosition(pos.id)} className={`px-4 py-2.5 sm:py-2 rounded-lg text-sm font-medium border-2 transition-all duration-200 flex items-center gap-1.5 ${!isAdmin ? 'cursor-default' : 'hover:-translate-y-0.5 active:scale-95'} ${isBtnActive ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : isBtnInactive ? 'bg-white border-slate-300 text-slate-500 border-dashed' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>
                                                    {pos.name}
                                                    {isAdmin && isBtnActive && <span className="w-2 h-2 rounded-full bg-indigo-500 ml-1"></span>}
                                                    {isAdmin && isBtnInactive && <span className="text-[10px] ml-1 opacity-60">暫停</span>}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                
                                {viewQuarter !== 'BASE' && (
                                    <div className="pt-4 border-t border-slate-100">
                                        <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5 mb-3">
                                            <CalendarX size={18} className="text-orange-500"/> 不可排班日 <span className="text-xs text-slate-400 font-normal ml-1">(點擊選取)</span>
                                        </label>
                                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                                            {getSundaysInQuarter(viewQuarter).map(date => {
                                                const isChecked = Array.isArray(formData.unavailable_dates) && formData.unavailable_dates.includes(date);
                                                const holidayName = getHolidayName(date, customHolidays);
                                                const shortDate = date.split('-').slice(1).join('/');
                                                return (
                                                    <label key={date} className={`relative flex flex-col items-center justify-center p-3 sm:p-2 rounded-xl border-2 transition-all duration-200 cursor-pointer select-none active:scale-[0.97] ${isChecked ? 'bg-orange-50 border-orange-500 shadow-sm' : 'bg-white border-slate-200 hover:border-orange-200 hover:-translate-y-0.5'}`}>
                                                        <input type="checkbox" className="sr-only" checked={isChecked} onChange={(e) => {
                                                            let newDates = Array.isArray(formData.unavailable_dates) ? [...formData.unavailable_dates] : [];
                                                            if (e.target.checked) { if (!newDates.includes(date)) newDates.push(date); } else { newDates = newDates.filter(d => d !== date); }
                                                            setFormData({ ...formData, unavailable_dates: newDates.sort() });
                                                        }} />
                                                        {isChecked && <Check className="absolute top-1 right-1 text-orange-500" size={14} strokeWidth={3} />}
                                                        <span className={`text-base sm:text-sm font-medium ${isChecked ? 'text-orange-600' : 'text-slate-600'}`}>{shortDate}</span>
                                                        {holidayName && <span className={`text-xs font-normal mt-1 text-center leading-tight ${isChecked ? 'text-orange-500' : 'text-slate-400'}`}>{holidayName}</span>}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                            
                            <div className="px-5 py-4 border-t border-slate-100 bg-white flex gap-3 shrink-0 sticky bottom-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                                <button onClick={closeModal} className="flex-1 py-3 sm:py-2.5 rounded-lg font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">取消</button>
                                <button onClick={handleSave} disabled={isLoading} className="flex-[2] py-3 sm:py-2.5 bg-gradient-to-r from-indigo-600 to-violet-600 hover:opacity-95 text-white rounded-lg font-medium flex items-center justify-center gap-2 shadow-button transition-all duration-200 hover:-translate-y-0.5 active:scale-95 disabled:opacity-50">
                                    <Save size={18}/> {isLoading ? '儲存中...' : '儲存設定'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {isHolidayManagerOpen && isAdmin && (
                    <div className="fixed inset-0 z-[100] flex flex-col justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                        <div className="bg-white w-full mx-auto max-h-[85dvh] max-w-lg rounded-2xl shadow-hover-soft overflow-hidden flex flex-col animate-fade-in border border-slate-100">
                            <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-white shrink-0 sticky top-0">
                                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><CalendarX className="text-sky-500" size={20} /> 自訂節日提醒</h3>
                                <button onClick={() => setIsHolidayManagerOpen(false)} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-400 transition-colors"><X size={20}/></button>
                            </div>
                            <div className="p-5 overflow-y-auto custom-scrollbar space-y-6 flex-1 touch-pan-y overscroll-contain">
                                <div className="bg-sky-50 p-4 rounded-xl border border-sky-100 text-sm font-normal text-sky-700 leading-relaxed">
                                    系統內建至 2030 年的節日。手動新增節日提醒，編輯同工資料時會自動標示！
                                </div>
                                <div className="space-y-3">
                                    <label className="text-xs font-medium text-slate-500 uppercase">新增節日提醒</label>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <input type="date" value={newHolidayDate} onChange={e => {
                                            const val = e.target.value; if (val && new Date(val).getDay() !== 0) { showMessage('error', '只能選週日'); setNewHolidayDate(''); return; }
                                            setNewHolidayDate(val);
                                        }} className="bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 w-full sm:w-auto font-normal text-slate-900 transition-all" />
                                        <input type="text" placeholder="輸入節日提醒" value={newHolidayName} onChange={e => setNewHolidayName(e.target.value)} className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-normal text-slate-900 w-full transition-all" />
                                        <button onClick={handleAddCustomHoliday} disabled={isLoading} className="bg-gradient-to-r from-sky-500 to-indigo-500 text-white font-medium px-5 py-3 rounded-lg shadow-button hover:-translate-y-0.5 transition-all duration-200 active:scale-95 w-full sm:w-auto">新增</button>
                                    </div>
                                </div>
                                <div className="space-y-3 pb-8">
                                    <label className="text-xs font-medium text-slate-500 uppercase flex items-center gap-2">自訂節日提醒清單 <span className="bg-slate-100 text-slate-500 px-2 rounded-md text-[10px]">{Object.keys(customHolidays).length}</span></label>
                                    {Object.keys(customHolidays).length === 0 ? (
                                        <div className="text-center py-8 text-slate-400 font-normal bg-slate-50 rounded-xl border border-dashed border-slate-200">尚無自訂提醒</div>
                                    ) : (
                                        <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                                            {Object.entries(customHolidays).sort(([a], [b]) => a.localeCompare(b)).map(([date, name]) => (
                                                <div key={date} className="flex justify-between items-center bg-white border border-slate-100 p-3 rounded-lg shadow-sm hover:shadow-soft transition-all">
                                                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                                                        <span className="text-sky-600 font-medium text-sm">{date}</span>
                                                        <span className="font-normal text-slate-700 text-sm">{name}</span>
                                                    </div>
                                                    <button onClick={() => handleDeleteCustomHoliday(date)} className="p-2.5 bg-red-50 text-red-500 hover:bg-red-100 rounded-lg active:scale-95 transition-colors"><Trash2 size={16}/></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {isCreateQuarterModalOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-sm rounded-2xl shadow-hover-soft flex flex-col overflow-hidden animate-fade-in border border-slate-100">
                            <div className="p-6">
                                <h3 className="text-xl font-bold text-slate-900 mb-4 flex items-center gap-2"><Copy size={24} className="text-amber-500"/> 新增季度資料</h3>
                                <div className="space-y-4">
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-slate-500">資料來源</label>
                                        <select value={createSourceQ} onChange={e => setCreateSourceQ(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 outline-none font-normal text-slate-900 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all">
                                            {quarterOptions.map(q => <option key={q} value={q}>{q === 'BASE' ? '基礎版' : q.replace('-', '')}</option>)}
                                        </select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-slate-500">新增季度</label>
                                        <select value={createTargetQ} onChange={e => setCreateTargetQ(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 outline-none font-normal text-slate-900 focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all">
                                            {generateBaseQuarters().map(q => <option key={q} value={q}>{q.replace('-', '')}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </div>
                            <div className="p-3 bg-slate-50 flex gap-2 border-t border-slate-100">
                                <button onClick={() => setIsCreateQuarterModalOpen(false)} className="flex-1 py-3 font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors">取消</button>
                                <button onClick={handleExecuteCreateQuarter} className="flex-1 py-3 font-medium text-white bg-gradient-to-r from-amber-500 to-orange-500 shadow-button hover:-translate-y-0.5 rounded-lg transition-all duration-200">建立</button>
                            </div>
                        </div>
                    </div>
                )}

                {message.text && (
                    <div className={`fixed top-24 left-1/2 -translate-x-1/2 z-[110] px-5 py-3 rounded-xl font-medium shadow-soft animate-fade-in flex items-start gap-2 max-w-[90vw] w-max ${message.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
                        <div className="shrink-0 mt-0.5">{message.type === 'success' ? <CheckCircle2 size={18}/> : <AlertCircle size={18}/>}</div>
                        <div className="text-sm leading-snug break-words flex-1">{message.text}</div>
                    </div>
                )}
                
                {(confirmAction || isDeleteQuarterModalOpen) && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
                        <div className="bg-white w-full max-w-sm rounded-2xl shadow-hover-soft flex flex-col overflow-hidden animate-fade-in border border-slate-100">
                            <div className="p-8 text-center">
                                <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${confirmAction?.title === '警告' || isDeleteQuarterModalOpen ? 'bg-red-50 text-red-500' : 'bg-emerald-50 text-emerald-500'}`}>
                                    {isDeleteQuarterModalOpen ? <Trash2 size={32}/> : (confirmAction?.title === '警告' ? <AlertCircle size={32}/> : <Save size={32}/>)}
                                </div>
                                <h3 className="text-xl font-bold text-slate-900 mb-3">{isDeleteQuarterModalOpen ? '刪除同工資料' : confirmAction?.title}</h3>
                                {isDeleteQuarterModalOpen ? (
                                    <>
                                        <p className="text-sm font-medium text-slate-500 mb-4"><span className="text-red-500">同步刪除同工與排班資料，無法復原！</span></p>
                                        {detectedQuarters.length === 0 ? (
                                            <div className="py-6 text-slate-400 font-normal bg-slate-50 rounded-lg border border-dashed border-slate-200">尚無可刪除的季度資料</div>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2.5 max-h-[40vh] overflow-y-auto p-1 custom-scrollbar">
                                                {detectedQuarters.map(q => {
                                                    const isSelected = quartersToDelete.includes(q);
                                                    return (
                                                        <label key={q} className={`relative flex items-center justify-center p-3 rounded-xl border-2 transition-all duration-200 cursor-pointer select-none active:scale-[0.97] ${isSelected ? 'bg-red-50 border-red-500 shadow-sm' : 'bg-white border-slate-200 hover:border-red-200'}`}>
                                                            <input type="checkbox" className="sr-only" value={q} checked={isSelected} onChange={(e) => {
                                                                if (e.target.checked) setQuartersToDelete([...quartersToDelete, q]);
                                                                else setQuartersToDelete(quartersToDelete.filter(item => item !== q));
                                                            }} />
                                                            {isSelected && <Check className="absolute top-1 right-1 text-red-500" size={14} strokeWidth={3} />}
                                                            <span className={`text-sm font-medium ${isSelected ? 'text-red-600' : 'text-slate-600'}`}>{q.replace('-', '')}</span>
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <p className="text-sm font-normal text-slate-500 whitespace-pre-line">{confirmAction?.message}</p>
                                )}
                            </div>
                            <div className="p-3 bg-slate-50 flex gap-2 border-t border-slate-100">
                                <button onClick={() => {setConfirmAction(null); setIsDeleteQuarterModalOpen(false);}} className="flex-1 py-3 font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors">取消</button>
                                <button onClick={isDeleteQuarterModalOpen ? executeDeleteQuarter : confirmAction?.onConfirm} disabled={isDeleteQuarterModalOpen && quartersToDelete.length === 0} className={`flex-1 py-3 font-medium text-white rounded-lg transition-all duration-200 ${isDeleteQuarterModalOpen || confirmAction?.title === '警告' ? 'bg-gradient-to-r from-red-500 to-rose-600 hover:-translate-y-0.5 shadow-button disabled:opacity-50' : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:-translate-y-0.5 shadow-button'} disabled:cursor-not-allowed`}>
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
