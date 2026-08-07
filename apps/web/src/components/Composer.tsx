import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Minus, Paperclip, X } from 'lucide-react';
import { api, ApiError } from '../lib/api.js';
import { useUi } from '../state/ui.js';
import { Button, IconBtn, Spinner, useToasts } from './ui.js';

export function Composer() {
  const { compose, closeCompose } = useUi();
  const qc = useQueryClient();
  const push = useToasts((s) => s.push);
  const aliases = useQuery({ queryKey: ['aliases'], queryFn: api.aliases });

  const [to, setTo] = useState((compose?.to ?? []).join(', '));
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState(compose?.subject ?? '');
  const [body, setBody] = useState(compose?.quote ? `\n\n${formatQuote(compose.quote)}` : '');
  const [aliasId, setAliasId] = useState<string>('');
  const [attachments, setAttachments] = useState<{ id: string; filename: string; size: number }[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>(compose?.draftId);
  const [busy, setBusy] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [sending, setSending] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fromOptions = (aliases.data?.aliases ?? []).filter((a) => !a.isPattern && !a.blocked && a.outboundEnabled);

  useEffect(() => {
    if (!aliasId && fromOptions.length > 0) {
      const preferred = compose?.aliasId ? fromOptions.find((a) => a.id === compose.aliasId) : undefined;
      setAliasId(preferred?.id ?? fromOptions[0]!.id);
    }
  }, [aliases.data, aliasId, compose?.aliasId, fromOptions]);

  const parseList = (s: string) =>
    s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);

  const collect = () => ({
    id: draftId,
    aliasId: aliasId || undefined,
    to: parseList(to),
    cc: parseList(cc),
    bcc: parseList(bcc),
    subject,
    textBody: body,
    threadId: compose?.threadId,
    inReplyTo: compose?.inReplyTo,
  });

  const autosave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const data = collect();
      if (!data.to.length && !data.subject && !data.textBody.trim()) return;
      void api.saveDraft(data).then((res) => setDraftId(res.id)).catch(() => {});
    }, 1500);
  }, [draftId, aliasId, to, cc, bcc, subject, body]);

  const send = async () => {
    if (sending) return;
    const data = collect();
    if (data.to.length === 0) {
      push('Укажите хотя бы одного получателя', 'error');
      return;
    }
    const invalid = [...data.to, ...data.cc, ...data.bcc].filter((x) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));
    if (invalid.length > 0) {
      push(`Некорректные адреса: ${invalid.join(', ')}`, 'error');
      return;
    }
    if (!subject.trim() && !window.confirm('Отправить письмо без темы?')) return;
    const mentioned = /вложени|attach|файл/i.test(body);
    if (mentioned && attachments.length === 0 && !window.confirm('В тексте упоминаются вложения, но файл не прикреплён. Отправить?')) return;

    setSending(true);
    setBusy(true);
    try {
      await api.send({ ...data, draftId });
      push('Письмо поставлено в очередь отправки', 'success');
      closeCompose();
      void qc.invalidateQueries({ queryKey: ['drafts'] });
      void qc.invalidateQueries({ queryKey: ['outbox'] });
    } catch (err) {
      setSending(false);
      push(err instanceof ApiError ? err.message : 'Не удалось отправить', 'error');
    } finally {
      setBusy(false);
    }
  };

  const attach = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    let id = draftId;
    if (!id) {
      const res = await api.saveDraft(collect());
      id = res.id;
      setDraftId(id);
    }
    for (const file of Array.from(files)) {
      try {
        const att = await api.draftAttachment(id, file);
        setAttachments((prev) => [...prev, att]);
      } catch (err) {
        push(err instanceof ApiError ? err.message : 'Ошибка загрузки файла', 'error');
      }
    }
  };

  const aliasSignature = fromOptions.find((a) => a.id === aliasId)?.signature;
  useEffect(() => {
    if (compose?.mode === 'new' && aliasSignature) {
      setBody((b) => (b.includes(aliasSignature) ? b : `${b}\n\n-- \n${aliasSignature}`));
    }
  }, [aliasId]);

  if (!compose) return null;

  return (
    <div className="fixed bottom-0 right-0 z-[60] flex w-full flex-col rounded-t-[8px] border border-line bg-surface shadow-[0_-4px_24px_rgba(0,0,0,0.12)] md:right-4 md:w-[560px] md:rounded-[8px] md:shadow-xl">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold">
          {compose.mode === 'reply' ? 'Ответить' : compose.mode === 'replyAll' ? 'Ответить всем' : compose.mode === 'forward' ? 'Переслать' : 'Новое письмо'}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <IconBtn label="Свернуть" onClick={() => setMinimized(!minimized)}><Minus size={14} /></IconBtn>
          <IconBtn label="Закрыть" onClick={closeCompose}><X size={14} /></IconBtn>
        </div>
      </div>

      {!minimized && (
        <>
          <div className="space-y-1.5 border-b border-line px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="w-12 text-[12px] text-muted">От</span>
              <select
                value={aliasId}
                onChange={(e) => setAliasId(e.target.value)}
                aria-label="Адрес отправителя"
                className="h-7 flex-1 rounded-[4px] border border-line bg-bg px-2 font-mono text-[12.5px]"
              >
                {fromOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.localpart}@example.com{a.displayName ? ` — ${a.displayName}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-12 text-[12px] text-muted">Кому</span>
              <input value={to} onChange={(e) => { setTo(e.target.value); autosave(); }} aria-label="Получатели" className="h-7 flex-1 rounded-[4px] border border-line bg-bg px-2 text-[13px]" />
              {!showCc && <button onClick={() => setShowCc(true)} className="text-[11.5px] text-muted hover:text-accent">Cc/Bcc</button>}
            </div>
            {showCc && (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-[12px] text-muted">Копия</span>
                  <input value={cc} onChange={(e) => { setCc(e.target.value); autosave(); }} aria-label="Копия" className="h-7 flex-1 rounded-[4px] border border-line bg-bg px-2 text-[13px]" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-[12px] text-muted">Скр.</span>
                  <input value={bcc} onChange={(e) => { setBcc(e.target.value); autosave(); }} aria-label="Скрытая копия" className="h-7 flex-1 rounded-[4px] border border-line bg-bg px-2 text-[13px]" />
                </div>
              </>
            )}
            <div className="flex items-center gap-2">
              <span className="w-12 text-[12px] text-muted">Тема</span>
              <input value={subject} onChange={(e) => { setSubject(e.target.value); autosave(); }} aria-label="Тема" className="h-7 flex-1 rounded-[4px] border border-line bg-bg px-2 text-[13px]" />
            </div>
          </div>

          <textarea
            value={body}
            onChange={(e) => { setBody(e.target.value); autosave(); }}
            aria-label="Текст письма"
            placeholder="Текст письма…"
            className="h-[240px] w-full resize-none bg-surface px-3 py-2 text-[13.5px] leading-relaxed placeholder:text-faint md:h-[280px]"
          />

          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-line px-3 py-2">
              {attachments.map((a) => (
                <span key={a.id} className="flex items-center gap-1 rounded-[3px] bg-surface-2 px-2 py-1 text-[11.5px]">
                  <Paperclip size={11} /> {a.filename}
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-line px-3 py-2">
            <Button variant="primary" onClick={send} disabled={busy}>
              {busy ? <Spinner /> : sending ? 'Отправка…' : 'Отправить'}
            </Button>
            <IconBtn label="Прикрепить файл" onClick={() => fileRef.current?.click()}><Paperclip size={15} /></IconBtn>
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void attach(e.target.files)} />
            <span className="ml-auto text-[11px] text-faint">черновик сохраняется автоматически</span>
            <button className="text-[12px] text-muted hover:text-danger" onClick={() => { if (draftId) void api.deleteDraft(draftId); closeCompose(); }}>
              выбросить
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function formatQuote(text: string): string {
  const stamp = `> `;
  return text
    .split('\n')
    .slice(0, 60)
    .map((l) => stamp + l)
    .join('\n');
}
