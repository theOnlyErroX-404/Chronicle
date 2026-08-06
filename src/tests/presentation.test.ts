import { describe, expect, it } from 'vitest';
import { confidenceColor, formatBytes, formatPercent, jobStage } from '@/lib/presentation';

describe('confidenceColor', () => {
  it('marks verified (>= 0.7) confidence teal', () => {
    expect(confidenceColor(0.7)).toBe('#4a8b8c');
    expect(confidenceColor(1)).toBe('#4a8b8c');
  });

  it('marks needs-review (< 0.7) confidence rust', () => {
    expect(confidenceColor(0.69)).toBe('#c4622d');
    expect(confidenceColor(0)).toBe('#c4622d');
  });
});

describe('jobStage', () => {
  it('maps server statuses to named stages', () => {
    expect(jobStage('queued')).toEqual({ stage: 'pending', label: 'Waiting for a worker' });
    expect(jobStage('ingesting')).toEqual({ stage: 'extracting', label: 'Fetching report text' });
    expect(jobStage('modeling')).toEqual({
      stage: 'mapping',
      label: 'Building graph and mappings',
    });
    expect(jobStage('done')).toEqual({ stage: 'done', label: 'Analysis complete' });
  });

  it('surfaces chunk progress during extraction', () => {
    expect(jobStage('extracting', 'chunk 2/3')).toEqual({
      stage: 'extracting',
      label: 'Extracting entities · chunk 2/3',
    });
  });

  it('maps unknown/failed statuses to failed', () => {
    expect(jobStage('failed')).toEqual({ stage: 'failed', label: 'Analysis failed' });
    expect(jobStage('bogus')).toEqual({ stage: 'failed', label: 'Analysis failed' });
  });
});

describe('formatPercent', () => {
  it('renders as a whole percentage', () => {
    expect(formatPercent(0.724)).toBe('72%');
  });
});

describe('formatBytes', () => {
  it('handles byte and unit boundaries', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1024 * 1024)).toBe('1 MB');
  });
});
