import { CatalogueCategory, CategoryItem, Theme } from "@quicktalog/common";
import type { Context } from "hono";
import z from "zod";
import { optional } from "zod/v4";

export const AIGenerationRequestSchema = z.object({
  formData: z.object({
    name: z.string(),
    language: z.string(),
    theme: z.custom<Theme>(),
    currency: z.string(),
    title: z.string(),
    subtitle: z.string(),
  }),
  prompt: z.string(),
  userId: z.string(),
  shouldGenerateImages: z.boolean(),
});
export const OCRImportRequestSchema = z.object({
  formData: z.object({
    name: z.string(),
    language: z.string(),
    theme: z.custom<Theme>(),
    currency: z.string(),
    title: z.string(),
    subtitle: z.string(),
  }),
  input_text: z.string(),
  userId: z.string(),
  shouldGenerateImages: z.boolean().optional(),
});

export type BasicResponse = {
  result: CatalogueCategory[];
  success: boolean;
};

export type GenerationRequest = z.infer<typeof AIGenerationRequestSchema>;

export type Env = {
  DEEPSEEK_API_KEY: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_URL: string;
  UNSPLASH_ACCESS_KEY: string;
  APP_URL: string;
  POSTHOG_HOST: string;
  POSTHOG_API_KEY: string;
  POSTHOG_PROJECT_ID: string;
  MYBROWSER: Fetcher;
  database: D1Database;
  ENVIRONMENT: "test" | "prod";
};

export type AppContext = Context<{ Bindings: Env }>;

export type ImageSearchResult = {
  url: string;
  source: string;
  searchTerm?: string;
};
