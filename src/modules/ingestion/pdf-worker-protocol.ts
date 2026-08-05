export type PdfWorkerInput = { bytes: Uint8Array };
export type PdfWorkerOutput = { kind: 'ok'; text: string } | { kind: 'error'; message: string };
