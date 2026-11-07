// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title CairnToken
/// @notice The ERC-20 token that users stake. Includes a rate-limited public faucet for testnet use.
/// @dev The faucet exists so classmates and graders can try the app on Sepolia. Remove it for a mainnet launch.
contract CairnToken is ERC20 {
    uint256 public constant FAUCET_AMOUNT = 1_000 ether; // 1,000 CAIRN
    uint256 public constant FAUCET_COOLDOWN = 1 hours;

    mapping(address => uint256) public lastFaucetAt;

    error FaucetCooldown(uint256 availableAt);

    constructor(uint256 initialSupply) ERC20("Cairn", "CAIRN") {
        _mint(msg.sender, initialSupply);
    }

    /// @notice Mint FAUCET_AMOUNT to the caller, once per cooldown period.
    function faucet() external {
        uint256 last = lastFaucetAt[msg.sender];
        if (last != 0 && block.timestamp < last + FAUCET_COOLDOWN) {
            revert FaucetCooldown(last + FAUCET_COOLDOWN);
        }
        lastFaucetAt[msg.sender] = block.timestamp;
        _mint(msg.sender, FAUCET_AMOUNT);
    }
}
