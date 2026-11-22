import React, { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileAudio,
  FolderArchive,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { deleteSubjectById, getLocalDateKey, saveSubject } from '../lib/db';
import { safeFetchJson } from '../lib/safeFetchJson';
import type {
  DailyCycleArchive,
  DailyDigest,
  LectureRecord,
  SubjectItem,
} from '../types';

interface CalendarHubProps {
  todayKey: string;
  countdownText: string;
  cycleProgressPct: number;
  lectures: LectureRecord[];
  subjects: SubjectItem[];
  archives: DailyCycleArchive[];
  isOnline: boolean;
  onRefresh: () => void;
  onOpenLecture: (lectureId: string) => void;
  onSaveTodaySnapshot: () => Promise<DailyCycleArchive>;
  onAttachDigest: (dateKey: string, digest: DailyDigest) => Promise<void>;
}

const SUBJECT_COLORS = ['#2563EB', '#0284C7', '#059669', '#D97706', '#DC2626', '#0F766E'];

function formatDuration(sec: number): string {
  if (!sec) return '0m';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

export const CalendarHub: React.FC<CalendarHubProps> = ({
  todayKey,
  countdownText,
  cycleProgressPct,
  lectures,
  subjects,
  archives,
  isOnline,
  onRefresh,
  onOpenLecture,
  onSaveTodaySnapshot,
  onAttachDigest,
}) => {
  const [selectedDateKey, setSelectedDateKey] = useState<string>(todayKey);
  const [viewMonth, setViewMonth] = useState<Date>(() => {
    const [y, m] = todayKey.split('-').map(Number);
    return new Date(y, (m || 1) - 1, 1);
  });
  const [newSubjectName, setNewSubjectName] = useState('');
  const [digestLoading, setDigestLoading] = useState(false);
  const [digestError, setDigestError] = useState<string | null>(null);
  const [snapshotMessage, setSnapshotMessage] = useState<string | null>(null);

  const lecturesByDate = useMemo(() => {
    const map = new Map<string, LectureRecord[]>();
    for (const lec of lectures) {
      const k = lec.dateKey || getLocalDateKey(lec.createdAt);
      const list = map.get(k) || [];
      list.push(lec);
      map.set(k, list);
    }
    return map;
  }, [lectures]);

  const subjectsAddedByDate = useMemo(() => {
    const map = new Map<string, SubjectItem[]>();
    for (const subj of subjects) {
      if (subj.createdAt < 1000000000000) continue; // ignore seeded static IDs (< year 2001)
      const k = getLocalDateKey(subj.createdAt);
      const list = map.get(k) || [];
      list.push(subj);
      map.set(k, list);
    }
    return map;
  }, [subjects]);

  // Quick 2-month (past 60 days) active dates so students can jump to any active day in 1 tap
  const pastTwoMonthsActiveDates = useMemo(() => {
    const cutoff = Date.now() - 62 * 24 * 60 * 60 * 1000;
    const keys = new Set<string>([todayKey]);
    for (const lec of lectures) {
      if (lec.createdAt >= cutoff) {
        keys.add(lec.dateKey || getLocalDateKey(lec.createdAt));
      }
    }
    for (const subj of subjects) {
      if (subj.createdAt >= cutoff) {
        keys.add(getLocalDateKey(subj.createdAt));
      }
    }
    return Array.from(keys).sort((a, b) => b.localeCompare(a));
  }, [lectures, subjects, todayKey]);

  const archiveMap = useMemo(
    () => new Map(archives.map((a) => [a.dateKey, a])),
    [archives]
  );

  // Build calendar grid cells
  const calendarDays = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth();
    const firstDayOfMonth = new Date(year, month, 1);
    const startWeekday = firstDayOfMonth.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: { dateKey: string | null; dayNum: number | null }[] = [];
    for (let i = 0; i < startWeekday; i++) {
      cells.push({ dateKey: null, dayNum: null });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      cells.push({ dateKey: key, dayNum: d });
    }
    return cells;
  }, [viewMonth]);

  const selectedDayLectures = useMemo(
    () => lecturesByDate.get(selectedDateKey) || [],
    [lecturesByDate, selectedDateKey]
  );

  const selectedArchive = archiveMap.get(selectedDateKey);

  // Group selected day's lectures by Subject AND include any Subjects added on that selected date
  const groupedSelectedSubjects = useMemo(() => {
    const groups = new Map<
      string,
      { subjectName: string; accentHex: string; addedOnSelectedDay: boolean; items: LectureRecord[] }
    >();

    for (const addedSubj of subjectsAddedByDate.get(selectedDateKey) || []) {
      groups.set(addedSubj.id, {
        subjectName: addedSubj.name,
        accentHex: addedSubj.accentHex,
        addedOnSelectedDay: true,
        items: [],
      });
    }

    for (const lec of selectedDayLectures) {
      const matchedSubj = subjects.find(
        (s) => s.id === lec.subjectId || s.name.toLowerCase() === lec.subject.toLowerCase()
      );
      const key = matchedSubj?.id || lec.subject || 'general';
      const existing = groups.get(key) || {
        subjectName: matchedSubj?.name || lec.subject || 'General Lecture',
        accentHex: matchedSubj?.accentHex || '#475569',
        addedOnSelectedDay: false,
        items: [],
      };
      existing.items.push(lec);
      groups.set(key, existing);
    }

    return Array.from(groups.values());
  }, [selectedDayLectures, subjects, subjectsAddedByDate, selectedDateKey]);

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    const item: SubjectItem = {
      id: `subj-${Date.now()}`,
      name: newSubjectName.trim(),
      accentHex: SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length],
      createdAt: Date.now(),
    };
    await saveSubject(item);
    setNewSubjectName('');
    onRefresh();
  };

  const handleDeleteSubject = async (id: string) => {
    if (subjects.length <= 1) return;
    await deleteSubjectById(id);
    onRefresh();
  };

  const handleArchiveNow = async () => {
    const snap = await onSaveTodaySnapshot();
    setSnapshotMessage(
      `Saved ${snap.dayName} (${snap.dateKey}) — ${snap.totalLectures} lecture(s) across ${snap.subjects.length} subject(s).`
    );
    setTimeout(() => setSnapshotMessage(null), 4000);
  };

  const handleGenerateDailyDigest = async () => {
    if (selectedDayLectures.length === 0 || !isOnline) return;
    setDigestLoading(true);
    setDigestError(null);
    try {
      const [y, m, d] = selectedDateKey.split('-').map(Number);
      const dayName = new Date(y, (m || 1) - 1, d || 1).toLocaleDateString(undefined, {
        weekday: 'long',
      });
      const res = await safeFetchJson<DailyDigest>('/api/calendar/daily-digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateKey: selectedDateKey,
          dayName,
          items: selectedDayLectures.map((l) => ({
            subject: l.subject,
            title: l.title,
            summary:
              l.notes?.executiveSummary ||
              l.transcript?.slice(0, 1200) ||
              'Recorded audio lecture pending transcription.',
            recordedAt: new Date(l.createdAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          })),
        }),
      });
      if (!res.ok) {
        throw new Error(res.data.error || 'Could not compile daily digest.');
      }
      await onAttachDigest(selectedDateKey, res.data as DailyDigest);
    } catch (err) {
      setDigestError(err instanceof Error ? err.message : 'Failed to generate daily digest.');
    } finally {
      setDigestLoading(false);
    }
  };

  const selectedDateObj = useMemo(() => {
    const [y, m, d] = selectedDateKey.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }, [selectedDateKey]);

  // Quick 2-month shortcut dates (This Month & Last Month)
  const [todayYear, todayMonth] = todayKey.split('-').map(Number);
  const thisMonthDate = new Date(todayYear, (todayMonth || 1) - 1, 1);
  const lastMonthDate = new Date(todayYear, (todayMonth || 1) - 2, 1);
  const twoMonthsAgoDate = new Date(todayYear, (todayMonth || 1) - 3, 1);

  const radius = 34;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (cycleProgressPct / 100) * circumference;

  return (
    <div className="space-y-6">
      {/* Top 24-Hour Cycle Status Banner */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="relative w-20 h-20 shrink-0 flex items-center justify-center">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80" aria-hidden="true">
                <circle
                  cx="40"
                  cy="40"
                  r={radius}
                  stroke="currentColor"
                  strokeWidth="6"
                  fill="none"
                  className="text-slate-100 dark:text-slate-800"
                />
                <circle
                  cx="40"
                  cy="40"
                  r={radius}
                  stroke="#2563EB"
                  strokeWidth="6"
                  strokeLinecap="round"
                  fill="none"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xs font-bold font-mono-tabular text-slate-900 dark:text-slate-100">
                  24h
                </span>
                <span className="text-[10px] font-mono-tabular text-slate-500 dark:text-slate-400">
                  {cycleProgressPct.toFixed(0)}%
                </span>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium text-blue-600 dark:text-blue-400">
                24-Hour Auto-Save Cycle · Repeats Daily
              </div>
              <h1 className="mt-0.5 text-lg sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {new Date().toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="inline-flex items-center gap-1 font-mono-tabular">
                  <Clock className="w-3.5 h-3.5" />
                  Resets &amp; Saves in {countdownText}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">
                  {(lecturesByDate.get(todayKey) || []).length} lectures today
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{archives.length} days saved</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleArchiveNow()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 cursor-pointer shrink-0"
          >
            <FolderArchive className="w-4 h-4 text-blue-600" />
            <span>Save Today&apos;s Cycle Now</span>
          </button>
        </div>

        {snapshotMessage && (
          <div className="mt-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-3.5 py-2.5 text-xs text-emerald-800 dark:text-emerald-200">
            {snapshotMessage}
          </div>
        )}
      </section>

      {/* Main 2-Column Calendar + Day Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: 2-Month Fast Calendar + Subjects */}
        <div className="lg:col-span-5 space-y-6">
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-blue-600" />
                <span>
                  {viewMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                </span>
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
                  }
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setViewMonth(thisMonthDate);
                    setSelectedDateKey(todayKey);
                  }}
                  className="px-2.5 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
                  }
                  className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                  aria-label="Next month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 1-Tap Past 2 Months Switcher */}
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
              {[twoMonthsAgoDate, lastMonthDate, thisMonthDate].map((mDate) => {
                const isActive =
                  viewMonth.getFullYear() === mDate.getFullYear() &&
                  viewMonth.getMonth() === mDate.getMonth();
                return (
                  <button
                    key={mDate.toISOString()}
                    type="button"
                    onClick={() => setViewMonth(mDate)}
                    className={`py-1.5 px-2 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    {mDate.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}
                  </button>
                );
              })}
            </div>

            <div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">
                {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                  <div key={d} className="py-1">
                    {d}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-1.5">
                {calendarDays.map((cell, idx) => {
                  if (!cell.dateKey || !cell.dayNum) {
                    return <div key={`empty-${idx}`} className="h-11" />;
                  }
                  const dayCount = (lecturesByDate.get(cell.dateKey) || []).length;
                  const subjAddedCount = (subjectsAddedByDate.get(cell.dateKey) || []).length;
                  const hasActivity = dayCount > 0 || subjAddedCount > 0;
                  const isSelected = selectedDateKey === cell.dateKey;
                  const isToday = todayKey === cell.dateKey;

                  return (
                    <button
                      key={cell.dateKey}
                      type="button"
                      onClick={() => setSelectedDateKey(cell.dateKey!)}
                      className={`h-11 rounded-xl flex flex-col items-center justify-center relative transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-blue-600 text-white font-semibold shadow-sm'
                          : isToday
                            ? 'bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-blue-400 font-semibold border border-blue-500/40'
                            : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <span className="text-xs font-mono-tabular">{cell.dayNum}</span>
                      {hasActivity && (
                        <span
                          className={`text-[9px] font-mono-tabular leading-none mt-0.5 ${
                            isSelected ? 'text-blue-100' : 'text-blue-600 dark:text-blue-400 font-semibold'
                          }`}
                        >
                          {dayCount > 0 ? dayCount : '•'}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Active Dates in Past 2 Months Quick Jump */}
            {pastTwoMonthsActiveDates.length > 0 && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">
                  Active dates (last 2 months)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {pastTwoMonthsActiveDates.slice(0, 14).map((dk) => {
                    const [yy, mm, dd] = dk.split('-').map(Number);
                    const label =
                      dk === todayKey
                        ? 'Today'
                        : new Date(yy, (mm || 1) - 1, dd || 1).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          });
                    return (
                      <button
                        key={dk}
                        type="button"
                        onClick={() => {
                          setSelectedDateKey(dk);
                          setViewMonth(new Date(yy, (mm || 1) - 1, 1));
                        }}
                        className={`px-2.5 py-1 min-h-[32px] rounded-lg text-xs font-medium border cursor-pointer ${
                          selectedDateKey === dk
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          {/* Daily Recurring Subjects Manager */}
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 shadow-sm space-y-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Recurring Daily Subjects
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Every 24h cycle starts with these subjects ready for recording.
              </p>
            </div>

            <form onSubmit={(e) => void handleAddSubject(e)} className="flex gap-2">
              <input
                type="text"
                value={newSubjectName}
                onChange={(e) => setNewSubjectName(e.target.value)}
                placeholder="Add subject (e.g., Data Structures)"
                className="flex-1 min-h-[42px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-slate-100"
              />
              <button
                type="submit"
                className="flex items-center gap-1 px-3.5 min-h-[42px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Add</span>
              </button>
            </form>

            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {subjects.map((subj) => (
                <li key={subj.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-3 h-3 rounded-sm shrink-0"
                      style={{ backgroundColor: subj.accentHex }}
                    />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                      {subj.name}
                    </span>
                  </div>
                  {subjects.length > 1 && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteSubject(subj.id)}
                      className="min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                      aria-label={`Remove ${subj.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Right: Selected Day Subjects & Lectures */}
        <div className="lg:col-span-7 space-y-6">
          <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedDateKey === todayKey ? 'Today (Active 24h Cycle)' : 'Selected Calendar Date'}
                </div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  {selectedDateObj.toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </h2>
                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                  {groupedSelectedSubjects.length} subjects · {selectedDayLectures.length} lectures ·{' '}
                  {formatDuration(
                    selectedDayLectures.reduce((sum, l) => sum + (l.durationSec || 0), 0)
                  )}{' '}
                  total
                </div>
              </div>

              {selectedDayLectures.length > 0 && (
                <button
                  type="button"
                  disabled={!isOnline || digestLoading}
                  onClick={() => void handleGenerateDailyDigest()}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[42px] rounded-xl bg-slate-900 dark:bg-blue-600 hover:opacity-90 disabled:opacity-45 text-white text-xs font-semibold cursor-pointer shrink-0"
                >
                  {digestLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Synthesizing Day...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>
                        {selectedArchive?.digest ? 'Refresh Daily Digest' : 'Daily AI Summary'}
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>

            {digestError && (
              <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300">
                {digestError}
              </div>
            )}

            {selectedArchive?.digest && (
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Daily Multi-Subject AI Summary
                </h3>
                <p className="font-serif-reading text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                  {selectedArchive.digest.summary}
                </p>
                {(selectedArchive.digest.crossSubjectConnections || []).length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Cross-Subject Connections
                    </div>
                    <ul className="space-y-1 list-disc pl-4 text-xs text-slate-600 dark:text-slate-400">
                      {(selectedArchive.digest.crossSubjectConnections || []).map((c, i) => (
                        <li key={i}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {(selectedArchive.digest.priorityStudyPlan || []).length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1">
                      Next-Day Action Plan
                    </div>
                    <ul className="space-y-1 list-decimal pl-4 text-xs text-slate-600 dark:text-slate-400">
                      {(selectedArchive.digest.priorityStudyPlan || []).map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Subject-Grouped Lecture Timeline */}
            {groupedSelectedSubjects.length === 0 ? (
              <div className="py-10 text-center text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                No subjects added or lectures recorded on {selectedDateKey}. Pick another date from the past 2 months or start recording today.
              </div>
            ) : (
              <div className="space-y-5">
                {groupedSelectedSubjects.map((group) => (
                  <div key={group.subjectName} className="space-y-2.5">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: group.accentHex }}
                      />
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {group.subjectName}
                      </h3>
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                        · {group.items.length} {group.items.length === 1 ? 'lecture' : 'lectures'}
                        {group.addedOnSelectedDay ? ' · Added this day' : ''}
                      </span>
                    </div>

                    {group.items.length === 0 ? (
                      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 text-xs text-slate-500 dark:text-slate-400">
                        Subject created on this date — no lectures recorded in it on {selectedDateKey}.
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                        {group.items.map((lec) => (
                          <button
                            key={lec.id}
                            type="button"
                            onClick={() => onOpenLecture(lec.id)}
                            className="w-full p-3.5 sm:px-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <FileAudio className="w-4 h-4 text-slate-400 shrink-0" />
                              <div className="min-w-0">
                                <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                                  {lec.title}
                                </div>
                                <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                                  {new Date(lec.createdAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                  {' · '}
                                  {formatDuration(lec.durationSec)}
                                  {' · '}
                                  {lec.status === 'completed' ? 'AI Notes & PDF Ready' : 'Saved Locally'}
                                </div>
                              </div>
                            </div>
                            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
