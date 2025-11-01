import { SupabaseClient } from "@supabase/supabase-js";

export async function revalidateData(app_url: string) {
  await fetch(`${app_url}/api/revalidate`);
}
export async function createInitialCatalogue(
  database: SupabaseClient,
  slug: string,
  formData: any,
  source: string,
  userId: string
) {
  try {
    const catalogueData = {
      name: slug || formData.name,
      status: "in preparation",
      title: formData.title,
      currency: formData.currency,
      theme: formData.theme,
      subtitle: formData.subtitle,
      created_by: userId,
      logo: "",
      legal: {},
      partners: [],
      configuration: {},
      contact: [],
      services: [],
      source: source,
    };

    const { error } = await database.from("catalogues").insert([catalogueData]);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Error creating initial catalogue:", error);
    return false;
  }
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
