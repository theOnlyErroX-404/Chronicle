import { describe, expect, it } from 'vitest';
import {
  confidenceColor,
  formatBytes,
  formatPercent,
  graphRelations,
  jobStage,
} from '@/lib/presentation';
import type { Graph } from '@/modules/shared/contracts';

const sampleGraph: Graph = {
  nodes: [
    { id: 'n1', name: 'APT1', type: 'threat-actor', confidence: 0.9, evidence: 'seen in report' },
    { id: 'n2', name: 'mal.exe', type: 'malware', confidence: 0.8, evidence: 'dropped' },
    { id: 'n3', name: 'CVE-2024-1', type: 'vulnerability', confidence: 0.5, evidence: 'cited' },
  ],
  edges: [
    {
      id: 'e1',
      source: 'n1',
      target: 'n2',
      type: 'uses',
      confidence: 0.9,
      derived: false,
      evidence: 'APT1 uses mal.exe',
    },
    {
      id: 'e2',
      source: 'n1',
      target: 'n3',
      type: 'associated-with',
      confidence: 0.3,
      derived: true,
      evidence: 'co-mention',
    },
  ],
  clusters: [],
};

describe('graphRelations', () => {
  it('returns incident edges with resolved neighbors', () => {
    const relations = graphRelations(sampleGraph, 'n1');
    expect(relations).toHaveLength(2);
    expect(relations[0]).toMatchObject({
      edgeId: 'e1',
      edgeType: 'uses',
      derived: false,
      outgoing: true,
    });
    expect(relations[0].neighbor.name).toBe('mal.exe');
    expect(relations[1]).toMatchObject({ edgeId: 'e2', derived: true, outgoing: true });
  });

  it('marks incoming edges', () => {
    const relations = graphRelations(sampleGraph, 'n3');
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({ edgeId: 'e2', outgoing: false });
  });

  it('returns an empty list for an unknown node', () => {
    expect(graphRelations(sampleGraph, 'ghost')).toEqual([]);
  });
});

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
