import { describe, expect, it } from "vitest";
import { buildGraph } from "@/modules/knowledge-modeling";

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
});
