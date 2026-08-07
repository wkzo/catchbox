import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api.js';
import { Button, Field, Input, Spinner } from '../components/ui.js';

export function AuthPage() {
  const state = useQuery({ queryKey: ['auth-state'], queryFn: api.authState, retry: false });
  if (state.isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-bg">
        <Spinner />
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-bg p-4">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <h1 className="text-[22px] font-bold tracking-[0.28em]">QUIT</h1>
          <p className="mt-1 text-[12.5px] text-muted">почта для @example.com</p>
        </div>
        {state.data?.setupRequired ? <SetupForm /> : <LoginForm />}
      </div>
    </div>
  );
}

function SetupForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('Owner');
  const [password, setPassword] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (recovery) {
    return (
      <div className="rounded-[6px] border border-line bg-surface p-6">
        <h2 className="mb-2 text-[15px] font-semibold">Ключ восстановления</h2>
        <p className="mb-3 text-[12.5px] text-muted">
          Сохраните его в надёжном месте — он показывается один раз и позволяет вернуть доступ к аккаунту.
        </p>
        <code className="mb-4 block break-all rounded-[4px] bg-surface-2 p-3 font-mono text-[12.5px]">{recovery}</code>
        <Button variant="primary" className="w-full" onClick={() => { void qc.invalidateQueries(); navigate('/mail'); }}>
          Я сохранил ключ
        </Button>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.setup({ email, displayName: name, password });
      setRecovery(res.recoveryKey);
      await qc.invalidateQueries({ queryKey: ['auth-state'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3 rounded-[6px] border border-line bg-surface p-6">
      <h2 className="text-[15px] font-semibold">Первоначальная настройка</h2>
      <p className="text-[12.5px] text-muted">Создайте аккаунт владельца. Публичная регистрация отключена.</p>
      <Field label="Email для входа">
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </Field>
      <Field label="Отображаемое имя">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Пароль (минимум 10 символов)">
        <Input type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </Field>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <Button variant="primary" className="w-full" disabled={busy} type="submit">
        {busy ? <Spinner /> : 'Создать аккаунт'}
      </Button>
    </form>
  );
}

function LoginForm() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [needTotp, setNeedTotp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRecover, setShowRecover] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login({ email, password, totpToken: totp || undefined });
      await qc.invalidateQueries({ queryKey: ['auth-state'] });
      navigate('/mail');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Ошибка входа';
      if (msg.includes('TOTP')) setNeedTotp(true);
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  if (showRecover) return <RecoverForm back={() => setShowRecover(false)} />;

  return (
    <form onSubmit={submit} className="space-y-3 rounded-[6px] border border-line bg-surface p-6">
      <h2 className="text-[15px] font-semibold">Вход</h2>
      <Field label="Email">
        <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
      </Field>
      <Field label="Пароль">
        <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
      </Field>
      {needTotp && (
        <Field label="Код 2FA">
          <Input inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ''))} />
        </Field>
      )}
      {error && <p className="text-[12.5px] text-danger" role="alert">{error}</p>}
      <Button variant="primary" className="w-full" disabled={busy} type="submit">
        {busy ? <Spinner /> : 'Войти'}
      </Button>
      <button type="button" onClick={() => setShowRecover(true)} className="w-full text-center text-[12px] text-muted hover:text-accent">
        Забыли доступ? Восстановление по ключу
      </button>
    </form>
  );
}

function RecoverForm({ back }: { back: () => void }) {
  const [email, setEmail] = useState('');
  const [key, setKey] = useState('');
  const [pw, setPw] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.recover({ email, recoveryKey: key, newPassword: pw });
      setResult(res.recoveryKey);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка');
    }
  };
  if (result) {
    return (
      <div className="space-y-3 rounded-[6px] border border-line bg-surface p-6">
        <h2 className="text-[15px] font-semibold">Доступ восстановлен</h2>
        <p className="text-[12.5px] text-muted">Новый ключ восстановления (старый больше не действует):</p>
        <code className="block break-all rounded-[4px] bg-surface-2 p-3 font-mono text-[12.5px]">{result}</code>
        <Button variant="primary" className="w-full" onClick={back}>Ко входу</Button>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-[6px] border border-line bg-surface p-6">
      <h2 className="text-[15px] font-semibold">Восстановление доступа</h2>
      <Field label="Email"><Input required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Field label="Ключ восстановления"><Input required value={key} onChange={(e) => setKey(e.target.value)} /></Field>
      <Field label="Новый пароль"><Input type="password" required minLength={10} value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button type="button" onClick={back} className="flex-1">Назад</Button>
        <Button variant="primary" type="submit" className="flex-1">Восстановить</Button>
      </div>
    </form>
  );
}
