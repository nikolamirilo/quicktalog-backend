import { CatalogueCategory, layouts } from "@quicktalog/common";
import { Env, GenerationRequest } from "../types";
import { parseImageResult } from "../helpers";
import {
  DEEPSEEK_BASE_URL,
  FALLBACK_IMAGE_URL,
  UNSPLASH_BASE_URL,
} from "../constants";

export const insertCatalogueData = async (
  supabase: any,
  formData: GenerationRequest["formData"],
  services: CatalogueCategory[],
  userId: string,
  slug: string,
  source: "ai_prompt" | "ocr_import" | "builder"
) => {
  const catalogueData = {
    name: slug,
    status: "active" as const,
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
    services: services,
    source,
  };

  const { error } = await supabase
    .from("catalogues")
    .insert([catalogueData])
    .select();

  if (error) {
    throw new Error(`Failed to insert catalogue: ${error.message}`);
  }
  return slug;
};

export const baseCategorySchema = {
  name: "Name of category (e.g. Lunch, Breakfast, Welness, Mobile Phones, Laptops, etc.)",
  layout: "variant_1 | variant_2 | variant_3 | variant_4",
  order: 1,
  items: [
    {
      name: "Item Name",
      description: "Description of Item",
      price: 12,
      image: "image url",
    },
  ],
};

export const baseSchema = {
  services: [baseCategorySchema],
};

async function searchUnsplash(
  query: string,
  access_key: string
): Promise<string | null> {
  try {
    const response = await fetch(
      `${UNSPLASH_BASE_URL}/search/photos?page=1&per_page=1&query=${encodeURIComponent(
        query
      )}`,
      {
        headers: {
          Authorization: `Client-ID ${access_key}`,
        },
      }
    );

    if (!response.ok) {
      console.warn(
        `Unsplash API returned ${response.status} for query: "${query}"`
      );
      return null;
    }

    const data: any = await response.json();
    const imageUrl = data?.results?.[0]?.urls?.regular;

    if (imageUrl) {
      console.log(`Found image on Unsplash for "${query}"`);
      return imageUrl;
    }

    return null;
  } catch (error) {
    console.error(`Unsplash API error for "${query}":`, error);
    return null;
  }
}

async function searchWithAI(
  query: string,
  api_key: string
): Promise<string | null> {
  const requestBody = {
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content:
          "You are an expert image researcher. Find high-quality, free images from Unsplash, Pexels, or Pixabay. " +
          'Return ONLY a JSON object with this exact structure: {"url": "direct_image_url", "source": "source_name", "searchTerm": "term_used"}. ' +
          "The URL must be a direct link to the image file. Verify the image is relevant and accessible. " +
          "If searching in a non-English language, translate to English first. Take small size of image. IMPORTANT: If item is named something specific like 'Momofuku Tribute Ribs' search only for ribs. If you are not sure what exactly something is search for name of category, in this case 'meat' or 'stake'.",
      },
      {
        role: "user",
        content: `Find a high-quality image for: "${query}". Return only the JSON object, no explanations.`,
      },
    ],
    stream: false,
  };

  try {
    const response = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api_key}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.warn(`DeepSeek API returned ${response.status}`);
      return null;
    }

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      console.warn("DeepSeek returned empty content");
      return null;
    }

    const result = parseImageResult(content);

    if (result?.url) {
      console.log(
        `Found image via AI from ${
          result.source || "unknown source"
        } for "${query}"`
      );
      return result.url;
    }

    return null;
  } catch (error) {
    console.error(`DeepSeek AI error for "${query}":`, error);
    return null;
  }
}

export const layoutData = layouts.map((l) => ({
  key: l.key,
  description: l.description,
}));

export async function generateImage(query: string, env: Env): Promise<string> {
  if (!query || query.trim().length === 0) {
    console.warn("Empty query provided, using fallback image");
    return FALLBACK_IMAGE_URL;
  }
  const aiUrl = await searchWithAI(query, env.DEEPSEEK_API_KEY);
  if (aiUrl) {
    return `${aiUrl}?auto=compress&cs=tinysrgb&h=350`;
  }
  const unsplashUrl = await searchUnsplash(query, env.UNSPLASH_ACCESS_KEY);
  if (unsplashUrl) {
    return unsplashUrl;
  }

  console.warn(`No image found for "${query}", using fallback image`);
  return FALLBACK_IMAGE_URL;
}
