import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { X } from 'lucide-react';
import { create } from 'zustand';

/* ------------------------------- buttons ------------------------------ */

type Variant = 'primary' | 'ghost' | 'outline' | 'danger';

export function Button({
  variant = 'outline',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-[4px] font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none select-none whitespace-nowrap';
  const sizes = size === 'sm' ? 'h-7 px-2.5 text-[12.5px]' : 'h-8 px-3 text-[13px]';
  const variants: Record<Variant, string> = {
    primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
    ghost: 'bg-transparent text-ink-soft hover:bg-surface-2',
    outline: 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
    danger: 'bg-danger-soft text-danger hover:opacity-80',
  };
  return <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...rest} />;
}

export function IconBtn({
  label,
  active = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-[4px] text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:opacity-40 ${active ? 'bg-surface-2 text-accent' : ''} ${className}`}
      {...rest}
    />
  );
}

/* -------------------------------- inputs ------------------------------- */

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-8 w-full rounded-[4px] border border-line-strong bg-surface px-2.5 text-[13px] text-ink placeholder:text-faint focus:border-accent ${className}`}
      {...rest}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{label}</span>
      {children}
    </label>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[3px] border border-line-strong bg-surface-2 px-1 font-mono text-[10.5px] text-muted">
      {children}
    </kbd>
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'accent' | 'danger' | 'warn' }) {
  const tones = {
    neutral: 'bg-surface-2 text-muted',
    accent: 'bg-accent-soft text-accent',
    danger: 'bg-danger-soft text-danger',
    warn: 'bg-surface-2 text-warn',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-[3px] px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 animate-spin rounded-full border-[1.5px] border-line-strong border-t-accent ${className}`}
    />
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-1 p-8 text-center">
      <p className="text-[14px] font-medium text-ink-soft">{title}</p>
      {hint && <p className="max-w-[36ch] text-[12.5px] text-muted">{hint}</p>}
    </div>
  );
}

/* -------------------------------- dialog ------------------------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/35" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 max-h-[86vh] w-[calc(100vw-32px)] ${wide ? 'max-w-[720px]' : 'max-w-[440px]'} -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[6px] border border-line bg-surface p-5 shadow-lg`}
        >
          <div className="mb-3 flex items-center justify-between">
            <Dialog.Title className="text-[14px] font-semibold">{title}</Dialog.Title>
            <IconBtn label="Закрыть" onClick={onClose}>
              <X size={14} />
            </IconBtn>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------- dropdown ------------------------------ */

export function Menu({
  trigger,
  items,
}: {
  trigger: ReactNode;
  items: { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }[];
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 min-w-[180px] rounded-[6px] border border-line bg-surface p-1 shadow-md"
        >
          {items.map((item) => (
            <DropdownMenu.Item
              key={item.label}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={`flex cursor-pointer items-center gap-2 rounded-[4px] px-2.5 py-1.5 text-[13px] outline-none data-[highlighted]:bg-surface-2 ${item.danger ? 'text-danger' : 'text-ink'}`}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/* -------------------------------- toasts ------------------------------- */

interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'error' | 'success';
}

let toastSeq = 0;
export const useToasts = create<{ toasts: Toast[]; push: (text: string, tone?: Toast['tone']) => void; drop: (id: number) => void }>(
  (set) => ({
    toasts: [],
    push: (text, tone = 'info') => {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
      setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
    },
    drop: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }),
);

export function Toasts() {
  const { toasts, drop } = useToasts();
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => drop(t.id)}
          className={`animate-toast-in pointer-events-auto max-w-[90vw] rounded-[6px] border px-3.5 py-2 text-[13px] shadow-sm ${
            t.tone === 'error'
              ? 'border-danger/30 bg-danger-soft text-danger'
              : t.tone === 'success'
                ? 'border-line bg-surface text-ink'
                : 'border-line bg-surface text-ink'
          }`}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}
