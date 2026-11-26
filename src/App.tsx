import { useCallback, useEffect, useState } from 'react';
import { Menu, Plus } from 'lucide-react';
import { CaptionStylesView } from './components/CaptionStylesView';
import { ClipsGalleryView } from './components/ClipsGalleryView';
import { CreateShortsView } from './components/CreateShortsView';
import { DashboardView } from './components/DashboardView';
import { ProjectsView } from './components/ProjectsView';
import { QueueView } from './components/QueueView';
import { RawVideosView } from './components/RawVideosView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { api } from './lib/api';
import { isActiveJobStatus } from './lib/format';
import type {
  AppSettings,
  ClipItem,
  JobItem,
  NavSection,
  StorageStats,
  VideoItem,
} from './types';

const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'Dashboard',
  create: 'Create Shorts',
  raw_videos: 'Raw Videos',
  projects: 'Projects',
  clips: 'Generated Clips',
  captions: 'Caption Styles',
  queue: 'Processing Queue',
  settings: 'Settings',
};

export default function App() {
  const [activeSection, setActiveSection] = useState<NavSection>('dashboard');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [jobs, setJobs] = useState<JobItem[]>([]);
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [fonts, setFonts] = useState<string[]>([]);

  const [selectedJobFilter, setSelectedJobFilter] = useState<string>('all');
  const [preselectedVideoId, setPreselectedVideoId] = useState<string | null>(null);
  const [createInitialMode, setCreateInitialMode] = useState<'auto_ai' | 'portion'>('auto_ai');
  const [cleaningStorage, setCleaningStorage] = useState(false);

  const refreshAll = useCallback(async () => {
    const [vRes, jRes, cRes, sRes, stRes] = await Promise.all([
      api.listVideos(),
      api.listJobs(),
      api.listAllClips(),
      api.getSettings(),
      api.getStorage(),
    ]);
    setVideos(vRes.videos);
    setJobs(jRes.jobs);
    setClips(cRes.clips);
    setSettings(sRes.settings);
    setStorage(stRes.storage);
  }, []);

  useEffect(() => {
    void refreshAll();
    void api.getFonts().then((r) => setFonts(r.fonts)).catch(() => {});
  }, [refreshAll]);

  // Real-time SSE progress stream subscription for all active jobs
  const activeJobIds = jobs
    .filter((j) => isActiveJobStatus(j.status))
    .map((j) => j.id)
    .join(',');

  useEffect(() => {
    if (!activeJobIds) return;
    const ids = activeJobIds.split(',').filter(Boolean);
    const sources: EventSource[] = [];

    for (const id of ids) {
      const es = new EventSource(`/api/jobs/${id}/progress`);
      es.onmessage = (ev) => {
        try {
          const updated = JSON.parse(ev.data) as JobItem;
          setJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
          if (!isActiveJobStatus(updated.status) || updated.completedClips > 0) {
            void api.listAllClips().then((r) => setClips(r.clips)).catch(() => {});
            void api.getStorage().then((r) => setStorage(r.storage)).catch(() => {});
          }
        } catch {
          // Ignore malformed keepalive
        }
      };
      sources.push(es);
    }

    return () => {
      for (const es of sources) es.close();
    };
  }, [activeJobIds]);

  const handleCancelJob = async (jobId: string) => {
    await api.cancelJob(jobId);
    await refreshAll();
  };

  const handleCleanupStorage = async () => {
    setCleaningStorage(true);
    try {
      const res = await api.cleanupStorage();
      setStorage(res.storage);
    } finally {
      setCleaningStorage(false);
    }
  };

  const activeJobsCount = jobs.filter((j) => isActiveJobStatus(j.status)).length;

  return (
    <div className="min-h-screen flex bg-[#09090B] text-[#FAFAFA]">
      <Sidebar
        active={activeSection}
        onSelect={setActiveSection}
        activeJobsCount={activeJobsCount}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Clean 3-Zone Top Header */}
        <header className="h-16 px-4 sm:px-8 border-b border-zinc-800/80 bg-[#09090B]/95 backdrop-blur sticky top-0 z-30 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 rounded-lg text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-zinc-800/60"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="text-sm font-medium text-[#A1A1AA] truncate">
              Workspace <span className="text-zinc-600 mx-1">/</span>{' '}
              <span className="text-[#FAFAFA]">{SECTION_TITLES[activeSection]}</span>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-4 text-xs text-[#A1A1AA] whitespace-nowrap">
            {activeJobsCount > 0 ? (
              <button
                type="button"
                onClick={() => setActiveSection('queue')}
                className="text-[#06B6D4] hover:text-cyan-300 font-medium transition-colors"
              >
                {activeJobsCount} active render job{activeJobsCount > 1 ? 's' : ''}
              </button>
            ) : (
              <span>CPU pipeline ready</span>
            )}
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setActiveSection('create')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Create Shorts
            </button>
          </div>
        </header>

        {/* Main Content Viewport */}
        <main className="flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto">
          {activeSection === 'dashboard' && (
            <DashboardView
              videos={videos}
              jobs={jobs}
              clips={clips}
              storage={storage}
              onNavigate={setActiveSection}
              onSelectJobClips={(jobId) => {
                setSelectedJobFilter(jobId);
                setActiveSection('clips');
              }}
              onCancelJob={handleCancelJob}
              onCleanupStorage={handleCleanupStorage}
              cleaningStorage={cleaningStorage}
            />
          )}

          {activeSection === 'create' && (
            <CreateShortsView
              videos={videos}
              settings={settings}
              initialVideoId={preselectedVideoId}
              initialMode={createInitialMode}
              onSettingsSaved={setSettings}
              onVideoUploaded={(video) => {
                setVideos((prev) => [video, ...prev.filter((v) => v.id !== video.id)]);
                void api.getStorage().then((r) => setStorage(r.storage)).catch(() => {});
              }}
              onJobStarted={() => {
                void refreshAll();
                setActiveSection('queue');
              }}
            />
          )}

          {activeSection === 'raw_videos' && (
            <RawVideosView
              videos={videos}
              jobs={jobs}
              onAutoClipsFromVideo={(videoId) => {
                setPreselectedVideoId(videoId);
                setCreateInitialMode('auto_ai');
                setActiveSection('create');
              }}
              onPortionClipFromVideo={(videoId) => {
                setPreselectedVideoId(videoId);
                setCreateInitialMode('portion');
                setActiveSection('create');
              }}
              onRefresh={refreshAll}
            />
          )}

          {activeSection === 'projects' && (
            <ProjectsView
              videos={videos}
              jobs={jobs}
              onCreateFromVideo={(videoId) => {
                setPreselectedVideoId(videoId);
                setCreateInitialMode('auto_ai');
                setActiveSection('create');
              }}
              onViewJobClips={(jobId) => {
                setSelectedJobFilter(jobId);
                setActiveSection('clips');
              }}
              onRefresh={refreshAll}
            />
          )}

          {activeSection === 'clips' && (
            <ClipsGalleryView
              clips={clips}
              jobs={jobs}
              selectedJobFilter={selectedJobFilter}
              onChangeJobFilter={setSelectedJobFilter}
              onRefresh={refreshAll}
            />
          )}

          {activeSection === 'captions' && (
            <CaptionStylesView
              settings={settings}
              fonts={fonts}
              onSettingsSaved={(updated) => setSettings(updated)}
            />
          )}

          {activeSection === 'queue' && (
            <QueueView
              jobs={jobs}
              onCancelJob={handleCancelJob}
              onViewJobClips={(jobId) => {
                setSelectedJobFilter(jobId);
                setActiveSection('clips');
              }}
            />
          )}

          {activeSection === 'settings' && (
            <SettingsView
              settings={settings}
              onSettingsSaved={(updated) => setSettings(updated)}
            />
          )}
        </main>
      </div>
    </div>
  );
}
