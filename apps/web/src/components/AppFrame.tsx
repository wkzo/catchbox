import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive, AtSign, CheckCheck, FileWarning, Inbox, Menu as MenuIcon, PenSquare,
  Search, Send, Settings, SlidersHorizontal, Star, Trash2, Wifi, WifiOff, X,
} from 'lucide-react';
import type { RealtimeEvent } from '@catchbox/types';
import { api } from '../lib/api.js';
import { connectEvents } from '../lib/sse.js';
import { useUi, type FolderKey } from '../state/ui.js';
import { useToasts, Kbd } from './ui.js';
import { Composer } from './Composer.js';
import { CommandPalette } from './CommandPalette.js';

const FOLDERS: { key: FolderKey; label: string; icon: typeof Inbox }[] = [
  { key: 'inbox', label: 'Входящие', icon: Inbox },
  { key: 'starred', label: 'Избранные', icon: Star },
  { key: 'archive', label: 'Архив', icon: Archive },
  { key: 'sent', label: 'Отправленные', icon: Send },
  { key: 'drafts', label: 'Черновики', icon: FileWarning },
  { key: 'spam', label: 'Спам', icon: FileWarning },
  { key: 'trash', label: 'Корзина', icon: Trash2 },
];

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function AppFrame({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const { folder, aliasFilter, setFolder, connected, setConnected, openCompose, compose, setPalette, commandPaletteOpen } = useUi();
  const [mobileNav, setMobileNav] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const counters = useQuery({ queryKey: ['counters'], queryFn: api.counters, refetchInterval: 30_000 });
  const aliases = useQuery({ queryKey: ['aliases'], queryFn: api.aliases });
  const views = useQuery({ queryKey: ['views'], queryFn: api.views });

  useEffect(() => {
    const theme = document.documentElement;
    const stored = localStorage.getItem('quit.theme');
    const apply = () => {
      const mode = stored === 'system' || !stored
        ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        : stored;
      theme.classList.toggle('dark', mode === 'dark');
    };
    apply();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    return connectEvents(
      (event: RealtimeEvent) => {
        if (event.type === 'message:new') {
          qc.invalidateQueries({ queryKey: ['messages'] });
          qc.invalidateQueries({ queryKey: ['counters'] });
          qc.invalidateQueries({ queryKey: ['aliases'] });
          push(`Новое письмо: ${event.message.subject || '(без темы)'} → ${event.message.aliasAddress ?? ''}`, 'info');
        } else if (event.type === 'alias:created') {
          qc.invalidateQueries({ queryKey: ['aliases'] });
          push(`Новый алиас: ${event.alias.address}`, 'info');
        } else if (event.type === 'outbound:status') {
          if (event.status === 'sent') push('Письмо отправлено', 'success');
          if (event.status === 'failed') push(`Отправка не удалась: ${event.error ?? ''}`, 'error');
          qc.invalidateQueries({ queryKey: ['outbox'] });
          qc.invalidateQueries({ queryKey: ['messages'] });
        }
      },
      setConnected,
    );
  }, [qc, push, setConnected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (compose) return;
      const ui = useUi.getState();
      switch (e.key.toLowerCase()) {
        case 'c':
          e.preventDefault();
          openCompose();
          break;
        case '/':
          e.preventDefault();
          searchRef.current?.focus();
          break;
        case 'e':
          if (ui.activeMessageId) {
            void api.updateMessage(ui.activeMessageId, { folder: 'archive' }).then(() => {
              qc.invalidateQueries({ queryKey: ['messages'] });
              ui.select(null);
            });
          }
          break;
        case '#':
          if (ui.activeMessageId) {
            void api.updateMessage(ui.activeMessageId, { folder: 'trash' }).then(() => {
              qc.invalidateQueries({ queryKey: ['messages'] });
              ui.select(null);
            });
          }
          break;
        case 's':
          if (ui.activeMessageId) {
            void api.message(ui.activeMessageId).then((m) =>
              api.updateMessage(ui.activeMessageId!, { starred: !m.starred }).then(() => qc.invalidateQueries({ queryKey: ['messages'] })),
            );
          }
          break;
        case 'u':
          if (ui.activeMessageId) {
            void api.updateMessage(ui.activeMessageId, { read: false }).then(() => {
              qc.invalidateQueries({ queryKey: ['messages'] });
              ui.select(null);
            });
          }
          break;
        case 'r':
        case 'a':
        case 'f':
          if (ui.activeMessageId) {
            void api.message(ui.activeMessageId).then((m) => {
              openReplyCompose(m, e.key.toLowerCase() === 'a' ? 'replyAll' : e.key.toLowerCase() === 'f' ? 'forward' : 'reply');
            });
          }
          break;
        case 'j':
        case 'k': {
          const ids = ui.listIds;
          if (ids.length === 0) break;
          const idx = ui.activeMessageId ? ids.indexOf(ui.activeMessageId) : -1;
          const next = e.key.toLowerCase() === 'j' ? Math.min(idx + 1, ids.length - 1) : Math.max(idx - 1, 0);
          const target = ids[next];
          if (target) ui.select(target);
          break;
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [compose, openCompose, qc, setPalette]);

  const openReplyCompose = (m: Awaited<ReturnType<typeof api.message>>, mode: 'reply' | 'replyAll' | 'forward') => {
    const replyTo = m.replyTo ?? m.fromAddress ?? '';
    openCompose({
      mode,
      sourceMessageId: m.id,
      aliasId: m.aliasId ?? undefined,
      threadId: m.threadId ?? undefined,
      inReplyTo: m.messageIdHeader ?? undefined,
      to: mode === 'forward' ? [] : [replyTo],
      subject: mode === 'forward'
        ? m.subject.startsWith('Fwd:') ? m.subject : `Fwd: ${m.subject}`
        : m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`,
      quote: m.textBody ?? '',
    });
  };

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      navigate(`/mail?view=search&q=${encodeURIComponent(query.trim())}`);
      setMobileNav(false);
    }
  };

  const unread = (k: string) => counters.data?.folders[k] ?? 0;
  const aliasUnread = (id: string) => counters.data?.aliases[id] ?? 0;

  const sidebar = (
    <nav className="flex h-full w-full flex-col gap-4 overflow-y-auto px-3 py-4">
      <button
        onClick={() => openCompose()}
        className="flex h-9 items-center justify-center gap-2 rounded-[4px] bg-accent text-[13px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
      >
        <PenSquare size={14} /> Написать
      </button>
      <ul className="space-y-px">
        {FOLDERS.map(({ key, label, icon: Icon }) => {
          const active = location.pathname === '/mail' && folder === key && !aliasFilter;
          const n = key === 'starred' ? 0 : unread(key);
          return (
            <li key={key}>
              <button
                onClick={() => {
                  setFolder(key);
                  navigate('/mail');
                  setMobileNav(false);
                }}
                aria-current={active ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-[13px] transition-colors ${
                  active ? 'bg-surface-3 font-semibold text-ink' : 'text-ink-soft hover:bg-surface-2'
                }`}
              >
                <Icon size={15} className={active ? 'text-accent' : 'text-muted'} strokeWidth={1.8} />
                <span className="flex-1 text-left">{label}</span>
                {n > 0 && <span className="tnum text-[11.5px] font-semibold text-accent">{n}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <div>
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Алиасы</span>
          <Link to="/aliases" className="text-[11px] text-muted hover:text-accent">управлять</Link>
        </div>
        <ul className="space-y-px">
          {(aliases.data?.aliases ?? [])
            .filter((a) => !a.isPattern)
            .slice(0, 12)
            .map((a) => {
              const active = aliasFilter === a.id;
              const n = aliasUnread(a.id);
              return (
                <li key={a.id}>
                  <button
                    onClick={() => {
                      setFolder('inbox', a.id);
                      navigate('/mail');
                      setMobileNav(false);
                    }}
                    className={`flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-[13px] transition-colors ${
                      active ? 'bg-surface-3 font-medium text-ink' : 'text-ink-soft hover:bg-surface-2'
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: a.color ?? (a.blocked ? 'var(--danger)' : 'var(--accent)') }}
                    />
                    <span className="flex-1 truncate text-left">{a.localpart}</span>
                    {a.pinned && <Star size={11} className="text-warn" fill="currentColor" />}
                    {n > 0 && <span className="tnum text-[11.5px] font-semibold text-accent">{n}</span>}
                  </button>
                </li>
              );
            })}
        </ul>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Представления</span>
          <button
            className="text-[11px] text-muted hover:text-accent"
            onClick={() => {
              const q = window.prompt('Текущий поисковый запрос для сохранения:', query);
              if (!q) return;
              const name = window.prompt('Название представления');
              if (!name) return;
              void api.createView(name, q).then(() => qc.invalidateQueries({ queryKey: ['views'] }));
            }}
          >
            сохранить
          </button>
        </div>
        <ul className="space-y-px">
          {(views.data?.views ?? []).map((v) => (
            <li key={v.id}>
              <button
                onClick={() => navigate(`/mail?view=search&q=${encodeURIComponent(v.query)}`)}
                className="flex w-full items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-[13px] text-ink-soft hover:bg-surface-2"
                title={v.query}
              >
                <Search size={13} className="text-muted" />
                <span className="flex-1 truncate text-left">{v.name}</span>
              </button>
            </li>
          ))}
          {(views.data?.views ?? []).length === 0 && (
            <li className="px-2.5 py-1 text-[11.5px] text-faint">нет сохранённых</li>
          )}
        </ul>
      </div>

      <div className="mt-auto space-y-px border-t border-line pt-3">
        <NavItem to="/aliases" icon={<AtSign size={15} />} label="Алиасы" close={() => setMobileNav(false)} />
        <NavItem to="/rules" icon={<SlidersHorizontal size={15} />} label="Правила" close={() => setMobileNav(false)} />
        <NavItem to="/settings" icon={<Settings size={15} />} label="Настройки" close={() => setMobileNav(false)} />
        <NavItem to="/diagnostics" icon={<CheckCheck size={15} />} label="Диагностика" close={() => setMobileNav(false)} />
      </div>
    </nav>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-3">
        <button className="md:hidden" aria-label="Меню" onClick={() => setMobileNav(true)}>
          <MenuIcon size={18} />
        </button>
        <Link to="/mail" className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-bold tracking-[0.18em]">QUIT</span>
          <span className="hidden text-[11px] text-faint sm:inline">@example.com</span>
        </Link>
        <form onSubmit={onSearch} className="mx-auto w-full max-w-[520px]" role="search">
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск: from:, alias:, has:attachment, is:unread…"
              aria-label="Поиск по письмам"
              className="h-8 w-full rounded-[4px] border border-line bg-bg pl-8 pr-16 text-[13px] placeholder:text-faint focus:border-accent"
            />
            <span className="absolute right-2 top-1/2 hidden -translate-y-1/2 gap-1 sm:flex">
              <Kbd>/</Kbd>
            </span>
          </div>
        </form>
        <div className="flex items-center gap-2">
          <span
            title={connected ? 'Соединение установлено' : 'Переподключение…'}
            aria-label={connected ? 'online' : 'offline'}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-[4px] ${connected ? 'text-ok' : 'text-danger'}`}
          >
            {connected ? <Wifi size={15} /> : <WifiOff size={15} className="animate-pulse" />}
          </span>
          {!connected && <span className="hidden text-[11.5px] text-danger md:inline">переподключение…</span>}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[210px] shrink-0 border-r border-line bg-surface md:block">{sidebar}</aside>
        {mobileNav && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div className="absolute inset-0 bg-black/35" onClick={() => setMobileNav(false)} />
            <div className="absolute left-0 top-0 h-full w-[260px] bg-surface shadow-xl">
              <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
                <span className="text-[14px] font-bold tracking-[0.18em]">QUIT</span>
                <button aria-label="Закрыть меню" onClick={() => setMobileNav(false)}><X size={16} /></button>
              </div>
              {sidebar}
            </div>
          </div>
        )}
        <main className="min-w-0 flex-1">{children}</main>
      </div>

      {compose && <Composer />}
      {commandPaletteOpen && <CommandPalette />}
    </div>
  );
}

function NavItem({ to, icon, label, close }: { to: string; icon: ReactNode; label: string; close: () => void }) {
  return (
    <NavLink
      to={to}
      onClick={close}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-[4px] px-2.5 py-1.5 text-[13px] ${isActive ? 'bg-surface-3 font-medium' : 'text-ink-soft hover:bg-surface-2'}`
      }
    >
      <span className="text-muted">{icon}</span>
      {label}
    </NavLink>
  );
}
