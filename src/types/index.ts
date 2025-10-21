import { Theme } from "@quicktalog/common";
import type { Context } from "hono";
import z from "zod";

export const GenerationRequestSchema = z.object({
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

export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

export type Env = {
  DEEPSEEK_API_KEY: string;
};

export type AppContext = Context<{ Bindings: Env }>;
