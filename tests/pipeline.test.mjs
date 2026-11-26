import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { CAPTION_PRESETS, DIRS, ensureStorageDirectories } from '../server/config.ts';
import { extractAudioTrack, extractVideoFilmstrip } from '../server/services/audioExtractor.ts';
import { isRateLimitOrFallbackError, selectClipsWithGemini } from '../server/services/aiSelector.ts';
import { generateClipSubtitles } from '../server/services/captionGenerator.ts';
import { extractJsonFromLlmText, normalizeOllamaBaseUrl } from '../server/services/ollamaClient.ts';
import { detectSceneChanges } from '../server/services/sceneDetector.ts';
import { generateClipThumbnail } from '../server/services/thumbnailGenerator.ts';
import { probeVideo, validateRenderedVideo } from '../server/services/videoProbe.ts';
import { renderClipWithFfmpeg } from '../server/services/videoRenderer.ts';
import { createClipsZip } from '../server/services/zipGenerator.ts';
import { cleanupTempDirectory, removeFileIfExists } from '../server/utils/cleanup.ts';
import { checkDiskSpaceForJob, getStorageStats } from '../server/utils/storage.ts';
import { sanitizeFilename, validateClipTimestamps } from '../server/utils/validators.ts';

ensureStorageDirectories();

const TEST_VIDEO = path.join(DIRS.temp, 'test_source_sample.mp4');
const GENERATED_FILES = [];

test('create synthetic test video with FFmpeg', () => {
  execFileSync('ffmpeg', [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1280x720:rate=30:duration=6',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:duration=6',
    '-c:v',
    'libx264',
    '-preset',
    'ultrafast',
    '-c:a',
    'aac',
    '-pix_fmt',
    'yuv420p',
    TEST_VIDEO,
  ]);
  GENERATED_FILES.push(TEST_VIDEO);
  assert.equal(fs.existsSync(TEST_VIDEO), true);
});

test('probeVideo extracts real FFprobe stream metadata', async () => {
  const meta = await probeVideo(TEST_VIDEO);
  assert.equal(meta.width, 1280);
  assert.equal(meta.height, 720);
  assert.ok(meta.duration >= 5.5 && meta.duration <= 6.5);
  assert.equal(meta.hasAudio, true);
  assert.equal(meta.videoCodec, 'h264');
});

test('extractVideoFilmstrip and range-bounded extractAudioTrack succeed', async () => {
  const stripPath = path.join(DIRS.temp, 'test_filmstrip.jpg');
  await extractVideoFilmstrip(TEST_VIDEO, 6.0, stripPath, 6);
  GENERATED_FILES.push(stripPath);
  assert.equal(fs.existsSync(stripPath), true);
  assert.ok(fs.statSync(stripPath).size > 2000);

  const rangeAudio = await extractAudioTrack(TEST_VIDEO, 'test_range_job', 1.0, 4.0);
  GENERATED_FILES.push(rangeAudio);
  assert.equal(fs.existsSync(rangeAudio), true);
  assert.ok(fs.statSync(rangeAudio).size > 1000);
});

test('detectSceneChanges runs without error', async () => {
  const scenes = await detectSceneChanges(TEST_VIDEO, 0.3);
  assert.ok(Array.isArray(scenes));
});

test('validateClipTimestamps clamps bounds and removes overlapping duplicates', () => {
  const result = validateClipTimestamps(
    [
      {
        start: -2,
        end: 5.5,
        title: 'Opening Hook',
        hook: 'Watch this',
        reason: 'Strong start',
        category: 'educational',
        score: 95,
      },
      {
        start: 0.5,
        end: 5.2,
        title: 'Heavy Overlap Duplicate',
        hook: 'Dup',
        reason: 'Overlap',
        category: 'educational',
        score: 80,
      },
      {
        start: 10,
        end: 20,
        title: 'Out of bounds',
        hook: 'Bad',
        reason: 'Out of range',
        category: 'funny',
        score: 99,
      },
    ],
    6.0,
    3,
    10,
    10
  );

  assert.equal(result.length, 1);
  assert.equal(result[0].title, 'Opening Hook');
  assert.equal(result[0].start, 0);
  assert.equal(result[0].end, 5.5);
});

test('sanitizeFilename removes unsafe traversal characters', () => {
  const safe = sanitizeFilename('../../my weird video (1).mp4');
  assert.equal(safe.includes('..'), false);
  assert.equal(safe.endsWith('.mp4'), true);
});

