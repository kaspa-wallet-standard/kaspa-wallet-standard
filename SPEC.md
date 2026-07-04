# Kaspa Wallet Standard

**Status: Proposed (draft).** This is an open proposal for how Kaspa dApps and wallets discover and talk
to each other. It is **not** (yet) a ratified [Kaspa Improvement Proposal](https://github.com/kaspanet/kips) —
it is offered for community adoption and feedback, with the explicit goal of becoming a KIP once it has
proven out across independent wallets. Comments, issues, and PRs are welcome.

**Version:** 0.1 · **Wire contract:** frozen (see §7).

---

## 1. Motivation

Kaspa has several good wallets (KasWare, Kastle, and more), but **no shared way for a dApp to connect to
them**. Today each dApp hardcodes each wallet's injected global (`window.kasware`, `window.kastle`, …)
one at a time, and each new wallet has to lobby every dApp to add it. This is the same dead end Ethereum
hit before [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193) (a common provider shape) and
[EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) (multi-wallet discovery), and that Solana solved with
its [Wallet Standard](https://github.com/wallet-standard/wallet-standard).

This standard removes the hardcoding on **both** sides:

- A **dApp** listens for one event and shows every wallet that answers — including wallets that did not
  exist when the dApp shipped.
- A **wallet** dispatches one event and appears in every adopting dApp — no per-dApp integration.

It has two parts: a **provider interface** (§3–4) and a **discovery handshake** (§5).

## 2. Terminology

- **Provider** — the object a wallet injects/exposes that a dApp calls to get accounts, network, and
  signatures (§3).
- **Announce** — a wallet advertising its provider via the `kaspa:announceProvider` event (§5).
- **dApp** — any web page that wants to use a Kaspa wallet.
- Keywords **MUST**, **SHOULD**, **MAY** are used per [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

## 3. Provider interface

A provider is an object with the following shape (TypeScript; see
[`src/index.ts`](src/index.ts) `KaspaProvider`). Only `requestAccounts` is **mandatory**; every other
method is **optional** and MUST be capability-checked by the dApp (`typeof p.signPskt === 'function'`).

| Method | Required | Purpose |
|---|---|---|
| `requestAccounts(): Promise<string[]>` | **yes** | Connect (prompt if needed); resolve to authorized addresses, active first. |
| `getAccounts(): Promise<string[]>` | no | Already-authorized accounts **without** prompting → silent session restore. |
| `getNetwork(): Promise<string>` | no | Current network id (§6). |
| `switchNetwork(id): Promise<void>` | no | Request a network switch. |
| `getPublicKey(): Promise<string>` | no | Active account public key hex (compressed or x-only). |
| `signMessage(msg): Promise<string>` | no | KIP-5 message signing → Schnorr signature hex. |
| `signPskt({ txJsonString, options }): Promise<string>` | no | Sign specific inputs of a transaction (§4). |
| `disconnect(origin?): Promise<void>` | no | Drop the site's authorization. |
| `on / removeListener(event, handler)` | no | `accountsChanged`, `networkChanged`. |

A wallet that implements only `requestAccounts` is valid — it will connect and display balances in a
dApp, which simply disables features that need the missing methods.

## 4. Transaction signing (`signPskt`) — fund-safety rules

`signPskt(txJsonString, options)` takes a Kaspa **Safe-JSON** transaction and an `options.signInputs`
array of `{ index, sighashType }`, and returns the re-serialized signed transaction.

- The wallet **MUST** sign **only** the inputs listed in `signInputs`, and **MUST** leave all other
  inputs untouched. Kaspa covenant transactions carry inputs that are pre-authorized by on-chain rules
  (a curve, a pool, a presence-owned token UTXO); re-signing one corrupts the transaction.
- The wallet **MUST** honor the requested `sighashType` (1 = `SIGHASH_ALL`) and **MUST** refuse a type
  it does not implement rather than substitute another. A signature over the wrong sighash, or over an
  input the dApp did not list, is a **fund-safety defect**, not an API mismatch.
- Before enabling `signPskt`, a wallet **SHOULD** verify it against a transaction that contains **both**
  a covenant input and a user P2PK input (e.g. a bonding-curve buy) — signing a plain send never
  exercises the "sign only these, leave the rest" requirement.

## 5. Discovery handshake

Two events on `window`, mirroring EIP-6963 replay semantics:

- **`kaspa:announceProvider`** — a `CustomEvent` dispatched by the **wallet**. `detail` is a **frozen**
  `{ info, provider }` (see §5.1). MUST be dispatched on load, and re-dispatched on every
  `kaspa:requestProvider`.
- **`kaspa:requestProvider`** — a plain `Event` dispatched by the **dApp** to ask present wallets to
  (re-)announce.

**Sequence**

1. On load, the wallet registers a `kaspa:requestProvider` listener that re-announces, then announces once.
2. The dApp registers its `kaspa:announceProvider` listener (kept alive for the page lifetime), then
   dispatches `kaspa:requestProvider`.
3. Late arrival is covered from both directions: a late wallet announces unprompted on load; a late dApp's
   request triggers a replay from every wallet already present.

### 5.1 Announce payload

```ts
type KaspaProviderInfo = {
  uuid: string;   // UUIDv4, fresh per page load — instance identity / dedupe
  name: string;   // human label, e.g. "Kastle"
  icon: string;   // data: URI (SVG/PNG); dApps MUST refuse remote URLs
  rdns?: string;  // reverse-DNS id, e.g. "com.kasware" — STABLE across loads; used for session restore
};
type KaspaProviderDetail = { info: KaspaProviderInfo; provider: KaspaProvider };
```

- The wallet **MUST** freeze `detail` (and `detail.info`) so a page script cannot mutate an announce
  **in flight** (swap the `provider` or a field on an already-dispatched event). Freezing protects the
  integrity of a *single* announce only — it does **not** authenticate the announcer, and a hostile
  script can still dispatch its **own** competing announce. Freezing is not a trust signal (see §8).
- The wallet **SHOULD** provide a stable `rdns`; without it a dApp cannot restore the session after a
  reload (there is no stable identity to match). `rdns` is a convenience key, **not** an authenticity
  claim — any script can announce any `rdns` (see §8).
- The dApp **SHOULD** dedupe announces by `info.rdns ?? info.uuid` (first-announce-wins). Because `rdns`
  is spoofable, a dApp **MAY** surface a *second* announce for an already-seen `rdns` as a warning rather
  than silently discarding it.

## 6. Network ids

Canonical strings (also exported as `KASPA_NETWORKS`):

`kaspa_mainnet` · `kaspa_testnet_10` · `kaspa_testnet_11` · `kaspa_devnet`

## 7. Compatibility and versioning (frozen contract)

The **wire contract is frozen**: the two event names, and every field defined above, never change
meaning or type. The standard evolves **only by adding new OPTIONAL fields/methods**. A wallet or dApp
built against this document keeps working against every future version. Breaking changes, if ever
unavoidable, would ship under a **new event name** — never by mutating these.

## 8. Security considerations

- `name`/`icon` are **display hints, not trust signals**. An announce proves a provider is *present*, not
  that it is *who it claims to be*. dApps MUST NOT grant trust based on them, and MUST refuse non-`data:`
  icons (a remote URL is a tracking/spoofing vector). The reference `requestKaspaWallets` **enforces this
  for you** — it strips any non-`data:` icon (delivers it as `''`) before handing the announce to your
  callback.
- Any page script can dispatch `kaspa:announceProvider`, including one that claims another wallet's
  `name`/`rdns`. Treat the provider as untrusted until the user explicitly connects; the wallet's own
  connect/sign prompt — rendered by the extension, outside page control — is the trust boundary, not the
  announce.
- **Silent session restore is display-only.** A dApp MAY use a remembered `rdns` to silently re-populate
  *displayed* accounts via `getAccounts()` after a reload, but it **MUST** require a fresh explicit user
  connect gesture before calling `signPskt` (or any signing). Never route a signature to a provider the
  user did not explicitly (re-)select this session — `rdns` alone is spoofable and is not consent.
- The fund-safety rules in §4 are the load-bearing security property. A wallet that signs sloppily can
  lose user funds even though the handshake itself is benign. Note a spoofed in-page provider still
  **cannot forge a signature** (it holds no keys); the realistic risk of announce-spoofing is *display
  spoofing / phishing setup*, which the connect-gesture boundary above is designed to contain.

## 9. Reference implementation & adoption

- **Reference implementation:** this package (`kaspa-wallet-standard`) — `announceKaspaWallet` (wallet)
  and `requestKaspaWallets` (dApp), plus the types above. ~70 lines, zero dependencies.
- **First adopter:** [KRON](https://kron.technology) (native-L1 Kaspa launchpad + DEX) consumes the
  discovery handshake in production, and ships built-in adapters for KasWare and Kastle behind the same
  provider interface.

## 10. Path to standardization

This document is intended to graduate into a **KIP**. The bar we're aiming for before proposing
ratification: the handshake proven across **at least two independently-developed wallets**, and the
provider interface exercised by covenant-grade `signPskt` on-chain. Wallet and dApp authors who adopt it
(or who want fields changed *before* it freezes into a KIP) are invited to open an issue.
