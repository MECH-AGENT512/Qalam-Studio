import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Circle,
  CloudUpload,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  Globe,
  HelpCircle,
  RefreshCw,
} from 'lucide-react';
import { assembleAudioBlob, deleteAudioChunksForLecture, saveLecture, saveTasks } from '../lib/db';
import { exportAssignmentPdf } from '../lib/pdfExport';
import type { ExtractedTask, LectureRecord } from '../types';

interface LectureDetailProps {
  lecture: LectureRecord;
  tasks: ExtractedTask[];
  isOnline: boolean;
  isSyncing: boolean;
  onBack: () => void;
  onSyncNow: (lecture: LectureRecord) => void;
  onRefresh: () => void;
}

type DetailTab = 'notes' | 'assignments' | 'tasks' | 'quiz' | 'research' | 'transcript';

export const LectureDetail: React.FC<LectureDetailProps> = ({
  lecture,
  tasks,
  isOnline,
  isSyncing,
  onBack,
  onSyncNow,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTab>(
    lecture.status === 'completed' ? 'notes' : 'transcript'
  );
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [exportingPdfId, setExportingPdfId] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    if (lecture.hasAudioBlob) {
      assembleAudioBlob(lecture.id, lecture.mimeType).then((blob) => {
        if (blob) {
          url = URL.createObjectURL(blob);
          setAudioUrl(url);
        }
      });
    }
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [lecture.id, lecture.hasAudioBlob, lecture.mimeType]);

  const lectureTasks = tasks.filter((t) => t.lectureId === lecture.id);

  const toggleTask = async (task: ExtractedTask) => {
    await saveTasks([{ ...task, completed: !task.completed }]);
    onRefresh();
  };

  const selectQuizOption = async (questionId: string, optionIdx: number) => {
    const nextAnswers = { ...(lecture.quizAnswers || {}), [questionId]: optionIdx };
    await saveLecture({ ...lecture, quizAnswers: nextAnswers });
    onRefresh();
  };

  const resetQuiz = async () => {
    await saveLecture({ ...lecture, quizAnswers: {} });
    onRefresh();
  };

  const toggleKeepAudio = async () => {
    const nextKeep = !lecture.keepAudioOffline;
    await saveLecture({ ...lecture, keepAudioOffline: nextKeep });
    onRefresh();
  };

  const handleFreeLectureAudio = async () => {
    await deleteAudioChunksForLecture(lecture.id);
    await saveLecture({
      ...lecture,
      hasAudioBlob: false,
      keepAudioOffline: false,
      audioFreedAt: Date.now(),
    });
    setAudioUrl(null);
    onRefresh();
  };

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Clipboard unavailable in restricted context
    }
  };

  const quizQuestions = lecture.quiz || [];
  const answeredCount = quizQuestions.filter(
    (q) => lecture.quizAnswers && typeof lecture.quizAnswers[q.id] === 'number'
  ).length;
  const correctCount = quizQuestions.filter(
    (q) => lecture.quizAnswers && lecture.quizAnswers[q.id] === q.correctIndex
  ).length;

  return (
    <div className="space-y-6">
      {/* Detail Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer shrink-0"
            aria-label="Back to lectures"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {lecture.title}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{lecture.subject}</span>
              <span aria-hidden="true">·</span>
              <span>{new Date(lecture.createdAt).toLocaleString()}</span>
              <span aria-hidden="true">·</span>
              <span>{lecture.languageMode === 'bilingual_ur' ? 'English + Urdu' : 'English'}</span>
            </div>
          </div>
        </div>

        {(lecture.status !== 'completed' || lecture.transcript) && (
          <button
            type="button"
            disabled={!isOnline || isSyncing}
            onClick={() => onSyncNow(lecture)}
            className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-xs font-semibold cursor-pointer shrink-0"
          >
            {isSyncing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Processing AI Deliverables...</span>
              </>
            ) : (
              <>
                <CloudUpload className="w-4 h-4" />
                <span>{lecture.status === 'completed' ? 'Re-Analyze Lecture' : 'Process Now with AI'}</span>
              </>
            )}
          </button>
        )}
      </div>

      {/* Audio Playback Bar (works 100% offline from IndexedDB) */}
      {audioUrl ? (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
            Offline Audio
          </span>
          <audio controls src={audioUrl} className="w-full h-10" />
          <div className="flex items-center gap-2 shrink-0">
            {lecture.status === 'completed' && (
              <>
                <button
                  type="button"
                  onClick={() => void toggleKeepAudio()}
                  className={`px-3 py-2 min-h-[40px] rounded-xl border text-xs font-medium cursor-pointer ${
                    lecture.keepAudioOffline
                      ? 'border-blue-600 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {lecture.keepAudioOffline ? 'Audio Pinned' : 'Pin Audio'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleFreeLectureAudio()}
                  className="px-3 py-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Free Audio
                </button>
              </>
            )}
            <a
              href={audioUrl}
              download={`${lecture.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.webm`}
              className="flex items-center justify-center gap-1.5 px-3 py-2 min-h-[40px] rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Save</span>
            </a>
          </div>
        </div>
      ) : (
        lecture.audioFreedAt && (
          <div className="rounded-2xl bg-slate-100/80 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 text-xs text-slate-600 dark:text-slate-400">
            Audio compacted after AI sync to save mobile storage — full transcript, notes, solved PDF, quiz &amp; research are permanently saved.
          </div>
        )
      )}

      {/* Horizontal Segmented Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-xl overflow-x-auto">
        {(
          [
            { id: 'notes', label: 'Notes' },
            { id: 'assignments', label: 'Assignment PDF' },
            { id: 'tasks', label: `Tasks (${lectureTasks.length})` },
            { id: 'quiz', label: `Quiz (${quizQuestions.length})` },
            { id: 'research', label: 'AI Research' },
            { id: 'transcript', label: 'Transcript' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3.5 py-2 min-h-[40px] text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              activeTab === tab.id
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-8 shadow-sm">
        {/* 1. NOTES */}
        {activeTab === 'notes' && (
          <div>
            {!lecture.notes ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Notes will appear here automatically once this lecture is processed online.
              </p>
            ) : (
              <div className="space-y-8 max-w-3xl">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    Executive Summary & Study Notes
                  </h2>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy(
                        `${lecture.title}\n\n${lecture.notes?.executiveSummary || ''}\n\n${(lecture.notes?.sections || [])
                          .map(
                            (s) =>
                              `## ${s.heading}\n${s.detailedExplanation}\n- ${(s.keyPoints || []).join('\n- ')}`
                          )
                          .join('\n\n')}`,
                        'notes'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    {copiedId === 'notes' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === 'notes' ? 'Copied' : 'Copy Notes'}</span>
                  </button>
                </div>

                <p className="font-serif-reading text-base sm:text-[17px] leading-relaxed text-slate-700 dark:text-slate-200">
                  {lecture.notes.executiveSummary}
                </p>

                <div className="divide-y divide-slate-100 dark:divide-slate-800 space-y-6">
                  {(lecture.notes.sections || []).map((sec, idx) => (
                    <section key={idx} className="pt-6 first:pt-0 space-y-3">
                      <h3 className="text-base sm:text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {String(idx + 1).padStart(2, '0')}. {sec.heading}
                      </h3>
                      <p className="font-serif-reading text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                        {sec.detailedExplanation}
                      </p>
                      {(sec.keyPoints || []).length > 0 && (
                        <ul className="space-y-1.5 pl-5 list-disc text-sm text-slate-700 dark:text-slate-300">
                          {(sec.keyPoints || []).map((pt, pIdx) => (
                            <li key={pIdx}>{pt}</li>
                          ))}
                        </ul>
                      )}
                      {(sec.examples || []).length > 0 && (
                        <div className="rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-4 text-xs sm:text-sm text-slate-700 dark:text-slate-300 space-y-1">
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            Applied Examples
                          </div>
                          {(sec.examples || []).map((ex, eIdx) => (
                            <p key={eIdx}>{ex}</p>
                          ))}
                        </div>
                      )}
                    </section>
                  ))}
                </div>

                {(lecture.notes.formulasOrFrameworks || []).length > 0 && (
                  <div className="pt-6 border-t border-slate-200 dark:border-slate-800">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      Formulas, Models & Key Frameworks
                    </h3>
                    <ul className="space-y-1.5 font-mono-tabular text-xs sm:text-sm text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 p-4 rounded-xl border border-slate-200 dark:border-slate-800">
                      {(lecture.notes.formulasOrFrameworks || []).map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(lecture.notes.keyTakeaways || []).length > 0 && (
                  <div className="pt-6 border-t border-slate-200 dark:border-slate-800">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      Exam & Professional Takeaways
                    </h3>
                    <ul className="space-y-1.5 list-disc pl-5 text-sm text-slate-700 dark:text-slate-300">
                      {(lecture.notes.keyTakeaways || []).map((tk, i) => (
                        <li key={i}>{tk}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* 2. SOLVED ASSIGNMENTS + PDF WITH PICTURES */}
        {activeTab === 'assignments' && (
          <div className="space-y-8">
            {!lecture.assignments || lecture.assignments.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Solved assignments with generated diagrams and PDF export will appear here after AI processing.
              </p>
            ) : (
              lecture.assignments.map((asg) => (
                <article
                  key={asg.id}
                  className="space-y-5 pb-8 border-b border-slate-200 dark:border-slate-800 last:border-b-0 last:pb-0"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                        {asg.title}
                      </h2>
                      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                        {asg.promptSummary}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={exportingPdfId === asg.id}
                      onClick={async () => {
                        setExportingPdfId(asg.id);
                        try {
                          await exportAssignmentPdf(asg, lecture.title);
                        } finally {
                          setExportingPdfId(null);
                        }
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-slate-900 dark:bg-blue-600 hover:opacity-90 text-white text-xs font-semibold shrink-0 cursor-pointer"
                    >
                      <FileDown className="w-4 h-4" />
                      <span>
                        {exportingPdfId === asg.id ? 'Building PDF...' : 'Download Solved PDF (with Pictures)'}
                      </span>
                    </button>
                  </div>

                  {(asg.requirements || []).length > 0 && (
                    <div className="rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-4">
                      <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
                        Required Deliverables
                      </h3>
                      <ul className="space-y-1 list-disc pl-5 text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                        {(asg.requirements || []).map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {asg.generatedImageUrl && (
                    <figure className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3 max-w-2xl">
                      <img
                        src={asg.generatedImageUrl}
                        alt={asg.imageCaption || asg.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-auto rounded-xl object-contain bg-slate-50"
                      />
                      {asg.imageCaption && (
                        <figcaption className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                          Figure: {asg.imageCaption}
                        </figcaption>
                      )}
                    </figure>
                  )}

                  <div className="font-serif-reading text-[15px] leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-line max-w-3xl">
                    {asg.solvedSolutionMarkdown}
                  </div>

                  {(asg.referencesUsed || []).length > 0 && (
                    <div className="pt-3">
                      <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                        Research Sources Cited
                      </h4>
                      <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400 list-decimal pl-5">
                        {(asg.referencesUsed || []).map((ref, i) => (
                          <li key={i}>{ref}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>
        )}

        {/* 3. TASKS */}
        {activeTab === 'tasks' && (
          <div className="space-y-3">
            {lectureTasks.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                No tasks extracted for this lecture yet.
              </p>
            ) : (
              lectureTasks.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void toggleTask(t)}
                  className="w-full min-h-[56px] p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  {t.completed ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-400 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm font-medium ${
                        t.completed
                          ? 'line-through text-slate-400'
                          : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {t.title}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <span className="capitalize">{t.priority} priority</span>
                      <span aria-hidden="true"> · </span>
                      <span>{t.dueHint}</span>
                      <span aria-hidden="true"> · </span>
                      <span className="capitalize">{t.category}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* 4. INTERACTIVE QUIZ */}
        {activeTab === 'quiz' && (
          <div className="space-y-6 max-w-3xl">
            {quizQuestions.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Quiz questions will be generated after AI processing completes.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                    <HelpCircle className="w-4 h-4 text-blue-600" />
                    <span className="font-mono-tabular">
                      Score: {correctCount}/{quizQuestions.length} ({answeredCount} answered)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void resetQuiz()}
                    className="px-3 py-1.5 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    Reset Quiz
                  </button>
                </div>

                {quizQuestions.map((q, qIdx) => {
                  const selected = lecture.quizAnswers?.[q.id];
                  const hasAnswered = typeof selected === 'number';
                  return (
                    <div key={q.id} className="space-y-3 pb-6 border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Question {qIdx + 1} · <span className="capitalize">{q.difficulty}</span>
                      </div>
                      <h3 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100">
                        {q.question}
                      </h3>
                      <div className="grid grid-cols-1 gap-2">
                        {(q.options || []).map((opt, oIdx) => {
                          const isSelected = selected === oIdx;
                          const isCorrect = oIdx === q.correctIndex;
                          let style =
                            'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800';
                          if (hasAnswered) {
                            if (isCorrect) {
                              style =
                                'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 font-medium';
                            } else if (isSelected) {
                              style =
                                'border-red-500 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200';
                            }
                          }
                          return (
                            <button
                              key={oIdx}
                              type="button"
                              onClick={() => void selectQuizOption(q.id, oIdx)}
                              className={`w-full min-h-[44px] px-4 py-2.5 rounded-xl border text-left text-xs sm:text-sm transition-colors cursor-pointer ${style}`}
                            >
                              {opt}
                            </button>
                          );
                        })}
                      </div>
                      {hasAnswered && (
                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-950 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                          {q.explanation}
                        </p>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {/* 5. AI LIVE RESEARCH & NEW FRONTIERS */}
        {activeTab === 'research' && (
          <div className="space-y-6 max-w-3xl">
            {!lecture.research ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Live web research, emerging breakthroughs, and professional perspectives will appear after AI processing.
              </p>
            ) : (
              <>
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    New Research & Live Frontiers
                  </h2>
                  <p className="mt-2 font-serif-reading text-[15px] leading-relaxed text-slate-700 dark:text-slate-200">
                    {lecture.research.overview}
                  </p>
                </div>

                {lecture.research.newFrontiers?.length > 0 && (
                  <div className="space-y-4">
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Emerging Developments & Opportunities
                    </h3>
                    {lecture.research.newFrontiers.map((item, i) => (
                      <div
                        key={i}
                        className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60 p-4 space-y-1.5"
                      >
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {item.topic}
                        </h4>
                        <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300">
                          {item.summary}
                        </p>
                        <p className="text-xs text-blue-700 dark:text-blue-400 font-medium">
                          Why it matters: {item.whyItMatters}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {lecture.research.professionalPerspectives?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      What Industry Professionals & Researchers Say
                    </h3>
                    <ul className="space-y-2 list-disc pl-5 text-sm text-slate-700 dark:text-slate-300">
                      {lecture.research.professionalPerspectives.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {lecture.research.openResearchQuestions?.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                      Open Research Questions You Can Explore
                    </h3>
                    <ul className="space-y-1.5 list-decimal pl-5 text-sm text-slate-700 dark:text-slate-300">
                      {lecture.research.openResearchQuestions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {lecture.research.citations?.length > 0 && (
                  <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                    <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5" />
                      <span>Verified Web Sources</span>
                    </h3>
                    <ul className="space-y-1.5">
                      {lecture.research.citations.map((c, i) => (
                        <li key={i}>
                          <a
                            href={c.uri}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            <span>{c.title}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* 6. TRANSCRIPT */}
        {activeTab === 'transcript' && (
          <div className="space-y-5 max-w-3xl">
            {(lecture.bookmarks || []).length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                  Marked Lecture Highlights
                </h3>
                <div className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                  {(lecture.bookmarks || []).map((bm) => (
                    <div key={bm.id}>
                      <span className="font-mono-tabular text-blue-600 dark:text-blue-400">
                        {Math.floor(bm.timestampSec / 60)}m {bm.timestampSec % 60}s
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>{bm.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {lecture.transcript ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Full Transcript
                  </h3>
                  <button
                    type="button"
                    onClick={() => void handleCopy(lecture.transcript || '', 'transcript')}
                    className="flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                  >
                    {copiedId === 'transcript' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedId === 'transcript' ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
                <p className="font-serif-reading text-sm sm:text-[15px] leading-relaxed text-slate-700 dark:text-slate-300 whitespace-pre-line">
                  {lecture.transcript}
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Audio is safely stored offline on your device. Transcript will appear once synced online.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
