// Demo plumbing: config, formatting, chain checks, confirmations.
// Nothing in here is Bermuda-specific magic. A real app would write its own.

import 'dotenv/config'
import WalletManagerBermuda from '@bermuda/wdk-wallet-evm-bermuda'
import { Contract, JsonRpcProvider, formatUnits, parseUnits, parseEther } from 'ethers'

// ── Plasma testnet (chain 9746) ───────────────────────────────────────────────
export const RPC_URL = process.env.RPC_URL || 'https://testnet-rpc.plasma.to'
export const CHAIN_ID = 9746n
export const POOL = '0xa1F6bB903B994d4eeBE77867947EaE422D2D34DB' // Bermuda pool, from the WDK docs
export const USDT0 = '0x502012b361AebCE43b26Ec812B74D9a51dB4D412' // USD₮0, from the WDK docs
// Test USDT (tUSDT, 6 decimals) that Bermuda minted for this demo. No value, not USD₮0.
export const TUSDT = '0xF7306dc7211ff90E9eA261e9A48ca187BfF783B8'
export const EXPLORER = 'https://testnet.plasmascan.to/tx/'

// The ERC-20 the demo shields. tUSDT by default; set TOKEN=USDT0 or an address in .env.
const TOKENS = { TUSDT, USDT0 }
export const TOKEN = TOKENS[process.env.TOKEN?.toUpperCase()] || process.env.TOKEN || TUSDT

const SEED = process.env.SEED

// ── Wallet ────────────────────────────────────────────────────────────────────
export function createWallet () {
  if (!SEED) throw new Error('Set SEED in .env (see .env.example or run `npm run new-wallet`)')

  const config = {
    provider: RPC_URL,
    // Rejects a public EVM tx (approve / deposit) whose estimated network fee is above this.
    transactionMaxFee: parseEther(process.env.MAX_FEE_XPL || '0.01')
  }

  const wallet = new WalletManagerBermuda(SEED, config)

  // For a transfer or withdraw, the SDK waits for the receipt itself before it hands back the hash
  // (it proves again if the proof's period ran out). Its provider polls every 4 s, ethers' default.
  // Plasma makes a block every second: poll every second. Each Bermuda account has its own SDK.
  const getBermudaAccount = wallet.getBermudaAccount.bind(wallet)
  wallet.getBermudaAccount = async (...args) => {
    const account = await getBermudaAccount(...args)
    const provider = account._bermuda.config.provider
    if (provider && 'pollingInterval' in provider) provider.pollingInterval = 1_000
    return account
  }
  return wallet
}

// ── Token metadata (read once from chain) ─────────────────────────────────────
async function loadToken () {
  const provider = new JsonRpcProvider(RPC_URL)
  try {
    const token = new Contract(TOKEN, [
      'function symbol() view returns (string)',
      'function decimals() view returns (uint8)'
    ], provider)
    const [symbol, decimals] = await Promise.all([token.symbol(), token.decimals()])
    return { SYMBOL: symbol, DECIMALS: Number(decimals) }
  } finally {
    provider.destroy()
  }
}
export const { SYMBOL, DECIMALS } = await loadToken()

// ── Formatting ────────────────────────────────────────────────────────────────
export const units = (value) => parseUnits(String(value), DECIMALS)
export const fmt = (amount) => `${formatUnits(amount, DECIMALS)} ${SYMBOL}`
export const fmtXpl = (amount) => `${Number(formatUnits(amount, 18)).toFixed(4)} XPL`
export const short = (address) => address.length > 42
  ? `${address.slice(0, 10)}…${address.slice(-6)}  (${address.length - 2} hex chars)`
  : address

const color = (code) => (text) => process.stdout.isTTY ? `\x1b[${code}m${text}\x1b[0m` : text
export const green = color('32')
export const red = color('31')
export const dim = color('2')
export const bold = color('1')

export const step = (text) => console.log(`\n${bold('▸ ' + text)}`)
export const row = (label, value) => console.log(`  ${label.padEnd(21)} ${value}`)

