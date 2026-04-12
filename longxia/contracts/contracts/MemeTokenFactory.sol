// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {MemeToken} from "./MemeToken.sol";
import {TaxTokenDeployer} from "./TaxTokenDeployer.sol";
import {BondingCurveMarket} from "./BondingCurveMarket.sol";
import {LiquidityLocker} from "./LiquidityLocker.sol";
import {IMemeTokenCore} from "./interfaces/IMemeTokenCore.sol";
import {IOwnable} from "./interfaces/IOwnable.sol";

contract MemeTokenFactory is Ownable {
    using SafeERC20 for IERC20;

    uint16 internal constant LIQUIDITY_SHARE_BPS = 2000;
    struct TokenInfo {
        address token;
        address market;
        address creator;
        uint40 createdAt;
        string description;
        string logo;
        string telegram;
        string twitter;
        string website;
        uint8 templateId;
        uint16 taxBps;
        uint16 burnShareBps;
        uint16 holderShareBps;
        uint16 liquidityShareBps;
        uint16 buybackShareBps;
    }

    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    uint256 public creationFee;
    uint256 public targetRaise;
    uint256 public virtualBnbReserve;
    uint16 public buyFeeBps;
    uint16 public sellFeeBps;
    uint32 public antiSnipingDelaySeconds;

    address public treasury;
    address public wbnb;
    address public router;
    address public taxDeployer;
    LiquidityLocker public locker;

    address[] public allTokens;
    mapping(address => TokenInfo) public tokenInfo;

    event TokenCreated(address indexed token, address indexed market, address indexed creator);
    event TreasurySet(address indexed treasury);
    event ConfigSet();

    constructor(
        address owner_,
        address treasury_,
        address wbnb_,
        address router_,
        address taxDeployer_
    ) Ownable(owner_) {
        require(treasury_ != address(0), "treasury=0");
        require(wbnb_ != address(0), "wbnb=0");
        require(router_ != address(0), "router=0");
        require(taxDeployer_ != address(0), "taxDeployer=0");

        treasury = treasury_;
        wbnb = wbnb_;
        router = router_;
        taxDeployer = taxDeployer_;
        locker = new LiquidityLocker(address(this));

        creationFee = 0.005 ether;
        targetRaise = 16.5 ether;
        virtualBnbReserve = 1 ether;
        buyFeeBps = 100;
        sellFeeBps = 100;
        antiSnipingDelaySeconds = 120;
    }

    receive() external payable {}

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "treasury=0");
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setConfig(
        uint256 creationFee_,
        uint256 targetRaise_,
        uint256 virtualBnbReserve_,
        uint16 buyFeeBps_,
        uint16 sellFeeBps_,
        uint32 antiSnipingDelaySeconds_
    ) external onlyOwner {
        require(buyFeeBps_ <= 500 && sellFeeBps_ <= 500, "fee too high");
        creationFee = creationFee_;
        targetRaise = targetRaise_;
        virtualBnbReserve = virtualBnbReserve_;
        buyFeeBps = buyFeeBps_;
        sellFeeBps = sellFeeBps_;
        antiSnipingDelaySeconds = antiSnipingDelaySeconds_;
        emit ConfigSet();
    }

    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata description,
        string calldata logo,
        string calldata telegram,
        string calldata twitter,
        string calldata website,
        uint256 targetRaiseOverride,
        uint8 templateId,
        uint16 taxBps,
        uint16 burnShareBps,
        uint16 holderShareBps,
        uint16 liquidityShareBps,
        uint16 buybackShareBps
    ) external payable returns (address token, address market) {
        require(msg.value == creationFee, "bad fee");
        _sendBNB(treasury, msg.value);

        address t;
        if (templateId == 0) {
            require(taxBps == 0, "tax");
            require(burnShareBps == 0 && holderShareBps == 0 && liquidityShareBps == 0 && buybackShareBps == 0, "share");
            t = address(new MemeToken(name, symbol, TOTAL_SUPPLY, address(this), address(this)));
        } else if (templateId == 1) {
            t = TaxTokenDeployer(taxDeployer).deployTaxToken(
                name,
                symbol,
                TOTAL_SUPPLY,
                address(this),
                treasury,
                wbnb,
                router,
                taxBps,
                burnShareBps,
                holderShareBps,
                liquidityShareBps,
                buybackShareBps
            );
        } else {
            revert("template");
        }

        require(
            targetRaiseOverride == 0 || targetRaiseOverride == 6 ether || targetRaiseOverride == 16.5 ether,
            "target"
        );
        uint256 tr = targetRaiseOverride == 0 ? targetRaise : targetRaiseOverride;
        uint256 liquidityTokenReserve = (TOTAL_SUPPLY * LIQUIDITY_SHARE_BPS) / 10_000;
        uint256 saleSupply = TOTAL_SUPPLY - liquidityTokenReserve;
        uint256 curveR = Math.mulDiv(tr, liquidityTokenReserve, saleSupply);

        BondingCurveMarket m = new BondingCurveMarket(
            t,
            msg.sender,
            treasury,
            tr,
            buyFeeBps,
            sellFeeBps,
            curveR,
            liquidityTokenReserve,
            antiSnipingDelaySeconds,
            wbnb,
            router,
            address(locker)
        );

        IMemeTokenCore(t).setMarketOnce(address(m));
        IERC20(t).safeTransfer(address(m), TOTAL_SUPPLY);
        locker.setMarket(address(m), true);
        
        IOwnable(t).renounceOwnership();

        token = t;
        market = address(m);
        allTokens.push(token);
        tokenInfo[token] = TokenInfo({
            token: token,
            market: market,
            creator: msg.sender,
            createdAt: uint40(block.timestamp),
            description: description,
            logo: logo,
            telegram: telegram,
            twitter: twitter,
            website: website,
            templateId: templateId,
            taxBps: taxBps,
            burnShareBps: burnShareBps,
            holderShareBps: holderShareBps,
            liquidityShareBps: liquidityShareBps,
            buybackShareBps: buybackShareBps
        });

        emit TokenCreated(token, market, msg.sender);
    }

    function _sendBNB(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "bnb transfer failed");
    }
}
