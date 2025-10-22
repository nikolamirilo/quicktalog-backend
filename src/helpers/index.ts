import { ImageSearchResult } from "../types";

export function parseImageResult(content: string): ImageSearchResult | null {
  try {
    const cleaned = content.replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    const url =
      parsed.url || parsed.image_url || parsed.imageUrl || parsed.link;

    if (url && typeof url === "string" && url.startsWith("http")) {
      return {
        url,
        source: parsed.source || "unknown",
        searchTerm: parsed.searchTerm || parsed.search_term,
      };
    }
  } catch {
    const urlMatch = content.match(
      /https?:\/\/[^\s"'<>]+\.(jpg|jpeg|png|webp|gif)/i
    );
    if (urlMatch) {
      return {
        url: urlMatch[0],
        source: "extracted",
      };
    }
  }

  return null;
}

export const extractJSONObjectFromResponse = (response: string) => {
  const cleanedText = response
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const jsonStart = cleanedText.indexOf("{");
  const jsonEnd = cleanedText.lastIndexOf("}");

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("No JSON object found in response");
  }

  const jsonString = cleanedText.substring(jsonStart, jsonEnd + 1);
  return JSON.parse(jsonString);
};

export const extractJSONArrayFromResponse = (response: string) => {
  const cleanedText = response
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const jsonStart = cleanedText.indexOf("[");
  const jsonEnd = cleanedText.lastIndexOf("]");

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error("No JSON array found in response");
  }

  const jsonString = cleanedText.substring(jsonStart, jsonEnd + 1);
  const parsedData = JSON.parse(jsonString);

  if (!Array.isArray(parsedData)) {
    throw new Error("Response is not an array");
  }

  return parsedData;
};

export const extractJSONFromResponse = <T = any>(
  response: string,
  type: "array" | "object" = "object"
): T => {
  const cleanedText = response
    .replace(/```json/g, "")
    .replace(/```/g, "")
    .trim();

  const startChar = type === "array" ? "[" : "{";
  const endChar = type === "array" ? "]" : "}";

  const jsonStart = cleanedText.indexOf(startChar);
  const jsonEnd = cleanedText.lastIndexOf(endChar);

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`No JSON ${type} found in response`);
  }

  const jsonString = cleanedText.substring(jsonStart, jsonEnd + 1);
  const parsedData = JSON.parse(jsonString);

  if (type === "array" && !Array.isArray(parsedData)) {
    throw new Error("Response is not an array");
  }

  return parsedData as T;
};
