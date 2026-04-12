// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockV3Pool {
    int24 public immutable tickSpacing;

    constructor(int24 tickSpacing_) {
        tickSpacing = tickSpacing_;
    }
}

