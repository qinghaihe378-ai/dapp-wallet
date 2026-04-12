// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MockV2Factory} from "./MockV2Factory.sol";
import {MockV2Pair} from "./MockV2Pair.sol";

contract MockV2Router {
    using SafeERC20 for IERC20;

    MockV2Factory public immutable factory;
    address public immutable WETH;

    constructor(address factory_, address weth_) {
        factory = MockV2Factory(factory_);
        WETH = weth_;
    }

    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256,
        uint256,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity) {
        require(block.timestamp <= deadline, "expired");
        require(to != address(0), "to=0");
        require(amountTokenDesired > 0, "token=0");
        require(msg.value > 0, "eth=0");

        address pair = factory.getPair(token, WETH);
        if (pair == address(0)) {
            pair = factory.createPair(token, WETH);
        }

        IERC20(token).safeTransferFrom(msg.sender, pair, amountTokenDesired);
        amountToken = amountTokenDesired;
        amountETH = msg.value;
        liquidity = amountTokenDesired;
        MockV2Pair(pair).mint(to, liquidity);
    }
}

