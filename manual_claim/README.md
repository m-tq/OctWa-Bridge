# OCT Bridge — Manual wOCT Claim Script

CLI tool to manually claim wOCT on Ethereum from a `lock_to_eth` Octra transaction hash.

Useful when the bridge UI fails mid-flow or you need to claim from a different machine.

---

## Setup

```bash
cd bridge/manual_claim
npm install
cp .env.example .env
# Edit .env with your private key
```

---

## Usage

```bash
# Auto gas (fetched from network — recommended)
node claim.js <octra_tx_hash>

# Manual gas (from .env GAS_LIMIT + MAX_FEE_GWEI)
node claim.js <octra_tx_hash> --manual
```

### Example

```bash
node claim.js 5c6712333e4669e62886946009f664e00844f889b619c8985ca22e3f73e1d4ca
```

---

## Flow

```
1. Fetch contract_receipt from Octra RPC
   → extract Locked event: epoch, amount, ethAddress, srcNonce

2. Build verifyAndMint message tuple
   → fixed fields (version, chainIds, bridgeIds, tokenId)
   → dynamic fields from Locked event

3. Check processedMessages on ETH contract
   → already claimed? → show info and exit

4. Check lightClient.latestEpoch
   → epoch not yet on ETH? → show wait time and exit

5. Fetch gas price from network (or use .env manual settings)
   → show estimated cost
   → ask for confirmation

6. Send verifyAndMint transaction
   → siblings = []  (always empty)
   → leafIndex = 0  (always 0)
   → wait for confirmation
   → show tx hash + Etherscan link
```

---

## .env Variables

| Variable | Description | Default |
|---|---|---|
| `PRIVATE_KEY` | EVM private key (hex) | required |
| `INFURA_API_KEY` | Infura API key | bundled key |
| `GAS_LIMIT` | Gas limit (used with `--manual`) | 150000 |
| `MAX_FEE_GWEI` | Max fee per gas in Gwei (used with `--manual`) | 3 |
| `OCTRA_RPC` | Octra node RPC URL | `http://46.101.86.250:8080` |

---

## Gas Modes

**Auto (default):** Fetches current base fee from Ethereum network.
Sets `maxFeePerGas = baseFee × 1.1 + 0.1 Gwei`. Recommended.

**Manual (`--manual`):** Uses `GAS_LIMIT` and `MAX_FEE_GWEI` from `.env`.
Use this if auto estimation fails or you want to set a specific price.

---

## Security

- Private key is read from `.env` only — never hardcoded
- `.env` is gitignored
- Script does not store or transmit your private key
