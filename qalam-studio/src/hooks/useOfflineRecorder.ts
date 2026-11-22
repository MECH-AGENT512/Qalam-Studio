import { useCallback, useEffect, useRef, useState } from 'react';
import { appendAudioChunk, getLocalDateKey, saveLecture } from '../lib/db';
import type {
  LanguageMode,
  LectureBookmark,
  LectureRecord,
  RecordingQuality,
  SubjectItem,
} from '../types';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export const QUALITY_PRESETS: Record<
  RecordingQuality,
  { label: string; sampleRate: number; bitrate: number; mbPerHour: number; badge: string }
> = {
  voice_16: {
    label: '48 kHz · 16 kbps 2-Yr Saver (~7.2 MB/hr)',
    sampleRate: 48000,
    bitrate: 16000,
    mbPerHour: 7.2,
    badge: '48 kHz · 16 kbps · 7.2 MB/hr',
  },
  voice_24: {
    label: '48 kHz · 24 kbps Clear Speech (~10.8 MB/hr)',
    sampleRate: 48000,
    bitrate: 24000,
    mbPerHour: 10.8,
    badge: '48 kHz · 24 kbps · 10.8 MB/hr',
  },
  studio_64: {
    label: '48 kHz · 64 kbps Studio (~28.8 MB/hr)',
    sampleRate: 48000,
    bitrate: 64000,
    mbPerHour: 28.8,
    badge: '48 kHz · 64 kbps · 28.8 MB/hr',
  },
  ultra_128: {
    label: '48 kHz · 128 kbps Ultra HD (~57.6 MB/hr)',
    sampleRate: 48000,
    bitrate: 128000,
    mbPerHour: 57.6,
    badge: '48 kHz · 128 kbps · 57.6 MB/hr',
  },
};

