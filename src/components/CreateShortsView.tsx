import { useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Cpu,
  FileVideo,
  Loader2,
  Play,
  Sliders,
  Upload,
  X,
} from 'lucide-react';
import { api, uploadVideoWithProgress } from '../lib/api';
import {
  CAPTION_PRESET_LABELS,
  FRONTEND_CAPTION_PRESETS,
  formatBitrate,
  formatBytes,
  formatDuration,
} from '../lib/format';
import type {
  AppSettings,
  AspectRatio,
  CaptionPresetId,
  CropMode,
  JobConfig,
  OutputResolution,
  SelectionFocus,
  VideoItem,
} from '../types';

interface CreateShortsViewProps {
  videos: VideoItem[];
  settings: AppSettings | null;
  initialVideoId?: string | null;
  onSettingsSaved: (updated: AppSettings) => void;
  onVideoUploaded: (video: VideoItem) => void;
  onJobStarted: (jobId: string) => void;
}

const CLIP_COUNT_OPTIONS = [10, 20, 30, 40, 50];

const FOCUS_OPTIONS: Array<{ id: SelectionFocus; label: string }> = [
  { id: 'best_moments', label: 'Best moments' },
  { id: 'educational', label: 'Educational' },
  { id: 'funny', label: 'Funny' },
  { id: 'storytelling', label: 'Storytelling' },
  { id: 'motivational', label: 'Motivational' },
  { id: 'podcast_highlights', label: 'Podcast highlights' },
  { id: 'custom', label: 'Custom instructions' },
];

