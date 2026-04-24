/**
 * OCT Bridge — Manual wOCT Claim Script
 *
 * Usage:
 *   node claim.js <octra_tx_hash>              # auto gas from network
 *   node claim.js <octra_tx_hash> --manual     # use GAS_LIMIT + MAX_FEE_GWEI from .env
 *
 * Flow (same as bridge UI):
 *   1. Fetch contract_receipt from Octra RPC → extract Locked event
 *   2. Build verifyAndMint message tuple (fixed + dynamic fields)
 *   3. Check processedMessages on ETH → already claimed?
 *   4. Check lightClient.latestEpoch → epoch available on ETH?
 *   5. Fetch gas price from ETH network (or use .env manual settings)
 *   6. Call verifyAndMint on ETH bridge contract → wOCT minted
 */

import { ethers } from 'ethers';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// ── Load .env ─────────────────────────────────────────────────────────────────

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dir, '.env');

if (!existsSync(envPath)) {
  console.error('\n❌  .env file not found.');
  console.error('    Copy .env.example to .env and fill in your settings.\n');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(envPath, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => l.split('=').map(s => s.trim()))
    .filter(([k]) => k)
    .map(([k, ...v]) => [k, v.join('=')])
);

const PRIVATE_KEY   = env.PRIVATE_KEY;
const INFURA_KEY    = env.INFURA_API_KEY || '121cf128273c4f0cb73770b391070d3b';
const OCTRA_RPC     = (env.OCTRA_RPC || 'http://46.101.86.250:8080').replace(/\/$/, '');
const GAS_LIMIT_ENV = parseInt(env.GAS_LIMIT || '150000', 10);
const MAX_FEE_ENV   = parseFloat(env.MAX_FEE_GWEI || '3');

