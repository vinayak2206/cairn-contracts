const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const E18 = 10n ** 18n;
const YEAR = 365 * 24 * 60 * 60;
const APR_BPS = 1200n; // 12%

async function deployFixture() {
  const [owner, alice, bob, stranger] = await ethers.getSigners();

  const token = await (await ethers.getContractFactory("CairnToken")).deploy(1_000_000n * E18);
  const treasury = await (await ethers.getContractFactory("RewardTreasury")).deploy(token.target);
  const pool = await (await ethers.getContractFactory("StakingPool")).deploy(token.target, treasury.target, APR_BPS);

  await treasury.setPool(pool.target);
  await token.transfer(treasury.target, 100_000n * E18); // fund rewards
  await token.transfer(alice.address, 10_000n * E18);
  await token.transfer(bob.address, 10_000n * E18);

  return { token, treasury, pool, owner, alice, bob, stranger };
}

async function stakeAs(signer, token, pool, amount) {
  await token.connect(signer).approve(pool.target, amount);
  await pool.connect(signer).stake(amount);
}

describe("CairnToken", () => {
  it("mints the initial supply to the deployer", async () => {
    const { token, owner } = await loadFixture(deployFixture);
    expect(await token.totalSupply()).to.equal(1_000_000n * E18 + 0n);
    expect(await token.symbol()).to.equal("CAIRN");
    expect(await token.decimals()).to.equal(18n);
    expect(await token.balanceOf(owner.address)).to.equal(1_000_000n * E18 - 120_000n * E18);
  });

  it("faucet mints 1,000 CAIRN", async () => {
    const { token, stranger } = await loadFixture(deployFixture);
    await token.connect(stranger).faucet();
    expect(await token.balanceOf(stranger.address)).to.equal(1_000n * E18);
  });

  it("faucet reverts during the cooldown and works again after it", async () => {
    const { token, stranger } = await loadFixture(deployFixture);
    await token.connect(stranger).faucet();
    await expect(token.connect(stranger).faucet()).to.be.revertedWithCustomError(token, "FaucetCooldown");
    await time.increase(60 * 60 + 1);
    await token.connect(stranger).faucet();
    expect(await token.balanceOf(stranger.address)).to.equal(2_000n * E18);
  });
});

describe("RewardTreasury", () => {
  it("lets only the owner set the pool, and only once", async () => {
    const [owner, other] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("CairnToken")).deploy(1000n * E18);
    const treasury = await (await ethers.getContractFactory("RewardTreasury")).deploy(token.target);

    await expect(treasury.connect(other).setPool(other.address)).to.be.revertedWithCustomError(
      treasury,
      "OwnableUnauthorizedAccount"
    );
    await expect(treasury.setPool(ethers.ZeroAddress)).to.be.revertedWithCustomError(treasury, "InvalidAddress");
    await treasury.setPool(owner.address);
    await expect(treasury.setPool(other.address)).to.be.revertedWithCustomError(treasury, "PoolAlreadySet");
  });

  it("only pays rewards when called by the pool", async () => {
    const { treasury, stranger, owner } = await loadFixture(deployFixture);
    await expect(treasury.connect(stranger).payReward(stranger.address, 1n)).to.be.revertedWithCustomError(
      treasury,
      "NotPool"
    );
    await expect(treasury.connect(owner).payReward(owner.address, 1n)).to.be.revertedWithCustomError(
      treasury,
      "NotPool"
    );
  });

  it("reports its reserve", async () => {
    const { treasury } = await loadFixture(deployFixture);
    expect(await treasury.reserve()).to.equal(100_000n * E18);
  });
});

