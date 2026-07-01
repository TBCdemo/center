import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
    Calendar, Play, Search, ChevronLeft, GripVertical, RefreshCw, 
    Download, Save, AlertCircle, CheckCircle2, HeartPulse, Activity, 
    Layers, ShieldAlert, UserCog, BarChart3, Info, HandHeart, 
    ArrowLeftRight, Users, TrendingUp, CalendarDays, GitBranch, 
    Lightbulb, UserCheck, UserX, LayoutList, 
    ArrowUpDown, X, Database, AlertTriangle,
    Home, LogOut, Edit2, Check, ShieldCheck, Undo2, Redo2,
    ChevronDown, ChevronUp, Plus, Copy, Camera
} from 'lucide-react';

const safeParseJSON = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data !== 'string') return data;
    try { return JSON.parse(data); } catch (e) { return fallback; }
};

// 自訂崗位固定排序順序
const POSITION_ORDER = ['司會', '執事輪值', '接待', '收奉獻', '主餐', 'PPT', '新朋友關懷'];
const sortPositions = (positions) => {
    if (!positions) return [];
    return [...positions].sort((a, b) => {
        const idxA = POSITION_ORDER.indexOf(a.name);
        const idxB = POSITION_ORDER.indexOf(b.name);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return (a.name || '').localeCompare(b.name || '');
    });
};

