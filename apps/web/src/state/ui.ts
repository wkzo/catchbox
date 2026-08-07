import { create } from 'zustand';

export type FolderKey = 'inbox' | 'archive' | 'spam' | 'trash' | 'sent' | 'drafts' | 'starred';

interface ComposeState {
  open: boolean;
  draftId?: string;
  mode?: 'new' | 'reply' | 'replyAll' | 'forward';
  sourceMessageId?: string;
  to?: string[];
  subject?: string;
  aliasId?: string;
  quote?: string;
  inReplyTo?: string;
  threadId?: string;
}

interface UiState {
  folder: FolderKey;
  aliasFilter: string | null;
  selectedIds: string[];
  activeMessageId: string | null;
  listIds: string[];
  compose: ComposeState | null;
  connected: boolean;
  listWidth: number;
  mobilePane: 'list' | 'message';
  commandPaletteOpen: boolean;
  setFolder: (f: FolderKey, aliasId?: string | null) => void;
  select: (id: string | null) => void;
  toggleSelect: (id: string) => void;
  clearSelection: () => void;
  setListIds: (ids: string[]) => void;
  openCompose: (c?: Partial<ComposeState>) => void;
  closeCompose: () => void;
  setConnected: (v: boolean) => void;
  setListWidth: (w: number) => void;
  setMobilePane: (p: 'list' | 'message') => void;
  setPalette: (v: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  folder: 'inbox',
  aliasFilter: null,
  selectedIds: [],
  activeMessageId: null,
  listIds: [],
  compose: null,
  connected: true,
  listWidth: Number(localStorage.getItem('quit.listWidth') ?? 380),
  mobilePane: 'list',
  commandPaletteOpen: false,
  setFolder: (folder, aliasId = null) =>
    set({ folder, aliasFilter: aliasId, activeMessageId: null, selectedIds: [], mobilePane: 'list' }),
  select: (id) => set({ activeMessageId: id, mobilePane: id ? 'message' : 'list' }),
  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  clearSelection: () => set({ selectedIds: [] }),
  setListIds: (ids) =>
    set((s) =>
      s.listIds.length === ids.length && s.listIds.every((v, i) => v === ids[i]) ? s : { listIds: ids },
    ),
  openCompose: (c) => set({ compose: { open: true, mode: 'new', ...c } }),
  closeCompose: () => set({ compose: null }),
  setConnected: (v) => set({ connected: v }),
  setListWidth: (w) => {
    localStorage.setItem('quit.listWidth', String(w));
    set({ listWidth: Math.min(640, Math.max(280, w)) });
  },
  setMobilePane: (p) => set({ mobilePane: p }),
  setPalette: (v) => set({ commandPaletteOpen: v }),
}));
