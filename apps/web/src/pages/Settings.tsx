import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';
import { Badge, Button, Field, Input, Modal, useToasts } from '../components/ui.js';
import { formatBytes } from '../lib/format.js';

export function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[760px] space-y-6 px-4 py-6">
        <header>
          <h1 className="text-[17px] font-semibold">Настройки</h1>
          <p className="text-[12.5px] text-muted">Профиль, безопасность, блокировки и данные.</p>
        </header>
        <ProfileSection />
        <SecuritySection />
        <BlockedSection />
        <OutboxSection />
        <DataSection />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[6px] border border-line bg-surface p-4">
      <h2 className="mb-3 text-[13.5px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ProfileSection() {
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const push = useToasts((s) => s.push);
  const [name, setName] = useState('');
  const [theme, setTheme] = useState('system');
  useEffect(() => {
    if (settings.data) {
      setName(settings.data.profile.displayName);
      setTheme(settings.data.profile.theme);
    }
  }, [settings.data]);

  const applyTheme = (t: string) => {
    setTheme(t);
    localStorage.setItem('quit.theme', t);
    const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  };

  return (
    <Section title="Профиль и внешний вид">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Отображаемое имя">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Тема">
          <div className="flex gap-1.5">
            {['system', 'light', 'dark'].map((t) => (
              <button key={t} onClick={() => applyTheme(t)} className={`h-8 flex-1 rounded-[4px] border text-[12.5px] ${theme === t ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-line'}`}>
                {t === 'system' ? 'Системная' : t === 'light' ? 'Светлая' : 'Тёмная'}
              </button>
            ))}
          </div>
        </Field>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <p className="text-[12px] text-muted">
          Хранилище: {settings.data ? `${formatBytes(settings.data.storage.bytes)} · писем: ${settings.data.storage.messageCount} · вложений: ${settings.data.storage.attachmentCount}` : '…'}
          <span className="ml-2">Транспорт отправки: <Badge tone="accent">{settings.data?.transport}</Badge></span>
        </p>
        <Button variant="primary" onClick={() => void api.updateProfile({ displayName: name, theme }).then(() => push('Сохранено')).catch(() => push('Ошибка', 'error'))}>
          Сохранить
        </Button>
      </div>
    </Section>
  );
}

function SecuritySection() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: api.sessions });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [totpOpen, setTotpOpen] = useState(false);
  const [totpEnroll, setTotpEnroll] = useState<{ secret: string; uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['sessions'] });
    void qc.invalidateQueries({ queryKey: ['settings'] });
  };

  return (
    <Section title="Безопасность">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Смена пароля</h3>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              void api.changePassword({ currentPassword: cur, newPassword: next })
                .then(() => { push('Пароль изменён'); setCur(''); setNext(''); })
                .catch((err) => push(err instanceof ApiError ? err.message : 'Ошибка', 'error'));
            }}
          >
            <Input type="password" placeholder="Текущий пароль" value={cur} onChange={(e) => setCur(e.target.value)} required />
            <Input type="password" placeholder="Новый пароль (мин. 10)" minLength={10} value={next} onChange={(e) => setNext(e.target.value)} required />
            <Button type="submit" size="sm">Изменить пароль</Button>
          </form>

          <div className="mt-4">
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Двухфакторная аутентификация (TOTP)</h3>
            {settings.data?.profile.totpEnabled ? (
              <div className="flex items-center gap-2">
                <Badge tone="accent">включена</Badge>
                <button
                  className="text-[12px] text-muted hover:text-danger"
                  onClick={() => {
                    const pw = window.prompt('Введите пароль для отключения 2FA');
                    if (pw) void api.totpDisable(pw).then(refresh).catch(() => push('Неверный пароль', 'error'));
                  }}
                >
                  отключить
                </button>
              </div>
            ) : (
              <Button size="sm" onClick={() => { setTotpOpen(true); void api.totpEnroll().then(setTotpEnroll).catch(() => push('Ошибка', 'error')); }}>
                Включить 2FA
              </Button>
            )}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Активные сессии</h3>
          <ul className="space-y-2">
            {(sessions.data?.sessions ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-[4px] border border-line px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px]">{s.userAgent ?? 'неизвестный клиент'} {s.current && <Badge tone="accent">текущая</Badge>}</p>
                  <p className="tnum text-[11px] text-faint">{s.ip ?? ''} · был(а) {new Date(s.lastSeenAt).toLocaleString('ru-RU')}</p>
                </div>
                {!s.current && (
                  <button onClick={() => void api.revokeSession(s.id).then(refresh)} className="text-[11.5px] text-muted hover:text-danger">
                    завершить
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Modal open={totpOpen} onClose={() => setTotpOpen(false)} title="Настройка 2FA">
        {totpEnroll ? (
          <div className="space-y-3">
            <p className="text-[12.5px] text-muted">Добавьте секрет в приложение-аутентификатор и введите код подтверждения.</p>
            <code className="block break-all rounded-[4px] bg-surface-2 p-2.5 font-mono text-[12px]">{totpEnroll.secret}</code>
            <Input value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))} placeholder="6-значный код" maxLength={6} />
            <Button
              variant="primary"
              className="w-full"
              onClick={() => void api.totpConfirm(totpCode).then(() => { setTotpOpen(false); refresh(); push('2FA включена'); }).catch(() => push('Неверный код', 'error'))}
            >
              Подтвердить
            </Button>
          </div>
        ) : (
          <p className="text-[12.5px] text-muted">Загрузка…</p>
        )}
      </Modal>
    </Section>
  );
}

