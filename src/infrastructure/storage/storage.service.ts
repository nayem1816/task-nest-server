import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException } from '../../common/http/app-exception.js';
import type { Env } from '../../config/env.js';

/**
 * Private object storage for uploaded files. Objects are never public: the
 * API reads them back for processing, and any future download goes through
 * an authorized route.
 */
@Injectable()
export class StorageService {
  readonly configured: boolean;
  private readonly client: S3Client | null;
  private readonly bucket: string;
  private bucketReady: Promise<void> | null = null;

  constructor(config: ConfigService<Env, true>) {
    const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.configured = Boolean(accessKeyId && secretAccessKey);
    this.client = this.configured
      ? new S3Client({
          endpoint: config.get('S3_ENDPOINT', { infer: true }),
          region: config.get('S3_REGION', { infer: true }),
          forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
          credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
        })
      : null;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    const client = this.requireClient();
    await this.ensureBucket(client);
    await client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const client = this.requireClient();
    const res = await client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`Empty object ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    await this.requireClient().send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'STORAGE_NOT_CONFIGURED',
        'File uploads are not set up on this server yet.',
      );
    }
    return this.client;
  }

  /** Local storage starts empty; production buckets exist already and this is a no-op. */
  private ensureBucket(client: S3Client): Promise<void> {
    this.bucketReady ??= client
      .send(new HeadBucketCommand({ Bucket: this.bucket }))
      .then(
        () => undefined,
        () => client.send(new CreateBucketCommand({ Bucket: this.bucket })).then(() => undefined),
      )
      .catch((err: unknown) => {
        this.bucketReady = null;
        throw err;
      });
    return this.bucketReady;
  }
}
