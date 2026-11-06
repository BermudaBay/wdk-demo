# Bermuda × WDK demo

Private balances for a [WDK](https://docs.wdk.tether.io/) wallet on Plasma testnet. Shield tokens, pay people privately with encrypted memos, and unshield to a fresh address.

It uses [`@bermuda/wdk-wallet-evm-bermuda`](https://github.com/BermudaBay/wdk-wallet-evm-bermuda), a drop-in replacement for `WalletManagerEvm`: same seed, same accounts, plus a shielded account for each one. Module docs: [Wallet EVM Bermuda](https://docs.wdk.tether.io/sdk/wallet-modules/wallet-evm-bermuda).

> Beta, **Plasma testnet only**. Use a testnet-only seed.

## Setup

Node 22 or newer.

```bash
npm install
npm run new-wallet   # writes .env with a fresh testnet seed and prints the address to fund
```

The module is installed from GitHub. With npm 12 or newer, allow that: `npm install --allow-git=root --allow-remote=all`.

Fund the printed address on Plasma testnet with:
- **XPL** for gas (testnet faucets: gas.zip, QuickNode, Chainstack)
- the **ERC-20 token** set as `TOKEN` in `.env`

About the token: the default `TUSDT` is a valueless test USDT that Bermuda minted for its own demo, so you can't get it yourself. Set `TOKEN` to an ERC-20 you hold on Plasma testnet that the Bermuda pool accepts: `USDT0` or a token address.

Check that everything is in place:

```bash
npm run balance
```

## Who is who

Every person comes from your seed, so the demo can show both sides of a payment. In a real app you'd pay someone else's Bermuda address.

| Name | Account | |
|---|---|---|
| Alice | `getBermudaAccount(0, 0)` | You. The shielded twin of the public account `getAccount(0)`, which holds the tokens and XPL |
| Bob | `getBermudaAccount(0, 1)` | Shielded account |
| Carol | `getBermudaAccount(0, 2)` | Shielded account |
| Dave | `getAccount(FRESH_ACCOUNT)` | Public address only, never used before. Receives the unshield |

## The flow

```bash
npm run balance  -- alice                                   # Alice: public and shielded balance
npm run shield   -- alice 1000                              # public tokens → Alice's shielded balance
npm run transfer -- bob 500 "Salary · Nov" carol 250 "Design bounty"
npm run balance  -- bob carol                               # did it arrive?
npm run history  -- bob carol                               # received payments with their memos
npm run unshield -- carol 100 dave                          # Carol's shielded tokens → Dave's public address
```

## Commands

| Command | What it does |
|---|---|
| `npm run drop-in` | Shows that `WalletManagerBermuda` gives the same address as `WalletManagerEvm` for the same seed, plus a shielded address |
| `npm run balance -- [names…]` | Shielded balance per person. For Alice also her public address, XPL and public token balance. No names: everyone |
| `npm run shield -- <name> <amount>` | `approve` + `deposit()`: Alice's public tokens → that person's shielded balance. The amount is the maximum spend, fees included |
| `npm run transfer -- <name> <amount> "<memo>" …` | `transfer({ recipients })`: one shielded transaction to one or more people, each with an encrypted memo. Sent by the Bermuda relayer, not by your address |
| `npm run history -- [names…] [--all]` | Received payments with their decrypted memos. By default only what is still in the balance, `--all` adds spent ones. *Reads the Bermuda SDK through internal fields: not a WDK method yet* |
| `npm run unshield -- <name> <amount> dave` | `withdraw()`: that person's shielded tokens → Dave's public address. Relayed, so no gas needed |
| `npm run inspect -- <tx hash>` | Is Alice's public address anywhere in this transaction? |
| `npm run sweep` | Withdraws every shielded balance back to Alice's public address |
| `npm run new-wallet` | Creates `.env` with a fresh testnet seed |

## What is visible on-chain

- **Shield:** public. The tokens leave Alice's public address.
- **Transfer:** your address isn't in the transaction, and it doesn't show who got paid or how much.
- **Unshield:** the public recipient (Dave) and the amount are visible.

Try it with `npm run inspect -- <hash>` on a shield and on a transfer.

## `.env`

| Key | |
|---|---|
| `SEED` | Testnet-only BIP-39 seed (`npm run new-wallet` creates one) |
| `RPC_URL` | Plasma testnet RPC, chain 9746 |
| `TOKEN` | Token to shield: `TUSDT`, `USDT0` or an ERC-20 address |
| `FRESH_ACCOUNT` | Dave's public account index. Bump it for a never-used address |
| `RECIPIENT_PUBLIC` | Optional: unshield to this address instead of Dave |
| `MAX_FEE_XPL` | Optional: max network fee per public transaction (approve, deposit), in XPL |

## Files

- `src/demo.js`: the integration, one function per command
- `src/lib.js`: plumbing (config, formatting, chain checks, confirmations, relayer errors)
- `src/drop-in.js`: the before/after class swap
- `src/new-wallet.js`: creates a testnet seed

Set `DEBUG=1` for full error stacks.
