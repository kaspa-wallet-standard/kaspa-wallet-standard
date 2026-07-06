# Changelog

All notable changes to this package are documented here. This project follows
[Semantic Versioning](https://semver.org).

## 0.2.0

### Changed — KIP-12 (BREAKING: clean cutover to canonical naming)

This package is now the reference implementation of the revived
[KIP-12](https://github.com/kaspanet/kips/pull/21) and speaks **only** its canonical names. The v0.1
naming is retired outright — no dual-dispatch bridge — a break made deliberately while KRON (updated
in lockstep) was the only deployed consumer:

- **Announce event: `kaspa:provider`** (was `kaspa:announceProvider`). `announceKaspaWallet`
  dispatches only it; `requestKaspaWallets` listens only to it.
- **Network ids: the node's bare ids** — `mainnet` / `testnet-10` / `testnet-11` / `devnet`
  (`KASPA_NETWORKS` values changed). New `normalizeKaspaNetworkId()` maps `kaspa_`-prefixed dialects
  (e.g. KasWare's injected API) to canonical.
- **Network-change event: `chainChanged`** (KIP-12 / EIP-1193 name); `networkChanged` removed from
  the `on()` type.

Migration from 0.1.x: bump, rebuild, and update any literal comparisons of event names or network
ids to the values above. A 0.1.x peer will neither see nor be seen by a 0.2.0 peer — update both
sides together.

## 0.1.1

### Fixed / hardened — discovery security (community report)

Thanks to **Bl4ck0uuT** (Kaspa community) for a sharp review of the discovery model. The announce channel
is inherently unauthenticated — any page script can dispatch `kaspa:announceProvider`, the same limitation
EIP-6963 has — and the docs oversold what a couple of mechanisms actually guarantee. Addressed:

- **`requestKaspaWallets` now enforces icon safety.** A non-`data:` `icon` (a remote-URL tracking/spoofing
  vector) is stripped to `''` before the announce reaches the dApp callback, so a dApp that renders
  `info.icon` can never be handed a remote URL. Previously this was only a *SHOULD* in the spec, left to
  each dApp. A valid `data:` icon (or none) passes through untouched — a well-behaved wallet's announce
  is still delivered as its original frozen object.
- **SPEC §5.1 — corrected the freeze wording.** `Object.freeze` protects the integrity of a *single*
  announce (a script can't mutate an already-dispatched event); it does **not** authenticate the
  announcer and does **not** stop a competing announce. The text no longer implies otherwise.
- **SPEC §5.1 / §8 — `rdns` is a convenience key, not an authenticity claim.** Documented that it is
  spoofable, that dApps MAY surface a duplicate-`rdns` announce as a warning, and — the load-bearing
  clarification — that **silent session restore is display-only**: a dApp MUST require a fresh explicit
  user connect gesture before any `signPskt`, and never route a signature to a provider the user didn't
  explicitly (re-)select. Also noted that a spoofed in-page provider still cannot forge a signature (it
  holds no keys), so the realistic risk is display-spoofing/phishing setup, contained by the connect
  gesture being the trust boundary.

No API surface changes; the two event names and all field types are unchanged, so anything built against
0.1.0 keeps working.

## 0.1.0

- Initial proposed release: the provider interface, the `kaspa:announceProvider` / `kaspa:requestProvider`
  discovery handshake (`announceKaspaWallet` / `requestKaspaWallets`), canonical network ids, and the full
  specification in [SPEC.md](SPEC.md). Zero runtime dependencies.
