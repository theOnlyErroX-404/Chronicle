import type { AttckMapping, AttckType } from '@/modules/shared/contracts';
import { attckIndex, labelIndex, techniqueNameIndex } from './corpus';

// ATT&CK ids are one uppercase letter + digits: T#### techniques (with an
// optional .NNN sub-technique suffix), G#### groups, S#### software, C####
// campaigns. Word boundaries keep "T1059" from matching inside "T10591".
const ATTACK_ID_REGEX = /\bT\d{3,4}(?:\.\d{3})?\b|\b[GSC]\d{4}\b/g;

const typeFromId = (id: string): AttckType =>
  id.startsWith('T')
    ? 'technique'
    : id.startsWith('G')
      ? 'group'
      : id.startsWith('C')
        ? 'campaign'
        : 'software';

const toMapping = (
  id: string,
  type: AttckType,
  entry: { object: { name: string; tactics?: string[] }; type: AttckType } | undefined,
  confidence: number,
  matchedText: string,
): AttckMapping => ({
  attckId: id,
  type,
  name: entry?.object.name,
  tactic: entry?.type === 'technique' ? entry.object.tactics?.[0] : undefined,
  confidence,
  source: 'explicit',
  matchedText,
});

// Explicit technique/group/software/campaign mention: the report states an
// ATT&CK id, or the canonical name/alias verbatim. Deterministic, offline, no
// LLM. The embedding-similarity "suggested" tier is a separate later increment
// (source enum will grow).
// ponytail: technique names use substring matching, which can false-positive
// on generic multi-word names (e.g. "Web Service"); moderate confidence + the
// human feedback loop cover it — switch to tokenized/phrase matching if
// precision on the golden set demands it.
export const matchExplicitTechniques = (text: string): AttckMapping[] => {
  const found = new Map<string, AttckMapping>();

  for (const match of text.matchAll(ATTACK_ID_REGEX)) {
    const id = match[0];
    const entry = attckIndex.get(id);
    const type = entry?.type ?? typeFromId(id);
    found.set(id, toMapping(id, type, entry, 1, id));
  }

  const lower = text.toLowerCase();
  for (const { lower: name, object } of techniqueNameIndex) {
    if (found.has(object.id)) continue;
    const at = lower.indexOf(name);
    if (at >= 0) {
      found.set(
        object.id,
        toMapping(
          object.id,
          'technique',
          { object, type: 'technique' },
          0.9,
          text.slice(at, at + name.length),
        ),
      );
    }
  }

  for (const { pattern, object, type } of labelIndex) {
    if (found.has(object.id)) continue;
    const match = pattern.exec(text);
    if (match) {
      found.set(object.id, toMapping(object.id, type, { object, type }, 0.9, match[0]));
    }
  }

  return [...found.values()].sort((a, b) =>
    b.confidence !== a.confidence
      ? b.confidence - a.confidence
      : a.attckId.localeCompare(b.attckId),
  );
};
