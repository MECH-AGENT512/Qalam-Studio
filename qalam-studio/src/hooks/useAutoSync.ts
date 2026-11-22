import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assembleAudioBlob,
  deleteAudioChunksForLecture,
  getAllLectures,
  getStoragePolicy,
  saveLecture,
  saveTasks,
} from '../lib/db';
import { safeFetchJson } from '../lib/safeFetchJson';
import type { ExtractedTask, LectureRecord } from '../types';

export function useAutoSync(isOnline: boolean, onLecturesUpdated: () => void) {
  const [syncingLectureId, setSyncingLectureId] = useState<string | null>(null);
  const [syncStage, setSyncStage] = useState<string>('');
  const [syncError, setSyncError] = useState<string | null>(null);
  const isSyncingRef = useRef(false);
  const onLecturesUpdatedRef = useRef(onLecturesUpdated);
  onLecturesUpdatedRef.current = onLecturesUpdated;

  const processLecture = useCallback(
    async (lecture: LectureRecord) => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      setSyncingLectureId(lecture.id);
      setSyncError(null);

      try {
        let transcript = lecture.transcript || '';

        if (!transcript) {
          setSyncStage('Transcribing audio...');
          await saveLecture({ ...lecture, status: 'transcribing', errorMessage: undefined });
          onLecturesUpdatedRef.current();

          const blob = await assembleAudioBlob(lecture.id, lecture.mimeType);
          if (!blob || blob.size === 0) {
            throw new Error('No audio data found locally for this recording.');
          }

          const transRes = await safeFetchJson<{ transcript: string }>('/api/lectures/transcribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'x-mime-type': lecture.mimeType || blob.type || 'audio/webm',
              'x-language-mode': lecture.languageMode,
            },
            body: blob,
          });
          if (!transRes.ok || !transRes.data.transcript) {
            throw new Error(transRes.data.error || 'Transcription failed.');
          }
          transcript = transRes.data.transcript;
        }

        setSyncStage('Generating notes, solved PDF assignment, quiz & live research...');
        await saveLecture({ ...lecture, transcript, status: 'analyzing', errorMessage: undefined });
        onLecturesUpdatedRef.current();

        const analyzeRes = await safeFetchJson<{
          refinedTitle?: string;
          subject?: string;
          notes?: LectureRecord['notes'];
          assignments?: LectureRecord['assignments'];
          quiz?: LectureRecord['quiz'];
          research?: LectureRecord['research'];
          tasks?: ExtractedTask[];
        }>('/api/lectures/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            transcript,
            title: lecture.title,
            languageMode: lecture.languageMode,
            bookmarks: lecture.bookmarks,
          }),
        });
        if (!analyzeRes.ok) {
          throw new Error(analyzeRes.data.error || 'AI analysis failed.');
        }
        const analyzeData = analyzeRes.data;

        const shouldCompactAudio =
          getStoragePolicy().autoCompactAfterSync && !lecture.keepAudioOffline && lecture.hasAudioBlob;

        if (shouldCompactAudio) {
          await deleteAudioChunksForLecture(lecture.id);
        }

        const completed: LectureRecord = {
          ...lecture,
          title: analyzeData.refinedTitle || lecture.title,
          subject: lecture.subjectId ? lecture.subject : analyzeData.subject || lecture.subject,
          hasAudioBlob: shouldCompactAudio ? false : lecture.hasAudioBlob,
          audioFreedAt: shouldCompactAudio ? Date.now() : lecture.audioFreedAt,
          transcript,
          notes: analyzeData.notes,
          assignments: analyzeData.assignments,
          quiz: analyzeData.quiz,
          research: analyzeData.research,
          status: 'completed',
          errorMessage: undefined,
        };
        await saveLecture(completed);

        if (Array.isArray(analyzeData.tasks) && analyzeData.tasks.length > 0) {
          const boundTasks: ExtractedTask[] = analyzeData.tasks.map((t: ExtractedTask) => ({
            ...t,
            lectureId: completed.id,
            lectureTitle: completed.title,
          }));
          await saveTasks(boundTasks);
        }

        onLecturesUpdatedRef.current();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sync failed.';
        setSyncError(msg);
        await saveLecture({
          ...lecture,
          status: 'error',
          errorMessage: msg,
        });
        onLecturesUpdatedRef.current();
      } finally {
        isSyncingRef.current = false;
        setSyncingLectureId(null);
        setSyncStage('');
      }
    },
    []
  );

  const runQueue = useCallback(async () => {
    if (!isOnline || isSyncingRef.current) return;
    try {
      const health = await fetch('/api/health', { cache: 'no-store' });
      if (!health.ok) return;
    } catch {
      return;
    }

    const all = await getAllLectures();
    const pending = all.filter((l) => l.status === 'pending_sync');
    if (pending.length > 0) {
      await processLecture(pending[0]);
    }
  }, [isOnline, processLecture]);

  useEffect(() => {
    if (!isOnline) return;
    runQueue();
    const interval = window.setInterval(runQueue, 15000);
    return () => window.clearInterval(interval);
  }, [isOnline, runQueue]);

  return {
    syncingLectureId,
    syncStage,
    syncError,
    processLecture,
    runQueue,
  };
}
