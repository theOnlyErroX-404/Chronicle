import { ChronicleError } from "@/modules/shared/errors";

export const normalizeText = (source: string) =>
  source
    // CodeQL js/bad-tag-filter: browsers accept end tags like </script > and
    // </script foo="bar"> (parser errors they still honor), so end tags are matched
    // with \b[^>]*> like open tags. This strips the tag blocks before the generic
    // tag removal below.
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\b[^>]*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\b[^>]*>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();

export const ensureUsableText = (text: string) => {
  if (text.length < 100) {
    throw new ChronicleError("The report did not contain enough extractable text.", 422, "https://chronicle.local/problems/insufficient-text");
  }
  return text;
};
