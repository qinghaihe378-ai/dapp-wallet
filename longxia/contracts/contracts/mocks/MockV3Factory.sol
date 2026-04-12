// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockV3Factory {
    mapping(bytes32 => address) public pools;

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool) {
        return pools[_key(tokenA, tokenB, fee)];
    }

    function setPool(address tokenA, address tokenB, uint24 fee, address pool) external {
        pools[_key(tokenA, tokenB, fee)] = pool;
    }

    function _key(address tokenA, address tokenB, uint24 fee) internal pure returns (bytes32) {
        (address t0, address t1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encodePacked(t0, t1, fee));
    }
}

