import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CorrectionInputSchema } from "@/modules/shared/contracts";
import { requireApiToken } from "@/modules/shared/auth";
import { ChronicleError, problemResponse } from "@/modules/shared/errors";
import { reportStore } from "@/modules/shared/report-store";
import { readStreamWithLimit } from "@/modules/shared/stream";

export const runtime = "nodejs";

// A correction is a few small fields; 64KB is far beyond any legitimate payload
// while keeping the body bounded at the trust boundary.
const MAX_FEEDBACK_BODY_BYTES = 64 * 1024;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireApiToken(request);
    const id = (await params).id;
    const report = await reportStore.get(id);
    if (!report) throw new ChronicleError("Report not found.", 404, "https://chronicle.local/problems/not-found");
    if (!report.graph) throw new ChronicleError("The report is not ready for review yet.", 409, "https://chronicle.local/problems/not-ready");

    const rawBody = await readStreamWithLimit(request.body, MAX_FEEDBACK_BODY_BYTES, "The request body exceeds the configured size limit.");
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      throw new ChronicleError("The request body must be valid JSON.", 400);
    }
    const parsed = CorrectionInputSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ChronicleError(issue?.message ?? "Invalid correction.", 400);
    }
    const input = parsed.data;

    // Feedback targets graph entities/relationships by id: reject corrections
    // whose target does not exist, so stored feedback never points at nothing.
    // (Mapping targets arrive with 2-D; the graph does not know them yet.)
    const exists =
      input.targetType === "mapping" ||
      (input.targetType === "entity" ? report.graph.nodes.some((node) => node.id === input.targetId) : report.graph.edges.some((edge) => edge.id === input.targetId));
    if (!exists) throw new ChronicleError("The correction target does not exist in this report.", 422, "https://chronicle.local/problems/invalid-target");

    const correction = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    const updated = await reportStore.update(id, { feedback: [...(report.feedback ?? []), correction] });
    return Response.json({ feedback: updated.feedback ?? [], count: updated.feedback?.length ?? 0 });
  } catch (error) {
    return problemResponse(error);
  }
}
