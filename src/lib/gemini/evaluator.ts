import { getGeminiApiKey } from '@/lib/gemini/key-store';
/**
 * Server-only. GEMINI_API_KEY must never reach the browser — this file
 * must only be imported from route handlers / server-side workers.
 */

export interface EvalInput {
  problem: string;
  instructions: string | null;
  constraintsText: string | null;
  prompt: string;
  aiOutput: string;
}

export interface EvalResult {
  prompt_clarity: number;
  context: number;
  specificity: number;
  creativity: number;
  constraint_handling: number;
  total: number;
  originality_score: number;
  plagiarism_flag: boolean;
  flags: string[];
  summary: string;
}

const SYSTEM_INSTRUCTION = `You are an impartial evaluator for a college prompt-engineering competition.
Score the participant's PROMPT (not the AI output alone) against the given problem.
Score five criteria from 0-10 each: prompt_clarity, context, specificity, creativity, constraint_handling.
total = sum of the five (0-50).

Also assess originality separately:
- originality_score (0-10): how much the prompt reflects the participant's own phrasing and approach,
  as opposed to being copied or lightly reworded from the problem statement, a generic template, or
  obviously boilerplate phrasing you'd expect to see reused across many unrelated submissions.
- plagiarism_flag (boolean): true only if the prompt is substantially copied verbatim (or near-verbatim,
  changing only a few words) from the problem statement/instructions/constraints text given to you below.
  This is a narrow, high-confidence check against the ONE problem you were given — you are not comparing
  against other participants' submissions, which you don't have access to.

Return ONLY a single JSON object matching this exact schema, no markdown fences, no commentary:
{"prompt_clarity":number,"context":number,"specificity":number,"creativity":number,"constraint_handling":number,"total":number,"originality_score":number,"plagiarism_flag":boolean,"flags":string[],"summary":string}
"flags" should list any other integrity concerns (e.g. "output does not match prompt"), or be an empty array.
"summary" must be under 40 words. Do not include chain-of-thought or step-by-step reasoning — only the final scores and a short summary.`;

export class GeminiRateLimitError extends Error {}
export class GeminiTransientError extends Error {}

export async function evaluateSubmission(input: EvalInput): Promise<EvalResult> {
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('Missing Gemini API key. Configure it in Admin → AI Judging, or set GEMINI_API_KEY in the deployment environment.');

  const userPrompt = [
    `PROBLEM STATEMENT:\n${input.problem}`,
    input.instructions ? `INSTRUCTIONS:\n${input.instructions}` : '',
    input.constraintsText ? `CONSTRAINTS:\n${input.constraintsText}` : '',
    `PARTICIPANT PROMPT:\n${input.prompt}`,
    `PARTICIPANT AI OUTPUT:\n${input.aiOutput}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (res.status === 429) throw new GeminiRateLimitError('Gemini rate limited');
  if (res.status >= 500) throw new GeminiTransientError(`Gemini server error ${res.status}`);
  if (!res.ok) throw new Error(`Gemini request failed: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no content');

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini response was not valid JSON');
  }

  // Clamp defensively — never trust the model to respect the schema perfectly.
  const clamp = (n: unknown) => Math.max(0, Math.min(10, Number(n) || 0));
  const scored: EvalResult = {
    prompt_clarity: clamp(parsed.prompt_clarity),
    context: clamp(parsed.context),
    specificity: clamp(parsed.specificity),
    creativity: clamp(parsed.creativity),
    constraint_handling: clamp(parsed.constraint_handling),
    total: 0,
    originality_score: clamp(parsed.originality_score),
    plagiarism_flag: Boolean(parsed.plagiarism_flag),
    flags: Array.isArray(parsed.flags) ? parsed.flags.slice(0, 10) : [],
    summary: typeof parsed.summary === 'string' ? parsed.summary.slice(0, 400) : '',
  };
  scored.total =
    scored.prompt_clarity +
    scored.context +
    scored.specificity +
    scored.creativity +
    scored.constraint_handling;

  return scored;
}
