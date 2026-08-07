import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MessageSummaryDto } from '@catchbox/types';
import { api } from '../lib/api.js';
import { useUi } from '../state/ui.js';
import { MessageList } from '../components/MessageList.js';
import { MessageView } from '../components/MessageView.js';
import { Button, Spinner, useToasts } from '../components/ui.js';

const EMPTY_HINTS: Record<string, string> = {
  inbox: 'Новые письма появятся здесь автоматически — отправьте что-нибудь на любой адрес @example.com.',
  archive: 'Архив пуст. Нажмите E на выбранном письме.',
  spam: 'Спама нет.',
  trash: 'Корзина пуста.',
  sent: 'Отправленных писем пока нет.',
  drafts: 'Черновиков нет — нажмите C, чтобы начать письмо.',
  starred: 'Избранного нет. Нажмите S на письме.',
  search: 'Ничего не найдено. Попробуйте другие операторы: from:, alias:, has:attachment.',
};

export function MailShell() {
  const [params] = useSearchParams();
  const searchQ = params.get('q') ?? '';
  const isSearch = params.get('view') === 'search';
  const { folder, aliasFilter, setListWidth, listWidth, selectedIds, clearSelection, activeMessageId, mobilePane } = useUi();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const aliases = useQuery({ queryKey: ['aliases'], queryFn: api.aliases });

  const key = isSearch ? ['messages', 'search', searchQ] : ['messages', folder, aliasFilter ?? 'all'];

  const query = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      isSearch
        ? api.search({ q: searchQ, cursor: pageParam })
        : api.messages({
            folder: folder === 'starred' ? undefined : folder,
            aliasId: aliasFilter ?? undefined,
            cursor: pageParam,
          }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const messages = (query.data?.pages.flatMap((p) => p.messages) ?? []) as MessageSummaryDto[];
  const visible = folder === 'starred' && !isSearch ? messages.filter((m) => m.starred) : messages;

  useEffect(() => {
    const refresh = () => void qc.invalidateQueries({ queryKey: key.slice(0, 2) });
    window.addEventListener('quit:refresh-list', refresh);
    return () => window.removeEventListener('quit:refresh-list', refresh);
  }, [folder, aliasFilter, isSearch, searchQ]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: key.slice(0, 2) });
    void qc.invalidateQueries({ queryKey: ['counters'] });
    void qc.invalidateQueries({ queryKey: ['aliases'] });
  };

  const toggleStar = useCallback(
    async (id: string, starred: boolean) => {
      await api.updateMessage(id, { starred });
      invalidate();
    },
    [folder, aliasFilter, isSearch, searchQ],
  );

  const bulk = async (action: string) => {
    if (selectedIds.length === 0) return;
    try {
      await api.bulk(selectedIds, action);
      clearSelection();
      invalidate();
      push('Готово');
    } catch (e) {
      push(e instanceof Error ? e.message : 'Ошибка', 'error');
    }
  };

  const aliasName = aliasFilter ? aliases.data?.aliases.find((a) => a.id === aliasFilter) : null;
  const heading = isSearch
    ? `Поиск: ${searchQ}`
    : aliasName
      ? `${aliasName.localpart}@example.com`
      : folder === 'inbox' ? 'Входящие' : folder;

  const onResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = listWidth;
    const move = (ev: MouseEvent) => setListWidth(startW + ev.clientX - startX);
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const listPane = (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-semibold">{heading}</h2>
        <span className="tnum text-[11px] text-faint">{query.data?.pages[0]?.total ?? visible.length}</span>
        <Button size="sm" variant="ghost" onClick={() => void query.refetch()}>Обновить</Button>
      </div>
      {selectedIds.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-surface-2 px-2 py-1.5">
          <span className="tnum px-1 text-[11.5px] font-semibold">{selectedIds.length}</span>
          <BulkBtn onClick={() => void bulk('read')}>Прочитано</BulkBtn>
          <BulkBtn onClick={() => void bulk('unread')}>Не прочитано</BulkBtn>
          <BulkBtn onClick={() => void bulk('archive')}>Архив</BulkBtn>
          <BulkBtn onClick={() => void bulk('trash')}>Корзина</BulkBtn>
          <BulkBtn onClick={() => void bulk('spam')}>Спам</BulkBtn>
          <BulkBtn onClick={() => void bulk('star')}>★</BulkBtn>
          <button onClick={clearSelection} className="ml-auto text-[11.5px] text-muted hover:text-danger">снять</button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {query.isLoading ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : query.isError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-[13px] text-danger">Не удалось загрузить письма</p>
            <Button size="sm" onClick={() => void query.refetch()}>Повторить</Button>
          </div>
        ) : (
          <MessageList
            messages={visible}
            loading={query.isFetchingNextPage}
            onLoadMore={() => void query.fetchNextPage()}
            hasMore={Boolean(query.hasNextPage)}
            emptyHint={EMPTY_HINTS[isSearch ? 'search' : folder] ?? ''}
            onToggleStar={(id, s) => void toggleStar(id, s)}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-w-0">
      <section
        aria-label="Список писем"
        className={`h-full shrink-0 border-r border-line bg-bg ${mobilePane === 'list' ? 'w-full' : 'hidden'} lg:block lg:w-auto`}
      >
        <div className="h-full w-full lg:hidden">{listPane}</div>
        <div className="hidden h-full lg:block" style={{ width: listWidth }}>{listPane}</div>
      </section>
      <div
        onMouseDown={onResize}
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label="Изменить ширину списка"
        className="hidden w-1 shrink-0 cursor-col-resize hover:bg-accent/40 focus-visible:bg-accent/60 lg:block"
      />
      <div className={`h-full min-w-0 flex-1 bg-bg ${mobilePane === 'message' ? 'block' : 'hidden lg:block'}`}>
        {activeMessageId ? <MessageView key={activeMessageId} /> : (
          <div className="hidden h-full items-center justify-center text-[13px] text-faint lg:flex">
            Выберите письмо — клавиши J и K листают список
          </div>
        )}
      </div>
    </div>
  );
}

function BulkBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-[3px] px-2 py-1 text-[11.5px] text-ink-soft hover:bg-surface-3">
      {children}
    </button>
  );
}
