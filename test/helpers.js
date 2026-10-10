import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createLogger } from '../src/core/logger.js';
import { createServer } from '../src/server.js';

/** Поднимает сервер и клиент в памяти; лог пишется в массив lines. */
export async function connect() {
  const lines = [];
  const logger = createLogger({ file: 'off', level: 'debug', stream: { write: (l) => lines.push(JSON.parse(l)) } });
  const { server } = createServer({ logger });
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  async function call(name, args) {
    const result = await client.callTool({ name, arguments: args });
    return { result, envelope: result.structuredContent };
  }

  return { client, call, lines, close: () => client.close() };
}
