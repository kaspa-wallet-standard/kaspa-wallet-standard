// Kaspa Wallet Standard — reference implementation.
//
// A PROPOSED standard (see SPEC.md) for how a Kaspa dApp and a Kaspa wallet find and talk to each other,
// with two parts:
//   • Part 1 — the provider interface a wallet exposes (accounts, network, signing).
//   • Part 2 — an EIP-6963-style discovery handshake so a dApp finds every present wallet with zero
//     per-wallet code, and any future wallet self-registers by dispatching one event.
//
// This package has ZERO runtime dependencies and is safe to import in Node (all browser access is guarded).
//
// v0.2 — KIP-12. This package is the reference implementation of the revived KIP-12 and speaks ONLY its
// canonical names: `kaspa:provider` announce, the node's bare network ids (`mainnet`, `testnet-10`),
// `chainChanged`. The v0.1 names (`kaspa:announceProvider`, `kaspa_mainnet`, `networkChanged`) are gone —
// a clean break, made while KRON was the only deployed consumer (updated in lockstep). From here the
// wire contract evolves per KIP-12 itself: add-only fields/methods; breaking = new event name.
//
// The type surface below follows the KIP's formal interfaces (`kip-0012/interfaces.ts` in kaspanet/kips):
// canonical wire values, the KIP's `request()` registry, provider shape, and error codes — plus a few
// de-facto extras (marked as such) that the spec leaves to vendor extensions. The two runtime helpers
// (announce/request) implement the discovery handshake + receiver-side security filters the spec
// describes; a wallet/dApp gets a correct, zero-dependency implementation for free.

// ============================================================================================
// Part 1 — Provider interface
// ============================================================================================

/** Canonical network ids used by `getNetwork()` / `switchNetwork()`. String literals are the contract;
 *  this object is a convenience so integrators don't hand-type them. */
export const KASPA_NETWORKS = {
  MAINNET: 'mainnet',
  TESTNET_10: 'testnet-10',
  TESTNET_11: 'testnet-11',
  DEVNET: 'devnet',
} as const;

export type KaspaNetworkId = (typeof KASPA_NETWORKS)[keyof typeof KASPA_NETWORKS];

/** Normalize any wallet-reported network id to the canonical KIP-12 form: legacy `kaspa_`-prefixed
 *  variants (`kaspa_mainnet`, `kaspa_testnet_10` — v0.1 of this package, KasWare's injected API) map to
 *  the node's bare ids (`mainnet`, `testnet-10`). Canonical ids pass through unchanged. */
export const normalizeKaspaNetworkId = (id: string): string =>
  id.startsWith('kaspa_') ? id.slice('kaspa_'.length).replace(/_/g, '-') : id;

/** Identity a wallet announces about itself. `name`/`icon` are DISPLAY hints — never trust signals. */
export type KaspaProviderInfo = {
  /** Wallet identifier (KIP-12 `id`, e.g. the extension id). */
  id: string;
  /** Human-readable wallet name shown in pickers, e.g. "Kastle". */
  name: string;
  /** Wallet icon as a `data:` URI (SVG/PNG) — a DISPLAY hint, never a trust signal. A remote URL is a
   *  tracking/spoofing vector, so the dApp-side {@link requestKaspaWallets} STRIPS any non-`data:` icon
   *  (delivers it as `''`) — a dApp can never be handed a remote URL through the handshake. */
  icon: string;
  /** The KIP-12 wire methods this wallet serves (see {@link KASPA_METHODS}) — capability
   *  advertisement before the user ever connects. */
  methods: readonly KaspaRequestMethod[];
  /** UUIDv4, freshly generated per page load — instance identity, used only for dedupe. */
  uuid: string;
  /** Reverse-DNS identifier, e.g. "com.kasware" — STABLE across page loads and versions. Strongly
   *  recommended: it is what lets a dApp silently restore a session with your wallet after a reload. */
  rdns?: string;
};

/** One input a wallet is asked to sign, by position. `sighashType` 1 = SIGHASH_ALL (the only value
 *  KRON uses today); a wallet MUST refuse a type it does not implement rather than guess. */
export type KaspaSignInput = { index: number; sighashType: number };

/** Argument of {@link KaspaProvider.signPskt}: a Kaspa Safe-JSON transaction plus the explicit list of
 *  inputs to sign. The wallet MUST sign ONLY these inputs and leave the rest untouched (fund-safety). */
