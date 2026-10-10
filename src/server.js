import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SERVER_INFO } from './config.js';
import { ErrorCode, ToolError } from './core/errors.js';
import { createLogger } from './core/logger.js';
import { buildEnvelope, RESPONSE_OUTPUT_JSON_SCHEMA, ResponseEnvelopeSchema, toCallToolResult } from './core/response.js';
import { docsContextTool } from './tools/docsContext.js';
import { projectHelperTool } from './tools/projectHelper.js';

function toInputJsonSchema(schema) {
  const { $schema, ...json } = z.toJSONSchema(schema, { io: 'input' });
  return json;
}

function formatZodIssues(error) {
  return error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
}

/**
 * Создаёт MCP-сервер. Используется низкоуровневый Server, а не McpServer,
 * чтобы ошибки валидации и неизвестные тулы тоже проходили через единый
 * конверт ответа и логгер (McpServer отвечает на них своим форматом).
 */
export function createServer({ logger = createLogger() } = {}) {
  const tools = [docsContextTool, projectHelperTool].map((t) => ({
    ...t,
    inputSchemaJson: toInputJsonSchema(t.inputSchema),
  }));
  const byName = new Map(tools.map((t) => [t.name, t]));
  const ctx = { tools, responseFormat: RESPONSE_OUTPUT_JSON_SCHEMA };

  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      title: t.title,
      description: t.description,
      inputSchema: t.inputSchemaJson,
      outputSchema: RESPONSE_OUTPUT_JSON_SCHEMA,
      annotations: t.annotations,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: input = {} } = request.params;
    return toCallToolResult(await runTool({ name, input, byName, ctx, logger }));
  });

  return { server, logger, tools };
}

export async function runTool({ name, input, byName, ctx, logger }) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const tool = byName.get(name);
  let data = null;
  let error = null;

  try {
    if (!tool) {
      throw new ToolError(ErrorCode.UNKNOWN_TOOL, `Неизвестный тул: ${name}`, { available: [...byName.keys()] });
    }
    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ToolError(ErrorCode.VALIDATION_ERROR, 'Некорректные входные параметры', {
        issues: formatZodIssues(parsed.error),
      });
    }
    data = await tool.handler(parsed.data, ctx);
  } catch (err) {
    error =
      err instanceof ToolError
        ? { code: err.code, message: err.message, ...(err.details !== undefined && { details: err.details }) }
        : { code: ErrorCode.INTERNAL_ERROR, message: err?.message ?? String(err) };
    if (!(err instanceof ToolError)) logger.error('tool_exception', { tool: name, requestId, stack: err?.stack });
  }

  let envelope = buildEnvelope({ tool: name, requestId, startedAt, data, error });

  // Самопроверка: ответ обязан соответствовать зафиксированному формату.
  const check = ResponseEnvelopeSchema.safeParse(envelope);
  if (!check.success) {
    logger.error('envelope_invalid', { tool: name, requestId, issues: formatZodIssues(check.error) });
    envelope = buildEnvelope({
      tool: name,
      requestId,
      startedAt,
      error: { code: ErrorCode.INTERNAL_ERROR, message: 'Ответ тула не соответствует формату' },
    });
  }

  logger.toolCall({ tool: name, requestId, input, envelope });
  return envelope;
}
