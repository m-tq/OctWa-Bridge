# OctWa Bridge — Experimental

A web bridge for moving OCT between **Octra Chain** and **Ethereum** (as wOCT).

> ⚠️ **Experimental** — use at your own risk. This bridge is under active development.

---

## Overview

OctWa Bridge connects native OCT on Octra with wOCT (Wrapped OCT) on Ethereum using a 1:1 lock/mint model — no liquidity pools, no swaps.

| | |
|---|---|
| **Octra Bridge Contract** | `oct5MrNfjiXFNRDLwsodn8Zm9hDKNGAYt3eQDCQ52bSpCHq` |
| **ETH Bridge Contract** | `0xE7eD69b852fd2a1406080B26A37e8E04e7dA4caE` |
| **wOCT Token** | `0x4647e1fE715c9e23959022C2416C71867F5a6E80` |
| **Denomination** | 1 OCT = 1 wOCT = 1,000,000 raw units (6 decimals) |

---

## How It Works

### OCT → wOCT

1. Call `lock_to_eth(eth_address)` on Octra bridge contract
2. Wait for epoch confirmation on Octra (~10s per epoch)
3. Wait for epoch header to be indexed on Ethereum lightClient (~39 min lag)
4. Call `verifyAndMint(epochId, message, [], 0)` on ETH contract
5. wOCT minted to recipient

### wOCT → OCT *(coming soon)*

1. Approve wOCT spend
2. Call `burnToOctra(octraRecipient, amount)`
3. OCT unlocked on Octra

---

## Requirements

- **OctWa wallet extension** — [OctWa](https://github.com/m-tq/OctWa) installed in Chrome
- **ETH on your EVM address** — ~0.0005 ETH for gas fees (verifyAndMint uses ~131k gas)
- Octra mainnet RPC access

> Your EVM address is automatically derived from your Octra private key (secp256k1) — no MetaMask needed.

---

## Setup

```bash
cd bridge
npm install
npm run dev
```

### Environment

Copy `.env.example` to `.env` and fill in your Infura key:

```bash
cp .env.example .env
```

```env
VITE_INFURA_API_KEY=your_infura_api_key_here
```

---

## Bridge History

History is fetched **on-chain** — no localStorage dependency:

- Queries `octra_transactionsByAddress` for last 20 `lock_to_eth` calls
- For each tx: reads `contract_receipt` → Locked event → derives message hash
- Checks `processedMessages(msgHash)` on ETH contract → `claimed` / `unclaimed`
- Checks `lightClient.latestEpoch()` → `epoch_pending` if not yet indexed

### Manual TX Lookup

Enter any Octra tx hash in the History panel to check its claim status directly.

---

## Gas Settings

Default gas for `verifyAndMint`:
- **Gas Limit**: 150,000
- **Max Fee**: 3 Gwei

These can be overridden in the invoke approval popup. Actual usage is ~131,561 gas.

---

## Tech Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS (sharp edges, Fira Code font)
- Framer Motion
- ethers.js v6
- Octra JSON-RPC 2.0

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
│   ├── bridge-service.ts    # lock, waitForLockedEvent, claimWoctOnEthereum
│   ├── on-chain-history.ts  # fetchBridgeHistory, lookupTxHash
│   ├── pending-claims.ts    # localStorage pending ETH tx tracker
│   ├── octra-rpc.ts         # Octra JSON-RPC client
│   ├── constants.ts         # Contract addresses, fixed bridge fields
│   └── types.ts
└── hooks/
    └── useWallets.ts        # OctWa extension connection + balances
```

---

## License

MIT
