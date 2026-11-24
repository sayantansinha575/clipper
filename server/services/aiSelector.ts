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

function chunkSegmentArray<T>(
  items: T[],
  maxPerChunk: number,
  overlap: number
): T[][] {
  if (items.length <= maxPerChunk) {
    return items.length > 0 ? [items] : [];
  }
  const chunks: T[][] = [];
  let start = 0;
  while (start < items.length) {
    const end = Math.min(items.length, start + maxPerChunk);
    chunks.push(items.slice(start, end));
    if (end >= items.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

type CompactBlock = { start: number; end: number; text: string };

function compactSegmentsForOllama(
  segments: TranscriptData['segments'],
  targetBlockSec = 18,
  maxGapSec = 2.0,
  maxChars = 340
): CompactBlock[] {
  const blocks: CompactBlock[] = [];
  let cur: CompactBlock | null = null;

  for (const seg of segments) {
    const clean = (seg.text || '').trim();
    if (!clean) continue;

    if (!cur) {
      cur = { start: seg.start, end: seg.end, text: clean };
      continue;
    }

    const gap = seg.start - cur.end;
    const span = seg.end - cur.start;
    if (gap <= maxGapSec && span <= targetBlockSec && cur.text.length + clean.length + 1 <= maxChars) {
      cur.end = Math.max(cur.end, seg.end);
      cur.text = `${cur.text} ${clean}`;
    } else {
      blocks.push(cur);
      cur = { start: seg.start, end: seg.end, text: clean };
    }
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function selectTopChunksAcrossTimeline(
  chunks: CompactBlock[][],
  scenes: number[],
  maxChunks = 10
): CompactBlock[][] {
  if (chunks.length <= maxChunks) return chunks;

  const scoreChunk = (chunk: CompactBlock[]): number => {
    const start = chunk[0].start;
    const end = chunk[chunk.length - 1].end;
    const span = Math.max(1, end - start);
    let textLen = 0;
    let cues = 0;
    for (const b of chunk) {
      textLen += b.text.length;
      cues += (b.text.match(/[!?]/g) || []).length;
    }
    const sceneCount = scenes.filter((s) => s >= start && s <= end).length;
    return textLen / span + cues * 2.5 + sceneCount * 1.5;
  };

  // Pick the highest-signal chunk from each even timeline bucket for full start-to-end coverage
  const selected: CompactBlock[][] = [];
  for (let b = 0; b < maxChunks; b++) {
    const lo = Math.floor((b * chunks.length) / maxChunks);
    const hi = Math.max(lo + 1, Math.floor(((b + 1) * chunks.length) / maxChunks));
    let bestIdx = lo;
    let bestScore = -1;
    for (let i = lo; i < hi; i++) {
      const s = scoreChunk(chunks[i]);
      if (s > bestScore) {
        bestScore = s;
        bestIdx = i;
      }
    }
    selected.push(chunks[bestIdx]);
  }
  return selected;
}

async function selectChunkWithOllama(params: {
  ollamaBaseUrl: string;
  ollamaModel: string;
  prompt: string;
  isCancelled?: () => boolean;
}): Promise<{ clips?: RawCandidateClip[]; notes?: string }> {
  const systemPrompt = [
    'You are a short-form video editor. Return ONLY valid JSON matching this exact structure:',
    '{"notes": "brief explanation", "clips": [{"start": 0.0, "end": 30.0, "title": "Short title", "hook": "Opening hook", "reason": "Why engaging", "category": "highlight", "score": 90}]}',
    'Rules: start and end must be numbers in seconds, start < end, never fabricate dialogue.',
  ].join('\n');

  return generateOllamaJson<{ clips?: RawCandidateClip[]; notes?: string }>({
    baseUrl: params.ollamaBaseUrl,
    model: params.ollamaModel,
    systemPrompt,
    userPrompt: params.prompt,
    timeoutMs: 180_000,
    numCtx: 2048,
    numPredict: 700,
    isCancelled: params.isCancelled,
  });
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

function buildSpeechFallbackClips(
  segments: TranscriptData['segments'],
  scenes: number[],
  videoDuration: number,
  minDur: number,
  maxDur: number,
  desiredCount: number,
  focus: SelectionFocus
): RawCandidateClip[] {
  if (segments.length === 0) {
    return buildSceneFallbackClips(scenes, videoDuration, minDur, maxDur, desiredCount, focus);
  }
  const raw: RawCandidateClip[] = [];
  const targetDur = Math.min(maxDur, Math.max(minDur, Math.min(45, (minDur + maxDur) / 2)));
  const usableCount = Math.min(desiredCount, Math.max(1, Math.floor(videoDuration / Math.max(minDur, 1))));
  const spacing = videoDuration / usableCount;

  for (let i = 0; i < usableCount; i++) {
    const windowStart = i * spacing;
    const windowEnd = Math.min(videoDuration - minDur, windowStart + spacing * 0.65);
    const anchor =
      segments.find((s) => s.start >= windowStart && s.start <= windowEnd) ||
      segments.find((s) => s.start >= windowStart);

    const start = anchor
      ? Math.min(Math.max(0, anchor.start), Math.max(0, videoDuration - minDur))
      : Math.min(windowStart, Math.max(0, videoDuration - minDur));
    const end = Math.min(videoDuration, start + targetDur);
    if (end - start < minDur) continue;

    const preview = (anchor?.text || 'Speech highlight').trim().slice(0, 75);
    raw.push({
      start: Number(start.toFixed(2)),
      end: Number(end.toFixed(2)),
      title: `Highlight ${raw.length + 1}`,
      hook: preview || `Highlight starting at ${start.toFixed(1)}s`,
      reason: 'Aligned to spoken transcript segment across video timeline.',
      category: focus,
      score: 76,
    });
  }

  return raw.length > 0
    ? raw
    : buildSceneFallbackClips(scenes, videoDuration, minDur, maxDur, desiredCount, focus);
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
        isCancelled,
      });
      rawClips = ollamaRes.clips || [];
      notes = ollamaRes.notes || '';
      onProgress?.(54, `Ollama (${aiSettings.ollamaModel}) selected ${rawClips.length} candidate clip(s).`);
    } catch (ollamaErr) {
      if (isCancelled?.()) {
        throw new Error('Job cancelled by user');
      }
      const errMsg = ollamaErr instanceof Error ? ollamaErr.message : String(ollamaErr);
      onProgress?.(
        54,
        `Ollama skipped (${errMsg.slice(0, 60)}); using visual scene boundaries...`
      );
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
      notes = `Generated ${rawClips.length} scene-aligned clip(s) without cloud LLM.`;
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
  const ollamaCompactAll = compactSegmentsForOllama(transcript.segments);
  const chunks: CompactBlock[][] = useOllamaActive
    ? selectTopChunksAcrossTimeline(chunkSegmentArray(ollamaCompactAll, 18, 2), scenes, 10)
    : chunkSegmentArray(transcript.segments, 100, 12);

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
        ? `Analyzing window ${idx + 1}/${chunks.length} with local Ollama (${aiSettings.ollamaModel})...`
        : `Analyzing chunk ${idx + 1}/${chunks.length} with Gemini (${modelToUse})...`
    );

    const relevantScenes = scenes.filter((s) => s >= chunkStart && s <= chunkEnd);
    const buildPromptForBlock = (items: CompactBlock[], concise: boolean) => {
      const formatted = items
        .map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`)
        .join('\n');
      return [
        `Video duration: ${videoDuration.toFixed(1)}s | Window: ${chunkStart.toFixed(1)}s-${chunkEnd.toFixed(1)}s.`,
        `Scene cuts: ${relevantScenes.slice(0, concise ? 15 : 40).join(', ') || 'none'}.`,
        `Select up to ${targetPerChunk} standalone clips (${minDur}s-${maxDur}s each).`,
        `Focus: ${FOCUS_PROMPTS[config.selectionFocus]}`,
        config.customInstructions ? `Extra instructions: ${config.customInstructions}` : '',
        concise
          ? 'Pick clips with strong opening hooks, complete standalone thoughts, and zero overlapping ranges.'
          : [
              'Criteria:',
              '1. Strong opening hook in the first 3 seconds.',
              '2. Complete standalone meaning — never cut mid-sentence.',
              '3. High emotional, educational, storytelling, humor, or surprising insight.',
              '4. Avoid long silences, filler, or overlapping clips.',
              '5. Never fabricate dialogue; only use timestamps from the transcript below.',
            ].join('\n'),
        `\nTRANSCRIPT:\n${formatted}`,
      ]
        .filter(Boolean)
        .join('\n');
    };

    const runOllamaSafe = async (items: CompactBlock[]): Promise<{ clips?: RawCandidateClip[]; notes?: string }> => {
      const compactItems = items.length > 22 ? compactSegmentsForOllama(items as TranscriptData['segments']) : items;
      const sliced = compactItems.length > 22 ? compactItems.slice(0, 22) : compactItems;
      try {
        return await selectChunkWithOllama({
          ollamaBaseUrl: aiSettings.ollamaBaseUrl,
          ollamaModel: aiSettings.ollamaModel,
          prompt: buildPromptForBlock(sliced, true),
          isCancelled,
        });
      } catch (ollamaErr) {
        if (isCancelled?.()) {
          throw new Error('Job cancelled by user');
        }
        const msg = ollamaErr instanceof Error ? ollamaErr.message : String(ollamaErr);
        notesList.push(`Window ${idx + 1} skipped (${msg.slice(0, 80)}).`);
        return { clips: [] };
      }
    };

    let parsed: { clips?: RawCandidateClip[]; notes?: string };

    if (!useOllamaActive) {
      const prompt = buildPromptForBlock(chunk, false);
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
            `Gemini unavailable/rate-limited; switching to local Ollama (${aiSettings.ollamaModel})...`
          );
          parsed = await runOllamaSafe(chunk);
        } else {
          throw err;
        }
      }
    } else {
      parsed = await runOllamaSafe(chunk);
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
    const fallbackMin = Math.min(minDur, videoDuration);
    const fallbackClips = buildSpeechFallbackClips(
      transcript.segments,
      scenes,
      videoDuration,
      fallbackMin,
      maxDur,
      desiredCount,
      config.selectionFocus
    );
    validated = validateClipTimestamps(
      fallbackClips,
      videoDuration,
      fallbackMin,
      maxDur,
      desiredCount
    );
    notesList.push(
      `Generated ${validated.length} speech-aligned clip(s) across ${videoDuration.toFixed(1)}s timeline.`
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
