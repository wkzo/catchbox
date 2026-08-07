import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pin, Plus, Star } from 'lucide-react';
import { api } from '../lib/api.js';
import { Badge, Button, Field, Input, Modal, useToasts } from '../components/ui.js';

const COLORS = ['#B44E1F', '#3C7A45', '#9A6B15', '#5A6ACF', '#A83A68', '#2A7F8F'];

export function AliasesPage() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const aliases = useQuery({ queryKey: ['aliases'], queryFn: api.aliases });
  const [createOpen, setCreateOpen] = useState(false);
  const [localpart, setLocalpart] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [color, setColor] = useState<string>(COLORS[0]!);
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['aliases'] });

  const create = useMutation({
    mutationFn: () => api.createAlias({ localpart, displayName: displayName || undefined, color }),
    onSuccess: () => {
      setCreateOpen(false);
      setLocalpart('');
      setDisplayName('');
      setError(null);
      invalidate();
      push('Алиас создан');
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Ошибка'),
  });

  const update = async (id: string, patch: Record<string, unknown>) => {
    await api.updateAlias(id, patch);
    invalidate();
  };

  const remove = async (id: string, source: string) => {
    if (source === 'discovered' && !window.confirm('Алиас создан автоматически. Заблокировать его входящие письма?')) return;
    else if (source !== 'discovered' && !window.confirm('Удалить алиас? Письма сохранятся.')) return;
    await api.deleteAlias(id);
    invalidate();
    push('Готово');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[880px] px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-semibold">Алиасы</h1>
            <p className="mt-0.5 text-[12.5px] text-muted">
              Catch-all активен: письмо на <em>любой</em>@example.com создаст алиас автоматически. Шаблоны вида <code className="font-mono text-[11.5px]">shop-*</code> поддерживаются.
            </p>
          </div>
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <Plus size={14} /> Новый алиас
          </Button>
        </div>

        <div className="overflow-hidden rounded-[6px] border border-line bg-surface">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.08em] text-faint">
                <th className="px-3 py-2 font-semibold">Адрес</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">Писем</th>
                <th className="hidden px-3 py-2 font-semibold md:table-cell">Не прочитано</th>
                <th className="px-3 py-2 font-semibold">Отправка</th>
                <th className="px-3 py-2 font-semibold">Статус</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {(aliases.data?.aliases ?? []).map((a) => (
                <tr key={a.id} className="border-b border-line last:border-0 hover:bg-surface-2/50">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: a.color ?? 'var(--line-strong)' }} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-mono text-[12.5px]">
                          {a.localpart}@example.com
                          {a.pinned && <Star size={11} className="text-warn" fill="currentColor" />}
                        </div>
                        {a.displayName && <div className="text-[11.5px] text-muted">{a.displayName}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="tnum hidden px-3 py-2.5 text-muted md:table-cell">{a.totalMessages}</td>
                  <td className="tnum hidden px-3 py-2.5 md:table-cell">{a.unreadMessages > 0 ? <span className="font-semibold text-accent">{a.unreadMessages}</span> : <span className="text-faint">0</span>}</td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => void update(a.id, { outboundEnabled: !a.outboundEnabled })}
                      className={`rounded-[3px] px-2 py-0.5 text-[11px] font-semibold ${a.outboundEnabled ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-muted'}`}
                    >
                      {a.outboundEnabled ? 'разрешена' : 'выкл'}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge>{a.source === 'discovered' ? 'авто' : a.source === 'system' ? 'системный' : a.source === 'pattern' ? 'шаблон' : 'ручной'}</Badge>
                      {a.blocked && <Badge tone="danger">заблокирован</Badge>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button title="Закрепить" aria-label="Закрепить" onClick={() => void update(a.id, { pinned: !a.pinned })} className={`rounded p-1 hover:bg-surface-3 ${a.pinned ? 'text-warn' : 'text-faint'}`}>
                        <Pin size={13} fill={a.pinned ? 'currentColor' : 'none'} />
                      </button>
                      <button
                        title={a.blocked ? 'Разблокировать' : 'Блокировать входящие'}
                        onClick={() => void update(a.id, { blocked: !a.blocked })}
                        className={`rounded px-1.5 py-0.5 text-[11px] hover:bg-surface-3 ${a.blocked ? 'text-ok' : 'text-muted'}`}
                      >
                        {a.blocked ? 'разблок.' : 'блокир.'}
                      </button>
                      <button title="Удалить" onClick={() => void remove(a.id, a.source)} className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-3 hover:text-danger">
                        удалить
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Новый алиас">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
          className="space-y-3"
        >
          <Field label="Локальная часть (можно шаблон с *)">
            <Input value={localpart} onChange={(e) => setLocalpart(e.target.value.toLowerCase())} placeholder="jobs или shop-*" required pattern="[a-z0-9.*_-]+" />
          </Field>
          <Field label="Отображаемое имя">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Для работы" />
          </Field>
          <Field label="Цвет">
            <div className="flex gap-2">
              {COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Цвет ${c}`} onClick={() => setColor(c)} className={`h-6 w-6 rounded-full border-2 ${color === c ? 'border-ink' : 'border-transparent'}`} style={{ background: c }} />
              ))}
            </div>
          </Field>
          {error && <p className="text-[12.5px] text-danger">{error}</p>}
          <Button variant="primary" type="submit" className="w-full" disabled={create.isPending}>
            Создать
          </Button>
        </form>
      </Modal>
    </div>
  );
}