test('generateClipSubtitles creates valid ASS & SRT files', () => {
  const transcript = {
    language: 'en',
    duration: 6,
    hasSpeech: true,
    segments: [
      {
        start: 0.5,
        end: 3.5,
        text: 'Most creators miss this hook',
        words: [
          { word: 'Most', start: 0.5, end: 1.0 },
          { word: 'creators', start: 1.0, end: 1.7 },
          { word: 'miss', start: 1.7, end: 2.2 },
          { word: 'this', start: 2.2, end: 2.7 },
          { word: 'hook', start: 2.7, end: 3.5 },
        ],
      },
    ],
  };

  const subs = generateClipSubtitles({
    clipId: 'test_clip_01',
    transcript,
    clipStart: 0.2,
    clipEnd: 4.5,
    style: CAPTION_PRESETS.viral_yellow,
    playResX: 720,
    playResY: 1280,
  });

  GENERATED_FILES.push(subs.assPath, subs.srtPath);
  assert.equal(fs.existsSync(subs.assPath), true);
  assert.equal(fs.existsSync(subs.srtPath), true);
  const assContent = fs.readFileSync(subs.assPath, 'utf-8');
  assert.ok(assContent.includes('[V4+ Styles]'));
  assert.ok(assContent.includes('Dialogue:'));
});

test('generateClipSubtitles splits phrases on pauses so captions do not freeze across silence', () => {
  const transcript = {
    language: 'en',
    duration: 16,
    hasSpeech: true,
    segments: [
      {
        start: 1.0,
        end: 13.0,
        text: 'Holy shit, is',
        words: [
          { word: 'Holy', start: 1.0, end: 1.25 },
          { word: 'shit,', start: 1.25, end: 1.55 },
          { word: 'is', start: 12.2, end: 12.5 },
        ],
      },
    ],
  };

  const subs = generateClipSubtitles({
    clipId: 'test_clip_pause_split',
    transcript,
    clipStart: 0,
    clipEnd: 15,
    style: CAPTION_PRESETS.viral_yellow,
    playResX: 720,
    playResY: 1280,
  });

  GENERATED_FILES.push(subs.assPath, subs.srtPath);
  assert.equal(subs.cueCount, 2);
  const srt = fs.readFileSync(subs.srtPath, 'utf-8');
  assert.ok(srt.includes('00:00:01,000 --> 00:00:01,550'));
  assert.ok(srt.includes('00:00:12,200 --> 00:00:12,500'));
});

test('renderClipWithFfmpeg renders 9:16 vertical MP4 with ASS subtitles and validates output', async () => {
  const assPath = path.join(DIRS.subtitles, 'test_clip_01.ass');
  const rendered = await renderClipWithFfmpeg({
    jobId: 'test_job_01',
    clipId: 'test_clip_01',
    sourcePath: TEST_VIDEO,
    startTime: 0.2,
    endTime: 3.5,
    hasAudio: true,
    aspectRatio: '9:16',
    outputResolution: '720x1280',
    effects: {
      cropMode: 'blurred_bg',
      subtleZoomIn: false,
      zoomOut: false,
      fadeInOut: true,
      audioNormalize: true,
    },
    assPath,
    fps: 30,
    crf: 24,
    preset: 'ultrafast',
    audioBitrate: '128k',
  });

  GENERATED_FILES.push(rendered.outputPath);
  const validation = await validateRenderedVideo(rendered.outputPath);
  assert.equal(validation.valid, true);
  assert.equal(validation.metadata?.width, 720);
  assert.equal(validation.metadata?.height, 1280);

  const thumbPath = await generateClipThumbnail({
    clipId: 'test_clip_01',
    videoPath: rendered.outputPath,
    clipDuration: 3.3,
  });
  GENERATED_FILES.push(thumbPath);
  assert.equal(fs.existsSync(thumbPath), true);

  const zip = await createClipsZip({
    archiveName: 'test_job_01_shorts',
    clips: [
      {
        id: 'test_clip_01',
        jobId: 'test_job_01',
        videoId: 'test_vid_01',
        clipIndex: 1,
        title: 'Test Vertical Clip',
        hook: 'Watch this',
        reason: 'Test',
        category: 'test',
        score: 90,
        startTime: 0.2,
        endTime: 3.5,
        duration: 3.3,
        status: 'completed',
        videoPath: rendered.outputPath,
        thumbnailPath: thumbPath,
        assPath,
        srtPath: path.join(DIRS.subtitles, 'test_clip_01.srt'),
        fileSize: rendered.fileSize,
        errorMessage: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  });
  GENERATED_FILES.push(zip.zipPath);
  assert.equal(fs.existsSync(zip.zipPath), true);
  assert.ok(zip.fileSize > 1000);
});

test('renderClipWithFfmpeg renders full-frame 9:16 split_screen MP4 cleanly', async () => {
  const assPath = path.join(DIRS.subtitles, 'test_clip_01.ass');
  const rendered = await renderClipWithFfmpeg({
    jobId: 'test_job_split',
    clipId: 'test_clip_split',
    sourcePath: TEST_VIDEO,
    startTime: 0.2,
    endTime: 3.0,
    hasAudio: true,
    aspectRatio: '9:16',
    outputResolution: '720x1280',
    effects: {
      cropMode: 'split_screen',
      splitTopRegion: { x: 0.01, y: 0.23, w: 0.22, h: 0.32 },
      splitTopRatio: 0.4,
      subtleZoomIn: false,
      zoomOut: false,
      fadeInOut: false,
      audioNormalize: false,
    },
    assPath,
    fps: 30,
    crf: 24,
    preset: 'ultrafast',
    audioBitrate: '128k',
  });

  GENERATED_FILES.push(rendered.outputPath);
  const validation = await validateRenderedVideo(rendered.outputPath);
  assert.equal(validation.valid, true);
  assert.equal(validation.metadata?.width, 720);
  assert.equal(validation.metadata?.height, 1280);
});

test('Ollama JSON stripping, URL normalization, and rate-limit error detection', async () => {
  assert.equal(normalizeOllamaBaseUrl('http://10.190.0.4:11434/'), 'http://10.190.0.4:11434');
  assert.throws(() => normalizeOllamaBaseUrl('ftp://bad-host'));
  assert.equal(isRateLimitOrFallbackError(new Error('429 RESOURCE_EXHAUSTED')), true);
  assert.equal(
    isRateLimitOrFallbackError(
      new Error(
        '{"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}'
      )
    ),
    true
  );

  const rawQwen = '<think>considering timestamps...</think>\n```json\n{"clips":[{"start":0,"end":4,"title":"T","hook":"H","reason":"R","category":"educational","score":90}],"notes":"ok"}\n```';
  const parsed = JSON.parse(extractJsonFromLlmText(rawQwen));
  assert.equal(parsed.clips.length, 1);
  assert.equal(parsed.clips[0].title, 'T');

  const server = http.createServer((req, res) => {
    if (req.url === '/api/chat') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              notes: 'Selected by Qwen',
              clips: [
                {
                  start: 0.5,
                  end: 4.5,
                  title: 'Qwen Hook',
                  hook: 'Opening line',
                  reason: 'Clear insight',
                  category: 'educational',
                  score: 89,
                },
              ],
            }),
          },
        })
      );
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const res = await selectClipsWithGemini({
      videoPath: TEST_VIDEO,
      jobId: 'ollama_test_job',
      videoDuration: 6.0,
      transcript: {
        language: 'en',
        duration: 6.0,
        hasSpeech: true,
        segments: [
          {
            start: 0.5,
            end: 4.5,
            text: 'Here is the key insight.',
            words: [{ word: 'Here', start: 0.5, end: 1.0 }],
          },
        ],
      },
      scenes: [0.5],
      config: {
        clipCount: 5,
        minDuration: 3,
        maxDuration: 10,
        aspectRatio: '9:16',
        outputResolution: '720x1280',
        selectionFocus: 'educational',
        customInstructions: '',
        captionStyle: CAPTION_PRESETS.viral_yellow,
        effects: {
          cropMode: 'blurred_bg',
          subtleZoomIn: false,
          zoomOut: false,
          fadeInOut: true,
          audioNormalize: true,
        },
      },
      aiSettings: {
        provider: 'ollama_only',
        model: 'gemini-4-hydrogen',
        ollamaBaseUrl: baseUrl,
        ollamaModel: 'qwen3.4:4b',
        defaultInstructions: '',
        maxClips: 50,
        geminiKeyConfigured: false,
      },
    });
    assert.equal(res.clips.length, 1);
    assert.equal(res.clips[0].title, 'Qwen Hook');
    assert.ok(res.aiNotes.includes('qwen3.4:4b'));
  } finally {
    server.close();
  }
});

