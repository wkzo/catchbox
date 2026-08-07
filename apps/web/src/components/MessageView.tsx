import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import {
  Archive, ArrowLeft, Code2, CornerDownLeft, CornerUpLeft, Download, Eye, FileText,
  Forward, MailQuestion, Paperclip, ShieldAlert, Star, Trash2,
} from 'lucide-react';
import { api } from '../lib/api.js';
import { useUi } from '../state/ui.js';
import { formatBytes, formatFullDate, initialOf, senderLabel } from '../lib/format.js';
import { Badge, IconBtn, Spinner, useToasts } from './ui.js';

const MAIL_STYLES = `
  body{margin:12px 16px;font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.6;color:var(--ink,#1b1915);word-break:break-word}
  a{color:#b44e1f}
  blockquote{border-left:2px solid #cfc9bc;margin:.5em 0;padding-left:.9em;color:#736d62}
  pre{font-family:'IBM Plex Mono',monospace;font-size:12.5px;background:#efece5;padding:10px;border-radius:4px;overflow-x:auto}
  img{max-width:100%;height:auto}
  table{max-width:100%}
`;

export function MessageView() {
  const { activeMessageId: id, select, openCompose, setMobilePane } = useUi();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const [showHtml, setShowHtml] = useState(true);
  const [showHeaders, setShowHeaders] = useState(false);
  const [loadImages, setLoadImages] = useState(false);

  const msg = useQuery({
    queryKey: ['message', id],
    queryFn: () => api.message(id!),
    enabled: Boolean(id),
  });

  useEffect(() => {
    setShowHeaders(false);
    setLoadImages(false);
    setShowHtml(true);
  }, [id]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['messages'] });
    void qc.invalidateQueries({ queryKey: ['counters'] });
  };

  const act = async (fn: () => Promise<unknown>, toast?: string) => {
    try {
      await fn();
      refresh();
      if (toast) push(toast);
    } catch (e) {
      push(e instanceof Error ? e.message : 'Ошибка', 'error');
    }
  };

  if (!id) {
    return (
      <div className="hidden h-full items-center justify-center text-[13px] text-faint lg:flex">
        Выберите письмо из списка — или нажмите J/K для навигации
      </div>
    );
  }
  if (msg.isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  }
  const m = msg.data;
  if (!m) {
    return <div className="flex h-full items-center justify-center text-[13px] text-muted">Не удалось загрузить письмо</div>;
  }

  const suspicious = m.spamScore >= 5 || m.virusResult === 'infected';
  const remoteImagesBlocked = (m.htmlBody ?? '').includes('data-remote-src');

  const reply = (mode: 'reply' | 'replyAll' | 'forward') => {
    const replyTo = m.replyTo ?? m.fromAddress ?? '';
    openCompose({
      mode,
      sourceMessageId: m.id,
      aliasId: m.aliasId ?? undefined,
      threadId: m.threadId ?? undefined,
      inReplyTo: m.messageIdHeader ?? undefined,
      to: mode === 'forward' ? [] : mode === 'replyAll' ? [replyTo, ...m.to.filter((t) => t.address !== m.aliasAddress).map((t) => t.address)] : [replyTo],
      subject:
        mode === 'forward'
          ? m.subject.startsWith('Fwd:') ? m.subject : `Fwd: ${m.subject}`
          : m.subject.startsWith('Re:') ? m.subject : `Re: ${m.subject}`,
      quote: mode === 'forward' ? `\n\n---------- Пересылаемое сообщение ----------\nОт: ${senderLabel(m.fromName, m.fromAddress)} <${m.fromAddress}>\nТема: ${m.subject}\n\n${m.textBody ?? ''}` : m.textBody ?? '',
    });
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-2 py-1.5">
        <IconBtn label="Назад к списку" className="lg:hidden" onClick={() => setMobilePane('list')}>
          <ArrowLeft size={15} />
        </IconBtn>
        <IconBtn label="Ответить (R)" onClick={() => reply('reply')}><CornerUpLeft size={15} /></IconBtn>
        <IconBtn label="Ответить всем (A)" onClick={() => reply('replyAll')}><CornerDownLeft size={15} /></IconBtn>
        <IconBtn label="Переслать (F)" onClick={() => reply('forward')}><Forward size={15} /></IconBtn>
        <span className="mx-1 h-4 w-px bg-line" />
        <IconBtn label="Архивировать (E)" onClick={() => void act(() => api.updateMessage(m.id, { folder: 'archive' }), 'В архиве').then(() => select(null))}>
          <Archive size={15} />
        </IconBtn>
        <IconBtn label="Удалить (#)" onClick={() => void act(() => api.updateMessage(m.id, { folder: 'trash' }), 'Перемещено в корзину').then(() => select(null))}>
          <Trash2 size={15} />
        </IconBtn>
        <IconBtn label="В спам" onClick={() => void act(() => api.updateMessage(m.id, { folder: 'spam' }), 'Помечено как спам').then(() => select(null))}>
          <ShieldAlert size={15} />
        </IconBtn>
        <IconBtn label={m.starred ? 'Убрать звезду' : 'В избранное'} active={m.starred} onClick={() => void act(() => api.updateMessage(m.id, { starred: !m.starred }))}>
          <Star size={15} fill={m.starred ? 'currentColor' : 'none'} />
        </IconBtn>
        <IconBtn label="Отметить непрочитанным (U)" onClick={() => void act(() => api.updateMessage(m.id, { read: false })).then(() => select(null))}>
          <Eye size={15} />
        </IconBtn>
        <span className="mx-1 h-4 w-px bg-line" />
        <IconBtn label="Исходные заголовки" active={showHeaders} onClick={() => setShowHeaders(!showHeaders)}>
          <Code2 size={15} />
        </IconBtn>
        <IconBtn label="Скачать исходник (.eml)" onClick={() => window.open(`/api/messages/${m.id}/raw`, '_blank')}>
          <Download size={15} />
        </IconBtn>
        <div className="ml-auto flex items-center gap-1">
          {m.htmlBody && m.textBody && (
            <div className="flex rounded-[4px] border border-line text-[11px]">
              <button onClick={() => setShowHtml(true)} className={`px-2 py-1 ${showHtml ? 'bg-surface-3 font-semibold' : 'text-muted'}`}>HTML</button>
              <button onClick={() => setShowHtml(false)} className={`px-2 py-1 ${!showHtml ? 'bg-surface-3 font-semibold' : 'text-muted'}`}>Текст</button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {m.ruleExplanation && (
          <div className="border-b border-line bg-surface-2 px-4 py-2 text-[12px] text-muted">
            <MailQuestion size={12} className="mr-1.5 inline" /> {m.ruleExplanation}
          </div>
        )}
        {suspicious && (
          <div className="flex items-center gap-2 border-b border-danger/30 bg-danger-soft px-4 py-2 text-[12.5px] text-danger">
            <ShieldAlert size={14} />
            {m.virusResult === 'infected' ? 'В письме обнаружен вирус. Не открывайте вложения.' : `Подозрительное письмо (спам-оценка ${m.spamScore.toFixed(1)}).`}
          </div>
        )}
        {m.aliasAddress && (
          <div className="border-b border-line bg-surface px-4 py-1.5 text-[11.5px] text-muted">
            Доставлено на <span className="font-mono font-medium text-accent">{m.aliasAddress}</span>
          </div>
        )}

        <div className="px-4 pb-2 pt-4 md:px-6">
          <h1 className="text-[17px] font-semibold leading-snug">{m.subject || '(без темы)'}</h1>
          <div className="mt-3 flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[13px] font-semibold text-ink-soft">
              {initialOf(m.fromName, m.fromAddress)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13.5px] font-semibold">{senderLabel(m.fromName, m.fromAddress)}</span>
                <span className="truncate font-mono text-[11.5px] text-faint">&lt;{m.fromAddress}&gt;</span>
              </div>
              <div className="mt-0.5 text-[12px] text-muted">
                кому: {m.to.map((t) => t.address).join(', ') || m.envelopeTo}
                {m.cc.length > 0 && <> · копия: {m.cc.map((t) => t.address).join(', ')}</>}
              </div>
            </div>
            <time className="tnum shrink-0 text-[11.5px] text-faint">{formatFullDate(m.receivedAt)}</time>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {m.dkimResult && <Badge tone={m.dkimResult === 'pass' || m.dkimResult === 'signed' ? 'neutral' : 'warn'}>DKIM {m.dkimResult}</Badge>}
            {m.spfResult && <Badge tone={m.spfResult === 'pass' ? 'neutral' : 'warn'}>SPF {m.spfResult}</Badge>}
            {m.dmarcResult && <Badge tone={m.dmarcResult === 'pass' ? 'neutral' : 'warn'}>DMARC {m.dmarcResult}</Badge>}
            {m.labels.map((l) => <Badge key={l.id} tone="accent">{l.name}</Badge>)}
            {m.isListMessage && <Badge>список рассылки</Badge>}
            {m.isAutoReply && <Badge>автоответ</Badge>}
            <span className="text-[11px] text-faint">{formatBytes(m.size)}</span>
          </div>
        </div>

        {showHeaders && (
          <details className="mx-4 mb-3 rounded-[4px] border border-line bg-surface-2 md:mx-6" open>
            <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold text-muted">Заголовки письма</summary>
            <pre className="max-h-[300px] overflow-auto px-3 pb-3 font-mono text-[11px] leading-relaxed text-ink-soft">
              {m.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}
            </pre>
          </details>
        )}

        {remoteImagesBlocked && !loadImages && (
          <div className="mx-4 mb-3 flex items-center justify-between rounded-[4px] border border-line bg-surface-2 px-3 py-2 md:mx-6">
            <span className="text-[12px] text-muted">Внешние изображения заблокированы для защиты от отслеживания.</span>
            <button onClick={() => setLoadImages(true)} className="text-[12px] font-semibold text-accent hover:underline">
              Загрузить
            </button>
          </div>
        )}

        <div className="px-4 pb-6 md:px-6">
          {showHtml && m.htmlBody ? (
            <HtmlBody html={m.htmlBody} loadImages={loadImages} />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-[13.5px] leading-relaxed text-ink">{m.textBody ?? '(пусто)'}</pre>
          )}
        </div>

        {m.attachments.length > 0 && (
          <div className="border-t border-line px-4 py-3 md:px-6">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              <Paperclip size={12} /> Вложения ({m.attachments.filter((a) => !a.inline).length || m.attachments.length})
            </div>
            <div className="flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <a
                  key={a.id}
                  href={api.attachmentUrl(a.id)}
                  className="flex items-center gap-2 rounded-[4px] border border-line bg-surface px-3 py-2 text-[12.5px] transition-colors hover:border-accent"
                  download
                >
                  <FileText size={14} className="text-muted" />
                  <span className="max-w-[200px] truncate">{a.filename}</span>
                  <span className="tnum text-[11px] text-faint">{formatBytes(a.size)}</span>
                  {a.virusStatus === 'infected' && <Badge tone="danger">вирус</Badge>}
                  {a.virusStatus === 'pending' && <Badge tone="warn">сканируется</Badge>}
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HtmlBody({ html, loadImages }: { html: string; loadImages: boolean }) {
  const measureRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(400);

  const processed = useMemo(() => {
    let h = DOMPurify.sanitize(html, {
      FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'object', 'embed', 'link', 'meta', 'base'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    });
    if (loadImages) {
      h = h.replace(/data-remote-src="([^"]+)"/g, 'src="$1"').replace(/data-blocked="1"/g, '');
    }
    return h;
  }, [html, loadImages]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (measureRef.current) setHeight(measureRef.current.offsetHeight + 40);
    }, 50);
    return () => clearTimeout(t);
  }, [processed]);

  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src ${loadImages ? 'https: http: data: cid:' : 'data:'}; font-src data:;"><style>${MAIL_STYLES}</style></head><body>${processed}</body></html>`;

  return (
    <div>
      <div ref={measureRef} aria-hidden className="mail-body pointer-events-none invisible absolute -z-10 w-[min(680px,100%)] overflow-hidden" dangerouslySetInnerHTML={{ __html: processed }} />
      <iframe
        title="Тело письма"
        sandbox=""
        srcDoc={srcDoc}
        style={{ width: '100%', height: `${Math.max(height, 120)}px`, border: 'none' }}
      />
    </div>
  );
}