export function CreateShortsView({
  videos,
  settings,
  initialVideoId,
  onSettingsSaved,
  onVideoUploaded,
  onJobStarted,
}: CreateShortsViewProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [showAiSetupModal, setShowAiSetupModal] = useState(false);
  const [ollamaUrlDraft, setOllamaUrlDraft] = useState<string>(
    settings?.ai.ollamaBaseUrl || 'http://127.0.0.1:11434'
  );
  const [ollamaModelDraft, setOllamaModelDraft] = useState<string>(
    settings?.ai.ollamaModel || 'qwen3.5:4b'
  );
  const [modalError, setModalError] = useState<string | null>(null);
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [testingModalOllama, setTestingModalOllama] = useState(false);

  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(
    () => videos.find((v) => v.id === initialVideoId) || videos[0] || null
  );

  const [clipCount, setClipCount] = useState<number>(10);
  const [customCountMode, setCustomCountMode] = useState<boolean>(false);
  const [minDuration, setMinDuration] = useState<number>(20);
  const [maxDuration, setMaxDuration] = useState<number>(60);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [outputResolution, setOutputResolution] = useState<OutputResolution>(
    settings?.video.defaultResolution || '1080x1920'
  );
  const [cropMode, setCropMode] = useState<CropMode>('blurred_bg');
  const [selectionFocus, setSelectionFocus] = useState<SelectionFocus>('best_moments');
  const [customInstructions, setCustomInstructions] = useState<string>(
    settings?.ai.defaultInstructions || ''
  );
  const [captionPreset, setCaptionPreset] = useState<CaptionPresetId>(
    settings?.caption.preset || 'viral_yellow'
  );
  const [subtleZoomIn, setSubtleZoomIn] = useState<boolean>(false);
  const [zoomOut, setZoomOut] = useState<boolean>(false);
  const [fadeInOut, setFadeInOut] = useState<boolean>(true);
  const [audioNormalize, setAudioNormalize] = useState<boolean>(true);

  const handleFileSelected = async (file: File) => {
    setErrorMsg(null);
    setUploading(true);
    setUploadPct(0);
    try {
      const res = await uploadVideoWithProgress(file, (pct) => setUploadPct(pct));
      setSelectedVideo(res.video);
      onVideoUploaded(res.video);
      // Adjust default min/max duration sensibly if user uploads a short test video
      if (res.video.duration > 0 && res.video.duration < 20) {
        setMinDuration(Math.max(3, Math.floor(res.video.duration * 0.4)));
        setMaxDuration(Math.max(5, Math.floor(res.video.duration)));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleAspectChange = (nextRatio: AspectRatio) => {
    setAspectRatio(nextRatio);
    if (nextRatio === '9:16') setOutputResolution('1080x1920');
    if (nextRatio === '1:1') setOutputResolution('1080x1080');
    if (nextRatio === '16:9') setOutputResolution('1920x1080');
  };

  const submitProcessingJob = async () => {
    if (!selectedVideo) return;
    setErrorMsg(null);
    setSubmitting(true);

    try {
      const styleBase =
        captionPreset === 'custom' && settings?.caption
          ? settings.caption
          : FRONTEND_CAPTION_PRESETS[captionPreset];

      const config: JobConfig = {
        clipCount: Math.max(1, Math.min(50, clipCount)),
        minDuration: Math.max(3, minDuration),
        maxDuration: Math.max(minDuration, maxDuration),
        aspectRatio,
        outputResolution,
        selectionFocus,
        customInstructions,
        captionStyle: styleBase,
        effects: {
          cropMode,
          subtleZoomIn,
          zoomOut,
          fadeInOut,
          audioNormalize,
        },
      };

      const { job } = await api.createJob(selectedVideo.id, config);
      onJobStarted(job.id);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create processing job.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartProcessing = async () => {
    if (!selectedVideo) {
      setErrorMsg('Upload or select a source video first.');
      return;
    }

    setErrorMsg(null);
    const hasGemini = Boolean(settings?.ai.geminiKeyConfigured);
    const mode = settings?.ai.provider || 'gemini_with_ollama_fallback';

    // Pre-flight check when deploying with no host Gemini key or in Ollama-only mode
    if ((mode === 'gemini_only' && !hasGemini) || !hasGemini || mode === 'ollama_only') {
      if (mode === 'gemini_only' && !hasGemini) {
        setOllamaUrlDraft(settings?.ai.ollamaBaseUrl || 'http://127.0.0.1:11434');
        setOllamaModelDraft(settings?.ai.ollamaModel || 'qwen3.5:4b');
        setModalError(
          'No server GEMINI_API_KEY is configured. Connect your own Ollama server below or add GEMINI_API_KEY to the server .env file.'
        );
        setShowAiSetupModal(true);
        return;
      }

      setSubmitting(true);
      try {
        await api.testOllamaConnection(settings?.ai.ollamaBaseUrl || 'http://127.0.0.1:11434');
      } catch {
        setSubmitting(false);
        setOllamaUrlDraft(settings?.ai.ollamaBaseUrl || 'http://127.0.0.1:11434');
        setOllamaModelDraft(settings?.ai.ollamaModel || 'qwen3.5:4b');
        setModalError(null);
        setDetectedModels([]);
        setShowAiSetupModal(true);
        return;
      }
      setSubmitting(false);
    }

    await submitProcessingJob();
  };

  const handleConnectOllamaAndStart = async () => {
    if (!settings) return;
    setTestingModalOllama(true);
    setModalError(null);
    try {
      const check = await api.testOllamaConnection(ollamaUrlDraft);
      setDetectedModels(check.models);
      const saved = await api.updateSettings({
        ...settings,
        ai: {
          ...settings.ai,
          provider: settings.ai.geminiKeyConfigured ? 'gemini_with_ollama_fallback' : 'ollama_only',
          ollamaBaseUrl: check.baseUrl,
          ollamaModel: ollamaModelDraft.trim() || 'qwen3.5:4b',
        },
      });
      onSettingsSaved(saved.settings);
      setShowAiSetupModal(false);
      await submitProcessingJob();
    } catch (err) {
      setModalError(err instanceof Error ? err.message : 'Could not reach Ollama server.');
    } finally {
      setTestingModalOllama(false);
    }
  };

  const handleContinueOfflineScenes = async () => {
    if (settings && settings.ai.provider === 'gemini_only') {
      try {
        const saved = await api.updateSettings({
          ...settings,
          ai: { ...settings.ai, provider: 'gemini_with_ollama_fallback' },
        });
        onSettingsSaved(saved.settings);
      } catch {
        // Proceed cleanly
      }
    }
    setShowAiSetupModal(false);
    await submitProcessingJob();
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-[#FAFAFA]">
          Create Shorts
        </h1>
        <p className="text-sm text-[#A1A1AA] mt-1">
          Upload a long-form video, inspect real FFprobe stream metadata, and configure AI clipping
          and FFmpeg rendering.
        </p>
      </div>

      {errorMsg && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left Column: Upload & FFprobe Metadata */}
        <div className="xl:col-span-5 space-y-6">
          <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-6">
            <h2 className="font-display text-base font-semibold text-[#FAFAFA]">
              01. Source Video Upload
            </h2>
            <p className="text-xs text-[#A1A1AA] mt-1">
              Supported containers: MP4, MOV, MKV, WEBM
            </p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragActive(false);
                const file = e.dataTransfer.files?.[0];
                if (file) void handleFileSelected(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
              }}
              className={`mt-4 flex flex-col items-center justify-center text-center px-6 py-10 rounded-xl border border-dashed cursor-pointer transition-colors ${
                dragActive
                  ? 'border-[#8B5CF6] bg-[#8B5CF6]/10'
                  : 'border-zinc-700 hover:border-zinc-500 bg-[#09090B]/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".mp4,.mov,.mkv,.webm,video/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFileSelected(file);
                  e.target.value = '';
                }}
              />
              {uploading ? (
                <div className="w-full max-w-xs space-y-3">
                  <Loader2 className="w-7 h-7 text-[#8B5CF6] animate-spin mx-auto" />
                  <div className="text-sm font-medium text-[#FAFAFA]">
                    Uploading & probing streams...
                  </div>
                  <div className="w-full h-2 rounded-full bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-[#8B5CF6] transition-all duration-150"
                      style={{ width: `${uploadPct}%` }}
                    />
                  </div>
                  <div className="font-mono tabular-nums text-xs text-[#A1A1AA]">
                    {uploadPct}%
                  </div>
                </div>
              ) : (
                <>
                  <Upload className="w-7 h-7 text-[#8B5CF6] mb-3" />
                  <div className="text-sm font-medium text-[#FAFAFA]">
                    Drag & drop video here or browse file
                  </div>
                  <div className="text-xs text-[#A1A1AA] mt-1">
                    Streamed directly to local server disk
                  </div>
                </>
              )}
            </div>

            {videos.length > 0 && (
              <div className="mt-5 pt-5 border-t border-zinc-800/80">
                <label className="block text-xs font-medium text-[#A1A1AA] mb-2">
                  Or select an existing uploaded video
                </label>
                <select
                  value={selectedVideo?.id || ''}
                  onChange={(e) => {
                    const found = videos.find((v) => v.id === e.target.value) || null;
                    setSelectedVideo(found);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
                >
                  {videos.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.originalFilename} ({formatDuration(v.duration)} · {v.width}x{v.height})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* FFprobe Real Metadata Inspector */}
          <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-6">
            <div className="flex items-center gap-2.5 pb-4 border-b border-zinc-800/80">
              <FileVideo className="w-4 h-4 text-[#06B6D4]" />
              <h2 className="font-display text-base font-semibold text-[#FAFAFA]">
                FFprobe Video Inspection
              </h2>
            </div>

            {selectedVideo ? (
              <dl className="mt-4 grid grid-cols-2 gap-y-3.5 gap-x-4 text-xs">
                <div className="col-span-2">
                  <dt className="text-[#A1A1AA]">Filename</dt>
                  <dd className="mt-0.5 font-medium text-[#FAFAFA] break-all">
                    {selectedVideo.originalFilename}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#A1A1AA]">File Size</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-[#FAFAFA]">
                    {formatBytes(selectedVideo.fileSize)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#A1A1AA]">Duration</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-[#FAFAFA]">
                    {formatDuration(selectedVideo.duration)} ({selectedVideo.duration.toFixed(1)}s)
                  </dd>
                </div>
                <div>
                  <dt className="text-[#A1A1AA]">Resolution</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-[#FAFAFA]">
                    {selectedVideo.width} × {selectedVideo.height}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#A1A1AA]">Frame Rate</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-[#FAFAFA]">
                    {selectedVideo.fps} FPS
                  </dd>
                </div>
                <div>
                  <dt className="text-[#A1A1AA]">Video Codec</dt>
                  <dd className="mt-0.5 font-mono text-[#FAFAFA]">{selectedVideo.videoCodec}</dd>
                </div>
                <div>
                  <dt className="text-[#A1A1AA]">Audio Track</dt>
                  <dd className="mt-0.5 font-mono text-[#FAFAFA]">
                    {selectedVideo.hasAudio
                      ? `${selectedVideo.audioCodec || 'aac'} (${selectedVideo.audioStreams} stream)`
                      : 'No audio stream'}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[#A1A1AA]">Bitrate & Container</dt>
                  <dd className="mt-0.5 font-mono tabular-nums text-[#FAFAFA]">
                    {formatBitrate(selectedVideo.bitrate)} · {selectedVideo.formatName}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="py-8 text-center text-xs text-[#A1A1AA]">
                Upload a video to inspect actual stream dimensions, codecs, FPS, and audio channels.
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Processing Configuration */}
        <div className="xl:col-span-7 bg-[#18181B] border border-zinc-800/80 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-2.5 pb-4 border-b border-zinc-800/80">
            <Sliders className="w-4 h-4 text-[#8B5CF6]" />
            <h2 className="font-display text-base font-semibold text-[#FAFAFA]">
              02. Processing Configuration
            </h2>
          </div>

          {/* Number of Clips */}
          <div>
            <label className="block text-xs font-medium text-[#FAFAFA] mb-2">
              Target Number of Clips (Max 50)
            </label>
            <div className="flex flex-wrap items-center gap-2">
              {CLIP_COUNT_OPTIONS.map((num) => {
                const active = !customCountMode && clipCount === num;
                return (
                  <button
                    key={num}
                    type="button"
                    onClick={() => {
                      setCustomCountMode(false);
                      setClipCount(num);
                    }}
                    className={`px-3.5 py-2 rounded-lg font-mono tabular-nums text-xs font-medium border transition-colors ${
                      active
                        ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white'
                        : 'bg-[#09090B] border-zinc-800 text-[#A1A1AA] hover:text-[#FAFAFA]'
                    }`}
                  >
                    {num}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setCustomCountMode(true)}
                className={`px-3.5 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  customCountMode
                    ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white'
                    : 'bg-[#09090B] border-zinc-800 text-[#A1A1AA] hover:text-[#FAFAFA]'
                }`}
              >
                Custom
              </button>
              {customCountMode && (
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={clipCount}
                  onChange={(e) => setClipCount(Math.max(1, Math.min(50, Number(e.target.value))))}
                  className="w-24 px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-700 font-mono tabular-nums text-xs text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
                />
              )}
            </div>
          </div>

          {/* Clip Duration + Aspect Ratio + Resolution */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Min Duration (sec)
              </label>
              <input
                type="number"
                min={3}
                max={180}
                value={minDuration}
                onChange={(e) => setMinDuration(Math.max(3, Number(e.target.value)))}
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Max Duration (sec)
              </label>
              <input
                type="number"
                min={minDuration}
                max={300}
                value={maxDuration}
                onChange={(e) => setMaxDuration(Math.max(minDuration, Number(e.target.value)))}
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Aspect Ratio
              </label>
              <select
                value={aspectRatio}
                onChange={(e) => handleAspectChange(e.target.value as AspectRatio)}
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="9:16">9:16 (Shorts / Reels)</option>
                <option value="1:1">1:1 (Square)</option>
                <option value="16:9">16:9 (Landscape)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Output Resolution
              </label>
              <select
                value={outputResolution}
                onChange={(e) => setOutputResolution(e.target.value as OutputResolution)}
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                {aspectRatio === '9:16' && (
                  <>
                    <option value="1080x1920">1080x1920</option>
                    <option value="720x1280">720x1280</option>
                  </>
                )}
                {aspectRatio === '1:1' && (
                  <>
                    <option value="1080x1080">1080x1080</option>
                    <option value="720x1280">720x720</option>
                  </>
                )}
                {aspectRatio === '16:9' && (
                  <>
                    <option value="1920x1080">1920x1080</option>
                    <option value="720x1280">1280x720</option>
                  </>
                )}
              </select>
            </div>
          </div>

          {/* Framing & AI Selection Focus */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Vertical Framing / Crop Mode
              </label>
              <select
                value={cropMode}
                onChange={(e) => setCropMode(e.target.value as CropMode)}
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="blurred_bg">Blurred Background + Foreground</option>
                <option value="center">Center Crop</option>
                <option value="subject_aware">Subject-Aware Framing</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                AI Clip Selection Focus
              </label>
              <select
                value={selectionFocus}
                onChange={(e) => setSelectionFocus(e.target.value as SelectionFocus)}
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                {FOCUS_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
              AI Selection Instructions
            </label>
            <textarea
              rows={2}
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              placeholder="e.g., Focus on actionable tips, avoid sponsor reads, keep hooks punchy..."
              className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] placeholder:text-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
            />
          </div>

          {/* Caption Style */}
          <div>
            <label className="block text-xs font-medium text-[#FAFAFA] mb-2">
              Animated ASS Caption Style
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              {(Object.keys(CAPTION_PRESET_LABELS) as CaptionPresetId[]).map((presetKey) => {
                const active = captionPreset === presetKey;
                const preset = FRONTEND_CAPTION_PRESETS[presetKey];
                return (
                  <button
                    key={presetKey}
                    type="button"
                    onClick={() => setCaptionPreset(presetKey)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-lg border text-xs font-medium transition-colors text-left ${
                      active
                        ? 'bg-[#8B5CF6]/15 border-[#8B5CF6] text-[#FAFAFA]'
                        : 'bg-[#09090B] border-zinc-800 text-[#A1A1AA] hover:text-[#FAFAFA]'
                    }`}
                  >
                    <span className="truncate">{CAPTION_PRESET_LABELS[presetKey]}</span>
                    <span
                      className="w-2.5 h-2.5 rounded-sm shrink-0 ml-2"
                      style={{ backgroundColor: preset.highlightColor }}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Optional Effects */}
          <div>
            <label className="block text-xs font-medium text-[#FAFAFA] mb-2">
              FFmpeg Rendering Effects
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
              {[
                {
                  label: 'Audio loudness normalization (EBU R128)',
                  checked: audioNormalize,
                  onChange: setAudioNormalize,
                },
                {
                  label: 'Smooth fade-in / fade-out transitions',
                  checked: fadeInOut,
                  onChange: setFadeInOut,
                },
                {
                  label: 'Subtle slow zoom-in motion',
                  checked: subtleZoomIn,
                  onChange: (val: boolean) => {
                    setSubtleZoomIn(val);
                    if (val) setZoomOut(false);
                  },
                },
                {
                  label: 'Subtle slow zoom-out motion',
                  checked: zoomOut,
                  onChange: (val: boolean) => {
                    setZoomOut(val);
                    if (val) setSubtleZoomIn(false);
                  },
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => item.onChange(!item.checked)}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border transition-colors text-left ${
                    item.checked
                      ? 'border-zinc-700 bg-zinc-800/40 text-[#FAFAFA]'
                      : 'border-zinc-800 bg-[#09090B] text-[#A1A1AA]'
                  }`}
                >
                  <span className="truncate pr-2">{item.label}</span>
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center shrink-0 ${
                      item.checked ? 'bg-[#8B5CF6] text-white' : 'bg-zinc-800 text-transparent'
                    }`}
                  >
                    <Check className="w-3 h-3" />
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Submit CTA */}
          <div className="pt-4 border-t border-zinc-800/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="text-xs text-[#A1A1AA]">
              Sequential CPU rendering enabled · Auto temp cleanup after completion
            </div>
            <button
              type="button"
              disabled={!selectedVideo || uploading || submitting}
              onClick={handleStartProcessing}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Start Processing
            </button>
          </div>
        </div>
      </div>

      {/* Pre-flight AI Endpoint Modal (shown if no server Gemini key or Ollama unreachable) */}
      {showAiSetupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-lg bg-[#18181B] border border-zinc-800 rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <Cpu className="w-5 h-5 text-[#06B6D4] shrink-0" />
                <div>
                  <h3 className="font-display text-base font-semibold text-[#FAFAFA]">
                    Connect Your AI Engine
                  </h3>
                  <p className="text-xs text-[#A1A1AA] mt-0.5">
                    No host AI key is configured and Ollama is not reachable yet. Connect your own
                    Ollama endpoint or run in offline scene mode.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAiSetupModal(false)}
                aria-label="Close"
                className="p-1.5 rounded-lg text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {modalError && (
              <div className="px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                {modalError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                  Your Ollama Server URL
                </label>
                <input
                  type="text"
                  value={ollamaUrlDraft}
                  onChange={(e) => setOllamaUrlDraft(e.target.value)}
                  placeholder="http://10.190.0.4:11434"
                  className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono text-xs text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                  Ollama Model Name
                </label>
                <input
                  type="text"
                  value={ollamaModelDraft}
                  onChange={(e) => setOllamaModelDraft(e.target.value)}
                  placeholder="qwen3.5:4b"
                  className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono text-xs text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
            </div>

            {detectedModels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {detectedModels.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setOllamaModelDraft(m)}
                    className={`px-2 py-1 rounded font-mono text-[11px] border ${
                      ollamaModelDraft === m
                        ? 'bg-[#8B5CF6]/20 border-[#8B5CF6] text-[#FAFAFA]'
                        : 'bg-[#09090B] border-zinc-800 text-[#A1A1AA]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}

            <div className="text-[11px] text-[#A1A1AA] bg-[#09090B] border border-zinc-800/80 rounded-lg px-3 py-2">
              To use Gemini cloud instead, configure <span className="font-mono text-[#FAFAFA]">GEMINI_API_KEY</span> in your server <span className="font-mono text-[#FAFAFA]">.env</span> or Secrets panel.
            </div>

            <div className="flex flex-col sm:flex-row sm:justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleContinueOfflineScenes}
                disabled={testingModalOllama || submitting}
                className="px-3.5 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs font-medium text-[#FAFAFA]"
              >
                Use Offline Scene Mode
              </button>
              <button
                type="button"
                onClick={handleConnectOllamaAndStart}
                disabled={testingModalOllama || submitting}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-xs font-medium text-white"
              >
                {testingModalOllama && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Test Ollama & Start Job
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
