import { CatalogueCategory, CategoryItem, layouts } from "@quicktalog/common";
import { Env, GenerationRequest } from "../types";
import {
  extractJSONArrayFromResponse,
  extractJSONObjectFromResponse,
} from "../helpers";
import {
  DEEPSEEK_BASE_URL,
  FALLBACK_IMAGE_URL,
  UNSPLASH_BASE_URL,
} from "../constants";

export const baseCategorySchema = {
  name: "Name of category",
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

export const rules = `
1. Category name must be unique on catalogue level. If there are 2 categories with same name merge them (their items) and remove duplicates.
2. Item name must be unique on catalogue level (no 2 same items allowed).
3. Name of category and item should be logical and make sense. They must be typed in Regular Case format
4. Order property is used to set order of items displayed in the catalogue. Starting value is 0 and next category shiould always have +1 value for order.
`;

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
  categoryItems: CatalogueCategory["items"],
  api_key: string
): Promise<CatalogueCategory["items"] | null> {
  const requestBody = {
    model: "deepseek-chat",
    messages: [
      {
        role: "system",
        content: `You are an expert image researcher. Find high-quality, free images from Unsplash, Pexels, or Pixabay. " +
          'Return ONLY a JSON object with same data as here ${JSON.stringify(
            categoryItems
          )} just with updated image value for each item.' +
          "The URL of images must be a direct link to the image file. Verify the image is relevant and accessible. " +
          "If searching in a non-English language, translate to English first. Take small size of image. IMPORTANT: If item is named something specific like 'Momofuku Tribute Ribs' search only for ribs. If you are not sure what exactly something is search for name of category, in this case 'meat' or 'stake'.`,
      },
      {
        role: "user",
        content: `Find a good quality images for category items: "${JSON.stringify(
          categoryItems
        )}". Return only the JSON object, no explanations. It should contain same data as before with only UPDATED image property for each item, nothing else should be updated. You should return in same structure as input category just with updated images for each item in items. At the end of each image URL if they are from pexels add '?auto=compress&cs=tinysrgb&h=350. DO NOT UPDATE ANYTHING ASIDE FROM IMAGES!!!'`,
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

    const result: CatalogueCategory["items"] =
      extractJSONArrayFromResponse(content);

    if (result) {
      console.log("Updated category items:", categoryItems);
      return result;
    }

    return null;
  } catch (error) {
    console.error(`DeepSeek AI error while generating images":`, error);
    return null;
  }
}

export const layoutData = layouts.map((l) => ({
  key: l.key,
  description: l.description,
}));

export async function generateImage(
  category: CatalogueCategory,
  env: Env
): Promise<CatalogueCategory> {
  if (category.items.length === 0) {
    console.warn("Empty query provided, using fallback image");
    return category;
  }
  const enrichedCategoryDeepseek = await searchWithAI(
    category.items,
    env.DEEPSEEK_API_KEY
  );
  if (enrichedCategoryDeepseek) {
    return { ...category, items: enrichedCategoryDeepseek };
  }

  console.warn(`No image found for "${category.name}", using fallback image`);
  return category;
}
