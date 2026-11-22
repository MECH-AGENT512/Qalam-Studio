import { useCallback, useEffect, useState } from 'react';
import {
  getAllDailyArchives,
  getLocalDateKey,
  saveDailyArchive,
} from '../lib/db';
import type {
  DailyCycleArchive,
  DailyDigest,
  DailySubjectSnapshot,
  LectureRecord,
  SubjectItem,
} from '../types';

function getDayBounds(dateKey: string): { start: number; end: number; dayName: string } {
  const [y, m, d] = dateKey.split('-').map(Number);
  const startDt = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
  const endDt = new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
  const dayName = startDt.toLocaleDateString(undefined, { weekday: 'long' });
  return {
    start: startDt.getTime(),
    end: endDt.getTime(),
    dayName,
  };
}

function formatCountdown(msRemaining: number): string {
  const clamped = Math.max(0, Math.floor(msRemaining / 1000));
  const hrs = Math.floor(clamped / 3600);
  const mins = Math.floor((clamped % 3600) / 60);
  const secs = clamped % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function buildArchiveFromLectures(
  dateKey: string,
  dayLectures: LectureRecord[],
  subjects: SubjectItem[],
  existingDigest?: DailyDigest
): DailyCycleArchive {
  const bounds = getDayBounds(dateKey);
  const bySubject = new Map<string, DailySubjectSnapshot>();

  for (const subj of subjects) {
    bySubject.set(subj.id, {
      subjectId: subj.id,
      subjectName: subj.name,
      accentHex: subj.accentHex,
      lectureIds: [],
      totalDurationSec: 0,
    });
  }

  for (const lec of dayLectures) {
    const key = lec.subjectId || `subj-name-${lec.subject.toLowerCase()}`;
    const matched =
      bySubject.get(key) ||
      Array.from(bySubject.values()).find(
        (s) => s.subjectName.toLowerCase() === lec.subject.toLowerCase()
      );
    if (matched) {
      matched.lectureIds.push(lec.id);
      matched.totalDurationSec += lec.durationSec || 0;
    } else {
      bySubject.set(key, {
        subjectId: key,
        subjectName: lec.subject || 'General Lecture',
        accentHex: '#475569',
        lectureIds: [lec.id],
        totalDurationSec: lec.durationSec || 0,
      });
    }
  }

  const activeSnapshots = Array.from(bySubject.values()).filter(
    (s) => s.lectureIds.length > 0
  );

  return {
    dateKey,
    dayName: bounds.dayName,
    cycleStartAt: bounds.start,
    cycleEndAt: bounds.end,
    archivedAt: Date.now(),
    totalLectures: dayLectures.length,
    totalDurationSec: dayLectures.reduce((acc, l) => acc + (l.durationSec || 0), 0),
    subjects: activeSnapshots,
    digest: existingDigest,
  };
}

export function useDailyCycle(lectures: LectureRecord[], subjects: SubjectItem[]) {
  const [todayKey, setTodayKey] = useState<string>(() => getLocalDateKey());
  const [countdownText, setCountdownText] = useState<string>('24:00:00');
  const [cycleProgressPct, setCycleProgressPct] = useState<number>(0);
  const [archives, setArchives] = useState<DailyCycleArchive[]>([]);

  const refreshArchives = useCallback(async () => {
    const all = await getAllDailyArchives();
    setArchives(all);
    return all;
  }, []);

  // Live 24-hour countdown timer and midnight rollover detector
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const currentKey = getLocalDateKey(now);
      if (currentKey !== todayKey) {
        setTodayKey(currentKey);
      }
      const { start, end } = getDayBounds(currentKey);
      const total = end - start;
      const elapsed = Math.max(0, Math.min(total, now - start));
      setCycleProgressPct(Math.round((elapsed / total) * 1000) / 10);
      setCountdownText(formatCountdown(end - now));
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [todayKey]);

  // Automatically sync & seal every day's subject-grouped lectures into IndexedDB archives
  useEffect(() => {
    let cancelled = false;
    const syncCycles = async () => {
      const existing = await getAllDailyArchives();
      const existingMap = new Map(existing.map((a) => [a.dateKey, a]));

      const groupedByDate = new Map<string, LectureRecord[]>();
      for (const lec of lectures) {
        const key = lec.dateKey || getLocalDateKey(lec.createdAt);
        const list = groupedByDate.get(key) || [];
        list.push(lec);
        groupedByDate.set(key, list);
      }

      let changed = false;
      for (const [dateKey, dayLectures] of groupedByDate.entries()) {
        const prev = existingMap.get(dateKey);
        const nextArchive = buildArchiveFromLectures(
          dateKey,
          dayLectures,
          subjects,
          prev?.digest
        );

        const isDifferent =
          !prev ||
          prev.totalLectures !== nextArchive.totalLectures ||
          prev.totalDurationSec !== nextArchive.totalDurationSec ||
          prev.subjects.length !== nextArchive.subjects.length;

        if (isDifferent) {
          await saveDailyArchive(nextArchive);
          changed = true;
        }
      }

      if (!cancelled) {
        if (changed) {
          await refreshArchives();
        } else {
          setArchives(existing);
        }
      }
    };

    void syncCycles();
    return () => {
      cancelled = true;
    };
  }, [lectures, subjects, todayKey, refreshArchives]);

  const saveTodayCycleSnapshot = useCallback(async () => {
    const todayLectures = lectures.filter(
      (l) => (l.dateKey || getLocalDateKey(l.createdAt)) === todayKey
    );
    const existing = archives.find((a) => a.dateKey === todayKey);
    const snapshot = buildArchiveFromLectures(todayKey, todayLectures, subjects, existing?.digest);
    await saveDailyArchive(snapshot);
    await refreshArchives();
    return snapshot;
  }, [lectures, todayKey, archives, subjects, refreshArchives]);

  const attachDailyDigest = useCallback(
    async (dateKey: string, digest: DailyDigest) => {
      const dayLectures = lectures.filter(
        (l) => (l.dateKey || getLocalDateKey(l.createdAt)) === dateKey
      );
      const updated = buildArchiveFromLectures(dateKey, dayLectures, subjects, digest);
      await saveDailyArchive(updated);
      await refreshArchives();
    },
    [lectures, subjects, refreshArchives]
  );

  return {
    todayKey,
    countdownText,
    cycleProgressPct,
    archives,
    refreshArchives,
    saveTodayCycleSnapshot,
    attachDailyDigest,
  };
}