export interface KaspaSignPsktArg {
  txJsonString: string;
  options: { signInputs: KaspaSignInput[] };
}

/** Simple transfer (SPEC §4.2). Amount is sompi as a base-10 **string** — float KAS is FORBIDDEN in the
 *  wire contract: IEEE-754 doubles cannot represent every sompi value exactly, and a rounding error in an
 *  amount is a fund-safety defect. */
export interface KaspaSimpleTransfer {
  to: string;
  amountSompi: string;
}

// Wire encodings (the KIP's aliases): hex-encoded bytes, and a serialized PSKB as produced by the
// WASM SDK.
export type HexString = string;
export type PSKB = string;

/** Provider events and their payloads (SPEC §6). `chainChanged` is the KIP-12 network-change event;
 *  `accountsChanged` is a de-facto extension. */
export interface KaspaProviderEventMap {
  /** The authorized account list changed (switch, revoke). De-facto extension, not part of KIP-12. */
  accountsChanged: string[];
  /** The wallet switched networks; payload is a network id (see {@link KaspaNetworkId}). */
  chainChanged: string;
}

export type KaspaProviderEvent = keyof KaspaProviderEventMap;

/** Canonical `request()` registry (SPEC §7): the KIP-12 wire methods, exactly as the KIP's
 *  `KIP12MethodArgs`/`KIP12MethodResult` maps define them. Future KIPs/protocols extend this map via
 *  declaration merging; wallets serve vendor methods under their own namespace (e.g. `"rift:…"`). */
export interface KaspaRequestMap {
  'kaspa:connect': { args: []; result: string };
  'kaspa:disconnect': { args: []; result: string };
  'kaspa:requestAccounts': { args: []; result: string[] };
  'kaspa:chainId': { args: []; result: string };
  'kaspa:getPublicKey': { args: []; result: HexString };
  'kaspa:send': { args: [pskb: HexString]; result: HexString[] };
  'kaspa:sign': { args: [pskb: PSKB]; result: HexString };
  'kaspa:broadcast': { args: [pskb: HexString]; result: HexString };
  'kaspa:signPersonal': { args: [message: string]; result: HexString };
  'kaspa:sendTransaction': { args: [tx: KaspaSimpleTransfer]; result: HexString };
  // safe JSON representation of the Transaction
  'kaspa:signTransaction': { args: [txJsonString: string]; result: HexString };
  'kaspa:broadcastTransaction': { args: [tx: HexString]; result: HexString };
  'kaspa:signPskt': { args: [arg: KaspaSignPsktArg]; result: string };
}

export type KaspaRequestMethod = keyof KaspaRequestMap;

/** The KIP-12 method registry as a value — e.g. for a wallet's announced `info.methods`. */
export const KASPA_METHODS = [
  'kaspa:connect',
  'kaspa:disconnect',
  'kaspa:requestAccounts',
  'kaspa:chainId',
  'kaspa:getPublicKey',
  'kaspa:send',
  'kaspa:sign',
  'kaspa:broadcast',
  'kaspa:signPersonal',
  'kaspa:sendTransaction',
  'kaspa:signTransaction',
  'kaspa:broadcastTransaction',
  'kaspa:signPskt',
] as const satisfies readonly KaspaRequestMethod[];

/** Standard rejection codes (SPEC §8, mirroring EIP-1193 for developer familiarity). */
export const KIP12_ERRORS = {
  /** The user rejected the request. */
  USER_REJECTED: 4001,
  /** The origin is not authorized (call `requestAccounts` first). */
  UNAUTHORIZED: 4100,
  /** The wallet does not support the requested method. */
  UNSUPPORTED_METHOD: 4200,
  /** The wallet is locked or unavailable. */
  WALLET_UNAVAILABLE: 4900,
} as const;