function BlockedSection() {
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const blocked = useQuery({ queryKey: ['blocked'], queryFn: api.blockedSenders });
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<'sender' | 'domain'>('sender');

  return (
    <Section title="Заблокированные отправители">
      <form
        className="mb-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) return;
          void api.blockSender({ kind, value: value.trim() })
            .then(() => { setValue(''); void qc.invalidateQueries({ queryKey: ['blocked'] }); push('Заблокирован'); })
            .catch((err) => push(err instanceof ApiError ? err.message : 'Ошибка', 'error'));
        }}
      >
        <select value={kind} onChange={(e) => setKind(e.target.value as 'sender' | 'domain')} className="h-8 rounded-[4px] border border-line bg-bg px-2 text-[12.5px]">
          <option value="sender">адрес</option>
          <option value="domain">домен</option>
        </select>
        <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'sender' ? 'spam@example.com' : 'example.com'} className="max-w-[280px]" />
        <Button type="submit">Заблокировать</Button>
      </form>
      <ul className="flex flex-wrap gap-2">
        {(blocked.data?.blockedSenders ?? []).map((b) => (
          <li key={b.id} className="flex items-center gap-2 rounded-[4px] border border-line px-2.5 py-1 text-[12.5px]">
            <Badge>{b.kind === 'sender' ? 'адрес' : 'домен'}</Badge>
            <span className="font-mono">{b.value}</span>
            <button onClick={() => void api.unblockSender(b.id).then(() => void qc.invalidateQueries({ queryKey: ['blocked'] }))} aria-label="Разблокировать" className="text-muted hover:text-danger">×</button>
          </li>
        ))}
        {(blocked.data?.blockedSenders ?? []).length === 0 && <li className="text-[12px] text-faint">Список пуст</li>}
      </ul>
    </Section>
  );
}

function OutboxSection() {
  const outbox = useQuery({ queryKey: ['outbox'], queryFn: api.outbox, refetchInterval: 5000 });
  return (
    <Section title="Очередь отправки">
      {(outbox.data?.jobs ?? []).length === 0 ? (
        <p className="text-[12px] text-faint">Нет заданий в очереди.</p>
      ) : (
        <ul className="space-y-1.5">
          {(outbox.data?.jobs ?? []).slice(0, 10).map((j) => (
            <li key={j.id} className="flex items-center gap-2 rounded-[4px] border border-line px-2.5 py-2 text-[12.5px]">
              <Badge tone={j.status === 'sent' ? 'accent' : j.status === 'failed' || j.status === 'bounced' ? 'danger' : 'warn'}>{j.status}</Badge>
              <span className="min-w-0 flex-1 truncate">{j.subject || '(без темы)'} → {j.to.join(', ')}</span>
              {j.lastError && <span className="max-w-[220px] truncate text-[11px] text-danger" title={j.lastError}>{j.lastError}</span>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function DataSection() {
  const push = useToasts((s) => s.push);
  return (
    <Section title="Данные">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => void api.settings().then(() => push('Для полного экспорта используйте infrastructure/backup.sh — см. документацию'))}>
          Инструкция по экспорту
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            const c = window.prompt('Для подтверждения введите: DELETE ALL DATA');
            if (c === 'DELETE ALL DATA') {
              void fetch('/api/settings/data', {
                method: 'DELETE',
                headers: { 'content-type': 'application/json', 'x-csrf-token': document.cookie.match(/quit_csrf=([^;]+)/)?.[1] ?? '' },
                body: JSON.stringify({ confirm: c }),
              }).then(() => push('Все письма удалены', 'success'));
            }
          }}
        >
          Удалить все письма
        </Button>
      </div>
    </Section>
  );
}
