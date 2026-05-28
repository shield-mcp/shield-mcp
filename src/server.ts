import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { BASE_CHAIN_ID, type HinkalSession } from './hinkal.js';
import { shield, privateTransfer, unshield, privateSwap } from './operations.js';
import { cleanErrorMessage } from './errors.js';
import {
  optionalString,
  parseBoolean,
  parsePositiveBaseUnits,
  requireString,
  validatePublicAddress,
  validateShieldedRecipient,
} from './validation.js';

const TOKEN = { type: 'string' as const };

const TOOLS: Tool[] = [
  { name: 'shield_status', description: 'Engine status on Base: account address, Access Token (compliance) state, chain.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_shielded_address', description: "The agent's shielded receive address — share it to be paid privately.", inputSchema: { type: 'object', properties: {} } },
  { name: 'get_private_balance', description: 'List the shielded (private) balances held in the Hinkal pool on Base.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'shield',
    description: 'Deposit a public ERC20 into the Hinkal pool (public deposit). token = 0x-address or symbol. amount in base units (wei).',
    inputSchema: { type: 'object', properties: { token: TOKEN, amount: { type: 'string' } }, required: ['token', 'amount'] },
  },
  {
    name: 'private_transfer',
    description: 'Private transfer to another shielded address. Sender/recipient/amount hidden, relayed natively. feeToken optional (paid from the pool).',
    inputSchema: { type: 'object', properties: { token: TOKEN, amount: { type: 'string' }, recipient: { type: 'string', description: 'recipient shielded address' }, feeToken: TOKEN }, required: ['token', 'amount', 'recipient'] },
  },
  {
    name: 'unshield',
    description: 'Withdraw from the pool to a public address. useRelayer=true (default) keeps it unlinkable.',
    inputSchema: { type: 'object', properties: { token: TOKEN, amount: { type: 'string' }, recipient: { type: 'string', description: 'public recipient address' }, useRelayer: { type: 'boolean' }, feeToken: TOKEN }, required: ['token', 'amount', 'recipient'] },
  },
  {
    name: 'private_swap',
    description: 'Private swap inside the pool via Odos. tokenIn/tokenOut = 0x-address or symbol; amount in base units (wei). Output is re-shielded. Best for stable/liquid pairs.',
    inputSchema: { type: 'object', properties: { tokenIn: TOKEN, amount: { type: 'string' }, tokenOut: TOKEN, feeToken: TOKEN, slippagePercent: { type: 'number', description: 'max slippage %, default 0.5, capped server-side' } }, required: ['tokenIn', 'amount', 'tokenOut'] },
  },
];

function text(value: unknown) {
  const body = typeof value === 'string' ? value : JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2);
  return { content: [{ type: 'text' as const, text: body }] };
}

/** Build an MCP Server bound to a single user's isolated Hinkal session. */
export function buildServer(session: HinkalSession): Server {
  const server = new Server({ name: 'shield-mcp', version: '0.3.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const input = args && typeof args === 'object' ? (args as Record<string, unknown>) : undefined;
    try {
      switch (name) {
        case 'shield_status':
          return text({ chain: 'Base', chainId: BASE_CHAIN_ID, address: await session.getSignerAddress(), accessToken: await session.hasAccessToken() });
        case 'get_shielded_address':
          return text(await session.getShieldedAddress());
        case 'get_private_balance':
          return text(await session.getShieldedBalances());
        case 'shield': {
          const token = requireString(input, 'token');
          const amount = parsePositiveBaseUnits(requireString(input, 'amount'));
          return text({ action: 'shield', txHash: await shield(session, token, amount) });
        }
        case 'private_transfer': {
          const token = requireString(input, 'token');
          const amount = parsePositiveBaseUnits(requireString(input, 'amount'));
          const recipient = validateShieldedRecipient(requireString(input, 'recipient'));
          const feeToken = optionalString(input, 'feeToken');
          return text({ action: 'private_transfer', txHash: await privateTransfer(session, token, amount, recipient, feeToken) });
        }
        case 'unshield': {
          const token = requireString(input, 'token');
          const amount = parsePositiveBaseUnits(requireString(input, 'amount'));
          const recipient = validatePublicAddress(requireString(input, 'recipient'));
          const useRelayer = parseBoolean(input, 'useRelayer', true);
          const feeToken = optionalString(input, 'feeToken');
          return text({ action: 'unshield', txHash: await unshield(session, token, amount, recipient, useRelayer, feeToken) });
        }
        case 'private_swap': {
          const tokenIn = requireString(input, 'tokenIn');
          const amount = parsePositiveBaseUnits(requireString(input, 'amount'));
          const tokenOut = requireString(input, 'tokenOut');
          const feeToken = optionalString(input, 'feeToken');
          const slip = Number(input?.slippagePercent);
          const slippage = Number.isFinite(slip) && slip > 0 ? slip : undefined;
          return text({ action: 'private_swap', txHash: await privateSwap(session, tokenIn, amount, tokenOut, feeToken, slippage) });
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      return { isError: true, content: [{ type: 'text' as const, text: `${name} failed: ${cleanErrorMessage(error)}` }] };
    }
  });

  return server;
}
