import React, { Suspense, useRef, useState } from 'react';
import {
  ArrowLeft,
  Box,
  Briefcase,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileDown,
  FileSearch,
  FileSpreadsheet,
  Image as ImageIcon,
  Languages,
  Layers,
  Loader2,
  Newspaper,
  Presentation,
  ScanText,
  Volume2,
} from 'lucide-react';
import { exportAssignmentPdf } from '../lib/pdfExport';
import { safeFetchJson } from '../lib/safeFetchJson';
import type {
  FlashcardItem,
  ResearchNewspaperResult,
  SolvedAssignment,
  ThreeConceptScene,
  ToolId,
} from '../types';

const ThreeConceptViewer = React.lazy(() =>
  import('./ThreeConceptViewer').then((m) => ({ default: m.ThreeConceptViewer }))
);

interface ToolMeta {
  id: ToolId;
  number: string;
  name: string;
  category: string;
  description: string;
  placeholder: string;
  accentBg: string;
  accentText: string;
  secondaryLabel?: string;
  secondaryOptions?: string[];
  supportsImageUpload?: boolean;
  supportsAspectRatio?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}

const TOOLS: ToolMeta[] = [
  {
    id: 'image-to-writing',
    number: '01',
    name: 'Image to Writing',
    category: 'Vision & OCR',
    description: 'Convert whiteboard photos, textbook pages, or handwritten notes into structured documents.',
    placeholder: 'Optional instructions (e.g., Format as clean lecture notes in English + Urdu)...',
    accentBg: 'bg-blue-50 dark:bg-blue-950/50',
    accentText: 'text-blue-600 dark:text-blue-400',
    supportsImageUpload: true,
    icon: ScanText,
  },
  {
    id: 'writing-to-image',
    number: '02',
    name: 'Writing to Image',
    category: 'Visual Studio',
    description: 'Generate scientific diagrams, architectural concepts, and high-res illustrations from text.',
    placeholder: 'Describe the diagram, scene, or visual concept to generate...',
    accentBg: 'bg-sky-50 dark:bg-sky-950/50',
    accentText: 'text-sky-600 dark:text-sky-400',
    supportsAspectRatio: true,
    icon: ImageIcon,
  },
  {
    id: '3d-concept',
    number: '03',
    name: '3D Modeling Studio',
    category: 'Spatial 3D',
    description: 'Turn a technical description into an interactive 3D parametric model you can orbit & inspect.',
    placeholder: 'Describe a 3D object or mechanism (e.g., Planetary gearbox, Modern solar pavilion, Rover chassis)...',
    accentBg: 'bg-indigo-50 dark:bg-indigo-950/50',
    accentText: 'text-indigo-600 dark:text-indigo-400',
    icon: Box,
  },
  {
    id: 'research-newspaper',
    number: '04',
    name: 'Research Newspaper',
    category: 'Live Intelligence',
    description: 'Live web-grounded academic & industry broadsheet summarizing current breakthroughs.',
    placeholder: 'Enter a field or topic (e.g., Solid-state EV batteries, Agentic AI in healthcare)...',
    accentBg: 'bg-slate-100 dark:bg-slate-800',
    accentText: 'text-slate-700 dark:text-slate-300',
    icon: Newspaper,
  },
  {
    id: 'assignment-pdf',
    number: '05',
    name: 'Assignment Solver to PDF',
    category: 'Academic Pro',
    description: 'Solve complex assignments with supporting diagrams and export directly as an illustrated PDF.',
    placeholder: 'Paste your assignment prompt or upload a photo of the question sheet...',
    accentBg: 'bg-emerald-50 dark:bg-emerald-950/50',
    accentText: 'text-emerald-600 dark:text-emerald-400',
    supportsImageUpload: true,
    icon: FileSpreadsheet,
  },
  {
    id: 'doc-summarizer',
    number: '06',
    name: 'Paper & Doc Summarizer',
    category: 'Reading Pro',
    description: 'Distill long papers, PDFs, or reports into executive abstracts, evidence, and blind spots.',
    placeholder: 'Paste long article, paper text, or report content here...',
    accentBg: 'bg-amber-50 dark:bg-amber-950/50',
    accentText: 'text-amber-600 dark:text-amber-400',
    icon: FileSearch,
  },
  {
    id: 'translator',
    number: '07',
    name: 'Academic Translator',
    category: 'Bilingual',
    description: 'Translate lectures and papers across Urdu, English, Arabic, and global languages accurately.',
    placeholder: 'Paste text to translate...',
    accentBg: 'bg-cyan-50 dark:bg-cyan-950/50',
    accentText: 'text-cyan-600 dark:text-cyan-400',
    secondaryLabel: 'Target Language',
    secondaryOptions: [
      'Urdu (with technical English terms preserved)',
      'English (Academic Standard)',
      'Arabic',
      'Spanish',
      'German',
      'French',
    ],
    icon: Languages,
  },
  {
    id: 'voice-brief',
    number: '08',
    name: 'Voice Brief & Podcast TTS',
    category: 'Audio Studio',
    description: 'Convert study notes or research briefs into clear spoken audio (.wav) for mobile listening.',
    placeholder: 'Paste notes or script to synthesize into natural speech...',
    accentBg: 'bg-rose-50 dark:bg-rose-950/50',
    accentText: 'text-rose-600 dark:text-rose-400',
    secondaryLabel: 'Voice Persona',
    secondaryOptions: ['Kore', 'Puck', 'Charon', 'Fenrir', 'Zephyr'],
    icon: Volume2,
  },
  {
    id: 'flashcards',
    number: '09',
    name: 'Active Recall Flashcards',
    category: 'Exam Prep',
    description: 'Generate interactive flip-to-reveal recall cards from any topic or lecture excerpt.',
    placeholder: 'Paste notes or enter a subject topic to build an 8-card study deck...',
    accentBg: 'bg-teal-50 dark:bg-teal-950/50',
    accentText: 'text-teal-600 dark:text-teal-400',
    icon: Layers,
  },
  {
    id: 'code-architect',
    number: '10',
    name: 'Code & Algorithm Architect',
    category: 'Engineering',
    description: 'Design, debug, and optimize algorithms or systems with complexity analysis.',
    placeholder: 'Describe the system, algorithm, or paste code to debug/optimize...',
    accentBg: 'bg-slate-100 dark:bg-slate-800',
    accentText: 'text-slate-800 dark:text-slate-200',
    secondaryLabel: 'Stack / Language',
    secondaryOptions: ['TypeScript / Node.js', 'Python', 'Kotlin / Android', 'C++', 'SQL / PostgreSQL'],
    icon: Code2,
  },
  {
    id: 'pitch-builder',
    number: '11',
    name: 'Presentation & Pitch Builder',
    category: 'Communication',
    description: 'Create an 8-slide structured presentation outline with visual direction and speaker scripts.',
    placeholder: 'Describe your project, thesis defense, or business pitch...',
    accentBg: 'bg-blue-50 dark:bg-blue-950/50',
    accentText: 'text-blue-600 dark:text-blue-400',
    icon: Presentation,
  },
  {
    id: 'pro-drafter',
    number: '12',
    name: 'Executive & Email Drafter',
    category: 'Workplace',
    description: 'Transform rough bullet notes into polished executive emails, proposals, or client briefs.',
    placeholder: 'Paste rough bullet points or meeting takeaways...',
    accentBg: 'bg-emerald-50 dark:bg-emerald-950/50',
    accentText: 'text-emerald-600 dark:text-emerald-400',
    secondaryLabel: 'Document Format',
    secondaryOptions: ['Executive Email', 'Project Proposal', 'Weekly Status Report', 'Academic Cover Letter'],
    icon: Briefcase,
  },
];

