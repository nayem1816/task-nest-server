import { ApiError, FinishReason, type GenerateContentResponse } from '@google/genai';
import { fromResponse, toAiError, toContents } from './gemini.provider.js';

describe('toContents', () => {
  it('maps text, tool calls with their signature, and tool results', () => {
    expect(
      toContents([
        { role: 'user', parts: [{ kind: 'text', text: 'Where is #10482?' }] },
        {
          role: 'model',
          parts: [
            {
              kind: 'toolCall',
              id: 'c1',
              name: 'lookup_order',
              args: { n: '10482' },
              signature: 'sig',
            },
          ],
        },
        {
          role: 'user',
          parts: [
            { kind: 'toolResult', id: 'c1', name: 'lookup_order', result: { status: 'shipped' } },
          ],
        },
      ]),
    ).toEqual([
      { role: 'user', parts: [{ text: 'Where is #10482?', thoughtSignature: undefined }] },
      {
        role: 'model',
        parts: [
          {
            functionCall: { id: 'c1', name: 'lookup_order', args: { n: '10482' } },
            thoughtSignature: 'sig',
          },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { id: 'c1', name: 'lookup_order', response: { status: 'shipped' } } },
        ],
      },
    ]);
  });
});

describe('fromResponse', () => {
  const response = (overrides: Partial<GenerateContentResponse>) =>
    overrides as GenerateContentResponse;

  it('drops thought summaries, keeps text and tool calls, counts thinking as output', () => {
    const result = fromResponse(
      response({
        candidates: [
          {
            finishReason: FinishReason.STOP,
            content: {
              role: 'model',
              parts: [
                { text: 'Let me think about shipping…', thought: true },
                { text: 'Checking that order. ' },
                { functionCall: { name: 'lookup_order', args: { n: '1' } }, thoughtSignature: 's' },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 8, thoughtsTokenCount: 30 },
        modelVersion: 'gemini-test-001',
      }),
      'fallback',
    );
    expect(result.text).toBe('Checking that order.');
    expect(result.toolCalls).toEqual([
      { kind: 'toolCall', id: undefined, name: 'lookup_order', args: { n: '1' }, signature: 's' },
    ]);
    expect(result.message.parts).toHaveLength(2);
    expect(result.usage).toEqual({ inputTokens: 50, outputTokens: 38 });
    expect(result.model).toBe('gemini-test-001');
  });

  it.each([
    [FinishReason.MAX_TOKENS, 'length'],
    [FinishReason.SAFETY, 'blocked'],
    [FinishReason.MALFORMED_FUNCTION_CALL, 'other'],
  ])('maps %s to %s', (reason, expected) => {
    const result = fromResponse(response({ candidates: [{ finishReason: reason }] }), 'm');
    expect(result.finishReason).toBe(expected);
  });

  it('treats a blocked prompt as blocked even with no candidates', () => {
    const result = fromResponse(
      response({ promptFeedback: { blockReason: 'SAFETY' as never } }),
      'm',
    );
    expect(result).toMatchObject({ finishReason: 'blocked', text: '', toolCalls: [] });
  });
});

describe('toAiError', () => {
  it.each([
    [new ApiError({ status: 429, message: 'quota' }), 'AI_RATE_LIMITED', true],
    [new ApiError({ status: 503, message: 'overloaded' }), 'AI_UNAVAILABLE', true],
    [new ApiError({ status: 400, message: 'bad schema' }), 'AI_BAD_REQUEST', false],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'AI_TIMEOUT', true],
    [new TypeError('fetch failed'), 'AI_UNAVAILABLE', true],
  ])('%s → %s', (err, code, retryable) => {
    const mapped = toAiError(err);
    expect(mapped.code).toBe(code);
    expect(mapped.retryable).toBe(retryable);
  });
});
