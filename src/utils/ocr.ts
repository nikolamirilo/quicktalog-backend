import { baseCategorySchema, layoutData } from ".";

export function generatePromptForCategoryDetection(ocrText: string): string {
  return `
    Role: You are an expert in analyzing digital catalogs, menus and price lists to identify categories.
    Your task is to analyze the provided OCR text and split it into logical category chunks.
    
    OCR Text: ${ocrText}
    
    IMPORTANT REQUIREMENTS:
    1. Return ONLY a JSON object with this structure: { "chunks": ["chunk1", "chunk2", ...] }
    2. Each chunk should contain all text related to one category (including the category name)
    3. Identify product/service categories like: breakfast, lunch, dinner, drinks, appetizers, desserts, wellness services, beauty treatments, laptops, mobile phones, etc. CATEGORY NAME MUST BE UNIQUE IN CATALOGUE!!! It is not allowed to have 2 categories with same name!!
    4. If no clear categories are found, group similar items together logically
    5. Each chunk should be a complete text section that includes:
       - The category name/title
       - All items belonging to that category
       - Any descriptions or prices for those items
    6. Do not modify the original text content, just split it appropriately
    7. Return ONLY the JSON object, no additional text or formatting
    8. Start your response directly with { and end with }
    9. Category name must be unique per catalogue!!!. Merge multiple categories if they are named the same and if make sense.
    10. Create new category chunk if it makes sense to have new category depending on the input data
    11. Remove from input data information which is not related to services/products (address, legal info, description of fascility, links, etc.)
    
    Example output format:
    {
      "chunks": [
        "BREAKFAST\nScrambled Eggs 8.50\nPancakes with syrup 12.00\nFresh fruit bowl 9.00",
        "LUNCH\nCaesar Salad 14.00\nGrilled Chicken Sandwich 16.50\nTomato Soup 8.00",
        "DRINKS\nCoffee 3.50\nOrange Juice 4.00\nSparkling Water 2.50"
      ]
    }
  `;
}

export function generatePromptForCategoryProcessing(
  categoryChunk: string,
  formData: any,
  order: number,
  shouldGenerateImages: boolean
): string {
  return `
    Role: You are an expert in creating service category configurations.
    Based on the provided category text chunk, generate a single category object in JSON format.
    
    Category Text Chunk: ${categoryChunk}
    
    Schema for single category: ${JSON.stringify(baseCategorySchema)}
    
    General information about service catalogue: ${JSON.stringify(formData)}

    ${
      shouldGenerateImages == true
        ? `Layouts keys and description of each variant: ${JSON.stringify(
            layoutData
          )}. According to it use different variants for different purpose. For drinks for example use without image.`
        : "For category layout always use value 'variant_3'"
    }
    
    IMPORTANT REQUIREMENTS:
    0. If category name/item name/item description contain some strange words (e.g. "Jelapogodnazavoganje") correct them to what makes sense (e.g. "Jela pogodna za vegetarijance"). So make corrections in text to be correct on semantic and grammar side and to be clear for customer.
    1. Return ONLY the JSON object for ONE category, no additional text or formatting
    2. Start your response directly with { and end with }
    3. Extract the category name from the text chunk
    4. Item name must be unique. If you have items with same name then return only one of them, not both.
    5. Set order to ${order}
    6. Create items array with all items found in this category chunk
    7. If prices are missing, estimate reasonable prices based on currency: ${
      formData.currency
    }
    8. Service should be created in the language and alphabet of the text
    9. Ensure all strings are properly escaped and contain no special characters like /,-,",' that could break JSON
    10. Item names should be full descriptive names
    11. Provide meaningful descriptions for items when possible
    12. Set image field as empty string for all items
    
    Example output:
    {
      "name": "Breakfast",
      "layout": "variant_3",
      "order": ${order},
      "items": [
        {
          "name": "Scrambled Eggs",
          "description": "Fresh scrambled eggs served with toast",
          "price": 8.50,
          "image": ""
        }
      ]
    }
  `;
}
export function generateOrderPrompt(items, formData: any): string {
  return `You are an expert in organizing service or menu categories to optimize the customer browsing experience.

**Task**: Reorder and, if necessary, rename the categories in the provided items array to create a logical, intuitive flow for customers browsing a ${
    formData.title || "catalogue"
  }.

**Input Categories**: ${JSON.stringify(items.map((category) => category.name))}

**Ordering Guidelines**:
1. **Logical Progression**: Arrange categories in a natural sequence (e.g., appetizers → mains → desserts, or morning → afternoon → evening).
2. **Customer Journey**: Prioritize how customers typically browse and make selections.
3. **Closing Categories**: Place beverages, desserts, add-ons, or supplementary items at the end.

**Context-Specific Rules**:
- **Restaurants**: Appetizers → Soups/Salads → Main Courses → Desserts → Beverages
- **Cafés**: Coffee/Tea → Breakfast → Lunch → Snacks → Desserts
- **Beauty/Wellness**: Basic Services → Premium Treatments → Packages → Add-ons
- **General Catalogue**: Core Items → Specialized Items → Extras/Add-ons

**Requirements**:
1. Return a valid JSON array containing only category names (strings).
2. Match the input array length (${items.length} categories).
3. Preserve exact spelling of input category names unless renaming is needed.
4. Ensure category names:
   - Are in ${
     formData.language || "English"
   } with consistent capitalization (e.g., First letter capitalized, rest lowercase).
   - Are clear, unique, and self-explanatory.
   - Contain no special characters (e.g., /, -, ", ').
   - Are semantically and grammatically appropriate for the catalogue context.
5. Ensure items names:
	- Are descriptive and clear
	- Contain no special characters (e.g., /, -, ", ')
	- Are semantically and grammatically correct
	- Are unique within the category
**Output Format Example**:
["Breakfast", "Lunch", "Dinner", "Desserts", "Beverages"]`;
}