if (!PRIVATE_KEY || PRIVATE_KEY === '0xyour_private_key_here') {
  console.error('\n❌  PRIVATE_KEY not set in .env\n');
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const TX_HASH   = args.find(a => !a.startsWith('--'));
const USE_MANUAL_GAS = args.includes('--manual');

if (!TX_HASH) {
  console.log('\nUsage:');
  console.log('  node claim.js <octra_tx_hash>           # auto gas');
  console.log('  node claim.js <octra_tx_hash> --manual  # manual gas from .env\n');
  process.exit(1);
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ETH_RPC            = `https://mainnet.infura.io/v3/${INFURA_KEY}`;
const BRIDGE_CONTRACT    = '0xE7eD69b852fd2a1406080B26A37e8E04e7dA4caE';
const OCTRA_BRIDGE_ADDR  = 'oct5MrNfjiXFNRDLwsodn8Zm9hDKNGAYt3eQDCQ52bSpCHq';
const LIGHT_CLIENT       = '0xc01ca57dc7f7c4b6f1b6b87b85d79e5ddf0df55d';
const OCT_DECIMALS       = 6;

// Fixed bridge message fields (verified from decoded sample ETH tx)
const MSG = {
  version:     1,
  direction:   0,
  srcChainId:  7777n,
  dstChainId:  1n,
  srcBridgeId: '0x381ab73c25fb8d4ec4c03e15dd630fab75b410afd90a9276ab81df81c38d2a8b',
  dstBridgeId: '0xab33480ea300316d03f76278f05f08f011d41d60f5d49c6ff6d8489fbd60c794',
  tokenId:     '0x412ec1126381d672a9f42b8612e4bc9ee64f5b6467b991e61110203549cdd6de',
};

// verifyAndMint ABI
const VERIFY_AND_MINT_ABI = [
  {
    name: 'verifyAndMint',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'epochId', type: 'uint64' },
      {
        name: 'm', type: 'tuple',
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
    name: 'hashBridgeMessage',
    type: 'function',
    stateMutability: 'view',
    inputs: [{
      name: 'm', type: 'tuple',
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
    }],
    outputs: [{ type: 'bytes32' }],
  },
  {
    name: 'processedMessages',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(raw, decimals = OCT_DECIMALS) {
  return (Number(BigInt(raw)) / Math.pow(10, decimals)).toFixed(6);
}

function hr() {
  console.log('─'.repeat(60));
}

async function octraRpc(method, params = []) {
  const res = await fetch(`${OCTRA_RPC}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`Octra RPC error: ${json.error.message}`);
  return json.result;
}

async function ethRpc(method, params = []) {
  const res = await fetch(ETH_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`ETH RPC error: ${json.error.message}`);
  return json.result;
}

// ── Step 1: Fetch Locked event from Octra ─────────────────────────────────────

async function getLockedEvent(txHash) {
  console.log('\n📡  Fetching Octra transaction...');

  const tx = await octraRpc('octra_transaction', [txHash]);
  if (!tx) throw new Error('Transaction not found on Octra');
  if (tx.status !== 'confirmed') throw new Error(`Transaction status: ${tx.status} (must be confirmed)`);
  if (tx.to !== OCTRA_BRIDGE_ADDR) throw new Error('Transaction is not to the bridge contract');
  if (tx.encrypted_data !== 'lock_to_eth') throw new Error('Transaction is not a lock_to_eth call');

  console.log(`  ✓ Tx confirmed in epoch ${tx.epoch}`);

  const receipt = await octraRpc('contract_receipt', [txHash]);
  if (!receipt) throw new Error('Could not fetch contract receipt');
  if (!receipt.success) throw new Error(`lock_to_eth failed on-chain: ${receipt.error}`);

  const lockedEvent = receipt.events?.find(e => e.event === 'Locked');
  if (!lockedEvent || lockedEvent.values.length < 4) {
    throw new Error('Locked event not found in contract receipt');
  }

  const [from, amountRaw, ethAddress, nonceStr] = lockedEvent.values;
  const srcNonce = parseInt(nonceStr, 10);
  const epoch    = receipt.epoch;

  console.log(`  ✓ Locked event found`);
  console.log(`    From:       ${from}`);
  console.log(`    Amount:     ${fmt(amountRaw)} OCT (${amountRaw} raw)`);
  console.log(`    Recipient:  ${ethAddress}`);
  console.log(`    srcNonce:   ${srcNonce}`);
  console.log(`    Epoch:      ${epoch}`);

  return { from, amountRaw, ethAddress, srcNonce, epoch };
}

// ── Step 2: Check claim status on Ethereum ────────────────────────────────────

async function checkClaimStatus(lockedData, provider) {
  console.log('\n🔍  Checking claim status on Ethereum...');

  const contract = new ethers.Contract(BRIDGE_CONTRACT, VERIFY_AND_MINT_ABI, provider);

  const msgTuple = {
    version:     MSG.version,
    direction:   MSG.direction,
    srcChainId:  MSG.srcChainId,
    dstChainId:  MSG.dstChainId,
    srcBridgeId: MSG.srcBridgeId,
    dstBridgeId: MSG.dstBridgeId,
    tokenId:     MSG.tokenId,
    recipient:   lockedData.ethAddress,
    amount:      BigInt(lockedData.amountRaw),
    srcNonce:    BigInt(lockedData.srcNonce),
  };

  const msgHash  = await contract.hashBridgeMessage(msgTuple);
  const claimed  = await contract.processedMessages(msgHash);

  console.log(`  Message hash: ${msgHash}`);
  console.log(`  Claimed:      ${claimed ? '✅ YES' : '❌ NO'}`);

  return { msgHash, claimed, msgTuple };
}

// ── Step 3: Check epoch availability on ETH lightClient ──────────────────────

async function checkEpochAvailable(epoch) {
  console.log('\n⏳  Checking epoch availability on Ethereum lightClient...');

  const result = await ethRpc('eth_call', [{ to: LIGHT_CLIENT, data: '0x9cb118bf' }, 'latest']);
  const latestEpoch = parseInt(result, 16);

  console.log(`  Lock epoch:    ${epoch}`);
  console.log(`  Latest epoch:  ${latestEpoch}`);

  if (epoch > latestEpoch) {
    const lag = epoch - latestEpoch;
    const estMin = Math.ceil(lag * 10 / 60);
    console.log(`  ⚠️  Epoch not yet available on ETH (lag: ${lag} epochs, ~${estMin} min)`);
    return false;
  }

  console.log(`  ✓ Epoch ${epoch} is available on Ethereum`);
  return true;
}

// ── Step 4: Fetch gas settings ────────────────────────────────────────────────

async function getGasSettings(provider) {
  if (USE_MANUAL_GAS) {
    console.log('\n⛽  Using manual gas settings from .env:');
    console.log(`    Gas Limit:    ${GAS_LIMIT_ENV}`);
    console.log(`    Max Fee:      ${MAX_FEE_ENV} Gwei`);
    return {
      gasLimit:             BigInt(GAS_LIMIT_ENV),
      maxFeePerGas:         ethers.parseUnits(String(MAX_FEE_ENV), 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('0.1', 'gwei'),
    };
  }

  console.log('\n⛽  Fetching gas price from network...');
  const feeData = await provider.getFeeData();

  const baseFee = feeData.maxFeePerGas && feeData.maxPriorityFeePerGas
    ? feeData.maxFeePerGas - feeData.maxPriorityFeePerGas
    : ethers.parseUnits('3', 'gwei');

  const minTip      = ethers.parseUnits('0.1', 'gwei');
  const maxFee      = baseFee * 110n / 100n + minTip;  // baseFee +10% + tip
  const gasLimit    = BigInt(GAS_LIMIT_ENV);

  const baseFeeGwei = Number(baseFee) / 1e9;
  const maxFeeGwei  = Number(maxFee)  / 1e9;
  const estCostEth  = Number(gasLimit) * Number(maxFee) / 1e18;

  console.log(`    Base fee:     ${baseFeeGwei.toFixed(4)} Gwei`);
  console.log(`    Max fee:      ${maxFeeGwei.toFixed(4)} Gwei`);
  console.log(`    Gas limit:    ${gasLimit}`);
  console.log(`    Est. max cost: ${estCostEth.toFixed(6)} ETH`);

  return { gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: minTip };
}

// ── Step 5: Confirm and execute ───────────────────────────────────────────────

async function confirm(prompt) {
  process.stdout.write(`\n${prompt} [y/N] `);
  return new Promise(resolve => {
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', data => {
      process.stdin.pause();
      resolve(data.trim().toLowerCase() === 'y');
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  hr();
  console.log('  OCT Bridge — Manual wOCT Claim');
  console.log(`  Tx Hash: ${TX_HASH}`);
  console.log(`  Gas mode: ${USE_MANUAL_GAS ? 'MANUAL (.env)' : 'AUTO (network)'}`);
  hr();

  // Setup provider and wallet
  const provider = new ethers.JsonRpcProvider(ETH_RPC);
  const wallet   = new ethers.Wallet(
    PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`,
    provider
  );

  console.log(`\n👛  Wallet address: ${wallet.address}`);

  const ethBalance = await provider.getBalance(wallet.address);
  console.log(`    ETH balance:    ${ethers.formatEther(ethBalance)} ETH`);

  // Step 1: Get Locked event
  const lockedData = await getLockedEvent(TX_HASH);

  // Step 2: Check claim status
  const { msgHash, claimed, msgTuple } = await checkClaimStatus(lockedData, provider);

  if (claimed) {
    hr();
    console.log('\n✅  This transaction has already been claimed!');
    console.log(`    Message hash: ${msgHash}`);
    console.log(`    Amount:       ${fmt(lockedData.amountRaw)} wOCT`);
    console.log(`    Recipient:    ${lockedData.ethAddress}`);
    hr();
    process.exit(0);
  }

  // Step 3: Check epoch
  const epochAvailable = await checkEpochAvailable(lockedData.epoch);
  if (!epochAvailable) {
    hr();
    console.log('\n⏳  Cannot claim yet — epoch not available on Ethereum.');
    console.log('    Please wait and try again later.');
    hr();
    process.exit(1);
  }

  // Step 4: Gas settings
  const gasSettings = await getGasSettings(provider);

  // Check balance
  const maxCost = gasSettings.gasLimit * gasSettings.maxFeePerGas;
  if (ethBalance < maxCost) {
    const needed = ethers.formatEther(maxCost);
    const have   = ethers.formatEther(ethBalance);
    console.log(`\n❌  Insufficient ETH for gas.`);
    console.log(`    Need:  ~${parseFloat(needed).toFixed(6)} ETH`);
    console.log(`    Have:  ${parseFloat(have).toFixed(6)} ETH`);
    process.exit(1);
  }

  // Summary
  hr();
  console.log('\n📋  Claim Summary:');
  console.log(`    Amount:     ${fmt(lockedData.amountRaw)} wOCT`);
  console.log(`    Recipient:  ${lockedData.ethAddress}`);
  console.log(`    Epoch:      ${lockedData.epoch}`);
  console.log(`    srcNonce:   ${lockedData.srcNonce}`);
  console.log(`    Contract:   ${BRIDGE_CONTRACT}`);
  hr();

  // Confirm
  const ok = await confirm('Proceed with verifyAndMint?');
  if (!ok) {
    console.log('\n  Aborted.\n');
    process.exit(0);
  }

  // Step 5: Execute verifyAndMint
  console.log('\n🚀  Sending verifyAndMint transaction...');

  const contract = new ethers.Contract(BRIDGE_CONTRACT, VERIFY_AND_MINT_ABI, wallet);

  const tx = await contract.verifyAndMint(
    BigInt(lockedData.epoch),
    msgTuple,
    [],   // siblings — always empty
    0,    // leafIndex — always 0
    {
      gasLimit:             gasSettings.gasLimit,
      maxFeePerGas:         gasSettings.maxFeePerGas,
      maxPriorityFeePerGas: gasSettings.maxPriorityFeePerGas,
      type: 2,
    }
  );

  console.log(`\n  ✓ Transaction submitted!`);
  console.log(`    Tx hash: ${tx.hash}`);
  console.log(`    https://etherscan.io/tx/${tx.hash}`);
  console.log('\n  Waiting for confirmation...');

  const receipt = await tx.wait();

  hr();
  console.log('\n✅  wOCT Claimed Successfully!');
  console.log(`    Tx hash:     ${receipt.hash}`);
  console.log(`    Block:       ${receipt.blockNumber}`);
  console.log(`    Gas used:    ${receipt.gasUsed.toString()}`);
  console.log(`    Amount:      ${fmt(lockedData.amountRaw)} wOCT`);
  console.log(`    Recipient:   ${lockedData.ethAddress}`);
  console.log(`\n    View on Etherscan:`);
  console.log(`    https://etherscan.io/tx/${receipt.hash}`);
  hr();
}

main().catch(err => {
  console.error('\n❌  Error:', err.message || err);
  process.exit(1);
});
