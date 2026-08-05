import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// One-time/refresh derivation of the compact ATT&CK corpus from the official
// MITRE STIX bundle, so the app runs fully offline with no runtime network.
// Re-run after MITRE releases a new ATT&CK version (bump the tag below).
const BUNDLE_URL =
  'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/v19.1/enterprise-attack/enterprise-attack.json';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'modules',
  'attck',
  'data',
  'enterprise-attck.json',
);

type StixObject = {
  type: string;
  name?: string;
  description?: string;
  external_references?: Array<{ source_name?: string; external_id?: string }>;
  kill_chain_phases?: Array<{ kill_chain_name?: string; phase_name?: string }>;
  aliases?: string[];
  x_mitre_aliases?: string[];
};

const mitreId = (obj: StixObject): string | undefined =>
  obj.external_references?.find((r) => r.source_name === 'mitre-attack')?.external_id;

// Groups, software, and campaigns are detected by name or alias, so keep every
// alias MITRE publishes (e.g. APT29 is also "NOBELIUM", "Midnight Blizzard").
// Intrusion-sets and campaigns carry them in the STIX 2.1 `aliases` property;
// malware and tools use the custom x_mitre_aliases.
const named = (objs: StixObject[]) =>
  objs
    .map((obj) => {
      const id = mitreId(obj);
      if (!id) return null;
      const aliases = obj.aliases ?? obj.x_mitre_aliases ?? [];
      return {
        id,
        name: obj.name ?? id,
        ...(aliases.length ? { aliases: [...new Set(aliases)] } : {}),
      };
    })
    .filter((obj): obj is NonNullable<typeof obj> => obj !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

const main = async () => {
  const response = await fetch(BUNDLE_URL);
  if (!response.ok) throw new Error(`ATT&CK STIX download failed: HTTP ${response.status}`);
  const bundle = (await response.json()) as { objects: StixObject[] };

  const techniques = bundle.objects
    .filter((obj) => obj.type === 'attack-pattern')
    .map((obj) => {
      const id = mitreId(obj);
      if (!id) return null;
      const tactics = (obj.kill_chain_phases ?? [])
        .filter((phase) => phase.kill_chain_name === 'mitre-attack')
        .map((phase) => phase.phase_name as string);
      return {
        id,
        name: obj.name ?? id,
        tactics,
        ...(obj.description ? { description: obj.description } : {}),
      };
    })
    .filter((obj): obj is NonNullable<typeof obj> => obj !== null)
    .sort((a, b) => a.id.localeCompare(b.id));

  const groups = named(bundle.objects.filter((obj) => obj.type === 'intrusion-set'));
  const software = named(
    bundle.objects.filter((obj) => obj.type === 'malware' || obj.type === 'tool'),
  );
  const campaigns = named(bundle.objects.filter((obj) => obj.type === 'campaign'));

  const payload = {
    source: BUNDLE_URL,
    generatedAt: new Date().toISOString(),
    techniques,
    groups,
    software,
    campaigns,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2));
  console.log(
    `Wrote ${techniques.length} techniques, ${groups.length} groups, ${software.length} software, ${campaigns.length} campaigns to ${OUT}`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
