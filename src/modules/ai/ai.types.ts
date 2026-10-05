/**
 * Provider-neutral shapes. Business code (agent, knowledge, playground) speaks
 * these; only a provider adapter knows a vendor SDK. Swapping Gemini for
 * another model means writing one adapter, not touching the agent.
 */

export type JsonSchema = Record<string, unknown>;

export type AiPart =
  | { kind: 'text'; text: string; signature?: string }
  | {
      kind: 'toolCall';
      id?: string;
      name: string;
      args: Record<string, unknown>;
      /**
       * Opaque provider state that must travel back with the call on the next
       * turn (Gemini's thought signature). Never shown or interpreted.
       */
      signature?: string;
    }
  | { kind: 'toolResult'; id?: string; name: string; result: Record<string, unknown> };

export interface AiMessage {
  role: 'user' | 'model';
  parts: AiPart[];
}

export interface AiTool {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface GenerateRequest {
  system?: string;
  messages: AiMessage[];
  tools?: AiTool[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Ask for JSON matching this schema instead of free text. */
  responseSchema?: JsonSchema;
}

export type FinishReason = 'stop' | 'length' | 'blocked' | 'other';

export interface GenerateResult {
  /** The model's turn, ready to append to `messages` for the next call. */
  message: AiMessage;
  text: string;
  toolCalls: Extract<AiPart, { kind: 'toolCall' }>[];
  finishReason: FinishReason;
  usage: { inputTokens: number; outputTokens: number };
  model: string;
}

export type EmbeddingPurpose = 'document' | 'query';

export interface AiProvider {
  readonly name: string;
  /** False when the server has no credentials; callers show "not set up". */
  readonly configured: boolean;
  readonly chatModel: string;
  readonly embeddingModel: string;
  generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResult>;
  embed(texts: string[], purpose: EmbeddingPurpose, signal: AbortSignal): Promise<number[][]>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** Fixed: the knowledge base's vector column is created with this size. */
export const EMBEDDING_DIMENSIONS = 768;
