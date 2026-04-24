// Octra bridge contract
export const OCTRA_BRIDGE_CONTRACT = 'oct5MrNfjiXFNRDLwsodn8Zm9hDKNGAYt3eQDCQ52bSpCHq'
export const OCTRA_LOCK_METHOD = 'lock_to_eth'
export const OCTRA_UNLOCK_METHOD = 'unlock_trusted'

// Ethereum wOCT contract
export const WOCT_CONTRACT_ADDRESS = '0xE7eD69b852fd2a1406080B26A37e8E04e7dA4caE'
export const WOCT_TOKEN_ADDRESS = '0x4647e1fe715c9e23959022c2416c71867f5a6e80'

// Chain IDs
export const OCTRA_CHAIN_ID = 7777
export const ETH_CHAIN_ID = 1

// Decimals: 1 OCT = 1,000,000 raw units
export const OCT_DECIMALS = 6

// Default Octra RPC — use HTTPS proxy in production to avoid Mixed Content
// Set via Settings panel or VITE_OCTRA_RPC env var
export const DEFAULT_OCTRA_RPC = import.meta.env.VITE_OCTRA_RPC || 'http://46.101.86.250:8080'

// ─── Bridge message FIXED fields ─────────────────────────────────────────────
// CONSTANT across ALL bridge transactions — hardcoded in the ETH contract.
// Source: decoded sample ETH tx 0x1f90406ea51094eeb43fc836f31efcfc825d3fff...
//
//   m.version:     1
//   m.direction:   0   (0 = OCT→ETH)
//   m.srcChainId:  7777
//   m.dstChainId:  1
//   m.srcBridgeId: 0x381ab73c25fb8d4ec4c03e15dd630fab75b410afd90a9276ab81df81c38d2a8b
//   m.dstBridgeId: 0xab33480ea300316d03f76278f05f08f011d41d60f5d49c6ff6d8489fbd60c794
//   m.tokenId:     0x412ec1126381d672a9f42b8612e4bc9ee64f5b6467b991e61110203549cdd6de
export const BRIDGE_MSG_VERSION   = 1
export const BRIDGE_MSG_DIRECTION = 0
export const BRIDGE_SRC_BRIDGE_ID = '0x381ab73c25fb8d4ec4c03e15dd630fab75b410afd90a9276ab81df81c38d2a8b'
export const BRIDGE_DST_BRIDGE_ID = '0xab33480ea300316d03f76278f05f08f011d41d60f5d49c6ff6d8489fbd60c794'
export const BRIDGE_TOKEN_ID      = '0x412ec1126381d672a9f42b8612e4bc9ee64f5b6467b991e61110203549cdd6de'

// ─── Dynamic fields (from Octra RPC after lock_to_eth) ───────────────────────
// Fetched per-transaction via contract_receipt → Locked event:
//   epochId   → receipt.epoch          (e.g. 676316)
//   recipient → Locked.values[2]       (e.g. "0x25Bccdd8...")
//   amount    → Locked.values[1]       (e.g. "1992000000")
//   srcNonce  → Locked.values[3]       (e.g. "400")
//
// ─── Still needs bridge relayer ──────────────────────────────────────────────
// siblings[]  → merkle proof siblings (relayer builds from all epoch bridge txs)
// leafIndex   → position in epoch merkle tree
// These CANNOT be derived from Octra RPC alone.

// Bridge proof API — served by the Octra bridge relayer
export const BRIDGE_PROOF_API = 'https://bridge-api.octra.org'

// wOCT contract ABI (minimal)
export const WOCT_ABI = [
  {
    name: 'verifyAndMint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'epochId', type: 'uint64' },
      {
        name: 'm',
        type: 'tuple',
        components: [
          { name: 'version',     type: 'uint8'   },
          { name: 'direction',   type: 'uint8'   },
          { name: 'srcChainId',  type: 'uint64'  },
          { name: 'dstChainId',  type: 'uint64'  },
          { name: 'srcBridgeId', type: 'bytes32' },
          { name: 'dstBridgeId', type: 'bytes32' },
          { name: 'tokenId',     type: 'bytes32' },
          { name: 'recipient',   type: 'address' },
          { name: 'amount',      type: 'uint128' },
          { name: 'srcNonce',    type: 'uint64'  },
        ],
      },
      { name: 'siblings',  type: 'bytes32[]' },
      { name: 'leafIndex', type: 'uint32'    },
    ],
    outputs: [],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount',  type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
  {
    name: 'burn',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const
