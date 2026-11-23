import { Type } from '@google/genai';
import fs from 'fs';
import path from 'path';
import { DIRS } from '../config.ts';
import type { AppSettings, JobConfig, SelectionFocus, TranscriptData } from '../types.ts';
import { getGeminiClient, withRetry } from '../utils/geminiClient.ts';
import {
  type RawCandidateClip,
  type ValidatedCandidateClip,
  validateClipTimestamps,
} from '../utils/validators.ts';
import { extractVideoFrame } from './audioExtractor.ts';
import { generateOllamaJson } from './ollamaClient.ts';

const FOCUS_PROMPTS: Record<SelectionFocus, string> = {
  best_moments:
    'Prioritize the strongest overall standalone moments with immediate hooks, clear narrative arcs, and high viewer retention.',
  educational:
    'Prioritize clear explanations, actionable takeaways, counter-intuitive insights, and concise tutorials.',
  funny:
    'Prioritize humorous exchanges, witty remarks, comedic timing, and entertaining reactions.',
  storytelling:
    'Prioritize complete personal stories, dramatic setups with payoffs, and emotional arcs.',
  motivational:
    'Prioritize inspiring realizations, mindset shifts, bold advice, and memorable quotes.',
  podcast_highlights:
    'Prioritize sharp debates, surprising revelations, memorable questions, and punchy host/guest exchanges.',
  custom: 'Follow the custom instructions carefully.',
};

export function isRateLimitOrFallbackError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('504') ||
    msg.includes('unavailable') ||
    msg.includes('high demand') ||
    msg.includes('overloaded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('rate limit') ||
    msg.includes('quota') ||
    msg.includes('gemini_api_key is not configured') ||
    msg.includes('api_key_invalid') ||
    msg.includes('permission_denied')
  );
}

function chunkSegments(
  transcript: TranscriptData,
  maxSegmentsPerChunk = 100,
  overlapSegments = 12
) {
  const segs = transcript.segments;
  if (segs.length <= maxSegmentsPerChunk) {
    return [segs];
  }
  const chunks: typeof segs[] = [];
  let start = 0;
  while (start < segs.length) {
    const end = Math.min(segs.length, start + maxSegmentsPerChunk);
    chunks.push(segs.slice(start, end));
    if (end >= segs.length) break;
    start = end - overlapSegments;
  }
  return chunks;
}

async function selectChunkWithOllama(params: {
  ollamaBaseUrl: string;
  ollamaModel: string;
  prompt: string;
}): Promise<{ clips?: RawCandidateClip[]; notes?: string }> {
  const systemPrompt = [
    'You are a short-form video editor. Return ONLY valid JSON matching this exact structure:',
    '{"notes": "brief explanation", "clips": [{"start": 0.0, "end": 30.0, "title": "Short title", "hook": "Opening hook", "reason": "Why engaging", "category": "highlight", "score": 90}]}',
    'Rules: start and end must be numbers in seconds, start < end, never fabricate dialogue.',
  ].join('\n');

  return withRetry(
    () =>
      generateOllamaJson<{ clips?: RawCandidateClip[]; notes?: string }>({
        baseUrl: params.ollamaBaseUrl,
        model: params.ollamaModel,
        systemPrompt,
        userPrompt: params.prompt,
      }),
    2,
    800
  );
}

function buildSceneFallbackClips(
  scenes: number[],
  videoDuration: number,
  minDur: number,
  maxDur: number,
  desiredCount: number,
  focus: SelectionFocus
): RawCandidateClip[] {
  const boundaries = [0, ...scenes.filter((s) => s > 0.5 && s < videoDuration - 0.5), videoDuration];
  const raw: RawCandidateClip[] = [];
  const step = Math.max(minDur, Math.min(maxDur, videoDuration / Math.max(1, desiredCount)));

  if (boundaries.length >= 3) {
    let curStart = 0;
    for (let i = 1; i < boundaries.length; i++) {
      const span = boundaries[i] - curStart;
      if (span >= minDur) {
        const end = Math.min(videoDuration, curStart + Math.min(maxDur, span));
        raw.push({
          start: Number(curStart.toFixed(2)),
          end: Number(end.toFixed(2)),
          title: `Scene Segment ${raw.length + 1}`,
          hook: `Visual scene transition at ${curStart.toFixed(1)}s`,
          reason: 'Aligned to detected visual scene boundary.',
          category: focus,
          score: 78,
        });
        curStart = end;
      }
      if (raw.length >= desiredCount) break;
    }
  }

  if (raw.length === 0) {
    let cursor = 0;
    while (cursor + minDur <= videoDuration && raw.length < desiredCount) {
      const end = Math.min(videoDuration, cursor + step);
      raw.push({
        start: Number(cursor.toFixed(2)),
        end: Number(end.toFixed(2)),
        title: `Segment ${raw.length + 1}`,
        hook: `Highlight starting at ${cursor.toFixed(1)}s`,
        reason: 'Evenly segmented within configured duration bounds.',
        category: focus,
        score: 74,
      });
      cursor = end;
    }
  }

  return raw;
}

