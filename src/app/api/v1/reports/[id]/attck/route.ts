import { requireApiToken } from '@/modules/shared/auth';
import { ChronicleError, problemResponse } from '@/modules/shared/errors';
import { reportStore } from '@/modules/shared/report-store';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireApiToken(request);
    const report = await reportStore.get((await params).id);
    if (!report)
      throw new ChronicleError(
        'Report not found.',
        404,
        'https://chronicle.local/problems/not-found',
      );
    if (!report.attck)
      throw new ChronicleError(
        'The report ATT&CK mappings are not ready yet.',
        409,
        'https://chronicle.local/problems/not-ready',
      );
    return Response.json(report.attck);
  } catch (error) {
    return problemResponse(error);
  }
}
