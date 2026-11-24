import { Type } from '@google/genai';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { DIRS } from '../config.ts';
import type { AppSettings, TranscriptData, TranscriptSegment, TranscriptWord } from '../types.ts';
import { cleanupJobTempFiles } from '../utils/cleanup.ts';
import { getGeminiClient, withRetry } from '../utils/geminiClient.ts';
import { extractAudioTrack, sliceAudioChunk } from './audioExtractor.ts';

function alignWordTimings(
  segStart: number,
  segEnd: number,
  text: string,
  rawWords?: Array<{ word: string; start: number; end: number }>
): TranscriptWord[] {
  const cleanText = text.trim();
  if (!cleanText) return [];

  if (rawWords && rawWords.length > 0) {
    const valid: TranscriptWord[] = [];
    for (const w of rawWords) {
      const wordStr = (w.word || '').trim();
      if (!wordStr) continue;
      const ws = Math.max(segStart, Math.min(segEnd, Number(w.start)));
      const we = Math.max(ws + 0.05, Math.min(segEnd, Number(w.end)));
      if (Number.isFinite(ws) && Number.isFinite(we)) {
        valid.push({
          word: wordStr,
          start: Number(ws.toFixed(3)),
          end: Number(we.toFixed(3)),
        });
      }
    }
    if (valid.length > 0) return valid;
  }

  // Proportional character-weighted timing across the segment
  const tokens = cleanText.split(/\s+/).filter(Boolean);
  const totalChars = tokens.reduce((sum, t) => sum + Math.max(1, t.length), 0);
  const span = Math.max(0.2, segEnd - segStart);
  let cursor = segStart;
  return tokens.map((token, idx) => {
    const weight = Math.max(1, token.length) / totalChars;
    const dur = idx === tokens.length - 1 ? Math.max(0.05, segEnd - cursor) : Math.max(0.05, span * weight);
    const wStart = Number(cursor.toFixed(3));
    const wEnd = Number(Math.min(segEnd, cursor + dur).toFixed(3));
    cursor = wEnd;
    return { word: token, start: wStart, end: Math.max(wStart + 0.05, wEnd) };
  });
}

export function findWhisperPython(): string | null {
  const candidates = [
    process.env.WHISPER_PYTHON || '',
    path.resolve(process.cwd(), '.venv-whisper', 'bin', 'python'),
    path.resolve(process.cwd(), 'deploy', 'backend', '.venv', 'bin', 'python'),
    'python3',
    'python',
  ].filter(Boolean);

  for (const bin of candidates) {
    if (bin.includes(path.sep) && !fs.existsSync(bin)) {
      continue;
    }
    try {
      execFileSync(bin, ['-c', 'import faster_whisper'], {
        stdio: 'ignore',
        timeout: 5000,
      });
      return bin;
    } catch {
      // Try next candidate
    }
  }
  return null;
}

