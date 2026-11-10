#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createEngineServer } from './engine/server.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { server, session } = await createEngineServer(root);
const shutdown = async () => {
  await session.close();
  await server.close();
};
process.once('SIGINT', () => { void shutdown(); });
process.once('SIGTERM', () => { void shutdown(); });
server.onclose = () => { void session.close(); };
await server.connect(new StdioServerTransport());
