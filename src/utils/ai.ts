import {
  CatalogueCategory,
  fetchImageFromUnsplash,
  layouts,
} from "@quicktalog/common";
import { baseSchema, layoutData } from ".";
import { GenerationRequest } from "../types";

export function generatePromptForAI(
  inputText: string,
  formData: GenerationRequest["formData"],
  shouldGenerateImages: boolean
) {
  return `
    Role: You are an expert in creating price lists/catalogues (restaurant menus, beauty center service offer, product price list, etc.).
    Based on the following prompt, generate a complete service offer configuration in JSON format.
    The JSON object should strictly follow the type definition from the project.
    
    Prompt: ${inputText}
    
    Schema: ${JSON.stringify(
      baseSchema
    )} - response should be in this format without additional texts (just array of items)

    ${
      shouldGenerateImages == true
        ? `Layouts keys and description of each variant: ${JSON.stringify(
            layoutData
          )}. According to it use different variants for different purpose. For drinks for example use without image.`
        : "For category layout always use value 'variant_3'"
    }

    General information about service catalogue: ${JSON.stringify(formData)}
    
    IMPORTANT REQUIREMENTS:
    1. Return ONLY the JSON object, no additional text, explanations, or formatting
    2. Start your response directly with { and end with }
    3. Catalogue/Price List should be created in the selected language: ${
      formData.language
    }
    4. The services field should be an ARRAY of categories, NOT an object
    5. Add at least 3 categories with at least 5 items each
    6. Name all items in full name of the dish e.g. "Spaghetti Carbonara", "Caesar Salad", "Pizza Margarita" etc.
    7. Ensure the JSON is valid and well-formed
    8. Set order for each category starting from 1. Order items in logical way. They will be displayed in this ascending order.
    9. Wherever you have string it should be valid string. It should not contain any special character like /,-,",' etc."
    `;
}