async function transcribeWithLocalWhisper(params: {
  pythonBin: string;
  videoPath: string;
  jobId: string;
  duration: number;
  transcriptPath: string;
  whisperSettings?: AppSettings['whisper'];
  onProgress?: (pct: number, message: string) => void;
  isCancelled?: () => boolean;
}): Promise<TranscriptData> {
  const {
    pythonBin,
    videoPath,
    jobId,
    duration,
    transcriptPath,
    whisperSettings,
    onProgress,
    isCancelled,
  } = params;

  const scriptPath = path.resolve(process.cwd(), 'server', 'scripts', 'whisper_transcribe.py');
  if (!fs.existsSync(scriptPath)) {
    throw new Error('Local whisper transcription script is missing.');
  }

  onProgress?.(16, 'Extracting mono audio track for local Whisper transcription...');
  const audioPath = await extractAudioTrack(videoPath, jobId);

  const modelSize = whisperSettings?.modelSize || 'small';
  const device = whisperSettings?.device || 'cpu';
  const computeType = whisperSettings?.computeType || 'int8';
  const cpuThreads = String(whisperSettings?.cpuThreads || 4);
  const language = whisperSettings?.language || 'auto';

  try {
    onProgress?.(19, `Running local faster-whisper (${modelSize}, ${computeType})...`);
    await new Promise<void>((resolve, reject) => {
      const child = spawn(pythonBin, [
        scriptPath,
        audioPath,
        transcriptPath,
        modelSize,
        device,
        computeType,
        cpuThreads,
        language,
        String(duration),
      ]);

      let stderrTail = '';
      const cancelPoll = setInterval(() => {
        if (isCancelled?.()) {
          child.kill('SIGTERM');
          clearInterval(cancelPoll);
          reject(new Error('Job cancelled by user'));
        }
      }, 400);

      child.stdout.on('data', (chunk: Buffer) => {
        const lines = chunk.toString('utf-8').split(/\r?\n/);
        for (const line of lines) {
          if (line.startsWith('STATUS:')) {
            onProgress?.(20, line.slice(7).trim());
          } else if (line.startsWith('PROGRESS:')) {
            const p = Number(line.slice(9).trim());
            if (Number.isFinite(p)) {
              const mapped = 20 + Math.round((Math.max(0, Math.min(100, p)) / 100) * 17);
              onProgress?.(mapped, `Local Whisper transcribing speech (${p}%)...`);
            }
          }
        }
      });

      child.stderr.on('data', (chunk: Buffer) => {
        stderrTail = (stderrTail + chunk.toString('utf-8')).slice(-1500);
      });

      child.on('error', (err) => {
        clearInterval(cancelPoll);
        reject(err);
      });

      child.on('close', (code) => {
        clearInterval(cancelPoll);
        if (code === 0 && fs.existsSync(transcriptPath)) {
          resolve();
        } else {
          reject(new Error(`faster-whisper exited with code ${code}: ${stderrTail.trim()}`));
        }
      });
    });

    const raw = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8')) as TranscriptData;
    const normalizedSegments: TranscriptSegment[] = (raw.segments || []).map((seg) => ({
      start: Number(seg.start),
      end: Number(seg.end),
      text: (seg.text || '').trim(),
      words: alignWordTimings(Number(seg.start), Number(seg.end), seg.text || '', seg.words),
    }));

    const normalized: TranscriptData = {
      language: raw.language || (language !== 'auto' ? language : 'en'),
      duration: raw.duration || duration,
      hasSpeech: normalizedSegments.length > 0,
      segments: normalizedSegments,
    };
    fs.writeFileSync(transcriptPath, JSON.stringify(normalized, null, 2), 'utf-8');
    return normalized;
  } finally {
    cleanupJobTempFiles(jobId);
  }
}

