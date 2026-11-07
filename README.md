# Cairn contracts (Hardhat + Solidity)

Three contracts for the Cairn staking dApp, built to match `cairn-frontend`.

| Contract | Role |
| --- | --- |
| `CairnToken` | ERC-20 (CAIRN). Public `faucet()` gives 1,000 test CAIRN per address per hour. |
| `RewardTreasury` | Holds reward tokens. Only the pool can pay out of it. The pool is set once, and there is no owner withdrawal. |
| `StakingPool` | `stake`, `withdraw`, `claimRewards`. Simple interest at a fixed, immutable APR (12%, capped at 50%). |

Design notes worth putting in the whitepaper:
- Principal never touches the treasury, so an empty treasury can block reward claims but never locks deposits (tested).
- The APR is immutable, so accrual per user is exact and cannot be changed retroactively.
- `ReentrancyGuard`, `SafeERC20` and custom errors are used throughout.
- The faucet is for testnet only and would be removed for a real launch.

## 1. Run tests locally (no wallet or ETH needed)

```bash
npm install
npx hardhat test          # 27 tests
npx hardhat coverage      # optional coverage report
npx hardhat run scripts/deploy.js     # dry-run on the built-in local network
```

## 2. Deploy to Sepolia

1. Create a **new throwaway MetaMask account** just for this project. Never use a wallet that holds real funds.
2. Get Sepolia test ETH from a faucet (search "Sepolia faucet"; Alchemy and Google Cloud both run one).
3. Get a free RPC URL from Alchemy or Infura (Sepolia network) and a free Etherscan API key.
4. Copy `.env.example` to `.env` and fill in `SEPOLIA_RPC_URL`, `PRIVATE_KEY` (export from the throwaway account) and `ETHERSCAN_API_KEY`.
5. Deploy:

```bash
npm run deploy:sepolia
```

The script prints the three addresses, saves them to `deployments/sepolia.json`, and prints the lines to paste into `cairn-frontend/.env.local`.

6. Verify on Etherscan (so graders can read the code):

```bash
npm run verify:sepolia
```

## 3. Connect the frontend

Put the printed `NEXT_PUBLIC_*` lines in `cairn-frontend/.env.local`, restart `npm run dev`, switch MetaMask to Sepolia, and use the app.
