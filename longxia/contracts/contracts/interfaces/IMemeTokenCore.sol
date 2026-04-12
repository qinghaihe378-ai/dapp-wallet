// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMemeTokenCore {
    function setMarketOnce(address market_) external;

    function setExempt(address account, bool exempt) external;

    function setTradingRestriction(uint64 openTime) external;
}

