# Kaspa Wallet Standard

**A proposed standard for dApp↔wallet interoperability on Kaspa.** One tiny, zero-dependency handshake so
any dApp can find any wallet — and any wallet can join every dApp — without either side hardcoding the
other. Inspired by Ethereum's [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) and Solana's
[Wallet Standard](https://github.com/wallet-standard/wallet-standard).

> **Status: reference implementation of [KIP-12](https://github.com/kaspanet/kips/pull/21) (draft, under revival).**
> This standard has been folded into KIP-12, which is now the authoritative specification; this package
> implements it exactly — canonical names only (`kaspa:provider` announce, bare network ids,
> `chainChanged`). [SPEC.md](SPEC.md) tracks the same contract. Versioning policy: SPEC §7.

```bash
npm install kaspa-wallet-standard
```

## Why

Today every Kaspa dApp hardcodes each wallet's injected global (`window.kasware`, `window.kastle`, …) one
at a time, and every new wallet has to lobby every dApp to be added. This package replaces that with a
two-event handshake: wallets **announce** themselves, dApps **request** announcements. A wallet that ships
this appears in every adopting dApp automatically; a dApp that ships this lists every present wallet —
including ones that didn't exist when it was built.

## Wallet side — announce yourself

```ts
import { announceKaspaWallet } from 'kaspa-wallet-standard';

announceKaspaWallet(
  {
    id: 'your-extension-id',            // wallet identifier (KIP-12 `id`)
    name: 'YourWallet',
    icon: 'data:image/svg+xml;base64,…', // data: URI only
    methods: ['kaspa:requestAccounts', 'kaspa:chainId', 'kaspa:signPskt'], // wire methods you serve
    uuid: crypto.randomUUID(),          // fresh per page load
    rdns: 'com.yourwallet',             // STABLE id — enables silent session restore after reload
  },
  provider,                              // your provider object (see below)
);
```

`provider` only needs `requestAccounts()`; everything else (`getAccounts`, `getNetwork`/`switchNetwork`,
`getPublicKey`, `signMessage`, `signPskt`, events) is optional and capability-checked by the dApp. See
[SPEC §3](SPEC.md#3-provider-interface).

### If your wallet uses a `request(method, params)` bridge

Some wallets (e.g. Kastle) expose a single `request()` bridge instead of discrete methods. Wrap it in a
thin object that satisfies the interface — a few lines:

```ts
const w = window.yourwallet; // { request(method, params), on, removeListener }
const provider = {
  requestAccounts: () => w.request('kas:connect').then(() => w.request('kas:get_account')).then(a => [a.address]),
  getAccounts:     () => w.request('kas:get_account').then(a => [a.address]).catch(() => []),
  getNetwork:      () => w.request('kas:get_network'),
  switchNetwork:   (id) => w.request('kas:switch_network', id),
  getPublicKey:    () => w.request('kas:get_account').then(a => a.publicKey),
  signMessage:     (m) => w.request('kas:sign_message', m),
  signPskt: ({ txJsonString, options }) => w.request('kas:sign_tx', {
    networkId: /* whatever id YOUR bridge expects — this is the wallet's own dialect */ 'testnet-10',
    txJson: txJsonString,
    scripts: options.signInputs.map(s => ({ inputIndex: s.index, scriptHex: '', signType: 'All' })),
  }),
  on: w.on?.bind(w),
  removeListener: w.removeListener?.bind(w),
};
announceKaspaWallet(info, provider);
```

### No dependency? ~10 lines of raw JS

The package is a convenience, not a requirement. The handshake is small enough to inline:

```js
const detail = Object.freeze({
  info: Object.freeze({ uuid: crypto.randomUUID(), name: 'YourWallet', icon: 'data:…', rdns: 'com.yourwallet' }),
  provider: window.yourwallet,
});
const announce = () => window.dispatchEvent(new CustomEvent('kaspa:provider', { detail }));
window.addEventListener('kaspa:requestProvider', announce);
announce();
```

## dApp side — discover wallets

```ts
import { requestKaspaWallets } from 'kaspa-wallet-standard';

const wallets = new Map(); // dedupe by rdns ?? uuid
const unsubscribe = requestKaspaWallets(({ info, provider }) => {
  wallets.set(info.rdns ?? info.uuid, { info, provider });
  renderWalletPicker([...wallets.values()]); // each has info.name, info.icon, and provider
});
// keep the subscription alive for the page lifetime to catch late-injecting wallets
```

Then on click: `const [address] = await provider.requestAccounts();`. Capability-check optional methods
before using them. `requestKaspaWallets` already strips any non-`data:` `info.icon` for you (a remote URL
is a tracking/spoofing vector), so what reaches your callback is safe to render. The announce is **not** an
identity proof, though — any script can announce any name/rdns, so require an explicit user connect before
signing and treat silent `getAccounts()` restore as display-only. See [SPEC §8](SPEC.md#8-security-considerations).

## Who's using it

- **[KRON](https://kron.technology)** — native-L1 Kaspa launchpad + DEX. First production adopter;
  consumes the discovery handshake and ships built-in adapters for KasWare and Kastle behind this
  provider interface.

Using it in your wallet or dApp? Open a PR to add yourself.

## Status & contributing

This package is the reference implementation of **KIP-12**, the (draft) Kaspa wallet provider and
discovery standard — the original draft lives at [kaspanet/kips#21](https://github.com/kaspanet/kips/pull/21)
and a revived, consolidated revision is being prepared with the original authors. The bar for
ratification: the handshake proven across at least two independently-developed wallets. If you're a
wallet or dApp author, review happens on the KIP; implementation issues are welcome
[here](../../issues). See [SPEC.md](SPEC.md) for the contract, security model, and versioning policy.

## License

[MIT](LICENSE)
