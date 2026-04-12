// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPancakeV3Pool {
    function tickSpacing() external view returns (int24);
}

