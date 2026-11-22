import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';

dotenv.config();

const PORT = Number(process.env.PORT) || 3000;
let rasterQuotaCooldownUntil = 0;
let searchQuotaCooldownUntil = 0;

function getAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in environment secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isRetryableError(err: unknown): boolean {
  const msg = getErrorMessage(err);
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('500') ||
    msg.includes('INTERNAL') ||
    msg.includes('high demand')
  );
}

function isQuotaOrNotFoundError(err: unknown): boolean {
  const msg = getErrorMessage(err);
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('404') ||
    msg.includes('NOT_FOUND')
  );
}

function formatCleanError(err: unknown): string {
  const raw = getErrorMessage(err);
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return 'Gemini API quota temporarily reached for this key. Please wait a moment and retry, or check billing/quota in Settings > Secrets.';
  }
  if (raw.includes('API_KEY_INVALID') || raw.includes('PERMISSION_DENIED')) {
    return 'Gemini API key is invalid or lacks permission. Please verify GEMINI_API_KEY in Settings > Secrets.';
  }
  if (raw.includes('timed out') || raw.includes('DEADLINE_EXCEEDED')) {
    return 'The AI request took too long to respond. Please retry in a moment.';
  }
  return raw;
}

function shouldFallbackModel(err: unknown): boolean {
  const msg = getErrorMessage(err);
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('404') ||
    msg.includes('NOT_FOUND') ||
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('500') ||
    msg.includes('INTERNAL') ||
    msg.includes('timed out') ||
    msg.includes('DEADLINE_EXCEEDED')
  );
}

function safeParseJson<T>(raw: string, fallback: T): T {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!cleaned) return fallback;
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const objMatch = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (objMatch) {
      try {
        return JSON.parse(objMatch[1]) as T;
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts && isRetryableError(err)) {
        const delayMs = 700 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function generateWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: unknown;
    config?: Record<string, unknown>;
    primaryModel?: string;
    timeoutMs?: number;
  }
) {
  const primary = params.primaryModel || 'gemini-4-hydrogen';
  const primaryTimeout = params.timeoutMs ?? 18000;
  const primaryConfig: Record<string, unknown> = { ...(params.config || {}) };
  if (
    (primary === 'gemini-4-hydrogen' || primary === 'gemini-4-neon') &&
    !('thinkingConfig' in primaryConfig)
  ) {
    primaryConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  }

  try {
    return await withRetry(
      () =>
        withTimeout(
          ai.models.generateContent({
            model: primary,
            contents: params.contents as never,
            config: primaryConfig as never,
          }),
          primaryTimeout,
          primary
        ),
      2
    );
  } catch (err) {
    if (shouldFallbackModel(err) && primary !== 'gemini-3.1-flash-lite') {
      const fallbackConfig = params.config ? { ...params.config } : undefined;
      if (fallbackConfig && 'thinkingConfig' in fallbackConfig) {
        delete fallbackConfig.thinkingConfig;
      }
      return await withRetry(
        () =>
          withTimeout(
            ai.models.generateContent({
              model: 'gemini-3.1-flash-lite',
              contents: params.contents as never,
              config: fallbackConfig as never,
            }),
            Math.max(25000, primaryTimeout),
            'gemini-3.1-flash-lite'
          ),
        2
      );
    }
    throw err;
  }
}

async function generateVectorSvgDiagram(
  ai: GoogleGenAI,
  prompt: string,
  aspectRatio = '4:3'
): Promise<string | null> {
  try {
    const dims =
      aspectRatio === '16:9'
        ? { w: 960, h: 540 }
        : aspectRatio === '3:4'
          ? { w: 600, h: 800 }
          : aspectRatio === '1:1'
            ? { w: 720, h: 720 }
            : { w: 800, h: 600 };

    const resp = await generateWithFallback(ai, {
      timeoutMs: 18000,
      contents: `Create a crisp, publication-grade technical/educational SVG illustration or diagram for: "${prompt}".
Requirements:
- Output ONLY raw valid <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dims.w} ${dims.h}" width="${dims.w}" height="${dims.h}">...</svg> with NO markdown fences and NO extra text.
- Use a clean light background (#F8FAFC), crisp dark slate typography (#0F172A), cobalt blue (#2563EB) and cyan (#0284C7) accents, labeled boxes/nodes/arrows/curves/axes as appropriate for the subject.
- Ensure all text fits comfortably inside the viewBox with zero clipping.`,
    });
    const raw = (resp.text ?? '').trim();
    const match = raw.match(/<svg[\s\S]*<\/svg>/i);
    if (!match) return null;
    const svgBase64 = Buffer.from(match[0], 'utf-8').toString('base64');
    return `data:image/svg+xml;base64,${svgBase64}`;
  } catch (err) {
    console.warn('Vector SVG fallback failed:', getErrorMessage(err));
    return null;
  }
}

