#!/usr/bin/env node
// Local stdio entry — single user from env (SHIELD_PRIVATE_KEY). For the hosted
// multi-tenant HTTP server, see http.ts.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSession } from './hinkal.js';
import { buildServer } from './server.js';
import { cleanErrorMessage } from './errors.js';
import { policyConfigured } from './policy.js';

process.on('uncaughtException', (e) => process.stderr.write(`[shield:fatal] ${cleanErrorMessage(e)}\n`));
process.on('unhandledRejection', (e) => process.stderr.write(`[shield:fatal] ${cleanErrorMessage(e)}\n`));
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

async function main() {
  const privateKey = process.env.SHIELD_PRIVATE_KEY;
  const rpcUrls = process.env.SHIELD_RPC_URLS;
  if (!privateKey) throw new Error('SHIELD_PRIVATE_KEY required');
  if (!rpcUrls) throw new Error('SHIELD_RPC_URLS required');

  // Local mode: file cache is fine (your own machine).
  if (!policyConfigured()) {
    process.stderr.write(
      '[shield] WARNING: no policy guard set — the agent can move funds to ANY recipient up to the wallet balance. ' +
        'Set SHIELD_RECIPIENT_ALLOWLIST / SHIELD_MAX_PER_TX / SHIELD_MAX_OPS_PER_DAY for autonomous use.\n',
    );
  }

  const session = createSession(privateKey, rpcUrls, { useFileCache: true });
  const server = buildServer(session);
  await server.connect(new StdioServerTransport());
  process.stderr.write('[shield] MCP server running on stdio (Hinkal · Base)\n');
}

main().catch((error) => {
  process.stderr.write(`[shield:fatal] failed to start: ${cleanErrorMessage(error)}\n`);
  process.exit(1);
});
