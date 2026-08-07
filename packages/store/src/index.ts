import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { AppConfig } from '@catchbox/config';

export interface ObjectStore {
  put(key: string, body: Buffer, contentType?: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

function assertSafeKey(key: string) {
  if (!/^[\w./-]+$/.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

class FsStore implements ObjectStore {
  constructor(private root: string) {}

  private p(key: string) {
    assertSafeKey(key);
    return path.resolve(this.root, key);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.p(key);
    if (!file.startsWith(path.resolve(this.root))) throw new Error('Path traversal blocked');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.p(key));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.p(key), { force: true });
  }
}

class S3Store implements ObjectStore {
  private client: S3Client;
  constructor(private cfg: AppConfig) {
    this.client = new S3Client({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
      credentials:
        cfg.S3_ACCESS_KEY && cfg.S3_SECRET_KEY
          ? { accessKeyId: cfg.S3_ACCESS_KEY, secretAccessKey: cfg.S3_SECRET_KEY }
          : undefined,
    });
  }

  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.S3_BUCKET, Key: key }));
  }
}

export async function statBytes(store: ObjectStore, key: string): Promise<number | null> {
  const body = await store.get(key);
  return body ? body.length : null;
}

export function createStore(cfg: AppConfig): ObjectStore {
  if (cfg.STORE_DRIVER === 's3') return new S3Store(cfg);
  return new FsStore(cfg.STORE_FS_PATH);
}

export { stat as fsStat };