async function generateDiagramImage(
  ai: GoogleGenAI,
  prompt: string,
  aspectRatio = '4:3'
): Promise<string | null> {
  if (Date.now() > rasterQuotaCooldownUntil) {
    try {
      const response = await withRetry(() =>
        ai.models.generateContent({
          model: 'gemini-3.1-flash-lite-image',
          contents: {
            parts: [
              {
                text: `Clean high-resolution educational technical illustration or diagram on a crisp light studio background, clear labels, sharp geometric lines, academic publication quality: ${prompt}`,
              },
            ],
          },
          config: {
            imageConfig: {
              aspectRatio: aspectRatio as '1:1' | '3:4' | '4:3' | '9:16' | '16:9',
            },
          },
        })
      );
      for (const part of response.candidates?.[0]?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          const mime = part.inlineData.mimeType ?? 'image/png';
          return `data:${mime};base64,${part.inlineData.data}`;
        }
      }
    } catch (err) {
      if (isQuotaOrNotFoundError(err)) {
        rasterQuotaCooldownUntil = Date.now() + 15 * 60 * 1000;
      }
    }
  }
  return generateVectorSvgDiagram(ai, prompt, aspectRatio);
}

function extractGroundingCitations(response: unknown): { title: string; uri: string }[] {
  const r = response as {
    candidates?: {
      groundingMetadata?: {
        groundingChunks?: { web?: { uri?: string; title?: string } }[];
      };
    }[];
  };
  const chunks = r.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const citations: { title: string; uri: string }[] = [];
  for (const chunk of chunks) {
    const uri = chunk.web?.uri;
    const title = chunk.web?.title || uri;
    if (uri && title && !seen.has(uri)) {
      seen.add(uri);
      citations.push({ title, uri });
    }
  }
  return citations;
}

