// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockV2Pair is ERC20 {
    address public token0;
    address public token1;

    constructor(address token0_, address token1_) ERC20("Pancake LP", "Cake-LP") {
        token0 = token0_;
        token1 = token1_;
    }

    function mint(address to, uint256 liquidity) external {
        _mint(to, liquidity);
    }
}