const SchedulingAndGovernance = ({ session, goBack, goToMembers, goToInsights, supabase, utils, constants, StatCard }) => {
    const { fetchAllData, getSundaysInQuarter, getQuarterDateRange } = utils;
    const { sessionsToSchedule } = constants;

    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();
    const currQ = Math.ceil(currentMonth / 3);
    const defaultNextQ = currQ === 4 ? 1 : currQ + 1;
    const defaultNextY = currQ === 4 ? currentYear + 1 : currentYear;

    const [schedulingPhase, setSchedulingPhase] = useState('setup'); 
    const [appMode, setAppMode] = useState('schedule'); 
    const [activeSessionTab, setActiveSessionTab] = useState('第一堂'); 
    
    const [year, setYear] = useState(defaultNextY);
    const [quarter, setQuarter] = useState(defaultNextQ);
    const [queryYear, setQueryYear] = useState(defaultNextY);
    const [queryQuarter, setQueryQuarter] = useState(defaultNextQ);
    
    const [dbData, setDbData] = useState({ members: [], positions: [], memberPositions: [], existingSchedules: [], memberQuarterSettings: [] });
    const [isLoading, setIsLoading] = useState(true);
    const [generatedDraft, setGeneratedDraft] = useState([]);
    const [errorMsg, setErrorMsg] = useState('');
    const [showSuccessToast, setShowSuccessToast] = useState(false);
    const [toastMessage, setToastMessage] = useState('儲存成功');
    
    // --- 崗位與人數設定狀態 ---
    const [isPositionsPanelOpen, setIsPositionsPanelOpen] = useState(false);
    const [editPositions, setEditPositions] = useState([]);
    const [isSavingPositions, setIsSavingPositions] = useState(false);
    // -------------------------

    const [activeSlot, setActiveSlot] = useState(null); 
    const [searchTerm, setSearchTerm] = useState('');
    const [globalSearchTerm, setGlobalSearchTerm] = useState(''); // 全域指派搜尋框狀態
    const [analysisSearchTerm, setAnalysisSearchTerm] = useState(''); 
    const [draggedItem, setDraggedItem] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', currentName: '', currentDate: '', currentRole: '', newName: '', newDate: '', newRole: '', type: '', onConfirm: null });
    const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [sortConfig, setSortConfig] = useState({ key: 'totalService', direction: 'desc' });
    const [selectedPersonalStats, setSelectedPersonalStats] = useState(null);
    const [hasQuerySchedule, setHasQuerySchedule] = useState(true); 

    const [quickEditData, setQuickEditData] = useState(null);
    const [isQuickEditSaving, setIsQuickEditSaving] = useState(false);

    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);

    useEffect(() => { 
        const fetchInitialData = async () => {
            setIsLoading(true);
            try {
                const currentQuarterStr = `${year}-Q${quarter}`;
                const [{ data: members }, { data: rawPositions }, { data: memberPositions }, { data: quarterSettings }] = await Promise.all([
                    fetchAllData(() => supabase.from('members').select('*')),
                    fetchAllData(() => supabase.from('positions').select('*')),
                    fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', currentQuarterStr)),
                    fetchAllData(() => supabase.from('member_quarter_settings').select('*').in('quarter', [currentQuarterStr, 'SYSTEM']))
                ]);
                
                const positions = sortPositions(rawPositions);

                setDbData({ 
                    members: members || [], positions: positions || [], memberPositions: memberPositions || [], 
                    existingSchedules: [], memberQuarterSettings: quarterSettings || []
                });
            } catch (err) { setErrorMsg('讀取資料庫失敗。請確保網路連線。'); } 
            finally { setIsLoading(false); }
        };
        fetchInitialData(); 
    }, [year, quarter]); 

    useEffect(() => {
        if (dbData.positions && dbData.positions.length > 0) {
            setEditPositions(dbData.positions);
        }
    }, [dbData.positions]);

    useEffect(() => {
        const checkScheduleExists = async () => {
            if (appMode !== 'query') return;
            try {
                const { data: memData } = await supabase.from('members').select('id').eq('name', 'SYSTEM_SCHEDULE_ARCHIVE').limit(1);
                if (memData && memData.length > 0) {
                    const targetQ = `${queryYear}-Q${queryQuarter}`;
                    const { data } = await supabase.from('member_quarter_settings').select('id').eq('member_id', memData[0].id).eq('quarter', targetQ).limit(1);
                    setHasQuerySchedule(data && data.length > 0);
                } else { setHasQuerySchedule(false); }
            } catch (e) { setHasQuerySchedule(true); }
        };
        checkScheduleExists();
    }, [queryYear, queryQuarter, appMode]);

    const currentQuarterStr = `${year}-Q${quarter}`;

    // --- 崗位與人數設定操作邏輯 ---
    const handlePositionChange = (index, field, value) => {
        const updated = [...editPositions];
        let val = value;
        
        if (field === 'min_people' || field === 'max_people') {
            val = parseInt(value) || 0;
            if (field === 'min_people') {
                if (val < 0) val = 0;
                updated[index].min_people = val;
                if (val > (updated[index].max_people || 1)) {
                    updated[index].max_people = val; // 連動補足最大人數
                }
            } else {
                if (val < 1) val = 1;
                updated[index].max_people = val;
                if (val < (updated[index].min_people || 0)) {
                    updated[index].min_people = val; // 連動降低最小人數
                }
            }
        } else {
            updated[index][field] = value;
        }
        
        setEditPositions(updated);
    };

    const handleSavePositions = async () => {
        setIsSavingPositions(true);
        try {
            const payload = editPositions
                .filter(p => (p.name || '').trim() !== '')
                .map(p => {
                    const posData = { 
                        name: p.name.trim(), 
                        min_people: parseInt(p.min_people) >= 0 ? parseInt(p.min_people) : 1,
                        max_people: parseInt(p.max_people) || 1 
                    };
                    if (p.id) posData.id = p.id; 
                    return posData;
                });

            const { data, error } = await supabase.from('positions').upsert(payload).select();
            if (error) throw error;

            const sortedData = sortPositions(data);
            setDbData(prev => ({ ...prev, positions: sortedData }));
            setIsPositionsPanelOpen(false);
            setToastMessage('儲存成功');
            setShowSuccessToast(true);
            setTimeout(() => setShowSuccessToast(false), 2000);
        } catch (err) {
            setErrorMsg('儲存崗位失敗：' + err.message);
        } finally {
            setIsSavingPositions(false);
        }
    };
    // -------------------------

    const effectiveMembers = useMemo(() => {
        const sundays = getSundaysInQuarter(currentQuarterStr) || [];

        return dbData.members
            .filter(m => m.name && !m.name.startsWith('SYSTEM_'))
            .map(m => {
                const qs = dbData.memberQuarterSettings.find(s => s.member_id === m.id && s.quarter === currentQuarterStr);
                
                let unDatesRaw = qs?.unavailable_dates ? safeParseJSON(qs.unavailable_dates, []) : (m.unavailable_dates || []);
                let unDates = Array.isArray(unDatesRaw) ? [...unDatesRaw] : [];
                
                const unavailableWeeks = qs?.unavailable_weeks ? safeParseJSON(qs.unavailable_weeks, []) : [];
                if (Array.isArray(unavailableWeeks) && unavailableWeeks.length > 0) {
                    sundays.forEach(sundayStr => {
                        const d = new Date(sundayStr);
                        const weekNum = Math.ceil(d.getDate() / 7);
                        
                        if (unavailableWeeks.includes(weekNum) && !unDates.includes(sundayStr)) {
                            unDates.push(sundayStr);
                        }
                    });
                }

                return {
                    ...m,
                    availability_status: qs?.availability_status || m.availability_status || '可排班',
                    preferred_session: qs?.preferred_session || m.preferred_session || '皆可',
                    dual_service_pref: qs?.dual_service_pref ?? m.dual_service_pref ?? null,
                    unavailable_dates: unDates.sort()
                };
            });
    }, [dbData.members, dbData.memberQuarterSettings, currentQuarterStr, getSundaysInQuarter]);

    const effectiveMemberPositions = useMemo(() => {
        return dbData.memberPositions.filter(mp => (mp.quarter === currentQuarterStr || !mp.quarter) && mp.is_active !== false);
    }, [dbData.memberPositions, currentQuarterStr]);

    const runAutoSchedule = () => {
        const targetQuarterStr = `${year}-Q${quarter}`;
        const hasQuarterData = dbData.memberQuarterSettings.some(s => s.quarter === targetQuarterStr);
        if (!hasQuarterData) { setErrorMsg(`⚠️ 「同工資料中心」建立【${targetQuarterStr.replace('-','')}】季度資料，再進行預排！`); return; }

        setIsLoading(true);
        setTimeout(() => {
            try {
                if (window.ScheduleEngine) {
                    const params = { year, quarter, effectiveMembers, effectiveMemberPositions, dbData };
                    const draft = window.ScheduleEngine.generate(params);
                    setGeneratedDraft(draft);
                    setUndoStack([]); 
                    setRedoStack([]);
                }
                setErrorMsg('');
                if (schedulingPhase === 'setup') setActiveSessionTab('第一堂');
                setSchedulingPhase('editor');
            } catch (e) { setErrorMsg('自動排班引擎執行失敗，請確認已載入排班引擎。'); } 
            finally { setIsLoading(false); }
        }, 300);
    };

    const runQuerySchedule = async () => {
        setIsLoading(true);
        try {
            const qY = queryYear; const qQ = queryQuarter; setYear(qY); setQuarter(qQ);
            const targetQuarter = `${qY}-Q${qQ}`;
            
            const [{ data: mData }, { data: rawPData }, { data: mpData }, { data: qsData }] = await Promise.all([
                fetchAllData(() => supabase.from('members').select('*')),
                fetchAllData(() => supabase.from('positions').select('*')),
                fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', targetQuarter)),
                fetchAllData(() => supabase.from('member_quarter_settings').select('*').in('quarter', [targetQuarter, 'SYSTEM']))
            ]);

            const pData = sortPositions(rawPData);

            setDbData({ 
                members: mData || [], positions: pData || [], memberPositions: mpData || [], 
                existingSchedules: [], memberQuarterSettings: qsData || []
            });

            let activeSchedules = [];
            const archiveMem = (mData || []).find(m => m.name === 'SYSTEM_SCHEDULE_ARCHIVE');
            
            if (archiveMem) {
                const archiveQs = (qsData || []).find(q => q.member_id === archiveMem.id && q.quarter === targetQuarter);
                if (archiveQs && archiveQs.unavailable_dates) {
                    activeSchedules = safeParseJSON(archiveQs.unavailable_dates, []);
                }
            }

            if (!activeSchedules || activeSchedules.length === 0) {
                setErrorMsg(`⚠️ 尚未建立 ${targetQuarter} 排班資料，請至「預排作業」新增並發布。`); setIsLoading(false); return;
            }

            const reconstructed = [];
            const sundays = window.ScheduleEngine ? window.ScheduleEngine.getSundaysInQuarter(qY, qQ) : [];

            // ==========================================
            // [新增區塊]：自動推導該季度歷史班表的「實際最大崗位人數」
            // ==========================================
            const historicalMaxPeople = {};
            (pData || []).forEach(pos => {
                const posName = (pos.name || '').trim();
                let maxCount = 0;
                sundays.forEach(sunday => {
                    const dateStr = window.ScheduleEngine ? window.ScheduleEngine.formatDate(sunday) : sunday.toISOString().split('T')[0];
                    sessionsToSchedule.forEach(session => {
                        const count = activeSchedules.filter(s => s.d === dateStr && s.s === session && s.p === posName).length;
                        if (count > maxCount) maxCount = count;
                    });
                });
                historicalMaxPeople[posName] = maxCount;
            });
            // ==========================================

            sundays.forEach(sunday => {
                const dateStr = window.ScheduleEngine ? window.ScheduleEngine.formatDate(sunday) : sunday.toISOString().split('T')[0];
                sessionsToSchedule.forEach(session => {
                    (pData || []).forEach(pos => {
                        const posName = (pos.name || '').trim();
                        if (!posName) return;
                        if (posName === '主餐' && sunday.getDate() > 7) return; 

                        // ==========================================
                        // [修改區塊]：優先使用歷史排班的人數，若歷史完全無資料才 fallback 使用當前全域設定
                        // ==========================================
                        // 原始程式碼：const maxPeople = pos.max_people || 1;
                        const maxPeople = historicalMaxPeople[posName] > 0 ? historicalMaxPeople[posName] : (pos.max_people || 1);
                        // ==========================================

                        const existingForSlot = activeSchedules.filter(s => s.d === dateStr && s.s === session && s.p === posName);

                        existingForSlot.forEach(s => {
                            const member = (mData || []).find(m => m.id === s.m);
                            reconstructed.push({
                                temp_id: `DB_${s.m}_${Math.random()}`, service_date: dateStr, session: session, member_id: s.m, position_id: pos.id,
                                _memberName: member ? member.name : '未知同工', _positionName: posName, is_empty: false, is_emergency: 0
                            });
                        });
                        
                        const missingCount = maxPeople - existingForSlot.length;
                        for (let i = 0; i < missingCount; i++) {
                            reconstructed.push({
                                temp_id: `EMPTY_${dateStr}_${session}_${pos.id}_${Math.random()}`, service_date: dateStr, session: session, member_id: 'EMPTY_SLOT', position_id: pos.id,
                                _memberName: '⚠️ 人工指派', _positionName: posName, is_empty: true
                            });
                        }
                    });
                });
            });

            setGeneratedDraft(reconstructed); setErrorMsg('');
            setUndoStack([]); 
            setRedoStack([]);
            if (schedulingPhase === 'setup') setActiveSessionTab('第一堂');
            setSchedulingPhase('editor');
        } catch (error) { setErrorMsg('查詢班表失敗：' + error.message); } finally { setIsLoading(false); }
    };

    const currentUsageCount = useMemo(() => {
        const counts = {}; effectiveMembers.forEach(m => counts[m.id] = 0);
        generatedDraft.forEach(d => { if (!d.is_empty && counts[d.member_id] !== undefined) counts[d.member_id]++; });
        return counts;
    }, [effectiveMembers, generatedDraft]);

    const memberGroups = useMemo(() => {
        const map = {}; effectiveMembers.forEach(m => { if (m.group_id) map[m.id] = m.group_id; }); return map;
    }, [effectiveMembers]);

    const { conflictIds, orphanIds } = useMemo(() => {
        const conflicts = new Set(); const orphans = new Set();
        const shiftsByDate = {};
        generatedDraft.forEach(d => {
            if (d.is_empty) return;
            if (!shiftsByDate[d.service_date]) shiftsByDate[d.service_date] = [];
            shiftsByDate[d.service_date].push(d);
        });
        Object.values(shiftsByDate).forEach(dayShifts => {
            const freq = {}; const groupFreq = {};
            dayShifts.forEach(d => {
                freq[d.member_id] = (freq[d.member_id] || 0) + 1;
                const gid = memberGroups[d.member_id];
                if (gid && (gid.startsWith('FA') || gid.startsWith('FB'))) {
                    if (!groupFreq[gid]) groupFreq[gid] = new Set();
                    groupFreq[gid].add(d.member_id);
                }
            });
            dayShifts.forEach(d => {
                if (freq[d.member_id] >= 2) conflicts.add(d.temp_id);
                const gid = memberGroups[d.member_id];
                if (gid && groupFreq[gid] && groupFreq[gid].size < 2) orphans.add(d.temp_id);
            });
        });
        return { conflictIds: conflicts, orphanIds: orphans };
    }, [generatedDraft, memberGroups]);

    const saveDraftSnapshot = () => {
        setUndoStack(prev => {
            const newStack = [...prev, generatedDraft];
            return newStack.length > 20 ? newStack.slice(newStack.length - 20) : newStack;
        });
        setRedoStack([]); 
    };

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        const previousDraft = undoStack[undoStack.length - 1];
        setRedoStack(prev => [...prev, generatedDraft]);
        setGeneratedDraft(previousDraft);
        setUndoStack(prev => prev.slice(0, -1));
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        const nextDraft = redoStack[redoStack.length - 1];
        setUndoStack(prev => [...prev, generatedDraft]);
        setGeneratedDraft(nextDraft);
        setRedoStack(prev => prev.slice(0, -1));
    };

    const handleDragStart = useCallback((e, item) => { setDraggedItem(item); e.currentTarget.classList.add('dragging'); }, []);
    const handleDragEnd = useCallback((e) => { e.currentTarget.classList.remove('dragging'); setDraggedItem(null); }, []);
    
    const handleDrop = useCallback((e, targetDate, targetSession, targetPosName, targetIdx) => {
        e.preventDefault();
        if (!draggedItem) return;
        if (draggedItem.service_date !== targetDate || draggedItem.session !== targetSession || draggedItem._positionName !== targetPosName) return;
        
        saveDraftSnapshot(); 

        setGeneratedDraft(prev => {
            const newDraft = [...prev];
            const group = newDraft.filter(d => d.service_date === targetDate && d.session === targetSession && d._positionName === targetPosName);
            if(!group[targetIdx]) return prev;
            const sIdx = newDraft.findIndex(d => d.temp_id === draggedItem.temp_id);
            const tIdx = newDraft.findIndex(d => d.temp_id === group[targetIdx].temp_id);
            const temp = newDraft[sIdx]; newDraft[sIdx] = newDraft[tIdx]; newDraft[tIdx] = temp;
            return newDraft;
        });
    }, [draggedItem]);

    const handleSubstitute = (newMember) => {
        if (!activeSlot || !newMember) return;
        
        saveDraftSnapshot(); 

        setGeneratedDraft(prev => prev.map(d => {
            if (activeSlot._positionName === '執事輪值' && d.service_date === activeSlot.service_date && d._positionName === '執事輪值' && d.member_id === activeSlot.member_id) {
                return { ...d, member_id: newMember.id, _memberName: newMember.name, is_empty: false, is_emergency: 0 };
            }
            if (d.temp_id === activeSlot.temp_id) return { ...d, member_id: newMember.id, _memberName: newMember.name, is_empty: false, is_emergency: 0 };
            return d;
        }));
        setActiveSlot(null); setSearchTerm(''); setGlobalSearchTerm('');
    };

    const handleSwap = (newMember, targetShift) => {
        if (!activeSlot || !newMember || !targetShift) return;
        
        saveDraftSnapshot(); 

        setGeneratedDraft(prev => prev.map(d => {
            if (activeSlot._positionName === '執事輪值') {
                if (d.service_date === activeSlot.service_date && d._positionName === '執事輪值' && d.member_id === activeSlot.member_id) {
                    return { ...d, member_id: newMember.id, _memberName: newMember.name, is_empty: false, is_emergency: 0 };
                }
            } else if (d.temp_id === activeSlot.temp_id) {
                return { ...d, member_id: newMember.id, _memberName: newMember.name, is_empty: false, is_emergency: 0 };
            }
            if (targetShift.isDeaconGroup) {
                if (d.service_date === targetShift.service_date && d._positionName === '執事輪值' && d.member_id === newMember.id) {
                    return { ...d, member_id: activeSlot.member_id, _memberName: activeSlot._memberName };
                }
            } else if (d.temp_id === targetShift.temp_id) {
                return { ...d, member_id: activeSlot.member_id, _memberName: activeSlot._memberName };
            }
            return d;
        }));
        setActiveSlot(null); setSearchTerm(''); setGlobalSearchTerm('');
    };

    const requestSubstitute = (newMember) => {
        const cDate = activeSlot.service_date.replace(/-/g,'/');
        const cRole = activeSlot._positionName === '執事輪值' ? activeSlot._positionName : `${activeSlot.session}‧${activeSlot._positionName}`;
        setConfirmDialog({
            isOpen: true, title: '執行替補', currentName: activeSlot._memberName, currentDate: cDate, currentRole: cRole,
            newName: newMember.name, newDate: cDate, newRole: cRole, type: 'substitute',
            onConfirm: () => { handleSubstitute(newMember); setConfirmDialog(prev => ({ ...prev, isOpen: false })); }
        });
    };

    const requestSwap = (newMember, targetShift) => {
        const cDate = activeSlot.service_date.replace(/-/g,'/');
        const cRole = activeSlot._positionName === '執事輪值' ? activeSlot._positionName : `${activeSlot.session}‧${activeSlot._positionName}`;
        
        const nDate = targetShift.service_date.replace(/-/g,'/');
        const nRole = targetShift._positionName === '執事輪值' ? targetShift._positionName : `${targetShift.session}‧${targetShift._positionName}`;
        
        setConfirmDialog({
            isOpen: true, title: '執行換班', currentName: activeSlot._memberName, currentDate: cDate, currentRole: cRole,
            newName: newMember.name, newDate: nDate, newRole: nRole, type: 'swap',
            onConfirm: () => { handleSwap(newMember, targetShift); setConfirmDialog(prev => ({ ...prev, isOpen: false })); }
        });
    };

    // --- 全域搜尋與強制指派處理邏輯 ---
    const handleOverrideAssign = (newMember) => {
        const cDate = activeSlot.service_date.replace(/-/g,'/');
        const cRole = activeSlot._positionName === '執事輪值' ? activeSlot._positionName : `${activeSlot.session}‧${activeSlot._positionName}`;
        
        setConfirmDialog({
            isOpen: true, title: '⚠️ 強制指派確認', currentName: activeSlot._memberName, currentDate: cDate, currentRole: cRole,
            newName: newMember.name, newDate: cDate, newRole: cRole, type: 'override',
            onConfirm: () => {
                saveDraftSnapshot();
                setGeneratedDraft(prev => prev.map(d => {
                    if (d.temp_id === activeSlot.temp_id) {
                        return { 
                            ...d, 
                            member_id: newMember.id, 
                            _memberName: newMember.name, 
                            is_empty: false, 
                            is_emergency: 1 // 標記為特殊手動指派
                        };
                    }
                    return d;
                }));
                setActiveSlot(null); setSearchTerm(''); setGlobalSearchTerm('');
                setConfirmDialog(prev => ({ ...prev, isOpen: false }));
            }
        });
    };

    // --- 複製通訊文案功能 ---
    const handleCopyCoordinationText = (type, currentName, currentDate, currentRole, newName, newDate, newRole) => {
        let text = '';
        if (type === 'swap') {
           text = `平安！

因同工臨時有事，是否可以協調互換以下班次：

📌 ${currentName}
• ${currentDate}【${currentRole}】

📌 ${newName}
• ${newDate}【${newRole}】

若同意換班，請告知，我們將協助完成換班登記

謝謝你的協助！`;
        } else {
            text = `平安！

因同工臨時有事，請問是否可以協助替補以下服事：

📌 日期：${newDate}
📌 崗位：【${newRole}】

若方便協助，請告知；若不方便也沒關係，再請回覆，謝謝你。`;
        }
        
        navigator.clipboard.writeText(text).then(() => {
            setToastMessage('複製成功');
            setShowSuccessToast(true);
            setTimeout(() => setShowSuccessToast(false), 2000);
        }).catch(() => {
            setErrorMsg('複製失敗');
            setTimeout(() => setErrorMsg(''), 3000);
        });
    };

    // --- 原生 HTML5 Canvas 圖片下載功能 ---
    const handleDownloadCapture = (type, currentName, currentDate, currentRole, newName, newDate, newRole) => {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 240; // 調整高度以符合截圖比例
        const ctx = canvas.getContext('2d');

        // 背景
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 卡片底色繪製函式
        const drawCard = (x, y, w, h, name, date, role, title, isTarget) => {
            // 背景卡片
            ctx.fillStyle = '#ffffff';
            // ctx.shadowColor = 'rgba(15, 23, 42, 0.05)';
            // ctx.shadowBlur = 8;
            // ctx.shadowOffsetX = 0;
            // ctx.shadowOffsetY = 4;
            
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(x, y, w, h, 12) : ctx.rect(x, y, w, h);
            ctx.fill();
            // ctx.shadowColor = 'transparent';
            
            // 標題 (目前同工 / 支援同工)
            ctx.fillStyle = '#64748b';
            ctx.font = 'bold 16px "Microsoft JhengHei", sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(title, x + w / 2, y + 36);

            // 姓名
            ctx.fillStyle = isTarget ? '#ea580c' : '#0f172a'; // Target is orange, source is dark slate
            ctx.font = 'bold 32px "Microsoft JhengHei", sans-serif';
            ctx.fillText(name, x + w / 2, y + 80);

            // 日期背景與文字
            ctx.fillStyle = '#f1f5f9';
            const dateWidth = 110;
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(x + w / 2 - dateWidth / 2, y + 104, dateWidth, 26, 6) : ctx.rect(x + w / 2 - dateWidth / 2, y + 104, dateWidth, 26);
            ctx.fill();
            
            ctx.fillStyle = '#334155';
            ctx.font = 'bold 16px "Microsoft JhengHei", sans-serif'; // 字級加大
            ctx.textBaseline = 'middle';
            ctx.fillText(date.replace(/-/g, '/'), x + w / 2, y + 118);

            // 角色 (堂別 ‧ 崗位)
            ctx.fillStyle = '#4f46e5'; // Indigo color for role
            ctx.font = 'bold 15px "Microsoft JhengHei", sans-serif'; // 字級加大
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(role.replace('‧', ' • '), x + w / 2, y + 160);
        };

        // 繪製卡片底色與邊框
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#f1f5f9';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(24, 24, canvas.width - 48, canvas.height - 48, 16) : ctx.rect(24, 24, canvas.width - 48, canvas.height - 48);
        ctx.fill();
        ctx.stroke();

        // 繪製左右兩側卡片 (調整座標以符合新版面)
        const cardWidth = 200;
        const cardHeight = 180;
        const leftX = 60;
        const rightX = canvas.width - cardWidth - 60;
        const cardY = 24;

        drawCard(leftX, cardY, cardWidth, cardHeight, currentName, currentDate, currentRole, '目前同工', false);
        drawCard(rightX, cardY, cardWidth, cardHeight, newName, newDate, newRole, type === 'swap' ? '換班同工' : '替補同工', true);

        // 中間轉換箭頭與圖標
        ctx.fillStyle = '#f97316'; // Orange arrows
        ctx.font = 'bold 36px "Microsoft JhengHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⇆', canvas.width / 2, canvas.height / 2); // 左右雙向箭頭

        // 下載圖片
        const dataUrl = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = `TBC服事排班調整_${newName}_${newDate.replace(/\//g,'')}.png`;
        link.href = dataUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const toggleQuickEditPosition = (posId) => {
        setQuickEditData(prev => {
            const currentStatus = prev.positions[posId];
            let newPositions = { ...prev.positions };
            if (!currentStatus) newPositions[posId] = 'active';
            else if (currentStatus === 'active') newPositions[posId] = 'inactive';
            else delete newPositions[posId];
            return { ...prev, positions: newPositions };
        });
    };

    const quickEditAutoFillNextNumber = () => {
        if (!quickEditData) return;
        const existingNums = dbData.members
            .map(m => m.group_id || '')
            .filter(id => id.startsWith(quickEditData.groupPrefix))
            .map(id => parseInt(id.replace(quickEditData.groupPrefix, ''), 10))
            .filter(n => !isNaN(n));
        
        const nextNum = existingNums.length === 0 ? 1 : Math.max(...existingNums) + 1;
        setQuickEditData({ ...quickEditData, groupNumber: String(nextNum) });
    };

    const handleQuickEditSave = async () => {
        setIsQuickEditSaving(true);
        try {
            const finalGroupId = quickEditData.groupNumber ? `${quickEditData.groupPrefix}${quickEditData.groupNumber}` : null;
            
            await supabase.from('members').update({ 
                name: quickEditData.name.trim(),
                group_id: finalGroupId
            }).eq('id', quickEditData.id);
    
            const qsPayload = {
                member_id: quickEditData.id,
                quarter: currentQuarterStr,
                preferred_session: quickEditData.preferred_session,
                availability_status: quickEditData.availability_status,
                dual_service_pref: quickEditData.dual_service_pref === '' ? null : parseInt(quickEditData.dual_service_pref),
                newcomer_rule: quickEditData.newcomer_rule === '' ? null : parseInt(quickEditData.newcomer_rule),
                unavailable_dates: quickEditData.unavailable_dates,
                unavailable_weeks: quickEditData.unavailable_weeks || []
            };
            await supabase.from('member_quarter_settings').upsert(qsPayload, { onConflict: 'member_id, quarter' });
    
            await supabase.from('member_positions').delete().eq('member_id', quickEditData.id).eq('quarter', currentQuarterStr);
            const posKeys = Object.keys(quickEditData.positions);
            if (posKeys.length > 0) {
                const insertPosPayload = posKeys.map(pid => ({ 
                    member_id: quickEditData.id, 
                    position_id: pid, 
                    quarter: currentQuarterStr, 
                    is_active: quickEditData.positions[pid] === 'active'
                }));
                await supabase.from('member_positions').insert(insertPosPayload);
            }
    
            const [{ data: members }, { data: memberPositions }, { data: quarterSettings }] = await Promise.all([
                fetchAllData(() => supabase.from('members').select('*')),
                fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', currentQuarterStr)),
                fetchAllData(() => supabase.from('member_quarter_settings').select('*').eq('quarter', currentQuarterStr))
            ]);
    
            setDbData(prev => ({
                ...prev,
                members: members || prev.members,
                memberPositions: memberPositions || prev.memberPositions,
                memberQuarterSettings: quarterSettings || prev.memberQuarterSettings
            }));

            const activePositionIds = Object.keys(quickEditData.positions)
                .filter(pid => quickEditData.positions[pid] === 'active'); 

            setGeneratedDraft(prevDraft => {
                let hasChanges = false;
                const newDraft = prevDraft.map(shift => {
                    if (shift.member_id !== quickEditData.id || shift.is_empty) return shift;

                    const hasQualification = activePositionIds.some(pid => String(pid) === String(shift.position_id));
                    const isUnavailableDate = quickEditData.unavailable_dates.includes(shift.service_date);
                    const weekNum = Math.ceil(new Date(shift.service_date).getDate() / 7);
                    const isUnavailableWeek = (quickEditData.unavailable_weeks || []).includes(weekNum);
                    const isStatusSuspended = ['暫停服事', '安息季', '一季一次', '一季三次'].includes(quickEditData.availability_status);

                    if (!hasQualification || isUnavailableDate || isUnavailableWeek || isStatusSuspended) {
                        hasChanges = true;
                        return {
                            ...shift,
                            member_id: 'EMPTY_SLOT',
                            _memberName: '⚠️ 人工指派',
                            is_empty: true,
                            is_emergency: 0,
                            temp_id: `EMPTY_${shift.service_date}_${shift.session}_${shift.position_id}_${Math.random()}`
                        };
                    }
                    return shift;
                });

                if (hasChanges) {
                    setTimeout(() => {
                        setErrorMsg('⚠️「人工指派」空缺未填補');
                        setTimeout(() => setErrorMsg(''), 5000); 
                    }, 500);
                }

                return newDraft;
            });
    
            setQuickEditData(null);
            setToastMessage('儲存成功');
            setShowSuccessToast(true); 
            setTimeout(() => setShowSuccessToast(false), 2000);
    
        } catch (err) {
            setErrorMsg('儲存同工資料失敗：' + err.message);
        } finally {
            setIsQuickEditSaving(false);
        }
    };

    const recommendations = useMemo(() => {
        if (!activeSlot) return [];
        const { service_date, session, position_id, member_id } = activeSlot;
        const eligibleIds = effectiveMemberPositions.filter(mp => mp.position_id === position_id).map(mp => mp.member_id);
        const requesterPositions = effectiveMemberPositions.filter(mp => mp.member_id === member_id).map(mp => mp.position_id);
        const todayStr = window.ScheduleEngine ? window.ScheduleEngine.formatDate(new Date()) : new Date().toISOString().split('T')[0];

        const requester = effectiveMembers.find(rm => rm.id === member_id);
        const requesterUnDates = requester?.unavailable_dates || [];

        let filtered = effectiveMembers.filter(m => {
            if (m.id === member_id) return false;
            if (!eligibleIds.includes(m.id)) return false;
            const status = (m.availability_status || '').trim();
            if (status === '暫停服事' || status === '安息季') return false;
            
            if (m.unavailable_dates && m.unavailable_dates.includes(service_date)) return false;
            
            const mShiftsToday = generatedDraft.filter(d => d.service_date === service_date && d.member_id === m.id);
            const activeRole = activeSlot._positionName;

            if (activeRole === '執事輪值') {
                if (mShiftsToday.length > 0) return false; 
            } else {
                if (mShiftsToday.some(d => d._positionName === '執事輪值')) return false;

                const rawPref = m.dual_service_pref;
                const dualPref = (rawPref === null || rawPref === undefined || rawPref === '') ? null : parseInt(rawPref);

                const shiftsThisSession = mShiftsToday.filter(d => d.session === session);
                if (shiftsThisSession.length > 0) {
                    if (dualPref === 0) return false; 

                    const concurrentRoles = ['接待', '收奉獻', '主餐', '新朋友關懷'];
                    if (!concurrentRoles.includes(activeRole)) return false;
                    const allExistingAreConcurrent = shiftsThisSession.every(d => concurrentRoles.includes(d._positionName));
                    if (!allExistingAreConcurrent) return false;
                    if (shiftsThisSession.some(d => d._positionName === activeRole)) return false;
                }
                const shiftsOtherSession = mShiftsToday.filter(d => d.session !== session);
                if (shiftsOtherSession.length > 0) {
                    if (dualPref === 0 || dualPref === null) return false; 
                    const otherRoles = shiftsOtherSession.map(d => d._positionName);
                    if (dualPref === 1 && !otherRoles.includes(activeRole)) return false; 
                    if (dualPref === 2 && otherRoles.includes(activeRole)) return false;  
                } else {
                    if ((dualPref === 0 || dualPref === null) && m.preferred_session && m.preferred_session !== '皆可') {
                        if (!m.preferred_session.includes(session.replace('堂', ''))) return false;
                    }
                }
            }
            return true;
        }).map(m => {
            const candidateShifts = generatedDraft.filter(d => d.member_id === m.id);
            let swapOptions = [];
            const processedDeaconDates = new Set();
            
            candidateShifts.forEach(shift => {
                if (!requesterPositions.includes(shift.position_id)) return; 
                if (shift.service_date < todayStr) return;
                
                if (requesterUnDates.includes(shift.service_date)) return;

                if (shift._positionName === '執事輪值') {
                    if (processedDeaconDates.has(shift.service_date)) return;
                    processedDeaconDates.add(shift.service_date);
                    const requesterRolesToday = generatedDraft.filter(d => d.member_id === member_id && d.service_date === shift.service_date).map(d => d._positionName);
                    if (requesterRolesToday.includes('執事輪值')) return;
                    swapOptions.push({ isDeaconGroup: true, service_date: shift.service_date, _positionName: '執事輪值', session: '第一堂、第二堂' });
                } else {
                    const requesterRolesThisSession = generatedDraft.filter(d => d.member_id === member_id && d.service_date === shift.service_date && d.session === shift.session).map(d => d._positionName);
                    if (requesterRolesThisSession.includes(shift._positionName)) return;
                    swapOptions.push(shift);
                }
            });
            return { ...m, usage: currentUsageCount[m.id] || 0, swapOptions };
        });
        return filtered.sort((a, b) => a.usage - b.usage);
    }, [activeSlot, effectiveMembers, effectiveMemberPositions, generatedDraft, currentUsageCount]);

    const finalRecommendations = useMemo(() => {
        if (!searchTerm) return recommendations;
        const lowerTerm = searchTerm.toLowerCase();
        return recommendations.filter(c => {
            if ((c.name || '').toLowerCase().includes(lowerTerm)) return true;
            if (c.swapOptions && c.swapOptions.some(swap => (swap._positionName || '').toLowerCase().includes(lowerTerm))) return true;
            return false;
        });
    }, [recommendations, searchTerm]);

    const handlePublishClick = () => {
        // 利用 min_people 智慧驗證空缺
        const counts = {}; 
        generatedDraft.forEach(d => {
            if (d.is_empty) return;
            const key = `${d.service_date}_${d.session}_${d.position_id}`;
            counts[key] = (counts[key] || 0) + 1;
        });

        const expectedKeys = new Set();
        generatedDraft.forEach(d => { expectedKeys.add(`${d.service_date}_${d.session}_${d.position_id}`); });

        let unmetMin = false;
        for (let key of expectedKeys) {
            const parts = key.split('_');
            const posId = parts[2];
            const pos = dbData.positions.find(p => p.id == posId);
            const min = pos?.min_people !== undefined ? pos.min_people : 1;
            const filled = counts[key] || 0;
            if (filled < min) {
                unmetMin = true;
                break;
            }
        }

        if (unmetMin) { 
            setErrorMsg('⚠️ 尚未達到崗位「最少」需求人數，請補齊後再發布'); 
            setTimeout(() => setErrorMsg(''), 5000); 
            return; 
        }

        setPublishConfirmOpen(true);
    };

    const executePublish = async () => {
        setPublishConfirmOpen(false); setIsSaving(true);
        try {
            const archiveName = 'SYSTEM_SCHEDULE_ARCHIVE';
            let archiveMem = dbData.members.find(m => m.name === archiveName);
            if (!archiveMem) {
                const { data: newMem, error: insErr } = await supabase.from('members').insert({ name: archiveName }).select();
                if (insErr) throw insErr; archiveMem = newMem[0];
            }

            const scheduleData = generatedDraft.filter(d => !d.is_empty).map(d => ({
                d: d.service_date, s: d.session, p: d._positionName, m: d.member_id
            }));

            const { error: qsErr = null } = await supabase.from('member_quarter_settings').upsert({
                member_id: archiveMem.id, quarter: `${year}-Q${quarter}`, unavailable_dates: scheduleData, availability_status: '系統備份檔'
            }, { onConflict: 'member_id, quarter' });

            if (qsErr) throw qsErr;
            setToastMessage('儲存成功');
            setShowSuccessToast(true); setTimeout(() => setShowSuccessToast(false), 3000);
        } catch (err) { setErrorMsg('儲存失敗：' + err.message); } 
        finally { setIsSaving(false); }
    };

    const exportToCSV = () => {
        const tableData = {};
        generatedDraft.forEach(d => {
            if (!d.service_date || !d.session) return;
            const key = `${d.service_date}_${d.session}`;
            if (!tableData[key]) tableData[key] = { date: d.service_date, session: d.session, positions: {} };
            if (!tableData[key].positions[d._positionName]) tableData[key].positions[d._positionName] = [];
            tableData[key].positions[d._positionName].push(d.is_empty ? '⚠️ 人工指派' : (d._memberName || '未知'));
        });
        
        const sortedRows = Object.values(tableData).sort((a, b) => {
            if (a.session !== b.session) {
                if (a.session === '第一堂') return -1;
                if (b.session === '第一堂') return 1;
                return a.session.localeCompare(b.session);
            }
            return a.date.localeCompare(b.date);
        });

        // 這裡改用安全的字串組合方式，避免轉譯器出錯
        const headerRow = "\uFEFF日期,堂別," + dbData.positions.map(p => p.name).join(',') + "\n";
        let csvContent = headerRow;
        
        sortedRows.forEach(row => {
            const r = [row.date, row.session];
            dbData.positions.forEach(pos => {
                r.push((row.positions[pos.name] || []).join('、'));
            });
            // 確保換行符號不會被斷開
            csvContent += r.map(v => `"${v}"`).join(',') + "\n";
        });
        
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a'); 
        link.href = URL.createObjectURL(blob); 
        link.download = `TBC_排班表_${year}Q${quarter}.csv`;
        document.body.appendChild(link); 
        link.click(); 
        document.body.removeChild(link);
    };

    const dashboardData = useMemo(() => {
        const memberStats = {};
        const emptyRoles = {};
        dbData.positions.forEach(p => emptyRoles[p.name] = 0);

        effectiveMembers.forEach(m => {
            const status = (m.availability_status || '').trim();
            if (status === '暫停服事' || status === '安息季') return;
            memberStats[m.id] = { id: m.id, name: m.name, group: m.group_id, totalService: 0, attendanceDates: new Set(), roles: { ...emptyRoles } };
        });
        
        generatedDraft.forEach(d => {
            if (d.is_empty || !memberStats[d.member_id]) return;
            const stats = memberStats[d.member_id];
            if(d.service_date) stats.attendanceDates.add(d.service_date);
            stats.totalService += 1;
            if (d._positionName && stats.roles[d._positionName] !== undefined) stats.roles[d._positionName] += 1;
        });
        
        return Object.values(memberStats).map(d => ({ ...d, attendance: d.attendanceDates.size, distinctRolesCount: Object.values(d.roles).filter(c => c > 0).length, healthScore: 0 })); 
    }, [generatedDraft, effectiveMembers, dbData.positions]);

    const dashboardStats = useMemo(() => {
        if (!dashboardData || dashboardData.length === 0) return null;
        const totalMembers = dashboardData.length;
        const totalServices = dashboardData.reduce((sum, d) => sum + d.totalService, 0);
        const totalAttendance = dashboardData.reduce((sum, d) => sum + d.attendance, 0);
        const avgService = totalMembers ? (totalServices / totalMembers) : 0;
        const avgAttendance = totalMembers ? (totalAttendance / totalMembers) : 0;
        const variance = dashboardData.reduce((sum, d) => sum + Math.pow(d.totalService - avgService, 2), 0) / totalMembers;
        const stdDev = Math.sqrt(variance);
        const highRiskThreshold = Math.max(8, avgService + stdDev * 1.5);
        const highRiskMembers = dashboardData.filter(d => d.totalService >= highRiskThreshold);
        const attentionMembers = dashboardData.filter(d => d.totalService >= avgService + stdDev && d.totalService < highRiskThreshold);
        const maxService = Math.max(0, ...dashboardData.map(d => d.totalService));
        const roleCounts = {};
        dashboardData.forEach(d => { Object.keys(d.roles).forEach(role => { roleCounts[role] = (roleCounts[role] || 0) + d.roles[role]; }); });
        dashboardData.forEach(d => {
            if (d.totalService >= highRiskThreshold) d.healthStatus = 'danger';
            else if (d.totalService >= avgService + stdDev) d.healthStatus = 'warning';
            else d.healthStatus = 'healthy';
        });

        const attendanceDistObj = {}; const serviceDistObj = {};
        dashboardData.forEach(d => {
            attendanceDistObj[d.attendance] = (attendanceDistObj[d.attendance] || 0) + 1;
            serviceDistObj[d.totalService] = (serviceDistObj[d.totalService] || 0) + 1;
        });
        const maxAttCount = Math.max(0, ...Object.values(attendanceDistObj));
        const maxSrvCount = Math.max(0, ...Object.values(serviceDistObj));

        return { totalMembers, totalServices, avgService: avgService.toFixed(1), avgAttendance: avgAttendance.toFixed(1), stdDev: stdDev.toFixed(2), maxService, highRiskMembers, attentionMembers, roleCounts, attendanceDistObj, serviceDistObj, maxAttCount, maxSrvCount };
    }, [dashboardData]);

    const sortedDashboardData = useMemo(() => {
        if (!dashboardData) return [];
        let sortableItems = [...dashboardData];
        if (analysisSearchTerm) {
            const term = analysisSearchTerm.toLowerCase();
            sortableItems = sortableItems.filter(d => (d.name || '').toLowerCase().includes(term));
        }
        sortableItems.sort((a, b) => {
            let aValue = sortConfig.key === 'name' ? (a.name || '') : (sortConfig.key === 'totalService' ? a.totalService : (sortConfig.key === 'attendance' ? a.attendance : a.roles[sortConfig.key] || 0));
            let bValue = sortConfig.key === 'name' ? (b.name || '') : (sortConfig.key === 'totalService' ? b.totalService : (sortConfig.key === 'attendance' ? b.attendance : b.roles[sortConfig.key] || 0));
            if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
            if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
            if (sortConfig.key !== 'totalService') return b.totalService - a.totalService;
            return 0;
        });
        return sortableItems;
    }, [dashboardData, sortConfig, analysisSearchTerm]); 

    const requestSort = (key) => {
        let direction = 'desc'; if (sortConfig.key === key && sortConfig.direction === 'desc') direction = 'asc';
        setSortConfig({ key, direction });
    };

    const renderPositionSettingsPanel = () => (
        <div className="mb-8 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
            <button 
                onClick={() => setIsPositionsPanelOpen(!isPositionsPanelOpen)}
                className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-slate-100 transition-colors focus:outline-none"
            >
                <div className="flex items-center gap-2 font-bold text-slate-700">
                    <ShieldCheck size={18} className="text-indigo-500" />
                    崗位人數設定
                </div>
                {isPositionsPanelOpen ? <ChevronUp size={18} className="text-slate-400"/> : <ChevronDown size={18} className="text-slate-400"/>}
            </button>
            
            {isPositionsPanelOpen && (
                <div className="p-5 border-t border-slate-200 bg-white animate-fade-in space-y-4">
                    {/* 表頭區塊 */}
                    <div className="flex items-center gap-3 px-2 pb-2 border-b border-slate-100">
                        <div className="flex-1 text-[13px] font-bold text-slate-500 pl-1">崗位</div>
                        <div className="flex items-center gap-4 shrink-0 text-center pr-1">
                            <div className="w-14 text-[13px] font-bold text-slate-500">最少</div>
                            <div className="w-14 text-[13px] font-bold text-slate-500">最多</div>
                        </div>
                    </div>
                    
                    {/* 崗位清單 */}
                    <div className="space-y-3 max-h-64 overflow-y-auto custom-scrollbar px-1">
                        {editPositions.map((pos, idx) => {
                            // 隱藏固定不需調整的崗位
                            if (['司會', '執事輪值', 'PPT'].includes(pos.name)) return null;
                            
                            return (
                                <div key={pos.id || pos.temp_id} className="flex items-center gap-3">
                                    <div className="flex-1 px-3 py-2 text-sm font-bold text-slate-700 bg-slate-50 border border-slate-100 rounded-lg select-none">
                                        {pos.name}
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <input 
                                            type="number" 
                                            min="0"
                                            value={pos.min_people !== undefined ? pos.min_people : 1} 
                                            onChange={e => handlePositionChange(idx, 'min_people', e.target.value)}
                                            className="w-16 bg-white border border-slate-200 rounded-lg py-2 text-center text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 shadow-sm transition-colors"
                                        />
                                        <input 
                                            type="number" 
                                            min="1"
                                            value={pos.max_people !== undefined ? pos.max_people : 1} 
                                            onChange={e => handlePositionChange(idx, 'max_people', e.target.value)}
                                            className="w-16 bg-white border border-slate-200 rounded-lg py-2 text-center text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 shadow-sm transition-colors"
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* 儲存按鈕置底 */}
                    <div className="pt-5 border-t border-slate-100 flex justify-center">
                        <button 
                            onClick={handleSavePositions} 
                            disabled={isSavingPositions}
                            className="w-full sm:w-auto bg-slate-900 text-white px-10 py-3 rounded-xl text-sm font-medium hover:bg-slate-800 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm hover:shadow active:scale-95"
                        >
                            {isSavingPositions ? <RefreshCw className="animate-spin" size={18}/> : <Save size={18}/>}
                            儲存
                        </button>
                    </div>
                </div>
            )}
        </div>
    );

    const renderOriginalDataAnalysis = () => {
        if (!dashboardStats) return (
            <div className="h-full flex flex-col items-center justify-center p-8 text-slate-400 font-medium bg-slate-50">
                <Database size={48} className="mb-4 opacity-50 text-slate-400" />
                <p>尚無可分析的排班資料，請先至「排班作業」建立或載入班表。</p>
            </div>
        );
        return (
            <div className="h-full overflow-y-auto custom-scrollbar p-6 lg:p-8 animate-fade-in pb-20 bg-slate-50">
                <div className="flex flex-col xl:flex-row gap-6 mb-8">
                    <div className="grid grid-cols-2 gap-4 xl:w-[400px] shrink-0">
                        <StatCard compact icon={Users} title="排班總人數" value={dashboardStats.totalMembers} unit="人" iconBgClass="bg-indigo-50" iconTextClass="text-indigo-600" />
                        <StatCard compact icon={TrendingUp} title="最高服事次數" value={dashboardStats.maxService} unit="次" iconBgClass="bg-rose-50" iconTextClass="text-rose-600" />
                        <StatCard compact icon={Layers} title="平均服事次數" value={dashboardStats.avgService} unit="次/季" iconBgClass="bg-emerald-50" iconTextClass="text-emerald-600" />
                        <StatCard compact icon={CalendarDays} title="平均出席天數" value={dashboardStats.avgAttendance} unit="天/季" iconBgClass="bg-sky-50" iconTextClass="text-sky-600" />
                    </div>
                    
                    <div className="flex-1 flex flex-col sm:flex-row gap-4 overflow-hidden">
                        <div className="bg-white p-5 rounded-xl shadow-soft border border-slate-100 flex-1 flex flex-col min-h-[160px] transform hover:rotate-x-[2deg] hover:rotate-y-[-4deg] transition-transform duration-300">
                            <h4 className="text-[13px] font-bold text-slate-500 mb-3 flex items-center gap-1.5"><BarChart3 size={14} className="text-sky-500"/> 服事天數分布圖</h4>
                            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 pr-2">
                                {Object.keys(dashboardStats.attendanceDistObj).map(Number).sort((a,b)=>a-b).map(k => {
                                    const count = dashboardStats.attendanceDistObj[k];
                                    const pct = dashboardStats.maxAttCount > 0 ? (count / dashboardStats.maxAttCount) * 100 : 0;
                                    return (
                                        <div key={k} className="flex items-center gap-2">
                                            <div className="w-10 text-right font-medium text-slate-500 text-[11px] shrink-0">{k} 天</div>
                                            <div className="flex-1 flex items-center h-5">
                                                <div className="h-full bg-gradient-to-r from-sky-400 to-sky-500 rounded-r-md transition-all shadow-sm" style={{ width: `${pct}%`, minWidth: count > 0 ? '4px' : '0' }}></div>
                                                <span className="ml-2 font-bold text-slate-600 text-[11px]">{count} 人</span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                        <div className="bg-white p-5 rounded-xl shadow-soft border border-slate-100 flex-1 flex flex-col min-h-[160px] transform hover:rotate-x-[2deg] hover:rotate-y-[4deg] transition-transform duration-300">
                            <h4 className="text-[13px] font-bold text-slate-500 mb-3 flex items-center gap-1.5"><BarChart3 size={14} className="text-emerald-500"/> 服事次數分布圖</h4>
                            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 pr-2">
                                {Object.keys(dashboardStats.serviceDistObj).map(Number).sort((a,b)=>a-b).map(k => {
                                    const count = dashboardStats.serviceDistObj[k];
                                    const pct = dashboardStats.maxSrvCount > 0 ? (count / dashboardStats.maxSrvCount) * 100 : 0;
                                    return (
                                        <div key={k} className="flex items-center gap-2">
                                            <div className="w-10 text-right font-medium text-slate-500 text-[11px] shrink-0">{k} 次</div>
                                            <div className="flex-1 flex items-center h-5">
                                                <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-r-md transition-all shadow-sm" style={{ width: `${pct}%`, minWidth: count > 0 ? '4px' : '0' }}></div>
                                                <span className="ml-2 font-bold text-slate-600 text-[11px]">{count} 人</span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div className="bg-white rounded-xl shadow-soft border border-slate-100 overflow-hidden mb-8 flex flex-col max-h-[600px]">
                    <div className="p-6 lg:px-8 border-b border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sticky top-0">
                        <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2"><LayoutList className="text-indigo-600" size={20} /> 同工排班分析表</h3>
                        <div className="relative w-full sm:w-64">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input type="text" placeholder="搜尋姓名..." value={analysisSearchTerm} onChange={e => setAnalysisSearchTerm(e.target.value)} className="w-full bg-white border border-slate-200 rounded-lg pl-9 pr-8 py-2 text-sm font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all shadow-sm" />
                            {analysisSearchTerm && <button onClick={() => setAnalysisSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:bg-slate-200 rounded-lg transition-all"><X size={14} /></button>}
                        </div>
                    </div>
                    <div className="overflow-x-auto custom-scrollbar flex-1">
                        <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead className="sticky top-0 bg-white/95 backdrop-blur shadow-sm z-10">
                                <tr>
                                    <th onClick={() => requestSort('name')} className="py-4 px-4 font-medium text-slate-500 text-sm whitespace-nowrap pl-8 border-b border-slate-100 cursor-pointer hover:bg-slate-50 select-none">姓名 <ArrowUpDown size={14} className="inline ml-1 opacity-40"/></th>
                                    <th onClick={() => requestSort('totalService')} className="py-4 px-4 font-medium text-slate-500 text-sm whitespace-nowrap border-b border-slate-100 text-center cursor-pointer hover:bg-slate-50">服事次數 <ArrowUpDown size={14} className="inline ml-1 opacity-40"/></th>
                                    <th onClick={() => requestSort('attendance')} className="py-4 px-4 font-medium text-slate-500 text-sm whitespace-nowrap border-b border-slate-100 text-center cursor-pointer hover:bg-slate-50">出席天數 <ArrowUpDown size={14} className="inline ml-1 opacity-40"/></th>
                                    {dbData.positions.map(pos => (
                                        <th key={pos.id} onClick={() => requestSort(pos.name)} className="py-4 px-4 font-medium text-slate-500 text-sm whitespace-nowrap border-b border-slate-100 text-center cursor-pointer hover:bg-slate-50">{pos.name} <ArrowUpDown size={14} className="inline ml-1 opacity-40"/></th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sortedDashboardData.map((d, i) => (
                                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                                        <td className="py-3 px-4 pl-8 whitespace-nowrap"><p className="font-bold text-slate-900 text-base">{d.name}</p></td>
                                        <td className="py-3 px-4 text-center font-bold text-indigo-600 bg-indigo-50/30">{d.totalService}</td>
                                        <td className="py-3 px-4 text-center font-medium text-slate-600">{d.attendance}</td>
                                        {dbData.positions.map(pos => (
                                            <td key={pos.id} className="py-3 px-4 text-center font-normal text-slate-400">{d.roles[pos.name] || '-'}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div className="bg-white p-8 lg:p-10 rounded-xl shadow-soft border border-slate-100">
                    <h3 className="text-xl font-bold text-slate-900 mb-8">🛠️ 本季崗位需求 <span className="text-sm text-slate-500 font-medium ml-2">(合計：{dashboardStats.totalServices} 次)</span></h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
                        {Object.entries(dashboardStats.roleCounts).sort((a,b) => b[1] - a[1]).map(([role, count]) => {
                            const pct = dashboardStats.totalServices ? ((count / dashboardStats.totalServices) * 100).toFixed(1) : 0;
                            return (
                                <div key={role} className="flex items-center gap-4">
                                    <div className="w-24 text-right font-medium text-slate-700 text-sm">{role}</div>
                                    <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden flex items-center"><div className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 rounded-full transition-all duration-1000 shadow-sm" style={{ width: `${pct}%` }}></div></div>
                                    <div className="w-20 text-sm font-normal text-slate-500">{count} 次 <span className="text-[10px] opacity-60">({pct}%)</span></div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        );
    };

    const renderSchedulingView = () => {
        return (
            <div className="flex-1 flex flex-col items-center justify-start bg-slate-50 p-6 animate-fade-in overflow-y-auto">
                <div className="w-full max-w-xl bg-white p-10 lg:p-12 rounded-2xl shadow-soft border border-slate-100 relative mt-8">
                    <div className="flex bg-slate-100 p-1.5 rounded-xl mb-8">
                        <button onClick={() => setAppMode('schedule')} className={`flex-1 py-3.5 flex items-center justify-center gap-2 text-sm font-medium rounded-lg transition-all ${appMode === 'schedule' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200/50'}`}><Play size={18} /> 預排作業</button>
                        <button onClick={() => setAppMode('query')} className={`flex-1 py-3.5 flex items-center justify-center gap-2 text-sm font-medium rounded-lg transition-all ${appMode === 'query' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200/50'}`}><Search size={18} /> 編輯班表</button>
                    </div>
                    {appMode === 'schedule' ? (
                        <div className="animate-fade-in">
                            <div className="grid grid-cols-2 gap-6 mb-8">
                                <div className="space-y-2"><label className="text-xs font-medium text-slate-500 ml-2">年份</label><input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-6 py-4 font-normal text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all" /></div>
                                <div className="space-y-2"><label className="text-xs font-medium text-slate-500 ml-2">季度</label><select value={quarter} onChange={e => setQuarter(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-6 py-4 font-normal text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"><option value={1}>Q1 (1-3月)</option><option value={2}>Q2 (4-6月)</option><option value={3}>Q3 (7-9月)</option><option value={4}>Q4 (10-12月)</option></select></div>
                            </div>
                            
                            {/* --- 無所不在的崗位設定面板 --- */}
                            {renderPositionSettingsPanel()}

                            <button onClick={runAutoSchedule} disabled={isLoading} className="w-full bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white font-medium py-4 rounded-xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-button hover:-translate-y-0.5">{isLoading ? <RefreshCw className="animate-spin" /> : <><Play size={20} fill="currentColor"/> 建立新班表</>}</button>
                            {!dbData.memberQuarterSettings.some(s => s.quarter === `${year}-Q${quarter}`) && !isLoading && (
                                <p className="text-rose-500 text-[13px] font-medium text-center mt-4 flex items-center justify-center gap-1.5 animate-pulse"><AlertCircle size={16} /> 尚未建立 {year}Q{quarter} 同工資料，請至「同工資料中心」新增。</p>
                            )}
                        </div>
                    ) : (
                        <div className="animate-fade-in">
                            <div className="grid grid-cols-2 gap-6 mb-8">
                                <div className="space-y-2"><label className="text-xs font-medium text-slate-500 ml-2">年份</label><input type="number" value={queryYear} onChange={e => setQueryYear(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-6 py-4 font-normal text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all" /></div>
                                <div className="space-y-2"><label className="text-xs font-medium text-slate-500 ml-2">季度</label><select value={queryQuarter} onChange={e => setQueryQuarter(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-6 py-4 font-normal text-slate-900 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all"><option value={1}>Q1 (1-3月)</option><option value={2}>Q2 (4-6月)</option><option value={3}>Q3 (7-9月)</option><option value={4}>Q4 (10-12月)</option></select></div>
                            </div>
                            
                            {/* --- 無所不在的崗位設定面板 --- */}
                            {renderPositionSettingsPanel()}

                            <button onClick={runQuerySchedule} disabled={isLoading} className="w-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:opacity-95 disabled:from-indigo-300 disabled:to-violet-300 text-white font-medium py-4 rounded-xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-button hover:-translate-y-0.5">{isLoading ? <RefreshCw className="animate-spin" /> : <><Search size={20} strokeWidth={3}/> 開始編輯</>}</button>
                            {!hasQuerySchedule && !isLoading && (
                                <p className="text-rose-500 text-[13px] font-medium text-center mt-4 flex items-center justify-center gap-1.5 animate-pulse"><AlertCircle size={16} /> 尚未建立 {queryYear}Q{queryQuarter} 排班資料，請至「預排作業」新增。</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderRecommendationPanel = () => {
        if (!activeSlot) return null;
        return (
            <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 bg-white border-l border-slate-200 overflow-hidden h-full flex flex-col shadow-soft z-20 animate-panel-right relative">
                <div className="bg-slate-900 px-5 py-4 rounded-b-[1.25rem] shadow-sm border-b border-slate-800 relative z-20 shrink-0 overflow-hidden">
                    <div className="absolute top-[-20%] right-[-10%] w-40 h-40 rounded-full bg-violet-600/30 blur-3xl pointer-events-none"></div>
                    <button onClick={() => { setActiveSlot(null); setSearchTerm(''); setGlobalSearchTerm(''); }} className="absolute right-4 top-4 z-50 p-1.5 rounded-lg text-slate-300 transition-colors duration-75 hover:bg-white/20 hover:text-white cursor-pointer active:scale-95"><X size={18}/></button>
                    
                    <div className="flex items-center gap-2.5 relative z-10 pr-6">
                        <div className={`p-2 rounded-lg shrink-0 ${activeSlot.is_empty ? 'bg-rose-500/20 text-rose-300' : 'bg-white/10 text-indigo-300'}`}>
                            <Calendar size={22} />
                        </div>
                        <div className="flex flex-col gap-1 w-full">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[18px] font-bold text-white leading-none">{activeSlot.service_date}</p>
                                <div className="flex items-center gap-1.5">
                                    <span className={`px-3 py-1 rounded-md text-[15px] font-semibold tracking-wide leading-none ${activeSlot.is_empty ? 'bg-rose-500 text-white animate-pulse shadow-[0_0_10px_rgba(244,63,94,0.5)]' : 'bg-gradient-to-r from-indigo-500 to-violet-500 text-white'}`}>
                                        {activeSlot._memberName}
                                    </span>
                                    
                                    {!activeSlot.is_empty && activeSlot.member_id !== 'EMPTY_SLOT' && (
                                        <button 
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                const qs = dbData.memberQuarterSettings.find(s => s.member_id === activeSlot.member_id && s.quarter === currentQuarterStr) || {};
                                                const member = dbData.members.find(m => m.id === activeSlot.member_id);
                                                
                                                let safeDates = Array.isArray(qs.unavailable_dates) ? qs.unavailable_dates : (typeof qs.unavailable_dates === 'string' ? safeParseJSON(qs.unavailable_dates, []) : []);
                                                let safeUnavailableWeeks = Array.isArray(qs.unavailable_weeks) ? qs.unavailable_weeks : (typeof qs.unavailable_weeks === 'string' ? safeParseJSON(qs.unavailable_weeks, []) : []);
                                                
                                                const currentGroupID = member.group_id || '';
                                                const groupPrefix = currentGroupID.replace(/[0-9]/g, '') || 'FA'; 
                                                const groupNumberStr = currentGroupID.replace(/[^0-9]/g, ''); 
                                            
                                                const posMap = {};
                                                dbData.memberPositions.filter(mp => mp.member_id === member.id && mp.quarter === currentQuarterStr).forEach(mp => { 
                                                    posMap[mp.position_id] = mp.is_active !== false ? 'active' : 'inactive'; 
                                                });
                                            
                                                setQuickEditData({
                                                    id: member.id,
                                                    name: member.name || '',
                                                    groupPrefix: groupPrefix,
                                                    groupNumber: groupNumberStr,
                                                    positions: posMap,
                                                    preferred_session: qs.preferred_session || member.preferred_session || '第一堂',
                                                    availability_status: qs.availability_status || member.availability_status || '穩定服事',
                                                    dual_service_pref: qs.dual_service_pref ?? member.dual_service_pref ?? '',
                                                    newcomer_rule: qs.newcomer_rule ?? '', 
                                                    unavailable_dates: safeDates,
                                                    unavailable_weeks: safeUnavailableWeeks 
                                                });
                                            }}
                                            className="p-1.5 ml-1 text-indigo-200 hover:text-white hover:bg-white/20 rounded-md transition-colors active:scale-95"
                                            title="編輯當季資料"
                                        >
                                            <Edit2 size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="flex items-center gap-1.5 text-[13px] font-normal text-slate-400 flex-wrap mt-1">
                                <span className="bg-white/10 px-1.5 py-0.5 rounded text-slate-300">{activeSlot._positionName}</span>
                                {activeSlot._positionName !== '執事輪值' && <><span>•</span><span>{activeSlot.session}</span></>}
                                {!activeSlot.is_empty && (<><span>•</span><span>本季服事 {currentUsageCount[activeSlot.member_id] || 0} 次</span></>)}
                            </div>
                        </div>
                    </div>
                </div>

                {/* 搜尋過濾控制區塊 */}
                <div className="px-6 pt-5 pb-2 bg-white z-10 sticky top-0 shrink-0 border-b border-slate-100">
                    <div className="relative">
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" placeholder="搜尋推薦人選姓名或崗位" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-11 pr-10 py-2.5 text-sm font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:bg-white transition-all shadow-inner" />
                        {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:bg-slate-200 rounded-md transition-all"><X size={14} /></button>}
                    </div>
                </div>

                {/* 推薦清單與全域強制指派區塊 */}
                <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6 pt-4 space-y-5 bg-slate-50/40">
                    <div className="flex items-center justify-between px-1"><h3 className="font-bold text-slate-900 flex items-center gap-2 text-sm"><UserCheck className="text-emerald-500" size={16}/> 推薦人選 ({finalRecommendations.length})</h3><span className="text-[12px] bg-slate-100 text-slate-500 px-2 py-1 rounded-md font-medium">依本季次數排序</span></div>
                    
                    {finalRecommendations.length > 0 ? (
                        finalRecommendations.map((c, idx) => (
                            <div key={c.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm transition-all hover:shadow-soft hover:-translate-y-0.5 bg-white">
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-white shadow-sm text-xs ${idx < 3 && !searchTerm ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' : 'bg-slate-300'}`}>{idx + 1}</div>
                                    <div>
                                        <div className="flex items-center gap-2"><p className="text-lg font-bold text-slate-900">{c.name}</p></div>
                                        <div className="flex items-center gap-1.5 text-sm font-medium text-slate-600 mt-1 flex-wrap">
                                            <span className="bg-slate-100 px-1.5 py-0.5 rounded-md text-slate-700">{c.preferred_session || '皆可'}</span><span>•</span><span>本季服事 {c.usage} 次</span>
                                            {c.group_id && c.group_id.startsWith('FA') && <span className="ml-1 px-1.5 py-0.5 rounded-[4px] bg-slate-400 text-white text-xs">FA</span>}
                                            {c.group_id && c.group_id.startsWith('FB') && <span className="ml-1 px-1.5 py-0.5 rounded-[4px] bg-slate-400 text-white text-xs">FB</span>}
                                            {parseInt(c.dual_service_pref) === 1 && <span className="ml-1 px-1.5 py-0.5 rounded-[4px] bg-indigo-500 text-white text-xs">二堂同崗</span>}
                                            {parseInt(c.dual_service_pref) === 2 && <span className="ml-1 px-1.5 py-0.5 rounded-[4px] bg-violet-500 text-white text-xs">二堂異崗</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-3 pt-3 border-t border-slate-100">
                                    {c.swapOptions && c.swapOptions.length > 0 ? (
                                        <div className="space-y-2.5">
                                            <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><RefreshCw size={14} /> 雙方可以互換的班次：</p>
                                            <div className="flex flex-col gap-2">
                                                {c.swapOptions.map((swap, i) => (
                                                    <div key={i} className="flex items-center justify-between bg-indigo-50/50 text-indigo-800 px-2.5 py-1.5 rounded-lg border border-indigo-100">
                                                        <div className="text-sm font-bold text-indigo-950 flex-1">
                                                            {swap.service_date}
                                                            <span className="text-slate-600 ml-1">({swap._positionName}{swap._positionName !== '執事輪值' ? ` • ${swap.session}` : ''})</span>
                                                        </div>
                                                        <button onClick={() => requestSwap(c, swap)} className="flex items-center gap-1 bg-white text-indigo-600 hover:bg-indigo-600 hover:text-white border border-indigo-200 py-1.5 px-3 rounded-md text-[13px] font-medium transition-colors shadow-sm"><RefreshCw size={14} /> 換班</button>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 mt-1">
                                                <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><Info size={14} /> 不換班，請求支援</p>
                                                <button onClick={() => requestSubstitute(c)} className="flex items-center gap-1 bg-white text-orange-600 hover:bg-orange-500 hover:text-white border border-orange-200 py-1.5 px-3 rounded-md text-[13px] font-medium transition-colors shadow-sm"><HandHeart size={14} /> 替補</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                                            <p className="text-sm font-bold text-slate-700 flex items-center gap-1.5"><Info size={14} /> 無班可換，請求支援</p>
                                            <button onClick={() => requestSubstitute(c)} className="flex items-center gap-1 bg-white text-orange-600 hover:bg-orange-500 hover:text-white border border-orange-200 py-1.5 px-3 rounded-md text-[13px] font-medium transition-colors shadow-sm"><HandHeart size={14} /> 替補</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="p-6 text-center text-slate-400 bg-white rounded-xl border border-dashed border-slate-200 shadow-sm">
                            <UserX className="mx-auto mb-2 opacity-30" size={28} />
                            <p className="font-medium text-sm">無合適推薦人選</p>
                        </div>
                    )}

                    {/* --- 解法二：全域搜尋與強制指派 (Override) UI 機制 --- */}
                    <div className="pt-4 border-t border-slate-200">
                        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 shadow-sm">
                            <h4 className="text-sm font-bold text-orange-800 flex items-center gap-1.5 mb-2">
                                <AlertTriangle size={16} className="text-orange-600" />
                                強制人工指派 (無視排班規則限制)
                            </h4>
                            <p className="text-xs text-orange-600 mb-3 font-normal leading-relaxed">
                                無推薦人選時，搜尋全體同工進行人工指派，完全忽略請假與崗位技能
                            </p>
                            <div className="relative">
                                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-orange-400" />
                                <input 
                                    type="text" 
                                    placeholder="搜尋全體同工姓名" 
                                    value={globalSearchTerm}
                                    onChange={(e) => setGlobalSearchTerm(e.target.value)}
                                    className="w-full bg-white border border-orange-200 rounded-lg pl-9 pr-8 py-2 text-sm font-normal text-slate-900 focus:outline-none focus:ring-2 focus:ring-orange-500/30 transition-all placeholder-orange-300"
                                />
                                {globalSearchTerm && (
                                    <button onClick={() => setGlobalSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-orange-400 hover:bg-orange-100 rounded-md"><X size={14} /></button>
                                )}
                            </div>
                            
                            {/* 全域搜尋結果清單 */}
                            {globalSearchTerm && (
                                <div className="mt-3 space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar bg-white rounded-lg border border-orange-100 p-2 animate-fade-in">
                                    {effectiveMembers
                                        .filter(m => m.name && String(m.name).toLowerCase().includes(String(globalSearchTerm).toLowerCase()) && m.id !== activeSlot.member_id)
                                        .sort((a, b) => (currentUsageCount[a.id] || 0) - (currentUsageCount[b.id] || 0)) // 依照服事次數排序 (少到多)
                                        .map(m => {
                                            const usage = currentUsageCount[m.id] || 0;
                                            return (
                                                <div key={m.id} className="flex items-center justify-between bg-slate-50 hover:bg-orange-50/40 p-2 rounded border border-slate-100 transition-colors">
                                                    <div className="flex flex-col">
                                                        <span className="text-sm font-bold text-slate-800">{m.name}</span>
                                                        <span className="text-[11px] text-slate-400">本季服事 {usage} 次 ‧ {m.availability_status}</span>
                                                    </div>
                                                    <button 
                                                        onClick={() => handleOverrideAssign(m)}
                                                        className="px-3 py-1.5 bg-orange-600 text-white hover:bg-orange-700 rounded-md text-xs font-bold transition-all shadow-sm flex items-center gap-1 active:scale-95"
                                                    >
                                                        <Plus size={12} strokeWidth={3} />
                                                        強制人工指派
                                                    </button>
                                                </div>
                                            );
                                        })
                                    }
                                    {effectiveMembers.filter(m => m.name.toLowerCase().includes(globalSearchTerm.toLowerCase()) && m.id !== activeSlot.member_id).length === 0 && (
                                        <p className="text-center text-xs text-slate-400 py-3 font-medium">查無資料</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const tableData = {};
    generatedDraft.forEach(d => {
        if (!d.service_date || !d.session) return;
        const key = `${d.service_date}_${d.session}`;
        if (!tableData[key]) tableData[key] = { date: d.service_date, session: d.session, positions: {} };
        if (!tableData[key].positions[d._positionName]) tableData[key].positions[d._positionName] = [];
        tableData[key].positions[d._positionName].push(d);
    });
    
    const groupedBySession = Object.values(tableData).sort((a, b) => {
        if (!a.session || !b.session) return 0;
        return a.session !== b.session ? a.session.localeCompare(b.session) : a.date.localeCompare(b.date);
    }).reduce((acc, row) => {
        if (!acc[row.session]) acc[row.session] = []; 
        acc[row.session].push(row); 
        return acc;
    }, {});
    
    const rowsToDisplay = groupedBySession[activeSessionTab] || [];

    const getTagClass = (item) => {
        let cls = `name-tag ${activeSlot?.temp_id === item.temp_id ? 'active' : ''}`;
        if (item.is_empty) return cls + ' empty-slot';
        if (item._positionName !== '執事輪值') {
            if (conflictIds.has(item.temp_id)) return cls + ' conflict';
            if (orphanIds.has(item.temp_id)) return cls + ' orphan';
        }
        if (item.is_emergency) return cls + ' emergency';
        return cls;
    };

    const ScheduleCell = ({ row, positionName, gridCols = 1 }) => {
        const items = row.positions[positionName] || [];
        const gridClass = gridCols > 1 ? `grid grid-cols-${gridCols} gap-x-2 gap-y-0.5` : 'flex flex-col gap-0';
        return (
            <td>
                <div className={`${gridClass} min-h-[34px] w-max mx-auto`}>
                    {items.map((item, i) => (
                        <div key={item.temp_id} draggable={!item.is_empty} onDragStart={(e) => handleDragStart(e, item)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, row.date, row.session, positionName, i)} onClick={() => { setActiveSlot(item); setSearchTerm(''); setGlobalSearchTerm(''); }} className={getTagClass(item)}>{item._memberName || '未知'}</div>
                    ))}
                </div>
            </td>
        );
    };

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden select-none relative">
            <div className="w-64 bg-slate-900 flex flex-col justify-between shrink-0 border-r border-slate-800 z-30">
                <div className="flex flex-col">
                    <div className="p-6 border-b border-slate-800 flex items-center gap-3 relative overflow-hidden"><div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-indigo-500/10 to-transparent pointer-events-none"></div><span className="text-white font-bold text-base tracking-wider relative z-10">TBC Serve Manager</span></div>
                    <nav className="p-4 space-y-1.5">
                        <button onClick={goBack} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-normal text-sm transition-all text-left group"><Home size={18} className="text-slate-400 group-hover:text-indigo-400 transition-colors" /><span>Home</span></button>
                        <button onClick={goToMembers} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-normal text-sm transition-all text-left group"><Users size={18} className="text-slate-400 group-hover:text-violet-400 transition-colors" /><span>同工資料中心</span></button>
                        <div className="flex items-center gap-3 px-4 py-3 bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-xl font-medium text-sm shadow-button"><Calendar size={18} /><span>排班作業中心</span></div>
                        <button onClick={goToInsights} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-normal text-sm transition-all text-left group">
                            <BarChart3 size={18} className="text-slate-400 group-hover:text-sky-400 transition-colors" />
                            <span>人力洞察中心</span>
                        </button>
                    </nav>
                </div>
                <div className="p-4 border-t border-slate-800"><button onClick={async () => { if (supabase?.auth?.signOut) { await supabase.auth.signOut(); } window.location.reload(); }} className="w-full flex items-center gap-3 px-4 py-3 text-rose-400 hover:text-rose-300 hover:bg-rose-50/10 rounded-xl font-normal text-sm transition-all text-left group"><LogOut size={18} className="text-rose-400 group-hover:translate-x-0.5 transition-transform" /><span>Sign Out</span></button></div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 relative">
                <div className="p-6 lg:px-8 lg:py-6 bg-white border-b border-slate-200 shrink-0 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 shadow-sm z-10">
                    <div className="flex flex-col justify-center">
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-extrabold text-slate-900 flex items-center gap-3 tracking-tight">
                                {schedulingPhase === 'setup' ? (<><Calendar className="text-violet-600" size={28}/> 排班作業中心</>) : (<div className="flex items-center gap-2"><button onClick={() => { setSchedulingPhase('setup'); setActiveSlot(null); setGlobalSearchTerm(''); }} className="p-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-slate-500 transition-colors" title="返回設定"><ChevronLeft size={20} /></button><span>{year}Q{quarter} {appMode === 'schedule' ? '預排預覽' : '編輯預覽'}</span></div>)}
                            </h2>
                        </div>
                        {schedulingPhase === 'editor' && (
                            <>
                                <div className="mt-3 flex flex-wrap items-center gap-6"><p className="text-slate-500 text-xs font-medium flex items-center gap-1.5"><Search size={14} className="text-indigo-500"/> 點擊姓名選擇替代人選</p><p className="text-slate-500 text-xs font-medium flex items-center gap-1.5"><GripVertical size={14} className="text-indigo-500"/> 拖曳姓名可交換位置</p></div>
                                <div className="flex gap-3 mt-2 pt-2 border-t border-slate-100 flex-wrap">
                                    <p className="text-rose-600 text-[10px] font-bold flex items-center gap-1.5 bg-rose-50 px-2 py-1 rounded"><span className="w-2 h-2 rounded-full bg-rose-500"></span> 紅色：崗位兼任</p>
                                    <p className="text-sky-600 text-[10px] font-bold flex items-center gap-1.5 bg-sky-50 px-2 py-1 rounded"><span className="w-2 h-2 rounded-full bg-sky-500"></span> 藍色：群組落單</p>
                                    {appMode === 'schedule' && <p className="text-orange-600 text-[10px] font-bold flex items-center gap-1.5 bg-orange-50 px-2 py-1 rounded"><span className="w-2 h-2 rounded-full bg-orange-500"></span> 橘色：落單自動替換 / 強制人工指派</p>}
                                </div>
                            </>
                        )}
                    </div>
                    {schedulingPhase === 'editor' && (
                        <div className="flex flex-col items-end gap-3 mt-4 xl:mt-0 w-full xl:w-auto">
                            <div className="flex items-center gap-3 flex-wrap justify-end">
                                <div className="flex bg-slate-50 p-1.5 rounded-lg w-full md:w-auto overflow-x-auto custom-scrollbar border border-slate-200">
                                    {['第一堂', '第二堂', '📊 數據分析'].map(tab => (
                                        <button key={tab} onClick={() => { setActiveSessionTab(tab); if(tab === '📊 數據分析') { setActiveSlot(null); setGlobalSearchTerm(''); } }} className={`px-5 py-2 rounded-md text-sm font-medium transition-all duration-200 whitespace-nowrap ${activeSessionTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>{tab}</button>
                                    ))}
                                    {appMode === 'schedule' && (
                                        <><div className="w-px h-6 bg-slate-200 mx-2 self-center"></div><button onClick={runAutoSchedule} disabled={isLoading} className="px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 whitespace-nowrap text-indigo-600 hover:bg-white hover:shadow-sm flex items-center gap-1.5"><RefreshCw size={16} className={isLoading ? "animate-spin" : ""} /> 重新排班</button></>
                                    )}
                                </div>
                                <div className="flex bg-slate-50 p-1.5 rounded-lg w-full md:w-auto overflow-x-auto custom-scrollbar border border-slate-200">
                                    <button 
                                        onClick={handleUndo} 
                                        disabled={undoStack.length === 0} 
                                        className="p-2 rounded-md transition-all duration-200 text-slate-600 hover:bg-white hover:shadow-sm hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:shadow-none disabled:hover:text-slate-600"
                                        title="復原 (Ctrl+Z)"
                                    >
                                        <Undo2 size={18} />
                                    </button>
                                    <button 
                                        onClick={handleRedo} 
                                        disabled={redoStack.length === 0} 
                                        className="p-2 rounded-md transition-all duration-200 text-slate-600 hover:bg-white hover:shadow-sm hover:text-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:shadow-none disabled:hover:text-slate-600"
                                        title="取消復原 (Ctrl+Y)"
                                    >
                                        <Redo2 size={18} />
                                    </button>
                                    <div className="w-px h-6 bg-slate-200 mx-2 self-center"></div>
                                    <button onClick={exportToCSV} className="px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 whitespace-nowrap text-emerald-600 hover:bg-white hover:shadow-sm flex items-center gap-1.5"><Download size={16} /> 匯出 CSV</button>
                                    <button onClick={handlePublishClick} disabled={isSaving} className="px-4 py-2 rounded-md text-sm font-medium transition-all duration-200 whitespace-nowrap bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-button hover:-translate-y-0.5 flex items-center gap-1.5 disabled:from-indigo-400 disabled:to-violet-400">{isSaving ? <RefreshCw className="animate-spin" size={16} /> : <><Save size={16}/> 發布班表</>}</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
                    <div className="flex-1 flex flex-col h-full relative overflow-hidden">
                        {schedulingPhase === 'setup' ? renderSchedulingView() : (
                            activeSessionTab === '📊 數據分析' ? renderOriginalDataAnalysis() : (
                                <div className="flex flex-col h-full bg-slate-50 relative">
                                    <div className="overflow-x-auto shadow-inner bg-slate-50/50 custom-scrollbar flex-1 p-6 relative">
                                        <table className="w-max schedule-table border-collapse min-w-full mx-auto bg-white rounded-xl overflow-hidden shadow-soft">
                                            <thead>
                                                <tr>
                                                    <th className="sticky left-0 z-20 bg-slate-100/95 backdrop-blur whitespace-nowrap text-center px-4 w-[110px] font-medium">日期</th>
                                                    {dbData.positions.map(pos => (
                                                        <th key={pos.id} className="whitespace-nowrap font-medium">{pos.name}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rowsToDisplay.length > 0 ? (
                                                    rowsToDisplay.map((row, idx) => {
                                                        const isEven = idx % 2 === 0; const rowBg = isEven ? 'bg-white' : 'bg-slate-50/50'; const stickyBg = isEven ? 'bg-white/95' : 'bg-slate-50/95';
                                                        return (
                                                            <tr key={idx} className={rowBg}>
                                                                <td className={`sticky left-0 z-10 font-medium text-slate-500 text-center whitespace-nowrap px-4 backdrop-blur-sm border-r border-slate-100 ${stickyBg}`}>{row.date}</td>
                                                                {dbData.positions.map(pos => (
                                                                    <ScheduleCell key={pos.id} row={row} positionName={pos.name} gridCols={pos.max_people > 1 ? 2 : 1} />
                                                                ))}
                                                            </tr>
                                                        );
                                                    })
                                                ) : (<tr><td colSpan={dbData.positions.length + 1} className="text-center py-16 text-slate-400 font-medium bg-white">此堂別尚無排班資料</td></tr>)}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                    {schedulingPhase === 'editor' && activeSessionTab !== '📊 數據分析' && activeSlot && renderRecommendationPanel()}
                </div>

                {errorMsg && <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-50 text-red-600 px-6 py-3 rounded-lg flex items-center gap-3 font-medium border border-red-100 shadow-xl animate-bounce"><AlertCircle size={20} /> {errorMsg}</div>}
                {showSuccessToast && <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[300] bg-emerald-50 text-emerald-600 px-8 py-5 rounded-2xl flex items-center gap-4 font-bold text-xl border-2 border-emerald-200 shadow-glow animate-pop"><CheckCircle2 size={32} className="text-emerald-500" /> {toastMessage}</div>}
                
                {/* 異動確認對話框 (整合複製文案與下載截圖功能) */}
                {confirmDialog.isOpen && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
                        <div className="bg-white rounded-2xl p-6 md:p-8 max-w-md w-full shadow-hover-soft animate-pop border border-slate-100">
                            <h3 className="text-xl font-bold text-slate-900 mb-5 flex items-center gap-2">
                                {confirmDialog.type === 'override' ? <AlertTriangle className="text-orange-500" /> : confirmDialog.type === 'swap' ? <RefreshCw className="text-indigo-500" /> : <HandHeart className="text-orange-500" />}
                                {confirmDialog.title}
                            </h3>
                            <div className="mb-5 p-4 sm:p-5 rounded-xl bg-slate-50 border border-slate-200/60 flex items-center justify-between gap-2 sm:gap-4 shadow-inner">
                                <div className="flex-1 text-center break-words"><p className="text-xs sm:text-sm font-semibold text-slate-500 mb-1.5">目前同工</p><p className="text-lg sm:text-xl font-semibold text-slate-900">{confirmDialog.currentName}</p><div className="text-sm font-bold text-slate-600 mt-2 space-y-0.5"><p className="bg-slate-200/60 rounded py-0.5 px-1 inline-block text-xs">{confirmDialog.currentDate}</p><p className="text-indigo-700 text-xs">{confirmDialog.currentRole}</p></div></div>
                                <div className="shrink-0 text-slate-300 px-1"><ArrowLeftRight size={20} className={`sm:w-6 sm:h-6 ${confirmDialog.type === 'swap' ? 'text-indigo-400' : 'text-orange-400'}`} strokeWidth={2.5} /></div>
                                <div className="flex-1 text-center break-words"><p className="text-xs sm:text-sm font-semibold text-slate-500 mb-1.5">{confirmDialog.type === 'swap' ? '換班同工' : '替補同工'}</p><p className={`text-lg sm:text-xl font-semibold ${confirmDialog.type === 'swap' ? 'text-indigo-600' : 'text-orange-600'}`}>{confirmDialog.newName}</p><div className="text-sm font-bold text-slate-600 mt-2 space-y-0.5"><p className="bg-slate-200/60 rounded py-0.5 px-1 inline-block text-xs">{confirmDialog.newDate}</p><p className="text-indigo-700 text-xs">{confirmDialog.newRole}</p></div></div>
                            </div>

                            {/* 同工與管理員專屬通訊輔助區塊 */}
                            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 mb-6 flex flex-col gap-2 shadow-sm">
                               <div className="grid grid-cols-2 gap-2">
                                    {/* 複製按鈕 */}
                                <button 
    type="button"
    onClick={() => handleCopyCoordinationText(confirmDialog.type, confirmDialog.currentName, confirmDialog.currentDate, confirmDialog.currentRole, confirmDialog.newName, confirmDialog.newDate, confirmDialog.newRole)}
    className="py-2.5 px-3 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 transition-colors active:scale-95"
>
    {/* 將 Copy 換成原本就有的 Check */}
    <Check size={14} className="text-indigo-500" />
    複製
</button>

{/* 下載按鈕 */}
<button 
    type="button"
    onClick={() => handleDownloadCapture(confirmDialog.type, confirmDialog.currentName, confirmDialog.currentDate, confirmDialog.currentRole, confirmDialog.newName, confirmDialog.newDate, confirmDialog.newRole)}
    className="py-2.5 px-3 bg-white hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 flex items-center justify-center gap-1.5 transition-colors active:scale-95"
>
    {/* 將 Camera 換成原本就有的 Download */}
    <Download size={14} className="text-violet-500" />
    截圖
</button>
                                </div>
                            </div>

                            <div className="flex gap-3">
                                <button onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })} className="flex-1 py-3 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg transition-colors text-sm">取消</button>
                                <button onClick={confirmDialog.onConfirm} className={`flex-1 py-3 px-4 font-medium text-white rounded-lg transition-all duration-200 shadow-button hover:-translate-y-0.5 active:scale-95 text-sm ${confirmDialog.type === 'override' ? 'bg-gradient-to-r from-orange-500 to-red-500' : confirmDialog.type === 'swap' ? 'bg-gradient-to-r from-indigo-600 to-violet-600' : 'bg-gradient-to-r from-orange-500 to-amber-500'}`}>確認</button>
                            </div>
                        </div>
                    </div>
                )}
                
                {publishConfirmOpen && (
                    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
                        <div className="bg-white rounded-2xl p-6 md:p-8 max-w-md w-full shadow-hover-soft animate-pop border border-slate-100">
                            <div className="flex items-center gap-3 mb-4 text-indigo-600"><AlertCircle size={28} /><h3 className="text-2xl font-bold text-slate-900">準備發布班表</h3></div>
                            <div className="mb-8 bg-slate-50 p-5 rounded-xl border border-slate-100">
                                <p className="text-slate-700 font-medium mb-3">溫馨小提醒</p><p className="text-slate-500 text-sm font-normal flex items-start gap-2"><Info size={16} className="text-emerald-500 shrink-0 mt-0.5" /><span>尚未匯出試算表檔案，請點擊「取消返回」，使用「匯出 CSV」功能，以利後續「服事表排版」。</span></p>
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setPublishConfirmOpen(false)} className="flex-1 py-3 px-4 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg transition-colors">取消返回</button>
                                <button onClick={executePublish} className="flex-1 py-3 px-4 font-medium text-white bg-gradient-to-r from-indigo-600 to-violet-600 rounded-lg transition-all duration-200 shadow-button hover:-translate-y-0.5 active:scale-95 flex items-center justify-center gap-2"><Save size={18} /> 確認發布</button>
                            </div>
                        </div>
                    </div>
                )}

                {quickEditData && (
                    <div className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
                        <div className="bg-white rounded-2xl w-full max-w-2xl shadow-hover-soft animate-pop border border-slate-100 flex flex-col max-h-[90vh]">
                            <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50 rounded-t-2xl shrink-0">
                                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                    <Edit2 size={20} className="text-indigo-600"/> 
                                    編輯同工資料
                                </h3>
                                <button onClick={() => setQuickEditData(null)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"><X size={20}/></button>
                            </div>
                            
                            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-slate-500 uppercase">姓名 <span className="text-red-500">*</span></label>
                                            <input 
                                                type="text" 
                                                value={quickEditData.name} 
                                                onChange={e => setQuickEditData({...quickEditData, name: e.target.value})} 
                                                className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 font-medium text-slate-900 transition-all" 
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-slate-500 uppercase">服事意願</label>
                                            <select 
                                                value={quickEditData.availability_status} 
                                                onChange={e => setQuickEditData({...quickEditData, availability_status: e.target.value})} 
                                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-normal text-slate-900"
                                            >
                                                <option value="穩定服事">穩定服事</option>
                                                <option value="暫停服事">暫停服事</option>
                                                <option value="安息季">安息季</option>
                                                <option value="一季一次">一季一次</option>
                                                <option value="一季三次">一季三次</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-slate-500 uppercase">堂別</label>
                                            <select 
                                                value={quickEditData.preferred_session} 
                                                onChange={e => setQuickEditData({...quickEditData, preferred_session: e.target.value})} 
                                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-normal text-slate-900"
                                            >
                                                <option value="皆可">皆可</option>
                                                <option value="第一堂">第一堂</option>
                                                <option value="第二堂">第二堂</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-slate-500 uppercase">群組 ID <span className="text-slate-400 font-normal">(選填)</span></label>
                                            <div className="flex gap-2 items-stretch">
                                                <select 
                                                    value={quickEditData.groupPrefix} 
                                                    onChange={e => setQuickEditData({...quickEditData, groupPrefix: e.target.value})} 
                                                    className="w-1/3 sm:w-1/4 bg-slate-50 border border-slate-200 rounded-lg px-2 sm:px-4 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm"
                                                >
                                                    <option value="FA">FA</option>
                                                    <option value="FB">FB</option>
                                                </select>
                                                <div className="flex-1 relative">
                                                    <input 
                                                        type="number" 
                                                        value={quickEditData.groupNumber} 
                                                        onChange={e => setQuickEditData({...quickEditData, groupNumber: e.target.value})} 
                                                        className="w-full h-full bg-slate-50 border border-slate-200 rounded-lg pl-4 pr-[4.5rem] py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm" 
                                                        placeholder="號碼" 
                                                        min="1"
                                                    />
                                                    <button 
                                                        type="button"
                                                        onClick={quickEditAutoFillNextNumber}
                                                        className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2 py-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-md text-[10px] sm:text-xs font-medium transition-colors border border-indigo-100 flex items-center gap-1 whitespace-nowrap"
                                                        title="自動帶入下一號"
                                                    >
                                                        自動編號
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-slate-500 uppercase">崗位兼任 <span className="text-slate-400 font-normal">(選填)</span></label>
                                            <select 
                                                value={quickEditData.dual_service_pref ?? ''} 
                                                onChange={e => setQuickEditData({...quickEditData, dual_service_pref: e.target.value})} 
                                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-normal text-slate-900"
                                            >
                                                <option value="">預設 (開啟兼任)</option>
                                                <option value="0">關閉兼任</option>
                                                <option value="1">二堂同崗</option>
                                                <option value="2">二堂異崗</option>
                                            </select>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-medium text-slate-500 uppercase">新朋友關懷設定 <span className="text-slate-400 font-normal">(選填)</span></label>
                                            <select 
                                                value={quickEditData.newcomer_rule ?? ''} 
                                                onChange={e => setQuickEditData({...quickEditData, newcomer_rule: e.target.value})} 
                                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-sm font-normal text-slate-900"
                                            >
                                                <option value="">預設 (正常排班)</option>
                                                <option value="1">主責</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-medium text-slate-500 uppercase flex items-center gap-1.5">不可排班周 <span className="text-slate-400 font-normal">(選填)</span></label>
                                        <div className="flex flex-wrap gap-4 mt-1 bg-slate-50 p-3 rounded-lg border border-slate-200">
                                            {[1, 2, 3, 4, 5].map(week => (
                                                <label key={week} className="flex items-center gap-2 cursor-pointer select-none">
                                                    <input 
                                                        type="checkbox" 
                                                        className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 border-slate-300 transition-all"
                                                        checked={(quickEditData.unavailable_weeks || []).includes(week)}
                                                        onChange={(e) => {
                                                            let newWeeks = [...(quickEditData.unavailable_weeks || [])];
                                                            if (e.target.checked) newWeeks.push(week);
                                                            else newWeeks = newWeeks.filter(w => w !== week);
                                                            setQuickEditData({ ...quickEditData, unavailable_weeks: newWeeks.sort() });
                                                        }}
                                                    />
                                                    <span className="text-sm font-medium text-slate-700">第 {week} 週</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="pt-2 border-t border-slate-100">
                                        <label className="text-sm font-medium text-slate-700 flex items-center gap-1.5 mb-3">
                                            <ShieldCheck size={18} className="text-indigo-500"/> 服事崗位
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {dbData.positions.map(pos => {
                                                const status = quickEditData.positions[pos.id];
                                                const isBtnActive = status === 'active';
                                                const isBtnInactive = status === 'inactive';
                                                return (
                                                    <button 
                                                        key={pos.id} 
                                                        type="button" 
                                                        onClick={() => toggleQuickEditPosition(pos.id)} 
                                                        className={`px-4 py-2 rounded-lg text-sm font-medium border-2 transition-all duration-200 flex items-center gap-1.5 hover:-translate-y-0.5 active:scale-95 ${isBtnActive ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : isBtnInactive ? 'bg-white border-slate-300 text-slate-500 border-dashed' : 'bg-slate-50 border-slate-100 text-slate-400'}`}
                                                    >
                                                        {pos.name}
                                                        {isBtnActive && <span className="w-2 h-2 rounded-full bg-indigo-500 ml-1"></span>}
                                                        {isBtnInactive && <span className="text-[10px] ml-1 opacity-60">暫停</span>}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className="pt-2 border-t border-slate-100">
                                        <label className="text-xs font-medium text-slate-500 uppercase">請假日期 (點選切換)</label>
                                        <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-2 mt-2">
                                            {utils.getSundaysInQuarter(currentQuarterStr).map(date => {
                                                const weekNum = Math.ceil(new Date(date).getDate() / 7);
                                                const isSystemBlocked = (quickEditData.unavailable_weeks || []).includes(weekNum);
                                                const isManuallyChecked = quickEditData.unavailable_dates.includes(date);
                                                const isChecked = isSystemBlocked || isManuallyChecked;
                                                const shortDate = date.split('-').slice(1).join('/');

                                                let containerClass = 'bg-white border-slate-200 hover:border-orange-200 text-slate-600';
                                                let checkColor = 'text-orange-500';

                                                if (isSystemBlocked) {
                                                    containerClass = 'bg-indigo-50 border-indigo-400 shadow-sm opacity-90 text-indigo-700 cursor-not-allowed';
                                                    checkColor = 'text-indigo-500';
                                                } else if (isManuallyChecked) {
                                                    containerClass = 'bg-orange-50 border-orange-500 shadow-sm text-orange-600';
                                                }

                                                return (
                                                    <label key={date} className={`relative flex flex-col items-center justify-center py-2.5 rounded-lg border transition-all select-none ${isSystemBlocked ? '' : 'cursor-pointer active:scale-95'} ${containerClass}`}>
                                                        <input 
                                                            type="checkbox" 
                                                            className="sr-only" 
                                                            checked={isChecked} 
                                                            onChange={(e) => {
                                                                if (isSystemBlocked) return;
                                                                let newDates = [...quickEditData.unavailable_dates];
                                                                if (e.target.checked) {
                                                                    if (!newDates.includes(date)) newDates.push(date);
                                                                } else {
                                                                    newDates = newDates.filter(d => d !== date);
                                                                }
                                                                setQuickEditData({ ...quickEditData, unavailable_dates: newDates.sort() });
                                                            }} 
                                                        />
                                                        {isChecked && <Check className={`absolute top-1 right-1 ${checkColor}`} size={14} strokeWidth={3} />}
                                                        <span className="text-sm font-bold">{shortDate}</span>
                                                        {isSystemBlocked && <span className="text-[10px] text-indigo-500 mt-0.5 leading-none">跨團隊</span>}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-4 bg-slate-50 border-t border-slate-100 flex gap-3 rounded-b-2xl shrink-0">
                                <button onClick={() => setQuickEditData(null)} className="flex-1 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-lg transition-colors">取消</button>
                                <button onClick={handleQuickEditSave} disabled={isQuickEditSaving} className="flex-[2] py-2.5 font-medium text-white bg-gradient-to-r from-indigo-600 to-violet-600 rounded-lg shadow-button hover:-translate-y-0.5 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50">
                                    {isQuickEditSaving ? <RefreshCw className="animate-spin" size={18} /> : <Save size={18}/>}
                                    儲存變更
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

window.SchedulingAndGovernance = SchedulingAndGovernance;
