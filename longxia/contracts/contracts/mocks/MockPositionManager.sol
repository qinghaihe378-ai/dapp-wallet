// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {MockV3Factory} from "./MockV3Factory.sol";
import {MockV3Pool} from "./MockV3Pool.sol";

contract MockPositionManager is ERC721 {
    using SafeERC20 for IERC20;

    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    MockV3Factory public immutable factory;
    uint256 public nextId = 1;

    constructor(address factory_) ERC721("Mock V3 Positions", "MPOS") {
        factory = MockV3Factory(factory_);
    }

    function createAndInitializePoolIfNecessary(
        address token0,
        address token1,
        uint24 fee,
        uint160
    ) external payable returns (address pool) {
        pool = factory.getPool(token0, token1, fee);
        if (pool == address(0)) {
            pool = address(new MockV3Pool(10));
            factory.setPool(token0, token1, fee, pool);
        }
    }

    function mint(
        MintParams calldata params
    )
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        require(params.deadline >= block.timestamp, "expired");
        require(params.tickLower < params.tickUpper, "bad ticks");
        require(params.recipient != address(0), "recipient=0");

        IERC20(params.token0).safeTransferFrom(msg.sender, address(this), params.amount0Desired);
        IERC20(params.token1).safeTransferFrom(msg.sender, address(this), params.amount1Desired);

        tokenId = nextId++;
        _safeMint(params.recipient, tokenId);
        liquidity = 1;
        amount0 = params.amount0Desired;
        amount1 = params.amount1Desired;
    }
}
