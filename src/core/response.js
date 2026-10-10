import { z } from 'zod';
import { RESPONSE_SCHEMA_VERSION } from '../config.js';
import { ErrorCode } from './errors.js';

/**
 * Единый конверт ответа для всех тулов.
 *
 * {
 *   schemaVersion: "1.0",
 *   tool:      "docs_context",
 *   requestId: "uuid",
 *   status:    "success" | "error",
 *   data:      { ... } | null,      // null при ошибке
 *   error:     { code, message, details? } | null,   // null при успехе
 *   meta:      { timestamp, durationMs }
 * }
 */
export const ResponseEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(RESPONSE_SCHEMA_VERSION),
    tool: z.string(),
    requestId: z.string(),
    status: z.enum(['success', 'error']),
    data: z.record(z.string(), z.unknown()).nullable(),
    error: z
      .object({
        code: z.enum(Object.values(ErrorCode)),
        message: z.string(),
        details: z.unknown().optional(),
      })
      .nullable(),
    meta: z.object({
      timestamp: z.string(),
      durationMs: z.number().nonnegative(),
    }),
  })
  .refine((r) => (r.status === 'success' ? r.error === null && r.data !== null : r.error !== null && r.data === null), {
    message: 'status должен соответствовать заполненности data/error',
  });

export const RESPONSE_OUTPUT_JSON_SCHEMA = (() => {
  const { $schema, ...schema } = z.toJSONSchema(ResponseEnvelopeSchema, { io: 'output' });
  return schema;
})();

export function buildEnvelope({ tool, requestId, startedAt, data = null, error = null }) {
  return {
    schemaVersion: RESPONSE_SCHEMA_VERSION,
    tool,
    requestId,
    status: error ? 'error' : 'success',
    data: error ? null : data,
    error: error ?? null,
    meta: {
      timestamp: new Date(startedAt).toISOString(),
      durationMs: Date.now() - startedAt,
    },
  };
}

/** Превращает конверт в CallToolResult: JSON в text-контенте + structuredContent. */
export function toCallToolResult(envelope) {
  return {
    content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
    isError: envelope.status === 'error',
  };
}
