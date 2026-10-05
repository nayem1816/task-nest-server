import { AiError, type AiErrorCode } from '../../src/modules/ai/ai.errors.js';
import type {
  AiProvider,
  EmbeddingPurpose,
  GenerateRequest,
  GenerateResult,
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

  embed(texts: string[], _purpose: EmbeddingPurpose): Promise<number[][]> {
    return Promise.resolve(texts.map(() => [1, 0, 0]));
  }
}
