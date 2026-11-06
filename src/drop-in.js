// "It's a drop-in": same seed, same config, same getAccount(0).
// WalletManagerBermuda IS a WalletManagerEvm, plus one new method.

import 'dotenv/config'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import WalletManagerBermuda from '@bermuda/wdk-wallet-evm-bermuda'
import { RPC_URL, short, row, step, green } from './lib.js'

const seed = process.env.SEED
const config = { provider: RPC_URL }

// Before
const before = new WalletManagerEvm(seed, config)
// After: one import, one class name
const after = new WalletManagerBermuda(seed, config)

const beforeAddress = await (await before.getAccount(0)).getAddress()
const afterAddress = await (await after.getAccount(0)).getAddress()

step('Same wallet')
row('WalletManagerEvm', beforeAddress)
row('WalletManagerBermuda', afterAddress)
row('same account?', green(String(beforeAddress === afterAddress)))
row('is an EVM manager?', green(String(after instanceof WalletManagerEvm)))

step('Plus a shielded account')
const shielded = await after.getBermudaAccount(0, 0)
row('getBermudaAccount', short(shielded.getAddress()))

before.dispose()
after.dispose()
process.exit(0)
