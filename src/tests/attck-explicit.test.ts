import { describe, expect, it } from 'vitest';
import {
  ATTACK_CAMPAIGNS,
  ATTACK_GROUPS,
  ATTACK_SOFTWARE,
  ATTACK_TECHNIQUES,
  matchExplicitTechniques,
} from '@/modules/attck';

const ALL = [...ATTACK_TECHNIQUES, ...ATTACK_GROUPS, ...ATTACK_SOFTWARE, ...ATTACK_CAMPAIGNS];

describe('ATT&CK corpus integrity', () => {
  it('loads the full offline corpus with unique, well-formed ids', () => {
    const ids = ALL.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(1500);
    for (const object of ALL) {
      expect(object.id).toMatch(/^[A-Z]\d{4}(\.\d{3})?$/);
      expect(object.name.length).toBeGreaterThan(0);
    }
  });
});

describe('matchExplicitTechniques', () => {
  it('detects explicit ATT&CK ids with full confidence', () => {
    const mappings = matchExplicitTechniques(
      'The group used T1059 to run PowerShell and T1566.001 for phishing.',
    );
    const t1059 = mappings.find((m) => m.attckId === 'T1059');
    const t1566 = mappings.find((m) => m.attckId === 'T1566.001');
    expect(t1059).toMatchObject({
      type: 'technique',
      name: 'Command and Scripting Interpreter',
      confidence: 1,
      source: 'explicit',
      matchedText: 'T1059',
    });
    expect(t1566?.confidence).toBe(1);
    expect(t1566?.tactic).toBe('initial-access');
  });

  it('keeps ids the curated bundle may not know, with no enriched label', () => {
    const mappings = matchExplicitTechniques('see technique T9999');
    expect(mappings).toEqual([
      expect.objectContaining({
        attckId: 'T9999',
        type: 'technique',
        name: undefined,
        confidence: 1,
        matchedText: 'T9999',
      }),
    ]);
  });

  it('matches explicit technique-name mentions at moderate confidence', () => {
    const mappings = matchExplicitTechniques(
      'The report describes OS credential dumping followed by exfiltration over C2 channel.',
    );
    const t1003 = mappings.find((m) => m.attckId === 'T1003');
    expect(t1003).toMatchObject({ confidence: 0.9, source: 'explicit', type: 'technique' });
    expect(t1003?.name).toBe('OS Credential Dumping');
    expect(t1003?.matchedText).toBe('OS credential dumping');
  });

  it('matches groups, software, and campaigns by name and alias', () => {
    const mappings = matchExplicitTechniques(
      'NOBELIUM deployed Cobalt Strike in the Operation Honeybee campaign.',
    );
    const group = mappings.find((m) => m.attckId === 'G0016');
    expect(group).toMatchObject({
      type: 'group',
      name: 'APT29',
      confidence: 0.9,
      matchedText: 'NOBELIUM',
    });
    const soft = mappings.find((m) => m.attckId === 'S0154');
    expect(soft).toMatchObject({ type: 'software', name: 'Cobalt Strike', confidence: 0.9 });
    const campaign = mappings.find((m) => m.attckId === 'C0006');
    expect(campaign).toMatchObject({
      type: 'campaign',
      name: 'Operation Honeybee',
      confidence: 0.9,
    });
  });

  it('matches aliases as whole words, not inside longer tokens', () => {
    const mappings = matchExplicitTechniques(
      'BazarLoader CobaltStrike and APT29x are unrelated here.',
    );
    expect(mappings.find((m) => m.attckId === 'S0154')).toBeUndefined();
    expect(mappings.find((m) => m.attckId === 'G0016')).toBeUndefined();
    expect(mappings.map((m) => m.attckId)).not.toContain('S0373');
  });

  it('deduplicates by id, preferring the higher-confidence mention', () => {
    const mappings = matchExplicitTechniques(
      'OS credential dumping (T1003) is common, as is APT29 (G0016).',
    );
    expect(mappings.filter((m) => m.attckId === 'T1003')).toHaveLength(1);
    expect(mappings.find((m) => m.attckId === 'T1003')?.confidence).toBe(1);
    expect(mappings.filter((m) => m.attckId === 'G0016')).toHaveLength(1);
  });

  it('does not match technique ids without word boundaries', () => {
    expect(matchExplicitTechniques('XT1059Y and MT10591')).toHaveLength(0);
  });

  it('sorts by confidence then id', () => {
    const mappings = matchExplicitTechniques('T1490 T1486 and exfiltration over C2 channel.');
    const confidences = mappings.map((m) => m.confidence);
    expect([...confidences].sort((a, b) => b - a)).toEqual(confidences);
    const tied = mappings.filter((m) => m.confidence === 1).map((m) => m.attckId);
    expect(tied).toEqual([...tied].sort());
    expect(mappings.map((m) => m.attckId)).toContain('T1041');
  });
});
