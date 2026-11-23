import type {
  AppSettings,
  ClipItem,
  JobConfig,
  JobItem,
  StorageStats,
  TranscriptData,
  VideoItem,
} from '../types';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

export function uploadVideoWithProgress(
  file: File,
  onProgress: (percent: number) => void
): Promise<{ video: VideoItem }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        onProgress(Math.round((ev.loaded / ev.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText || '{}') as {
          video?: VideoItem;
          error?: string;
        };
        if (xhr.status >= 200 && xhr.status < 300 && parsed.video) {
          resolve({ video: parsed.video });
        } else {
          reject(new Error(parsed.error || `Upload failed (${xhr.status})`));
        }
      } catch {
        reject(new Error(`Invalid server response (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during video upload.'));
    const formData = new FormData();
    formData.append('video', file);
    xhr.send(formData);
  });
}

export const api = {
  listVideos: () => requestJson<{ videos: VideoItem[] }>('/api/videos'),
  deleteVideo: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/videos/${id}`, { method: 'DELETE' }),

  createJob: (videoId: string, config: Partial<JobConfig>) =>
    requestJson<{ job: JobItem }>('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, config }),
    }),
  listJobs: () => requestJson<{ jobs: JobItem[] }>('/api/jobs'),
  getJob: (id: string) => requestJson<{ job: JobItem }>(`/api/jobs/${id}`),
  cancelJob: (id: string) =>
    requestJson<{ job: JobItem }>(`/api/jobs/${id}/cancel`, { method: 'POST' }),
  getJobClips: (id: string) => requestJson<{ clips: ClipItem[] }>(`/api/jobs/${id}/clips`),
  getJobTranscript: (id: string) =>
    requestJson<{ transcript: TranscriptData }>(`/api/jobs/${id}/transcript`),
  buildJobZip: (id: string) =>
    requestJson<{ downloadUrl: string; fileCount: number; fileSize: number }>(
      `/api/jobs/${id}/download-zip`,
      { method: 'POST' }
    ),

  listAllClips: () => requestJson<{ clips: ClipItem[] }>('/api/clips'),
  updateClip: (
    id: string,
    payload: {
      title?: string;
      hook?: string;
      category?: string;
      startTime?: number;
      endTime?: number;
      regenerateSubtitles?: boolean;
    }
  ) =>
    requestJson<{ clip: ClipItem }>(`/api/clips/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }),
  renderClip: (id: string) =>
    requestJson<{ clip: ClipItem }>(`/api/clips/${id}/render`, { method: 'POST' }),
  regenerateThumbnail: (id: string, offsetSec?: number) =>
    requestJson<{ clip: ClipItem }>(`/api/clips/${id}/thumbnail`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offsetSec }),
    }),
  deleteClip: (id: string) =>
    requestJson<{ deleted: boolean }>(`/api/clips/${id}`, { method: 'DELETE' }),

  downloadSelectedZip: async (clipIds: string[]) => {
    const res = await fetch('/api/clips/download-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clipIds }),
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error || 'Failed to package selected clips');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ai_shorts_selected.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getSettings: () => requestJson<{ settings: AppSettings }>('/api/settings'),
  updateSettings: (settings: AppSettings) =>
    requestJson<{ settings: AppSettings }>('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }),

  getStorage: () => requestJson<{ storage: StorageStats }>('/api/storage'),
  cleanupStorage: () =>
    requestJson<{ tempRemoved: number; expiredRemoved: number; storage: StorageStats }>(
      '/api/storage/cleanup',
      { method: 'POST' }
    ),

  getFonts: () => requestJson<{ fonts: string[] }>('/api/fonts'),

  testOllamaConnection: (baseUrl: string) =>
    requestJson<{ ok: boolean; baseUrl: string; models: string[]; error?: string }>(
      '/api/ollama/test',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl }),
      }
    ),
};
