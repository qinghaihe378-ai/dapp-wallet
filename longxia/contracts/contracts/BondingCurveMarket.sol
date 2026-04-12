// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {LiquidityLocker} from "./LiquidityLocker.sol";
import {IMemeTokenCore} from "./interfaces/IMemeTokenCore.sol";
import {IPancakeV2Router02} from "./interfaces/IPancakeV2Router02.sol";
import {IPancakeV2Factory} from "./interfaces/IPancakeV2Factory.sol";

contract BondingCurveMarket is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant LP_LOCK_DURATION = 2000 days;
    uint256 internal constant WAD = 1e18;

    address public immutable token;
    address public immutable creator;
    address public immutable treasury;
    uint256 public immutable targetRaise;
    uint16 public immutable buyFeeBps;
    uint16 public immutable sellFeeBps;
    uint256 public immutable curveR;
    uint256 public immutable curveK;
    uint256 public immutable liquidityTokenReserve;
    uint32 public immutable antiSnipingDelaySeconds;
    address public immutable wbnb;
    address public immutable pancakeV2Factory;
    IPancakeV2Router02 public immutable router;
    LiquidityLocker public immutable locker;
    uint256 public immutable totalSupply;

    bool public migrated;
    address public migratedPair;
    bytes32 public migratedLockId;

    event Buy(address indexed buyer, uint256 bnbIn, uint256 tokensOut, uint256 feePaid);
    event Sell(address indexed seller, uint256 tokensIn, uint256 bnbOut, uint256 feePaid);
    event Migrated(address indexed pair, bytes32 indexed lockId, uint256 tokenAmount, uint256 bnbAmount, uint256 liquidity);

    constructor(
        address token_,
        address creator_,
        address treasury_,
        uint256 targetRaise_,
        uint16 buyFeeBps_,
        uint16 sellFeeBps_,
        uint256 curveR_,
        uint256 liquidityTokenReserve_,
        uint32 antiSnipingDelaySeconds_,
        address wbnb_,
        address router_,
        address locker_
    ) {
        require(token_ != address(0), "token=0");
        require(creator_ != address(0), "creator=0");
        require(treasury_ != address(0), "treasury=0");
        require(wbnb_ != address(0), "wbnb=0");
        require(router_ != address(0), "router=0");
        require(locker_ != address(0), "locker=0");
        token = token_;
        creator = creator_;
        treasury = treasury_;
        targetRaise = targetRaise_;
        buyFeeBps = buyFeeBps_;
        sellFeeBps = sellFeeBps_;
        curveR = curveR_;
        totalSupply = IERC20(token_).totalSupply();
        curveK = _mulWad(curveR_, totalSupply);
        liquidityTokenReserve = liquidityTokenReserve_;
        antiSnipingDelaySeconds = antiSnipingDelaySeconds_;
        wbnb = wbnb_;
        router = IPancakeV2Router02(router_);
        pancakeV2Factory = router.factory();
        locker = LiquidityLocker(locker_);
    }

    receive() external payable {}

    function tokenReserve() public view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function saleTokenReserve() public view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 liq = liquidityTokenReserve;
        if (bal <= liq) return 0;
        return bal - liq;
    }

    function saleSupply() public view returns (uint256) {
        return totalSupply - liquidityTokenReserve;
    }

    function circulatingSupply() public view returns (uint256) {
        uint256 remaining = saleTokenReserve();
        uint256 supply = saleSupply();
        if (remaining >= supply) return 0;
        return supply - remaining;
    }

    function quoteBuy(uint256 bnbIn) external view returns (uint256 tokensOut, uint256 feePaid) {
        if (migrated || bnbIn == 0) return (0, 0);
        (tokensOut, feePaid,) = _quoteBuy(address(this).balance, bnbIn);
    }

    function quoteSell(uint256 tokensIn) external view returns (uint256 bnbOut, uint256 feePaid) {
        if (migrated || tokensIn == 0) return (0, 0);
        uint256 supplyBefore = circulatingSupply();
        uint256 sale = saleSupply();
        if (supplyBefore == 0 || supplyBefore > sale || tokensIn > supplyBefore) return (0, 0);
        uint256 supplyAfter = supplyBefore - tokensIn;
        uint256 reserveBefore = address(this).balance;
        uint256 reserveAfter = _estimateReserve(supplyAfter);
        if (reserveAfter > reserveBefore) return (0, 0);
        uint256 gross = reserveBefore - reserveAfter;
        feePaid = (gross * sellFeeBps) / 10_000;
        bnbOut = gross - feePaid;
    }

    function buy(address recipient, uint256 minTokensOut) external payable nonReentrant returns (uint256 tokensOut) {
        require(!migrated, "migrated");
        require(recipient != address(0), "recipient=0");
        require(msg.value > 0, "value=0");

        uint256 amountIn = msg.value;
        uint256 feePaid;
        uint256 refund;
        uint256 reserveBefore = address(this).balance - amountIn;
        (tokensOut, feePaid, refund) = _quoteBuy(reserveBefore, amountIn);
        require(tokensOut >= minTokensOut, "slippage");

        if (refund > 0) _sendBNB(msg.sender, refund);
        if (feePaid > 0) _sendBNB(treasury, feePaid);

        IERC20(token).safeTransfer(recipient, tokensOut);
        emit Buy(recipient, amountIn, tokensOut, feePaid);

        if (!migrated && saleTokenReserve() == 0) {
            _migrateToPancakeV2();
        }
    }

    function sell(uint256 tokensIn, uint256 minBnbOut, address recipient) external nonReentrant returns (uint256 bnbOut) {
        require(!migrated, "migrated");
        require(tokensIn > 0, "tokens=0");
        require(recipient != address(0), "recipient=0");

        uint256 supplyBefore = circulatingSupply();
        require(tokensIn <= supplyBefore, "insufficient supply");
        uint256 supplyAfter = supplyBefore - tokensIn;
        uint256 reserveBefore = address(this).balance;
        uint256 reserveAfter = _estimateReserve(supplyAfter);
        require(reserveAfter <= reserveBefore, "insufficient bnb");

        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);

        uint256 gross = reserveBefore - reserveAfter;

        uint256 feePaid = (gross * sellFeeBps) / 10_000;
        bnbOut = gross - feePaid;
        require(bnbOut >= minBnbOut, "slippage");

        if (feePaid > 0) _sendBNB(treasury, feePaid);
        _sendBNB(recipient, bnbOut);
        emit Sell(msg.sender, tokensIn, bnbOut, feePaid);
    }

    function migrateIfReady() external nonReentrant {
        require(!migrated, "migrated");
        require(saleTokenReserve() == 0, "not ready");
        _migrateToPancakeV2();
    }

    function _migrateToPancakeV2() internal {
        migrated = true;

        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 tokenAmount = liquidityTokenReserve;
        uint256 bnbAmount = address(this).balance;
        require(tokenAmount > 0, "no token");
        require(bal >= tokenAmount, "no token");
        require(bnbAmount > 0, "no bnb");

        uint256 extra = bal - tokenAmount;
        if (extra > 0) {
            IERC20(token).safeTransfer(DEAD, extra);
        }

        IERC20(token).forceApprove(address(router), tokenAmount);

        (, , uint256 liquidity) = router.addLiquidityETH{value: bnbAmount}(
            token,
            tokenAmount,
            0,
            0,
            address(this),
            block.timestamp + 300
        );

        address pair = IPancakeV2Factory(pancakeV2Factory).getPair(token, wbnb);
        require(pair != address(0), "pair=0");

        migratedPair = pair;

        uint256 lpBal = IERC20(pair).balanceOf(address(this));
        require(lpBal > 0, "no lp");
        IERC20(pair).safeTransfer(address(locker), lpBal);

        bytes32 lockId = locker.registerLock(pair, lpBal, treasury, uint64(block.timestamp + LP_LOCK_DURATION));
        migratedLockId = lockId;

        IERC20(token).forceApprove(address(router), 0);

        IMemeTokenCore(token).setExempt(address(router), true);
        IMemeTokenCore(token).setExempt(pair, true);
        IMemeTokenCore(token).setExempt(address(locker), true);
        IMemeTokenCore(token).setTradingRestriction(uint64(block.timestamp + antiSnipingDelaySeconds));

        emit Migrated(pair, lockId, tokenAmount, bnbAmount, liquidity);
    }

    function _quoteBuy(uint256 reserveBefore, uint256 grossIn)
        internal
        view
        returns (uint256 tokensOut, uint256 feePaid, uint256 refund)
    {
        uint256 supplyBefore = circulatingSupply();
        uint256 sale = saleSupply();
        if (supplyBefore >= sale) return (0, 0, grossIn);

        uint256 feeBps = buyFeeBps;
        uint256 netMax = grossIn - ((grossIn * feeBps) / 10_000);
        uint256 reserveMax = reserveBefore + netMax;

        uint256 supplyMax = _estimateSupply(reserveMax);
        uint256 supplyNew = supplyMax > sale ? sale : supplyMax;
        if (supplyNew <= supplyBefore) return (0, 0, grossIn);

        uint256 reserveNeeded = _estimateReserve(supplyNew);
        if (reserveNeeded < reserveBefore) reserveNeeded = reserveBefore;
        uint256 netUsed = reserveNeeded - reserveBefore;

        uint256 grossUsed;
        if (feeBps == 10_000) {
            grossUsed = type(uint256).max;
        } else {
            grossUsed = Math.mulDiv(netUsed, 10_000, 10_000 - feeBps, Math.Rounding.Ceil);
        }

        if (grossUsed > grossIn) grossUsed = grossIn;
        uint256 netFromGross = grossUsed - ((grossUsed * feeBps) / 10_000);
        if (netFromGross < netUsed) {
            netUsed = netFromGross;
            reserveNeeded = reserveBefore + netUsed;
            supplyNew = _estimateSupply(reserveNeeded);
            if (supplyNew > sale) supplyNew = sale;
        }

        tokensOut = supplyNew - supplyBefore;
        feePaid = grossUsed - netUsed;
        refund = grossIn - grossUsed;
    }

    function _estimateSupply(uint256 reserve) internal view returns (uint256 supply) {
        supply = totalSupply - _divWadUp(curveK, curveR + reserve);
    }

    function _estimateReserve(uint256 supply) internal view returns (uint256 reserve) {
        if (supply > totalSupply) supply = totalSupply;
        reserve = _divWadUp(curveK, totalSupply - supply) - curveR;
    }

    function _mulWad(uint256 x, uint256 y) internal pure returns (uint256) {
        return Math.mulDiv(x, y, WAD);
    }

    function _divWadUp(uint256 x, uint256 y) internal pure returns (uint256) {
        return Math.mulDiv(x, WAD, y, Math.Rounding.Ceil);
    }

    function _sendBNB(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "bnb transfer failed");
    }
}
