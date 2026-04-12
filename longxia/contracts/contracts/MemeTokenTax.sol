// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPancakeV2Factory} from "./interfaces/IPancakeV2Factory.sol";
import {IPancakeV2Router02} from "./interfaces/IPancakeV2Router02.sol";

contract MemeTokenTax is ERC20, Ownable {
    using SafeERC20 for IERC20;

    uint256 internal constant MAGNITUDE = 2 ** 128;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address public immutable factory;
    address public immutable treasury;
    address public immutable wbnb;
    IPancakeV2Router02 public immutable router;
    address public market;

    bool public tradingRestricted;
    uint64 public tradingOpenTime;
    mapping(address => bool) public isExempt;

    uint16 public immutable taxBps;
    uint16 public immutable burnShareBps;
    uint16 public immutable holderShareBps;
    uint16 public immutable liquidityShareBps;
    uint16 public immutable buybackShareBps;

    mapping(address => bool) public isTaxExempt;
    mapping(address => bool) public isDividendExempt;

    uint256 public swapThreshold;
    bool private swapping;
    address private _pair;

    uint256 public magnifiedDividendPerShare;
    mapping(address => int256) public magnifiedDividendCorrections;
    mapping(address => uint256) public withdrawnDividends;
    uint256 public totalDividendsDistributed;
    uint256 public excludedDividendBalance;

    event TradingRestrictionSet(uint64 openTime);
    event ExemptSet(address indexed account, bool exempt);
    event TaxExemptSet(address indexed account, bool exempt);
    event DividendExemptSet(address indexed account, bool exempt);
    event SwapThresholdSet(uint256 threshold);
    event DividendsDistributed(uint256 amount);
    event DividendWithdrawn(address indexed account, uint256 amount);

    modifier onlyFactoryOrMarket() {
        require(msg.sender == factory || (market != address(0) && msg.sender == market), "not auth");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address initialHolder_,
        address factory_,
        address treasury_,
        address wbnb_,
        address router_,
        uint16 taxBps_,
        uint16 burnShareBps_,
        uint16 holderShareBps_,
        uint16 liquidityShareBps_,
        uint16 buybackShareBps_
    ) ERC20(name_, symbol_) Ownable(factory_) {
        require(initialHolder_ != address(0), "holder=0");
        require(factory_ != address(0), "factory=0");
        require(treasury_ != address(0), "treasury=0");
        require(wbnb_ != address(0), "wbnb=0");
        require(router_ != address(0), "router=0");
        require(taxBps_ >= 10 && taxBps_ <= 500, "tax");
        require(uint256(burnShareBps_) + uint256(holderShareBps_) + uint256(liquidityShareBps_) + uint256(buybackShareBps_) == 10_000, "share");

        factory = factory_;
        treasury = treasury_;
        wbnb = wbnb_;
        router = IPancakeV2Router02(router_);

        taxBps = taxBps_;
        burnShareBps = burnShareBps_;
        holderShareBps = holderShareBps_;
        liquidityShareBps = liquidityShareBps_;
        buybackShareBps = buybackShareBps_;

        isExempt[factory_] = true;
        isExempt[initialHolder_] = true;
        isTaxExempt[factory_] = true;
        isTaxExempt[initialHolder_] = true;
        isTaxExempt[address(this)] = true;

        isDividendExempt[factory_] = true;
        isDividendExempt[initialHolder_] = true;
        isDividendExempt[address(this)] = true;
        isDividendExempt[DEAD] = true;

        swapThreshold = totalSupply_ / 100_000;

        _mint(initialHolder_, totalSupply_);
    }

    receive() external payable {}

    function pair() public view returns (address) {
        return _pair;
    }

    function setMarketOnce(address market_) external {
        require(msg.sender == factory, "only factory");
        require(market == address(0), "market set");
        require(market_ != address(0), "market=0");
        market = market_;
        isExempt[market_] = true;
        isTaxExempt[market_] = true;
        isDividendExempt[market_] = true;
        emit ExemptSet(market_, true);
        emit TaxExemptSet(market_, true);
        emit DividendExemptSet(market_, true);
    }

    function setExempt(address account, bool exempt) external onlyFactoryOrMarket {
        isExempt[account] = exempt;
        emit ExemptSet(account, exempt);
    }

    function setTaxExempt(address account, bool exempt) external onlyFactoryOrMarket {
        isTaxExempt[account] = exempt;
        emit TaxExemptSet(account, exempt);
    }

    function setDividendExempt(address account, bool exempt) external onlyFactoryOrMarket {
        if (isDividendExempt[account] == exempt) return;
        uint256 bal = balanceOf(account);
        isDividendExempt[account] = exempt;
        if (exempt) {
            excludedDividendBalance += bal;
        } else {
            excludedDividendBalance -= bal;
        }
        emit DividendExemptSet(account, exempt);
    }

    function setTradingRestriction(uint64 openTime) external onlyFactoryOrMarket {
        tradingRestricted = true;
        tradingOpenTime = openTime;
        emit TradingRestrictionSet(openTime);
    }

    function setSwapThreshold(uint256 threshold) external onlyFactoryOrMarket {
        swapThreshold = threshold;
        emit SwapThresholdSet(threshold);
    }

    function dividendOf(address account) external view returns (uint256) {
        return withdrawableDividendOf(account);
    }

    function withdrawableDividendOf(address account) public view returns (uint256) {
        return accumulativeDividendOf(account) - withdrawnDividends[account];
    }

    function accumulativeDividendOf(address account) public view returns (uint256) {
        if (isDividendExempt[account]) return 0;
        int256 corrected = int256(magnifiedDividendPerShare * balanceOf(account)) + magnifiedDividendCorrections[account];
        if (corrected <= 0) return 0;
        return uint256(corrected) / MAGNITUDE;
    }

    function claimDividend() external {
        uint256 amount = withdrawableDividendOf(msg.sender);
        if (amount == 0) return;
        withdrawnDividends[msg.sender] += amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "bnb transfer failed");
        emit DividendWithdrawn(msg.sender, amount);
    }

    function _pairOrLookup() internal returns (address p) {
        p = _pair;
        if (p != address(0)) return p;
        address f = router.factory();
        p = IPancakeV2Factory(f).getPair(address(this), wbnb);
        if (p != address(0)) {
            _pair = p;
            isExempt[p] = true;
            isDividendExempt[p] = true;
            excludedDividendBalance += balanceOf(p);
            emit ExemptSet(p, true);
            emit DividendExemptSet(p, true);
        }
    }

    function _maybeSwapBack(address from, address to) internal {
        if (swapping) return;
        address p = _pairOrLookup();
        if (p == address(0)) return;
        if (to != p) return;
        uint256 bal = balanceOf(address(this));
        if (bal < swapThreshold || swapThreshold == 0) return;
        _swapBack(bal);
    }

    function _swapBack(uint256 tokenAmount) internal {
        swapping = true;

        uint256 denom = 10_000 - uint256(burnShareBps);
        uint256 tokensForLiquidity = denom == 0 ? 0 : (tokenAmount * uint256(liquidityShareBps)) / denom;
        uint256 tokensForBuyback = denom == 0 ? 0 : (tokenAmount * uint256(buybackShareBps)) / denom;
        uint256 tokensForHolders = tokenAmount - tokensForLiquidity - tokensForBuyback;

        uint256 tokensForLiquidityHalf = tokensForLiquidity / 2;
        uint256 tokensToSwapForLiquidity = tokensForLiquidity - tokensForLiquidityHalf;
        uint256 tokensToSwap = tokensForHolders + tokensForBuyback + tokensToSwapForLiquidity;

        uint256 bnbBefore = address(this).balance;

        if (tokensToSwap > 0) {
            IERC20(address(this)).forceApprove(address(router), tokensToSwap);
            address[] memory path = new address[](2);
            path[0] = address(this);
            path[1] = wbnb;
            router.swapExactTokensForETHSupportingFeeOnTransferTokens(tokensToSwap, 0, path, address(this), block.timestamp + 300);
            IERC20(address(this)).forceApprove(address(router), 0);
        }

        uint256 bnbReceived = address(this).balance - bnbBefore;
        uint256 bnbForLiquidity = tokensToSwap == 0 ? 0 : (bnbReceived * tokensToSwapForLiquidity) / tokensToSwap;
        uint256 bnbForBuyback = tokensToSwap == 0 ? 0 : (bnbReceived * tokensForBuyback) / tokensToSwap;
        uint256 bnbForHolders = bnbReceived - bnbForLiquidity - bnbForBuyback;

        if (tokensForLiquidityHalf > 0 && bnbForLiquidity > 0) {
            IERC20(address(this)).forceApprove(address(router), tokensForLiquidityHalf);
            router.addLiquidityETH{value: bnbForLiquidity}(address(this), tokensForLiquidityHalf, 0, 0, DEAD, block.timestamp + 300);
            IERC20(address(this)).forceApprove(address(router), 0);
        }

        if (bnbForBuyback > 0) {
            (bool ok, ) = treasury.call{value: bnbForBuyback}("");
            require(ok, "bnb transfer failed");
        }

        if (bnbForHolders > 0) {
            _distributeDividends(bnbForHolders);
        }

        swapping = false;
    }

    function _distributeDividends(uint256 amount) internal {
        uint256 supply = totalSupply() - excludedDividendBalance;
        if (amount == 0 || supply == 0) return;
        magnifiedDividendPerShare += (amount * MAGNITUDE) / supply;
        totalDividendsDistributed += amount;
        emit DividendsDistributed(amount);
    }

    function _tokenUpdate(address from, address to, uint256 value) internal {
        if (from == address(0)) {
            if (isDividendExempt[to]) {
                excludedDividendBalance += value;
            } else {
                magnifiedDividendCorrections[to] -= int256(magnifiedDividendPerShare * value);
            }
        } else if (to == address(0)) {
            if (isDividendExempt[from]) {
                excludedDividendBalance -= value;
            } else {
                magnifiedDividendCorrections[from] += int256(magnifiedDividendPerShare * value);
            }
        } else {
            if (isDividendExempt[from]) {
                excludedDividendBalance -= value;
            } else {
                magnifiedDividendCorrections[from] += int256(magnifiedDividendPerShare * value);
            }
            if (isDividendExempt[to]) {
                excludedDividendBalance += value;
            } else {
                magnifiedDividendCorrections[to] -= int256(magnifiedDividendPerShare * value);
            }
        }
        super._update(from, to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (tradingRestricted && block.timestamp < tradingOpenTime) {
            if (from != address(0) && to != address(0)) {
                if (!isExempt[from] && !isExempt[to] && !isExempt[_msgSender()]) {
                    revert("trading delayed");
                }
            }
        }

        if (from != address(0) && to != address(0)) {
            _maybeSwapBack(from, to);
        }

        if (from != address(0) && to != address(0) && !swapping && !isTaxExempt[from] && !isTaxExempt[to] && taxBps > 0) {
            uint256 fee = (value * uint256(taxBps)) / 10_000;
            if (fee > 0) {
                uint256 burnAmt = (fee * uint256(burnShareBps)) / 10_000;
                uint256 rest = fee - burnAmt;
                uint256 sendAmt = value - fee;
                if (burnAmt > 0) _tokenUpdate(from, address(0), burnAmt);
                if (rest > 0) _tokenUpdate(from, address(this), rest);
                _tokenUpdate(from, to, sendAmt);
                return;
            }
        }

        _tokenUpdate(from, to, value);
    }
}
