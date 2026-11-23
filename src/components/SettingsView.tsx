import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Cpu, Loader2, Save, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import type { AiProviderMode, AppSettings, OutputResolution } from '../types';

interface SettingsViewProps {
  settings: AppSettings | null;
  onSettingsSaved: (updated: AppSettings) => void;
}

export function SettingsView({ settings, onSettingsSaved }: SettingsViewProps) {
  const [draft, setDraft] = useState<AppSettings | null>(settings);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [testingOllama, setTestingOllama] = useState(false);
  const [ollamaTestResult, setOllamaTestResult] = useState<{
    ok: boolean;
    message: string;
    models: string[];
  } | null>(null);

  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  if (!draft) {
    return (
      <div className="py-12 text-center text-sm text-[#A1A1AA]">
        Loading application settings...
      </div>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setErrorMsg(null);
    try {
      const res = await api.updateSettings(draft);
      onSettingsSaved(res.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTestOllama = async () => {
    setTestingOllama(true);
    setOllamaTestResult(null);
    try {
      const res = await api.testOllamaConnection(draft.ai.ollamaBaseUrl);
      setOllamaTestResult({
        ok: true,
        message:
          res.models.length > 0
            ? `Connected to ${res.baseUrl} (${res.models.length} model(s) detected)`
            : `Connected to ${res.baseUrl} (no models pulled yet)`,
        models: res.models,
      });
    } catch (err) {
      setOllamaTestResult({
        ok: false,
        message: err instanceof Error ? err.message : 'Connection failed',
        models: [],
      });
    } finally {
      setTestingOllama(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#FAFAFA]">
            Settings
          </h1>
          <p className="text-sm text-[#A1A1AA] mt-1">
            Configure Gemini + Local Ollama fallback, CPU Whisper parameters, FFmpeg encoding
            defaults, and storage retention policies.
          </p>
        </div>

        <button
          type="button"
          disabled={saving}
          onClick={handleSave}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : saved ? (
            <Check className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {saved ? 'Settings Saved' : 'Save Settings'}
        </button>
      </div>

      {errorMsg && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* AI Settings: Gemini + Local Ollama */}
        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-6 space-y-4">
          <div className="pb-3 border-b border-zinc-800/80 flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[#FAFAFA]">
              AI Selection & Local Ollama Fallback
            </h2>
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              {draft.ai.geminiKeyConfigured ? 'Gemini Env Active' : 'Local / Env Managed'}
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
              AI Routing Mode
            </label>
            <select
              value={draft.ai.provider}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  ai: { ...draft.ai, provider: e.target.value as AiProviderMode },
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
            >
              <option value="gemini_with_ollama_fallback">
                Gemini First + Auto-Fallback to Ollama on 429 / 503 Demand Spikes (Recommended)
              </option>
              <option value="ollama_only">
                Local / Remote Ollama Only (Zero API Cost)
              </option>
              <option value="gemini_only">Gemini API Only</option>
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Gemini Model
              </label>
              <select
                value={draft.ai.model}
                onChange={(e) =>
                  setDraft({ ...draft, ai: { ...draft.ai, model: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="gemini-4-hydrogen">gemini-4-hydrogen (Fast / Default)</option>
                <option value="gemini-4-neon">gemini-4-neon (Complex Reasoning)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Maximum Clips Per Job
              </label>
              <input
                type="number"
                min={1}
                max={50}
                value={draft.ai.maxClips}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    ai: { ...draft.ai, maxClips: Math.max(1, Math.min(50, Number(e.target.value))) },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>
          </div>

          {/* Local / Remote Ollama Endpoint */}
          <div className="pt-3 border-t border-zinc-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#FAFAFA]">
                <Cpu className="w-3.5 h-3.5 text-[#06B6D4]" />
                Ollama Server (Local or Second VM)
              </span>
              <button
                type="button"
                disabled={testingOllama}
                onClick={handleTestOllama}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs font-medium text-[#FAFAFA] disabled:opacity-50"
              >
                {testingOllama && <Loader2 className="w-3 h-3 animate-spin" />}
                Test Ollama Connection
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                  Ollama Base URL
                </label>
                <input
                  type="text"
                  value={draft.ai.ollamaBaseUrl}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      ai: { ...draft.ai, ollamaBaseUrl: e.target.value },
                    })
                  }
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
                  value={draft.ai.ollamaModel}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      ai: { ...draft.ai, ollamaModel: e.target.value },
                    })
                  }
                  placeholder="qwen3.5:4b"
                  className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono text-xs text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
                />
              </div>
            </div>

            {ollamaTestResult && (
              <div
                className={`text-xs px-3 py-2 rounded-lg border ${
                  ollamaTestResult.ok
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}
              >
                <div>{ollamaTestResult.message}</div>
                {ollamaTestResult.models.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ollamaTestResult.models.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            ai: { ...draft.ai, ollamaModel: m },
                          })
                        }
                        className="px-2 py-1 rounded bg-black/40 border border-emerald-500/30 font-mono text-[11px] hover:border-white"
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="text-xs text-[#A1A1AA] bg-[#09090B] border border-zinc-800/80 rounded-lg px-3.5 py-2.5 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-[#06B6D4] shrink-0" />
            <span>
              Gemini credentials are managed via server environment variables; in Ollama-only mode,
              no Gemini API key is required.
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
              Default AI Selection Instructions
            </label>
            <textarea
              rows={3}
              value={draft.ai.defaultInstructions}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  ai: { ...draft.ai, defaultInstructions: e.target.value },
                })
              }
              className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
            />
          </div>
        </div>

        {/* Video Encoding Settings */}
        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-6 space-y-4">
          <div className="pb-3 border-b border-zinc-800/80">
            <h2 className="font-display text-base font-semibold text-[#FAFAFA]">
              FFmpeg CPU Video Encoding
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Default Vertical Resolution
              </label>
              <select
                value={draft.video.defaultResolution}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    video: {
                      ...draft.video,
                      defaultResolution: e.target.value as OutputResolution,
                    },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="1080x1920">1080x1920 (Full HD 9:16)</option>
                <option value="720x1280">720x1280 (Fast CPU 9:16)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Target Output FPS
              </label>
              <input
                type="number"
                min={24}
                max={60}
                value={draft.video.fps}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    video: { ...draft.video, fps: Number(e.target.value) },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                H.264 CRF Quality (18–28)
              </label>
              <input
                type="number"
                min={18}
                max={30}
                value={draft.video.crf}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    video: { ...draft.video, crf: Number(e.target.value) },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                CPU Preset
              </label>
              <select
                value={draft.video.preset}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    video: {
                      ...draft.video,
                      preset: e.target.value as AppSettings['video']['preset'],
                    },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="ultrafast">ultrafast</option>
                <option value="superfast">superfast</option>
                <option value="veryfast">veryfast (Recommended CPU)</option>
                <option value="faster">faster</option>
                <option value="fast">fast</option>
                <option value="medium">medium</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                AAC Audio Bitrate
              </label>
              <select
                value={draft.video.audioBitrate}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    video: { ...draft.video, audioBitrate: e.target.value },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="96k">96k</option>
                <option value="128k">128k (Default)</option>
                <option value="192k">192k</option>
              </select>
            </div>
          </div>
        </div>

        {/* Whisper Settings */}
        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-6 space-y-4">
          <div className="pb-3 border-b border-zinc-800/80">
            <h2 className="font-display text-base font-semibold text-[#FAFAFA]">
              Speech Transcription & VM Whisper Profile
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Whisper Model Size
              </label>
              <select
                value={draft.whisper.modelSize}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    whisper: {
                      ...draft.whisper,
                      modelSize: e.target.value as AppSettings['whisper']['modelSize'],
                    },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="tiny">tiny</option>
                <option value="base">base</option>
                <option value="small">small (Default 4-vCPU)</option>
                <option value="medium">medium</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Compute Type
              </label>
              <select
                value={draft.whisper.computeType}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    whisper: {
                      ...draft.whisper,
                      computeType: e.target.value as AppSettings['whisper']['computeType'],
                    },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="int8">int8 (CPU Optimized)</option>
                <option value="float32">float32</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                CPU Threads
              </label>
              <input
                type="number"
                min={1}
                max={16}
                value={draft.whisper.cpuThreads}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    whisper: { ...draft.whisper, cpuThreads: Number(e.target.value) },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Language Hint
              </label>
              <input
                type="text"
                value={draft.whisper.language}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    whisper: { ...draft.whisper, language: e.target.value },
                  })
                }
                placeholder="auto, en, es, fr..."
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>
          </div>
        </div>

        {/* Storage Settings */}
        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-6 space-y-4">
          <div className="pb-3 border-b border-zinc-800/80">
            <h2 className="font-display text-base font-semibold text-[#FAFAFA]">
              Storage & Disk Guard
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Active Storage Directory
              </label>
              <input
                type="text"
                readOnly
                value={draft.storage.storageRoot}
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800/60 font-mono text-xs text-[#A1A1AA]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                ZIP Archive Retention (Days)
              </label>
              <input
                type="number"
                min={1}
                max={365}
                value={draft.storage.retentionDays}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    storage: { ...draft.storage, retentionDays: Number(e.target.value) },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Minimum Free Disk Reserve (MB)
              </label>
              <input
                type="number"
                min={256}
                max={20000}
                value={draft.storage.minFreeDiskMb}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    storage: { ...draft.storage, minFreeDiskMb: Number(e.target.value) },
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
