/* eslint-disable no-console -- a command-line check; printing is its output */
/**
 * Talks to the real provider with the key in .env: one plain reply, one tool
 * round trip, one embedding. Not part of CI (it costs tokens and needs a key);
 * run it after changing the provider adapter or the model names.
 *
 *   npx tsx scripts/ai-smoke.ts
 */
import 'dotenv/config';
import type { AiMessage } from '../src/modules/ai/ai.types.js';
import { GeminiProvider } from '../src/modules/ai/gemini.provider.js';

const provider = new GeminiProvider({
  apiKey: process.env.GEMINI_API_KEY,
  chatModel: process.env.AI_CHAT_MODEL ?? 'gemini-3.8-flash',
  embeddingModel: process.env.AI_EMBEDDING_MODEL ?? 'gemini-embedding-2',
});
const signal = AbortSignal.timeout(60_000);

const plain = await provider.generate(
  { messages: [{ role: 'user', parts: [{ kind: 'text', text: 'Reply with exactly: ready' }] }] },
  signal,
);
console.log('plain:', JSON.stringify(plain.text), plain.usage, plain.model);

const tools = [
  {
    name: 'lookup_order',
    description: 'Look up an order by its number.',
    parameters: {
      type: 'object',
      properties: { number: { type: 'string', description: 'Order number without #' } },
      required: ['number'],
    },
  },
];
const messages: AiMessage[] = [
  { role: 'user', parts: [{ kind: 'text', text: 'Where is my order #10482?' }] },
];
const first = await provider.generate(
  { system: 'You are a support assistant. Use tools for order questions.', messages, tools },
  signal,
);
console.log(
  'tool calls:',
  first.toolCalls.map((c) => [c.name, c.args, Boolean(c.signature)]),
);
messages.push(first.message, {
  role: 'user',
  parts: first.toolCalls.map((c) => ({
    kind: 'toolResult' as const,
    id: c.id,
    name: c.name,
    result: { status: 'shipped', carrier: 'UPS', eta: 'tomorrow' },
  })),
});
const second = await provider.generate({ messages, tools }, signal);
console.log('after tool:', JSON.stringify(second.text));

const [vector] = await provider.embed(['black hoodie, size M'], 'document', signal);
console.log('embedding:', vector?.length, 'norm', Math.hypot(...(vector ?? [])).toFixed(4));
