// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockV2Pair} from "./MockV2Pair.sol";

contract MockV2Factory {
    mapping(address => mapping(address => address)) public getPair;

    function createPair(address tokenA, address tokenB) external returns (address pair) {
        require(tokenA != tokenB, "same");
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        require(getPair[t0][t1] == address(0), "exists");
        pair = address(new MockV2Pair(t0, t1));
        getPair[t0][t1] = pair;
        getPair[t1][t0] = pair;
    }
}