export interface Kip12Error {
  message: string;
  code?: number | string;
  details?: unknown;
}

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
  /** Already-authorized accounts WITHOUT prompting (empty array if none) — enables silent session
   *  restore. De-facto extension, not part of KIP-12. */
  getAccounts?(): Promise<string[]>;
  /** Current network id (see {@link KaspaNetworkId}). */
  getNetwork?(): Promise<string>;
  /** De-facto extension, not part of KIP-12 (dApps treat it as best-effort). */
  switchNetwork?(networkId: string): Promise<void>;
  /** The active account's public key hex (compressed 33-byte or x-only 32-byte — both accepted). */
  getPublicKey?(): Promise<string>;
  /** KIP-5 message signing; resolves to the Schnorr signature hex. */
  signMessage?(message: string): Promise<string>;
  /** Sign ONLY the listed inputs of a Kaspa Safe-JSON transaction and return the signed Safe JSON —
   *  the covenant-grade signing primitive (fund-safety rules apply). */
  signPskt?(arg: KaspaSignPsktArg): Promise<string>;
  /** Establish a connection without returning accounts (KIP-12; `requestAccounts` does both). */
  connect?(): Promise<void>;
  /** The `origin` parameter is a de-facto extension — KIP-12's disconnect takes no arguments. */
  disconnect?(origin?: string): Promise<void>;
  /** Subscribe to a provider event; the handler payload is inferred from the event
   *  ({@link KaspaProviderEventMap}). `chainChanged` is the KIP-12 network-change event. */
  on?<E extends KaspaProviderEvent>(event: E, handler: (payload: KaspaProviderEventMap[E]) => void): void;
  removeListener?<E extends KaspaProviderEvent>(event: E, handler: (payload: KaspaProviderEventMap[E]) => void): void;
  /** Typed protocol-extension escape hatch (SPEC §7). Extends the surface, never the privileges — a
   *  method served here is still subject to the authorization gate and fund-safety rules. An unknown
   *  method MUST reject with code 4200 ({@link KIP12_ERRORS}). */
  request?<M extends KaspaRequestMethod>(
    method: M,
    args: KaspaRequestMap[M]['args'],
  ): Promise<KaspaRequestMap[M]['result']>;
}

// ============================================================================================
// Part 2 — Discovery handshake
// ============================================================================================

/** Dispatched on `window` by a dApp to ask all present wallets to (re-)announce themselves. */
export const KASPA_REQUEST_PROVIDER_EVENT = 'kaspa:requestProvider';
/** Dispatched on `window` by a wallet; `detail` is a frozen {@link KaspaProviderDetail}.
 *  KIP-12 canonical name. */
export const KASPA_ANNOUNCE_PROVIDER_EVENT = 'kaspa:provider';

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

/** An icon is safe to render only as an inline `data:` URI. A remote URL is a tracking/spoofing vector
 *  (SPEC §8), so the dApp-side handshake refuses it. */
const isSafeIcon = (icon: unknown): icon is string => typeof icon === 'string' && /^data:/i.test(icon.trim());

/**
 * dApp SIDE — register `onAnnounce` (fires once per announce event, including replays; dedupe by
 * `info.rdns ?? info.uuid` yourself), then request announcements from wallets already present. Keep the
 * subscription alive for the page lifetime to catch late-injecting wallets. Returns an unsubscribe.
 *
 * Two receiver-side safety filters run before an announce reaches `onAnnounce`:
 *   • Malformed announces (missing `uuid`/`name`, or no `requestAccounts`) are dropped, never delivered.
 *   • A non-`data:` `icon` (a remote-URL tracking/spoofing vector, SPEC §8) is STRIPPED to `''` — the
 *     wallet is still surfaced, just without the unsafe icon. An absent or valid `data:` icon passes
 *     through untouched (the announce stays the wallet's original frozen object).
 *
 * NEITHER filter authenticates the announcer: any page script can announce (SPEC §8), so treat a provider
 * as untrusted until the user explicitly connects — that connect gesture is the trust boundary, not this
 * handshake. No-op outside a window context.
 */
export function requestKaspaWallets(onAnnounce: (detail: KaspaProviderDetail) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<KaspaProviderDetail>).detail;
    if (!detail?.info?.uuid || !detail?.info?.name) return;
    if (typeof detail.provider?.requestAccounts !== 'function') return;
    if (detail.info.icon != null && !isSafeIcon(detail.info.icon)) {
      // Strip the unsafe icon but keep the wallet: deliver a sanitized copy; the wallet's frozen
      // original is left untouched (a valid/absent icon skips this and passes through frozen).
      onAnnounce({ info: { ...detail.info, icon: '' }, provider: detail.provider });
      return;
    }
    onAnnounce(detail);
  };
  window.addEventListener(KASPA_ANNOUNCE_PROVIDER_EVENT, listener);
  window.dispatchEvent(new Event(KASPA_REQUEST_PROVIDER_EVENT));
  return () => window.removeEventListener(KASPA_ANNOUNCE_PROVIDER_EVENT, listener);
}
