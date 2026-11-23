import { useMemo, useState } from 'react';
import {
  Archive,
  Check,
  Download,
  Edit3,
  Film,
  Image as ImageIcon,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../lib/api';
import { formatBytes, formatDuration } from '../lib/format';
import type { ClipItem, JobItem } from '../types';

interface ClipsGalleryViewProps {
  clips: ClipItem[];
  jobs: JobItem[];
  selectedJobFilter: string;
  onChangeJobFilter: (jobId: string) => void;
  onRefresh: () => Promise<void>;
}

export function ClipsGalleryView({
  clips,
  jobs,
  selectedJobFilter,
  onChangeJobFilter,
  onRefresh,
}: ClipsGalleryViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeClip, setActiveClip] = useState<ClipItem | null>(null);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Editor state inside modal
  const [editTitle, setEditTitle] = useState('');
  const [editHook, setEditHook] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editStart, setEditStart] = useState<number>(0);
  const [editEnd, setEditEnd] = useState<number>(0);
  const [savingMeta, setSavingMeta] = useState(false);
  const [rerendering, setRerendering] = useState(false);
  const [regenThumb, setRegenThumb] = useState(false);
  const [thumbNonce, setThumbNonce] = useState(0);
  const [videoNonce, setVideoNonce] = useState(0);

  const filteredClips = useMemo(() => {
    return clips.filter((c) => {
      if (selectedJobFilter !== 'all' && c.jobId !== selectedJobFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          c.title.toLowerCase().includes(q) ||
          c.hook.toLowerCase().includes(q) ||
          c.category.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [clips, selectedJobFilter, searchQuery]);

  const openClipModal = (clip: ClipItem) => {
    setActiveClip(clip);
    setEditTitle(clip.title);
    setEditHook(clip.hook);
    setEditCategory(clip.category);
    setEditStart(clip.startTime);
    setEditEnd(clip.endTime);
    setErrorMsg(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const completedVisible = filteredClips.filter((c) => c.status === 'completed');
    if (completedVisible.length === 0) return;
    const allSelected = completedVisible.every((c) => selectedIds.has(c.id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(completedVisible.map((c) => c.id)));
    }
  };

  const handleDownloadSelectedZip = async () => {
    if (selectedIds.size === 0) return;
    setDownloadingZip(true);
    setErrorMsg(null);
    try {
      await api.downloadSelectedZip(Array.from(selectedIds));
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'ZIP download failed');
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleDownloadAllJobZip = async () => {
    const targetJobId =
      selectedJobFilter !== 'all' ? selectedJobFilter : filteredClips[0]?.jobId;
    if (!targetJobId) return;
    setDownloadingZip(true);
    setErrorMsg(null);
    try {
      const res = await api.buildJobZip(targetJobId);
      const a = document.createElement('a');
      a.href = res.downloadUrl;
      a.download = `${targetJobId}_shorts.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to build ZIP');
    } finally {
      setDownloadingZip(false);
    }
  };

  const handleSaveMetadata = async (regenerateSubtitles: boolean) => {
    if (!activeClip) return;
    setSavingMeta(true);
    setErrorMsg(null);
    try {
      const res = await api.updateClip(activeClip.id, {
        title: editTitle,
        hook: editHook,
        category: editCategory,
        startTime: editStart,
        endTime: editEnd,
        regenerateSubtitles,
      });
      setActiveClip(res.clip);
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update clip');
    } finally {
      setSavingMeta(false);
    }
  };

  const handleRerender = async () => {
    if (!activeClip) return;
    setRerendering(true);
    setErrorMsg(null);
    try {
      await api.updateClip(activeClip.id, {
        title: editTitle,
        hook: editHook,
        category: editCategory,
        startTime: editStart,
        endTime: editEnd,
        regenerateSubtitles: true,
      });
      const res = await api.renderClip(activeClip.id);
      setActiveClip(res.clip);
      setVideoNonce((n) => n + 1);
      setThumbNonce((n) => n + 1);
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Re-render failed');
    } finally {
      setRerendering(false);
    }
  };

  const handleRegenThumbnail = async () => {
    if (!activeClip) return;
    setRegenThumb(true);
    setErrorMsg(null);
    try {
      const midOffset = Math.max(0.2, (editEnd - editStart) * 0.5);
      const res = await api.regenerateThumbnail(activeClip.id, midOffset);
      setActiveClip(res.clip);
      setThumbNonce((n) => n + 1);
      await onRefresh();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Thumbnail regeneration failed');
    } finally {
      setRegenThumb(false);
    }
  };

  const handleDeleteClip = async (clipId: string) => {
    await api.deleteClip(clipId);
    if (activeClip?.id === clipId) setActiveClip(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(clipId);
      return next;
    });
    await onRefresh();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-[#FAFAFA]">
            Generated Clips
          </h1>
          <p className="text-sm text-[#A1A1AA] mt-1">
            Preview rendered shorts, fine-tune timestamps, regenerate ASS captions, or export as
            MP4 and ZIP.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={toggleSelectAll}
            className="px-3.5 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs font-medium text-[#FAFAFA] transition-colors whitespace-nowrap"
          >
            {selectedIds.size > 0 ? 'Clear Selection' : 'Select All Ready'}
          </button>

          {selectedIds.size > 0 && (
            <button
              type="button"
              disabled={downloadingZip}
              onClick={handleDownloadSelectedZip}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#06B6D4] hover:bg-cyan-500 text-zinc-950 text-xs font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {downloadingZip ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Archive className="w-3.5 h-3.5" />
              )}
              Download Selected ({selectedIds.size})
            </button>
          )}

          {filteredClips.some((c) => c.status === 'completed') && (
            <button
              type="button"
              disabled={downloadingZip}
              onClick={handleDownloadAllJobZip}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              {downloadingZip ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Archive className="w-3.5 h-3.5" />
              )}
              Download All as ZIP
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#A1A1AA] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search clips by title, hook, or category..."
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#18181B] border border-zinc-800 text-sm text-[#FAFAFA] placeholder:text-zinc-500 focus:outline-none focus:border-[#8B5CF6]"
          />
        </div>
        <select
          value={selectedJobFilter}
          onChange={(e) => onChangeJobFilter(e.target.value)}
          className="sm:w-72 px-3 py-2 rounded-lg bg-[#18181B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
        >
          <option value="all">All Projects ({clips.length} clips)</option>
          {jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.videoFilename || j.id} ({j.completedClips} clips)
            </option>
          ))}
        </select>
      </div>

      {errorMsg && !activeClip && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          {errorMsg}
        </div>
      )}

      {filteredClips.length === 0 ? (
        <div className="bg-[#18181B] border border-zinc-800/80 rounded-xl p-12 text-center">
          <Film className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <div className="text-sm font-medium text-[#FAFAFA]">No generated clips found</div>
          <p className="text-xs text-[#A1A1AA] mt-1">
            Rendered vertical clips will appear here as soon as a processing job generates its first
            MP4.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
          {filteredClips.map((clip) => {
            const isChecked = selectedIds.has(clip.id);
            const isReady = clip.status === 'completed' && clip.hasVideo;
            return (
              <div
                key={clip.id}
                className="bg-[#18181B] border border-zinc-800/80 rounded-xl overflow-hidden flex flex-col"
              >
                {/* Thumbnail Preview */}
                <div className="relative aspect-[9/16] max-h-72 bg-[#09090B] overflow-hidden group">
                  {clip.hasThumbnail ? (
                    <img
                      src={`/api/clips/${clip.id}/thumbnail?v=${thumbNonce}`}
                      alt={clip.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-zinc-600">
                      <Film className="w-8 h-8 mb-2" />
                      <span className="text-xs">{clip.status}</span>
                    </div>
                  )}

                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent pointer-events-none" />

                  {/* Checkbox */}
                  {isReady && (
                    <button
                      type="button"
                      onClick={() => toggleSelect(clip.id)}
                      aria-label={`Select ${clip.title}`}
                      className={`absolute top-3 left-3 w-6 h-6 rounded-md border flex items-center justify-center transition-colors ${
                        isChecked
                          ? 'bg-[#8B5CF6] border-[#8B5CF6] text-white'
                          : 'bg-black/60 border-zinc-600 text-transparent hover:border-white'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Play overlay */}
                  <button
                    type="button"
                    onClick={() => openClipModal(clip)}
                    aria-label={`Preview ${clip.title}`}
                    className="absolute inset-0 flex items-center justify-center"
                  >
                    <span className="w-11 h-11 rounded-full bg-black/70 border border-white/20 flex items-center justify-center text-white group-hover:scale-105 transition-transform">
                      <Play className="w-4 h-4 ml-0.5" />
                    </span>
                  </button>

                  {/* Bottom duration line */}
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs text-white font-mono tabular-nums pointer-events-none">
                    <span>{formatDuration(clip.duration)}</span>
                    <span>Score {clip.score}</span>
                  </div>
                </div>

                {/* Card Body */}
                <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <h3 className="font-display text-sm font-semibold text-[#FAFAFA] line-clamp-2">
                      {clip.title}
                    </h3>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-[#A1A1AA]">
                      <span className="capitalize">{clip.category}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatDuration(clip.startTime)}–{formatDuration(clip.endTime)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span
                        className={
                          clip.status === 'completed'
                            ? 'text-emerald-400'
                            : clip.status === 'failed'
                            ? 'text-red-400'
                            : 'text-[#06B6D4]'
                        }
                      >
                        {clip.status}
                      </span>
                      {clip.fileSize > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {formatBytes(clip.fileSize)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => openClipModal(clip)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#FAFAFA] hover:text-[#8B5CF6] transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      Preview & Edit
                    </button>

                    <div className="flex items-center gap-2">
                      {isReady && (
                        <a
                          href={`/api/clips/${clip.id}/download`}
                          aria-label={`Download ${clip.title}`}
                          className="p-1.5 rounded-md text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-zinc-800"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleDeleteClip(clip.id)}
                        aria-label={`Delete ${clip.title}`}
                        className="p-1.5 rounded-md text-[#A1A1AA] hover:text-red-400 hover:bg-zinc-800"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Interactive Clip Preview & Timestamp Editor Modal */}
      {activeClip && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 overflow-y-auto">
          <div className="bg-[#18181B] border border-zinc-800 rounded-xl w-full max-w-4xl overflow-hidden my-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
              <div className="min-w-0 pr-4">
                <h3 className="font-display text-base font-semibold text-[#FAFAFA] truncate">
                  {activeClip.title}
                </h3>
                <p className="text-xs text-[#A1A1AA] mt-0.5">
                  {activeClip.category} · Score {activeClip.score} · {activeClip.reason}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveClip(null)}
                className="p-1.5 rounded-lg text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-zinc-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 p-6">
              {/* Video Player */}
              <div className="md:col-span-5 flex flex-col items-center">
                <div className="w-full max-w-[280px] aspect-[9/16] bg-[#09090B] rounded-xl overflow-hidden border border-zinc-800">
                  {activeClip.hasVideo ? (
                    <video
                      key={`${activeClip.id}_${videoNonce}`}
                      src={`/api/clips/${activeClip.id}/preview?v=${videoNonce}`}
                      controls
                      playsInline
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-xs text-[#A1A1AA] p-4 text-center">
                      <Film className="w-8 h-8 mb-2 text-zinc-600" />
                      {activeClip.errorMessage || 'Clip MP4 not yet rendered.'}
                    </div>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap justify-center gap-2 text-xs">
                  {activeClip.hasVideo && (
                    <a
                      href={`/api/clips/${activeClip.id}/download`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white font-medium"
                    >
                      <Download className="w-3.5 h-3.5" />
                      MP4
                    </a>
                  )}
                  {activeClip.hasThumbnail && (
                    <a
                      href={`/api/clips/${activeClip.id}/thumbnail`}
                      download={`${activeClip.id}.jpg`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-[#FAFAFA]"
                    >
                      <ImageIcon className="w-3.5 h-3.5" />
                      Thumb
                    </a>
                  )}
                  {activeClip.hasAss && (
                    <a
                      href={`/api/clips/${activeClip.id}/subtitles?format=ass`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-[#FAFAFA]"
                    >
                      ASS
                    </a>
                  )}
                  {activeClip.hasSrt && (
                    <a
                      href={`/api/clips/${activeClip.id}/subtitles?format=srt`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-[#FAFAFA]"
                    >
                      SRT
                    </a>
                  )}
                </div>
              </div>

              {/* Editor Form */}
              <div className="md:col-span-7 space-y-4">
                {errorMsg && (
                  <div className="px-3.5 py-2.5 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                    {errorMsg}
                  </div>
                )}

                <div>
                  <label className="block text-xs font-medium text-[#A1A1AA] mb-1">
                    Clip Title
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#A1A1AA] mb-1">
                    Opening Hook
                  </label>
                  <input
                    type="text"
                    value={editHook}
                    onChange={(e) => setEditHook(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#A1A1AA] mb-1">
                      Start (sec)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      value={editStart}
                      onChange={(e) => setEditStart(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#A1A1AA] mb-1">
                      End (sec)
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min={editStart + 1}
                      value={editEnd}
                      onChange={(e) => setEditEnd(Number(e.target.value))}
                      className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 font-mono tabular-nums text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#A1A1AA] mb-1">
                      Category
                    </label>
                    <input
                      type="text"
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-[#09090B] border border-zinc-800 text-sm text-[#FAFAFA] focus:outline-none focus:border-[#8B5CF6]"
                    />
                  </div>
                </div>

                <div className="text-xs text-[#A1A1AA] font-mono tabular-nums">
                  Clip duration: {Math.max(0, editEnd - editStart).toFixed(2)}s
                </div>

                <div className="pt-4 border-t border-zinc-800 flex flex-wrap gap-2.5">
                  <button
                    type="button"
                    disabled={savingMeta || rerendering}
                    onClick={() => void handleSaveMetadata(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs font-medium text-[#FAFAFA] disabled:opacity-50"
                  >
                    {savingMeta && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Save & Regenerate Subtitles
                  </button>

                  <button
                    type="button"
                    disabled={rerendering || savingMeta}
                    onClick={handleRerender}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-xs font-medium text-white disabled:opacity-50"
                  >
                    {rerendering ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    Re-Render Clip MP4
                  </button>

                  <button
                    type="button"
                    disabled={regenThumb || !activeClip.hasVideo}
                    onClick={handleRegenThumbnail}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-zinc-700 hover:border-zinc-500 text-xs font-medium text-[#FAFAFA] disabled:opacity-50"
                  >
                    {regenThumb ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="w-3.5 h-3.5" />
                    )}
                    Regenerate Thumbnail
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
