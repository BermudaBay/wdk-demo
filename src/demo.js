// Bermuda × WDK demo: shield test USDT (tUSDT) on Plasma testnet, then pay Bob and Carol
// privately with encrypted memos. Everything comes from one seed-backed WDK wallet.
//
//   npm run balance  -- alice                               what Alice has, public and shielded
//   npm run shield   -- alice 1000                          Alice's public tUSDT → Alice shielded (fees included)
//   npm run transfer -- bob 500 "Salary Nov" carol 250 "Design bounty"
//                                                           one private transaction, a memo per recipient
//   npm run balance  -- bob carol                           did it arrive?
//   npm run history  -- bob carol                           received payments with their memos
//   npm run unshield -- carol 100 dave                      Carol's shielded tUSDT → Dave's brand-new public address
//
// Optional: `npm run inspect -- <hash>` (is my public address in this tx?).

import { JsonRpcProvider } from 'ethers'
import {
  createWallet, assertPlasmaTestnet, confirmed, shieldedBalance, receivedPayments, relayerFailure, retryRelay,
  TOKEN, SYMBOL, POOL, RPC_URL, units, fmt, fmtXpl, short, step, row, green, red, dim
} from './lib.js'

// ── Who is who: three shielded accounts from the demo seed ─────────────────────
// Alice is you. Bob and Carol come from the same seed so the demo can show what they
// received. In a real app they are other people, and you pay their Bermuda address.
const PEOPLE = {
  alice: 0, // getBermudaAccount(0, 0): the shielded twin of getAccount(0)
  bob: 1, //   getBermudaAccount(0, 1)
  carol: 2 //  getBermudaAccount(0, 2)
}

// Dave has no shielded account, only a public address: getAccount(FRESH_ACCOUNT) from the
// same seed, never used before. Bump FRESH_ACCOUNT for a brand-new Dave.
// RECIPIENT_PUBLIC replaces Dave's address with any public address you like.
const DAVE = Number(process.env.FRESH_ACCOUNT || 1)

// ── The whole integration ─────────────────────────────────────────────────────
async function openWallet () {
  const wallet = createWallet() // new WalletManagerBermuda(seed, { provider })

  const publicAccount = await wallet.getAccount(0) // ordinary WDK EVM account, unchanged
  const shielded = await wallet.getBermudaAccount(0, 0) // NEW: its shielded twin

  return { wallet, publicAccount, shielded }
}

function bermudaAccount (wallet, name) {
  if (!(name in PEOPLE)) throw new Error(`Unknown name "${name}". Use: ${Object.keys(PEOPLE).join(', ')}`)
  return wallet.getBermudaAccount(0, PEOPLE[name])
}
const title = (name) => name[0].toUpperCase() + name.slice(1)

// ── 1. Balance: what does each person hold? ───────────────────────────────────
async function balance (...names) {
  await assertPlasmaTestnet()
  const { wallet, publicAccount } = await openWallet()
  try {
    for (const name of names.length ? names.map((n) => n.toLowerCase()) : Object.keys(PEOPLE)) {
      const account = await bermudaAccount(wallet, name)
      step(`${title(name)}  ${dim(`getBermudaAccount(0, ${PEOPLE[name]})`)}`)
      if (name === 'alice') {
        row('Public address', await publicAccount.getAddress())
        row('XPL (gas)', fmtXpl(await publicAccount.getBalance()))
        row(`${SYMBOL} public`, fmt(await publicAccount.getTokenBalance(TOKEN)))
      }
      row('Bermuda address', short(account.getAddress()))
      row(`${SYMBOL} shielded`, green(fmt(await account.getTokenBalance(TOKEN))))
    }
  } finally {
    wallet.dispose()
  }
}