type ToolResponse =
  | { kind: 'markdown'; title: string; content: string }
  | { kind: 'image'; imageUrl: string; caption: string }
  | { kind: '3d-scene'; scene: ThreeConceptScene }
  | { kind: 'newspaper'; newspaper: ResearchNewspaperResult }
  | { kind: 'assignment'; assignment: SolvedAssignment }
  | { kind: 'audio'; audioDataUrl: string; voiceName: string }
  | { kind: 'flashcards'; cards: FlashcardItem[] };

interface ToolsWorkbenchProps {
  isOnline: boolean;
}

export const ToolsWorkbench: React.FC<ToolsWorkbenchProps> = ({ isOnline }) => {
  const [selectedToolId, setSelectedToolId] = useState<ToolId | null>(null);
  const [inputText, setInputText] = useState('');
  const [secondaryInput, setSecondaryInput] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'1:1' | '16:9' | '4:3' | '3:4'>('1:1');
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const [imageMimeType, setImageMimeType] = useState<string | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ToolResponse | null>(null);
  const [flippedCard, setFlippedCard] = useState<Record<number, boolean>>({});
  const [copied, setCopied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeTool = TOOLS.find((t) => t.id === selectedToolId) || null;

  const openTool = (tool: ToolMeta) => {
    setSelectedToolId(tool.id);
    setInputText('');
    setSecondaryInput(tool.secondaryOptions?.[0] || '');
    setImageBase64(null);
    setImageMimeType(null);
    setImagePreviewUrl(null);
    setError(null);
    setResult(null);
    setFlippedCard({});
  };

  const handleImagePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx !== -1) {
        setImagePreviewUrl(dataUrl);
        setImageBase64(dataUrl.slice(commaIdx + 1));
        setImageMimeType(file.type || 'image/jpeg');
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const runTool = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTool) return;
    if (!isOnline) {
      setError('Internet connection is required to run AI tools.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await safeFetchJson<ToolResponse>('/api/tools/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          toolId: activeTool.id,
          prompt: inputText,
          inputText,
          secondaryInput,
          aspectRatio,
          imageBase64,
          imageMimeType,
        }),
      });
      if (!res.ok) {
        throw new Error(res.data.error || 'Tool execution failed.');
      }
      setResult(res.data as ToolResponse);
      setFlippedCard({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tool execution failed.');
    } finally {
      setLoading(false);
    }
  };

  if (!activeTool) {
    return (
      <div className="space-y-6">
        {/* Editorial Workbench Banner */}
        <div className="relative rounded-3xl overflow-hidden border border-slate-200 dark:border-slate-800 h-44 sm:h-52 bg-slate-900 shadow-sm">
          <img
            src="/src/assets/images/workbench_studio_banner_1795297726795.jpg"
            alt="Precision architect and researcher workbench"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover object-center"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/45 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 p-5 sm:p-8">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
              12 Professional AI Tools
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-200 max-w-2xl">
              Built for students, researchers, engineers, and modern professionals — from interactive 3D modeling to illustrated assignment PDFs.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TOOLS.map((tool) => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => openTool(tool)}
                className="group text-left rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 hover:border-blue-500/60 dark:hover:border-blue-500/60 hover:-translate-y-0.5 transition-all duration-150 shadow-sm flex flex-col justify-between gap-4 cursor-pointer"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${tool.accentBg} ${tool.accentText}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                      {tool.number} · {tool.category}
                    </span>
                  </div>
                  <h2 className="mt-3.5 text-base font-semibold text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                    {tool.name}
                  </h2>
                  <p className="mt-1.5 text-xs sm:text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
                    {tool.description}
                  </p>
                </div>
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                  Open tool →
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const ActiveIcon = activeTool.icon;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setSelectedToolId(null)}
          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
          aria-label="Back to 12 tools"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
            {activeTool.number} · {activeTool.category}
          </div>
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <ActiveIcon className="w-5 h-5 text-blue-600" />
            <span>{activeTool.name}</span>
          </h1>
        </div>
      </div>

      {/* Tool Input Form */}
      <form
        onSubmit={(e) => void runTool(e)}
        className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-4 shadow-sm"
      >
        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
          {activeTool.description}
        </p>

        {activeTool.supportsImageUpload && (
          <div className="space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImagePick}
              className="hidden"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <ImageIcon className="w-4 h-4" />
                <span>{imagePreviewUrl ? 'Change Image' : 'Upload or Capture Photo'}</span>
              </button>
              {imagePreviewUrl && (
                <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                  Image attached
                </span>
              )}
            </div>
            {imagePreviewUrl && (
              <img
                src={imagePreviewUrl}
                alt="Uploaded input preview"
                className="max-h-52 rounded-xl border border-slate-200 dark:border-slate-800 object-contain"
              />
            )}
          </div>
        )}

        <textarea
          rows={4}
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder={activeTool.placeholder}
          className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 p-3.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {activeTool.secondaryOptions && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="tool-secondary-select"
                  className="text-xs font-medium text-slate-600 dark:text-slate-400"
                >
                  {activeTool.secondaryLabel}:
                </label>
                <select
                  id="tool-secondary-select"
                  value={secondaryInput}
                  onChange={(e) => setSecondaryInput(e.target.value)}
                  className="min-h-[40px] px-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-xs text-slate-800 dark:text-slate-200"
                >
                  {activeTool.secondaryOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {activeTool.supportsAspectRatio && (
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                {(['1:1', '16:9', '4:3', '3:4'] as const).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setAspectRatio(ratio)}
                    className={`px-2.5 py-1 text-xs font-mono-tabular rounded-md cursor-pointer ${
                      aspectRatio === ratio
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-sm font-semibold'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {ratio}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !isOnline}
            className="flex items-center justify-center gap-2 px-6 py-2.5 min-h-[44px] rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs sm:text-sm font-semibold cursor-pointer"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Generating...</span>
              </>
            ) : (
              <span>Run {activeTool.name}</span>
            )}
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </form>

      {/* Tool Output Renderer */}
      {result && (
        <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-8 shadow-sm">
          {result.kind === 'markdown' && (
            <div className="space-y-4 max-w-3xl">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                  {result.title}
                </h2>
                <button
                  type="button"
                  onClick={async () => {
                    await navigator.clipboard.writeText(result.content);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1800);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <div className="font-serif-reading text-[15px] leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                {result.content}
              </div>
            </div>
          )}

          {result.kind === 'image' && (
            <div className="space-y-4 max-w-2xl">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Generated Visual
                </h2>
                <a
                  href={result.imageUrl}
                  download={`qalam-visual-${Date.now()}.${result.imageUrl.startsWith('data:image/svg+xml') ? 'svg' : 'png'}`}
                  className="flex items-center gap-1.5 px-4 py-2 min-h-[40px] rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Image</span>
                </a>
              </div>
              <img
                src={result.imageUrl}
                alt={result.caption}
                referrerPolicy="no-referrer"
                className="w-full h-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50"
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">{result.caption}</p>
            </div>
          )}

          {result.kind === '3d-scene' && (
            <Suspense
              fallback={
                <div className="py-12 text-center text-xs text-slate-500">
                  Loading 3D studio engine...
                </div>
              }
            >
              <ThreeConceptViewer sceneData={result.scene} />
            </Suspense>
          )}

          {result.kind === 'newspaper' && (
            <div className="space-y-6">
              <div className="border-b-2 border-slate-900 dark:border-slate-100 pb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-serif-reading text-2xl sm:text-3xl font-bold text-slate-900 dark:text-slate-100">
                  {result.newspaper.editionTitle}
                </h2>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                  {result.newspaper.dateLabel} · Live Web Edition
                </span>
              </div>

              <article className="pb-6 border-b border-slate-200 dark:border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                  {result.newspaper.leadStory.kicker}
                </div>
                <h3 className="font-serif-reading text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">
                  {result.newspaper.leadStory.headline}
                </h3>
                <p className="font-serif-reading text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
                  {result.newspaper.leadStory.summary}
                </p>
                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 font-medium">
                  Impact: {result.newspaper.leadStory.implications}
                </p>
              </article>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(result.newspaper.articles || []).map((art, i) => (
                  <article key={i} className="space-y-1.5">
                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                      {art.kicker}
                    </div>
                    <h4 className="font-serif-reading text-base font-bold text-slate-900 dark:text-slate-100">
                      {art.headline}
                    </h4>
                    <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                      {art.summary}
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-400">
                      Takeaway: {art.implications}
                    </p>
                  </article>
                ))}
              </div>

              {result.newspaper.citations?.length > 0 && (
                <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                    Grounded Web Sources
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {result.newspaper.citations.map((c, idx) => (
                      <a
                        key={idx}
                        href={c.uri}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        <span>{c.title}</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {result.kind === 'assignment' && (
            <div className="space-y-5 max-w-3xl">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  {result.assignment.title}
                </h2>
                <button
                  type="button"
                  onClick={() => void exportAssignmentPdf(result.assignment)}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold cursor-pointer shrink-0"
                >
                  <FileDown className="w-4 h-4" />
                  <span>Download Solved PDF (with Pictures)</span>
                </button>
              </div>
              {result.assignment.generatedImageUrl && (
                <figure className="rounded-2xl border border-slate-200 dark:border-slate-800 p-3 bg-slate-50 dark:bg-slate-950">
                  <img
                    src={result.assignment.generatedImageUrl}
                    alt={result.assignment.imageCaption || result.assignment.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-auto rounded-xl object-contain bg-slate-50"
                  />
                  {result.assignment.imageCaption && (
                    <figcaption className="mt-2 text-xs text-slate-500">
                      Figure: {result.assignment.imageCaption}
                    </figcaption>
                  )}
                </figure>
              )}
              <div className="font-serif-reading text-[15px] leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-line">
                {result.assignment.solvedSolutionMarkdown}
              </div>
            </div>
          )}

          {result.kind === 'audio' && (
            <div className="space-y-4 max-w-xl">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Spoken Audio Brief ({result.voiceName})
                </h2>
                <a
                  href={result.audioDataUrl}
                  download={`qalam-brief-${Date.now()}.wav`}
                  className="flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-xl bg-slate-900 dark:bg-blue-600 text-white text-xs font-semibold"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download WAV</span>
                </a>
              </div>
              <audio controls src={result.audioDataUrl} className="w-full" />
            </div>
          )}

          {result.kind === 'flashcards' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Active Recall Flashcards ({(result.cards || []).length})
                </h2>
                <span className="text-xs text-slate-500">Tap any card to flip</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(result.cards || []).map((card, idx) => {
                  const isFlipped = !!flippedCard[idx];
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        setFlippedCard((prev) => ({ ...prev, [idx]: !prev[idx] }))
                      }
                      className={`min-h-[150px] rounded-2xl border p-5 text-left flex flex-col justify-between transition-colors cursor-pointer ${
                        isFlipped
                          ? 'bg-blue-50/70 dark:bg-blue-950/30 border-blue-300 dark:border-blue-800'
                          : 'bg-slate-50/70 dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                        Card {idx + 1} · {isFlipped ? 'Answer' : 'Prompt'}
                      </div>
                      <div className="my-3 text-sm font-medium text-slate-900 dark:text-slate-100 leading-relaxed">
                        {isFlipped ? card.back : card.front}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {isFlipped ? 'Tap to see question' : `Hint: ${card.hint}`}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
};
