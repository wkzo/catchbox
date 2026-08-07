import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Command } from 'cmdk';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { useUi } from '../state/ui.js';

export function CommandPalette() {
  const { setPalette, setFolder, openCompose } = useUi();
  const navigate = useNavigate();
  const aliases = useQuery({ queryKey: ['aliases'], queryFn: api.aliases });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPalette]);

  const run = (fn: () => void) => {
    fn();
    setPalette(false);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/35" onClick={() => setPalette(false)} />
      <div className="relative w-full max-w-[520px] rounded-[8px] border border-line bg-surface shadow-xl">
        <Command label="Палитра команд" className="w-full">
          <Command.Input
            autoFocus
            placeholder="Команда или алиас…"
            className="h-11 w-full border-b border-line bg-transparent px-4 text-[14px] outline-none placeholder:text-faint"
          />
          <Command.List className="max-h-[320px] overflow-y-auto p-2">
            <Command.Empty className="px-3 py-4 text-center text-[12.5px] text-muted">Ничего не найдено</Command.Empty>
            <Command.Group heading="Действия" className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint">
              <Item label="Написать письмо" shortcut="C" onSelect={() => run(() => openCompose())} />
              <Item label="Входящие" shortcut="G I" onSelect={() => run(() => { setFolder('inbox'); navigate('/mail'); })} />
              <Item label="Архив" onSelect={() => run(() => { setFolder('archive'); navigate('/mail'); })} />
              <Item label="Отправленные" onSelect={() => run(() => { setFolder('sent'); navigate('/mail'); })} />
              <Item label="Черновики" onSelect={() => run(() => { setFolder('drafts'); navigate('/mail'); })} />
              <Item label="Спам" onSelect={() => run(() => { setFolder('spam'); navigate('/mail'); })} />
              <Item label="Корзина" onSelect={() => run(() => { setFolder('trash'); navigate('/mail'); })} />
            </Command.Group>
            <Command.Group heading="Алиасы" className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint">
              {(aliases.data?.aliases ?? []).map((a) => (
                <Item
                  key={a.id}
                  label={`${a.localpart}@example.com`}
                  onSelect={() => run(() => { setFolder('inbox', a.id); navigate('/mail'); })}
                />
              ))}
            </Command.Group>
            <Command.Group heading="Разделы" className="mt-1 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-faint">
              <Item label="Управление алиасами" onSelect={() => run(() => navigate('/aliases'))} />
              <Item label="Правила" onSelect={() => run(() => navigate('/rules'))} />
              <Item label="Настройки" onSelect={() => run(() => navigate('/settings'))} />
              <Item label="Диагностика DNS и сервера" onSelect={() => run(() => navigate('/diagnostics'))} />
            </Command.Group>
          </Command.List>
          <div className="border-t border-line px-4 py-2 text-[11px] text-faint">↑↓ навигация · Enter выполнить · Esc закрыть</div>
        </Command>
      </div>
    </div>
  );
}

function Item({ label, shortcut, onSelect }: { label: string; shortcut?: string; onSelect: () => void }) {
  return (
    <Command.Item
      onSelect={onSelect}
      className="flex cursor-pointer items-center justify-between rounded-[4px] px-2.5 py-1.5 text-[13px] text-ink data-[selected=true]:bg-surface-2"
    >
      <span className="truncate">{label}</span>
      {shortcut && <span className="font-mono text-[10.5px] text-faint">{shortcut}</span>}
    </Command.Item>
  );
}
