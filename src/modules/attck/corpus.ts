import corpus from './data/enterprise-attck.json';

// Compact, offline MITRE ATT&CK Enterprise corpus, derived from the official
// STIX bundle by `npm run attck:refresh` (see scripts/attck-refresh.ts).
// Objects come in four kinds: techniques (T####), groups (G####), software
// (S####), and campaigns (C####). Groups/software/campaigns are matched by
// name or alias; techniques by id or name.
export type AttckType = 'technique' | 'group' | 'software' | 'campaign';

export type AttackObject = {
  id: string;
  name: string;
  aliases?: string[];
  tactics?: string[];
  description?: string;
};

export const ATTACK_TECHNIQUES: readonly AttackObject[] = corpus.techniques;
export const ATTACK_GROUPS: readonly AttackObject[] = corpus.groups;
export const ATTACK_SOFTWARE: readonly AttackObject[] = corpus.software;
export const ATTACK_CAMPAIGNS: readonly AttackObject[] = corpus.campaigns;

// id -> object + kind, covering all four namespaces so an explicit T####/G####/
// S####/C#### mention enriches even when the label does not appear verbatim.
type AttckIndexEntry = { object: AttackObject; type: AttckType };
export const attckIndex: ReadonlyMap<string, AttckIndexEntry> = new Map([
  ...ATTACK_TECHNIQUES.map((object): [string, AttckIndexEntry] => [
    object.id,
    { object, type: 'technique' },
  ]),
  ...ATTACK_GROUPS.map((object): [string, AttckIndexEntry] => [
    object.id,
    { object, type: 'group' },
  ]),
  ...ATTACK_SOFTWARE.map((object): [string, AttckIndexEntry] => [
    object.id,
    { object, type: 'software' },
  ]),
  ...ATTACK_CAMPAIGNS.map((object): [string, AttckIndexEntry] => [
    object.id,
    { object, type: 'campaign' },
  ]),
]);

// Lowercased full technique name -> technique, matched by substring.
export const techniqueNameIndex: readonly { lower: string; object: AttackObject }[] =
  ATTACK_TECHNIQUES.map((object) => ({ lower: object.name.toLowerCase(), object }));

type LabelEntry = { pattern: RegExp; object: AttackObject; type: AttckType };

const escapeRegex = (label: string) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Name + alias -> object, for groups/software/campaigns, matched as whole words
// so a proper noun like "Bazar" never matches inside "BazarLoader". The
// lookarounds (!\w) bound each side without the \b edge case that would never
// match a label ending in a non-word char (e.g. the group "LAPSUS$"). Compiled
// once at module load.
const buildLabelIndex = (
  objects: readonly AttackObject[],
  type: AttckType,
): readonly LabelEntry[] =>
  objects.flatMap((object) =>
    [object.name, ...(object.aliases ?? [])].map((label) => ({
      // nosemgrep: detect-non-literal-regexp
      pattern: new RegExp(`(?<!\\w)${escapeRegex(label)}(?!\\w)`, 'i'), // nosemgrep: detect-non-literal-regexp
      object,
      type,
    })),
  );

export const labelIndex: readonly LabelEntry[] = [
  ...buildLabelIndex(ATTACK_GROUPS, 'group'),
  ...buildLabelIndex(ATTACK_SOFTWARE, 'software'),
  ...buildLabelIndex(ATTACK_CAMPAIGNS, 'campaign'),
];
