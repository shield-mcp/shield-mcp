import { isAddress } from 'ethers';
import { ExternalActionId } from '@hinkal/common';

const DECIMAL_INTEGER = /^(0|[1-9][0-9]*)$/;
const HEX_CALLDATA = /^0x(?:[0-9a-fA-F]{2})*$/;

export type SwapAction = Extract<keyof typeof ExternalActionId, 'Uniswap' | 'Odos' | 'OneInch' | 'Lifi' | 'Okx'>;

export function requireString(args: Record<string, unknown> | undefined, key: string): string {
  const value = args?.[key];
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${key} required`);
  return trimmed;
}

export function optionalString(args: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = args?.[key];
  if (value == null) return undefined;
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${key} must not be empty`);
  return trimmed;
}

export function parsePositiveBaseUnits(value: string): bigint {
  if (!DECIMAL_INTEGER.test(value)) throw new Error('amount must be a positive decimal integer in base units');
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error('amount must be greater than zero');
  return amount;
}

export function parseBoolean(args: Record<string, unknown> | undefined, key: string, defaultValue: boolean): boolean {
  const value = args?.[key];
  if (value == null) return defaultValue;
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
  return value;
}

export function validatePublicAddress(address: string): string {
  if (!isAddress(address)) throw new Error('recipient must be a valid EVM address');
  return address;
}

export function validateShieldedRecipient(recipient: string): string {
  if (!isValidHinkalPrivateAddress(recipient)) throw new Error('recipient must be a valid Hinkal shielded address');
  return recipient;
}

export function isValidHinkalPrivateAddress(address: string): boolean {
  if (['http://', 'https://', '/payment/', '.app/', '.com/', '.netlify.'].some((part) => address.includes(part))) {
    return false;
  }
  const [extraRandomization, stealthAddress, encryptionKey, h0, h1] = address.split(',');
  if (!extraRandomization || !stealthAddress || !encryptionKey || !h0 || !h1) return false;
  if (!stealthAddress.startsWith('0x') || !encryptionKey.startsWith('0x')) return false;
  if (encryptionKey.length !== 66 || stealthAddress.length > 66 || stealthAddress.length < 64) return false;
  return !address.includes('"');
}

export function validateSwapAction(action: string): SwapAction {
  if (!['Uniswap', 'Odos', 'OneInch', 'Lifi', 'Okx'].includes(action)) {
    throw new Error('action must be one of Uniswap, Odos, OneInch, Lifi, Okx');
  }
  return action as SwapAction;
}

export function validateHexCalldata(data: string): string {
  if (!HEX_CALLDATA.test(data)) throw new Error('swapData must be 0x-prefixed even-length hex calldata');
  return data;
}
