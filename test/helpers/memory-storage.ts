/** Object storage in a Map, so file uploads work in tests without S3. */
export class MemoryStorage {
  readonly configured = true;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<Buffer> {
    const object = this.objects.get(key);
    return object ? Promise.resolve(object.body) : Promise.reject(new Error(`No object ${key}`));
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