export function useOfflineRecorder(onLectureSaved: () => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [recordedBytes, setRecordedBytes] = useState(0);
  const [bookmarks, setBookmarks] = useState<LectureBookmark[]>([]);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(64).fill(0.05));
  const [waveformSamples, setWaveformSamples] = useState<number[]>(new Array(64).fill(0));
  const [activeSampleRate, setActiveSampleRate] = useState<number>(48000);
  const [liveTranscript, setLiveTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const speechRecRef = useRef<SpeechRecognitionLike | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);

  const lectureIdRef = useRef<string>('');
  const chunkIndexRef = useRef<number>(0);
  const totalBytesRef = useRef<number>(0);
  const accumulatedMsRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const createdAtRef = useRef<number>(0);
  const mimeTypeRef = useRef<string>('audio/webm');
  const titleRef = useRef<string>('');
  const subjectRef = useRef<{ id?: string; name: string }>({ name: 'General Lecture' });
  const langModeRef = useRef<LanguageMode>('en');
  const sampleRateRef = useRef<number>(48000);
  const bitrateKbpsRef = useRef<number>(16);
  const bookmarksRef = useRef<LectureBookmark[]>([]);
  const finalLiveTextRef = useRef<string>('');
  const shouldRunSpeechRef = useRef<boolean>(false);
  const lastVizAtRef = useRef<number>(0);

  const releaseResources = useCallback(() => {
    shouldRunSpeechRef.current = false;
    if (speechRecRef.current) {
      try {
        speechRecRef.current.stop();
      } catch {
        // ignore
      }
      speechRecRef.current = null;
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (timerRef.current) window.clearInterval(timerRef.current);
    rafRef.current = null;
    timerRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => {});
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  }, []);

  useEffect(() => {
    return () => releaseResources();
  }, [releaseResources]);

  const pumpWaveform = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;

    const now = performance.now();
    if (now - lastVizAtRef.current >= 50) {
      lastVizAtRef.current = now;
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freqData);
      const bars = 64;
      const usableBins = Math.floor(freqData.length * 0.72);
      const step = Math.max(1, Math.floor(usableBins / bars));
      const nextFreq: number[] = [];
      for (let i = 0; i < bars; i++) {
        const val = freqData[i * step] || 0;
        nextFreq.push(Math.max(0.05, Math.min(1, val / 185)));
      }
      setAudioLevels(nextFreq);

      const timeData = new Uint8Array(analyser.fftSize);
      analyser.getByteTimeDomainData(timeData);
      const waveStep = Math.max(1, Math.floor(timeData.length / bars));
      const nextWave: number[] = [];
      for (let i = 0; i < bars; i++) {
        const normalized = ((timeData[i * waveStep] ?? 128) - 128) / 128;
        nextWave.push(normalized);
      }
      setWaveformSamples(nextWave);
    }

    rafRef.current = requestAnimationFrame(pumpWaveform);
  }, []);

  const startSpeechPreview = useCallback((languageMode: LanguageMode) => {
    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (!SR) return;

    try {
      const rec = new SR();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = languageMode === 'bilingual_ur' ? 'en-PK' : 'en-US';
      shouldRunSpeechRef.current = true;

      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const res = ev.results[i];
          const text = res[0]?.transcript || '';
          if (res.isFinal) {
            finalLiveTextRef.current = `${finalLiveTextRef.current} ${text}`.trim();
          } else {
            interim += text;
          }
        }
        setLiveTranscript(`${finalLiveTextRef.current} ${interim}`.trim());
      };

      rec.onerror = () => {};
      rec.onend = () => {
        if (shouldRunSpeechRef.current && mediaRecorderRef.current?.state === 'recording') {
          try {
            rec.start();
          } catch {
            // ignore
          }
        }
      };

      rec.start();
      speechRecRef.current = rec;
    } catch {
      // Unsupported
    }
  }, []);

  const startRecording = async (
    customTitle: string,
    languageMode: LanguageMode,
    subject: SubjectItem,
    quality: RecordingQuality = 'voice_16'
  ) => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Microphone recording is not supported in this browser.');
      return;
    }

    const preset = QUALITY_PRESETS[quality];

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: preset.sampleRate,
            sampleSize: 16,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            },
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
      }
      streamRef.current = stream;

      try {
        const nav = navigator as unknown as {
          wakeLock?: { request: (type: string) => Promise<WakeLockSentinelLike> };
        };
        if (nav.wakeLock) {
          wakeLockRef.current = await nav.wakeLock.request('screen');
          setWakeLockActive(true);
        }
      } catch {
        setWakeLockActive(false);
      }

      let audioCtx: AudioContext;
      try {
        audioCtx = new AudioContext({ sampleRate: preset.sampleRate });
      } catch {
        audioCtx = new AudioContext();
      }
      audioCtxRef.current = audioCtx;
      setActiveSampleRate(audioCtx.sampleRate || preset.sampleRate);
      sampleRateRef.current = audioCtx.sampleRate || preset.sampleRate;
      bitrateKbpsRef.current = Math.round(preset.bitrate / 1000);

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      analyserRef.current = analyser;

      const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
      const mimeType = preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType, audioBitsPerSecond: preset.bitrate })
          : new MediaRecorder(stream, { audioBitsPerSecond: preset.bitrate });
      } catch {
        recorder = new MediaRecorder(stream);
      }

      const now = Date.now();
      const lectureId = `lec-${now}`;
      lectureIdRef.current = lectureId;
      createdAtRef.current = now;
      chunkIndexRef.current = 0;
      totalBytesRef.current = 0;
      accumulatedMsRef.current = 0;
      lastTickRef.current = now;
      durationRef.current = 0;
      mimeTypeRef.current = recorder.mimeType || mimeType || 'audio/webm';
      subjectRef.current = { id: subject.id, name: subject.name };
      titleRef.current =
        customTitle.trim() ||
        `${subject.name} · ${new Date(now).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })}`;
      langModeRef.current = languageMode;
      bookmarksRef.current = [];
      finalLiveTextRef.current = '';

      setDurationSec(0);
      setRecordedBytes(0);
      setBookmarks([]);
      setLiveTranscript('');

      const initialRecord: LectureRecord = {
        id: lectureId,
        title: titleRef.current,
        subject: subject.name,
        subjectId: subject.id,
        dateKey: getLocalDateKey(now),
        createdAt: now,
        durationSec: 0,
        mimeType: mimeTypeRef.current,
        sampleRateHz: sampleRateRef.current,
        bitrateKbps: bitrateKbpsRef.current,
        audioBytes: 0,
        hasAudioBlob: true,
        status: 'recording',
        languageMode,
        bookmarks: [],
      };
      await saveLecture(initialRecord);

      recorder.ondataavailable = async (ev) => {
        if (ev.data && ev.data.size > 0) {
          const idx = chunkIndexRef.current++;
          totalBytesRef.current += ev.data.size;
          setRecordedBytes(totalBytesRef.current);
          await appendAudioChunk({
            id: `${lectureId}-chunk-${idx}`,
            lectureId,
            index: idx,
            data: ev.data,
            createdAt: Date.now(),
          });
        }
      };

      recorder.onstop = async () => {
        const finalRecord: LectureRecord = {
          id: lectureIdRef.current,
          title: titleRef.current,
          subject: subjectRef.current.name,
          subjectId: subjectRef.current.id,
          dateKey: getLocalDateKey(createdAtRef.current),
          createdAt: createdAtRef.current,
          durationSec: durationRef.current,
          mimeType: mimeTypeRef.current,
          sampleRateHz: sampleRateRef.current,
          bitrateKbps: bitrateKbpsRef.current,
          audioBytes: totalBytesRef.current,
          hasAudioBlob: totalBytesRef.current > 0,
          status: 'pending_sync',
          languageMode: langModeRef.current,
          bookmarks: bookmarksRef.current,
        };
        await saveLecture(finalRecord);
        releaseResources();
        setIsRecording(false);
        setIsPaused(false);
        setAudioLevels(new Array(64).fill(0.05));
        setWaveformSamples(new Array(64).fill(0));
        onLectureSaved();
      };

      recorder.start(10000);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setIsPaused(false);
      startSpeechPreview(languageMode);

      timerRef.current = window.setInterval(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          const tickNow = Date.now();
          accumulatedMsRef.current += tickNow - lastTickRef.current;
          lastTickRef.current = tickNow;
          const secs = Math.floor(accumulatedMsRef.current / 1000);
          durationRef.current = secs;
          setDurationSec(secs);
        } else {
          lastTickRef.current = Date.now();
        }
      }, 500);

      rafRef.current = requestAnimationFrame(pumpWaveform);
    } catch (err) {
      releaseResources();
      setError(
        err instanceof Error
          ? err.message
          : 'Microphone access denied. You can still upload an audio file or paste a lecture transcript.'
      );
    }
  };

  const pauseRecording = () => {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.pause();
      setIsPaused(true);
    }
  };

  const resumeRecording = () => {
    if (mediaRecorderRef.current?.state === 'paused') {
      lastTickRef.current = Date.now();
      mediaRecorderRef.current.resume();
      setIsPaused(false);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  const addBookmark = (label: string) => {
    const bm: LectureBookmark = {
      id: `bm-${Date.now()}`,
      timestampSec: durationRef.current,
      label: label.trim() || 'Key Highlight',
    };
    bookmarksRef.current = [...bookmarksRef.current, bm];
    setBookmarks(bookmarksRef.current);
  };

  const importAudioFile = async (
    file: File,
    customTitle: string,
    languageMode: LanguageMode,
    subject: SubjectItem
  ) => {
    setError(null);
    const now = Date.now();
    const lectureId = `lec-${now}`;
    const mimeType = file.type || 'audio/mp3';
    await appendAudioChunk({
      id: `${lectureId}-chunk-0`,
      lectureId,
      index: 0,
      data: file,
      createdAt: now,
    });
    const record: LectureRecord = {
      id: lectureId,
      title: customTitle.trim() || file.name.replace(/\.[^/.]+$/, ''),
      subject: subject.name,
      subjectId: subject.id,
      dateKey: getLocalDateKey(now),
      createdAt: now,
      durationSec: 0,
      mimeType,
      audioBytes: file.size,
      hasAudioBlob: true,
      status: 'pending_sync',
      languageMode,
      bookmarks: [],
    };
    await saveLecture(record);
    onLectureSaved();
  };

  return {
    isRecording,
    isPaused,
    durationSec,
    recordedBytes,
    bookmarks,
    audioLevels,
    waveformSamples,
    activeSampleRate,
    liveTranscript,
    wakeLockActive,
    error,
    setError,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    addBookmark,
    importAudioFile,
  };
}
