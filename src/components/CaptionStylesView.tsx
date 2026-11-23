import { useEffect, useState } from 'react';
import { Check, Loader2, Save } from 'lucide-react';
import { api } from '../lib/api';
import { CAPTION_PRESET_LABELS, FRONTEND_CAPTION_PRESETS } from '../lib/format';
import type { AppSettings, CaptionPresetId, CaptionStyleConfig } from '../types';

interface CaptionStylesViewProps {
  settings: AppSettings | null;
  fonts: string[];
  onSettingsSaved: (updated: AppSettings) => void;
}

const SAMPLE_WORDS = ['MOST', 'CREATORS', 'MISS', 'THIS', 'HOOK'];

export function CaptionStylesView({
  settings,
  fonts,
  onSettingsSaved,
}: CaptionStylesViewProps) {
  const [style, setStyle] = useState<CaptionStyleConfig>(
    () => settings?.caption || FRONTEND_CAPTION_PRESETS.viral_yellow
  );
  const [activeWordIdx, setActiveWordIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (settings?.caption) {
      setStyle(settings.caption);
    }
  }, [settings]);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveWordIdx((i) => (i + 1) % Math.min(SAMPLE_WORDS.length, style.wordsPerLine + 1));
    }, 520);
    return () => clearInterval(timer);
  }, [style.wordsPerLine]);

  const handleSelectPreset = (presetId: CaptionPresetId) => {
    setStyle({ ...FRONTEND_CAPTION_PRESETS[presetId] });
  };

  const handleSaveDefault = async () => {
    if (!settings) return;
    setSaving(true);
    setSavedNotice(false);
    try {
      const updated = await api.updateSettings({
        ...settings,
        caption: style,
      });
      onSettingsSaved(updated.settings);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    } finally {
      setSaving(false);
    }
  };

  const previewSlice = SAMPLE_WORDS.slice(0, Math.max(1, Math.min(5, style.wordsPerLine)));

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#FAFAFA]">
            ASS Viral Caption Styles
          </h1>
          <p className="text-sm text-[#A1A1AA] mt-1">
            Configure word-level karaoke highlighting, Ubuntu font families, outline thickness, and
            vertical safe-zone placement.
          </p>
        </div>

        <button
          type="button"
          disabled={saving || !settings}
          onClick={handleSaveDefault}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : savedNotice ? (
            <Check className="w-4 h-4" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          {savedNotice ? 'Saved Default Style' : 'Save Default Style'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Live 9:16 Preview Stage */}
        <div className="lg:col-span-5 bg-[#18181B] border border-zinc-800/80 rounded-xl p-6 flex flex-col items-center">
          <div className="w-full flex items-center justify-between text-xs text-[#A1A1AA] mb-4">
            <span>9:16 Subtitle Preview</span>
            <span className="font-mono">{CAPTION_PRESET_LABELS[style.preset]}</span>
          </div>

          <div className="relative w-full max-w-[280px] aspect-[9/16] rounded-xl bg-gradient-to-b from-zinc-800 via-zinc-900 to-[#09090B] border border-zinc-700/80 overflow-hidden flex flex-col justify-between p-5">
            <div className="text-[11px] font-mono text-zinc-500">1080×1920 Safe Zone</div>

            <div
              className={`flex flex-wrap justify-center gap-x-2 gap-y-1 text-center transition-all ${
                style.position === 'top'
                  ? 'mb-auto mt-10'
                  : style.position === 'middle'
                  ? 'my-auto'
                  : 'mt-auto mb-16'
              }`}
            >
              {previewSlice.map((w, idx) => {
                const isActive = idx === activeWordIdx % previewSlice.length;
                const text = style.uppercase ? w.toUpperCase() : w.toLowerCase();
                return (
                  <span
                    key={`${w}_${idx}`}
                    className="font-bold leading-tight transition-transform duration-100"
                    style={{
                      fontFamily: style.font,
                      fontSize: `${Math.max(16, Math.round(style.fontSize * 0.38))}px`,
                      color: isActive ? style.highlightColor : style.primaryColor,
                      WebkitTextStroke: `${Math.max(1, Math.round(style.outlineWidth * 0.35))}px ${style.outlineColor}`,
                      textShadow: `0 ${style.shadowDepth}px ${style.shadowDepth * 2}px rgba(0,0,0,0.85)`,
                      transform:
                        isActive && style.animationIntensity === 'high'
                          ? 'scale(1.12)'
                          : isActive && style.animationIntensity === 'subtle'
                          ? 'scale(1.05)'
                          : 'scale(1)',
                    }}
                  >
                    {text}
                  </span>
                );
              })}
            </div>

            <div className="text-[11px] font-mono text-zinc-500 text-center">
              {style.font} · {style.fontSize}px
            </div>
          </div>
        </div>

        {/* Customization Controls */}
        <div className="lg:col-span-7 bg-[#18181B] border border-zinc-800/80 rounded-xl p-6 space-y-6">
          <div>
            <label className="block text-xs font-medium text-[#FAFAFA] mb-2">
              Style Presets
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {(Object.keys(CAPTION_PRESET_LABELS) as CaptionPresetId[]).map((presetKey) => {
                const active = style.preset === presetKey;
                return (
                  <button
                    key={presetKey}
                    type="button"
                    onClick={() => handleSelectPreset(presetKey)}
                    className={`px-3 py-2 rounded-lg border text-xs font-medium transition-colors text-left ${
                      active
                        ? 'bg-[#8B5CF6]/15 border-[#8B5CF6] text-[#FAFAFA]'
                        : 'bg-[#09090B] border-zinc-800 text-[#A1A1AA] hover:text-[#FAFAFA]'
                    }`}
                  >
                    {CAPTION_PRESET_LABELS[presetKey]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Installed Ubuntu Font
              </label>
              <select
                value={style.font}
                onChange={(e) => setStyle({ ...style, preset: 'custom', font: e.target.value })}
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                {(fonts.length > 0
                  ? fonts.slice(0, 25)
                  : ['DejaVu Sans', 'Liberation Sans', 'Noto Sans']
                ).map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Font Size (1080p scale)
              </label>
              <input
                type="number"
                min={28}
                max={110}
                value={style.fontSize}
                onChange={(e) =>
                  setStyle({ ...style, preset: 'custom', fontSize: Number(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Primary Text Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={style.primaryColor}
                  onChange={(e) =>
                    setStyle({ ...style, preset: 'custom', primaryColor: e.target.value })
                  }
                  className="h-9 w-12 rounded bg-[#09090B] border border-zinc-800 cursor-pointer"
                />
                <span className="font-mono text-xs text-[#FAFAFA]">{style.primaryColor}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Active Word Highlight Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={style.highlightColor}
                  onChange={(e) =>
                    setStyle({ ...style, preset: 'custom', highlightColor: e.target.value })
                  }
                  className="h-9 w-12 rounded bg-[#09090B] border border-zinc-800 cursor-pointer"
                />
                <span className="font-mono text-xs text-[#FAFAFA]">{style.highlightColor}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Outline Thickness
              </label>
              <input
                type="number"
                min={0}
                max={12}
                value={style.outlineWidth}
                onChange={(e) =>
                  setStyle({ ...style, preset: 'custom', outlineWidth: Number(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Shadow Depth
              </label>
              <input
                type="number"
                min={0}
                max={10}
                value={style.shadowDepth}
                onChange={(e) =>
                  setStyle({ ...style, preset: 'custom', shadowDepth: Number(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Screen Placement
              </label>
              <select
                value={style.position}
                onChange={(e) =>
                  setStyle({
                    ...style,
                    preset: 'custom',
                    position: e.target.value as CaptionStyleConfig['position'],
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="bottom">Lower-Middle Safe Zone</option>
                <option value="middle">Center Screen</option>
                <option value="top">Upper Third</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Words Per Line
              </label>
              <input
                type="number"
                min={1}
                max={6}
                value={style.wordsPerLine}
                onChange={(e) =>
                  setStyle({ ...style, preset: 'custom', wordsPerLine: Number(e.target.value) })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A1A1AA] mb-1.5">
                Animation Intensity
              </label>
              <select
                value={style.animationIntensity}
                onChange={(e) =>
                  setStyle({
                    ...style,
                    preset: 'custom',
                    animationIntensity: e.target.value as CaptionStyleConfig['animationIntensity'],
                  })
                }
                className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
              >
                <option value="high">High (Pop Scale + Highlight)</option>
                <option value="subtle">Subtle (Gentle Highlight)</option>
                <option value="none">None (Static Fade)</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() =>
                  setStyle({ ...style, preset: 'custom', uppercase: !style.uppercase })
                }
                className={`w-full px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  style.uppercase
                    ? 'bg-[#8B5CF6]/15 border-[#8B5CF6] text-[#FAFAFA]'
                    : 'bg-[#09090B] border-zinc-800 text-[#A1A1AA]'
                }`}
              >
                Uppercase Text: {style.uppercase ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
