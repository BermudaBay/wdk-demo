// Create a fresh testnet seed and print the address to fund.
// Writes .env if it doesn't exist yet. Testnet only, never reuse this seed for real funds.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import WalletManagerBermuda from '@bermuda/wdk-wallet-evm-bermuda'

if (existsSync('.env') && /^SEED=./m.test(readFileSync('.env', 'utf8'))) {
  console.log('.env already has a SEED. Delete it first if you really want a new wallet.')
  process.exit(1)
}

const seed = WalletManagerBermuda.getRandomSeedPhrase()
const example = readFileSync('.env.example', 'utf8')
writeFileSync('.env', example.replace(/^SEED=.*$/m, `SEED=${seed}`), { mode: 0o600 })

const wallet = new WalletManagerBermuda(seed, {})
const address = await (await wallet.getAccount(0)).getAddress()
wallet.dispose()

console.log('Wrote .env with a new testnet seed.\n')
console.log('Fund this Plasma testnet address:')
console.log(`  ${address}`)
console.log('  - XPL for gas (testnet faucets: gas.zip, QuickNode, Chainstack)')
console.log('  - the ERC-20 you set as TOKEN in .env (the README flow shields 1,000)')
