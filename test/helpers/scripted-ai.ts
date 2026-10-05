import { AiError, type AiErrorCode } from '../../src/modules/ai/ai.errors.js';
import {
  type AiProvider,
  EMBEDDING_DIMENSIONS,
  type EmbeddingPurpose,
  type GenerateRequest,
  type GenerateResult,
} from '../../src/modules/ai/ai.types.js';

type Step = { reply: string; usage?: [number, number] } | { fail: AiErrorCode };

/**
 * Stands in for the model in e2e tests: answers from a script, records what
 * it was asked. Tests never reach a real provider, so they need no key and
 * cost nothing.
 */
export class ScriptedAiProvider implements AiProvider {
  readonly name = 'scripted';
  readonly chatModel = 'scripted-chat';
  readonly embeddingModel = 'scripted-embed';
  configured = true;
  readonly requests: GenerateRequest[] = [];
  private steps: Step[] = [];

  script(...steps: Step[]): void {
    this.steps = steps;
  }

  generate(request: GenerateRequest): Promise<GenerateResult> {
    this.requests.push(request);
    const step = this.steps.shift() ?? { reply: 'ok' };
    if ('fail' in step) return Promise.reject(new AiError(step.fail, 'scripted failure'));
    const [inputTokens, outputTokens] = step.usage ?? [10, 2];
    return Promise.resolve({
      message: { role: 'model', parts: [{ kind: 'text', text: step.reply }] },
      text: step.reply,
      toolCalls: [],
      finishReason: 'stop',
      usage: { inputTokens, outputTokens },
      model: this.chatModel,
    });
  }

  readonly embedded: string[] = [];

  /**
   * Bag-of-words vectors: each word lights up one dimension. Texts that share
   * words land close together, which is enough to test ranking and filtering
   * without a model.
   */
  embed(texts: string[], _purpose: EmbeddingPurpose): Promise<number[][]> {
    if (!this.configured) return Promise.reject(new AiError('AI_NOT_CONFIGURED'));
    this.embedded.push(...texts);
    return Promise.resolve(texts.map(wordVector));
  }
}

function wordVector(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const word of text.toLowerCase().match(/[p{L}p{N}]+/gu) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % EMBEDDING_DIMENSIONS]! += 1;
  }
  const length = Math.hypot(...vector) || 1;
  return vector.map((v) => v / length);
}
