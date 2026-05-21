import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
    Calendar, Play, Search, ChevronLeft, GripVertical, RefreshCw, 
    Download, Save, AlertCircle, CheckCircle2, HeartPulse, Activity, 
    Layers, ShieldAlert, UserCog, BarChart3, Info, HandHeart, 
    ArrowLeftRight, Users, TrendingUp, CalendarDays, GitBranch, 
    Lightbulb, UserCheck, UserX, LayoutList, 
    ArrowUpDown, X, Database, AlertTriangle,
    Home, LogOut
} from 'lucide-react';

const safeParseJSON = (data, fallback) => {
    if (!data) return fallback;
    if (typeof data !== 'string') return data;
    try { return JSON.parse(data); } catch (e) { return fallback; }
};

const SchedulingAndGovernance = ({ session, goBack, goToMembers, supabase, utils, constants, StatCard }) => {
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
    
    const [activeSlot, setActiveSlot] = useState(null); 
    const [searchTerm, setSearchTerm] = useState('');
    const [analysisSearchTerm, setAnalysisSearchTerm] = useState(''); 
    const [draggedItem, setDraggedItem] = useState(null);
    const [confirmDialog, setConfirmDialog] = useState({ isOpen: false, title: '', currentName: '', currentDate: '', currentRole: '', newName: '', newDate: '', newRole: '', type: '', onConfirm: null });
    const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [sortConfig, setSortConfig] = useState({ key: 'totalService', direction: 'desc' });
    const [hasQuerySchedule, setHasQuerySchedule] = useState(true); 

    useEffect(() => { 
        const fetchInitialData = async () => {
            setIsLoading(true);
            try {
                const currentQuarterStr = `${year}-Q${quarter}`;
                const [{ data: members }, { data: positions }, { data: memberPositions }, { data: quarterSettings }] = await Promise.all([
                    fetchAllData(() => supabase.from('members').select('*')),
                    fetchAllData(() => supabase.from('positions').select('*')),
                    fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', currentQuarterStr)),
                    fetchAllData(() => supabase.from('member_quarter_settings').select('*').in('quarter', [currentQuarterStr, 'SYSTEM']))
                ]);
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
        const checkScheduleExists = async () => {
            if (appMode !== 'query') return;
            try {
                const { data: memData } = await supabase.from('members').select('id').eq('name', 'SYSTEM_SCHEDULE_ARCHIVE').limit(1);
                if (memData && memData.length > 0) {
                    const targetQ = `${queryYear}-Q${queryQuarter}`;
                    const { data } = await supabase.from('member_quarter_settings').select('id').eq('member_id', memData[0].id).eq('quarter', targetQ).limit(1);
                    setHasQuerySchedule(data && data.length > 0);
                } else {
                    setHasQuerySchedule(false);
                }
            } catch (e) { setHasQuerySchedule(true); }
        };
        checkScheduleExists();
    }, [queryYear, queryQuarter, appMode]);

    const currentQuarterStr = `${year}-Q${quarter}`;

    const effectiveMembers = useMemo(() => {
        return dbData.members
            .filter(m => m.name !== 'SYSTEM_CUSTOM_HOLIDAYS_DB' && m.name !== 'SYSTEM_SCHEDULE_ARCHIVE')
            .map(m => {
                const qs = dbData.memberQuarterSettings.find(s => s.member_id === m.id && s.quarter === currentQuarterStr);
                return {
                    ...m,
                    availability_status: qs?.availability_status || m.availability_status || '可排班',
                    preferred_session: qs?.preferred_session || m.preferred_session || '皆可',
                    dual_service_pref: parseInt(qs?.dual_service_pref ?? m.dual_service_pref ?? 0, 10),
                    unavailable_dates: qs?.unavailable_dates ? safeParseJSON(qs.unavailable_dates, []) : (m.unavailable_dates || [])
                };
            });
    }, [dbData.members, dbData.memberQuarterSettings, currentQuarterStr]);

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
            
            const [{ data: mData }, { data: pData }, { data: mpData }, { data: qsData }] = await Promise.all([
                fetchAllData(() => supabase.from('members').select('*')),
                fetchAllData(() => supabase.from('positions').select('*')),
                fetchAllData(() => supabase.from('member_positions').select('*').eq('quarter', targetQuarter)),
                fetchAllData(() => supabase.from('member_quarter_settings').select('*').in('quarter', [targetQuarter, 'SYSTEM']))
            ]);

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
            const roleLimits = { '司會': 1, 'PPT': 1, '主餐': 2, '收奉獻': 2, '接待': 2, '新朋友關懷': 2, '執事輪值': 1 };

            sundays.forEach(sunday => {
                const dateStr = window.ScheduleEngine ? window.ScheduleEngine.formatDate(sunday) : sunday.toISOString().split('T')[0];
                sessionsToSchedule.forEach(session => {
                    (pData || []).forEach(pos => {
                        const posName = (pos.name || '').trim();
                        if (!['司會', 'PPT', '主餐', '收奉獻', '接待', '新朋友關懷', '執事輪值'].includes(posName)) return;
                        if (posName === '主餐' && sunday.getDate() > 7) return; 

                        const maxPeople = pos.max_people || roleLimits[posName] || 1;
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

    const handleDragStart = useCallback((e, item) => { setDraggedItem(item); e.currentTarget.classList.add('dragging'); }, []);
    const handleDragEnd = useCallback((e) => { e.currentTarget.classList.remove('dragging'); setDraggedItem(null); }, []);
    const handleDrop = useCallback((e, targetDate, targetSession, targetPosName, targetIdx) => {
        e.preventDefault();
        if (!draggedItem) return;
        if (draggedItem.service_date !== targetDate || draggedItem.session !== targetSession || draggedItem._positionName !== targetPosName) return;
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
        setGeneratedDraft(prev => prev.map(d => {
            if (activeSlot._positionName === '執事輪值' && d.service_date === activeSlot.service_date && d._positionName === '執事輪值' && d.member_id === activeSlot.member_id) {
                return { ...d, member_id: newMember.id, _memberName: newMember.name, is_empty: false, is_emergency: 0 };
            }
            if (d.temp_id === activeSlot.temp_id) return { ...d, member_id: newMember.id, _memberName: newMember.name, is_empty: false, is_emergency: 0 };
            return d;
        }));
        setActiveSlot(null); setSearchTerm('');
    };

    const handleSwap = (newMember, targetShift) => {
        if (!activeSlot || !newMember || !targetShift) return;
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
        setActiveSlot(null); setSearchTerm('');
    };

    const requestSubstitute = (newMember) => {
        const sessionText = activeSlot._positionName === '執事輪值' ? '第一堂、第二堂' : activeSlot.session;
        const cDate = activeSlot.service_date.replace(/-/g,'/');
        const cRole = `${sessionText}‧${activeSlot._positionName}`;
        setConfirmDialog({
            isOpen: true, title: '執行替補', currentName: activeSlot._memberName, currentDate: cDate, currentRole: cRole,
            newName: newMember.name, newDate: cDate, newRole: cRole, type: 'substitute',
            onConfirm: () => { handleSubstitute(newMember); setConfirmDialog(prev => ({ ...prev, isOpen: false })); }
        });
    };

    const requestSwap = (newMember, targetShift) => {
        const sessionText = activeSlot._positionName === '執事輪值' ? '第一堂、第二堂' : activeSlot.session;
        const cDate = activeSlot.service_date.replace(/-/g,'/');
        const cRole = `${sessionText}‧${activeSlot._positionName}`;
        const targetSessionText = targetShift._positionName === '執事輪值' ? '第一堂、第二堂' : targetShift.session;
        const nDate = targetShift.service_date.replace(/-/g,'/');
        const nRole = `${targetSessionText}‧${targetShift._positionName}`;
        setConfirmDialog({
            isOpen: true, title: '執行換班', currentName: activeSlot._memberName, currentDate: cDate, currentRole: cRole,
            newName: newMember.name, newDate: nDate, newRole: nRole, type: 'swap',
            onConfirm: () => { handleSwap(newMember, targetShift); setConfirmDialog(prev => ({ ...prev, isOpen: false })); }
        });
    };

    const recommendations = useMemo(() => {
        if (!activeSlot) return [];
        const { service_date, session, position_id, member_id } = activeSlot;
        const eligibleIds = effectiveMemberPositions.filter(mp => mp.position_id === position_id).map(mp => mp.member_id);
        const requesterPositions = effectiveMemberPositions.filter(mp => mp.member_id === member_id).map(mp => mp.position_id);
        const todayStr = window.ScheduleEngine ? window.ScheduleEngine.formatDate(new Date()) : new Date().toISOString().split('T')[0];

        let filtered = effectiveMembers.filter(m => {
            if (m.id === member_id) return false;
            if (!eligibleIds.includes(m.id)) return false;
            const status = (m.availability_status || '').trim();
            if (status === '暫停服事' || status === '安息季') return false;
            if (m.unavailable_dates && m.unavailable_dates.includes(service_date)) return false;
            
            const mShiftsToday = generatedDraft.filter(d => d.service_date === service_date && d.member_id === m.id);
            const activeRole = activeSlot._positionName;

            if (activeRole === '執事輪值') {
                if (mShiftsToday.some(d => d._positionName === '執事輪值')) return false;
            } else {
                const shiftsThisSession = mShiftsToday.filter(d => d.session === session);
                if (shiftsThisSession.length > 0) {
                    const concurrentRoles = ['接待', '收奉獻', '主餐', '新朋友關懷'];
                    const allExistingAreConcurrent = shiftsThisSession.every(d => concurrentRoles.includes(d._positionName));
                    const isActiveConcurrent = concurrentRoles.includes(activeRole);
                    if (!allExistingAreConcurrent || !isActiveConcurrent) return false;
                    if (shiftsThisSession.some(d => d._positionName === activeRole)) return false;
                }
                const shiftsOtherSession = mShiftsToday.filter(d => d.session !== session);
                const dualPref = m.dual_service_pref || 0;
                if (shiftsOtherSession.length > 0) {
                    if (dualPref === 0) return false; 
                    const otherRoles = shiftsOtherSession.map(d => d._positionName);
                    if (dualPref === 1 && !otherRoles.includes(activeRole)) return false; 
                    if (dualPref === 2 && otherRoles.includes(activeRole)) return false;  
                } else {
                    if (dualPref === 0 && m.preferred_session && m.preferred_session !== '皆可') {
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
        const hasEmpty = generatedDraft.some(d => d.is_empty);
        if (hasEmpty) { setErrorMsg('還有「⚠️ 人工指派」的空缺未填補，完成後再發布。'); return; }
        setPublishConfirmOpen(true);
    };

    const executePublish = async () => {
        setPublishConfirmOpen(false); setIsSaving(true);
        try {
            const archiveName = 'SYSTEM_SCHEDULE_ARCHIVE';
            let archiveMem = dbData.members.find(m => m.name === archiveName);
            if (!archiveMem) {
                const { data: newMem, error: insErr } = await supabase.from('members').insert({ name: archiveName }).select();
                if (insErr) throw insErr;
                archiveMem = newMem[0];
            }

            const scheduleData = generatedDraft.filter(d => !d.is_empty).map(d => ({
                d: d.service_date, s: d.session, p: d._positionName, m: d.member_id
            }));

            const { error: qsErr = null } = await supabase.from('member_quarter_settings').upsert({
                member_id: archiveMem.id, quarter: `${year}-Q${quarter}`, unavailable_dates: scheduleData, availability_status: '系統備份檔'
            }, { onConflict: 'member_id, quarter' });

            if (qsErr) throw qsErr;

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
            tableData[key].positions[d._positionName].push(d.is_empty ? '⚠️空缺' : (d._memberName || '未知'));
        });
        const sortedRows = Object.values(tableData).sort((a, b) => a.date !== b.date ? a.date.localeCompare(b.date) : (a.session === '第一堂' ? -1 : 1));
        let csvContent = '\uFEFF日期,堂別,司會,執事,接待,收奉獻,主餐,PPT,新朋友關懷\n';
        sortedRows.forEach(row => {
            const r = [
                row.date, row.session,
                (row.positions['司會'] || []).join('、'), (row.positions['執事輪值'] || []).join('、'),
                (row.positions['接待'] || []).join('、'), (row.positions['收奉獻'] || []).join('、'),
                (row.positions['主餐'] || []).join('、'), (row.positions['PPT'] || []).join('、'),
                (row.positions['新朋友關懷'] || []).join('、')
            ];
            csvContent += r.map(v => `"${v}"`).join(',') + '\n';
        });
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `TBC_排班表_${year}Q${quarter}.csv`;
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

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
                        <div key={item.temp_id} draggable={!item.is_empty} onDragStart={(e) => handleDragStart(e, item)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleDrop(e, row.date, row.session, positionName, i)} onClick={() => { setActiveSlot(item); setSearchTerm(''); }} className={getTagClass(item)}>
                            {item._memberName || '未知'}
                        </div>
                    ))}
                </div>
            </td>
        );
    };

    return (
        <div className="flex h-screen w-full bg-slate-50 overflow-hidden select-none">
            {/* 左側整合式現代功能導覽列 */}
            <div className="w-64 bg-white flex flex-col justify-between shrink-0 border-r border-slate-200 z-30 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
                <div className="flex flex-col">
                    {/* 系統識別標誌 */}
                    <div className="p-6 border-b border-slate-100 flex items-center gap-3">
                        <span className="text-slate-900 font-black text-base tracking-wider">TBC Serve Manager</span>
                    </div>
                    
                    {/* 功能導航項目 */}
                    <nav className="p-4 space-y-1.5">
                        <button onClick={goBack} className="w-full flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-xl font-bold text-sm transition-all text-left group">
                            <Home size={18} className="text-slate-400 group-hover:text-indigo-600 transition-colors" />
                            <span>Home</span>
                        </button>
                        <button onClick={goToMembers} className="w-full flex items-center gap-3 px-4 py-3 text-slate-500 hover:text-slate-900 hover:bg-slate-50 rounded-xl font-bold text-sm transition-all text-left group">
                            <Users size={18} className="text-slate-400 group-hover:text-indigo-600 transition-colors" />
                            <span>同工資料中心</span>
                        </button>
                        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl font-black text-sm shadow-lg shadow-indigo-600/10">
                            <Calendar size={18} />
                            <span>排班作業中心</span>
                        </div>
                    </nav>
                </div>
                
                {/* 底部安全登出按鈕 */}
                <div className="p-4 border-t border-slate-100">
                    <button 
                        onClick={async () => { 
                            if (supabase?.auth?.signOut) { await supabase.auth.signOut(); } 
                            window.location.reload(); 
                        }} 
                        className="w-full flex items-center gap-3 px-4 py-3 text-rose-500 hover:text-rose-600 hover:bg-rose-50 rounded-xl font-bold text-sm transition-all text-left group"
                    >
                        <LogOut size={18} className="text-rose-400 group-hover:translate-x-0.5 transition-transform" />
                        <span>Sign Out</span>
                    </button>
                </div>
            </div>

            {/* 右側主工作視窗容器 */}
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 relative">
                {/* Header Area */}
                <div className="p-6 lg:px-8 lg:py-6 bg-white border-b border-slate-200 shrink-0 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 shadow-sm z-10">
                    <div className="flex flex-col justify-center">
                        <div className="flex items-center gap-3">
                            <h2 className="text-2xl font-black text-slate-900 flex items-center gap-3 tracking-tight">
                                {schedulingPhase === 'setup' ? (
                                    <>
                                        <Calendar className="text-emerald-500" size={28}/> 排班作業中心
                                    </>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => { setSchedulingPhase('setup'); setActiveSlot(null); }} className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-500 transition-colors" title="返回設定"><ChevronLeft size={20} /></button>
                                        <span>{year}Q{quarter} {appMode === 'schedule' ? '預排預覽' : '編輯預覽'}</span>
                                    </div>
                                )}
                            </h2>
                        </div>
                        {schedulingPhase === 'editor' && (
                            <>
                                <div className="mt-3 flex flex-wrap items-center gap-6">
                                    <p className="text-slate-500 text-xs font-bold flex items-center gap-1.5"><Search size={14} className="text-indigo-500"/> 點擊姓名選擇替代人選</p>
                                    <p className="text-slate-500 text-xs font-bold flex items-center gap-1.5"><GripVertical size={14} className="text-indigo-500"/> 拖曳姓名可交換位置</p>
                                </div>
                                <div className="flex gap-3 mt-2 pt-2 border-t border-slate-100 flex-wrap">
                                    <p className="text-rose-600 text-[10px] font-black flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500"></span> 紅色：崗位兼任</p>
                                    <p className="text-sky-600 text-[10px] font-black flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-sky-500"></span> 藍色：群組落單</p>
                                    {appMode === 'schedule' && <p className="text-orange-600 text-[10px] font-black flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-500"></span> 橘色：落單自動替換</p>}
                                </div>
                            </>
                        )}
                    </div>
                    {schedulingPhase === 'editor' && (
                        <div className="flex flex-col items-end gap-3 mt-4 xl:mt-0 w-full xl:w-auto">
                            <div className="flex items-center gap-3 flex-wrap justify-end">
                                <div className="flex bg-slate-100 p-1.5 rounded-2xl w-full md:w-auto overflow-x-auto custom-scrollbar shadow-inner border border-slate-200">
                                    {['第一堂', '第二堂', '📊 數據分析'].map(tab => (
                                        <button key={tab} onClick={() => { setActiveSessionTab(tab); if(tab === '📊 數據分析') setActiveSlot(null); }} className={`px-5 py-2 rounded-xl text-sm font-black transition-all whitespace-nowrap ${activeSessionTab === tab ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}>{tab}</button>
                                    ))}
                                    {appMode === 'schedule' && (
                                        <>
                                            <div className="w-px h-6 bg-slate-300 mx-2 self-center"></div>
                                            <button onClick={runAutoSchedule} disabled={isLoading} className="px-4 py-2 rounded-xl text-sm font-black transition-all whitespace-nowrap text-indigo-600 hover:bg-white hover:shadow-sm flex items-center gap-1.5"><RefreshCw size={16} className={isLoading ? "animate-spin" : ""} /> 重新排班</button>
                                        </>
                                    )}
                                </div>
                                <div className="flex bg-slate-100 p-1.5 rounded-2xl w-full md:w-auto overflow-x-auto custom-scrollbar shadow-inner border border-slate-200">
                                    <button onClick={exportToCSV} className="px-4 py-2 rounded-xl text-sm font-black transition-all whitespace-nowrap text-emerald-600 hover:bg-white hover:shadow-sm flex items-center gap-1.5"><Download size={16} /> 匯出 CSV</button>
                                    <button onClick={handlePublishClick} disabled={isSaving} className="px-4 py-2 rounded-xl text-sm font-black transition-all whitespace-nowrap bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm flex items-center gap-1.5 disabled:bg-indigo-400">{isSaving ? <RefreshCw className="animate-spin" size={16} /> : <><Save size={16}/> 發布班表</>}</button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                
                {/* Main Content Area */}
                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden relative">
                    <div className="flex-1 flex flex-col h-full relative overflow-hidden">
                        {schedulingPhase === 'setup' ? renderSchedulingView() : (
                            activeSessionTab === '📊 數據分析' ? renderOriginalDataAnalysis() : (
                                <div className="flex flex-col h-full bg-slate-50 relative">
                                    <div className="overflow-x-auto shadow-inner bg-slate-50/50 custom-scrollbar flex-1 p-6 relative">
                                        <table className="w-max schedule-table border-collapse min-w-full mx-auto bg-white rounded-2xl overflow-hidden shadow-sm">
                                            <thead>
                                                <tr>
                                                    <th className="sticky left-0 z-20 bg-slate-200/95 backdrop-blur whitespace-nowrap text-center px-4 w-[110px]">日期</th>
                                                    <th className="whitespace-nowrap">司會</th><th className="whitespace-nowrap">執事</th><th className="whitespace-nowrap">接待</th>
                                                    <th className="whitespace-nowrap">收奉獻</th><th className="whitespace-nowrap">主餐</th><th className="whitespace-nowrap">PPT</th><th className="whitespace-nowrap">新朋友關懷</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {rowsToDisplay.length > 0 ? (
                                                    rowsToDisplay.map((row, idx) => {
                                                        const isEven = idx % 2 === 0; const rowBg = isEven ? 'bg-white' : 'bg-slate-50/50'; const stickyBg = isEven ? 'bg-white/95' : 'bg-slate-50/95';
                                                        return (
                                                            <tr key={idx} className={rowBg}>
                                                                <td className={`sticky left-0 z-10 font-bold text-slate-500 text-center whitespace-nowrap px-4 backdrop-blur-sm border-r border-slate-100 ${stickyBg}`}>{row.date}</td>
                                                                <ScheduleCell row={row} positionName="司會" /><ScheduleCell row={row} positionName="執事輪值" /><ScheduleCell row={row} positionName="接待" gridCols={2} />
                                                                <ScheduleCell row={row} positionName="收奉獻" gridCols={2} /><ScheduleCell row={row} positionName="主餐" gridCols={2} /><ScheduleCell row={row} positionName="PPT" /><ScheduleCell row={row} positionName="新朋友關懷" gridCols={2} />
                                                            </tr>
                                                        );
                                                    })
                                                ) : (<tr><td colSpan="8" className="text-center py-16 text-slate-400 font-bold bg-white">此堂別尚無排班資料</td></tr>)}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            )
                        )}
                    </div>
                    {schedulingPhase === 'editor' && activeSessionTab !== '📊 數據分析' && activeSlot && renderRecommendationPanel()}
                </div>

                {/* Modals & Toasts */}
                {errorMsg && <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-red-50 text-red-600 px-6 py-3 rounded-2xl flex items-center gap-3 font-bold border border-red-100 shadow-xl animate-bounce"><AlertCircle size={20} /> {errorMsg}</div>}
                {showSuccessToast && <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[200] bg-emerald-50 text-emerald-600 px-8 py-5 rounded-3xl flex items-center gap-4 font-black text-xl border-2 border-emerald-200 shadow-[0_20px_50px_rgba(0,0,0,0.15)] animate-pop"><CheckCircle2 size={32} className="text-emerald-500" /> 發布成功</div>}
                
                {confirmDialog.isOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
                        <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl animate-pop border border-slate-100">
                            <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">{confirmDialog.type === 'swap' ? <RefreshCw className="text-indigo-500" /> : <HandHeart className="text-orange-500" />}{confirmDialog.title}</h3>
                            <div className="mb-8 p-4 sm:p-5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-2 sm:gap-4 shadow-inner">
                                <div className="flex-1 text-center break-words"><p className="text-[10px] font-bold text-slate-400 mb-1.5">目前同工</p><p className="text-sm sm:text-base font-black text-slate-700">{confirmDialog.currentName}</p><div className="text-[10px] sm:text-[11px] text-slate-500 mt-1 leading-snug"><p>{confirmDialog.currentDate}</p><p>{confirmDialog.currentRole}</p></div></div>
                                <div className="shrink-0 text-slate-300 px-1"><ArrowLeftRight size={20} className={`sm:w-6 sm:h-6 ${confirmDialog.type === 'swap' ? 'text-indigo-400' : 'text-orange-400'}`} strokeWidth={2.5} /></div>
                                <div className="flex-1 text-center break-words"><p className="text-[10px] font-bold text-slate-400 mb-1.5">替換同工</p><p className={`text-sm sm:text-base font-black ${confirmDialog.type === 'swap' ? 'text-indigo-600' : 'text-orange-600'}`}>{confirmDialog.newName}</p><div className="text-[10px] sm:text-[11px] text-slate-500 mt-1 leading-snug"><p>{confirmDialog.newDate}</p><p>{confirmDialog.newRole}</p></div></div>
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })} className="flex-1 py-3.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black rounded-xl transition-all">取消</button>
                                <button onClick={confirmDialog.onConfirm} className={`flex-1 py-3.5 px-4 font-black text-white rounded-xl transition-all shadow-lg active:scale-95 ${confirmDialog.type === 'swap' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200' : 'bg-orange-500 hover:bg-orange-600 shadow-orange-200'}`}>確認執行</button>
                            </div>
                        </div>
                    </div>
                )}
                
                {publishConfirmOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4 animate-fade-in">
                        <div className="bg-white rounded-3xl p-6 md:p-8 max-w-md w-full shadow-2xl animate-pop border border-slate-100">
                            <div className="flex items-center gap-3 mb-4 text-indigo-600"><AlertCircle size={28} /><h3 className="text-2xl font-black text-slate-800">準備發布班表</h3></div>
                            <div className="mb-8 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                                <p className="text-slate-600 font-bold mb-3">溫馨小提醒</p><p className="text-slate-500 text-sm font-bold flex items-start gap-2"><Info size={16} className="text-emerald-500 shrink-0 mt-0.5" /><span>尚未匯出試算表檔案，請點擊「取消返回」，使用「匯出 CSV」功能，以利後續「服事表排版」。</span></p>
                            </div>
                            <div className="flex gap-3">
                                <button onClick={() => setPublishConfirmOpen(false)} className="flex-1 py-3.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black rounded-xl transition-all">取消返回</button>
                                <button onClick={executePublish} className="flex-1 py-3.5 px-4 font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-lg shadow-indigo-200 active:scale-95 flex items-center justify-center gap-2"><Save size={18} /> 確認發布</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

window.SchedulingAndGovernance = SchedulingAndGovernance;
