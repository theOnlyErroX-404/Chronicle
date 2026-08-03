import type { GoldenReport } from "@/evaluation/scoring";

// Hand-labeled golden set for the architecture's Phase 1 quality gate (§5, §6):
// a handful of short, realistic threat reports with canonical entity and
// relationship labels. Entity and relationship extraction are scored SEPARATELY
// so we can tell which one a model/prompt change is hurting.
//
// Convention: each report is a single chunk (well under EXTRACTION_MAX_CHUNK_CHARS),
// unambiguous on purpose, and only uses facts a 3B model can extract from the text
// itself (no behavioral inference required). Golden relationships reference the
// canonical entity names or their aliases above.
export const GOLDEN_REPORTS: GoldenReport[] = [
  {
    id: "midnight-blizzard",
    title: "Midnight Blizzard targets Ukraine with SLUI",
    text: "Midnight Blizzard, also known as APT29 and Cozy Bear, is a threat actor attributed to the Russian state. The actor used a malicious Microsoft Outlook extension called SLUI to exploit CVE-2023-23397 in a campaign targeting government agencies in Ukraine and Europe. Analysts observed the SLUI malware communicating with the domain cozybear.example.com.",
    entities: [
      { type: "threat-actor", name: "Midnight Blizzard", aliases: ["APT29", "Cozy Bear"] },
      { type: "malware", name: "SLUI" },
      { type: "vulnerability", name: "CVE-2023-23397" },
      { type: "country", name: "Russia" },
      { type: "country", name: "Ukraine" },
      { type: "country", name: "Europe" },
      { type: "indicator", name: "cozybear.example.com" },
    ],
    relationships: [
      { source: "Midnight Blizzard", type: "uses", target: "SLUI" },
      { source: "SLUI", type: "exploits", target: "CVE-2023-23397" },
      { source: "Midnight Blizzard", type: "targets", target: "Ukraine" },
      { source: "Midnight Blizzard", type: "targets", target: "Europe" },
      { source: "Midnight Blizzard", type: "attributed-to", target: "Russia" },
      { source: "SLUI", type: "communicates-with", target: "cozybear.example.com" },
    ],
  },
  {
    id: "sandworm-blackenergy",
    title: "Sandworm and BlackEnergy against Ukrainian energy",
    text: "Sandworm, an advanced persistent threat group, deployed the BlackEnergy malware against Ukrainian energy companies in 2015. The tool exploited CVE-2014-4114 to target the infrastructure of the electricity grid. Sandworm is attributed to the GRU, the Russian military intelligence service.",
    entities: [
      { type: "threat-actor", name: "Sandworm" },
      { type: "malware", name: "BlackEnergy" },
      { type: "vulnerability", name: "CVE-2014-4114" },
      { type: "sector", name: "energy" },
      { type: "country", name: "Ukraine" },
      { type: "threat-actor", name: "GRU" },
    ],
    relationships: [
      { source: "Sandworm", type: "uses", target: "BlackEnergy" },
      { source: "BlackEnergy", type: "exploits", target: "CVE-2014-4114" },
      { source: "BlackEnergy", type: "targets", target: "energy" },
      { source: "BlackEnergy", type: "targets", target: "Ukraine" },
      { source: "Sandworm", type: "attributed-to", target: "GRU" },
    ],
  },
  {
    id: "fin7-carbanak",
    title: "FIN7 and Carbanak target hospitality",
    text: "FIN7, a financially motivated cybercrime group, used the Carbanak malware to steal payment card data from point-of-sale systems in the hospitality sector. The group sent phishing emails with malicious Word attachments to restaurant employees across the United States.",
    entities: [
      { type: "threat-actor", name: "FIN7" },
      { type: "malware", name: "Carbanak" },
      { type: "sector", name: "hospitality" },
      { type: "country", name: "United States" },
    ],
    relationships: [
      { source: "FIN7", type: "uses", target: "Carbanak" },
      { source: "Carbanak", type: "targets", target: "hospitality" },
      { source: "FIN7", type: "targets", target: "United States" },
    ],
  },
  {
    id: "lazarus-applejeus",
    title: "Lazarus AppleJeus cryptocurrency fraud",
    text: "The Lazarus Group, attributed to North Korea, distributed a trojanized cryptocurrency application carrying the AppleJeus malware to financial institutions. The malware used the file path /opt/blockchain/app and communicated with the command-and-control server at 198.51.100.7.",
    entities: [
      { type: "threat-actor", name: "Lazarus Group" },
      { type: "country", name: "North Korea" },
      { type: "malware", name: "AppleJeus" },
      { type: "sector", name: "financial" },
      { type: "indicator", name: "198.51.100.7" },
      { type: "file-path", name: "/opt/blockchain/app" },
    ],
    relationships: [
      { source: "Lazarus Group", type: "uses", target: "AppleJeus" },
      { source: "AppleJeus", type: "targets", target: "financial" },
      { source: "AppleJeus", type: "communicates-with", target: "198.51.100.7" },
      { source: "Lazarus Group", type: "attributed-to", target: "North Korea" },
    ],
  },
];