async function startServer() {
  const app = express();

  app.use(express.json({ limit: '45mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  app.get('/favicon.ico', (_req, res) => {
    const iconPath = path.resolve(process.cwd(), 'public/pwa-192x192.png');
    if (fs.existsSync(iconPath)) {
      res.sendFile(iconPath);
      return;
    }
    res.status(204).end();
  });

  // Transcribe audio (supports long lectures up to 250MB via Gemini Files API)
  app.post(
    '/api/lectures/transcribe',
    express.raw({ type: 'application/octet-stream', limit: '250mb' }),
    async (req, res) => {
      const rawMime = String(req.headers['x-mime-type'] || 'audio/webm');
      const mimeType = rawMime.split(';')[0].trim() || 'audio/webm';
      const languageMode = String(req.headers['x-language-mode'] || 'en');
      const buffer = req.body as Buffer;

      if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        res.status(400).json({ error: 'Empty audio payload received.' });
        return;
      }

      const ext = mimeType.includes('mp3') || mimeType.includes('mpeg')
        ? 'mp3'
        : mimeType.includes('wav')
          ? 'wav'
          : mimeType.includes('mp4') || mimeType.includes('m4a')
            ? 'm4a'
            : mimeType.includes('ogg')
              ? 'ogg'
              : 'webm';

      let tmpPath: string | null = null;
      let uploadedFileName: string | null = null;
      let ai: GoogleGenAI | null = null;

      try {
        const client = getAI();
        ai = client;
        const promptText =
          languageMode === 'bilingual_ur'
            ? 'Listen carefully to this entire audio lecture or voice recording and transcribe every spoken sentence accurately with [MM:SS] timestamps and paragraph breaks. If Urdu or Hindi is spoken, transcribe it accurately (preserving English technical terms cleanly). If English is spoken, transcribe verbatim. Do not skip content.'
            : 'Listen carefully to this entire audio lecture or voice recording and transcribe all spoken words accurately with [MM:SS] timestamps and clean topic paragraphs.';

        const runAudioModel = async (
          modelName: string,
          part: Record<string, unknown>
        ): Promise<string> => {
          const response = await withRetry(() =>
            client.models.generateContent({
              model: modelName,
              contents: {
                parts: [part, { text: promptText }],
              },
            })
          );
          return (response.text ?? '').trim();
        };

        let audioPart: Record<string, unknown>;

        if (buffer.length <= 12 * 1024 * 1024) {
          audioPart = {
            inlineData: {
              mimeType,
              data: buffer.toString('base64'),
            },
          };
        } else {
          tmpPath = path.join(os.tmpdir(), `qalam-lecture-${Date.now()}.${ext}`);
          await fs.promises.writeFile(tmpPath, buffer);
          const uploaded = await client.files.upload({
            file: tmpPath,
            config: { mimeType },
          });
          uploadedFileName = uploaded.name ?? null;

          let activeFile = uploaded;
          let attempts = 0;
          while (activeFile.state === 'PROCESSING' && attempts < 45) {
            await new Promise((r) => setTimeout(r, 2000));
            if (!activeFile.name) break;
            activeFile = await client.files.get({ name: activeFile.name });
            attempts++;
          }

          if (activeFile.state === 'FAILED' || !activeFile.uri) {
            throw new Error('Audio file processing failed on Gemini File API.');
          }

          audioPart = {
            fileData: {
              fileUri: activeFile.uri,
              mimeType: activeFile.mimeType || mimeType,
            },
          };
        }

        let transcript = '';
        try {
          transcript = await runAudioModel('gemini-3.5-transcribe', audioPart);
        } catch (err) {
          console.warn('gemini-3.5-transcribe fallback:', getErrorMessage(err));
          const resp = await generateWithFallback(client, {
            contents: { parts: [audioPart, { text: promptText }] },
          });
          transcript = (resp.text ?? '').trim();
        }

        if (!transcript) {
          res.status(422).json({
            error:
              'No intelligible speech was detected in this recording. Try speaking closer to the microphone or check microphone permissions.',
          });
          return;
        }

        res.json({ transcript });
      } catch (err) {
        console.error('Transcription error:', err);
        res.status(500).json({ error: formatCleanError(err) });
      } finally {
        if (tmpPath) {
          fs.promises.unlink(tmpPath).catch(() => {});
        }
        if (uploadedFileName && ai) {
          ai.files.delete({ name: uploadedFileName }).catch(() => {});
        }
      }
    }
  );

  // Analyze transcript -> Notes + Solved Assignments (with generated diagrams) + Tasks + Quiz + Live Web Research
  app.post('/api/lectures/analyze', async (req, res) => {
    try {
      const ai = getAI();
      const { transcript, title, languageMode = 'en', bookmarks = [] } = (req.body ?? {}) as {
        transcript?: string;
        title?: string;
        languageMode?: string;
        bookmarks?: { timestampSec: number; label: string }[];
      };

      if (!transcript || !transcript.trim()) {
        res.status(400).json({ error: 'Transcript text is required for analysis.' });
        return;
      }

      const langInstruction =
        languageMode === 'bilingual_ur'
          ? 'Write clear, authoritative explanations in English paired with concise Urdu summaries/explanations (using clean Urdu script where helpful) so bilingual students master both concepts and technical English terminology.'
          : 'Write clear, structured, publication-grade academic and professional English.';

      const bookmarkNote =
        bookmarks.length > 0
          ? `\nUser-marked lecture highlights:\n${bookmarks
              .map((b) => `- [${Math.floor(b.timestampSec / 60)}m ${b.timestampSec % 60}s] ${b.label}`)
              .join('\n')}`
          : '';

      const structuredResp = await generateWithFallback(ai, {
        timeoutMs: 45000,
        contents: `Analyze this lecture/voice recording transcript deeply and generate comprehensive, university- & industry-grade deliverables.
Title hint: ${title || 'Untitled Lecture'}
${langInstruction}
${bookmarkNote}

Requirements:
1. "notes": Rich, authoritative study & reference notes covering every core topic, exact definitions, mathematical/technical derivations or frameworks, real-world examples, and exam/interview takeaways.
2. "assignments": Extract every assignment, homework, problem set, or project announced in the lecture. If no explicit assignment was announced, synthesize 1 rigorous applied capstone assignment directly testing the lecture's core concepts. Solve each assignment completely in "solvedSolutionMarkdown" with step-by-step methodology, deep reasoning, and references, AND craft a descriptive "imagePrompt" for an educational diagram/figure to embed in the assignment PDF.
3. "tasks": Extract every actionable deadline, reading, preparation item, or follow-up task.
4. "quiz": Generate 8 high-yield multiple-choice questions (mix of easy, medium, and hard conceptual + applied problems) with 4 options each, the 0-based correctIndex, and a crisp explanation.

Transcript:
${transcript}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              refinedTitle: { type: Type.STRING },
              subject: { type: Type.STRING },
              notes: {
                type: Type.OBJECT,
                properties: {
                  executiveSummary: { type: Type.STRING },
                  sections: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        heading: { type: Type.STRING },
                        keyPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
                        detailedExplanation: { type: Type.STRING },
                        examples: { type: Type.ARRAY, items: { type: Type.STRING } },
                      },
                      required: ['heading', 'keyPoints', 'detailedExplanation', 'examples'],
                    },
                  },
                  formulasOrFrameworks: { type: Type.ARRAY, items: { type: Type.STRING } },
                  keyTakeaways: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: ['executiveSummary', 'sections', 'formulasOrFrameworks', 'keyTakeaways'],
              },
              assignments: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    promptSummary: { type: Type.STRING },
                    requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
                    solvedSolutionMarkdown: { type: Type.STRING },
                    imagePrompt: { type: Type.STRING },
                    imageCaption: { type: Type.STRING },
                    referencesUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: [
                    'title',
                    'promptSummary',
                    'requirements',
                    'solvedSolutionMarkdown',
                    'imagePrompt',
                    'imageCaption',
                    'referencesUsed',
                  ],
                },
              },
              tasks: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    title: { type: Type.STRING },
                    priority: { type: Type.STRING },
                    dueHint: { type: Type.STRING },
                    category: { type: Type.STRING },
                  },
                  required: ['title', 'priority', 'dueHint', 'category'],
                },
              },
              quiz: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    question: { type: Type.STRING },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                    correctIndex: { type: Type.INTEGER },
                    explanation: { type: Type.STRING },
                    difficulty: { type: Type.STRING },
                  },
                  required: ['question', 'options', 'correctIndex', 'explanation', 'difficulty'],
                },
              },
            },
            required: ['refinedTitle', 'subject', 'notes', 'assignments', 'tasks', 'quiz'],
          },
        },
      });

      const structuredData = safeParseJson<Record<string, any>>(structuredResp.text ?? '', {});
      if (!structuredData.notes) {
        throw new Error('Could not structure lecture deliverables cleanly. Please retry.');
      }

      const researchPrompt = `Based on this lecture transcript (${title || 'Lecture'}), perform research on the core topics discussed.
Identify:
1. What NEW research, recent papers, or emerging developments exist right now in this field.
2. What industry professionals and researchers say about practical adoption, limitations, and future direction.
3. High-impact open research questions a student or professional could explore next.
${langInstruction}

Return the response as clean JSON matching this exact structure (no markdown fences):
{
  "overview": "string",
  "newFrontiers": [{ "topic": "string", "summary": "string", "whyItMatters": "string" }],
  "professionalPerspectives": ["string"],
  "openResearchQuestions": ["string"]
}

Transcript excerpt:
${transcript.slice(0, 12000)}`;

      let researchResp: unknown;
      if (Date.now() > searchQuotaCooldownUntil) {
        try {
          researchResp = await withRetry(() =>
            ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: researchPrompt,
              config: {
                tools: [{ googleSearch: {} }],
              },
            })
          );
        } catch (err) {
          if (isQuotaOrNotFoundError(err)) {
            searchQuotaCooldownUntil = Date.now() + 15 * 60 * 1000;
          }
          researchResp = await generateWithFallback(ai, {
            contents: researchPrompt,
          });
        }
      } else {
        researchResp = await generateWithFallback(ai, {
          contents: researchPrompt,
        });
      }

      let researchData = {
        overview: '',
        newFrontiers: [] as { topic: string; summary: string; whyItMatters: string }[],
        professionalPerspectives: [] as string[],
        openResearchQuestions: [] as string[],
      };
      const rawResearch = ((researchResp as { text?: string }).text ?? '').trim();
      const parsedResearch = safeParseJson<Partial<typeof researchData> | null>(rawResearch, null);
      if (parsedResearch && typeof parsedResearch === 'object') {
        researchData = {
          overview: String(parsedResearch.overview || ''),
          newFrontiers: Array.isArray(parsedResearch.newFrontiers) ? parsedResearch.newFrontiers : [],
          professionalPerspectives: Array.isArray(parsedResearch.professionalPerspectives)
            ? parsedResearch.professionalPerspectives.map(String)
            : [],
          openResearchQuestions: Array.isArray(parsedResearch.openResearchQuestions)
            ? parsedResearch.openResearchQuestions.map(String)
            : [],
        };
      } else {
        researchData.overview = rawResearch;
      }

      const citations = extractGroundingCitations(researchResp);

      const assignments = Array.isArray(structuredData.assignments) ? structuredData.assignments : [];
      const enrichedAssignments = await Promise.all(
        assignments.map(async (a: Record<string, unknown>, idx: number) => {
          let generatedImageUrl: string | undefined;
          if (idx < 2 && typeof a.imagePrompt === 'string' && a.imagePrompt.trim()) {
            const img = await generateDiagramImage(ai, a.imagePrompt, '4:3');
            if (img) generatedImageUrl = img;
          }
          return {
            id: `asg-${Date.now()}-${idx}`,
            title: String(a.title || `Assignment ${idx + 1}`),
            promptSummary: String(a.promptSummary || ''),
            requirements: Array.isArray(a.requirements) ? a.requirements.map(String) : [],
            solvedSolutionMarkdown: String(a.solvedSolutionMarkdown || ''),
            imagePrompt: String(a.imagePrompt || ''),
            imageCaption: String(a.imageCaption || 'Supporting technical diagram'),
            generatedImageUrl,
            referencesUsed: Array.isArray(a.referencesUsed) ? a.referencesUsed.map(String) : [],
          };
        })
      );

      res.json({
        refinedTitle: structuredData.refinedTitle || title || 'Processed Lecture',
        subject: structuredData.subject || 'General',
        notes: structuredData.notes,
        assignments: enrichedAssignments,
        tasks: Array.isArray(structuredData.tasks)
          ? structuredData.tasks.map((t: Record<string, unknown>, idx: number) => ({
              id: `task-${Date.now()}-${idx}`,
              title: String(t.title || ''),
              priority: t.priority === 'high' || t.priority === 'low' ? t.priority : 'medium',
              dueHint: String(t.dueHint || 'This week'),
              category:
                t.category === 'assignment' ||
                t.category === 'study' ||
                t.category === 'research' ||
                t.category === 'followup'
                  ? t.category
                  : 'study',
              completed: false,
              createdAt: Date.now(),
            }))
          : [],
        quiz: Array.isArray(structuredData.quiz)
          ? structuredData.quiz.map((q: Record<string, unknown>, idx: number) => ({
              id: `q-${Date.now()}-${idx}`,
              question: String(q.question || ''),
              options: Array.isArray(q.options) ? q.options.map(String) : [],
              correctIndex: typeof q.correctIndex === 'number' ? q.correctIndex : 0,
              explanation: String(q.explanation || ''),
              difficulty: q.difficulty === 'easy' || q.difficulty === 'hard' ? q.difficulty : 'medium',
            }))
          : [],
        research: {
          ...researchData,
          citations,
        },
      });
    } catch (err) {
      console.error('Analyze error:', err);
      res.status(500).json({ error: formatCleanError(err) });
    }
  });

  // Daily Multi-Subject Calendar Digest (synthesizes all lectures recorded in a 24-hour cycle)
  app.post('/api/calendar/daily-digest', async (req, res) => {
    try {
      const ai = getAI();
      const { dateKey, dayName, items = [] } = (req.body ?? {}) as {
        dateKey?: string;
        dayName?: string;
        items?: { subject: string; title: string; summary: string; recordedAt: string }[];
      };

      if (!items.length) {
        res.status(400).json({ error: 'No lectures available in this 24-hour cycle to summarize.' });
        return;
      }

      const resp = await generateWithFallback(ai, {
        timeoutMs: 25000,
        contents: `Synthesize a unified Daily Academic & Professional Study Digest for ${dayName || ''} (${dateKey || 'Today'}).
Lectures recorded across subjects during this 24-hour cycle:
${items.map((it, i) => `${i + 1}. [${it.recordedAt}] Subject: ${it.subject} — Title: ${it.title}\n   Notes/Transcript excerpt: ${it.summary}`).join('\n\n')}

Produce:
- "summary": A cohesive 1-paragraph overview tying together everything studied/recorded today.
- "crossSubjectConnections": 3-4 insights showing how today's subjects connect or reinforce each other.
- "priorityStudyPlan": 4 concrete next-day revision and assignment action steps.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              summary: { type: Type.STRING },
              crossSubjectConnections: { type: Type.ARRAY, items: { type: Type.STRING } },
              priorityStudyPlan: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['summary', 'crossSubjectConnections', 'priorityStudyPlan'],
          },
        },
      });

      const parsed = safeParseJson<{
        summary: string;
        crossSubjectConnections: string[];
        priorityStudyPlan: string[];
      }>(resp.text ?? '', {
        summary: '',
        crossSubjectConnections: [],
        priorityStudyPlan: [],
      });
      res.json({
        ...parsed,
        generatedAt: Date.now(),
      });
    } catch (err) {
      console.error('Daily digest error:', err);
      res.status(500).json({ error: formatCleanError(err) });
    }
  });

  // Unified Dispatcher for all 12 Professional AI Tools
  app.post('/api/tools/run', async (req, res) => {
    try {
      const ai = getAI();
      const { toolId, prompt, inputText, secondaryInput, aspectRatio, imageBase64, imageMimeType } = (req.body ?? {}) as {
        toolId: string;
        prompt?: string;
        inputText?: string;
        secondaryInput?: string;
        aspectRatio?: string;
        imageBase64?: string;
        imageMimeType?: string;
      };

      switch (toolId) {
        case 'image-to-writing': {
          if (!imageBase64 || !imageMimeType) {
            res.status(400).json({ error: 'Please upload or capture an image first.' });
            return;
          }
          const resp = await generateWithFallback(ai, {
            contents: {
              parts: [
                { inlineData: { data: imageBase64, mimeType: imageMimeType } },
                {
                  text:
                    prompt?.trim() ||
                    'Extract all text, equations, diagrams, and handwritten notes from this image and convert them into a clean, well-structured, publication-ready document.',
                },
              ],
            },
          });
          res.json({ kind: 'markdown', title: 'Extracted & Formatted Document', content: resp.text ?? '' });
          return;
        }

        case 'writing-to-image': {
          const textPrompt = prompt?.trim() || inputText?.trim();
          if (!textPrompt) {
            res.status(400).json({ error: 'Please describe the image or diagram to generate.' });
            return;
          }
          const imageUrl = await generateDiagramImage(ai, textPrompt, aspectRatio || '1:1');
          if (!imageUrl) {
            res.status(502).json({ error: 'Could not generate image. Please try refining your prompt.' });
            return;
          }
          const isVector = imageUrl.startsWith('data:image/svg+xml');
          res.json({
            kind: 'image',
            imageUrl,
            caption: isVector
              ? `${textPrompt} (Generated as high-resolution Vector Diagram SVG)`
              : textPrompt,
          });
          return;
        }

        case '3d-concept': {
          const desc = prompt?.trim() || inputText?.trim();
          if (!desc) {
            res.status(400).json({ error: 'Describe the 3D object, mechanism, or architecture to model.' });
            return;
          }
          const resp = await generateWithFallback(ai, {
            timeoutMs: 30000,
            contents: `Design a clean, recognizable 3D parametric assembly for: "${desc}".
Build it using 6 to 16 geometric primitives ("box", "cylinder", "sphere", "cone", "torus") positioned accurately in 3D space (centered near [0,0,0], units roughly within -3 to +3) so it visually resembles the subject cleanly. Include realistic PBR hex colors, metalness (0-1), roughness (0-1), and engineering annotations.`,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  engineeringNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
                  parts: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        name: { type: Type.STRING },
                        shape: { type: Type.STRING },
                        position: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                        rotation: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                        scale: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                        color: { type: Type.STRING },
                        metalness: { type: Type.NUMBER },
                        roughness: { type: Type.NUMBER },
                        annotation: { type: Type.STRING },
                      },
                      required: [
                        'name',
                        'shape',
                        'position',
                        'rotation',
                        'scale',
                        'color',
                        'metalness',
                        'roughness',
                        'annotation',
                      ],
                    },
                  },
                },
                required: ['title', 'summary', 'engineeringNotes', 'parts'],
              },
            },
          });
          const scene = safeParseJson(resp.text ?? '', {
            title: desc,
            summary: '',
            engineeringNotes: [],
            parts: [],
          });
          res.json({ kind: '3d-scene', scene });
          return;
        }

        case 'research-newspaper': {
          const topic = prompt?.trim() || inputText?.trim();
          if (!topic) {
            res.status(400).json({ error: 'Enter a research topic or domain for the broadsheet edition.' });
            return;
          }
          const newspaperPrompt = `Compile a Research Newspaper / Academic Broadsheet on: "${topic}".
Gather current breakthroughs, peer-reviewed directions, industry shifts, and open debates.
Return strictly valid JSON (no markdown code fences) with this exact shape:
{
  "editionTitle": "string",
  "dateLabel": "string",
  "leadStory": { "headline": "string", "kicker": "string", "summary": "string", "implications": "string" },
  "articles": [
    { "headline": "string", "kicker": "string", "summary": "string", "implications": "string" }
  ]
}
Include 4 articles in "articles".`;

          let resp: unknown;
          if (Date.now() > searchQuotaCooldownUntil) {
            try {
              resp = await withRetry(() =>
                ai.models.generateContent({
                  model: 'gemini-4-hydrogen',
                  contents: newspaperPrompt,
                  config: {
                    tools: [{ googleSearch: {} }],
                  },
                })
              );
            } catch (err) {
              if (isQuotaOrNotFoundError(err)) {
                searchQuotaCooldownUntil = Date.now() + 15 * 60 * 1000;
              }
              resp = await generateWithFallback(ai, { contents: newspaperPrompt });
            }
          } else {
            resp = await generateWithFallback(ai, { contents: newspaperPrompt });
          }
          const citations = extractGroundingCitations(resp);
          const raw = ((resp as { text?: string }).text ?? '').trim();
          const newspaper = safeParseJson<Record<string, unknown> | null>(raw, null);
          if (!newspaper || !newspaper.leadStory) {
            res.json({ kind: 'markdown', title: 'Research Brief', content: raw, citations });
            return;
          }
          res.json({ kind: 'newspaper', newspaper: { ...newspaper, citations } });
          return;
        }

        case 'assignment-pdf': {
          const questionText = inputText?.trim() || prompt?.trim();
          if (!questionText && !imageBase64) {
            res.status(400).json({ error: 'Provide an assignment prompt or upload an assignment image.' });
            return;
          }
          const parts: Record<string, unknown>[] = [];
          if (imageBase64 && imageMimeType) {
            parts.push({ inlineData: { data: imageBase64, mimeType: imageMimeType } });
          }
          parts.push({
            text: `Solve this academic or professional assignment completely with rigorous methodology, clear headings, worked steps, citations/references, and a diagram prompt.
Assignment: ${questionText || 'Solve the assignment shown in the attached image.'}`,
          });

          const resp = await generateWithFallback(ai, {
            timeoutMs: 35000,
            contents: { parts },
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  promptSummary: { type: Type.STRING },
                  requirements: { type: Type.ARRAY, items: { type: Type.STRING } },
                  solvedSolutionMarkdown: { type: Type.STRING },
                  imagePrompt: { type: Type.STRING },
                  imageCaption: { type: Type.STRING },
                  referencesUsed: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: [
                  'title',
                  'promptSummary',
                  'requirements',
                  'solvedSolutionMarkdown',
                  'imagePrompt',
                  'imageCaption',
                  'referencesUsed',
                ],
              },
            },
          });
          const solved = safeParseJson<Record<string, any>>(resp.text ?? '', {});
          const generatedImageUrl =
            typeof solved.imagePrompt === 'string' && solved.imagePrompt
              ? await generateDiagramImage(ai, solved.imagePrompt, '4:3')
              : null;

          res.json({
            kind: 'assignment',
            assignment: {
              id: `asg-tool-${Date.now()}`,
              ...solved,
              generatedImageUrl: generatedImageUrl || undefined,
            },
          });
          return;
        }

        case 'doc-summarizer': {
          if (!inputText?.trim()) {
            res.status(400).json({ error: 'Paste an article, paper, or report text to summarize.' });
            return;
          }
          const resp = await generateWithFallback(ai, {
            contents: `Analyze and summarize this document for a researcher or executive. Provide:
1. Executive Abstract
2. Key Claims & Evidence
3. Methodology / Strengths & Blind Spots
4. Actionable Takeaways
${prompt ? `Focus area: ${prompt}` : ''}

Document:
${inputText}`,
          });
          res.json({ kind: 'markdown', title: 'Document Executive Analysis', content: resp.text ?? '' });
          return;
        }

        case 'translator': {
          if (!inputText?.trim()) {
            res.status(400).json({ error: 'Enter text to translate.' });
            return;
          }
          const targetLang = secondaryInput?.trim() || 'Urdu (with technical English terms preserved)';
          const resp = await generateWithFallback(ai, {
            contents: `Translate the following academic/professional text accurately into ${targetLang}. Preserve technical terminology, formulas, and tone faithfully.

Text:
${inputText}`,
          });
          res.json({ kind: 'markdown', title: `Translation (${targetLang})`, content: resp.text ?? '' });
          return;
        }

        case 'voice-brief': {
          const script = inputText?.trim() || prompt?.trim();
          if (!script) {
            res.status(400).json({ error: 'Enter notes or text to convert into a spoken audio brief.' });
            return;
          }
          const voiceName = secondaryInput?.trim() || 'Kore';
          const resp = await withRetry(() =>
            ai.models.generateContent({
              model: 'gemini-3.8-flash-lite-tts',
              contents: [
                {
                  role: 'user',
                  parts: [
                    {
                      text: script.slice(0, 4500),
                      speechMetadata: {
                        style: 'Clear, articulate academic & executive briefing voice',
                      },
                    },
                  ],
                },
              ],
              config: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName },
                  },
                },
              },
            })
          );
          const audioBase64 = resp.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
          if (!audioBase64) {
            res.status(502).json({ error: 'TTS model did not return audio data.' });
            return;
          }
          res.json({ kind: 'audio', audioDataUrl: `data:audio/wav;base64,${audioBase64}`, voiceName });
          return;
        }

        case 'flashcards': {
          const source = inputText?.trim() || prompt?.trim();
          if (!source) {
            res.status(400).json({ error: 'Provide a topic or notes to generate active-recall flashcards.' });
            return;
          }
          const resp = await generateWithFallback(ai, {
            timeoutMs: 18000,
            contents: `Create 8 high-yield active-recall flashcards from the following topic or notes:\n${source}`,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    front: { type: Type.STRING },
                    back: { type: Type.STRING },
                    hint: { type: Type.STRING },
                  },
                  required: ['front', 'back', 'hint'],
                },
              },
            },
          });
          const cards = safeParseJson(resp.text ?? '', []);
          res.json({ kind: 'flashcards', cards });
          return;
        }

        case 'code-architect': {
          const reqText = inputText?.trim() || prompt?.trim();
          if (!reqText) {
            res.status(400).json({ error: 'Describe the algorithm, bug, or architecture problem.' });
            return;
          }
          const lang = secondaryInput?.trim() || 'TypeScript / Python';
          const resp = await generateWithFallback(ai, {
            contents: `As a principal software architect (${lang}), solve/architect/debug the following request with clean production code, edge-case handling, and time/space complexity analysis:\n\n${reqText}`,
            config: {
              thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
            },
          });
          res.json({ kind: 'markdown', title: `Code & Architecture (${lang})`, content: resp.text ?? '' });
          return;
        }

        case 'pitch-builder': {
          const topic = inputText?.trim() || prompt?.trim();
          if (!topic) {
            res.status(400).json({ error: 'Provide your presentation topic, research, or project brief.' });
            return;
          }
          const resp = await generateWithFallback(ai, {
            contents: `Build an 8-slide executive or academic presentation deck outline for: "${topic}".
For each slide include: Slide Title, 3 Concise Bullet Points, Visual/Chart Direction, and a 2-sentence Speaker Script.`,
          });
          res.json({ kind: 'markdown', title: 'Presentation & Speaker Script', content: resp.text ?? '' });
          return;
        }

        case 'pro-drafter': {
          const notes = inputText?.trim() || prompt?.trim();
          if (!notes) {
            res.status(400).json({ error: 'Enter rough bullets or voice memo notes to polish.' });
            return;
          }
          const format = secondaryInput?.trim() || 'Executive Email';
          const resp = await generateWithFallback(ai, {
            contents: `Transform these rough notes into a polished, high-impact ${format}. Include a clear subject/title line, structured body, and explicit next steps.\n\nNotes:\n${notes}`,
          });
          res.json({ kind: 'markdown', title: `Drafted ${format}`, content: resp.text ?? '' });
          return;
        }

        default:
          res.status(400).json({ error: `Unknown tool: ${toolId}` });
      }
    } catch (err) {
      console.error('Tool run error:', err);
      res.status(500).json({ error: formatCleanError(err) });
    }
  });

  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Qalam Studio server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
