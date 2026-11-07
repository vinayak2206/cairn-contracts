// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RewardTreasury} from "./RewardTreasury.sol";

/// @title StakingPool
/// @notice Users stake CAIRN and earn simple (non-compounding) interest at a fixed APR.
/// @dev Rewards are paid from the RewardTreasury. Principal never touches the treasury, so a
///      depleted treasury can delay reward claims but can never lock user deposits.
///      The APR is immutable, which keeps per-user accrual exact (no retroactive rate changes).
contract StakingPool is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    uint256 public constant YEAR = 365 days;
    uint256 public constant MAX_APR_BPS = 5_000; // 50% cap

    IERC20 public immutable stakingToken;
    RewardTreasury public immutable treasury;
    uint256 public immutable aprBps;

    uint256 public totalStaked;

    struct Position {
        uint256 staked; // principal currently staked
        uint256 banked; // rewards accrued before the last update, not yet claimed
        uint64 updatedAt; // timestamp of the last accrual
    }

    mapping(address => Position) private positions;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);

    error ZeroAmount();
    error InsufficientStake();
    error NothingToClaim();
    error AprTooHigh();

    constructor(IERC20 _stakingToken, RewardTreasury _treasury, uint256 _aprBps) {
        if (_aprBps > MAX_APR_BPS) revert AprTooHigh();
        stakingToken = _stakingToken;
        treasury = _treasury;
        aprBps = _aprBps;
    }

    // ───────────── views ─────────────

    function stakedBalance(address user) external view returns (uint256) {
        return positions[user].staked;
    }

    /// @notice Total unclaimed rewards for a user, including those accruing right now.
    function earned(address user) public view returns (uint256) {
        Position storage p = positions[user];
        return p.banked + _pending(p);
    }

    // ───────────── actions ─────────────

    /// @notice Stake `amount` CAIRN. The caller must approve this contract first.
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Position storage p = positions[msg.sender];
        _settle(p);
        p.staked += amount;
        totalStaked += amount;
        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(msg.sender, amount);
    }

    /// @notice Withdraw `amount` of staked CAIRN. Accrued rewards stay claimable.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Position storage p = positions[msg.sender];
        if (amount > p.staked) revert InsufficientStake();
        _settle(p);
        p.staked -= amount;
        totalStaked -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Claim all accrued rewards from the treasury.
    function claimRewards() external nonReentrant {
        Position storage p = positions[msg.sender];
        _settle(p);
        uint256 reward = p.banked;
        if (reward == 0) revert NothingToClaim();
        p.banked = 0;
        treasury.payReward(msg.sender, reward);
        emit RewardsClaimed(msg.sender, reward);
    }

    // ───────────── internals ─────────────

    function _pending(Position storage p) private view returns (uint256) {
        if (p.staked == 0 || p.updatedAt == 0) return 0;
        return (p.staked * aprBps * (block.timestamp - p.updatedAt)) / (BPS * YEAR);
    }

    function _settle(Position storage p) private {
        p.banked += _pending(p);
        p.updatedAt = uint64(block.timestamp);
    }
}
