import React, { useEffect, useRef, useState } from 'react';
import {
  BookmarkPlus,
  CheckCircle2,
  CloudUpload,
  FileAudio,
  FileText,
  Mic,
  Pause,
  Play,
  RefreshCw,
  Square,
  Upload,
} from 'lucide-react';
import { getStorageEstimate, saveLecture } from '../lib/db';
import type { LanguageMode, LectureRecord, RecordingQuality, SubjectItem } from '../types';
import { QUALITY_PRESETS, useOfflineRecorder } from '../hooks/useOfflineRecorder';

interface RecorderStudioProps {
  isOnline: boolean;
  lectures: LectureRecord[];
  subjects: SubjectItem[];
  todayKey: string;
  countdownText: string;
  syncingLectureId: string | null;
  syncStage: string;
  onLecturesChanged: () => void;
  onSyncNow: (lecture: LectureRecord) => void;
  onOpenLecture: (lectureId: string) => void;
}

function formatDuration(sec: number): string {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const RecorderStudio: React.FC<RecorderStudioProps> = ({
  isOnline,
  lectures,
  subjects,
  todayKey,
  countdownText,
  syncingLectureId,
  syncStage,
  onLecturesChanged,
  onSyncNow,
  onOpenLecture,
}) => {
  const [lectureTitle, setLectureTitle] = useState('');
  const [languageMode, setLanguageMode] = useState<LanguageMode>('bilingual_ur');
  const [selectedSubjectId, setSelectedSubjectId] = useState<string>(subjects[0]?.id || 'subj-general');
  const [quality, setQuality] = useState<RecordingQuality>('voice_16');
  const [bookmarkInput, setBookmarkInput] = useState('');
  const [storageInfo, setStorageInfo] = useState<{
    usedMB: number;
    quotaMB: number;
    persisted: boolean;
  } | null>(null);
  const [showTextModal, setShowTextModal] = useState(false);
  const [pastedTranscript, setPastedTranscript] = useState('');

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (subjects.length > 0 && !subjects.some((s) => s.id === selectedSubjectId)) {
      setSelectedSubjectId(subjects[0].id);
    }
  }, [subjects, selectedSubjectId]);

  const selectedSubject: SubjectItem =
    subjects.find((s) => s.id === selectedSubjectId) ||
    subjects[0] || {
      id: 'subj-general',
      name: 'General Lecture',
      accentHex: '#2563EB',
      createdAt: 0,
    };

  const activePreset = QUALITY_PRESETS[quality];

  const recorder = useOfflineRecorder(() => {
    setLectureTitle('');
    onLecturesChanged();
  });

  useEffect(() => {
    getStorageEstimate().then(setStorageInfo);
  }, [lectures.length, recorder.recordedBytes]);

  // High-DPI Dual-Layer Canvas Visualizer (64-Band Spectrum + Oscilloscope Waveform)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 520;
    const height = canvas.clientHeight || 104;
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    // Subtle acoustic reference gridlines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.lineWidth = 1;
    for (const ratio of [0.25, 0.5, 0.75]) {
      const y = Math.round(height * ratio) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const bars = recorder.audioLevels;
    const total = bars.length;
    const gap = 3;
    const barW = Math.max(2.5, (width - gap * (total - 1)) / total);
    const midY = height / 2;

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    if (recorder.isRecording && !recorder.isPaused) {
      grad.addColorStop(0, selectedSubject.accentHex || '#2563EB');
      grad.addColorStop(0.5, '#38BDF8');
      grad.addColorStop(1, '#3B82F6');
    } else {
      grad.addColorStop(0, '#334155');
      grad.addColorStop(1, '#475569');
    }
    ctx.fillStyle = grad;

    for (let i = 0; i < total; i++) {
      const level = bars[i] ?? 0.05;
      const barH = Math.max(4, level * (height - 14));
      const x = i * (barW + gap);
      const y = midY - barH / 2;
      const r = Math.min(barW / 2, 3);

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, barW, barH, r);
      } else {
        ctx.rect(x, y, barW, barH);
      }
      ctx.fill();
    }

    // Crisp real-time oscilloscope waveform trace
    const wave = recorder.waveformSamples;
    if (wave.length > 1) {
      ctx.save();
      ctx.strokeStyle =
        recorder.isRecording && !recorder.isPaused
          ? 'rgba(248, 250, 252, 0.88)'
          : 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = recorder.isRecording && !recorder.isPaused ? 1.75 : 1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      const stepX = width / (wave.length - 1);
      for (let i = 0; i < wave.length; i++) {
        const x = i * stepX;
        const amp = recorder.isRecording && !recorder.isPaused ? wave[i] * (height * 0.36) : 0;
        const y = midY + amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }, [
    recorder.audioLevels,
    recorder.waveformSamples,
    recorder.isRecording,
    recorder.isPaused,
    selectedSubject.accentHex,
  ]);

  const queuedLectures = lectures.filter(
    (l) => l.status === 'pending_sync' || l.status === 'transcribing' || l.status === 'analyzing' || l.status === 'error'
  );

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await recorder.importAudioFile(file, lectureTitle, languageMode, selectedSubject);
    setLectureTitle('');
    e.target.value = '';
  };

  const handleCreateFromTranscript = async () => {
    if (!pastedTranscript.trim()) return;
    const id = `lec-${Date.now()}`;
    const newLecture: LectureRecord = {
      id,
      title: lectureTitle.trim() || `${selectedSubject.name} · ${new Date().toLocaleDateString()}`,
      subject: selectedSubject.name,
      subjectId: selectedSubject.id,
      dateKey: todayKey,
      createdAt: Date.now(),
      durationSec: Math.max(60, Math.round(pastedTranscript.split(/\s+/).length / 2.2)),
      mimeType: 'text/plain',
      audioBytes: pastedTranscript.length,
      hasAudioBlob: false,
      status: 'pending_sync',
      languageMode,
      bookmarks: [],
      transcript: pastedTranscript.trim(),
    };
    await saveLecture(newLecture);
    setPastedTranscript('');
    setLectureTitle('');
    setShowTextModal(false);
    onLecturesChanged();
    if (isOnline) {
      onSyncNow(newLecture);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Primary Thumb-Friendly Offline Recorder Console */}
      <section className="lg:col-span-7 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
        {/* Editorial Studio Header Visual */}
        <div className="relative h-36 sm:h-44 w-full overflow-hidden bg-slate-900">
          <img
            src="/src/assets/images/studio_acoustic_hero_1795297726132.jpg"
            alt="Acoustic studio microphone and lecture desk"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center opacity-85"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/60 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:px-8 sm:pb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                Offline Lecture Recorder
              </h1>
              <p className="mt-0.5 text-xs sm:text-sm text-slate-300">
                4h continuous · ~7.2 MB/hr Voice Opus · Cycle resets in <span className="font-mono-tabular text-white">{countdownText}</span>
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-900/90 border border-slate-700/80 rounded-lg backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setLanguageMode('bilingual_ur')}
                disabled={recorder.isRecording}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  languageMode === 'bilingual_ur'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                English + Urdu
              </button>
              <button
                type="button"
                onClick={() => setLanguageMode('en')}
                disabled={recorder.isRecording}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer whitespace-nowrap ${
                  languageMode === 'en'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                English Only
              </button>
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-8 space-y-5">
          {/* Subject & Recording Frequency Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                Subject (24h Auto-Save Folder)
              </label>
              <div className="flex flex-wrap gap-1.5">
                {subjects.map((subj) => {
                  const selected = subj.id === selectedSubject.id;
                  return (
                    <button
                      key={subj.id}
                      type="button"
                      disabled={recorder.isRecording}
                      onClick={() => setSelectedSubjectId(subj.id)}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] rounded-xl text-xs font-medium border transition-colors cursor-pointer disabled:opacity-60 ${
                        selected
                          ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                          : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span
                        className="w-2 h-2 rounded-sm shrink-0"
                        style={{ backgroundColor: subj.accentHex }}
                      />
                      <span className="truncate max-w-[140px]">{subj.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label
                htmlFor="quality-preset-select"
                className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5"
              >
                Recording Frequency &amp; Bitrate
              </label>
              <select
                id="quality-preset-select"
                value={quality}
                disabled={recorder.isRecording}
                onChange={(e) => setQuality(e.target.value as RecordingQuality)}
                className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs sm:text-sm font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30 disabled:opacity-60"
              >
                {(Object.keys(QUALITY_PRESETS) as RecordingQuality[]).map((key) => (
                  <option key={key} value={key}>
                    {QUALITY_PRESETS[key].label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Lecture Title Input */}
          <div>
            <label htmlFor="lecture-title-input" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              Lecture or Meeting Title (optional)
            </label>
            <input
              id="lecture-title-input"
              type="text"
              value={lectureTitle}
              onChange={(e) => setLectureTitle(e.target.value)}
              disabled={recorder.isRecording}
              placeholder={`e.g., ${selectedSubject.name} · Week 6`}
              className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30 focus:border-blue-600"
            />
          </div>

          {/* Acoustic Studio Deck + Dual-Layer Canvas Spectrum */}
          <div className="rounded-2xl bg-slate-950 border border-slate-800 text-white p-6 flex flex-col items-center">
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-400">
              {recorder.isRecording && !recorder.isPaused ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-red-400 font-medium">Recording offline</span>
                </>
              ) : recorder.isPaused ? (
                <span className="text-amber-300 font-medium">Recording paused</span>
              ) : (
                <span>{selectedSubject.name}</span>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular text-sky-300">
                {recorder.isRecording
                  ? `${(recorder.activeSampleRate / 1000).toFixed(1)} kHz · ${Math.round(activePreset.bitrate / 1000)} kbps`
                  : activePreset.badge}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{formatBytes(recorder.recordedBytes)}</span>
              {recorder.wakeLockActive && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>Screen awake</span>
                </>
              )}
            </div>

            <div className="mt-2.5 text-4xl sm:text-5xl font-semibold tracking-tight font-mono-tabular">
              {formatDuration(recorder.durationSec)}
            </div>

            {/* High-DPI Dual-Layer Spectrum & Oscilloscope Canvas */}
            <canvas
              ref={canvasRef}
              className="mt-5 w-full h-[104px] block"
              aria-label="Live microphone frequency spectrum and oscilloscope waveform"
            />

            {/* Ergonomic Thumb-Zone Primary Controls */}
            <div className="mt-5 flex items-center justify-center gap-4">
              {!recorder.isRecording ? (
                <button
                  type="button"
                  onClick={() =>
                    void recorder.startRecording(lectureTitle, languageMode, selectedSubject, quality)
                  }
                  className="flex items-center justify-center gap-3 min-h-[56px] px-8 rounded-full bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white font-semibold text-base shadow-lg shadow-red-600/25 transition-all cursor-pointer"
                >
                  <Mic className="w-5 h-5" />
                  <span>Push to Record</span>
                </button>
              ) : (
                <>
                  {recorder.isPaused ? (
                    <button
                      type="button"
                      onClick={recorder.resumeRecording}
                      className="flex items-center justify-center gap-2 min-h-[52px] px-6 rounded-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold cursor-pointer"
                    >
                      <Play className="w-4 h-4" />
                      <span>Resume</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={recorder.pauseRecording}
                      className="flex items-center justify-center gap-2 min-h-[52px] px-6 rounded-full bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold cursor-pointer"
                    >
                      <Pause className="w-4 h-4" />
                      <span>Pause</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={recorder.stopRecording}
                    className="flex items-center justify-center gap-2 min-h-[52px] px-7 rounded-full bg-red-600 hover:bg-red-700 text-white text-sm font-semibold cursor-pointer"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    <span>Finish &amp; Save</span>
                  </button>
                </>
              )}
            </div>

            {/* Live Speech Caption Preview when active */}
            {recorder.isRecording && recorder.liveTranscript && (
              <div className="mt-5 w-full rounded-xl bg-slate-900/90 border border-slate-800 p-3 text-left">
                <div className="text-[11px] font-medium text-slate-400 mb-1">
                  Live Speech Monitor
                </div>
                <p className="text-xs text-slate-200 leading-relaxed line-clamp-3">
                  {recorder.liveTranscript}
                </p>
              </div>
            )}
          </div>

          {/* Live Bookmarking Strip during long lectures */}
          {recorder.isRecording && (
            <div className="pt-5 border-t border-slate-200 dark:border-slate-800">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
                Mark important moments during lecture
              </div>
              <div className="flex flex-wrap gap-2">
                {['Assignment Announced', 'Exam Topic', 'Quiz Hint', 'Key Formula'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => recorder.addBookmark(tag)}
                    className="px-3 py-1.5 min-h-[38px] rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                  >
                    + {tag}
                  </button>
                ))}
              </div>
              <div className="mt-2.5 flex gap-2">
                <input
                  type="text"
                  value={bookmarkInput}
                  onChange={(e) => setBookmarkInput(e.target.value)}
                  placeholder="Custom timestamp note..."
                  className="flex-1 min-h-[40px] px-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-xs text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (bookmarkInput.trim()) {
                      recorder.addBookmark(bookmarkInput);
                      setBookmarkInput('');
                    }
                  }}
                  className="flex items-center gap-1.5 px-3.5 min-h-[40px] rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-medium cursor-pointer"
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                  <span>Mark</span>
                </button>
              </div>
              {recorder.bookmarks.length > 0 && (
                <div className="mt-3 space-y-1">
                  {recorder.bookmarks.map((bm) => (
                    <div key={bm.id} className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
                      <span className="font-mono-tabular text-blue-600 dark:text-blue-400">
                        {formatDuration(bm.timestampSec)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{bm.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {recorder.error && (
            <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300">
              {recorder.error}
            </div>
          )}

          {/* Secondary Import Actions */}
          <div className="pt-5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={(e) => void handleFileImport(e)}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={recorder.isRecording}
                className="flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Import Long Audio</span>
              </button>
              <button
                type="button"
                onClick={() => setShowTextModal(true)}
                disabled={recorder.isRecording}
                className="flex items-center gap-2 px-3.5 py-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
              >
                <FileText className="w-3.5 h-3.5" />
                <span>Paste Lecture Text</span>
              </button>
            </div>
            {storageInfo && (
              <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                {storageInfo.usedMB} MB used · 2-Yr Archive Ready (~65 MB / 1,456 lectures)
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Right Column: Auto-Sync Queue & What AI Generates */}
      <aside className="lg:col-span-5 space-y-6">
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Auto-Sync & AI Queue
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isOnline ? 'Connected' : 'Offline Mode'}
            </span>
          </div>

          {syncingLectureId && (
            <div className="mt-4 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 p-3.5 flex items-center gap-3">
              <RefreshCw className="w-4 h-4 text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
              <div className="text-xs text-blue-900 dark:text-blue-200">
                <div className="font-semibold">Processing Lecture Automatically</div>
                <div className="mt-0.5 opacity-85">{syncStage || 'Syncing...'}</div>
              </div>
            </div>
          )}

          {queuedLectures.length === 0 ? (
            <div className="mt-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-slate-400" />
              <p>No recordings waiting in offline queue.</p>
              <p className="mt-1">Record offline anytime — AI processing starts automatically when internet returns.</p>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
              {queuedLectures.map((lec) => (
                <li key={lec.id} className="py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onOpenLecture(lec.id)}
                      className="text-sm font-medium text-slate-900 dark:text-slate-100 hover:text-blue-600 truncate block text-left cursor-pointer"
                    >
                      {lec.title}
                    </button>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <FileAudio className="w-3 h-3 shrink-0" />
                      <span className="font-mono-tabular">{formatDuration(lec.durationSec)}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">{formatBytes(lec.audioBytes)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {lec.status === 'error'
                          ? 'Needs Retry'
                          : lec.status === 'pending_sync'
                            ? isOnline
                              ? 'Queued'
                              : 'Waiting for Internet'
                            : lec.status === 'transcribing'
                              ? 'Transcribing'
                              : 'Analyzing'}
                      </span>
                    </div>
                    {lec.errorMessage && (
                      <p className="mt-1 text-xs text-red-600 dark:text-red-400 line-clamp-2">
                        {lec.errorMessage}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={!isOnline || syncingLectureId === lec.id}
                    onClick={() => onSyncNow(lec)}
                    className="flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] rounded-lg bg-slate-900 dark:bg-blue-600 text-white text-xs font-medium disabled:opacity-40 cursor-pointer shrink-0"
                  >
                    <CloudUpload className="w-3.5 h-3.5" />
                    <span>{lec.status === 'error' ? 'Retry' : 'Process'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Automated Deliverables Summary */}
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            5 Automated Deliverables per Lecture
          </h2>
          <ol className="mt-3 space-y-2.5 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
            <li>
              <span className="font-semibold text-slate-900 dark:text-slate-100">01. Complete Lecture Notes</span> — Structured outline, core definitions, examples, and formulas.
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-slate-100">02. Solved Assignment PDF</span> — Step-by-step worked solution with AI diagrams and references.
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-slate-100">03. Action Tasks</span> — Extracted homework deadlines and prep items synced to Tasks.
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-slate-100">04. Interactive Quiz</span> — Self-test MCQs with instant grading and explanations.
            </li>
            <li>
              <span className="font-semibold text-slate-900 dark:text-slate-100">05. New Live Research</span> — Web-grounded breakthroughs, expert insights, and open questions.
            </li>
          </ol>
        </div>
      </aside>

      {/* Paste Lecture Transcript Modal */}
      {showTextModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Analyze Lecture Transcript or Notes
            </h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Paste a lecture transcript or rough class notes to run the full AI pipeline (Notes, Illustrated Assignment PDF, Tasks, Quiz, and Live Web Research).
            </p>
            <textarea
              rows={7}
              value={pastedTranscript}
              onChange={(e) => setPastedTranscript(e.target.value)}
              placeholder="Paste lecture transcript here..."
              className="mt-3 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowTextModal(false)}
                className="px-4 py-2 min-h-[42px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreateFromTranscript()}
                className="px-4 py-2 min-h-[42px] rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold cursor-pointer"
              >
                Save & Process
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
