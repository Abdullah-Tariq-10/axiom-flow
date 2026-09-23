import OpenAI from "openai";
import type { Decision, TokenUsage } from "./types";

let _client: OpenAI | null = null;
function getClient() {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    });
  }
  return _client;
}

const MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

const DECISION_SYSTEM_PROMPT = [
  "You are a strict binary decision engine inside an automated workflow.",
  "Read the question and answer with exactly one word: YES or NO.",
  "No punctuation, no explanation, no other words — only YES or NO.",
].join(" ");

function parseDecision(raw: string): Decision | null {
  const cleaned = raw.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (cleaned === "YES" || cleaned.startsWith("YES")) return "YES";
  if (cleaned === "NO" || cleaned.startsWith("NO")) return "NO";
  return null;
}

function extractUsage(completion: OpenAI.Chat.Completions.ChatCompletion): TokenUsage {
  if (!completion.usage) {
    return { promptTokens: null, completionTokens: null, totalTokens: null };
  }
  return {
    promptTokens: completion.usage.prompt_tokens ?? null,
    completionTokens: completion.usage.completion_tokens ?? null,
    totalTokens: completion.usage.total_tokens ?? null,
  };
}

export async function classifyPrompt(prompt: string): Promise<{
  decision: Decision;
  raw: string;
  usage: TokenUsage;
}> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await getClient().chat.completions.create({
      model: MODEL,
      temperature: 0,
      max_tokens: 5,
      messages: [
        { role: "system", content: DECISION_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            attempt === 0
              ? prompt
              : `${prompt}\n\nReply with ONLY the single word YES or NO.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const decision = parseDecision(raw);
    const usage = extractUsage(completion);
    if (decision) return { decision, raw, usage };
  }

  throw new Error(
    `Model did not return a valid YES/NO decision for prompt: "${prompt}"`
  );
}

const ACTION_SYSTEM_PROMPT =
  "You are an assistant that carries out a single instruction inside an " +
  "automated workflow and produces the requested text output. Be concise " +
  "and direct — output only the requested content, no preamble like " +
  '"Here is...".';

export async function generateActionText(
  instruction: string
): Promise<{ output: string; usage: TokenUsage }> {
  const completion = await getClient().chat.completions.create({
    model: MODEL,
    temperature: 0.4,
    max_tokens: 400,
    messages: [
      { role: "system", content: ACTION_SYSTEM_PROMPT },
      { role: "user", content: instruction },
    ],
  });

  return {
    output: completion.choices[0]?.message?.content?.trim() ?? "",
    usage: extractUsage(completion),
  };
}