// ── Chain checks ──────────────────────────────────────────────────────────────
export async function assertPlasmaTestnet () {
  const provider = new JsonRpcProvider(RPC_URL)
  try {
    const { chainId } = await provider.getNetwork()
    if (chainId !== CHAIN_ID) throw new Error(`RPC is on chain ${chainId}, expected Plasma testnet (9746)`)

    const [tokenCode, poolCode] = await Promise.all([provider.getCode(TOKEN), provider.getCode(POOL)])
    if (tokenCode === '0x' || poolCode === '0x') throw new Error(`${SYMBOL} or Bermuda pool not found on this RPC`)

    return { chainId }
  } finally {
    provider.destroy()
  }
}

// ── Confirmation ──────────────────────────────────────────────────────────────
// Every Bermuda operation returns a tx hash. A hash is not a receipt: wait for it.
// Plasma makes a block every second, WDK polls every 4 s by default: poll every second instead.
export async function confirmed (publicAccount, hash, label) {
  row(label, dim(EXPLORER + hash))
  const result = await publicAccount.waitForTransaction(hash, { target: 'confirmed', interval: 1_000, timeout: 180_000 })
  if (result.success !== true) throw new Error(`${label} failed on-chain: ${hash}`)
  row('', green('✓ confirmed'))
  return result
}

// ── Received payments (not a WDK module method yet) ───────────────────────────
// The Bermuda SDK decrypts incoming payments (amount + memo), but the WDK module has no
// public method for them yet. This reads them through the account's protected SDK fields.
// Default: only payments still in the balance. includeSpent: also the ones spent since.
export async function receivedPayments (account, { includeSpent = false } = {}) {
  const token = TOKEN.toLowerCase()
  const find = async (excludeSpent) =>
    (await account._bermuda.findUtxos({ keypair: account._bermudaKeyPair, tokens: [token], excludeSpent }))[token] ?? []

  const notes = await find(!includeSpent)
  const unspent = includeSpent ? new Set((await find(true)).map((note) => note.index)) : null
  return notes
    .filter((note) => note.amount > 0n)
    .sort((a, b) => (a.index < b.index ? -1 : 1))
    .map((note) => ({
      amount: note.amount,
      memo: new TextDecoder().decode(note.memo).replace(/\0+$/, ''),
      spent: unspent ? !unspent.has(note.index) : false
    }))
}

// ── Bermuda relayer errors ────────────────────────────────────────────────────
// The hosted relayer answers a failed relay with an HTML error page that hides the cause in
// base64. If the failing call was eth_simulateV1, the relayer's dry run before it broadcasts,
// nothing was sent and the call can safely be tried again.
export function relayerFailure (error) {
  const message = String(error?.message ?? '')
  if (!message.startsWith('Relay request failed')) return null
  const encoded = message.match(/id="__bunfallback"[^>]*>\s*([A-Za-z0-9+/=]+)\s*</)?.[1]
  const page = encoded ? Buffer.from(encoded, 'base64').toString('utf8') : ''
  const method = page.match(/"method":"([^"]+)"/)?.[1] ?? 'unknown RPC call'
  const details = page.match(/Details: ([^\n]*)/)?.[1]?.split('. ')[0] ?? message.split(':')[0]
  const notSent = method === 'eth_simulateV1'
  return {
    notSent,
    text: `Bermuda relayer failed on ${method}: ${details}` +
      (notSent ? '\n  Nothing was sent (the relayer\'s dry run failed). Run the command again.' : '')
  }
}

// Retry a relayed call, but only when the relayer failed before broadcasting.
export async function retryRelay (call, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call()
    } catch (error) {
      const failure = relayerFailure(error)
      if (!failure?.notSent || attempt === attempts) throw error
      row('', dim(`relayer dry run failed, nothing sent. Retry ${attempt}/${attempts - 1}`))
    }
  }
}

// Shielded balances come from an SDK scan that can lag a block behind. Poll briefly until
// the balance is in range: atLeast after money came in, atMost after money went out.
export async function shieldedBalance (account, { atLeast = 0n, atMost = null, tries = 30 } = {}) {
  let balance = 0n
  for (let i = 0; i < tries; i++) {
    balance = await account.getTokenBalance(TOKEN)
    if (balance >= atLeast && (atMost === null || balance <= atMost)) return balance
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  return balance
}
