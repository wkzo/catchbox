import type { RealtimeEvent } from '@catchbox/types';

export function connectEvents(onEvent: (e: RealtimeEvent) => void, onState: (connected: boolean) => void): () => void {
  let es: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let delay = 1000;

  const open = () => {
    if (stopped) return;
    es = new EventSource('/api/events');
    es.onopen = () => {
      delay = 1000;
      onState(true);
    };
    es.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data) as RealtimeEvent);
      } catch {
        // ignore
      }
    };
    es.onerror = () => {
      onState(false);
      es?.close();
      if (!stopped) {
        retryTimer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 30_000);
      }
    };
  };

  open();
  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    es?.close();
  };
}
