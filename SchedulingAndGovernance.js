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

// 安全的 JSON 解析函數，防止資料庫格式錯誤導致白畫面
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
    const [selectedPersonalStats, setSelectedPersonalStats] = useState(null);
    const [hasQuerySchedule, setHasQuerySchedule] = useState(true); 

    // 初始化載入
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

    // 檢查目標季度是否有備份檔
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

    // 資料梳理：過濾系統假帳號並整合設定
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

    // 啟動排班引擎
    const runAutoSchedule = () => {
        const targetQuarterStr = `${year}-Q${quarter}`;
        const hasQuarterData = dbData.memberQuarterSettings.some(s => s.quarter === targetQuarterStr);
        if (!hasQuarterData) { setErrorMsg(`⚠️ 請先至首頁「同工資料中心」建立【${targetQuarterStr.replace('-','')}】的季度資料，再進行預排！`); return; }

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
            } catch (e) { setErrorMsg('自動排班引擎執行失敗，請確認已載入排班引擎腳本。'); } 
            finally { setIsLoading(false); }
        }, 300);
    };

    // 查詢並解壓縮歷史班表
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
                                _memberName: '⚠️ 需手動指派', _positionName: posName, is_empty: true
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
        if (hasEmpty) { setErrorMsg('還有「⚠️ 需手動指派」的空缺未填補，請點擊並指派人員後再發布。'); return; }
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

    const dashboardData = useMemo(() => {
        const memberStats = {};
        effectiveMembers.forEach(m => {
            const status = (m.availability_status || '').trim();
            if (status === '暫停服事' || status === '安息季') return;
            memberStats[m.id] = { id: m.id, name: m.name, group: m.group_id, totalService: 0, attendanceDates: new Set(), roles: { '司會': 0, '執事輪值': 0, '接待': 0, '收奉獻': 0, '主餐': 0, 'PPT': 0, '新朋友關懷': 0 } };
        });
        generatedDraft.forEach(d => {
            if (d.is_empty || !memberStats[d.member_id]) return;
            const stats = memberStats[d.member_id];
            if(d.service_date) stats.attendanceDates.add(d.service_date);
            stats.totalService += 1;
            if (d._positionName && stats.roles[d._positionName] !== undefined) stats.roles[d._positionName] += 1;
        });
        return Object.values(memberStats).map(d => {
            return { ...d, attendance: d.attendanceDates.size, distinctRolesCount: Object.values(d.roles).filter(c => c > 0).length, healthScore: 0 };
        }); 
    }, [generatedDraft, effectiveMembers]);

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

    const renderOriginalDataAnalysis = () => {
        if (!dashboardStats) return (
            <div className="h-full flex flex-col items-center justify-center p-8 text-slate-400 font-bold bg-slate-50">
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
                        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-100 flex-1 flex flex-col min-h-[160px]">
                            <h4 className="text-[13px] font-black text-slate-500 mb-3 flex items-center gap-1.5"><BarChart3 size={14} className="text-sky-500"/> 服事天數分布圖</h4>
                            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 pr-2">
                                {Object.keys(dashboardStats.attendanceDistObj).map(Number).sort((a,b)=>a-b).map(k => {
                                    const count = dashboardStats.attendanceDistObj[k];
                                    const pct = dashboardStats.maxAttCount > 0 ? (count / dashboardStats.maxAttCount) * 100 : 0;
                                    return (
                                        <div key={k} className="flex items-center gap-2">
                                            <div className="w-10 text-right font-bold text-slate-500 text-[11px] shrink-0">{k} 天</div>
                                            <div className="flex-1 flex items-center h-5">
                                                <div className="h-full bg-sky-400 rounded-r-md transition-all" style={{ width: `${pct}%`, minWidth: count > 0 ? '4px' : '0' }}></div>
                                                <span className="ml-2 font-black text-slate-600 text-[11px]">{count} 人</span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                        <div className="bg-white p-5 rounded-[2rem] shadow-sm border border-slate-100 flex-1 flex flex-col min-h-[160px]">
                            <h4 className="text-[13px] font-black text-slate-500 mb-3 flex items-center gap-1.5"><BarChart3 size={14} className="text-emerald-500"/> 服事次數分布圖</h4>
                            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5 pr-2">
                                {Object.keys(dashboardStats.serviceDistObj).map(Number).sort((a,b)=>a-b).map(k => {
                                    const count = dashboardStats.serviceDistObj[k];
                                    const pct = dashboardStats.maxSrvCount > 0 ? (count / dashboardStats.maxSrvCount) * 100 : 0;
                                    return (
                                        <div key={k} className="flex items-center gap-2">
                                            <div className="w-10 text-right font-bold text-slate-500 text-[11px] shrink-0">{k} 次</div>
                                            <div className="flex-1 flex items-center h-5">
                                                <div className="h-full bg-emerald-400 rounded-r-md transition-all" style={{ width: `${pct}%`, minWidth: count > 0 ? '4px' : '0' }}></div>
                                                <span className="ml-2 font-black text-slate-600 text-[11px]">{count} 人</span>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                </div>
                
                <div className="bg-white rounded-[2rem] shadow-sm border border-slate-100 overflow-hidden mb-8 flex flex-col max-h-[600px]">
                    <div className="p-6 lg:px-8 border-b border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4 sticky top-0">
                        <h3 className="text-lg font-black text-slate-800 flex items-center gap-2"><LayoutList className="text-indigo-500" size={20} /> 同工排班分析表</h3>
                        <div className="relative w-full sm:w-64">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input type="text" placeholder="搜尋姓名..." value={analysisSearchTerm} onChange={e => setAnalysisSearchTerm(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-8 py-2 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all shadow-sm" />
                            {analysisSearchTerm && <button onClick={() => setAnalysisSearchTerm('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:bg-slate-200 rounded-full transition-all"><X size={14} /></button>}
                        </div>
                    </div>
                    <div className="overflow-x-auto custom-scrollbar flex-1">
                        <table className="w-full text-left border-collapse min-w-[800px]">
                            <thead className="sticky top-0 bg-white/95 backdrop-blur shadow-sm z-10">
                                <tr>
                                    <th onClick={() => requestSort('name')} className="py-4 px-4 font-black text-slate-500 text-sm whitespace-nowrap pl-8 border-b border-slate-100 cursor-pointer hover:bg-slate-50 select-none">姓名 <ArrowUpDown size={14} className="inline ml-1 opacity-40"/></th>
                                    <th onClick={() => requestSort('totalService')} className="py-4 px-4 font-black text-slate-500 text-sm whitespace-nowrap border-b border-slate-100 text-center cursor-pointer hover:bg-slate-50">服事次數 <ArrowUpDown size={14} className="inline ml-1 opacity-40"/></th>
                                    <th onClick={() => requestSort('attendance')} className="py-4 px-4 font-black text-slate-500 text-sm whitespace-nowrap border-b border-slate-100 text-center cursor-pointer hover:bg-slate-50">出席天數 <ArrowUpDown size={14} className="inline ml-1 opacity-40"/></th>
                                    {['司會', '執事輪值', '接待', '收奉獻', '主餐', 'PPT', '新朋友關懷'].map(role => (
                                        <th key={role} onClick={() => requestSort(role)} className="py-4 px-4 font-black text-slate-500 text-sm whitespace-nowrap border-b border-slate-100 text-center cursor-pointer hover:bg-slate-50">{role} <ArrowUpDown size={14} className="inline ml-1 opacity-40"/></th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sortedDashboardData.map((d, i) => (
                                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                                        <td className="py-3 px-4 pl-8 whitespace-nowrap"><p className="font-black text-slate-800 text-base">{d.name}</p></td>
                                        <td className="py-3 px-4 text-center font-black text-slate-600 bg-slate-50/50">{d.totalService}</td>
                                        <td className="py-3 px-4 text-center font-bold text-slate-600">{d.attendance}</td>
                                        {['司會', '執事輪值', '接待', '收奉獻', '主餐', 'PPT', '新朋友關懷'].map(role => (
                                            <td key={role} className="py-3 px-4 text-center font-bold text-slate-400">{d.roles[role] || '-'}</td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
                <div className="bg-white p-8 lg:p-10 rounded-[2rem] shadow-sm border border-slate-100">
                    <h3 className="text-xl font-black text-slate-800 mb-8">🛠️ 本季崗位需求 <span className="text-sm text-slate-500 font-bold ml-2">(合計：{dashboardStats.totalServices} 次)</span></h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-6">
                        {Object.entries(dashboardStats.roleCounts).sort((a,b) => b[1] - a[1]).map(([role, count]) => {
                            const pct = dashboardStats.totalServices ? ((count / dashboardStats.totalServices) * 100).toFixed(1) : 0;
                            return (
                                <div key={role} className="flex items-center gap-4">
                                    <div className="w-24 text-right font-black text-slate-600 text-sm">{role}</div>
                                    <div className="flex-1 h-5 bg-slate-100 rounded-full overflow-hidden flex items-center"><div className="h-full bg-indigo-500 rounded-full transition-all duration-1000" style={{ width: `${pct}%` }}></div></div>
                                    <div className="w-20 text-sm font-bold text-slate-500">{count} 次 <span className="text-[10px] opacity-60">({pct}%)</span></div>
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
            <div className="flex-1 flex items-center justify-center bg-slate-100 p-6 animate-fade-in overflow-y-auto">
                <div className="w-full max-w-xl bg-white p-10 lg:p-12 rounded-[3rem] shadow-sm border border-slate-200 relative">
                    <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-8">
                        <button onClick={() => setAppMode('schedule')} className={`flex-1 py-3.5 flex items-center justify-center gap-2 text-sm font-black rounded-xl transition-all ${appMode === 'schedule' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200/50'}`}><Play size={18} /> 預排作業</button>
                        <button onClick={() => setAppMode('query')} className={`flex-1 py-3.5 flex items-center justify-center gap-2 text-sm font-black rounded-xl transition-all ${appMode === 'query' ? 'bg-white text-indigo-600 shadow-md' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-200/50'}`}><Search size={18} /> 編輯班表</button>
                    </div>
                    {appMode === 'schedule' ? (
                        <div className="animate-fade-in">
                            <div className="grid grid-cols-2 gap-6 mb-10">
                                <div className="space-y-2">
                                    <label className="text-xs font-black text-slate-400 ml-2">年份</label>
                                    <input type="number" value={year} onChange={e => setYear(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-3xl px-6 py-5 font-bold focus:ring-4 focus:ring-indigo-50 focus:bg-white outline-none transition-all" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-black text-slate-400 ml-2">季度</label>
                                    <select value={quarter} onChange={e => setQuarter(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-3xl px-6 py-5 font-bold focus:ring-4 focus:ring-indigo-50 focus:bg-white outline-none transition-all">
                                        <option value={1}>Q1 (1-3月)</option><option value={2}>Q2 (4-6月)</option><option value={3}>Q3 (7-9月)</option><option value={4}>Q4 (10-12月)</option>
                                    </select>
                                </div>
                            </div>
                            <button onClick={runAutoSchedule} disabled={isLoading} className="w-full bg-slate-900 hover:bg-black disabled:bg-slate-300 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl">
                                {isLoading ? <RefreshCw className="animate-spin" /> : <><Play size={20} fill="currentColor"/> 建立新班表</>}
                            </button>
                            {!dbData.memberQuarterSettings.some(s => s.quarter === `${year}-Q${quarter}`) && !isLoading && (
                                <p className="text-rose-500 text-[13px] font-bold text-center mt-4 flex items-center justify-center gap-1.5 animate-pulse">
                                    <AlertCircle size={16} /> 尚未建立 {year}Q{quarter} 同工資料，請先至首頁「同工資料中心」新增。
                                </p>
                            )}
                        </div>
                    ) : (
                        <div className="animate-fade-in">
                            <div className="grid grid-cols-2 gap-6 mb-10">
                                <div className="space-y-2">
                                    <label className="text-xs font-black text-slate-400 ml-2">年份</label>
                                    <input type="number" value={queryYear} onChange={e => setQueryYear(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-3xl px-6 py-5 font-bold focus:ring-4 focus:ring-indigo-50 focus:bg-white outline-none transition-all" />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs font-black text-slate-400 ml-2">季度</label>
                                    <select value={queryQuarter} onChange={e => setQueryQuarter(parseInt(e.target.value))} className="w-full bg-slate-50 border border-slate-200 rounded-3xl px-6 py-5 font-bold focus:ring-4 focus:ring-indigo-50 focus:bg-white outline-none transition-all">
                                        <option value={1}>Q1 (1-3月)</option><option value={2}>Q2 (4-6月)</option><option value={3}>Q3 (7-9月)</option><option value={4}>Q4 (10-12月)</option>
                                    </select>
                                </div>
                            </div>
                            <button onClick={runQuerySchedule} disabled={isLoading} className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-black py-5 rounded-2xl flex items-center justify-center gap-3 transition-all active:scale-95 shadow-xl shadow-indigo-200">
                                {isLoading ? <RefreshCw className="animate-spin" /> : <><Search size={20} strokeWidth={3}/> 開始編輯</>}
                            </button>
                            {!hasQuerySchedule && !isLoading && (
                                <p className="text-rose-500 text-[13px] font-bold text-center mt-4 flex items-center justify-center gap-1.5 animate-pulse">
                                    <AlertCircle size={16} /> 尚未建立 {queryYear}Q{queryQuarter} 排班資料，請至「預排作業」新增。
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    };

    const renderPersonalStatsPanelFixed = () => {
        if (!selectedPersonalStats || !dashboardStats) return null;
        const stats = selectedPersonalStats; 
        const adviceList = []; 
        const avg = parseFloat(dashboardStats.avgService);
        if (stats.healthStatus === 'danger') adviceList.push({ icon: ShieldAlert, color: 'text-rose-600', bg: 'bg-rose-50', title: '高風險警示', desc: `本季服事高達 ${stats.totalService} 次，顯著高於平均。建議安排安息週。` });
        else if (stats.healthStatus === 'warning') adviceList.push({ icon: AlertTriangle, color: 'text-amber-600', bg: 'bg-amber-50', title: '負荷偏高', desc: '服事頻率略高於群體平均，請留意是否需要適度替班輪休。' });
        else adviceList.push({ icon: HeartPulse, color: 'text-emerald-600', bg: 'bg-emerald-50', title: '狀態健康', desc: '目前服事負荷在健康範圍內，感謝穩定的配搭。' });
        if (stats.distinctRolesCount > 2) adviceList.push({ icon: GitBranch, color: 'text-indigo-600', bg: 'bg-indigo-50', title: '核心多工', desc: '承擔多項不同崗位，留意避免單日切換過多角色。' });
        else if (stats.distinctRolesCount === 1 && stats.totalService < avg) adviceList.push({ icon: Lightbulb, color: 'text-sky-600', bg: 'bg-sky-50', title: '成長潛力', desc: '若恩賜相符，可考慮邀請參與第二專長培術。' });
        
        const diffFromAvg = (stats.totalService - parseFloat(dashboardStats.avgService)).toFixed(1);

        return (
            <div className="h-full flex flex-col bg-white animate-fade-in overflow-hidden">
                <div className="bg-slate-900 p-6 pb-8 shrink-0">
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 flex items-center justify-center text-white text-xl font-black shadow-lg">{stats.name.charAt(0)}</div>
                        <div className="text-white">
                            <h2 className="text-xl font-black">{stats.name}</h2>
                            <p className="text-slate-400 text-xs font-bold flex items-center gap-2 mt-1">{stats.group ? <span className="bg-white/10 px-2 py-0.5 rounded text-[10px]">{stats.group}</span> : '一般同工'}<span>個人關懷儀表板</span></p>
                        </div>
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto custom-scrollbar p-6 bg-slate-50 space-y-6 -mt-4 rounded-t-3xl relative z-10 border-t border-slate-200">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 text-center">
                            <p className="text-[11px] font-bold text-slate-400 mb-1">本季服事</p><p className="text-2xl font-black text-slate-800">{stats.totalService} <span className="text-xs font-bold text-slate-400">次</span></p>
                            <p className={`text-[10px] font-bold mt-1.5 px-1.5 py-0.5 rounded inline-block ${diffFromAvg > 0 ? 'bg-rose-50 text-rose-600' : (diffFromAvg < 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500')}`}>{diffFromAvg > 0 ? `+${diffFromAvg} 高於平均` : (diffFromAvg < 0 ? `${diffFromAvg} 低於平均` : '與平均持平')}</p>
                        </div>
                        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 text-center">
                            <p className="text-[11px] font-bold text-slate-400 mb-1">出席天數</p><p className="text-2xl font-black text-slate-800">{stats.attendance} <span className="text-xs font-bold text-slate-400">天</span></p>
                            <p className="text-[10px] font-bold text-slate-400 mt-1.5">單日最高 {(stats.totalService / Math.max(1, stats.attendance)).toFixed(1)} 次</p>
                        </div>
                    </div>
                    <div>
                        <h3 className="text-xs font-black text-slate-800 mb-3 flex items-center gap-1.5"><Lightbulb size={14} className="text-amber-500"/> AI 關懷建議</h3>
                        <div className="space-y-2.5">
                            {adviceList.map((adv, idx) => (
                                <div key={idx} className={`${adv.bg} border border-white shadow-sm p-3 rounded-xl flex gap-3 items-start`}>
                                    <adv.icon className={`${adv.color} shrink-0 mt-0.5`} size={16} />
                                    <div><p className={`text-[13px] font-black ${adv.color} mb-0.5`}>{adv.title}</p><p className="text-[11px] font-bold text-slate-600 leading-relaxed">{adv.desc}</p></div>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div>
                        <h3 className="text-xs font-black text-slate-800 mb-3 flex items-center gap-1.5"><BarChart3 size={14} className="text-indigo-500"/> 崗位參與分佈</h3>
                        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 space-y-3">
                            {Object.entries(stats.roles).filter(([_, count]) => count > 0).sort((a,b)=>b[1]-a[1]).map(([role, count]) => (
                                <div key={role}>
                                    <div className="flex justify-between text-[11px] font-bold mb-1"><span className="text-slate-600">{role}</span><span className="text-indigo-600">{count} 次 <span className="text-slate-400 font-normal">({Math.round(count/stats.totalService*100)}%)</span></span></div>
                                    <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-indigo-400 rounded-full" style={{ width: `${(count/stats.totalService)*100}%` }}></div></div>
                                </div>
                            ))}
                            {stats.distinctRolesCount === 0 && <p className="text-[11px] text-slate-400 text-center py-1">本季尚無安排服事</p>}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const renderRecommendationPanel = () => {
        if (!activeSlot) return null;
        return (
            <div className="w-full lg:w-[400px] xl:w-[450px] shrink-0 bg-white border-l border-slate-200 overflow-hidden h-full flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.02)] z-20 animate-panel-right relative">
                <div className="bg-slate-900 p-6 rounded-b-[1.5rem] shadow-sm border-b border-slate-800 relative z-20 shrink-0">
                    <button onClick={() => { setActiveSlot(null); setSearchTerm(''); }} className="absolute right-5 top-5 p-2 hover:bg-white/20 rounded-full transition-all text-slate-300 hover:text-white"><X size={20}/></button>
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 mt-1">幫此服事找合適人選：</h3>
                    <div className="flex items-start gap-3">
                        <div className={`p-3 rounded-2xl ${activeSlot.is_empty ? 'bg-rose-500/20 text-rose-300' : 'bg-white/10 text-indigo-300'}`}><Calendar size={24} /></div>
                        <div className="flex flex-col gap-1.5">
                            <p className="text-xl font-black text-white">{activeSlot.service_date}</p>
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded-md text-sm font-black ${activeSlot.is_empty ? 'bg-rose-500 text-white animate-pulse' : 'bg-indigo-500 text-white'}`}>{activeSlot._memberName}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 flex-wrap mt-1">
                                <span className="bg-white/10 px-1.5 py-0.5 rounded text-slate-300">{activeSlot._positionName}</span>
                                <span>•</span>
                                <span>{activeSlot._positionName === '執事輪值' ? '第一堂、第二堂' : activeSlot.session}</span>
                                {!activeSlot.is_empty && (
                                    <><span>•</span><span>本季服事 {currentUsageCount[activeSlot.member_id] || 0} 次</span></>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="px-6 pt-5 pb-2 bg-white z-10 sticky top-0 shrink-0">
                    <div className="relative">
                        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="text" placeholder="搜尋姓名或崗位" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-11 pr-10 py-2.5 text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:bg-white transition-all shadow-inner" />
                        {searchTerm && <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:bg-slate-200 rounded-full transition-all"><X size={14} /></button>}
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-6 pt-2 space-y-4">
                    <div className="flex items-center justify-between px-1">
                        <h3 className="font-black text-slate-700 flex items-center gap-2 text-sm"><UserCheck className="text-emerald-500" size={16}/> 推薦人選 ({finalRecommendations.length})</h3>
                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded font-bold">依本季次數排序</span>
                    </div>
                    {finalRecommendations.length > 0 ? (
                        finalRecommendations.map((c, idx) => (
                            <div key={c.id} className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm transition-all hover:shadow-md hover:border-indigo-300">
                                <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded-full flex items-center justify-center font-black text-white shadow-sm text-xs ${idx < 3 && !searchTerm ? 'bg-emerald-500' : 'bg-slate-300'}`}>{idx + 1}</div>
                                    <div>
                                        <div className="flex items-center gap-2"><p className="text-[15px] font-black text-slate-800">{c.name}</p></div>
                                        <div className="flex items-center gap-1 text-[11px] font-bold text-slate-400 mt-1 flex-wrap">
                                            <span className="bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{c.preferred_session || '皆可'}</span><span>•</span><span>本季服事 {c.usage} 次</span>
                                            {c.group_id && c.group_id.startsWith('FA') && <span className="ml-1 px-1.5 py-0.5 rounded-[4px] bg-slate-400 text-white text-[10px]">FA</span>}
                                            {c.group_id && c.group_id.startsWith('FB') && <span className="ml-1 px-1.5 py-0.5 rounded-[4px] bg-slate-400 text-white text-[10px]">FB</span>}
                                            {c.dual_service_pref === 1 && <span className="ml-1 px-1.5 py-0.5 rounded-[4px] bg-indigo-400 text-white text-[10px]">二堂同崗</span>}
                                            {c.dual_service_pref === 2 && <span className="ml-1 px-1.5 py-0.5 rounded-[4px] bg-purple-400 text-white text-[10px]">二堂異崗</span>}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-3 pt-3 border-t border-slate-100">
                                    {c.swapOptions && c.swapOptions.length > 0 ? (
                                        <div className="space-y-2.5">
                                            <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1"><RefreshCw size={10} /> 雙方可以互換的班次：</p>
                                            <div className="flex flex-col gap-2">
                                                {c.swapOptions.map((swap, i) => (
                                                    <div key={i} className="flex items-center justify-between bg-indigo-50/50 text-indigo-800 px-2.5 py-1.5 rounded-lg border border-indigo-100">
                                                        <div className="text-[11px] font-bold text-indigo-900">{swap.service_date}<span className="opacity-70 ml-1">({swap._positionName} • {swap.session})</span></div>
                                                        <button onClick={() => requestSwap(c, swap)} className="flex items-center gap-1 bg-white text-indigo-600 hover:bg-indigo-600 hover:text-white border border-indigo-200 px-2 py-1 rounded-md text-[10px] font-bold transition-all shadow-sm"><RefreshCw size={10} /> 換班</button>
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200 mt-1">
                                                <p className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5"><Info size={10} /> 不換班，請求支援</p>
                                                <button onClick={() => requestSubstitute(c)} className="flex items-center gap-1 bg-white text-orange-600 hover:bg-orange-500 hover:text-white border border-orange-200 px-2 py-1 rounded-md text-[10px] font-bold transition-all shadow-sm"><HandHeart size={10} /> 替補</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="flex items-center justify-between bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200">
                                            <p className="text-[10px] font-bold text-slate-500 flex items-center gap-1.5"><Info size={10} /> 無班可換，請求支援</p>
                                            <button onClick={() => requestSubstitute(c)} className="flex items-center gap-1 bg-white text-orange-600 hover:bg-orange-500 hover:text-white border border-orange-200 px-2 py-1 rounded-md text-[10px] font-bold transition-all shadow-sm"><HandHeart size={10} /> 替補</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="p-8 text-center text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                            <UserX className="mx-auto mb-3 opacity-30" size={32} />
                            <p className="font-bold text-sm">{searchTerm ? '找不到符合搜尋條件的人選' : '找不到合適人選'}</p>
                            <p className="text-[10px] mt-1">同工可能已請假，或不符合兼任條件</p>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // ----- 主畫面渲染與 Return -----
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
                        <button onClick={goToMembers} className="w-full flex items-center gap-3 px-4 py-3 text-slate-400 hover:text-white hover:bg-slate-800/60 rounded-xl font-bold text-sm transition-all text-left group">
                            <Users size={18} className="text-slate-400 group-hover:text-indigo-400 transition-colors" />
                            <span>同工資料中心</span>
                        </button>
                        <div className="flex items-center gap-3 px-4 py-3 bg-indigo-600 text-white rounded-xl font-black text-sm shadow-lg shadow-indigo-600/10">
                            <Calendar size={18} />
                            <span>排班作業中心</span>
                        </div>
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

            {/* 右側主工作視窗容器 (原先完整的排班作業視窗) */}
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
                                    <p className="text-slate-500 text-xs font-bold flex items-center gap-1.5"><Search size={14} className="text-indigo-500"/> 點擊姓名選擇合適替代人選</p>
                                    <p className="text-slate-500 text-xs font-bold flex items-center gap-1.5"><GripVertical size={14} className="text-indigo-500"/> 拖曳姓名可交換位置</p>
                                </div>
                                <div className="flex gap-3 mt-2 pt-2 border-t border-slate-100 flex-wrap">
                                    <p className="text-rose-600 text-[10px] font-black flex items-center gap-1.5 bg-rose-50 px-2 py-1 rounded"><span className="w-2 h-2 rounded-full bg-rose-500"></span> 紅色：崗位兼任</p>
                                    <p className="text-sky-600 text-[10px] font-black flex items-center gap-1.5 bg-sky-50 px-2 py-1 rounded"><span className="w-2 h-2 rounded-full bg-sky-500"></span> 藍色：群組落單</p>
                                    {appMode === 'schedule' && <p className="text-orange-600 text-[10px] font-black flex items-center gap-1.5 bg-orange-50 px-2 py-1 rounded"><span className="w-2 h-2 rounded-full bg-orange-500"></span> 橘色：落單自動替換</p>}
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
                                <button onClick={() => setConfirmDialog({ ...confirmDialog, isOpen: false })} className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black rounded-xl transition-all">取消</button>
                                <button onClick={confirmDialog.onConfirm} className={`flex-1 py-3 px-4 font-black text-white rounded-xl transition-all shadow-lg active:scale-95 ${confirmDialog.type === 'swap' ? 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-200' : 'bg-orange-500 hover:bg-orange-600 shadow-orange-200'}`}>確認執行</button>
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
                                <button onClick={() => setPublishConfirmOpen(false)} className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black rounded-xl transition-all">取消返回</button>
                                <button onClick={executePublish} className="flex-1 py-3 px-4 font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition-all shadow-lg shadow-indigo-200 active:scale-95 flex items-center justify-center gap-2"><Save size={18} /> 確認發布</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

window.SchedulingAndGovernance = SchedulingAndGovernance;
