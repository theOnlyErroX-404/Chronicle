import { ChronicleError } from "@/modules/shared/errors";

// Stream a body with a running byte counter instead of buffering it unboundedly
// first: an oversized body is rejected at the byte that crosses the cap, so
// memory stays bounded. Used for both request bodies (JSON + multipart uploads)
// and fetched report bodies.
export const readStreamWithLimit = async (
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  message: string,
): Promise<Uint8Array<ArrayBuffer>> => {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks: Uint8Array<ArrayBufferLike>[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ChronicleError(message, 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};
