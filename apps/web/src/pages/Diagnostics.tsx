import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button } from '../components/ui.js';

interface CheckItem { ok?: boolean; detail?: string }

const DNS_TEMPLATE = [
  ['MX', '@', '10 mail.example.com.'],
  ['A', 'mail', '203.0.113.10'],
  ['TXT', '@', 'v=spf1 mx ip4:203.0.113.10 -all'],
  ['TXT', 'quit._domainkey', 'v=DKIM1; k=rsa; p=<публичный ключ из infrastructure/dkim/quit.public.key>'],
  ['TXT', '_dmarc', 'v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com; fo=1'],
  ['TXT', '_smtp._tls', 'v=TLSRPTv1; rua=mailto:tls@example.com'],
  ['TXT', '_mta-sts', 'v=STSv1; id=<дата>'],
  ['PTR', '(у хостера)', 'mail.example.com → 203.0.113.10'],
];

export function DiagnosticsPage() {
  const diag = useQuery({ queryKey: ['diagnostics'], queryFn: api.diagnostics, refetchInterval: 60_000 });

  const rows: { name: string; desc: string; data?: CheckItem }[] = [
    { name: 'MX', desc: 'Записи MX указывают на наш сервер', data: diag.data?.mx as CheckItem },
    { name: 'SPF', desc: 'Политика отправителей опубликована', data: diag.data?.spf as CheckItem },
    { name: 'DKIM', desc: 'Публичный ключ подписи опубликован', data: diag.data?.dkim as CheckItem },
    { name: 'DMARC', desc: 'Политика обработки неподписанных писем', data: diag.data?.dmarc as CheckItem },
    { name: 'PTR / rDNS', desc: 'Обратная запись IP соответствует домену', data: diag.data?.ptr as CheckItem },
    { name: 'SMTP', desc: 'Сервер принимает соединения на порту 25', data: diag.data?.smtp as CheckItem },
    { name: 'TLS', desc: 'STARTTLS с валидным сертификатом', data: diag.data?.tls as CheckItem },
  ];

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[820px] space-y-5 px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[17px] font-semibold">Диагностика сервера и DNS</h1>
            <p className="text-[12.5px] text-muted">Живые проверки домена example.com и SMTP-сервера.</p>
          </div>
          <Button onClick={() => void diag.refetch()} disabled={diag.isFetching}>Проверить сейчас</Button>
        </div>

        <div className="overflow-hidden rounded-[6px] border border-line bg-surface">
          {rows.map((r) => (
            <div key={r.name} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-0">
              <span className="mt-0.5">
                {diag.isLoading ? (
                  <Loader2 size={16} className="animate-spin text-muted" />
                ) : r.data?.ok ? (
                  <CheckCircle2 size={16} className="text-ok" />
                ) : (
                  <XCircle size={16} className="text-danger" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[13px] font-semibold">{r.name}</span>
                  <span className="text-[12px] text-muted">{r.desc}</span>
                </div>
                {r.data?.detail && <p className="mt-0.5 break-all font-mono text-[11px] text-faint">{r.data.detail}</p>}
              </div>
              <span className={`shrink-0 text-[11px] font-semibold uppercase ${r.data?.ok ? 'text-ok' : 'text-danger'}`}>
                {diag.isLoading ? '…' : r.data?.ok ? 'ок' : 'проблема'}
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-[6px] border border-line bg-surface p-4">
          <h2 className="mb-2 text-[13.5px] font-semibold">Чёрные списки</h2>
          {diag.isLoading ? (
            <p className="text-[12px] text-faint">Проверяем…</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {((diag.data?.blocklists as { list: string; listed: boolean; detail: string }[]) ?? []).map((b) => (
                <li key={b.list} className={`rounded-[4px] border px-2.5 py-1.5 text-[12px] ${b.listed ? 'border-danger/40 bg-danger-soft text-danger' : 'border-line text-muted'}`}>
                  <span className="font-mono">{b.list}</span>: {b.listed ? 'в списке!' : 'чисто'}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-[6px] border border-line bg-surface p-4">
          <h2 className="mb-1 text-[13.5px] font-semibold">Рекомендуемые DNS-записи для example.com</h2>
          <p className="mb-3 text-[12px] text-muted">Примените их у регистратора домена. Эта страница не меняет DNS — только проверяет.</p>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] uppercase tracking-[0.08em] text-faint">
                <th className="py-1.5 pr-3 font-semibold">Тип</th>
                <th className="py-1.5 pr-3 font-semibold">Имя</th>
                <th className="py-1.5 font-semibold">Значение</th>
              </tr>
            </thead>
            <tbody>
              {DNS_TEMPLATE.map(([t, n, v]) => (
                <tr key={`${t}-${n}`} className="border-b border-line last:border-0">
                  <td className="py-1.5 pr-3 font-mono font-semibold">{t}</td>
                  <td className="py-1.5 pr-3 font-mono">{n}</td>
                  <td className="break-all py-1.5 font-mono text-ink-soft">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
