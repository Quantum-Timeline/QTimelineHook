// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IConditionalVault, IQTimelineMarketRegistry} from "../interfaces/IQTimeline.sol";
import {ProbabilitySellMath} from "../libraries/ProbabilitySellMath.sol";

/// @notice Atomic split -> v4 exact-input swap -> deliver conditional output and paired opposite claim, upgradeable behind a transparent proxy.
/// @dev Same trade logic as TimelineRouter for the IPO system. The router holds no balances between calls; its pool manager and registry
///      pointers and the per-user nonces live in the proxy. The proxy admin can replace this logic.
contract IpoTimelineRouter is Initializable, IUnlockCallback {
    using PoolIdLibrary for PoolKey;
    using SafeERC20 for IERC20;

    error Unauthorized(); error InvalidRequest(); error Expired(); error InvalidNonce(); error ZeroFill(); error Slippage(); error SettlementMismatch(); error NativeTransferFailed();

    IPoolManager public poolManager;
    IQTimelineMarketRegistry public registry;
    mapping(address => uint64) public nonces;
    bool private _entered;
    uint256[45] private __gap;

    event ConditionalTrade(address indexed payer, address indexed recipient, bytes32 indexed marketId, bytes32 poolId, address assetIn, address assetOut, bool yes, uint256 amountIn, uint256 amountOut, uint64 nonce);

    struct TradeRequest {
        bytes32 marketId;
        IConditionalVault vault;
        PoolKey key;
        address assetIn;
        address assetOut;
        address recipient;
        bool yes;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint160 sqrtPriceLimitX96;
        uint64 deadline;
        uint64 nonce;
        bytes32 expectedConfigHash;
    }

    struct CloseRequest {
        bytes32 marketId;
        IConditionalVault vault;
        PoolKey key;
        address assetIn;
        address assetOut;
        address recipient;
        bool yes;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint160 sqrtPriceLimitX96;
        uint64 deadline;
        uint64 nonce;
        bytes32 expectedConfigHash;
    }

    struct ProbabilityRequest {
        bytes32 marketId;
        IConditionalVault vault;
        PoolKey key;
        address asset;
        address recipient;
        bool yes;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        uint160 sqrtPriceLimitX96;
        uint64 deadline;
        uint64 nonce;
        bytes32 expectedConfigHash;
    }

    struct ProbabilitySellRequest {
        bytes32 marketId;
        IConditionalVault vault;
        PoolKey key;
        address asset;
        address recipient;
        bool yes;
        bool zeroForOne;
        uint128 amountIn;
        uint128 swapAmount;
        uint128 minAmountOut;
        uint160 sqrtPriceLimitX96;
        uint64 deadline;
        uint64 nonce;
        bytes32 expectedConfigHash;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(IPoolManager manager_, IQTimelineMarketRegistry registry_) external initializer {
        require(address(manager_).code.length != 0 && address(registry_).code.length != 0, "invalid dependencies");
        poolManager = manager_;
        registry = registry_;
    }

    function tradeAsset(TradeRequest calldata r) external payable returns (uint128 amountOut) {
        if (_entered) revert Unauthorized();
        _entered = true;
        if (r.recipient == address(0) || r.recipient == address(this) || r.assetIn == r.assetOut || r.amountIn == 0 || r.minAmountOut == 0) revert InvalidRequest();
        if (block.timestamp > r.deadline) revert Expired();
        if (r.nonce != nonces[msg.sender]) revert InvalidNonce();
        IQTimelineMarketRegistry.Market memory m = registry.market(r.marketId);
        if (!m.activated || m.status != IQTimelineMarketRegistry.Status.Open || m.configHash != r.expectedConfigHash || m.vault != address(r.vault)) revert InvalidRequest();
        if (!registry.isRegisteredPool(r.marketId, PoolId.unwrap(r.key.toId())) || address(r.key.hooks) == address(0) || r.key.fee != 3000 || r.key.tickSpacing != 60) revert InvalidRequest();
        address selectedIn = r.vault.outcomeToken(r.assetIn, r.yes);
        address selectedOut = r.vault.outcomeToken(r.assetOut, r.yes);
        address opposite = r.vault.outcomeToken(r.assetIn, !r.yes);
        address actualIn = Currency.unwrap(r.zeroForOne ? r.key.currency0 : r.key.currency1);
        address actualOut = Currency.unwrap(r.zeroForOne ? r.key.currency1 : r.key.currency0);
        if (selectedIn != actualIn || selectedOut != actualOut || r.vault.marketId() != r.marketId) revert InvalidRequest();

        if (r.assetIn == address(0)) {
            if (msg.value != r.amountIn) revert InvalidRequest();
            r.vault.split{value: r.amountIn}(r.assetIn, r.amountIn, address(this));
        } else {
            if (msg.value != 0) revert InvalidRequest();
            IERC20(r.assetIn).safeTransferFrom(msg.sender, address(this), r.amountIn);
            IERC20(r.assetIn).forceApprove(address(r.vault), r.amountIn);
            r.vault.split(r.assetIn, r.amountIn, address(this));
            IERC20(r.assetIn).forceApprove(address(r.vault), 0);
        }

        bytes memory result = poolManager.unlock(abi.encode(uint8(0), msg.sender, r, selectedIn, selectedOut));
        amountOut = abi.decode(result, (uint128));
        if (amountOut < r.minAmountOut) revert Slippage();
        IERC20(selectedOut).safeTransfer(r.recipient, amountOut);
        IERC20(opposite).safeTransfer(r.recipient, r.amountIn);
        nonces[msg.sender] = r.nonce + 1;
        emit ConditionalTrade(msg.sender, r.recipient, r.marketId, PoolId.unwrap(r.key.toId()), r.assetIn, r.assetOut, r.yes, r.amountIn, amountOut, r.nonce);
        _entered = false;
    }

    /// @notice Sell an existing conditional asset through its timeline pool and merge any output paired claim.
    /// @dev Any unpaired output remains as a conditional token and is returned to the recipient.
    function closeConditional(CloseRequest calldata r) external returns (uint128 amountOut) {
        if (_entered) revert Unauthorized();
        _entered = true;
        if (r.recipient == address(0) || r.recipient == address(this) || r.assetIn == r.assetOut || r.amountIn == 0 || r.minAmountOut == 0) revert InvalidRequest();
        if (block.timestamp > r.deadline || r.nonce != nonces[msg.sender]) revert InvalidNonce();
        IQTimelineMarketRegistry.Market memory m = registry.market(r.marketId);
        if (!m.activated || m.status != IQTimelineMarketRegistry.Status.Open || m.configHash != r.expectedConfigHash || m.vault != address(r.vault)) revert InvalidRequest();
        if (!registry.isRegisteredPool(r.marketId, PoolId.unwrap(r.key.toId())) || address(r.key.hooks) == address(0) || r.key.fee != 3000 || r.key.tickSpacing != 60) revert InvalidRequest();
        address selectedIn = r.vault.outcomeToken(r.assetIn, r.yes);
        address selectedOut = r.vault.outcomeToken(r.assetOut, r.yes);
        address oppositeOut = r.vault.outcomeToken(r.assetOut, !r.yes);
        address actualIn = Currency.unwrap(r.zeroForOne ? r.key.currency0 : r.key.currency1);
        address actualOut = Currency.unwrap(r.zeroForOne ? r.key.currency1 : r.key.currency0);
        if (selectedIn != actualIn || selectedOut != actualOut || r.vault.marketId() != r.marketId) revert InvalidRequest();

        IERC20(selectedIn).safeTransferFrom(msg.sender, address(this), r.amountIn);
        bytes memory result = poolManager.unlock(abi.encode(uint8(1), msg.sender, r, selectedIn, selectedOut));
        amountOut = abi.decode(result, (uint128));
        if (amountOut < r.minAmountOut) revert Slippage();

        uint256 pairBalance = IERC20(oppositeOut).balanceOf(msg.sender);
        uint128 mergeAmount = amountOut < pairBalance ? amountOut : uint128(pairBalance);
        if (mergeAmount != 0) {
            IERC20(oppositeOut).safeTransferFrom(msg.sender, address(this), mergeAmount);
            r.vault.merge(r.assetOut, mergeAmount, r.recipient);
        }
        uint128 remainder = amountOut - mergeAmount;
        if (remainder != 0) IERC20(selectedOut).safeTransfer(r.recipient, remainder);
        nonces[msg.sender] = r.nonce + 1;
        emit ConditionalTrade(msg.sender, r.recipient, r.marketId, PoolId.unwrap(r.key.toId()), r.assetIn, r.assetOut, r.yes, r.amountIn, amountOut, r.nonce);
        _entered = false;
    }

    /// @notice Split collateral and exchange one side through the market's YES/NO price pool.
    function buyProbability(ProbabilityRequest calldata r) external returns (uint128 totalOutcome) {
        if (_entered) revert Unauthorized();
        _entered = true;
        _validateProbability(r.marketId, r.vault, r.key, r.asset, r.recipient, r.amountIn, r.minAmountOut, r.deadline, r.nonce, r.expectedConfigHash);
        address selected = r.vault.outcomeToken(r.asset, r.yes);
        address opposite = r.vault.outcomeToken(r.asset, !r.yes);
        address actualIn = Currency.unwrap(r.zeroForOne ? r.key.currency0 : r.key.currency1);
        address actualOut = Currency.unwrap(r.zeroForOne ? r.key.currency1 : r.key.currency0);
        if (opposite != actualIn || selected != actualOut) revert InvalidRequest();

        IERC20(r.asset).safeTransferFrom(msg.sender, address(this), r.amountIn);
        IERC20(r.asset).forceApprove(address(r.vault), r.amountIn);
        r.vault.split(r.asset, r.amountIn, address(this));
        IERC20(r.asset).forceApprove(address(r.vault), 0);
        bytes memory result = poolManager.unlock(abi.encode(uint8(2), msg.sender, r, opposite, selected));
        uint128 swapOut = abi.decode(result, (uint128));
        uint256 total = uint256(r.amountIn) + swapOut;
        if (total > type(uint128).max || IERC20(selected).balanceOf(address(this)) != total) revert SettlementMismatch();
        totalOutcome = uint128(total);
        IERC20(selected).safeTransfer(r.recipient, totalOutcome);
        nonces[msg.sender] = r.nonce + 1;
        emit ConditionalTrade(msg.sender, r.recipient, r.marketId, PoolId.unwrap(r.key.toId()), r.asset, r.asset, r.yes, r.amountIn, totalOutcome, r.nonce);
        _entered = false;
    }

    /// @notice Sell part of a YES/NO position, merge the matching pair and return collateral plus unpaired claims.
    function sellProbability(ProbabilitySellRequest calldata r) external returns (uint128 collateralOut) {
        if (_entered) revert Unauthorized();
        _entered = true;
        if (r.swapAmount == 0 || r.swapAmount >= r.amountIn) revert InvalidRequest();
        _validateProbability(r.marketId, r.vault, r.key, r.asset, r.recipient, r.swapAmount, r.minAmountOut, r.deadline, r.nonce, r.expectedConfigHash);
        address selected = r.vault.outcomeToken(r.asset, r.yes);
        address opposite = r.vault.outcomeToken(r.asset, !r.yes);
        address actualIn = Currency.unwrap(r.zeroForOne ? r.key.currency0 : r.key.currency1);
        address actualOut = Currency.unwrap(r.zeroForOne ? r.key.currency1 : r.key.currency0);
        if (selected != actualIn || opposite != actualOut) revert InvalidRequest();

        IERC20(selected).safeTransferFrom(msg.sender, address(this), r.swapAmount);
        bytes memory result = poolManager.unlock(abi.encode(uint8(3), msg.sender, r, selected, opposite));
        uint128 swapOut = abi.decode(result, (uint128));
        uint128 mergeAmount = ProbabilitySellMath.mergeAmount(r.amountIn, r.swapAmount, swapOut);
        if (mergeAmount < r.minAmountOut) revert Slippage();
        IERC20(selected).safeTransferFrom(msg.sender, address(this), mergeAmount);
        r.vault.merge(r.asset, mergeAmount, r.recipient);
        uint128 remainder = swapOut - mergeAmount;
        if (remainder != 0) IERC20(opposite).safeTransfer(r.recipient, remainder);
        collateralOut = mergeAmount;
        nonces[msg.sender] = r.nonce + 1;
        emit ConditionalTrade(msg.sender, r.recipient, r.marketId, PoolId.unwrap(r.key.toId()), r.asset, r.asset, r.yes, r.amountIn, collateralOut, r.nonce);
        _entered = false;
    }

    function _validateProbability(bytes32 marketId, IConditionalVault vault, PoolKey calldata key, address asset, address recipient, uint128 amountIn, uint128 minAmountOut, uint64 deadline, uint64 nonce, bytes32 expectedConfigHash) private view {
        if (recipient == address(0) || recipient == address(this) || amountIn == 0 || minAmountOut == 0) revert InvalidRequest();
        if (block.timestamp > deadline) revert Expired();
        if (nonce != nonces[msg.sender]) revert InvalidNonce();
        IQTimelineMarketRegistry.Market memory m = registry.market(marketId);
        if (!m.activated || m.status != IQTimelineMarketRegistry.Status.Open || m.configHash != expectedConfigHash || m.vault != address(vault)) revert InvalidRequest();
        if (vault.marketId() != marketId || !registry.isRegisteredPool(marketId, PoolId.unwrap(key.toId())) || address(key.hooks) == address(0) || key.fee != 3000 || key.tickSpacing != 60) revert InvalidRequest();
        if (asset == address(0) || (asset != vault.assets(0) && asset != vault.assets(1))) revert InvalidRequest();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager) || !_entered) revert Unauthorized();
        uint8 mode = abi.decode(data, (uint8));
        if (mode == 0) {
            (address payer, TradeRequest memory r, address tokenIn, address tokenOut) = abi.decode(data[32:], (address, TradeRequest, address, address));
            uint128 out = _swapAndSettle(r.key, r.zeroForOne, r.amountIn, r.sqrtPriceLimitX96, tokenIn, tokenOut, r.minAmountOut);
            if (IERC20(tokenIn).balanceOf(address(this)) != 0 || IERC20(tokenOut).balanceOf(address(this)) != out) revert SettlementMismatch();
            payer;
            return abi.encode(out);
        }
        if (mode == 1) {
            (address payer, CloseRequest memory r, address tokenIn, address tokenOut) = abi.decode(data[32:], (address, CloseRequest, address, address));
            uint128 out = _swapAndSettle(r.key, r.zeroForOne, r.amountIn, r.sqrtPriceLimitX96, tokenIn, tokenOut, r.minAmountOut);
            if (IERC20(tokenIn).balanceOf(address(this)) != 0 || IERC20(tokenOut).balanceOf(address(this)) != out) revert SettlementMismatch();
            payer;
            return abi.encode(out);
        }
        if (mode == 2) {
            (address payer, ProbabilityRequest memory r, address tokenIn, address tokenOut) = abi.decode(data[32:], (address, ProbabilityRequest, address, address));
            uint128 out = _swapAndSettle(r.key, r.zeroForOne, r.amountIn, r.sqrtPriceLimitX96, tokenIn, tokenOut, r.minAmountOut);
            if (IERC20(tokenIn).balanceOf(address(this)) != 0 || IERC20(tokenOut).balanceOf(address(this)) != uint256(r.amountIn) + out) revert SettlementMismatch();
            payer;
            return abi.encode(out);
        }
        if (mode == 3) {
            (address payer, ProbabilitySellRequest memory r, address tokenIn, address tokenOut) = abi.decode(data[32:], (address, ProbabilitySellRequest, address, address));
            uint128 out = _swapAndSettle(r.key, r.zeroForOne, r.swapAmount, r.sqrtPriceLimitX96, tokenIn, tokenOut, 0);
            if (IERC20(tokenIn).balanceOf(address(this)) != 0 || IERC20(tokenOut).balanceOf(address(this)) != out) revert SettlementMismatch();
            payer;
            return abi.encode(out);
        }
        revert InvalidRequest();
    }

    function _swapAndSettle(PoolKey memory key, bool zeroForOne, uint128 amountIn, uint160 sqrtPriceLimitX96, address tokenIn, address tokenOut, uint128 minAmountOut) private returns (uint128 actualOut) {
        BalanceDelta delta = poolManager.swap(key, SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(uint256(amountIn)), sqrtPriceLimitX96: sqrtPriceLimitX96}), bytes(""));
        int128 inDelta = zeroForOne ? delta.amount0() : delta.amount1();
        int128 outDelta = zeroForOne ? delta.amount1() : delta.amount0();
        if (inDelta >= 0 || outDelta <= 0) revert ZeroFill();
        uint128 actualIn = uint128(uint256(-int256(inDelta)));
        actualOut = uint128(uint256(int256(outDelta)));
        if (actualIn != amountIn || actualOut < minAmountOut) revert Slippage();
        Currency input = zeroForOne ? key.currency0 : key.currency1;
        Currency output = zeroForOne ? key.currency1 : key.currency0;
        if (Currency.unwrap(input) != tokenIn || Currency.unwrap(output) != tokenOut) revert SettlementMismatch();
        poolManager.sync(input);
        IERC20(tokenIn).safeTransfer(address(poolManager), actualIn);
        poolManager.settle();
        poolManager.take(output, address(this), actualOut);
    }

    receive() external payable { revert Unauthorized(); }
}
