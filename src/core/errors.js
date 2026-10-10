// Фиксированный набор кодов ошибок. Клиенты могут на них полагаться.
export const ErrorCode = Object.freeze({
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNKNOWN_TOOL: 'UNKNOWN_TOOL',
  ACCESS_DENIED: 'ACCESS_DENIED',
  NOT_FOUND: 'NOT_FOUND',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  UNSUPPORTED_FILE: 'UNSUPPORTED_FILE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

export class ToolError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
    this.details = details;
  }
}