describe("StakingPool", () => {
  describe("deployment", () => {
    it("stores its configuration", async () => {
      const { pool, token, treasury } = await loadFixture(deployFixture);
      expect(await pool.stakingToken()).to.equal(token.target);
      expect(await pool.treasury()).to.equal(treasury.target);
      expect(await pool.aprBps()).to.equal(APR_BPS);
    });

    it("rejects an APR above the cap", async () => {
      const { token, treasury } = await loadFixture(deployFixture);
      const Pool = await ethers.getContractFactory("StakingPool");
      await expect(Pool.deploy(token.target, treasury.target, 5001n)).to.be.revertedWithCustomError(
        Pool,
        "AprTooHigh"
      );
    });
  });

  describe("stake", () => {
    it("moves tokens into the pool and updates balances", async () => {
      const { pool, token, alice } = await loadFixture(deployFixture);
      await token.connect(alice).approve(pool.target, 100n * E18);
      await expect(pool.connect(alice).stake(100n * E18))
        .to.emit(pool, "Staked")
        .withArgs(alice.address, 100n * E18);
      expect(await pool.stakedBalance(alice.address)).to.equal(100n * E18);
      expect(await pool.totalStaked()).to.equal(100n * E18);
      expect(await token.balanceOf(pool.target)).to.equal(100n * E18);
      expect(await token.balanceOf(alice.address)).to.equal(9_900n * E18);
    });

    it("reverts on zero amount", async () => {
      const { pool, alice } = await loadFixture(deployFixture);
      await expect(pool.connect(alice).stake(0)).to.be.revertedWithCustomError(pool, "ZeroAmount");
    });

    it("reverts without approval", async () => {
      const { pool, alice } = await loadFixture(deployFixture);
      await expect(pool.connect(alice).stake(1n * E18)).to.be.reverted;
    });

    it("reverts when the user does not own enough tokens", async () => {
      const { pool, token, stranger } = await loadFixture(deployFixture);
      await token.connect(stranger).approve(pool.target, 1n * E18);
      await expect(pool.connect(stranger).stake(1n * E18)).to.be.reverted;
    });

    it("tracks several users independently", async () => {
      const { pool, token, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 300n * E18);
      await stakeAs(bob, token, pool, 700n * E18);
      expect(await pool.stakedBalance(alice.address)).to.equal(300n * E18);
      expect(await pool.stakedBalance(bob.address)).to.equal(700n * E18);
      expect(await pool.totalStaked()).to.equal(1000n * E18);
    });
  });

  describe("rewards", () => {
    it("is zero before staking", async () => {
      const { pool, alice } = await loadFixture(deployFixture);
      expect(await pool.earned(alice.address)).to.equal(0n);
    });

    it("accrues about 12% over one year", async () => {
      const { pool, token, alice } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 1000n * E18);
      await time.increase(YEAR);
      // 12% of 1000 = 120 CAIRN (a few seconds of slack for block timestamps)
      expect(await pool.earned(alice.address)).to.be.closeTo(120n * E18, E18 / 100n);
    });

    it("accrues proportionally over a shorter period", async () => {
      const { pool, token, alice } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 1000n * E18);
      await time.increase(YEAR / 2);
      expect(await pool.earned(alice.address)).to.be.closeTo(60n * E18, E18 / 100n);
    });

    it("keeps earned rewards when staking more", async () => {
      const { pool, token, alice } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 1000n * E18);
      await time.increase(YEAR / 2); // ~60 earned
      await stakeAs(alice, token, pool, 1000n * E18);
      await time.increase(YEAR / 2); // +120 on 2000 for half a year
      // 60 + 2000 * 12% / 2 = 60 + 120 = 180
      expect(await pool.earned(alice.address)).to.be.closeTo(180n * E18, E18 / 50n);
    });

    it("stops accruing on the withdrawn part", async () => {
      const { pool, token, alice } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 1000n * E18);
      await time.increase(YEAR / 2); // ~60
      await pool.connect(alice).withdraw(1000n * E18);
      const atWithdraw = await pool.earned(alice.address);
      await time.increase(YEAR);
      expect(await pool.earned(alice.address)).to.equal(atWithdraw);
    });
  });

  describe("withdraw", () => {
    it("returns principal and keeps rewards claimable", async () => {
      const { pool, token, alice } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 1000n * E18);
      await time.increase(YEAR);
      await expect(pool.connect(alice).withdraw(400n * E18))
        .to.emit(pool, "Withdrawn")
        .withArgs(alice.address, 400n * E18);
      expect(await pool.stakedBalance(alice.address)).to.equal(600n * E18);
      expect(await pool.totalStaked()).to.equal(600n * E18);
      expect(await token.balanceOf(alice.address)).to.equal(9_400n * E18);
      expect(await pool.earned(alice.address)).to.be.gt(119n * E18);
    });

    it("reverts on zero amount", async () => {
      const { pool, alice } = await loadFixture(deployFixture);
      await expect(pool.connect(alice).withdraw(0)).to.be.revertedWithCustomError(pool, "ZeroAmount");
    });

    it("reverts when withdrawing more than staked", async () => {
      const { pool, token, alice } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 100n * E18);
      await expect(pool.connect(alice).withdraw(101n * E18)).to.be.revertedWithCustomError(pool, "InsufficientStake");
    });

    it("does not let one user withdraw another user's stake", async () => {
      const { pool, token, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 500n * E18);
      await expect(pool.connect(bob).withdraw(1n * E18)).to.be.revertedWithCustomError(pool, "InsufficientStake");
    });
  });

  describe("claimRewards", () => {
    it("pays accrued rewards from the treasury", async () => {
      const { pool, token, treasury, alice } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 1000n * E18);
      await time.increase(YEAR);

      const before = await token.balanceOf(alice.address);
      const reserveBefore = await treasury.reserve();
      await expect(pool.connect(alice).claimRewards()).to.emit(pool, "RewardsClaimed");
      const gained = (await token.balanceOf(alice.address)) - before;

      expect(gained).to.be.closeTo(120n * E18, E18 / 100n);
      expect(reserveBefore - (await treasury.reserve())).to.equal(gained);
      expect(await pool.earned(alice.address)).to.equal(0n);
    });

    it("reverts when there is nothing to claim", async () => {
      const { pool, alice } = await loadFixture(deployFixture);
      await expect(pool.connect(alice).claimRewards()).to.be.revertedWithCustomError(pool, "NothingToClaim");
    });

    it("cannot be claimed twice", async () => {
      const { pool, token, alice } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 1000n * E18);
      await time.increase(YEAR);
      await pool.connect(alice).claimRewards();
      // a second claim only gets the few seconds accrued since, never the old amount again
      expect(await pool.earned(alice.address)).to.be.lt(E18 / 100n);
    });

    it("fails when the treasury is empty, but principal can still be withdrawn", async () => {
      const [owner, alice] = await ethers.getSigners();
      const token = await (await ethers.getContractFactory("CairnToken")).deploy(1_000_000n * E18);
      const treasury = await (await ethers.getContractFactory("RewardTreasury")).deploy(token.target);
      const pool = await (await ethers.getContractFactory("StakingPool")).deploy(token.target, treasury.target, APR_BPS);
      await treasury.setPool(pool.target); // intentionally NOT funded
      await token.transfer(alice.address, 1000n * E18);

      await stakeAs(alice, token, pool, 1000n * E18);
      await time.increase(YEAR);

      await expect(pool.connect(alice).claimRewards()).to.be.reverted;
      await pool.connect(alice).withdraw(1000n * E18);
      expect(await token.balanceOf(alice.address)).to.equal(1000n * E18);
    });
  });

  describe("accounting invariant", () => {
    it("pool token balance always equals totalStaked", async () => {
      const { pool, token, alice, bob } = await loadFixture(deployFixture);
      await stakeAs(alice, token, pool, 250n * E18);
      await stakeAs(bob, token, pool, 750n * E18);
      await time.increase(YEAR / 4);
      await pool.connect(alice).withdraw(100n * E18);
      await pool.connect(bob).claimRewards();
      expect(await token.balanceOf(pool.target)).to.equal(await pool.totalStaked());
    });
  });
});
