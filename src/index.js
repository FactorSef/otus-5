#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PROJECT_ROOT, SERVER_INFO } from './config.js';
import { createServer } from './server.js';

const { server, logger, tools } = createServer();

async function shutdown(signal) {
  logger.info('server_stop', { signal });
  await server.close().catch(() => {});
  logger.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await server.connect(new StdioServerTransport());
  logger.info('server_start', { ...SERVER_INFO, projectRoot: PROJECT_ROOT, tools: tools.map((t) => t.name) });
} catch (err) {
  logger.error('server_start_failed', { message: err.message, stack: err.stack });
  process.exit(1);
}
