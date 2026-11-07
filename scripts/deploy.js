const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

const E18 = 10n ** 18n;
const INITIAL_SUPPLY = 1_000_000n * E18;
const TREASURY_FUNDING = 500_000n * E18;
const APR_BPS = 1200n; // 12%

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH\n`);

  const token = await (await ethers.getContractFactory("CairnToken")).deploy(INITIAL_SUPPLY);
  await token.waitForDeployment();
  console.log(`CairnToken     ${token.target}`);

  const treasury = await (await ethers.getContractFactory("RewardTreasury")).deploy(token.target);
  await treasury.waitForDeployment();
  console.log(`RewardTreasury ${treasury.target}`);

  const pool = await (await ethers.getContractFactory("StakingPool")).deploy(token.target, treasury.target, APR_BPS);
  await pool.waitForDeployment();
  console.log(`StakingPool    ${pool.target}`);

  await (await treasury.setPool(pool.target)).wait();
  await (await token.transfer(treasury.target, TREASURY_FUNDING)).wait();
  console.log(`\nTreasury linked to pool and funded with ${ethers.formatEther(TREASURY_FUNDING)} CAIRN`);

  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployer: deployer.address,
    aprBps: Number(APR_BPS),
    token: token.target,
    treasury: treasury.target,
    pool: pool.target,
    constructorArgs: {
      token: [INITIAL_SUPPLY.toString()],
      treasury: [token.target],
      pool: [token.target, treasury.target, APR_BPS.toString()],
    },
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(out, null, 2));

  console.log("\nPaste this into cairn-frontend/.env.local:\n");
  console.log("NEXT_PUBLIC_DEMO_MODE=false");
  console.log(`NEXT_PUBLIC_TOKEN_ADDRESS=${token.target}`);
  console.log(`NEXT_PUBLIC_POOL_ADDRESS=${pool.target}`);
  console.log(`NEXT_PUBLIC_TREASURY_ADDRESS=${treasury.target}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
