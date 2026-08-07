import type { MessageListResponse, MessageDto, AliasDto, RuleDto, DraftDto } from '@catchbox/types';

function csrfToken(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)quit_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]!) : null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public issues?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  const method = (init.method ?? 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(method)) {
    const token = csrfToken();
    if (token) headers['x-csrf-token'] = token;
    if (init.body && !(init.body instanceof FormData)) headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const msg =
      body && typeof body === 'object' && 'error' in (body as Record<string, unknown>)
        ? String((body as Record<string, unknown>).error)
        : `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, (body as { issues?: unknown })?.issues);
  }
  return body as T;
}

export const api = {
  authState: () => request<{ setupRequired: boolean; authenticated: boolean; user?: { email: string; displayName: string; totpEnabled: boolean; theme: string } }>('/api/auth/state'),
  setup: (body: { email: string; displayName: string; password: string }) =>
    request<{ recoveryKey: string }>('/api/auth/setup', { method: 'POST', body: JSON.stringify(body) }),
  login: (body: { email: string; password: string; totpToken?: string }) =>
    request<{ user: { email: string; displayName: string; totpEnabled: boolean; theme: string } }>('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  sessions: () => request<{ sessions: { id: string; userAgent: string | null; ip: string | null; createdAt: string; lastSeenAt: string; current: boolean }[] }>('/api/auth/sessions'),
  revokeSession: (id: string) => request<{ ok: true }>(`/api/auth/sessions/${id}`, { method: 'DELETE' }),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<{ ok: true }>('/api/auth/password', { method: 'POST', body: JSON.stringify(body) }),
  totpEnroll: () => request<{ secret: string; uri: string }>('/api/auth/totp/enroll', { method: 'POST' }),
  totpConfirm: (token: string) => request<{ ok: true }>('/api/auth/totp/confirm', { method: 'POST', body: JSON.stringify({ token }) }),
  totpDisable: (password: string) => request<{ ok: true }>('/api/auth/totp/disable', { method: 'POST', body: JSON.stringify({ password }) }),
  recover: (body: { email: string; recoveryKey: string; newPassword: string }) =>
    request<{ recoveryKey: string }>('/api/auth/recover', { method: 'POST', body: JSON.stringify(body) }),

  messages: (params: { folder?: string; aliasId?: string; unread?: boolean; cursor?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== false) qs.set(k, String(v));
    return request<MessageListResponse>(`/api/messages?${qs.toString()}`);
  },
  message: (id: string) => request<MessageDto>(`/api/messages/${id}`),
  messageRaw: (id: string) => request<Blob>(`/api/messages/${id}/raw`).catch(() => null),
  updateMessage: (id: string, body: Partial<{ read: boolean; starred: boolean; folder: string }>) =>
    request<{ ok: true }>(`/api/messages/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  bulk: (ids: string[], action: string) =>
    request<{ ok: true }>('/api/messages/bulk', { method: 'POST', body: JSON.stringify({ ids, action }) }),
  thread: (id: string) => request<MessageListResponse>(`/api/threads/${id}`),
  counters: () => request<{ folders: Record<string, number>; aliases: Record<string, number> }>('/api/counters'),
  addLabel: (messageId: string, labelId: string) =>
    request<{ ok: true }>(`/api/messages/${messageId}/labels`, { method: 'POST', body: JSON.stringify({ labelId }) }),
  removeLabel: (messageId: string, labelId: string) =>
    request<{ ok: true }>(`/api/messages/${messageId}/labels/${labelId}`, { method: 'DELETE' }),

  aliases: () => request<{ aliases: AliasDto[] }>('/api/aliases'),
  createAlias: (body: { localpart: string; displayName?: string; color?: string }) =>
    request<{ id: string }>('/api/aliases', { method: 'POST', body: JSON.stringify(body) }),
  updateAlias: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/aliases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAlias: (id: string) => request<{ ok: true }>(`/api/aliases/${id}`, { method: 'DELETE' }),

  drafts: () => request<{ drafts: DraftDto[] }>('/api/drafts'),
  saveDraft: (body: Record<string, unknown>) => request<{ id: string }>('/api/drafts', { method: 'POST', body: JSON.stringify(body) }),
  deleteDraft: (id: string) => request<{ ok: true }>(`/api/drafts/${id}`, { method: 'DELETE' }),
  draftAttachment: (draftId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ id: string; filename: string; size: number }>(`/api/drafts/${draftId}/attachments`, { method: 'POST', body: fd });
  },
  send: (body: Record<string, unknown>) =>
    request<{ jobId: string }>('/api/send', { method: 'POST', body: JSON.stringify(body) }),

  search: (params: Record<string, string | number | boolean | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '' && v !== false) qs.set(k, String(v));
    return request<MessageListResponse>(`/api/search?${qs.toString()}`);
  },

  rules: () => request<{ rules: RuleDto[] }>('/api/rules'),
  createRule: (body: Record<string, unknown>) => request<{ id: string }>('/api/rules', { method: 'POST', body: JSON.stringify(body) }),
  updateRule: (id: string, body: Record<string, unknown>) =>
    request<{ ok: true }>(`/api/rules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRule: (id: string) => request<{ ok: true }>(`/api/rules/${id}`, { method: 'DELETE' }),

  blockedSenders: () => request<{ blockedSenders: { id: string; kind: string; value: string }[] }>('/api/blocked-senders'),
  blockSender: (body: { kind: 'sender' | 'domain'; value: string }) =>
    request<{ id: string }>('/api/blocked-senders', { method: 'POST', body: JSON.stringify(body) }),
  unblockSender: (id: string) => request<{ ok: true }>(`/api/blocked-senders/${id}`, { method: 'DELETE' }),

  labels: () => request<{ labels: { id: string; name: string; color: string | null }[] }>('/api/labels'),
  createLabel: (name: string, color?: string) => request<{ id: string }>('/api/labels', { method: 'POST', body: JSON.stringify({ name, color }) }),
  deleteLabel: (id: string) => request<{ ok: true }>(`/api/labels/${id}`, { method: 'DELETE' }),

  views: () => request<{ views: { id: string; name: string; query: string }[] }>('/api/views'),
  createView: (name: string, query: string) => request<{ id: string }>('/api/views', { method: 'POST', body: JSON.stringify({ name, query }) }),
  deleteView: (id: string) => request<{ ok: true }>(`/api/views/${id}`, { method: 'DELETE' }),

  settings: () => request<{
    profile: { email: string; displayName: string; theme: string; totpEnabled: boolean };
    transport: string;
    domain: string;
    storage: { messageCount: number; attachmentCount: number; bytes: number };
  }>('/api/settings'),
  updateProfile: (body: { displayName: string; theme?: string }) =>
    request<{ ok: true }>('/api/settings/profile', { method: 'PATCH', body: JSON.stringify(body) }),
  outbox: () => request<{ jobs: { id: string; status: string; subject: string; to: string[]; lastError: string | null; createdAt: string }[] }>('/api/settings/outbox'),

  diagnostics: () => request<Record<string, { ok?: boolean; detail?: string } | { list: string; listed: boolean; detail: string }[]>>('/api/diagnostics/dns'),

  attachmentUrl: (id: string, inline = false) => `/api/attachments/${id}${inline ? '?inline=1' : ''}`,
};
