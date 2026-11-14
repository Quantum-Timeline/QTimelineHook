// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BaseHook} from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "@uniswap/v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IQTimelineMarketRegistry} from "../interfaces/IQTimeline.sol";

/// @notice Upgradeable lifecycle gate on every direct or routed Uniswap v4 swap of an IPO market's pools, deployed behind a beacon.
/// @dev Uniswap v4 reads permission flags from the hook address. Each market's hook is a BeaconProxy deployed with CREATE2 at an address
///      carrying the required bits (see IpoHookDeployer), and the implementation is mined the same way because the BaseHook constructor
///      checks its own address. Per-market settings live in the proxy.
contract IpoTimelineHook is BaseHook, Initializable {
    using PoolIdLibrary for PoolKey;

    error Unauthorized();
    error PoolNotRegistered();
    error MarketNotTradable(uint8 status, uint64 opensAt, uint64 cutoffAt);
    error LiquidityUnavailable();

    IQTimelineMarketRegistry public registry;
    address public factory;
    bytes32 public marketId;
    uint256[47] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(IPoolManager manager) BaseHook(manager) { _disableInitializers(); }

    function initialize(IQTimelineMarketRegistry registry_, address factory_, bytes32 marketId_) external initializer {
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