// ── 2. Shield: Alice's public tokens → someone's shielded account ─────────────
async function shield (name, amount) {
  if (!name || !amount) throw new Error('Usage: npm run shield -- <name> <amount>')
  name = name.toLowerCase()
  const budget = units(amount)
  const { wallet, publicAccount, shielded } = await openWallet()
  try {
    const recipient = await bermudaAccount(wallet, name)
    const to = recipient.getAddress()

    step(`Shield up to ${fmt(budget)} for ${title(name)} (fees included)`)
    if (await publicAccount.getBalance() === 0n) throw new Error('No XPL for gas on the public address')
    if (await publicAccount.getTokenBalance(TOKEN) < budget) throw new Error(`Public ${SYMBOL} balance is below ${fmt(budget)}`)

    // tUSDT (like USD₮0 on testnet) has no permit, so the pool needs an allowance first.
    const current = await publicAccount.getAllowance(TOKEN, POOL)
    if (current !== budget) {
      if (current !== 0n) {
        const { hash } = await publicAccount.approve({ token: TOKEN, spender: POOL, amount: 0n })
        await confirmed(publicAccount, hash, 'reset allowance')
      }
      const { hash } = await publicAccount.approve({ token: TOKEN, spender: POOL, amount: budget })
      await confirmed(publicAccount, hash, 'approve')
    }

    // One call: the SDK builds the ZK proof and submits the deposit.
    const hash = await shielded.deposit(
      { token: TOKEN, to, amount: budget },
      { exactOutputAmounts: false } // budget = max spend; protocol fees come out of it
    )
    await confirmed(publicAccount, hash, 'deposit')

    const balance = await shieldedBalance(recipient, { atLeast: 1n })
    row('shielded balance', green(fmt(balance)))
  } finally {
    wallet.dispose()
  }
}

// ── 3. Private transfer: one shielded transaction, a memo per recipient ───────
async function transfer (...args) {
  if (!args.length || args.length % 3) {
    throw new Error('Usage: npm run transfer -- <name> <amount> "<memo>" [<name> <amount> "<memo>" …]')
  }
  const { wallet, publicAccount, shielded } = await openWallet()
  try {
    step('Private transfer, one shielded transaction')
    const recipients = []
    for (let i = 0; i < args.length; i += 3) {
      const [name, amount, memo] = [args[i].toLowerCase(), units(args[i + 1]), args[i + 2]]
      const to = (await bermudaAccount(wallet, name)).getAddress()
      recipients.push({ to, amount, memo })
      row(title(name), `${fmt(amount)}  ${dim(`"${memo}"`)}`)
    }

    const hash = await shielded.transfer({ token: TOKEN, recipients })
    await confirmed(publicAccount, hash, 'transfer')
    row('relayed by', dim('Bermuda relayer, not your public address'))
  } finally {
    wallet.dispose()
  }
}

// ── 4. History: received payments and their decrypted memos ──────────────────
async function history (...args) {
  const all = args.includes('--all') // also payments spent since (e.g. by a sweep)
  const names = args.filter((arg) => arg !== '--all').map((n) => n.toLowerCase())
  const { wallet } = await openWallet()
  try {
    for (const name of names.length ? names : Object.keys(PEOPLE)) {
      const account = await bermudaAccount(wallet, name)
      step(`${title(name)}  ${dim(`getBermudaAccount(0, ${PEOPLE[name]})`)}`)

      const payments = await receivedPayments(account, { includeSpent: all })
      if (!payments.length) row('', dim(all ? 'no payments received' : 'none left in the balance (--all shows spent ones)'))
      for (const { amount, memo, spent } of payments) {
        row(`+ ${fmt(amount)}`, (memo ? `"${memo}"` : dim('no memo')) + (spent ? dim('  spent') : ''))
      }
    }
  } finally {
    wallet.dispose()
  }
}