export async function transcribeVideoAudio(params: {
  videoPath: string;
  jobId: string;
  duration: number;
  hasAudio: boolean;
  languageHint?: string;
  whisperSettings?: AppSettings['whisper'];
  skipCloudStt?: boolean;
  allowSkipOnQuotaOrLocalOnly?: boolean;
  onProgress?: (pct: number, message: string) => void;
  isCancelled?: () => boolean;
}): Promise<{ transcript: TranscriptData; transcriptPath: string }> {
  const {
    videoPath,
    jobId,
    duration,
    hasAudio,
    languageHint,
    whisperSettings,
    skipCloudStt = false,
    allowSkipOnQuotaOrLocalOnly = false,
    onProgress,
    isCancelled,
  } = params;
  const transcriptPath = path.join(DIRS.subtitles, `${jobId}_transcript.json`);

  if (!hasAudio || duration <= 0) {
    const emptyTranscript: TranscriptData = {
      language: 'none',
      duration,
      hasSpeech: false,
      segments: [],
    };
    fs.writeFileSync(transcriptPath, JSON.stringify(emptyTranscript, null, 2), 'utf-8');
    return { transcript: emptyTranscript, transcriptPath };
  }

  if (skipCloudStt) {
    const whisperPython = findWhisperPython();
    if (whisperPython) {
      try {
        const transcript = await transcribeWithLocalWhisper({
          pythonBin: whisperPython,
          videoPath,
          jobId,
          duration,
          transcriptPath,
          whisperSettings,
          onProgress,
          isCancelled,
        });
        return { transcript, transcriptPath };
      } catch (err) {
        if (isCancelled?.()) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        onProgress?.(34, `Local Whisper failed (${msg.slice(0, 70)}); continuing without captions...`);
      }
    } else {
      onProgress?.(
        34,
        'Local faster-whisper not installed; run ./deploy/scripts/install-whisper.sh to enable captions in Ollama-only mode.'
      );
    }
    const localTranscript: TranscriptData = {
      language: languageHint && languageHint !== 'auto' ? languageHint : 'en',
      duration,
      hasSpeech: false,
      segments: [],
    };
    fs.writeFileSync(transcriptPath, JSON.stringify(localTranscript, null, 2), 'utf-8');
    return { transcript: localTranscript, transcriptPath };
  }

  let ai;
  try {
    ai = getGeminiClient();
  } catch (err) {
    if (allowSkipOnQuotaOrLocalOnly) {
      const whisperPython = findWhisperPython();
      if (whisperPython) {
        const transcript = await transcribeWithLocalWhisper({
          pythonBin: whisperPython,
          videoPath,
          jobId,
          duration,
          transcriptPath,
          whisperSettings,
          onProgress,
          isCancelled,
        });
        return { transcript, transcriptPath };
      }
      onProgress?.(
        30,
        'No Gemini API key and faster-whisper not installed; switching to scene-only mode...'
      );
      const fallbackTranscript: TranscriptData = {
        language: languageHint && languageHint !== 'auto' ? languageHint : 'en',
        duration,
        hasSpeech: false,
        segments: [],
      };
      fs.writeFileSync(transcriptPath, JSON.stringify(fallbackTranscript, null, 2), 'utf-8');
      return { transcript: fallbackTranscript, transcriptPath };
    }
    throw err;
  }

  onProgress?.(16, 'Extracting mono audio track for speech transcription...');
  const audioPath = await extractAudioTrack(videoPath, jobId);
  const chunkDuration = 90; // 90 seconds per chunk keeps timestamps precise and payloads compact
  const totalChunks = Math.max(1, Math.ceil(duration / chunkDuration));
  const allSegments: TranscriptSegment[] = [];
  let detectedLanguage = languageHint && languageHint !== 'auto' ? languageHint : 'en';

  let fallbackToWhisper = false;
  try {
    for (let i = 0; i < totalChunks; i++) {
      if (isCancelled?.()) {
        throw new Error('Job cancelled by user');
      }
      const chunkStart = i * chunkDuration;
      const chunkLen = Math.min(chunkDuration, Math.max(0.5, duration - chunkStart));
      if (chunkLen < 0.3) continue;

      onProgress?.(
        18 + Math.round(((i + 0.3) / totalChunks) * 18),
        `Transcribing audio segment ${i + 1} of ${totalChunks}...`
      );

      const chunkPath =
        totalChunks === 1
          ? audioPath
          : await sliceAudioChunk(audioPath, jobId, i, chunkStart, chunkLen);

      const audioBuffer = fs.readFileSync(chunkPath);
      if (audioBuffer.length < 256) continue;

      const base64Audio = audioBuffer.toString('base64');
      const langInstruction =
        languageHint && languageHint !== 'auto'
          ? `The primary spoken language is "${languageHint}".`
          : 'Detect the spoken language automatically.';

      const prompt = [
        `Transcribe all spoken speech in this ${chunkLen.toFixed(1)}-second audio clip with accurate timestamps relative to the start of THIS audio clip (0.0 to ${chunkLen.toFixed(1)} seconds).`,
        langInstruction,
        'Return spoken dialogue broken into natural 2-6 second segments.',
        'For each segment, provide start, end, text, and word-level timestamps when discernible.',
        'If there is only silence or music with no spoken words, return an empty segments array.',
        'Never invent or hallucinate speech that is not audible.',
      ].join(' ');

      let parsed: {
        language?: string;
        segments?: Array<{
          start: number;
          end: number;
          text: string;
          words?: Array<{ word: string; start: number; end: number }>;
        }>;
      };

      try {
        parsed = await withRetry(async () => {
          const response = await ai.models.generateContent({
            model: 'gemini-4-hydrogen',
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: 'audio/mp3',
                    data: base64Audio,
                  },
                },
                { text: prompt },
              ],
            },
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  language: { type: Type.STRING },
                  segments: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        start: { type: Type.NUMBER },
                        end: { type: Type.NUMBER },
                        text: { type: Type.STRING },
                        words: {
                          type: Type.ARRAY,
                          items: {
                            type: Type.OBJECT,
                            properties: {
                              word: { type: Type.STRING },
                              start: { type: Type.NUMBER },
                              end: { type: Type.NUMBER },
                            },
                            required: ['word', 'start', 'end'],
                          },
                        },
                      },
                      required: ['start', 'end', 'text'],
                    },
                  },
                },
                required: ['language', 'segments'],
              },
            },
          });

          const raw = (response.text || '{}').trim();
          return JSON.parse(raw) as {
            language?: string;
            segments?: Array<{
              start: number;
              end: number;
              text: string;
              words?: Array<{ word: string; start: number; end: number }>;
            }>;
          };
        });
      } catch (err) {
        const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
        if (
          allowSkipOnQuotaOrLocalOnly &&
          (msg.includes('429') ||
            msg.includes('503') ||
            msg.includes('502') ||
            msg.includes('504') ||
            msg.includes('unavailable') ||
            msg.includes('high demand') ||
            msg.includes('overloaded') ||
            msg.includes('resource_exhausted') ||
            msg.includes('quota'))
        ) {
          fallbackToWhisper = allSegments.length === 0;
          onProgress?.(
            34,
            'Gemini STT unavailable/rate-limited; switching to local Whisper / scene fallback...'
          );
          break;
        }
        throw err;
      }

      if (parsed.language && i === 0) {
        detectedLanguage = parsed.language;
      }

      for (const seg of parsed.segments || []) {
        const cleanText = (seg.text || '').trim();
        if (!cleanText) continue;

        const absStart = Number(
          Math.max(0, Math.min(duration, chunkStart + Math.max(0, Number(seg.start) || 0))).toFixed(3)
        );
        const rawEnd = Math.max(Number(seg.start) + 0.3, Number(seg.end) || Number(seg.start) + 2);
        const absEnd = Number(
          Math.max(absStart + 0.2, Math.min(duration, chunkStart + Math.min(chunkLen, rawEnd))).toFixed(3)
        );

        const offsetWords = (seg.words || []).map((w) => ({
          word: w.word,
          start: chunkStart + Number(w.start || 0),
          end: chunkStart + Number(w.end || 0),
        }));

        allSegments.push({
          start: absStart,
          end: absEnd,
          text: cleanText,
          words: alignWordTimings(absStart, absEnd, cleanText, offsetWords),
        });
      }
    }
  } finally {
    // Automatic cleanup of intermediate audio files to protect disk space
    cleanupJobTempFiles(jobId);
  }

  if (fallbackToWhisper) {
    const whisperPython = findWhisperPython();
    if (whisperPython) {
      const transcript = await transcribeWithLocalWhisper({
        pythonBin: whisperPython,
        videoPath,
        jobId,
        duration,
        transcriptPath,
        whisperSettings,
        onProgress,
        isCancelled,
      });
      return { transcript, transcriptPath };
    }
  }

  allSegments.sort((a, b) => a.start - b.start);

  const transcript: TranscriptData = {
    language: detectedLanguage || 'en',
    duration,
    hasSpeech: allSegments.length > 0,
    segments: allSegments,
  };

  fs.writeFileSync(transcriptPath, JSON.stringify(transcript, null, 2), 'utf-8');
  return { transcript, transcriptPath };
}
