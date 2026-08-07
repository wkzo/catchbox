import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Field, Input, useToasts } from '../components/ui.js';

interface Cond { field: string; op: string; value: string }
interface Act { type: string; value?: string }

const FIELD_LABEL: Record<string, string> = { to: 'Кому (адрес)', from: 'От (отправитель)', subject: 'Тема', alias: 'Алиас' };
const OP_LABEL: Record<string, string> = { contains: 'содержит', equals: 'равно', startsWith: 'начинается с', endsWith: 'заканчивается на', matches: 'regex' };
const ACTION_LABEL: Record<string, string> = {
  label: 'добавить метку', archive: 'в архив', star: 'в избранное', markRead: 'прочитано',
  spam: 'в спам', trash: 'в корзину', block: 'заблокировать отправителя',
};

export function RulesPage() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const rules = useQuery({ queryKey: ['rules'], queryFn: api.rules });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['rules'] });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] px-4 py-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-semibold">Правила</h1>
            <p className="mt-0.5 text-[12.5px] text-muted">Автоматическая маршрутизация входящих. Все условия в правиле должны совпасть (И).</p>
          </div>
          <Button variant="primary" onClick={() => setEditing('new')}><Plus size={14} /> Новое правило</Button>
        </div>

        {editing && (
          <RuleEditor
            initial={editing === 'new' ? null : rules.data?.rules.find((r) => r.id === editing) ?? null}
            onDone={(saved) => { setEditing(null); invalidate(); if (saved) push('Правило сохранено'); }}
          />
        )}

        <div className="mt-3 space-y-2">
          {(rules.data?.rules ?? []).map((r) => (
            <div key={r.id} className={`rounded-[6px] border border-line bg-surface p-3 ${r.enabled ? '' : 'opacity-60'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold">{r.name}</span>
                    <span className="tnum rounded bg-surface-2 px-1.5 text-[10.5px] text-muted">сработало {r.hitCount}×</span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11.5px] text-muted">
                    {r.conditions.map((c: Cond, i: number) => (
                      <span key={i} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">
                        {FIELD_LABEL[c.field] ?? c.field} {OP_LABEL[c.op] ?? c.op} «{c.value}»
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5 text-[11.5px]">
                    {r.actions.map((a: Act, i: number) => (
                      <span key={i} className="rounded bg-accent-soft px-1.5 py-0.5 text-accent">
                        → {ACTION_LABEL[a.type] ?? a.type}{a.value ? `: ${a.value}` : ''}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button onClick={() => void api.updateRule(r.id, { enabled: !r.enabled }).then(invalidate)} className="text-[11.5px] text-muted hover:text-accent">
                    {r.enabled ? 'выключить' : 'включить'}
                  </button>
                  <button onClick={() => setEditing(r.id)} className="text-[11.5px] text-muted hover:text-accent">изменить</button>
                  <button onClick={() => void api.deleteRule(r.id).then(invalidate)} className="text-[11.5px] text-muted hover:text-danger">удалить</button>
                </div>
              </div>
            </div>
          ))}
          {(rules.data?.rules ?? []).length === 0 && !editing && (
            <p className="rounded-[6px] border border-dashed border-line-strong p-6 text-center text-[12.5px] text-muted">
              Правил нет. Пример: «если пришло на jobs@example.com — добавить метку Jobs».
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function RuleEditor({ initial, onDone }: { initial: { id: string; name: string; conditions: Cond[]; actions: Act[] } | null; onDone: (saved: boolean) => void }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [conds, setConds] = useState<Cond[]>(initial?.conditions ?? [{ field: 'to', op: 'contains', value: '' }]);
  const [acts, setActs] = useState<Act[]>(initial?.actions ?? [{ type: 'label', value: '' }]);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async (): Promise<unknown> => {
      const body = { name, enabled: true, conditions: conds, actions: acts };
      return initial ? api.updateRule(initial.id, body) : api.createRule(body);
    },
    onSuccess: () => onDone(true),
    onError: (e) => setError(e instanceof Error ? e.message : 'Ошибка'),
  });

  return (
    <div className="rounded-[6px] border border-line-strong bg-surface p-4">
      <div className="space-y-3">
        <Field label="Название">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Рабочие письма" />
        </Field>

        <div>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Если (все условия)</span>
          {conds.map((c, i) => (
            <div key={i} className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <select value={c.field} onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, field: e.target.value } : x))} className="h-7 rounded-[4px] border border-line bg-bg px-2 text-[12.5px]">
                {Object.entries(FIELD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select value={c.op} onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, op: e.target.value } : x))} className="h-7 rounded-[4px] border border-line bg-bg px-2 text-[12.5px]">
                {Object.entries(OP_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input value={c.value} onChange={(e) => setConds(conds.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="значение" className="h-7 min-w-[120px] flex-1 rounded-[4px] border border-line bg-bg px-2 text-[12.5px]" />
              <button onClick={() => setConds(conds.filter((_, j) => j !== i))} aria-label="Удалить условие" className="text-muted hover:text-danger"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => setConds([...conds, { field: 'from', op: 'contains', value: '' }])} className="text-[11.5px] text-accent hover:underline">+ условие</button>
        </div>

        <div>
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">То (все действия)</span>
          {acts.map((a, i) => (
            <div key={i} className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <select value={a.type} onChange={(e) => setActs(acts.map((x, j) => j === i ? { type: e.target.value, value: '' } : x))} className="h-7 rounded-[4px] border border-line bg-bg px-2 text-[12.5px]">
                {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {a.type === 'label' && (
                <input value={a.value ?? ''} onChange={(e) => setActs(acts.map((x, j) => j === i ? { ...x, value: e.target.value } : x))} placeholder="имя метки" className="h-7 min-w-[120px] flex-1 rounded-[4px] border border-line bg-bg px-2 text-[12.5px]" />
              )}
              <button onClick={() => setActs(acts.filter((_, j) => j !== i))} aria-label="Удалить действие" className="text-muted hover:text-danger"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => setActs([...acts, { type: 'archive' }])} className="text-[11.5px] text-accent hover:underline">+ действие</button>
        </div>

        {error && <p className="text-[12.5px] text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>Сохранить</Button>
          <Button onClick={() => onDone(false)}>Отмена</Button>
        </div>
      </div>
    </div>
  );
}
