export type LectureStatus = 'recording' | 'pending_sync' | 'transcribing' | 'analyzing' | 'completed' | 'error';

export type LanguageMode = 'en' | 'bilingual_ur';

export type RecordingQuality = 'voice_16' | 'voice_24' | 'studio_64' | 'ultra_128';

export interface SubjectItem {
  id: string;
  name: string;
  code?: string;
  accentHex: string;
  createdAt: number;
}

export interface LectureBookmark {
  id: string;
  timestampSec: number;
  label: string;
}

export interface NoteSection {
  heading: string;
  keyPoints: string[];
  detailedExplanation: string;
  examples: string[];
}

export interface LectureNotes {
  executiveSummary: string;
  sections: NoteSection[];
  formulasOrFrameworks: string[];
  keyTakeaways: string[];
}

export interface SolvedAssignment {
  id: string;
  title: string;
  promptSummary: string;
  requirements: string[];
  solvedSolutionMarkdown: string;
  imagePrompt: string;
  generatedImageUrl?: string;
  imageCaption?: string;
  referencesUsed: string[];
}

export interface ExtractedTask {
  id: string;
  lectureId?: string;
  lectureTitle?: string;
  title: string;
  priority: 'high' | 'medium' | 'low';
  dueHint: string;
  category: 'assignment' | 'study' | 'research' | 'followup';
  completed: boolean;
  createdAt: number;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  difficulty: 'easy' | 'medium' | 'hard';
}

export interface GroundingCitation {
  title: string;
  uri: string;
}

export interface LectureResearch {
  overview: string;
  newFrontiers: {
    topic: string;
    summary: string;
    whyItMatters: string;
  }[];
  professionalPerspectives: string[];
  openResearchQuestions: string[];
  citations: GroundingCitation[];
}

export interface LectureRecord {
  id: string;
  title: string;
  subject: string;
  subjectId?: string;
  dateKey?: string; // Local YYYY-MM-DD for 24-hour calendar cycle
  createdAt: number;
  durationSec: number;
  mimeType: string;
  sampleRateHz?: number;
  bitrateKbps?: number;
  audioBytes: number;
  hasAudioBlob: boolean;
  keepAudioOffline?: boolean;
  audioFreedAt?: number;
  status: LectureStatus;
  errorMessage?: string;
  languageMode: LanguageMode;
  bookmarks: LectureBookmark[];
  transcript?: string;
  notes?: LectureNotes;
  assignments?: SolvedAssignment[];
  quiz?: QuizQuestion[];
  research?: LectureResearch;
  quizAnswers?: Record<string, number>;
}

export interface DailySubjectSnapshot {
  subjectId: string;
  subjectName: string;
  accentHex: string;
  lectureIds: string[];
  totalDurationSec: number;
}

export interface DailyDigest {
  summary: string;
  crossSubjectConnections: string[];
  priorityStudyPlan: string[];
  generatedAt: number;
}

export interface DailyCycleArchive {
  dateKey: string; // YYYY-MM-DD
  dayName: string; // e.g. Sunday
  cycleStartAt: number;
  cycleEndAt: number;
  archivedAt: number;
  totalLectures: number;
  totalDurationSec: number;
  subjects: DailySubjectSnapshot[];
  digest?: DailyDigest;
}

export interface AudioChunkRecord {
  id: string;
  lectureId: string;
  index: number;
  data: Blob;
  createdAt: number;
}

export type ToolId =
  | 'image-to-writing'
  | 'writing-to-image'
  | '3d-concept'
  | 'research-newspaper'
  | 'assignment-pdf'
  | 'doc-summarizer'
  | 'translator'
  | 'voice-brief'
  | 'flashcards'
  | 'code-architect'
  | 'pitch-builder'
  | 'pro-drafter';

export interface ThreePrimitivePart {
  name: string;
  shape: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus';
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: string;
  metalness: number;
  roughness: number;
  annotation: string;
}

export interface ThreeConceptScene {
  title: string;
  summary: string;
  engineeringNotes: string[];
  parts: ThreePrimitivePart[];
}

export interface NewspaperArticle {
  headline: string;
  kicker: string;
  summary: string;
  implications: string;
}

export interface ResearchNewspaperResult {
  editionTitle: string;
  dateLabel: string;
  leadStory: NewspaperArticle;
  articles: NewspaperArticle[];
  citations: GroundingCitation[];
}

export interface FlashcardItem {
  front: string;
  back: string;
  hint: string;
}
