// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MemeToken is ERC20, Ownable {
    address public immutable factory;
    address public market;

    bool public tradingRestricted;
    uint64 public tradingOpenTime;
    mapping(address => bool) public isExempt;

    event TradingRestrictionSet(uint64 openTime);
    event ExemptSet(address indexed account, bool exempt);

    modifier onlyFactoryOrMarket() {
        require(msg.sender == factory || (market != address(0) && msg.sender == market), "not auth");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address initialHolder_,
        address factory_
    ) ERC20(name_, symbol_) Ownable(factory_) {
        require(initialHolder_ != address(0), "holder=0");
        require(factory_ != address(0), "factory=0");
        factory = factory_;
        isExempt[factory_] = true;
        isExempt[initialHolder_] = true;
        _mint(initialHolder_, totalSupply_);
    }

    function setMarketOnce(address market_) external {
        require(msg.sender == factory, "only factory");
        require(market == address(0), "market set");
        require(market_ != address(0), "market=0");
        market = market_;
        isExempt[market_] = true;
        emit ExemptSet(market_, true);
    }

    function setExempt(address account, bool exempt) external onlyFactoryOrMarket {
        isExempt[account] = exempt;
        emit ExemptSet(account, exempt);
    }

    function setTradingRestriction(uint64 openTime) external onlyFactoryOrMarket {
        tradingRestricted = true;
        tradingOpenTime = openTime;
        emit TradingRestrictionSet(openTime);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (tradingRestricted && block.timestamp < tradingOpenTime) {
            if (from != address(0) && to != address(0)) {
                if (!isExempt[from] && !isExempt[to] && !isExempt[_msgSender()]) {
                    revert("trading delayed");
                }
            }
        }
        super._update(from, to, value);
    }
}
