// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MemeTokenTax} from "./MemeTokenTax.sol";

contract TaxTokenDeployer {
    function deployTaxToken(
        string calldata name,
        string calldata symbol,
        uint256 totalSupply,
        address factory,
        address treasury,
        address wbnb,
        address router,
        uint16 taxBps,
        uint16 burnShareBps,
        uint16 holderShareBps,
        uint16 liquidityShareBps,
        uint16 buybackShareBps
    ) external returns (address token) {
        token = address(
            new MemeTokenTax(
                name,
                symbol,
                totalSupply,
                factory,
                factory,
                treasury,
                wbnb,
                router,
                taxBps,
                burnShareBps,
                holderShareBps,
                liquidityShareBps,
                buybackShareBps
            )
        );
    }
}

