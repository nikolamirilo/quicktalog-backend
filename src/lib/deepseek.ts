import OpenAI from "openai";

export async function chatCompletion(
  prompt: string,
  apiKey: string,
  model?: string,
  timeout: number = 60000
) {
  const openai = new OpenAI({
    baseURL: "https://api.deepseek.com",
    apiKey: apiKey,
    timeout: timeout,
  });

  const completion = await openai.chat.completions.create({
    messages: [{ role: "system", content: prompt }],
    model: model || "deepseek-chat",
  });

  return completion.choices[0].message.content;
}
