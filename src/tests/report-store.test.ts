import { describe, expect, it } from 'vitest';
import { createReportStore } from '@/modules/shared/report-store';

describe('report store eviction', () => {
  it('evicts the oldest non-active report when the cap is exceeded', async () => {
    const store = createReportStore(2);
    const first = await store.create({ sourceType: 'url', sourceUrl: 'https://example.com/1' });
    const second = await store.create({ sourceType: 'url', sourceUrl: 'https://example.com/2' });
    await store.update(first.id, { status: 'done' });
    await store.update(second.id, { status: 'done' });
    const third = await store.create({ sourceType: 'url', sourceUrl: 'https://example.com/3' });

    expect(await store.get(first.id)).toBeUndefined();
    expect(await store.get(second.id)).toBeDefined();
    expect(await store.get(third.id)).toBeDefined();
  });

  it('never evicts a queued or processing report', async () => {
    const store = createReportStore(2);
    const queued = await store.create({
      sourceType: 'url',
      sourceUrl: 'https://example.com/queued',
    });
    const processing = await store.create({
      sourceType: 'url',
      sourceUrl: 'https://example.com/processing',
    });
    await store.update(processing.id, { status: 'extracting' });
    const third = await store.create({ sourceType: 'url', sourceUrl: 'https://example.com/3' });

    expect(await store.get(queued.id)).toBeDefined();
    expect(await store.get(processing.id)).toBeDefined();
    expect(await store.get(third.id)).toBeDefined();
  });

  it('evicts failed reports before terminal ones of the same age order', async () => {
    const store = createReportStore(1);
    const failed = await store.create({
      sourceType: 'url',
      sourceUrl: 'https://example.com/failed',
    });
    await store.update(failed.id, { status: 'failed' });
    const next = await store.create({ sourceType: 'url', sourceUrl: 'https://example.com/next' });

    expect(await store.get(failed.id)).toBeUndefined();
    expect(await store.get(next.id)).toBeDefined();
  });
});

describe('atomic active-report cap (AUDIT-03)', () => {
  it('rejects create with 429 when the active cap is reached', async () => {
    const store = createReportStore(10);
    for (let index = 0; index < 2; index += 1) {
      await store.create({ sourceType: 'url', sourceUrl: `https://example.com/${index}` });
    }
    await expect(
      store.create({ sourceType: 'url', sourceUrl: 'https://example.com/over' }, 2),
    ).rejects.toMatchObject({ status: 429 });
    expect(await store.countActive()).toBe(2);
  });

  it('allows create when active reports fall below the cap', async () => {
    const store = createReportStore(10);
    await store.create({ sourceType: 'url', sourceUrl: 'https://example.com/a' }, 2);
    await expect(
      store.create({ sourceType: 'url', sourceUrl: 'https://example.com/b' }, 2),
    ).resolves.toMatchObject({ status: 'queued' });
  });
});
