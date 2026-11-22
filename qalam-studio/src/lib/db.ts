import type {
  AudioChunkRecord,
  DailyCycleArchive,
  ExtractedTask,
  LectureRecord,
  SubjectItem,
} from '../types';

const DB_NAME = 'qalam-studio-db';
const DB_VERSION = 2;

const DEFAULT_SUBJECTS: SubjectItem[] = [
  { id: 'subj-cs', name: 'Computer Science', code: 'CS', accentHex: '#2563EB', createdAt: 1 },
  { id: 'subj-math', name: 'Mathematics', code: 'MATH', accentHex: '#0284C7', createdAt: 2 },
  { id: 'subj-phy', name: 'Physics', code: 'PHY', accentHex: '#059669', createdAt: 3 },
  { id: 'subj-eng', name: 'Engineering', code: 'ENG', accentHex: '#D97706', createdAt: 4 },
  { id: 'subj-gen', name: 'General Lecture', code: 'GEN', accentHex: '#475569', createdAt: 5 },
];

export function getLocalDateKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('lectures')) {
        const lectureStore = db.createObjectStore('lectures', { keyPath: 'id' });
        lectureStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('audioChunks')) {
        const chunkStore = db.createObjectStore('audioChunks', { keyPath: 'id' });
        chunkStore.createIndex('lectureId', 'lectureId', { unique: false });
      }
      if (!db.objectStoreNames.contains('tasks')) {
        const taskStore = db.createObjectStore('tasks', { keyPath: 'id' });
        taskStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('subjects')) {
        db.createObjectStore('subjects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('dailyArchives')) {
        const archiveStore = db.createObjectStore('dailyArchives', { keyPath: 'dateKey' });
        archiveStore.createIndex('cycleStartAt', 'cycleStartAt', { unique: false });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => {
        dbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

export async function saveLecture(lecture: LectureRecord): Promise<void> {
  const db = await openDB();
  const withDateKey: LectureRecord = {
    ...lecture,
    dateKey: lecture.dateKey || getLocalDateKey(lecture.createdAt),
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readwrite');
    tx.objectStore('lectures').put(withDateKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllLectures(): Promise<LectureRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readonly');
    const req = tx.objectStore('lectures').getAll();
    req.onsuccess = () => {
      const rows = ((req.result as LectureRecord[]) || []).map((r) => ({
        ...r,
        dateKey: r.dateKey || getLocalDateKey(r.createdAt),
      }));
      rows.sort((a, b) => b.createdAt - a.createdAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getLectureById(id: string): Promise<LectureRecord | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('lectures', 'readonly');
    const req = tx.objectStore('lectures').get(id);
    req.onsuccess = () => resolve(req.result as LectureRecord | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteLectureAndChunks(lectureId: string): Promise<void> {
  const db = await openDB();
  const chunks = await getChunksForLecture(lectureId);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['lectures', 'audioChunks'], 'readwrite');
    tx.objectStore('lectures').delete(lectureId);
    const chunkStore = tx.objectStore('audioChunks');
    for (const c of chunks) {
      chunkStore.delete(c.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function appendAudioChunk(chunk: AudioChunkRecord): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audioChunks', 'readwrite');
    tx.objectStore('audioChunks').put(chunk);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getChunksForLecture(lectureId: string): Promise<AudioChunkRecord[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audioChunks', 'readonly');
    const idx = tx.objectStore('audioChunks').index('lectureId');
    const req = idx.getAll(lectureId);
    req.onsuccess = () => {
      const rows = (req.result as AudioChunkRecord[]) || [];
      rows.sort((a, b) => a.index - b.index);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function assembleAudioBlob(lectureId: string, mimeType: string): Promise<Blob | null> {
  const chunks = await getChunksForLecture(lectureId);
  if (chunks.length === 0) return null;
  return new Blob(
    chunks.map((c) => c.data),
    { type: mimeType || chunks[0].data.type || 'audio/webm' }
  );
}

export async function saveTasks(tasks: ExtractedTask[]): Promise<void> {
  if (tasks.length === 0) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tasks', 'readwrite');
    const store = tx.objectStore('tasks');
    for (const t of tasks) {
      store.put(t);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllTasks(): Promise<ExtractedTask[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tasks', 'readonly');
    const req = tx.objectStore('tasks').getAll();
    req.onsuccess = () => {
      const rows = (req.result as ExtractedTask[]) || [];
      rows.sort((a, b) => b.createdAt - a.createdAt);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTaskById(taskId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('tasks', 'readwrite');
    tx.objectStore('tasks').delete(taskId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllSubjects(): Promise<SubjectItem[]> {
  const db = await openDB();
  const rows: SubjectItem[] = await new Promise((resolve, reject) => {
    const tx = db.transaction('subjects', 'readonly');
    const req = tx.objectStore('subjects').getAll();
    req.onsuccess = () => resolve((req.result as SubjectItem[]) || []);
    req.onerror = () => reject(req.error);
  });

  if (rows.length === 0) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('subjects', 'readwrite');
      const store = tx.objectStore('subjects');
      for (const s of DEFAULT_SUBJECTS) {
        store.put(s);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    return DEFAULT_SUBJECTS;
  }

  rows.sort((a, b) => a.createdAt - b.createdAt);
  return rows;
}

export async function saveSubject(subject: SubjectItem): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('subjects', 'readwrite');
    tx.objectStore('subjects').put(subject);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSubjectById(subjectId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('subjects', 'readwrite');
    tx.objectStore('subjects').delete(subjectId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getAllDailyArchives(): Promise<DailyCycleArchive[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('dailyArchives', 'readonly');
    const req = tx.objectStore('dailyArchives').getAll();
    req.onsuccess = () => {
      const rows = (req.result as DailyCycleArchive[]) || [];
      rows.sort((a, b) => b.dateKey.localeCompare(a.dateKey));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveDailyArchive(archive: DailyCycleArchive): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('dailyArchives', 'readwrite');
    tx.objectStore('dailyArchives').put(archive);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getStorageEstimate(): Promise<{
  usedMB: number;
  quotaMB: number;
  persisted: boolean;
} | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  try {
    const [est, persisted] = await Promise.all([
      navigator.storage.estimate(),
      navigator.storage.persisted ? navigator.storage.persisted().catch(() => false) : Promise.resolve(false),
    ]);
    const usedMB = Math.round(((est.usage ?? 0) / (1024 * 1024)) * 10) / 10;
    const quotaMB = Math.round(((est.quota ?? 0) / (1024 * 1024)) * 10) / 10;
    return { usedMB, quotaMB, persisted };
  } catch {
    return null;
  }
}

export async function ensurePersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
  try {
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    if (already) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

const STORAGE_POLICY_KEY = 'qalam-storage-policy-v1';

export interface StoragePolicy {
  autoCompactAfterSync: boolean;
}

export function getStoragePolicy(): StoragePolicy {
  if (typeof localStorage === 'undefined') return { autoCompactAfterSync: true };
  try {
    const raw = localStorage.getItem(STORAGE_POLICY_KEY);
    if (!raw) return { autoCompactAfterSync: true };
    const parsed = JSON.parse(raw) as Partial<StoragePolicy>;
    return {
      autoCompactAfterSync: parsed.autoCompactAfterSync ?? true,
    };
  } catch {
    return { autoCompactAfterSync: true };
  }
}

export function setStoragePolicy(policy: StoragePolicy): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_POLICY_KEY, JSON.stringify(policy));
}

export async function deleteAudioChunksForLecture(lectureId: string): Promise<void> {
  const db = await openDB();
  const chunks = await getChunksForLecture(lectureId);
  if (chunks.length === 0) return;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('audioChunks', 'readwrite');
    const store = tx.objectStore('audioChunks');
    for (const c of chunks) {
      store.delete(c.id);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function compactCompletedAudioChunks(): Promise<{
  freedLectures: number;
  freedBytes: number;
}> {
  const lectures = await getAllLectures();
  let freedLectures = 0;
  let freedBytes = 0;

  for (const lec of lectures) {
    if (lec.status === 'completed' && lec.hasAudioBlob && !lec.keepAudioOffline) {
      await deleteAudioChunksForLecture(lec.id);
      freedLectures += 1;
      freedBytes += lec.audioBytes || 0;
      await saveLecture({
        ...lec,
        hasAudioBlob: false,
        audioFreedAt: Date.now(),
      });
    }
  }

  return { freedLectures, freedBytes };
}
