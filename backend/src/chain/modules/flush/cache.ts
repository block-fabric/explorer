/** A cache of bodies, bounded in entries and in bytes (keys come from requests); the oldest go first */
export class BoundedCache<T extends { length: number }> {
  private map = new Map<string, { at: number; value: T }>();
  private bytes = 0;

  constructor(private maxEntries: number, private maxBytes: number, private maxItemBytes: number) {}

  get(key: string, ttlMs: number): T | undefined {
    const c = this.map.get(key);
    return c && Date.now() - c.at < ttlMs ? c.value : undefined;
  }

  set(key: string, value: T): void {
    this.delete(key);
    if (value.length > this.maxItemBytes) {
      return;
    }
    this.map.set(key, { at: Date.now(), value });
    this.bytes += value.length;
    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      this.delete(this.map.keys().next().value as string);
    }
  }

  delete(key: string): void {
    const c = this.map.get(key);
    if (c) {
      this.bytes -= c.value.length;
      this.map.delete(key);
    }
  }

  get size(): number {
    return this.map.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }
}
