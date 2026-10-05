import {
  ApiError,
  type Content,
  FinishReason as GeminiFinishReason,
  type GenerateContentResponse,
  GoogleGenAI,
  type Part,
  ThinkingLevel,
} from '@google/genai';
import { AiError } from './ai.errors.js';
import {
  type AiMessage,
  type AiPart,
  type AiProvider,
  EMBEDDING_DIMENSIONS,
  type EmbeddingPurpose,
  type FinishReason,
  type GenerateRequest,
  type GenerateResult,
} from './ai.types.js';

// The Gemini API caps a single embedContent call.
const EMBED_BATCH = 100;

export interface GeminiOptions {
  apiKey: string | undefined;
  chatModel: string;
  embeddingModel: string;
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  readonly configured: boolean;
  readonly chatModel: string;
  readonly embeddingModel: string;
  private readonly client: GoogleGenAI | null;

  constructor(options: GeminiOptions) {
    this.configured = Boolean(options.apiKey);
    this.chatModel = options.chatModel;
    this.embeddingModel = options.embeddingModel;
    this.client = options.apiKey ? new GoogleGenAI({ apiKey: options.apiKey }) : null;
  }

  async generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResult> {
    const client = this.requireClient();
    const response = await call(() =>
      client.models.generateContent({
        model: this.chatModel,
        contents: toContents(request.messages),
        config: {
          abortSignal: signal,
          systemInstruction: request.system,
          temperature: request.temperature,
          maxOutputTokens: request.maxOutputTokens,
          // Support replies need speed more than deep reasoning.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          ...(request.tools?.length && {
            tools: [
              {
                functionDeclarations: request.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parametersJsonSchema: t.parameters,
                })),
              },
            ],
          }),
          ...(request.responseSchema && {
            responseMimeType: 'application/json',
            responseJsonSchema: request.responseSchema,
          }),
        },
      }),
    );
    return fromResponse(response, this.chatModel);
  }

  async embed(texts: string[], purpose: EmbeddingPurpose, signal: AbortSignal) {
    const client = this.requireClient();
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH);
      const response = await call(() =>
        client.models.embedContent({
          model: this.embeddingModel,
          // One Content per text. A plain string array is read by gemini-embedding-2
          // as the parts of a single input and comes back as one embedding.
          contents: batch.map((text) => ({ parts: [{ text }] })),
          config: {
            abortSignal: signal,
            taskType: purpose === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
            outputDimensionality: EMBEDDING_DIMENSIONS,
          },
        }),
      );
      const embeddings = response.embeddings ?? [];
      if (embeddings.length !== batch.length) {
        throw new AiError(
          'AI_UNAVAILABLE',
          `expected ${batch.length} embeddings, got ${embeddings.length}`,
        );
      }
      for (const e of embeddings) vectors.push(normalize(e.values ?? []));
    }
    return vectors;
  }

  private requireClient(): GoogleGenAI {
    if (!this.client) throw new AiError('AI_NOT_CONFIGURED');
    return this.client;
  }
}

export function toContents(messages: AiMessage[]): Content[] {
  return messages.map((m) => ({ role: m.role, parts: m.parts.map(toPart) }));
}

function toPart(part: AiPart): Part {
  switch (part.kind) {
    case 'text':
      return { text: part.text, thoughtSignature: part.signature };
    case 'toolCall':
      return {
        functionCall: { id: part.id, name: part.name, args: part.args },
        thoughtSignature: part.signature,
      };
    case 'toolResult':
      return { functionResponse: { id: part.id, name: part.name, response: part.result } };
  }
}

export function fromResponse(response: GenerateContentResponse, model: string): GenerateResult {
  const candidate = response.candidates?.[0];
  const parts: AiPart[] = [];
  for (const p of candidate?.content?.parts ?? []) {
    // Thought summaries are the model's scratchpad, not part of the reply.
    if (p.thought) continue;
    if (p.functionCall?.name) {
      parts.push({
        kind: 'toolCall',
        id: p.functionCall.id,
        name: p.functionCall.name,
        args: p.functionCall.args ?? {},
        signature: p.thoughtSignature,
      });
    } else if (typeof p.text === 'string') {
      parts.push({ kind: 'text', text: p.text, signature: p.thoughtSignature });
    }
  }

  const usage = response.usageMetadata;
  return {
    message: { role: 'model', parts },
    text: parts
      .filter((p) => p.kind === 'text')
      .map((p) => p.text)
      .join('')
      .trim(),
    toolCalls: parts.filter((p) => p.kind === 'toolCall'),
    finishReason: response.promptFeedback?.blockReason
      ? 'blocked'
      : mapFinishReason(candidate?.finishReason),
    usage: {
      inputTokens: usage?.promptTokenCount ?? 0,
      // Thinking tokens are billed as output.
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    },
    model: response.modelVersion ?? model,
  };
}

function mapFinishReason(reason: GeminiFinishReason | undefined): FinishReason {
  switch (reason) {
    case GeminiFinishReason.STOP:
    case undefined:
      return 'stop';
    case GeminiFinishReason.MAX_TOKENS:
      return 'length';
    case GeminiFinishReason.SAFETY:
    case GeminiFinishReason.PROHIBITED_CONTENT:
    case GeminiFinishReason.BLOCKLIST:
    case GeminiFinishReason.SPII:
    case GeminiFinishReason.RECITATION:
      return 'blocked';
    default:
      return 'other';
  }
}

/** Truncated embeddings are not unit length; cosine distance assumes they are. */
function normalize(vector: number[]): number[] {
  const length = Math.hypot(...vector);
  return length === 0 ? vector : vector.map((v) => v / length);
}

async function call<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw toAiError(err);
  }
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  if (err instanceof ApiError) {
    if (err.status === 429) return new AiError('AI_RATE_LIMITED', err.message);
    if (err.status >= 500) return new AiError('AI_UNAVAILABLE', err.message);
    return new AiError('AI_BAD_REQUEST', `${err.status} ${err.message}`);
  }
  if (err instanceof Error && err.name === 'AbortError') return new AiError('AI_TIMEOUT');
  return new AiError('AI_UNAVAILABLE', err instanceof Error ? err.message : String(err));
}
