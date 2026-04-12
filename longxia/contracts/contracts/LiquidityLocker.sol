// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract LiquidityLocker is Ownable {
    using SafeERC20 for IERC20;

    struct LockInfo {
        address token;
        address beneficiary;
        uint256 amount;
        uint64 unlockTime;
        bool claimed;
    }

    mapping(address => bool) public isMarket;
    mapping(bytes32 => LockInfo) public locks;

    event MarketSet(address indexed market, bool allowed);
    event Locked(bytes32 indexed lockId, address indexed token, uint256 amount, address indexed beneficiary, uint64 unlockTime);
    event Claimed(bytes32 indexed lockId, address indexed beneficiary);

    constructor(address owner_) Ownable(owner_) {}

    modifier onlyMarket() {
        require(isMarket[msg.sender], "not market");
        _;
    }

    function setMarket(address market, bool allowed) external onlyOwner {
        isMarket[market] = allowed;
        emit MarketSet(market, allowed);
    }

    function registerLock(
        address token,
        uint256 amount,
        address beneficiary,
        uint64 unlockTime
    ) external onlyMarket returns (bytes32 lockId) {
        require(token != address(0), "token=0");
        require(amount > 0, "amount=0");
        require(beneficiary != address(0), "beneficiary=0");
        lockId = keccak256(abi.encodePacked(token, beneficiary, unlockTime, amount, block.number, msg.sender));
        LockInfo storage li = locks[lockId];
        require(li.beneficiary == address(0), "already locked");
        li.token = token;
        li.beneficiary = beneficiary;
        li.amount = amount;
        li.unlockTime = unlockTime;
        emit Locked(lockId, token, amount, beneficiary, unlockTime);
    }

    function claim(bytes32 lockId) external {
        LockInfo storage li = locks[lockId];
        require(li.beneficiary == msg.sender, "not beneficiary");
        require(!li.claimed, "claimed");
        require(block.timestamp >= li.unlockTime, "locked");
        li.claimed = true;
        IERC20(li.token).safeTransfer(msg.sender, li.amount);
        emit Claimed(lockId, msg.sender);
    }
}
