import { describe, expect, it } from "vitest";
import { buildGraph, completeEntityEndpoints, inferEndpointType } from "@/modules/knowledge-modeling";

describe("knowledge modeling", () => {
  it("deduplicates entities and retains relationships whose endpoints resolve", () => {
    const graph = buildGraph({
      entities: [
        { type: "threat-actor", name: "APT 29", confidence: 0.9, evidence: "APT 29" },
        { type: "threat-actor", name: "APT-29", confidence: 0.8, evidence: "APT-29" },
        { type: "malware", name: "ExampleRAT", confidence: 0.95, evidence: "ExampleRAT" },
      ],
      relationships: [{ source: "APT-29", target: "ExampleRAT", type: "uses", confidence: 0.85, evidence: "uses ExampleRAT" }],
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });

  it("treats a leading 'The ' as the same entity name", () => {
    const graph = buildGraph({
      entities: [
        { type: "threat-actor", name: "The Lazarus Group", confidence: 0.95, evidence: "a" },
        { type: "threat-actor", name: "Lazarus Group", confidence: 0.6, evidence: "b" },
      ],
      relationships: [],
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].name).toBe("The Lazarus Group");
  });
});

describe("completeEntityEndpoints", () => {
  it("creates an entity for a relationship endpoint missing from the entity list", () => {
    const completed = completeEntityEndpoints({
      entities: [{ type: "threat-actor", name: "Midnight Blizzard", confidence: 1, evidence: "actor" }],
      relationships: [{ source: "Midnight Blizzard", target: "cozybear.example.com", type: "communicates-with", confidence: 1, evidence: "communicating with the domain" }],
    });
    const domain = completed.entities.find((entity) => entity.name === "cozybear.example.com");
    expect(domain).toBeDefined();
    expect(domain?.type).toBe("indicator");
    expect(domain?.confidence).toBe(0.5);
  });

  it("retypes an entity that the model misclassified as an indicator shape", () => {
    const completed = completeEntityEndpoints({
      entities: [
        { type: "tool", name: "/opt/blockchain/app", confidence: 1, evidence: "used the file path" },
        { type: "malware", name: "198.51.100.7", confidence: 1, evidence: "server" },
      ],
      relationships: [],
    });
    expect(completed.entities.find((entity) => entity.name === "/opt/blockchain/app")?.type).toBe("file-path");
    expect(completed.entities.find((entity) => entity.name === "198.51.100.7")?.type).toBe("indicator");
  });

  it("leaves names that are not indicator shapes untouched", () => {
    const completed = completeEntityEndpoints({
      entities: [{ type: "tool", name: "Cobalt Strike", confidence: 1, evidence: "tool" }],
      relationships: [],
    });
    expect(completed.entities[0].type).toBe("tool");
  });

  it("does not duplicate an endpoint referenced by multiple relationships", () => {
    const completed = completeEntityEndpoints({
      entities: [],
      relationships: [
        { source: "X", target: "198.51.100.7", type: "communicates-with", confidence: 1, evidence: "a" },
        { source: "Y", target: "198.51.100.7", type: "communicates-with", confidence: 1, evidence: "b" },
      ],
    });
    const ips = completed.entities.filter((entity) => entity.name === "198.51.100.7");
    expect(ips).toHaveLength(1);
    expect(completed.entities).toHaveLength(3);
  });

  it("leaves entities that already exist untouched", () => {
    const completed = completeEntityEndpoints({
      entities: [{ type: "indicator", name: "evil.example.com", confidence: 0.9, evidence: "domain" }],
      relationships: [{ source: "evil.example.com", target: "CVE-2023-23397", type: "exploits", confidence: 1, evidence: "e" }],
    });
    const existing = completed.entities.find((entity) => entity.name === "evil.example.com");
    expect(existing?.confidence).toBe(0.9);
    expect(completed.entities).toHaveLength(2);
  });

  it("makes dangling relationships survive graph construction", () => {
    const completed = completeEntityEndpoints({
      entities: [{ type: "threat-actor", name: "Lazarus Group", confidence: 1, evidence: "actor" }],
      relationships: [{ source: "Lazarus Group", target: "/opt/blockchain/app", type: "uses", confidence: 1, evidence: "used the file path" }],
    });
    const graph = buildGraph(completed);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
  });
});

describe("inferEndpointType", () => {
  it("classifies IPs, domains, emails, CVEs, and file paths deterministically", () => {
    expect(inferEndpointType("198.51.100.7")).toBe("indicator");
    expect(inferEndpointType("cozybear.example.com")).toBe("indicator");
    expect(inferEndpointType("analyst@example.com")).toBe("email");
    expect(inferEndpointType("CVE-2023-23397")).toBe("vulnerability");
    expect(inferEndpointType("/opt/blockchain/app")).toBe("file-path");
    expect(inferEndpointType("C:\\temp\\malware.exe")).toBe("file-path");
    expect(inferEndpointType("some unknown name")).toBe("indicator");
  });
});

describe("alias-aware entity resolution", () => {
  it("merges entities whose aliases overlap into one node", () => {
    const graph = buildGraph({
      entities: [
        { type: "threat-actor", name: "Midnight Blizzard", aliases: ["Cozy Bear", "APT29"], confidence: 1, evidence: "a" },
        { type: "threat-actor", name: "APT29", confidence: 0.7, evidence: "b" },
        { type: "malware", name: "SLUI", confidence: 0.9, evidence: "c" },
      ],
      relationships: [{ source: "APT29", target: "SLUI", type: "uses", confidence: 1, evidence: "uses SLUI" }],
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    const merged = graph.nodes.find((node) => node.type === "threat-actor");
    expect(merged?.name).toBe("Midnight Blizzard");
  });

  it("does not merge entities of different types even when names overlap", () => {
    const graph = buildGraph({
      entities: [
        { type: "threat-actor", name: "SLUI", confidence: 0.9, evidence: "a" },
        { type: "malware", name: "SLUI", confidence: 0.9, evidence: "b" },
      ],
      relationships: [],
    });
    expect(graph.nodes).toHaveLength(2);
  });

  it("keeps the highest-confidence entity as canonical within a merged group", () => {
    const graph = buildGraph({
      entities: [
        { type: "threat-actor", name: "Lazarus Group", aliases: ["AppleJeus Group"], confidence: 0.6, evidence: "a" },
        { type: "threat-actor", name: "Lazarus Group", confidence: 0.95, evidence: "b" },
      ],
      relationships: [],
    });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].confidence).toBe(0.95);
  });
});