test('Ollama failure in speech path falls back to speech-aligned clips without crashing', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const res = await selectClipsWithGemini({
      videoPath: TEST_VIDEO,
      jobId: 'ollama_fallback_test',
      videoDuration: 30.0,
      transcript: {
        language: 'en',
        duration: 30.0,
        hasSpeech: true,
        segments: [
          { start: 1, end: 5, text: 'First line', words: [{ word: 'First', start: 1, end: 2 }] },
          { start: 16, end: 20, text: 'Second line', words: [{ word: 'Second', start: 16, end: 17 }] },
        ],
      },
      scenes: [1, 16],
      config: {
        clipCount: 2,
        minDuration: 5,
        maxDuration: 12,
        aspectRatio: '9:16',
        outputResolution: '720x1280',
        selectionFocus: 'best_moments',
        customInstructions: '',
        captionStyle: CAPTION_PRESETS.viral_yellow,
        effects: {
          cropMode: 'blurred_bg',
          subtleZoomIn: false,
          zoomOut: false,
          fadeInOut: false,
          audioNormalize: false,
        },
      },
      aiSettings: {
        provider: 'ollama_only',
        model: 'gemini-4-hydrogen',
        ollamaBaseUrl: baseUrl,
        ollamaModel: 'qwen3.5:4b',
        defaultInstructions: '',
        maxClips: 50,
        geminiKeyConfigured: false,
      },
    });
    assert.ok(res.clips.length >= 1);
    assert.ok(res.aiNotes.includes('speech-aligned'));
  } finally {
    server.close();
  }
});

test('storage check & cleanup operate cleanly', () => {
  const stats = getStorageStats();
  assert.ok(stats.freeDiskBytes > 0);
  const check = checkDiskSpaceForJob(10 * 1024 * 1024, 5, 100);
  assert.equal(check.ok, true);

  for (const f of GENERATED_FILES) {
    removeFileIfExists(f);
  }
  cleanupTempDirectory(0);
});
