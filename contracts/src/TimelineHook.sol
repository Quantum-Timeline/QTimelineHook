// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IQTimelineMarketRegistry} from "./interfaces/IQTimeline.sol";

/// @notice Lifecycle gate on every direct or routed Uniswap v4 swap for a registered QTimeline pool.
/// @dev The hook has zero return delta and no owner/configuration setters.
contract TimelineHook is BaseHook {
    using PoolIdLibrary for PoolKey;

    error Unauthorized();
    error PoolNotRegistered();
    error MarketNotTradable(uint8 status, uint64 opensAt, uint64 cutoffAt);
    error LiquidityUnavailable();

    IQTimelineMarketRegistry public immutable registry;
    address public immutable factory;
    bytes32 public immutable marketId;

    constructor(IPoolManager manager, IQTimelineMarketRegistry registry_, address factory_, bytes32 marketId_)
        BaseHook(manager)
    {
        require(address(registry_).code.length != 0 && factory_ != address(0) && marketId_ != bytes32(0), "invalid config");
        registry = registry_;
        factory = factory_;
        marketId = marketId_;
    }

    function getHookPermissions() public pure override returns (Hooks.Permissions memory p) {
        p.beforeInitialize = true;
        p.beforeAddLiquidity = true;
        p.beforeSwap = true;
    }

    function _beforeInitialize(address sender, PoolKey calldata key, uint160) internal override returns (bytes4) {
        if (sender != factory) revert Unauthorized();
        _requirePool(key);
        IQTimelineMarketRegistry.Market memory m = registry.market(marketId);
        if (m.status != IQTimelineMarketRegistry.Status.Draft || m.activated) revert MarketNotTradable(uint8(m.status), m.opensAt, m.cutoffAt);
        return IHooks.beforeInitialize.selector;
    }

    function _beforeAddLiquidity(address, PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata)
        internal override returns (bytes4)
    {
        _requirePool(key);
        if (params.liquidityDelta <= 0) revert LiquidityUnavailable();
        IQTimelineMarketRegistry.Market memory m = registry.market(marketId);
        if (m.status != IQTimelineMarketRegistry.Status.Draft && m.status != IQTimelineMarketRegistry.Status.Open) revert LiquidityUnavailable();
        return IHooks.beforeAddLiquidity.selector;
    }

    function _beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        internal override returns (bytes4, BeforeSwapDelta, uint24)
    {
        _requirePool(key);
        IQTimelineMarketRegistry.Market memory m = registry.market(marketId);
        bool lifecycleAllowsTrade = m.status == IQTimelineMarketRegistry.Status.Open || m.status == IQTimelineMarketRegistry.Status.Scheduled;
        if (!m.activated || !lifecycleAllowsTrade || block.timestamp < m.opensAt || block.timestamp >= m.cutoffAt) {
            revert MarketNotTradable(uint8(m.status), m.opensAt, m.cutoffAt);
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function _requirePool(PoolKey calldata key) private view {
        bytes32 actual = PoolId.unwrap(key.toId());
        if (!registry.isRegisteredPool(marketId, actual)) revert PoolNotRegistered();
    }
}
