import { CatalogueCategory } from '@quicktalog/common';
import { GenerationRequest } from 'src/types';

export const extractJSONFromResponse = (response: string) => {
  const cleanedText = response
    .replace(/```json/g, '')
    .replace(/```/g, '')
    .trim();

  const jsonStart = cleanedText.indexOf('{');
  const jsonEnd = cleanedText.lastIndexOf('}');

  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error('No JSON object found in response');
  }

  const jsonString = cleanedText.substring(jsonStart, jsonEnd + 1);
  const parsedData = JSON.parse(jsonString);

  if (!parsedData.services || !Array.isArray(parsedData.services)) {
    throw new Error('Invalid services structure in response');
  }

  return parsedData;
};

export const insertCatalogueData = async (
  supabase: any,
  formData: GenerationRequest['formData'],
  services: CatalogueCategory[],
  userId: string,
  slug: string,
  source: string,
) => {
  const catalogueData = {
    name: slug,
    status: 'active' as const,
    title: formData.title,
    currency: formData.currency,
    theme: formData.theme,
    subtitle: formData.subtitle,
    created_by: userId,
    logo: '',
    legal: {},
    partners: [],
    configuration: {},
    contact: [],
    services: services,
    source,
  };

  const { error } = await supabase
    .from('catalogues')
    .insert([catalogueData])
    .select();

  if (error) {
    throw new Error(`Failed to insert catalogue: ${error.message}`);
  }
  return slug;
};

export const baseCategorySchema = {
  name: 'Name of category (e.g. Lunch, Breakfast, Welness, Mobile Phones, Laptops, etc.)',
  layout: 'variant_1 | variant_2 | variant_3 | variant_4',
  order: 1,
  items: [
    {
      name: 'Item Name',
      description: 'Description of Item',
      price: 12,
      image: 'image url',
    },
  ],
};

export const baseSchema = {
  services: [baseCategorySchema],
};
