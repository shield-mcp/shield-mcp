import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { JsonRpcProvider, Wallet } from 'ethers';
import { prepareEthersHinkal } from '@hinkal/common/providers/prepareEthersHinkal';
import { getERC20Token, getERC20TokenBySymbol } from '@hinkal/common';
import type { Hinkal, ERC20Token } from '@hinkal/common';

/**
 * Maximum-privacy engine on BASE via Hinkal Protocol — multi-tenant.
 *
 * Each connecting user gets their OWN HinkalSession, isolated, keyed by the
 * private key THEY supply. The key lives only in this session's memory for the
 * lifetime of the session; it is never logged, returned, or (in hosted mode)
 * written to disk. The server holds no wallet and no funds — fully non-custodial.
 */

export const BASE_CHAIN_ID = 8453;

const log = (msg: string) => process.stderr.write(`[shield] ${msg}\n`);

/** Resolve a token by 0x-address or by symbol (e.g. "USDC") on Base. Stateless. */
export function resolveToken(tokenOrSymbol: string): ERC20Token {
  const token = tokenOrSymbol.startsWith('0x')
    ? getERC20Token(tokenOrSymbol, BASE_CHAIN_ID)
    : getERC20TokenBySymbol(tokenOrSymbol, BASE_CHAIN_ID);
  if (!token) throw new Error(`unknown/unsupported token on Base: ${tokenOrSymbol}`);
  return token;
}

export type SessionOptions = {
  /** Persist Hinkal's UTXO/merkle cache to disk. OFF in hosted mode (privacy). */
  useFileCache?: boolean;
};

/** An isolated, single-user Hinkal session. Boots lazily on first use. */
export class HinkalSession {
  private hinkal?: Hinkal<unknown>;
  private bootPromise?: Promise<Hinkal<unknown>>;
  private writeQueue: Promise<unknown> = Promise.resolve();
  signerAddress = '';

  constructor(
    private readonly privateKey: string,
    private readonly rpcUrls: string,
    private readonly opts: SessionOptions = {},
  ) {}

  private provider(): JsonRpcProvider {
    const url = this.rpcUrls.split(',')[0]?.trim();
    if (!url) throw new Error('SHIELD_RPC_URLS required (Base mainnet RPC)');
    return new JsonRpcProvider(url, BASE_CHAIN_ID);
  }

  private async boot(): Promise<Hinkal<unknown>> {
    const wallet = new Wallet(this.privateKey, this.provider());
    this.signerAddress = wallet.address;

    const useFileCache = this.opts.useFileCache ?? false;
    const cfg: { useFileCache: boolean; cacheFilePath?: string } = { useFileCache };
    if (useFileCache) {
      const p = path.join(os.homedir(), '.shield-mcp', `${this.signerAddress}.json`);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      cfg.cacheFilePath = p;
    }

    // Hinkal bundles its own ethers; our Wallet is structurally a Signer but
    // nominally from a different ethers instance — cast to the expected param.
    const signer = wallet as unknown as Parameters<typeof prepareEthersHinkal>[0];
    const h = await prepareEthersHinkal(signer, cfg);
    await h.initUserKeys();
    this.hinkal = h;
    log(`session ready for ${this.signerAddress} (fileCache=${useFileCache})`);
    return h;
  }

  /** Boot once (memoized) and return the live Hinkal instance. */
  async ready(): Promise<Hinkal<unknown>> {
    if (!this.bootPromise) this.bootPromise = this.boot();
    return this.bootPromise;
  }

  /** Serialize write ops so two private actions don't reuse the same input note. */
  withWriteLock<T>(op: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(op, op);
    this.writeQueue = run.catch(() => undefined);
    return run;
  }

  async getSignerAddress(): Promise<string> {
    await this.ready();
    return this.signerAddress;
  }

  async hasAccessToken(): Promise<boolean> {
    return (await this.ready()).checkAccessToken(BASE_CHAIN_ID);
  }

  async getShieldedBalances(): Promise<unknown[]> {
    return (await this.ready()).getTotalBalance(BASE_CHAIN_ID);
  }

  async getShieldedAddress(): Promise<string> {
    return (await this.ready()).getRecipientInfo();
  }

  /** Re-scan UTXO state so already-spent notes aren't reused before a write. */
  async refreshState(): Promise<void> {
    const h = await this.ready();
    await h.resetMerkleTreesIfNecessary([BASE_CHAIN_ID]);
    await h.getTotalBalance(BASE_CHAIN_ID, undefined, undefined, true);
  }
}

export function createSession(privateKey: string, rpcUrls: string, opts: SessionOptions = {}): HinkalSession {
  return new HinkalSession(privateKey, rpcUrls, opts);
}
