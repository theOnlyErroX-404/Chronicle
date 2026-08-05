export class ChronicleError extends Error {
  constructor(
    message: string,
    public readonly status: number = 400,
    public readonly type: string = 'https://chronicle.local/problems/validation-error',
  ) {
    super(message);
    this.name = 'ChronicleError';
  }
}

export const problemResponse = (error: unknown) => {
  const known = error instanceof ChronicleError;
  const status = known ? error.status : 500;
  const detail = known ? error.message : 'An unexpected server error occurred.';
  const type = known ? error.type : 'https://chronicle.local/problems/internal-error';

  return Response.json(
    { type, title: status >= 500 ? 'Internal Server Error' : 'Request rejected', status, detail },
    { status, headers: { 'content-type': 'application/problem+json' } },
  );
};
