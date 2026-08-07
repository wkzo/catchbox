import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Paperclip, Star } from 'lucide-react';
import type { MessageSummaryDto } from '@catchbox/types';
import { useUi } from '../state/ui.js';
import { formatListDate, senderLabel } from '../lib/format.js';
import { Checkbox } from './Checkbox.js';
import { EmptyState } from './ui.js';

export function MessageList({
  messages,
  loading,
  onLoadMore,
  hasMore,
  emptyHint,
  onToggleStar,
}: {
  messages: MessageSummaryDto[];
  loading: boolean;
  onLoadMore: () => void;
  hasMore: boolean;
  emptyHint: string;
  onToggleStar: (id: string, starred: boolean) => void;
}) {
  const { activeMessageId, select, selectedIds, toggleSelect, setListIds } = useUi();
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setListIds(messages.map((m) => m.id));
  }, [messages, setListIds]);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  useEffect(() => {
    const idx = activeMessageId ? messages.findIndex((m) => m.id === activeMessageId) : -1;
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [activeMessageId, messages, virtualizer]);

  if (!loading && messages.length === 0) {
    return <EmptyState title="Здесь пусто" hint={emptyHint} />;
  }

  return (
    <div ref={parentRef} className="h-full overflow-y-auto" role="listbox" aria-label="Список писем">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const m = messages[vi.index]!;
          const active = m.id === activeMessageId;
          const checked = selectedIds.includes(m.id);
          return (
            <div
              key={m.id}
              role="option"
              aria-selected={active}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: vi.size, transform: `translateY(${vi.start}px)` }}
            >
              <div
                onClick={() => select(m.id)}
                className={`group flex h-full cursor-pointer flex-col justify-center border-b border-line px-3 pl-2 transition-colors ${
                  active ? 'bg-surface-2 shadow-[inset_2px_0_0_var(--accent)]' : checked ? 'bg-accent-soft/40' : 'hover:bg-surface'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={checked} onChange={() => toggleSelect(m.id)} label={`Выбрать письмо от ${senderLabel(m.fromName, m.fromAddress)}`} />
                  </span>
                  <button
                    aria-label={m.starred ? 'Убрать из избранного' : 'В избранное'}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleStar(m.id, !m.starred);
                    }}
                    className={`shrink-0 ${m.starred ? 'text-warn' : 'text-transparent group-hover:text-faint hover:!text-warn'}`}
                  >
                    <Star size={13} fill={m.starred ? 'currentColor' : 'none'} />
                  </button>
                  <span className={`min-w-0 flex-1 truncate text-[13px] ${m.read ? 'text-ink-soft' : 'font-semibold text-ink'}`}>
                    {senderLabel(m.fromName, m.fromAddress)}
                  </span>
                  {m.hasAttachments && <Paperclip size={12} className="shrink-0 text-muted" />}
                  <span className={`tnum shrink-0 text-[11.5px] ${m.read ? 'text-faint' : 'font-semibold text-accent'}`}>
                    {formatListDate(m.receivedAt)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 pl-[42px]">
                  <span className={`truncate text-[12.5px] ${m.read ? 'text-muted' : 'text-ink'}`}>
                    {m.subject || '(без темы)'}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2 pl-[42px]">
                  {m.aliasAddress && (
                    <span
                      className="max-w-[160px] truncate rounded-[3px] px-1.5 py-px text-[10.5px] font-medium"
                      style={{
                        background: m.aliasColor ? `${m.aliasColor}22` : 'var(--surface-3)',
                        color: m.aliasColor ?? 'var(--muted)',
                      }}
                    >
                      {m.aliasAddress.split('@')[0]}
                    </span>
                  )}
                  {m.labels.map((l) => (
                    <span key={l.id} className="rounded-[3px] bg-surface-3 px-1.5 py-px text-[10.5px] text-muted">
                      {l.name}
                    </span>
                  ))}
                  {!m.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="непрочитано" />}
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-faint">{m.preview}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {hasMore && (
        <div className="flex justify-center p-3">
          <button onClick={onLoadMore} disabled={loading} className="rounded-[4px] border border-line px-3 py-1 text-[12px] text-muted hover:bg-surface-2">
            {loading ? 'Загрузка…' : 'Показать ещё'}
          </button>
        </div>
      )}
    </div>
  );
}
