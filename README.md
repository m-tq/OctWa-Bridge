# OctWa Bridge — Experimental

A web bridge for moving OCT between **Octra Chain** and **Ethereum** (as wOCT).

> ⚠️ **Experimental** — use at your own risk. This bridge is under active development.

---

## Overview

OctWa Bridge connects native OCT on Octra with wOCT (Wrapped OCT) on Ethereum using a 1:1 lock/mint model — no liquidity pools, no swaps.

| | |
| --- | --- |
| **Octra Bridge Contract** | `oct5MrNfjiXFNRDLwsodn8Zm9hDKNGAYt3eQDCQ52bSpCHq` |
| **ETH Bridge Contract** | `0xE7eD69b852fd2a1406080B26A37e8E04e7dA4caE` |
| **wOCT Token** | `0x4647e1fE715c9e23959022C2416C71867F5a6E80` |
| **Denomination** | 1 OCT = 1 wOCT = 1,000,000 raw units (6 decimals) |
| **SDK** | [`@octwa/sdk@2.1.0`](https://www.npmjs.com/package/@octwa/sdk) (RFC-O-1) |

---

## How It Works

### OCT → wOCT

1. Call `lock_to_eth(eth_address)` on the Octra bridge contract using `sdk.sendContractTransaction(...)`.
2. Wait for epoch confirmation on Octra (~10 s per epoch).
3. Wait for the epoch header to be indexed by the Ethereum lightClient (~30–40 min lag).
4. Call `verifyAndMint(epochId, message, [], 0)` on the Ethereum contract using `sdk.evm.sendTransaction(...)`.
5. wOCT is minted to the recipient.

### wOCT → OCT

1. Call `burnToOctra(octraRecipient, amount)` on the Ethereum contract using `sdk.evm.sendTransaction(...)` — single transaction, no separate `approve`.
2. The bridge relayer detects `BurnInitiated` and calls `unlock_trusted` on Octra.
3. OCT arrives in the recipient address (~2 minutes).

---

## Requirements

- **OctWa wallet extension** — install [OctWa](https://github.com/m-tq/OctWa) in Chrome / Edge.
- **ETH on your EVM address** — about 0.0005 ETH covers `verifyAndMint` gas (~131 k gas).
- Octra mainnet RPC access (or your own HTTPS proxy — see below).

> Your EVM address is derived automatically from your Octra private key (secp256k1 over the same BIP39 seed). You do not need MetaMask.

---

## Setup

```bash
cd bridge
npm install
npm run build       # output → dist/
```

### Environment

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

```env
VITE_INFURA_API_KEY=your_infura_api_key_here
VITE_OCTRA_RPC=https://bridge.octwa.pw
```

`VITE_OCTRA_RPC` is the **base URL** — the app appends `/rpc` automatically. Set `VITE_INFURA_API_KEY` only if you need higher rate limits; otherwise the bridge falls back to `https://ethereum.publicnode.com`.

---

## Nginx Proxy (required for HTTPS deployments)

The Octra node RPC runs on plain HTTP (`http://46.101.86.250:8080`). Browsers block HTTP requests from HTTPS pages (Mixed Content), so you must proxy through your HTTPS domain.

Add to your Nginx server block (e.g. `/etc/nginx/sites-available/bridge.octwa.pw`):

```nginx
server {
    listen 443 ssl;
    server_name bridge.octwa.pw;

    # ... your existing SSL config ...

    root /path/to/bridge/dist;
    index index.html;
    try_files $uri $uri/ /index.html;

    # Proxy Octra RPC — avoids Mixed Content errors
    location /rpc {
        proxy_pass http://46.101.86.250:8080/rpc;
        proxy_http_version 1.1;
        proxy_set_header Content-Type application/json;
        proxy_set_header X-Real-IP $remote_addr;
        add_header Access-Control-Allow-Origin *;
        add_header Access-Control-Allow-Methods "POST, OPTIONS";
        add_header Access-Control-Allow-Headers "Content-Type";

        if ($request_method = OPTIONS) {
            return 204;
        }
    }
}
```

After changing `.env`, rebuild and reload Nginx:

```bash
npm run build
sudo nginx -t && sudo systemctl reload nginx
```

---

## SDK Integration

The bridge uses RFC-O-1 methods only — there is no direct call to `window.octra.invoke` or any legacy capability API.

**Connect** — single approval for everything the bridge needs:

```ts
const accounts = await sdk.connect({
  permissions: [
    'read_address',
    'read_balance',
    'contract_calls',
    'send_transactions',
  ],
})
const evmAddress = await sdk.evm.getDerivedAddress()
```

**Lock OCT (Octra)** — opens the contract approval popup:

```ts
const result = await sdk.sendContractTransaction({
  address: OCTRA_BRIDGE_CONTRACT,
  method:  'lock_to_eth',
  params:  [ethRecipient],
  amount:  rawOuString,
})
```

**Mint wOCT (Ethereum)** — opens the EVM transaction popup:

```ts
const result = await sdk.evm.sendTransaction({
  to:    WOCT_CONTRACT_ADDRESS,
  data:  encodedVerifyAndMintCalldata,
  value: '0',
})
```

**Burn wOCT (Ethereum)** — single tx, no separate approve:

```ts
const result = await sdk.evm.sendTransaction({
  to:    WOCT_CONTRACT_ADDRESS,
  data:  encodedBurnToOctraCalldata,
  value: '0',
})
```

The bridge does not request `evm_send_transactions` as a separate scope — the wallet accepts the broader `send_transactions` grant for EVM signing operations.

---

## Bridge History

The history view is powered by on-chain reads — no `localStorage`-backed cache.

- `octra_transactionsByAddress` — last 20 `lock_to_eth` calls.
- `contract_receipt` for each tx → `Locked` event → derived message hash.
- `processedMessages(msgHash)` on ETH contract → `claimed` / `unclaimed`.
- `lightClient.latestEpoch()` → `epoch_pending` if not yet indexed.

For wOCT → OCT history, the panel scans `BurnInitiated` events emitted by the user's EVM address, in 49 k-block chunks back ~200 k blocks.

### Manual TX Lookup

Paste any Octra tx hash in the History panel to inspect its claim status, even if it was created from a different machine.

---

## Gas Settings

Default gas for `verifyAndMint`:
- **Gas Limit**: 150,000
- **Max Fee**: 3 Gwei

These can be overridden in the OctWa transaction approval popup. Actual usage on mainnet is ~131,500 gas.

---

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS (sharp edges, Fira Code font)
- Framer Motion
- ethers.js v6
- `@octwa/sdk@2.1.0` (RFC-O-1)

---

## Architecture

```
bridge/src/
├── components/
│   ├── BridgePanel.tsx      # Main bridge UI
│   ├── HistoryPanel.tsx     # On-chain history + manual lookup
│   ├── AboutPanel.tsx       # Contract info
│   ├── SettingsPanel.tsx    # RPC config
│   ├── Header.tsx
│   ├── Sidebar.tsx
│   └── Footer.tsx
├── lib/
│   ├── bridge-service.ts    # lockOctOnOctra, waitForLockedEvent, claimWoctOnEthereum, burnWoctToOctra
│   ├── on-chain-history.ts  # fetchBridgeHistory, fetchBurnHistory, lookupTxHash
│   ├── pending-claims.ts    # localStorage tracker for the in-flight ETH claim tx
│   ├── octra-rpc.ts         # Read-only Octra JSON-RPC helpers (balance, receipts, pause check)
│   ├── constants.ts         # Contract addresses, fixed bridge message fields
│   └── types.ts
└── hooks/
    └── useWallets.ts        # OctraSDK lifecycle + balances
```

---

## License

MIT
