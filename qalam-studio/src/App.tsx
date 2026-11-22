import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, CalendarDays, CheckSquare, Grid, Mic, Moon, Sun } from 'lucide-react';
import { CalendarHub } from './components/CalendarHub';
import { LectureDetail } from './components/LectureDetail';
import { LecturesHub } from './components/LecturesHub';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { RecorderStudio } from './components/RecorderStudio';
import { TasksView } from './components/TasksView';
import { ToolsWorkbench } from './components/ToolsWorkbench';
import { useAutoSync } from './hooks/useAutoSync';
import { useDailyCycle } from './hooks/useDailyCycle';
import { useOnlineStatus } from './hooks/useOnlineStatus';
import {
  deleteLectureAndChunks,
  ensurePersistentStorage,
  getAllLectures,
  getAllSubjects,
  getAllTasks,
} from './lib/db';
import type { ExtractedTask, LectureRecord, SubjectItem } from './types';

type NavTab = 'record' | 'lectures' | 'calendar' | 'tasks' | 'tools';

export default function App() {
  const isOnline = useOnlineStatus();
  const [activeTab, setActiveTab] = useState<NavTab>('record');
  const [lectures, setLectures] = useState<LectureRecord[]>([]);
  const [tasks, setTasks] = useState<ExtractedTask[]>([]);
  const [subjects, setSubjects] = useState<SubjectItem[]>([]);
  const [selectedLectureId, setSelectedLectureId] = useState<string | null>(null);
  const [dark, setDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('qalam-theme') === 'dark';
  });

  useEffect(() => {
    const root = document.documentElement;
    if (dark) {
      root.classList.add('dark');
      localStorage.setItem('qalam-theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('qalam-theme', 'light');
    }
  }, [dark]);

  const loadData = useCallback(async () => {
    const [lecs, tks, subjs] = await Promise.all([
      getAllLectures(),
      getAllTasks(),
      getAllSubjects(),
    ]);
    setLectures(lecs);
    setTasks(tks);
    setSubjects(subjs);
  }, []);

  useEffect(() => {
    void loadData();
    void ensurePersistentStorage();
  }, [loadData]);

  const handleLecturesUpdated = useCallback(() => {
    void loadData();
  }, [loadData]);

  const { syncingLectureId, syncStage, processLecture } = useAutoSync(isOnline, handleLecturesUpdated);

  const {
    todayKey,
    countdownText,
    cycleProgressPct,
    archives,
    saveTodayCycleSnapshot,
    attachDailyDigest,
  } = useDailyCycle(lectures, subjects);

  const handleDeleteLecture = async (id: string) => {
    await deleteLectureAndChunks(id);
    if (selectedLectureId === id) setSelectedLectureId(null);
    await loadData();
  };

  const selectedLecture = lectures.find((l) => l.id === selectedLectureId) || null;
  const pendingTasksCount = tasks.filter((t) => !t.completed).length;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <OfflineIndicator isOnline={isOnline} />

      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 h-14 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-7xl mx-auto h-full px-4 sm:px-6 flex items-center justify-between gap-8">
          {/* Zone 1: Brand Wordmark */}
          <button
            type="button"
            onClick={() => {
              setSelectedLectureId(null);
              setActiveTab('record');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Qalam Studio
          </button>

          {/* Zone 2: Desktop Single-Line Navigation Links */}
          <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-slate-600 dark:text-slate-400">
            <button
              type="button"
              onClick={() => {
                setSelectedLectureId(null);
                setActiveTab('record');
              }}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'record'
                  ? 'border-blue-600 text-slate-900 dark:text-slate-100 font-semibold'
                  : 'border-transparent hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Recorder
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedLectureId(null);
                setActiveTab('lectures');
              }}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'lectures'
                  ? 'border-blue-600 text-slate-900 dark:text-slate-100 font-semibold'
                  : 'border-transparent hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Lectures
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedLectureId(null);
                setActiveTab('calendar');
              }}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'calendar'
                  ? 'border-blue-600 text-slate-900 dark:text-slate-100 font-semibold'
                  : 'border-transparent hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Calendar
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedLectureId(null);
                setActiveTab('tasks');
              }}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'tasks'
                  ? 'border-blue-600 text-slate-900 dark:text-slate-100 font-semibold'
                  : 'border-transparent hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Tasks
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedLectureId(null);
                setActiveTab('tools');
              }}
              className={`whitespace-nowrap shrink-0 py-1 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'tools'
                  ? 'border-blue-600 text-slate-900 dark:text-slate-100 font-semibold'
                  : 'border-transparent hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              12 AI Tools
            </button>
          </nav>

          {/* Zone 3: Single Primary Action */}
          <div className="shrink-0">
            <PWAInstallButton
              onQuickRecord={() => {
                setSelectedLectureId(null);
                setActiveTab('record');
              }}
            />
          </div>
        </div>
      </header>

      {/* Main Content Area (padded above fixed mobile bottom tab bar) */}
      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 pt-5 pb-24 lg:pb-12">
        {/* Workspace Utility Strip (Theme Switch + Cycle Summary) */}
        <div className="mb-5 flex items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="truncate">
            <span>{isOnline ? 'Online · Auto-Sync Active' : 'Offline · Local Storage Ready'}</span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono-tabular">{lectures.length} Lectures</span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono-tabular">{pendingTasksCount} Pending Tasks</span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono-tabular">Cycle Reset {countdownText}</span>
          </div>
          <button
            type="button"
            onClick={() => setDark((d) => !d)}
            className="flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            aria-label="Toggle light and dark theme"
          >
            {dark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{dark ? 'Light' : 'Dark'}</span>
          </button>
        </div>

        {selectedLecture ? (
          <LectureDetail
            lecture={selectedLecture}
            tasks={tasks}
            isOnline={isOnline}
            isSyncing={syncingLectureId === selectedLecture.id}
            onBack={() => setSelectedLectureId(null)}
            onSyncNow={(lec) => void processLecture(lec)}
            onRefresh={() => void loadData()}
          />
        ) : activeTab === 'record' ? (
          <RecorderStudio
            isOnline={isOnline}
            lectures={lectures}
            subjects={subjects}
            todayKey={todayKey}
            countdownText={countdownText}
            syncingLectureId={syncingLectureId}
            syncStage={syncStage}
            onLecturesChanged={() => void loadData()}
            onSyncNow={(lec) => void processLecture(lec)}
            onOpenLecture={(id) => {
              setSelectedLectureId(id);
              setActiveTab('lectures');
            }}
          />
        ) : activeTab === 'lectures' ? (
          <LecturesHub
            lectures={lectures}
            subjects={subjects}
            todayKey={todayKey}
            isOnline={isOnline}
            syncingLectureId={syncingLectureId}
            onSelectLecture={(id) => setSelectedLectureId(id)}
            onSyncNow={(lec) => void processLecture(lec)}
            onDeleteLecture={(id) => void handleDeleteLecture(id)}
            onRefresh={() => void loadData()}
            onGoRecord={() => setActiveTab('record')}
          />
        ) : activeTab === 'calendar' ? (
          <CalendarHub
            todayKey={todayKey}
            countdownText={countdownText}
            cycleProgressPct={cycleProgressPct}
            lectures={lectures}
            subjects={subjects}
            archives={archives}
            isOnline={isOnline}
            onRefresh={() => void loadData()}
            onOpenLecture={(id) => {
              setSelectedLectureId(id);
              setActiveTab('lectures');
            }}
            onSaveTodaySnapshot={saveTodayCycleSnapshot}
            onAttachDigest={attachDailyDigest}
          />
        ) : activeTab === 'tasks' ? (
          <TasksView
            tasks={tasks}
            onRefresh={() => void loadData()}
            onOpenLecture={(id) => {
              setSelectedLectureId(id);
              setActiveTab('lectures');
            }}
          />
        ) : (
          <ToolsWorkbench isOnline={isOnline} />
        )}
      </main>

      {/* Fixed Mobile Bottom Navigation Bar (Thumb Zone, 64px height) */}
      <nav
        aria-label="Mobile navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe"
      >
        <div className="grid grid-cols-5 h-16 items-center">
          {(
            [
              { id: 'record', label: 'Record', icon: Mic },
              { id: 'lectures', label: 'Lectures', icon: BookOpen },
              { id: 'calendar', label: 'Calendar', icon: CalendarDays },
              { id: 'tasks', label: 'Tasks', icon: CheckSquare },
              { id: 'tools', label: '12 Tools', icon: Grid },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id && !selectedLecture;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSelectedLectureId(null);
                  setActiveTab(item.id);
                }}
                className={`flex flex-col items-center justify-center min-h-[48px] transition-colors cursor-pointer ${
                  active
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                <Icon className="w-[22px] h-[22px]" />
                <span className="text-[11px] font-medium tracking-tight mt-1">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
