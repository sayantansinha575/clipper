import {
  Captions,
  Film,
  FolderKanban,
  LayoutDashboard,
  ListChecks,
  PlusSquare,
  Settings,
  X,
} from 'lucide-react';
import type { NavSection } from '../types';

interface SidebarProps {
  active: NavSection;
  onSelect: (section: NavSection) => void;
  activeJobsCount: number;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: Array<{
  id: NavSection;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'create', label: 'Create Shorts', icon: PlusSquare },
  { id: 'projects', label: 'Projects', icon: FolderKanban },
  { id: 'clips', label: 'Generated Clips', icon: Film },
  { id: 'captions', label: 'Caption Styles', icon: Captions },
  { id: 'queue', label: 'Processing Queue', icon: ListChecks },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export function Sidebar({
  active,
  onSelect,
  activeJobsCount,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const navContent = (
    <div className="flex h-full flex-col bg-[#111114] border-r border-zinc-800/80 w-64 shrink-0">
      <div className="flex items-center justify-between h-16 px-5 border-b border-zinc-800/80">
        <span className="font-display text-base font-semibold tracking-tight text-[#FAFAFA] whitespace-nowrap">
          AI Shorts Studio
        </span>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation"
          className="lg:hidden p-1.5 rounded-md text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-zinc-800/60"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto" aria-label="Primary navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = active === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item.id);
                onCloseMobile();
              }}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                isActive
                  ? 'bg-[#8B5CF6]/15 text-[#FAFAFA]'
                  : 'text-[#A1A1AA] hover:text-[#FAFAFA] hover:bg-zinc-800/40'
              }`}
            >
              <span className="flex items-center gap-3 min-w-0">
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-[#8B5CF6]' : 'text-zinc-400'
                  }`}
                />
                <span className="truncate">{item.label}</span>
              </span>
              {item.id === 'queue' && activeJobsCount > 0 && (
                <span className="font-mono tabular-nums text-xs text-[#06B6D4] font-medium">
                  {activeJobsCount}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-zinc-800/80 text-xs text-[#A1A1AA]">
        Self-hosted CPU pipeline
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0">{navContent}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 flex h-full">{navContent}</div>
        </div>
      )}
    </>
  );
}