export async function selectClipsWithGemini(params: {
  videoPath: string;
  jobId: string;
  videoDuration: number;
  transcript: TranscriptData;
  scenes: number[];
  config: JobConfig;
  aiSettings: AppSettings['ai'];
  onProgress?: (pct: number, message: string) => void;
  isCancelled?: () => boolean;
}): Promise<{ clips: ValidatedCandidateClip[]; aiNotes: string }> {
  const {
    videoPath,
    jobId,
    videoDuration,
    transcript,
    scenes,
    config,
    aiSettings,
    onProgress,
    isCancelled,
  } = params;

  const desiredCount = Math.max(1, Math.min(50, config.clipCount));
  const minDur = Math.max(3, Math.min(config.minDuration, videoDuration));
  const maxDur = Math.max(minDur, Math.min(config.maxDuration, videoDuration));
  const modelToUse = aiSettings.model || 'gemini-4-hydrogen';
  let useOllamaActive = aiSettings.provider === 'ollama_only';
  let fallbackTriggered = false;

  // Visual / no-speech path
  if (!transcript.hasSpeech || transcript.segments.length === 0) {
    onProgress?.(
      44,
      useOllamaActive
        ? `No speech transcript available; using local Ollama (${aiSettings.ollamaModel}) with scene boundaries...`
        : 'No speech track found; analyzing visual frames and scene cuts...'
    );

    if (!useOllamaActive) {
      try {
        const ai = getGeminiClient();
        const sampleCount = Math.min(8, Math.max(2, Math.floor(videoDuration / 5) + 1));
        const frameParts: Array<
          { inlineData: { mimeType: string; data: string } } | { text: string }
        > = [];

        for (let i = 0; i < sampleCount; i++) {
          if (isCancelled?.()) throw new Error('Job cancelled by user');
          const ts = Number(((i / sampleCount) * Math.max(1, videoDuration - 0.5)).toFixed(2));
          const frameFile = path.join(DIRS.temp, `${jobId}_frame_${i}.jpg`);
          try {
            await extractVideoFrame(videoPath, ts, frameFile);
            if (fs.existsSync(frameFile)) {
              frameParts.push({ text: `Frame at ${ts}s:` });
              frameParts.push({
                inlineData: {
                  mimeType: 'image/jpeg',
                  data: fs.readFileSync(frameFile).toString('base64'),
                },
              });
              fs.unlinkSync(frameFile);
            }
          } catch {
            // Ignore single frame error
          }
        }

        const visualPrompt = [
          `This video has duration ${videoDuration.toFixed(2)}s and no spoken dialogue.`,
          `Detected visual scene change timestamps (seconds): ${scenes.slice(0, 50).join(', ') || 'none'}.`,
          `Select up to ${desiredCount} compelling visual highlight clips between ${minDur}s and ${maxDur}s each.`,
          `Focus: ${FOCUS_PROMPTS[config.selectionFocus]} ${config.customInstructions || ''}`,
          'Ensure start < end and all timestamps are strictly within [0, ' + videoDuration.toFixed(2) + '].',
          'If the video is short and cannot yield ' + desiredCount + ' distinct clips, return fewer clips and explain why in notes.',
        ].join('\n');

        const result = await withRetry(async () => {
          const response = await ai.models.generateContent({
            model: modelToUse,
            contents: { parts: [...frameParts, { text: visualPrompt }] },
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  notes: { type: Type.STRING },
                  clips: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                        title: { type: Type.STRING },
                        hook: { type: Type.STRING },
                        reason: { type: Type.STRING },
                        category: { type: Type.STRING },
                        score: { type: Type.NUMBER },
                      },
                      required: ['start', 'end', 'title', 'hook', 'reason', 'category', 'score'],
                    },
                  },
                },
                required: ['clips', 'notes'],
              },
            },
          });
          return JSON.parse((response.text || '{}').trim()) as {
            clips?: RawCandidateClip[];
            notes?: string;
          };
        });

        const validated = validateClipTimestamps(
          result.clips || [],
          videoDuration,
          minDur,
          maxDur,
          desiredCount
        );
        return {
          clips: validated,
          aiNotes: `[Gemini ${modelToUse}] ${result.notes || `Selected ${validated.length} visual highlight clip(s).`}`,
        };
      } catch (err) {
        if (
          aiSettings.provider === 'gemini_with_ollama_fallback' &&
          isRateLimitOrFallbackError(err)
        ) {
          useOllamaActive = true;
          fallbackTriggered = true;
        } else {
          throw err;
        }
      }
    }

    // Ollama / Scene-boundary selection when no speech transcript exists
    const scenePrompt = [
      `Video duration: ${videoDuration.toFixed(2)}s (no speech transcript).`,
      `Detected visual scene timestamps (seconds): ${scenes.slice(0, 60).join(', ') || 'none'}.`,
      `Select up to ${desiredCount} clips between ${minDur}s and ${maxDur}s aligned with scene transitions.`,
      `Focus: ${FOCUS_PROMPTS[config.selectionFocus]} ${config.customInstructions || ''}`,
    ].join('\n');

    let rawClips: RawCandidateClip[] = [];
    let notes = '';
    try {
      const ollamaRes = await selectChunkWithOllama({
        ollamaBaseUrl: aiSettings.ollamaBaseUrl,
        ollamaModel: aiSettings.ollamaModel,
        prompt: scenePrompt,
      });
      rawClips = ollamaRes.clips || [];
      notes = ollamaRes.notes || '';
    } catch {
      rawClips = [];
    }

    if (rawClips.length === 0) {
      rawClips = buildSceneFallbackClips(
        scenes,
        videoDuration,
        minDur,
        maxDur,
        desiredCount,
        config.selectionFocus
      );
      notes = `Generated ${rawClips.length} scene-aligned clip(s) without Gemini API.`;
    }

    const validated = validateClipTimestamps(
      rawClips,
      videoDuration,
      minDur,
      maxDur,
      desiredCount
    );
    const prefix = fallbackTriggered
      ? `[Ollama Fallback: ${aiSettings.ollamaModel}]`
      : `[Local Ollama: ${aiSettings.ollamaModel}]`;
    return { clips: validated, aiNotes: `${prefix} ${notes}`.trim() };
  }

  // Speech transcript chunked selection
  const chunks = chunkSegments(transcript);
  const allCandidates: RawCandidateClip[] = [];
  const notesList: string[] = [];

  for (let idx = 0; idx < chunks.length; idx++) {
    if (isCancelled?.()) throw new Error('Job cancelled by user');

    const chunk = chunks[idx];
    const chunkStart = chunk[0].start;
    const chunkEnd = chunk[chunk.length - 1].end;
    const targetPerChunk = Math.max(3, Math.ceil((desiredCount / chunks.length) * 1.4));

    onProgress?.(
      40 + Math.round(((idx + 0.5) / chunks.length) * 14),
      useOllamaActive
        ? `Analyzing chunk ${idx + 1}/${chunks.length} with local Ollama (${aiSettings.ollamaModel})...`
        : `Analyzing chunk ${idx + 1}/${chunks.length} with Gemini (${modelToUse})...`
    );

    const relevantScenes = scenes.filter((s) => s >= chunkStart && s <= chunkEnd);
    const formattedTranscript = chunk
      .map((s) => `[${s.start.toFixed(2)} - ${s.end.toFixed(2)}] ${s.text}`)
      .join('\n');

    const prompt = [
      `You are an expert short-form video editor selecting viral YouTube Shorts / Reels / TikTok clips.`,
      `Source video total duration: ${videoDuration.toFixed(2)} seconds.`,
      `Transcript window: ${chunkStart.toFixed(2)}s to ${chunkEnd.toFixed(2)}s.`,
      `Nearby scene cut timestamps: ${relevantScenes.slice(0, 40).join(', ') || 'none'}.`,
      `Target: Select up to ${targetPerChunk} standout clips from this window.`,
      `Clip duration constraint: strictly between ${minDur}s and ${maxDur}s per clip.`,
      `Selection focus: ${FOCUS_PROMPTS[config.selectionFocus]}`,
      config.customInstructions ? `Additional instructions: ${config.customInstructions}` : '',
      `Criteria:`,
      `1. Strong opening hook in the first 3 seconds.`,
      `2. Complete standalone meaning — never cut mid-sentence or require watching earlier context.`,
      `3. High emotional, educational, storytelling, humor, or surprising insight.`,
      `4. Avoid long silences, filler, or overlapping clips.`,
      `5. Never fabricate dialogue; only use timestamps supported by the transcript below.`,
      `If this window does not have enough quality material for ${targetPerChunk} clips, return fewer clips and explain why in "notes".`,
      `\nTRANSCRIPT:\n${formattedTranscript}`,
    ]
      .filter(Boolean)
      .join('\n');

    let parsed: { clips?: RawCandidateClip[]; notes?: string };

    if (!useOllamaActive) {
      try {
        const ai = getGeminiClient();
        parsed = await withRetry(async () => {
          const response = await ai.models.generateContent({
            model: modelToUse,
            contents: prompt,
            config: {
              systemInstruction:
                'Return strict JSON with valid start/end timestamps matching the provided transcript window.',
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  notes: { type: Type.STRING },
                  clips: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                        title: { type: Type.STRING },
                        hook: { type: Type.STRING },
                        reason: { type: Type.STRING },
                        category: { type: Type.STRING },
                        score: { type: Type.NUMBER },
                      },
                      required: ['start', 'end', 'title', 'hook', 'reason', 'category', 'score'],
                    },
                  },
                },
                required: ['clips', 'notes'],
              },
            },
          });
          const raw = (response.text || '{}').trim();
          return JSON.parse(raw) as { clips?: RawCandidateClip[]; notes?: string };
        });
      } catch (err) {
        if (
          aiSettings.provider === 'gemini_with_ollama_fallback' &&
          isRateLimitOrFallbackError(err)
        ) {
          useOllamaActive = true;
          fallbackTriggered = true;
          onProgress?.(
            40 + Math.round(((idx + 0.5) / chunks.length) * 14),
            `Gemini quota/rate-limit hit; switching chunk ${idx + 1} to local Ollama (${aiSettings.ollamaModel})...`
          );
          parsed = await selectChunkWithOllama({
            ollamaBaseUrl: aiSettings.ollamaBaseUrl,
            ollamaModel: aiSettings.ollamaModel,
            prompt,
          });
        } else {
          throw err;
        }
      }
    } else {
      parsed = await selectChunkWithOllama({
        ollamaBaseUrl: aiSettings.ollamaBaseUrl,
        ollamaModel: aiSettings.ollamaModel,
        prompt,
      });
    }

    if (parsed.notes) notesList.push(parsed.notes);
    if (Array.isArray(parsed.clips)) {
      allCandidates.push(...parsed.clips);
    }
  }

  let validated = validateClipTimestamps(
    allCandidates,
    videoDuration,
    minDur,
    maxDur,
    desiredCount
  );

  if (validated.length === 0 && videoDuration >= 3) {
    const fallbackEnd = Math.min(videoDuration, maxDur);
    validated = validateClipTimestamps(
      [
        {
          start: 0,
          end: fallbackEnd,
          title: 'Primary Video Segment',
          hook: transcript.segments[0]?.text.slice(0, 100) || 'Opening segment',
          reason: 'Full available segment matching configured duration limits.',
          category: config.selectionFocus,
          score: 75,
        },
      ],
      videoDuration,
      Math.min(3, videoDuration),
      maxDur,
      1
    );
    notesList.push(
      `Source duration (${videoDuration.toFixed(1)}s) limited strict multi-clip extraction; generated ${validated.length} validated clip.`
    );
  } else if (validated.length < desiredCount) {
    notesList.push(
      `Generated ${validated.length} of ${desiredCount} requested clips to preserve standalone quality and avoid overlap within ${videoDuration.toFixed(1)}s source duration.`
    );
  }

  const providerTag = fallbackTriggered
    ? `[Ollama Fallback: ${aiSettings.ollamaModel}]`
    : useOllamaActive
    ? `[Local Ollama: ${aiSettings.ollamaModel}]`
    : `[Gemini: ${modelToUse}]`;

  return {
    clips: validated,
    aiNotes: `${providerTag} ${notesList.filter(Boolean).join(' ')}`.trim(),
  };
}
