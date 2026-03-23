# Prediction Pool (Solana Devnet Escrow)

A simple on-chain prediction pool built with Anchor on Solana Devnet.
Users join with an entry fee (escrow in a PDA vault), the creator resolves the outcome, and winners can claim a proportional payout.

## Features
- Create a pool (question + labels A/B + entry fee + close time)
- Join a pool (A or B) depositing SOL into a vault (PDA)
- Resolve pool (creator chooses the winning option after close time)
- Claim rewards (winners withdraw from the vault)

## Devnet Program ID
7NLjaEBsWDCXH9cETogmG1WuPnMnQEvyWgEYV5d3YB3g

## Demo Transactions (Devnet)
- create_pool: 3T7QcSijCGmCQKkqJDXYk92nENjocsatWXsYcSixV6bLdE48CNfUHcNRMjvsATqScbazEUTHBT2bEvPqaZYRtkn
- join_pool: MpdgQeFxxWFHfEGLBHrp8PZ8y676iy9oKVPdTjCwfoUeVWABqMTrDZyTD8QT6hyYaojoSJ18CD8ytivqDSvsCh
- resolve_pool: 2KTY5B7az8oTVWQN3x4jBUsFh5HDP1asyQGgBXimcRgFAyP37FpHWTbHDzJvGMUFdmsgKCfQJjfdvyMDGZNLSWFc
- claim: TNgs56z5o7ZTkqGSiZUSKVKokuaR7LPpWG7zJBZc76bFPwjDwAPvcVqE7dEVSBGDdqq3S36MaBDeQxnYLk4VUEP

## How to run in Solana Playground
1. Open Solana Playground (Anchor project)
2. Build and Deploy on Devnet
3. Run `client.ts` to execute:
   create_pool -> join_pool -> resolve_pool -> claim
