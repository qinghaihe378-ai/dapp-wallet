// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IWBNB {
    function deposit() external payable;

    function withdraw(uint256 wad) external;

    function approve(address guy, uint256 wad) external returns (bool);
}

