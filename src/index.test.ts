import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  announceKaspaWallet,
  requestKaspaWallets,
  KASPA_ANNOUNCE_PROVIDER_EVENT,
  KASPA_REQUEST_PROVIDER_EVENT,
  KASPA_NETWORKS,
  KASPA_METHODS,
  KIP12_ERRORS,
  normalizeKaspaNetworkId,
  type KaspaProvider,
} from './index';

const provider = (): KaspaProvider => ({ requestAccounts: async () => ['kaspa:qtest'] });
const info = (over: Partial<{ uuid: string; name: string; rdns: string }> = {}) => ({
  id: 'test-wallet',
  uuid: crypto.randomUUID(),
  name: 'TestWallet',
  icon: 'data:image/svg+xml;base64,PHN2Zy8+',
  methods: ['kaspa:requestAccounts'] as const,
  rdns: 'com.test.wallet',
  ...over,
});

// Each test starts from a clean window: strip any listeners a prior test's announce left behind.
const teardowns: Array<() => void> = [];
afterEach(() => { while (teardowns.length) teardowns.pop()!(); });
const track = (unsub: () => void) => { teardowns.push(unsub); return unsub; };

describe('discovery handshake', () => {
  it('delivers an already-present wallet to a dApp that asks (replay on request)', () => {
    track(announceKaspaWallet(info({ name: 'Alpha' }), provider())); // wallet announces before dApp listens
    const seen: string[] = [];
    track(requestKaspaWallets((d) => seen.push(d.info.name))); // request triggers the wallet's replay
    expect(seen).toEqual(['Alpha']);
  });

  it('delivers a late-injecting wallet to a dApp already listening', () => {
    const seen: string[] = [];
    track(requestKaspaWallets((d) => seen.push(d.info.name))); // dApp listens first, no wallet yet
    expect(seen).toEqual([]);
    track(announceKaspaWallet(info({ name: 'Beta' }), provider())); // wallet arrives late, announces unprompted
    expect(seen).toEqual(['Beta']);
  });

  it('surfaces multiple wallets, each once, for the consumer to dedupe', () => {
    track(announceKaspaWallet(info({ name: 'One', rdns: 'com.one' }), provider()));
    track(announceKaspaWallet(info({ name: 'Two', rdns: 'com.two' }), provider()));
    const names: string[] = [];
    track(requestKaspaWallets((d) => names.push(d.info.name)));
    expect(names.sort()).toEqual(['One', 'Two']);
  });

  it('drops a malformed announce (no requestAccounts) instead of delivering it', () => {
    const cb = vi.fn();
    track(requestKaspaWallets(cb));
    // A hostile/broken announce with no provider surface must not reach the dApp.
    window.dispatchEvent(new CustomEvent(KASPA_ANNOUNCE_PROVIDER_EVENT, { detail: { info: info(), provider: {} } }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('freezes the announced detail so page scripts cannot swap the provider', () => {
    let captured: any;
    track(requestKaspaWallets((d) => { captured = d; }));
    track(announceKaspaWallet(info(), provider()));
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.info)).toBe(true);
  });

  it('passes a valid data: icon through untouched (announce stays the frozen original)', () => {
    let captured: any;
    track(requestKaspaWallets((d) => { captured = d; }));
    track(announceKaspaWallet(info({ name: 'DataIcon' }), provider())); // info() carries a data: icon
    expect(captured.info.icon).toBe('data:image/svg+xml;base64,PHN2Zy8+');
    expect(Object.isFrozen(captured)).toBe(true);
  });

  it('strips a non-data: (remote URL) icon to "" but still surfaces the wallet', () => {
    let captured: any;
    track(requestKaspaWallets((d) => { captured = d; }));
    // A wallet (or hostile script) announcing a remote-URL icon — a tracking/spoofing vector.
    const detail = { info: { ...info({ name: 'RemoteIcon' }), icon: 'https://evil.example/track.png' }, provider: provider() };
    window.dispatchEvent(new CustomEvent(KASPA_ANNOUNCE_PROVIDER_EVENT, { detail }));
    expect(captured.info.name).toBe('RemoteIcon'); // wallet still delivered, not dropped
    expect(captured.info.icon).toBe('');           // unsafe icon stripped before reaching the dApp
  });

  it('stops delivering after unsubscribe', () => {
    const cb = vi.fn();
    const unsub = requestKaspaWallets(cb);
    unsub();
    track(announceKaspaWallet(info(), provider()));
    expect(cb).not.toHaveBeenCalled();
  });

  it('exposes the canonical (KIP-12) event names, network ids, and method registry', () => {
    expect(KASPA_ANNOUNCE_PROVIDER_EVENT).toBe('kaspa:provider');
    expect(KASPA_REQUEST_PROVIDER_EVENT).toBe('kaspa:requestProvider');
    expect(KASPA_NETWORKS.MAINNET).toBe('mainnet');
    expect(KASPA_NETWORKS.TESTNET_10).toBe('testnet-10');
    // Wire names are the KIP's, not the retired interim dialect.
    expect(KASPA_METHODS).toContain('kaspa:chainId');
    expect(KASPA_METHODS).toContain('kaspa:signPersonal');
    expect(KASPA_METHODS).toContain('kaspa:signPskt');
    expect(KASPA_METHODS).not.toContain('kaspa:getNetwork');
    expect(KASPA_METHODS).not.toContain('kaspa:signPskb');
  });

  it('ignores the pre-KIP announce event name entirely (clean cutover)', () => {
    const cb = vi.fn();
    track(requestKaspaWallets(cb));
    // A wallet built against the retired v0.1 contract — this package no longer listens to it.
    window.dispatchEvent(new CustomEvent('kaspa:announceProvider', {
      detail: Object.freeze({ info: Object.freeze(info({ name: 'OldWallet' })), provider: provider() }),
    }));
    expect(cb).not.toHaveBeenCalled();
  });

  it('a full provider (every optional method + request()) satisfies the interface', () => {
    // Compile-time parity check: if the KIP added a method the package lacks, this stops typechecking.
    const full: KaspaProvider = {
      requestAccounts: async () => ['kaspa:q'],
      getAccounts: async () => [],
      getNetwork: async () => KASPA_NETWORKS.TESTNET_10,
      switchNetwork: async () => {},
      getPublicKey: async () => 'ab',
      signMessage: async () => 'sig',
      signPskt: async ({ txJsonString }) => txJsonString,
      connect: async () => {},
      disconnect: async () => {},
      on: (_e, _h) => {},
      removeListener: (_e, _h) => {},
      request: async (m) => {
        if (m === 'kaspa:requestAccounts') return [] as never;
        return undefined as never;
      },
    };
    expect(typeof full.request).toBe('function');
    expect(KIP12_ERRORS.UNSUPPORTED_METHOD).toBe(4200);
  });

  it('normalizes kaspa_-prefixed network ids (KasWare dialect) to canonical', () => {
    expect(normalizeKaspaNetworkId('kaspa_mainnet')).toBe('mainnet');
    expect(normalizeKaspaNetworkId('kaspa_testnet_10')).toBe('testnet-10');
    expect(normalizeKaspaNetworkId('testnet-10')).toBe('testnet-10'); // canonical passes through
  });
});
