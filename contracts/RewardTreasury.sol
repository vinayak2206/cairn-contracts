// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title RewardTreasury
/// @notice Holds the tokens that are paid out as staking rewards.
/// @dev There is deliberately no owner withdrawal function: once funded, tokens can only leave
///      through the StakingPool paying a user's reward. The pool address can be set exactly once.
contract RewardTreasury is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public pool;

    event PoolSet(address indexed pool);
    event RewardPaid(address indexed to, uint256 amount);

    error PoolAlreadySet();
    error InvalidAddress();
    error NotPool();

    constructor(IERC20 _token) Ownable(msg.sender) {
        token = _token;
    }

    /// @notice Authorise the staking pool to pay rewards. Callable once, by the owner.
    function setPool(address _pool) external onlyOwner {
        if (pool != address(0)) revert PoolAlreadySet();
        if (_pool == address(0)) revert InvalidAddress();
        pool = _pool;
        emit PoolSet(_pool);
    }

    /// @notice Pay a reward to a user. Only the staking pool may call this.
    function payReward(address to, uint256 amount) external {
        if (msg.sender != pool) revert NotPool();
        token.safeTransfer(to, amount);
        emit RewardPaid(to, amount);
    }

    /// @notice Reward tokens currently available.
    function reserve() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
