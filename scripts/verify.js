// Verifies all three contracts on Etherscan using deployments/sepolia.json
const { execSync } = require("child_process");
const d = require("../deployments/sepolia.json");

const run = (addr, args) =>
  execSync(`npx hardhat verify --network sepolia ${addr} ${args.join(" ")}`, { stdio: "inherit" });

run(d.token, d.constructorArgs.token);
run(d.treasury, d.constructorArgs.treasury);
run(d.pool, d.constructorArgs.pool);