// ── 5. Unshield: Carol's shielded tokens → Dave's public address ──────────────
async function unshield (name, amount, recipient = 'dave') {
  if (!name || !amount || recipient.toLowerCase() !== 'dave') throw new Error('Usage: npm run unshield -- <name> <amount> dave')
  name = name.toLowerCase()
  const value = units(amount)
  const { wallet, publicAccount } = await openWallet()
  try {
    const sender = await bermudaAccount(wallet, name)
    const dave = await wallet.getAccount(DAVE)
    const to = process.env.RECIPIENT_PUBLIC || (await dave.getAddress())

    step(`Unshield ${fmt(value)}: ${title(name)} (shielded) → Dave (public)`)
    const before = await sender.getTokenBalance(TOKEN)
    if (before < value) throw new Error(`${title(name)} has only ${fmt(before)} shielded`)
    row('from', `${title(name)}  ${dim(`getBermudaAccount(0, ${PEOPLE[name]})`)}`)
    row('to', `Dave   ${to}` + (process.env.RECIPIENT_PUBLIC ? '' : `  ${dim(`getAccount(${DAVE})`)}`))

    // One call: the SDK builds the ZK proof, the Bermuda relayer submits it. The sender needs no gas.
    const hash = await sender.withdraw({ token: TOKEN, to, amount: value })
    await confirmed(publicAccount, hash, 'withdraw')

    row(`${title(name)} ${SYMBOL} shielded`, green(fmt(await shieldedBalance(sender, { atMost: before - value }))))
    if (!process.env.RECIPIENT_PUBLIC) row(`Dave ${SYMBOL} public`, green(fmt(await dave.getTokenBalance(TOKEN))))
  } finally {
    wallet.dispose()
  }
}

// ── Optional: inspect, is my public address anywhere in this tx? ──────────────
async function inspect (hash) {
  if (!hash) throw new Error('Usage: npm run inspect -- <tx hash>')
  const { wallet, publicAccount } = await openWallet()
  const provider = new JsonRpcProvider(RPC_URL)
  try {
    const me = (await publicAccount.getAddress()).toLowerCase().slice(2)
    const [tx, receipt] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)])

    const haystack = [tx.from, tx.to, tx.data, ...receipt.logs.flatMap((log) => [log.data, ...log.topics])]
      .join(' ').toLowerCase()

    step(`Inspect ${hash.slice(0, 18)}…`)
    row('sent by', tx.from.toLowerCase().includes(me) ? 'you' : `${tx.from} ${dim('(relayer)')}`)
    row('your address', haystack.includes(me) ? red('FOUND in this transaction') : green('not in this transaction'))
  } finally {
    provider.destroy()
    wallet.dispose()
  }
}

// ── Sweep: pull every shielded balance back to Alice's public account (#0) ────
async function sweep () {
  const { wallet, publicAccount } = await openWallet()
  try {
    const to = await publicAccount.getAddress()
    step('Sweep shielded balances back to public account #0')
    for (const name of Object.keys(PEOPLE)) {
      const account = await bermudaAccount(wallet, name)
      const balance = await account.getTokenBalance(TOKEN)
      row(title(name), balance === 0n ? dim('empty') : fmt(balance))
      if (balance === 0n) continue
      // Gross-spend mode: withdraw the whole balance, fees (if any) come out of it.
      // retryRelay: tries again if the hosted relayer failed before broadcasting (nothing was sent).
      await retryRelay(async () => {
        const hash = await account.withdraw({ token: TOKEN, to, amount: balance }, { exactOutputAmounts: false })
        await confirmed(publicAccount, hash, 'withdraw')
      })
    }
    row(`${SYMBOL} public`, fmt(await publicAccount.getTokenBalance(TOKEN)))
  } finally {
    wallet.dispose()
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const commands = { balance, shield, transfer, history, unshield, inspect, sweep }
const [name, ...args] = process.argv.slice(2)

if (!commands[name]) {
  console.error(`Usage: node src/demo.js <${Object.keys(commands).join('|')}> [args]`)
  process.exit(1)
}

try {
  await commands[name](...args)
  process.exit(0)
} catch (error) {
  console.error(red(`\n✗ ${relayerFailure(error)?.text ?? error.message}`))
  if (process.env.DEBUG) console.error(error)
  process.exit(1)
}
