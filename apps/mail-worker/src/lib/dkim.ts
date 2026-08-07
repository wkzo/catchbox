import { createSign, createHash, generateKeyPairSync } from 'node:crypto';

export interface DkimOptions {
  domain: string;
  selector: string;
  privateKeyPem: string;
  signedHeaders?: string[];
}

const DEFAULT_HEADERS = ['from', 'to', 'cc', 'subject', 'date', 'message-id', 'reply-to'];

function toCrlf(input: string): string {
  return input.replace(/\r?\n/g, '\r\n');
}

function relaxedBody(body: string): string {
  const b = toCrlf(body);
  const lines = b.split('\r\n').map((line) =>
    line
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]+$/, ''),
  );
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return '';
  return lines.join('\r\n') + '\r\n';
}

function relaxedHeaderLine(name: string, value: string): string {
  const unfolded = toCrlf(value).replace(/\r\n/g, '');
  const compressed = unfolded.replace(/[ \t]+/g, ' ').trim();
  return `${name.toLowerCase()}:${compressed}`;
}

function splitMessage(raw: string): { headers: [string, string][]; body: string } {
  const normalized = toCrlf(raw);
  const sep = normalized.indexOf('\r\n\r\n');
  const head = sep === -1 ? normalized : normalized.slice(0, sep);
  const body = sep === -1 ? '' : normalized.slice(sep + 4);
  const headers: [string, string][] = [];
  let current: [string, string] | null = null;
  for (const line of head.split('\r\n')) {
    if (/^[ \t]/.test(line) && current) {
      current[1] += '\r\n' + line;
    } else {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      if (current) headers.push(current);
      current = [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
    }
  }
  if (current) headers.push(current);
  return { headers, body };
}

function bodyHash(body: string): string {
  return createHash('sha256').update(relaxedBody(body), 'utf8').digest('base64');
}

export function signMessage(rawMessage: string, opts: DkimOptions): string {
  const { headers, body } = splitMessage(rawMessage);
  const bh = bodyHash(body);
  const signedHeaders = opts.signedHeaders ?? DEFAULT_HEADERS;
  const available = signedHeaders.filter((h) =>
    headers.some(([name]) => name.toLowerCase() === h),
  );
  const timestamp = Math.floor(Date.now() / 1000);
  const sigBase = [
    'v=1',
    'a=rsa-sha256',
    'c=relaxed/relaxed',
    `d=${opts.domain}`,
    `s=${opts.selector}`,
    `t=${timestamp}`,
    `h=${available.join(':')}`,
    `bh=${bh}`,
    'b=',
  ].join('; ');

  const signerInput: string[] = [];
  for (const h of available) {
    // sign the last occurrence (bottom-up per RFC 6376)
    for (let i = headers.length - 1; i >= 0; i--) {
      const [name, value] = headers[i]!;
      if (name.toLowerCase() === h) {
        signerInput.push(relaxedHeaderLine(name, value) + '\r\n');
        break;
      }
    }
  }
  signerInput.push(relaxedHeaderLine('DKIM-Signature', sigBase));

  const sign = createSign('RSA-SHA256');
  sign.update(signerInput.join(''), 'utf8');
  sign.end();
  const signature = sign.sign(opts.privateKeyPem, 'base64');
  const fullSig = sigBase.replace(/b=$/, `b=${signature}`);
  return `DKIM-Signature: ${fullSig}\r\n${toCrlf(rawMessage)}`;
}

export function generateDkimKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}
