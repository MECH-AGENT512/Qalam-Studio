import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  CloudUpload,
  FileAudio,
  HardDrive,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  compactCompletedAudioChunks,
  getLocalDateKey,
  getStorageEstimate,
  getStoragePolicy,
  saveSubject,
  setStoragePolicy,
} from '../lib/db';
import type { LectureRecord, SubjectItem } from '../types';

interface LecturesHubProps {
  lectures: LectureRecord[];
  subjects: SubjectItem[];
  todayKey: string;
  isOnline: boolean;
  syncingLectureId: string | null;
  onSelectLecture: (id: string) => void;
  onSyncNow: (lecture: LectureRecord) => void;
  onDeleteLecture: (id: string) => void;
  onRefresh: () => void;
  onGoRecord: () => void;
}

const SUBJECT_COLORS = ['#2563EB', '#0284C7', '#059669', '#D97706', '#DC2626', '#0F766E'];

function formatDuration(sec: number): string {
  if (!sec) return 'Audio file';
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m ${s}s`;
}

export const LecturesHub: React.FC<LecturesHubProps> = ({
  lectures,
  subjects,
  todayKey,
  isOnline,
  syncingLectureId,
  onSelectLecture,
  onSyncNow,
  onDeleteLecture,
  onRefresh,
  onGoRecord,
}) => {
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'subjects' | 'all'>('subjects');
  const [filter, setFilter] = useState<'all' | 'completed' | 'pending'>('all');
  const [collapsedSubjects, setCollapsedSubjects] = useState<Record<string, boolean>>({});
  const [newSubjectName, setNewSubjectName] = useState('');
  const [autoCompact, setAutoCompact] = useState<boolean>(() => getStoragePolicy().autoCompactAfterSync);
  const [storageInfo, setStorageInfo] = useState<{
    usedMB: number;
    quotaMB: number;
    persisted: boolean;
  } | null>(null);
  const [compactNotice, setCompactNotice] = useState<string | null>(null);

  useEffect(() => {
    void getStorageEstimate().then(setStorageInfo);
  }, [lectures.length]);

  const filtered = useMemo(() => {
    return lectures.filter((l) => {
      if (filter === 'completed' && l.status !== 'completed') return false;
      if (filter === 'pending' && l.status === 'completed') return false;
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          l.title.toLowerCase().includes(q) ||
          l.subject.toLowerCase().includes(q) ||
          (l.transcript || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [lectures, filter, query]);

  const compactableAudioCount = useMemo(
    () => lectures.filter((l) => l.status === 'completed' && l.hasAudioBlob && !l.keepAudioOffline).length,
    [lectures]
  );

  // Build Subject-first structure: includes all configured subjects + any unmatched lecture subjects
  const subjectGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        id: string;
        name: string;
        accentHex: string;
        addedToday: boolean;
        todayCount: number;
        totalDurationSec: number;
        items: LectureRecord[];
      }
    >();

    for (const subj of subjects) {
      groups.set(subj.id, {
        id: subj.id,
        name: subj.name,
        accentHex: subj.accentHex,
        addedToday: getLocalDateKey(subj.createdAt) === todayKey,
        todayCount: 0,
        totalDurationSec: 0,
        items: [],
      });
    }

    for (const lec of filtered) {
      const matched = subjects.find(
        (s) => s.id === lec.subjectId || s.name.toLowerCase() === lec.subject.toLowerCase()
      );
      const key = matched?.id || `extra-${lec.subject.toLowerCase()}`;
      let bucket = groups.get(key);
      if (!bucket) {
        bucket = {
          id: key,
          name: lec.subject || 'General Lecture',
          accentHex: '#475569',
          addedToday: false,
          todayCount: 0,
          totalDurationSec: 0,
          items: [],
        };
        groups.set(key, bucket);
      }
      bucket.items.push(lec);
      bucket.totalDurationSec += lec.durationSec || 0;
      if ((lec.dateKey || getLocalDateKey(lec.createdAt)) === todayKey) {
        bucket.todayCount += 1;
      }
    }

    const list = Array.from(groups.values());
    // When searching/filtering, hide empty subjects so results stay crisp
    const visible = query.trim() || filter !== 'all' ? list.filter((g) => g.items.length > 0) : list;

    // Sort: subjects with today's lectures or added today first, then by lecture count
    visible.sort((a, b) => {
      if (b.todayCount !== a.todayCount) return b.todayCount - a.todayCount;
      if (a.addedToday !== b.addedToday) return a.addedToday ? -1 : 1;
      return b.items.length - a.items.length;
    });

    return visible;
  }, [subjects, filtered, todayKey, query, filter]);

  const handleAddSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSubjectName.trim()) return;
    await saveSubject({
      id: `subj-${Date.now()}`,
      name: newSubjectName.trim(),
      accentHex: SUBJECT_COLORS[subjects.length % SUBJECT_COLORS.length],
      createdAt: Date.now(),
    });
    setNewSubjectName('');
    onRefresh();
  };

  const handleToggleAutoCompact = () => {
    const next = !autoCompact;
    setAutoCompact(next);
    setStoragePolicy({ autoCompactAfterSync: next });
  };

  const handleCompactNow = async () => {
    const res = await compactCompletedAudioChunks();
    const updatedInfo = await getStorageEstimate();
    setStorageInfo(updatedInfo);
    if (res.freedLectures > 0) {
      const mb = (res.freedBytes / (1024 * 1024)).toFixed(1);
      setCompactNotice(`Freed ${mb} MB across ${res.freedLectures} synced lecture(s). Notes & PDFs preserved.`);
    } else {
      setCompactNotice('All synced lectures are already compacted.');
    }
    onRefresh();
    setTimeout(() => setCompactNotice(null), 4000);
  };

  const renderLectureRow = (lec: LectureRecord) => {
    const isToday = (lec.dateKey || getLocalDateKey(lec.createdAt)) === todayKey;
    return (
      <div
        key={lec.id}
        className="p-3.5 sm:px-5 sm:py-4 flex items-center justify-between gap-3 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
      >
        <button
          type="button"
          onClick={() => onSelectLecture(lec.id)}
          className="flex-1 min-w-0 flex items-start gap-3 text-left cursor-pointer"
        >
          <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-600 dark:text-slate-300">
            <FileAudio className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
              {lec.title}
            </h3>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
              {viewMode === 'all' && (
                <>
                  <span>{lec.subject}</span>
                  <span aria-hidden="true">·</span>
                </>
              )}
              <span className="font-mono-tabular">{formatDuration(lec.durationSec)}</span>
              <span aria-hidden="true">·</span>
              <span>
                {isToday
                  ? `Today ${new Date(lec.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : new Date(lec.createdAt).toLocaleDateString()}
              </span>
              <span aria-hidden="true">·</span>
              <span
                className={
                  lec.status === 'completed'
                    ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                    : lec.status === 'error'
                      ? 'text-red-600 dark:text-red-400 font-medium'
                      : 'text-blue-600 dark:text-blue-400 font-medium'
                }
              >
                {lec.status === 'completed'
                  ? lec.hasAudioBlob
                    ? 'AI Ready + Audio'
                    : 'AI Notes & PDF Saved'
                  : lec.status === 'pending_sync'
                    ? 'Offline Saved'
                    : lec.status === 'transcribing'
                      ? 'Transcribing...'
                      : lec.status === 'analyzing'
                        ? 'Analyzing...'
                        : lec.status === 'error'
                          ? 'Needs Retry'
                          : 'Recording'}
              </span>
            </div>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {(lec.status === 'pending_sync' || lec.status === 'error') && (
            <button
              type="button"
              disabled={!isOnline || syncingLectureId === lec.id}
              onClick={() => onSyncNow(lec)}
              className="flex items-center gap-1.5 px-3 py-2 min-h-[38px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-medium cursor-pointer"
            >
              <CloudUpload className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Process</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => onDeleteLecture(lec.id)}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
            aria-label={`Delete ${lec.title}`}
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onSelectLecture(lec.id)}
            className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
            aria-label={`Open ${lec.title}`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {/* Header + View Switch */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            Subjects &amp; Lectures Library
          </h1>
          <p className="mt-0.5 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            {subjects.length} subjects · {lectures.length} lectures · Organized by subject &amp; saved for 2+ years
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex-1 sm:w-56">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search subject or lecture..."
              className="w-full min-h-[40px] pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setViewMode('subjects')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'subjects'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              By Subject
            </button>
            <button
              type="button"
              onClick={() => setViewMode('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                viewMode === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              All Recent
            </button>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
            {(['all', 'completed', 'pending'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer capitalize whitespace-nowrap ${
                  filter === tab
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Compact 2-Year Mobile Storage & Quick Add Subject Strip */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-7 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <HardDrive className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-semibold text-slate-900 dark:text-slate-100">
                2-Year Smart Storage · {storageInfo ? `${storageInfo.usedMB} MB used` : 'Ready'}
                {storageInfo?.persisted ? ' · Protected' : ''}
              </div>
              <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                Up to 14 lectures/wk (4h each = 1,456 lectures/2 yrs) fits in ~65 MB once synced audio is auto-compacted.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleToggleAutoCompact}
              className={`px-3 py-1.5 min-h-[36px] rounded-xl border text-xs font-medium cursor-pointer whitespace-nowrap ${
                autoCompact
                  ? 'border-emerald-600/40 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
              }`}
            >
              {autoCompact ? 'Auto-Compact: ON' : 'Auto-Compact: OFF'}
            </button>
            {compactableAudioCount > 0 && (
              <button
                type="button"
                onClick={() => void handleCompactNow()}
                className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Free {compactableAudioCount} Audio</span>
              </button>
            )}
          </div>
        </div>

        <form
          onSubmit={(e) => void handleAddSubject(e)}
          className="lg:col-span-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex items-center gap-2"
        >
          <input
            type="text"
            value={newSubjectName}
            onChange={(e) => setNewSubjectName(e.target.value)}
            placeholder="Add subject folder (e.g., Operating Systems)"
            className="flex-1 min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-slate-100"
          />
          <button
            type="submit"
            className="flex items-center gap-1 px-3.5 min-h-[40px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Subject</span>
          </button>
        </form>
      </div>

      {compactNotice && (
        <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 px-4 py-2.5 text-xs text-emerald-800 dark:text-emerald-200">
          {compactNotice}
        </div>
      )}

      {/* Main Content */}
      {viewMode === 'subjects' ? (
        subjectGroups.length === 0 ? (
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-10 text-center">
            <BookOpen className="w-9 h-9 mx-auto text-slate-400 mb-3" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              No matching subjects or lectures
            </h2>
            <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              Record your next lecture offline and pick a subject folder. Everything saves cleanly here.
            </p>
            <button
              type="button"
              onClick={onGoRecord}
              className="mt-5 px-5 py-2.5 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold cursor-pointer"
            >
              Open Offline Recorder
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {subjectGroups.map((group) => {
              const isCollapsed = Boolean(collapsedSubjects[group.id]);
              return (
                <section
                  key={group.id}
                  className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedSubjects((prev) => ({
                        ...prev,
                        [group.id]: !prev[group.id],
                      }))
                    }
                    className="w-full px-5 py-4 flex items-center justify-between gap-3 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className="w-3 h-3 rounded-sm shrink-0"
                        style={{ backgroundColor: group.accentHex }}
                      />
                      <div className="min-w-0">
                        <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                          {group.name}
                        </h2>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                          {group.items.length} {group.items.length === 1 ? 'lecture' : 'lectures'}
                          {group.totalDurationSec > 0 ? ` · ${formatDuration(group.totalDurationSec)}` : ''}
                          {group.todayCount > 0 ? ` · ${group.todayCount} recorded today` : ''}
                          {group.addedToday && group.todayCount === 0 ? ' · Added today' : ''}
                        </div>
                      </div>
                    </div>
                    {isCollapsed ? (
                      <ChevronRight className="w-4 h-4 text-slate-400 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                  </button>

                  {!isCollapsed && (
                    <div className="border-t border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                      {group.items.length === 0 ? (
                        <div className="px-5 py-4 flex items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
                          <span>No lectures recorded in {group.name} yet.</span>
                          <button
                            type="button"
                            onClick={onGoRecord}
                            className="text-blue-600 dark:text-blue-400 font-semibold hover:underline cursor-pointer"
                          >
                            Record Now
                          </button>
                        </div>
                      ) : (
                        group.items.map(renderLectureRow)
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-10 text-center">
          <BookOpen className="w-9 h-9 mx-auto text-slate-400 mb-3" />
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            No lectures found
          </h2>
          <button
            type="button"
            onClick={onGoRecord}
            className="mt-4 px-5 py-2.5 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold cursor-pointer"
          >
            Open Offline Recorder
          </button>
        </div>
      ) : (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden shadow-sm">
          {filtered.map(renderLectureRow)}
        </div>
      )}
    </div>
  );
};
