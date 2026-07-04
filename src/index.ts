// Kaspa Wallet Standard — reference implementation.
//
// A PROPOSED standard (see SPEC.md) for how a Kaspa dApp and a Kaspa wallet find and talk to each other,
// with two parts:
//   • Part 1 — the provider interface a wallet exposes (accounts, network, signing).
//   • Part 2 — an EIP-6963-style discovery handshake so a dApp finds every present wallet with zero
//     per-wallet code, and any future wallet self-registers by dispatching one event.
//
// This package has ZERO runtime dependencies and is safe to import in Node (all browser access is guarded).
// The wire contract — the two event names and the existing fields below — is FROZEN: it never changes.
// Evolution happens only by adding new OPTIONAL fields. A wallet written against this file keeps working
// against every future version.

// ============================================================================================
// Part 1 — Provider interface
// ============================================================================================

/** Canonical network ids used by `getNetwork()` / `switchNetwork()`. String literals are the contract;
 *  this object is a convenience so integrators don't hand-type them. */
export const KASPA_NETWORKS = {
  MAINNET: 'kaspa_mainnet',
  TESTNET_10: 'kaspa_testnet_10',
  TESTNET_11: 'kaspa_testnet_11',
  DEVNET: 'kaspa_devnet',
} as const;

export type KaspaNetworkId = (typeof KASPA_NETWORKS)[keyof typeof KASPA_NETWORKS];

/** Identity a wallet announces about itself. `name`/`icon` are DISPLAY hints — never trust signals. */
export type KaspaProviderInfo = {
  /** UUIDv4, freshly generated per page load — instance identity, used only for dedupe. */
  uuid: string;
  /** Human-readable wallet name shown in pickers, e.g. "Kastle". */
  name: string;
  /** Wallet icon as a `data:` URI (SVG/PNG). dApps should refuse to render remote URLs. */
  icon: string;
  /** Reverse-DNS identifier, e.g. "com.kasware" — STABLE across page loads and versions. Strongly
   *  recommended: it is what lets a dApp silently restore a session with your wallet after a reload. */
  rdns?: string;
};

/** One input a wallet is asked to sign, by position. `sighashType` 1 = SIGHASH_ALL (the only value
 *  KRON uses today); a wallet MUST refuse a type it does not implement rather than guess. */
export type KaspaSignInput = { index: number; sighashType: number };

/**
 * The raw provider surface a wallet exposes. Deliberately shaped like the widely-deployed injected APIs
 * (KasWare's `window.kasware`) so an existing wallet can usually announce its injected object as-is.
 *
 * Only `requestAccounts` is MANDATORY. Everything else is OPTIONAL and MUST be capability-checked by the
 * dApp (`typeof provider.signPskt === 'function'`) — a dApp degrades gracefully (e.g. disables trading)
 * when a method is absent, rather than refusing to list the wallet.
 *
 * FUND-SAFETY RULE (wallet side): `signPskt` MUST sign ONLY the inputs listed in `options.signInputs`,
 * and MUST leave every other input untouched. Kaspa covenant transactions carry pre-authorized inputs
 * that must NOT be re-signed; a signature over an unlisted input, or over the wrong sighash, is a
 * fund-safety bug, not a cosmetic mismatch. See SPEC.md §"Security considerations".
 */
export interface KaspaProvider {
  /** Connect: prompt the user if needed; resolve to the authorized address list (active address first). */
  requestAccounts(): Promise<string[]>;
  /** Already-authorized accounts WITHOUT prompting (empty array if none) — enables silent session restore. */
  getAccounts?(): Promise<string[]>;
  /** Current network id (see {@link KaspaNetworkId}). */
  getNetwork?(): Promise<string>;
  switchNetwork?(networkId: string): Promise<void>;
  /** The active account's public key hex (compressed 33-byte or x-only 32-byte — both accepted). */
  getPublicKey?(): Promise<string>;
  /** KIP-5 message signing; resolves to the Schnorr signature hex. */
  signMessage?(message: string): Promise<string>;
  /** Sign ONLY the listed inputs of a Kaspa Safe-JSON transaction and return the signed Safe JSON. */
  signPskt?(arg: { txJsonString: string; options: { signInputs: KaspaSignInput[] } }): Promise<string>;
  disconnect?(origin?: string): Promise<void>;
  on?(event: 'accountsChanged' | 'networkChanged', handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
}

// ============================================================================================
// Part 2 — Discovery handshake
// ============================================================================================

/** Dispatched on `window` by a dApp to ask all present wallets to (re-)announce themselves. */
export const KASPA_REQUEST_PROVIDER_EVENT = 'kaspa:requestProvider';
/** Dispatched on `window` by a wallet; `detail` is a frozen {@link KaspaProviderDetail}. */
export const KASPA_ANNOUNCE_PROVIDER_EVENT = 'kaspa:announceProvider';

/** The `detail` of a `kaspa:announceProvider` CustomEvent. */
export type KaspaProviderDetail = { info: KaspaProviderInfo; provider: KaspaProvider };

/**
 * WALLET SIDE — call once when your content script loads. Announces immediately AND replays on every
 * `kaspa:requestProvider` (so a dApp that loads after you still finds you). Returns an unsubscribe
 * (rarely needed; e.g. extension teardown). No-op outside a window context.
 */
export function announceKaspaWallet(info: KaspaProviderInfo, provider: KaspaProvider): () => void {
  if (typeof window === 'undefined') return () => {};
  const detail: KaspaProviderDetail = Object.freeze({ info: Object.freeze({ ...info }), provider });
  const announce = () =>
    window.dispatchEvent(new CustomEvent(KASPA_ANNOUNCE_PROVIDER_EVENT, { detail }));
  window.addEventListener(KASPA_REQUEST_PROVIDER_EVENT, announce);
  announce();
  return () => window.removeEventListener(KASPA_REQUEST_PROVIDER_EVENT, announce);
}

/**
 * dApp SIDE — register `onAnnounce` (fires once per announce event, including replays; dedupe by
 * `info.rdns ?? info.uuid` yourself), then request announcements from wallets already present. Keep the
 * subscription alive for the page lifetime to catch late-injecting wallets. Returns an unsubscribe.
 * Malformed announces (missing identity or `requestAccounts`) are dropped, never delivered. No-op
 * outside a window context.
 */
export function requestKaspaWallets(onAnnounce: (detail: KaspaProviderDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<KaspaProviderDetail>).detail;
    if (!detail?.info?.uuid || !detail?.info?.name) return;
    if (typeof detail.provider?.requestAccounts !== 'function') return;
    onAnnounce(detail);
  };
  window.addEventListener(KASPA_ANNOUNCE_PROVIDER_EVENT, listener);
  window.dispatchEvent(new Event(KASPA_REQUEST_PROVIDER_EVENT));
  return () => window.removeEventListener(KASPA_ANNOUNCE_PROVIDER_EVENT, listener);
}
