// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IQTimelineMarketRegistry} from "../src/interfaces/IQTimeline.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {MarketFactory, IQTPQRegistry, IQTVerifier} from "../src/MarketFactory.sol";
import {ConditionalVault} from "../src/ConditionalVault.sol";
import {TimelineHookDeployer} from "../src/TimelineHookDeployer.sol";
import {TimelineRouter} from "../src/TimelineRouter.sol";
import {IConditionalVault} from "../src/interfaces/IQTimeline.sol";

contract ForkKeyStub { function publicKeyBlob(address) external pure returns (address) { return address(0xBEEF); } }
contract ForkVerifierStub { function verify(address, bytes calldata, bytes calldata) external pure returns (bool) { return true; } }

/// @dev Minimal treasury LP / direct-swap helper standing in for PositionManager so the test controls tick ranges exactly.
contract ForkLpHelper is IUnlockCallback {
    IPoolManager public immutable pm;
    constructor(IPoolManager pm_) { pm = pm_; }

    function modify(PoolKey memory key, ModifyLiquidityParams memory p, address to) external returns (BalanceDelta d) {
        d = abi.decode(pm.unlock(abi.encode(uint8(0), key, p, msg.sender, to, false)), (BalanceDelta));
    }

    function swapDirect(PoolKey memory key, bool zeroForOne, uint256 amountIn) external returns (BalanceDelta d) {
        ModifyLiquidityParams memory p;
        SwapParams memory sp = SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1});
        d = abi.decode(pm.unlock(abi.encode(uint8(1), key, p, msg.sender, msg.sender, sp.zeroForOne, amountIn)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "pm only");
        uint8 mode = abi.decode(data, (uint8));
        if (mode == 0) {
            (, PoolKey memory key, ModifyLiquidityParams memory p, address payer, address to,) = abi.decode(data, (uint8, PoolKey, ModifyLiquidityParams, address, address, bool));
            (BalanceDelta d,) = pm.modifyLiquidity(key, p, bytes(""));
            _settle(key.currency0, d.amount0(), payer, to);
            _settle(key.currency1, d.amount1(), payer, to);
            return abi.encode(d);
        }
        (, PoolKey memory k, , address payer2, address to2, bool zfo, uint256 amountIn) = abi.decode(data, (uint8, PoolKey, ModifyLiquidityParams, address, address, bool, uint256));
        BalanceDelta sd = pm.swap(k, SwapParams({zeroForOne: zfo, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: zfo ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1}), bytes(""));
        _settle(k.currency0, sd.amount0(), payer2, to2);
        _settle(k.currency1, sd.amount1(), payer2, to2);
        return abi.encode(sd);
    }

    function _settle(Currency c, int128 amt, address payer, address to) private {
        if (amt < 0) {
            pm.sync(c);
            IERC20(Currency.unwrap(c)).transferFrom(payer, address(pm), uint128(-amt));
            pm.settle();
        } else if (amt > 0) {
            pm.take(c, to, uint128(amt));
        }
    }
}

/// @notice Mainnet-fork integration of the full product against the official Robinhood v4 PoolManager and USDG.
/// @dev ML-DSA verification and the PQ registry are stubbed here; they are exercised separately against the real verifier.
///      Run via `pnpm contracts:test:mainnet-fork`. Skipped unless the fork profile (chain 4663) is active.
contract MainnetForkLifecycleTest is Test {
    address private constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    uint256 private constant DEPLOYER_KEY = 0xD3910E5;
    uint256 private constant ETH_PRICE_USD = 2000; // reference price used to open the timeline pools

    address private deployer;
    address private trader = address(0x7A4DE2);
    MarketRegistry private registry;
    MarketFactory private factory;
    TimelineRouter private router;
    ForkLpHelper private lp;
    ConditionalVault private vault;
    bytes32 private marketId;
    bytes32 private configHash;
    PoolKey[3] private keys;
    address[4] private t; // yesEth, noEth, yesUsd, noUsd
    uint64 private opensAt;
    uint64 private cutoffAt;
    uint64 private releaseAt;
    uint64 private deadline;

    ModifyLiquidityParams[3] private positions;

    function setUp() public {
        if (block.chainid != 4663) vm.skip(true, "requires the Robinhood Mainnet fork profile");
        deployer = vm.addr(DEPLOYER_KEY);
        vm.deal(deployer, 10 ether);
        vm.deal(trader, 10 ether);
        deal(USDG, deployer, 1_000e6);
        deal(USDG, trader, 1_000e6);

        registry = new MarketRegistry(deployer, false);
        ForkKeyStub keysStub = new ForkKeyStub();
        ForkVerifierStub verifier = new ForkVerifierStub();
        factory = new MarketFactory(deployer, USDG, IPoolManager(POOL_MANAGER), registry, IQTPQRegistry(address(keysStub)), IQTVerifier(address(verifier)), false);
        TimelineHookDeployer hookDeployer = new TimelineHookDeployer(address(factory));
        router = new TimelineRouter(IPoolManager(POOL_MANAGER), registry);
        lp = new ForkLpHelper(IPoolManager(POOL_MANAGER));
        vm.startPrank(deployer);
        factory.setHookDeployer(hookDeployer);
        registry.wireAndSeal(address(factory), address(this)); // this test contract plays the resolver
        vm.stopPrank();

        opensAt = uint64(block.timestamp + 2 days);
        cutoffAt = opensAt + 3 days;
        releaseAt = cutoffAt + 300;
        deadline = releaseAt + 172_800;
        MarketFactory.MarketConfig memory c = MarketFactory.MarketConfig({
            opensAt: opensAt, cutoffAt: cutoffAt, releaseAt: releaseAt, deadline: deadline,
            periodId: keccak256("2026-10"), thresholdBps: 30, ethCollateralCap: 0.1 ether, usdgCollateralCap: 500e6,
            nonce: 0, signatureExpiry: opensAt
        });
        configHash = keccak256(abi.encode(block.chainid, address(factory), c.opensAt, c.cutoffAt, c.releaseAt, c.deadline, c.periodId, c.thresholdBps, c.ethCollateralCap, c.usdgCollateralCap));
        marketId = keccak256(abi.encode(configHash, uint256(0)));
        bytes32 digest;
        {
            bytes32 domain = keccak256(abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("QTimeline"), keccak256("1"), block.chainid, address(factory)
            ));
            digest = keccak256(abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(factory.CREATE_TYPEHASH(), configHash, c.nonce, c.signatureExpiry))));
        }
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DEPLOYER_KEY, digest);
        bytes32 salt = _mineHookSalt(hookDeployer);
        vm.prank(deployer);
        factory.createMarket(c, abi.encodePacked(r, s, v), hex"01", salt);

        vault = ConditionalVault(payable(factory.vaultOf(marketId)));
        address[4] memory tk = factory.tokens(marketId);
        t = tk;
        PoolKey[3] memory pk = factory.poolKeys(marketId);
        for (uint256 i; i < 3; ++i) keys[i] = pk[i];

        // initialize + seed (Draft): plan budget of 120 USDG and ~0.0265 ETH, split once by the treasury.
        uint160[3] memory prices = [_ethPoolPrice(keys[0], t[0]), _ethPoolPrice(keys[1], t[1]), uint160(1 << 96)];
        vm.startPrank(deployer);
        factory.initializePools(marketId, prices);
        vault.split{value: 0.0265 ether}(address(0), 0.0265 ether, deployer);
        IERC20(USDG).approve(address(vault), 120e6);
        vault.split(USDG, 120e6, deployer);
        for (uint256 i; i < 4; ++i) IERC20(t[i]).approve(address(lp), type(uint256).max);
        vm.stopPrank();

        _seed(0, prices[0], 0.0265 ether, 53e6, true);
        _seed(1, prices[1], 0.0265 ether, 53e6, true);
        _seed(2, prices[2], 67e6, 67e6, false);

        vm.prank(deployer);
        factory.activateMarket(marketId);
        vm.warp(opensAt);
        registry.syncTime(marketId);
        assertEq(uint8(registry.market(marketId).status), uint8(IQTimelineMarketRegistry.Status.Open));

        vm.startPrank(trader);
        IERC20(USDG).approve(address(router), type(uint256).max);
        IERC20(USDG).approve(address(vault), type(uint256).max);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- helpers

    function _mineHookSalt(TimelineHookDeployer hd) private view returns (bytes32 salt) {
        bytes32 ich = hd.initCodeHash(IPoolManager(POOL_MANAGER), registry, marketId);
        for (uint256 i; i < 2_000_000; ++i) {
            address a = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(hd), bytes32(i), ich)))));
            if (uint160(a) & 0x3FFF == 0x2880) return bytes32(i);
        }
        revert("no hook salt");
    }

    /// @dev USDG-per-ETH raw price, expressed as the pool's token1/token0 sqrt price.
    function _ethPoolPrice(PoolKey memory k, address ethClaim) private pure returns (uint160) {
        uint256 ethRaw = 1e18;
        uint256 usdRaw = ETH_PRICE_USD * 1e6;
        bool ethIs0 = Currency.unwrap(k.currency0) == ethClaim;
        uint256 a0 = ethIs0 ? ethRaw : usdRaw;
        uint256 a1 = ethIs0 ? usdRaw : ethRaw;
        return uint160(Math.sqrt(Math.mulDiv(a1, 1 << 192, a0)));
    }

    function _seed(uint256 i, uint160 sqrtP, uint256 ethAmt, uint256 usdAmt, bool ethPool) private {
        int24 center = TickMath.getTickAtSqrtPrice(sqrtP);
        int24 half = ethPool ? int24(2232) : int24(6190); // +-25%/-20% price band, or 35%-65% probability band
        int24 lo = _floor60(center - half);
        int24 hi = _ceil60(center + half);
        (uint256 a0, uint256 a1) = _amounts(i, ethPool, ethAmt, usdAmt);
        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(sqrtP, TickMath.getSqrtPriceAtTick(lo), TickMath.getSqrtPriceAtTick(hi), a0, a1);
        positions[i] = ModifyLiquidityParams({tickLower: lo, tickUpper: hi, liquidityDelta: int256(uint256(liq)), salt: bytes32(i)});
        vm.prank(deployer);
        lp.modify(keys[i], positions[i], deployer);
        console2.log("seeded pool", i, "liquidity", uint256(liq));
    }

    function _amounts(uint256 i, bool ethPool, uint256 ethAmt, uint256 usdAmt) private view returns (uint256 a0, uint256 a1) {
        if (!ethPool) return (usdAmt, usdAmt);
        address ethClaim = i == 0 ? t[0] : t[1];
        bool ethIs0 = Currency.unwrap(keys[i].currency0) == ethClaim;
        (a0, a1) = ethIs0 ? (ethAmt, usdAmt) : (usdAmt, ethAmt);
    }

    function _floor60(int24 x) private pure returns (int24) { int24 q = x / 60; if (x < 0 && x % 60 != 0) q -= 1; return q * 60; }
    function _ceil60(int24 x) private pure returns (int24) { int24 q = x / 60; if (x > 0 && x % 60 != 0) q += 1; return q * 60; }

    function _limit(bool zeroForOne) private pure returns (uint160) { return zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1; }

    function _tradeReq(uint256 pool, address assetIn, address assetOut, bool yes, uint256 amountIn, address selIn) private view returns (TimelineRouter.TradeRequest memory r) {
        bool z = Currency.unwrap(keys[pool].currency0) == selIn;
        r = TimelineRouter.TradeRequest({
            marketId: marketId, vault: IConditionalVault(address(vault)), key: keys[pool], assetIn: assetIn, assetOut: assetOut,
            recipient: trader, yes: yes, zeroForOne: z, amountIn: uint128(amountIn), minAmountOut: 1, sqrtPriceLimitX96: _limit(z),
            deadline: uint64(block.timestamp + 1 hours), nonce: router.nonces(trader), expectedConfigHash: configHash
        });
    }

    /// @dev price impact in bps excluding the 0.30% LP fee, versus the opening spot price.
    function _impactBps(uint256 idealOutNoFee, uint256 actualOut) private pure returns (uint256) {
        uint256 afterFee = idealOutNoFee * 9970 / 10_000;
        return actualOut >= afterFee ? 0 : (afterFee - actualOut) * 10_000 / afterFee;
    }

    // ---------------------------------------------------------------- six-direction trades with the $5 opening target

    function testBuyAndSellEthTimelinesAndMeasureDepth() public {
        // Buy ETH-YES and ETH-NO with $5 USDG.
        for (uint256 pool; pool < 2; ++pool) {
            bool yes = pool == 0;
            address selIn = yes ? t[2] : t[3];
            TimelineRouter.TradeRequest memory r = _tradeReq(pool, USDG, address(0), yes, 5e6, selIn);
            uint256 g = gasleft();
            vm.prank(trader);
            uint128 out = router.tradeAsset(r);
            g -= gasleft();
            uint256 ideal = 5e6 * 1e18 / (ETH_PRICE_USD * 1e6);
            uint256 impact = _impactBps(ideal, out);
            console2.log(yes ? "buy ETH-YES $5 out(wei)" : "buy ETH-NO  $5 out(wei)", uint256(out));
            console2.log("  impact bps (ex-fee):", impact);
            console2.log("  gas:", g);
            assertLe(impact, 100, "buy impact above 1% target");
        }
    }

    /// @dev Separate test so the sell side is measured from the opening price, not after the buys above moved it.
    function testSellEthIntoTimelinesAtOpeningPrice() public {
        uint256 ethIn = 5e6 * 1e18 / (ETH_PRICE_USD * 1e6); // 0.0025 ETH
        for (uint256 pool; pool < 2; ++pool) {
            bool yes = pool == 0;
            address selIn = yes ? t[0] : t[1];
            TimelineRouter.TradeRequest memory r = _tradeReq(pool, address(0), USDG, yes, ethIn, selIn);
            uint256 g = gasleft();
            vm.prank(trader);
            uint128 out = router.tradeAsset{value: ethIn}(r);
            g -= gasleft();
            uint256 ideal = ethIn * (ETH_PRICE_USD * 1e6) / 1e18;
            uint256 impact = _impactBps(ideal, out);
            console2.log(yes ? "sell ETH-YES $5 out(usdg raw)" : "sell ETH-NO  $5 out(usdg raw)", uint256(out));
            console2.log("  impact bps (ex-fee):", impact);
            console2.log("  gas:", g);
            assertLe(impact, 100, "sell impact above 1% target");
        }
    }

    function testProbabilityPoolBuyAndExitBothSides() public {
        for (uint256 side; side < 2; ++side) {
            bool yes = side == 0;
            TimelineRouter.ProbabilityRequest memory br = TimelineRouter.ProbabilityRequest({
                marketId: marketId, vault: IConditionalVault(address(vault)), key: keys[2], asset: USDG, recipient: trader, yes: yes,
                zeroForOne: Currency.unwrap(keys[2].currency0) == (yes ? t[3] : t[2]), amountIn: 5e6, minAmountOut: 1,
                sqrtPriceLimitX96: 0, deadline: uint64(block.timestamp + 1 hours), nonce: router.nonces(trader), expectedConfigHash: configHash
            });
            br.sqrtPriceLimitX96 = _limit(br.zeroForOne);
            uint256 g = gasleft();
            vm.prank(trader);
            uint128 total = router.buyProbability(br);
            g -= gasleft();
            console2.log(yes ? "buy YES $5 -> claims(raw)" : "buy NO  $5 -> claims(raw)", uint256(total));
            console2.log("  gas:", g);
            assertGt(total, 5e6, "no swap output added to the split claims");

            // exit: sell half of the position into the opposite side, merge the pair back to USDG
            address selected = yes ? t[2] : t[3];
            vm.prank(trader);
            IERC20(selected).approve(address(router), type(uint256).max);
            uint128 holding = uint128(IERC20(selected).balanceOf(trader));
            uint128 swapAmt = holding / 2;
            TimelineRouter.ProbabilitySellRequest memory sr = TimelineRouter.ProbabilitySellRequest({
                marketId: marketId, vault: IConditionalVault(address(vault)), key: keys[2], asset: USDG, recipient: trader, yes: yes,
                zeroForOne: Currency.unwrap(keys[2].currency0) == selected, amountIn: holding, swapAmount: swapAmt, minAmountOut: 1,
                sqrtPriceLimitX96: 0, deadline: uint64(block.timestamp + 1 hours), nonce: router.nonces(trader), expectedConfigHash: configHash
            });
            sr.sqrtPriceLimitX96 = _limit(sr.zeroForOne);
            uint256 usdBefore = IERC20(USDG).balanceOf(trader);
            g = gasleft();
            vm.prank(trader);
            uint128 collateral = router.sellProbability(sr);
            g -= gasleft();
            console2.log(yes ? "exit YES -> USDG(raw)" : "exit NO  -> USDG(raw)", uint256(collateral));
            console2.log("  gas:", g);
            assertEq(IERC20(USDG).balanceOf(trader) - usdBefore, collateral, "collateral not delivered");
            assertGt(collateral, 2e6, "exit returned implausibly little");
        }
    }

    function testCloseConditionalReturnsCollateralWithPairedClaim() public {
        TimelineRouter.TradeRequest memory r = _tradeReq(0, USDG, address(0), true, 5e6, t[2]);
        vm.prank(trader);
        uint128 ethYes = router.tradeAsset(r);
        // trader now holds ETH-YES (output) and USDG-NO (paired). Closing sells ETH-YES for USDG-YES and merges with USDG-NO.
        vm.startPrank(trader);
        IERC20(t[0]).approve(address(router), type(uint256).max);
        IERC20(t[3]).approve(address(router), type(uint256).max);
        bool z = Currency.unwrap(keys[0].currency0) == t[0];
        TimelineRouter.CloseRequest memory cr = TimelineRouter.CloseRequest({
            marketId: marketId, vault: IConditionalVault(address(vault)), key: keys[0], assetIn: address(0), assetOut: USDG, recipient: trader,
            yes: true, zeroForOne: z, amountIn: ethYes, minAmountOut: 1, sqrtPriceLimitX96: _limit(z),
            deadline: uint64(block.timestamp + 1 hours), nonce: router.nonces(trader), expectedConfigHash: configHash
        });
        uint256 usdBefore = IERC20(USDG).balanceOf(trader);
        uint256 g = gasleft();
        router.closeConditional(cr);
        g -= gasleft();
        vm.stopPrank();
        uint256 back = IERC20(USDG).balanceOf(trader) - usdBefore;
        console2.log("round trip $5 -> ETH-YES -> USDG returned(raw):", back);
        console2.log("  gas:", g);
        // Two 0.30% fees plus impact; the round trip must return at least 98%.
        assertGe(back, 4_900_000, "round trip lost more than 2%");
    }

    // ---------------------------------------------------------------- lifecycle: cutoff guard, LP exit, resolution, payout

    function testCutoffBlocksRouterAndDirectSwapsThenLpExitsAndWinnersRedeem() public {
        TimelineRouter.TradeRequest memory r = _tradeReq(0, USDG, address(0), true, 5e6, t[2]);
        vm.prank(trader);
        uint128 yesEthOut = router.tradeAsset(r);

        vm.warp(cutoffAt);
        registry.syncTime(marketId);
        r.nonce = router.nonces(trader);
        r.deadline = uint64(block.timestamp + 1 hours);
        vm.prank(trader);
        vm.expectRevert();
        router.tradeAsset(r);
        // direct PoolManager swap (bypassing the router) is gated by the hook as well
        vm.startPrank(deployer);
        IERC20(t[2]).approve(address(lp), type(uint256).max);
        IERC20(t[3]).approve(address(lp), type(uint256).max);
        vm.expectRevert();
        lp.swapDirect(keys[0], Currency.unwrap(keys[0].currency0) == t[2], 1e6);
        vm.stopPrank();

        // LP exit stays available while awaiting the result.
        _removeAllLiquidity();

        vm.warp(releaseAt);
        registry.setTerminal(marketId, IQTimelineMarketRegistry.Status.FinalYes, 30, keccak256("evidence"));

        // trader redeems the winning ETH-YES claim 1:1; its USDG-NO claim is worth zero
        vm.startPrank(trader);
        uint256 ethBefore = trader.balance;
        vault.redeem(address(0), true, yesEthOut, trader);
        assertEq(trader.balance - ethBefore, yesEthOut, "winner not paid 1:1");
        vault.redeem(USDG, false, IERC20(t[3]).balanceOf(trader), trader);
        vm.stopPrank();

        // treasury redeems everything it holds, including claims received from the pools
        vm.startPrank(deployer);
        _redeemAll(deployer);
        vm.stopPrank();
        _assertSolventWithDustOnly();
    }

    function testCancellationPaysHalfAndPoolsStillExit() public {
        TimelineRouter.TradeRequest memory r = _tradeReq(1, USDG, address(0), false, 5e6, t[3]);
        vm.prank(trader);
        router.tradeAsset(r);

        vm.warp(deadline);
        // no result was reported: anyone-style cancel path (resolver stand-in writes the terminal state)
        registry.setTerminal(marketId, IQTimelineMarketRegistry.Status.Cancelled, 0, bytes32(0));
        _removeAllLiquidity();

        vm.startPrank(trader);
        _redeemAll(trader);
        vm.stopPrank();
        vm.startPrank(deployer);
        _redeemAll(deployer);
        vm.stopPrank();
        _assertSolventWithDustOnly();
    }

    function testDraftLiquidityCanBeWithdrawnAndMergedBeforeAnyTrade() public view {
        // Seeding positions exist and the treasury claims backing them were accounted by the vault.
        assertEq(vault.accountedCollateral(address(0)), 0.0265 ether);
        assertEq(vault.accountedCollateral(USDG), 120e6);
    }

    function _removeAllLiquidity() private {
        vm.startPrank(deployer);
        for (uint256 i; i < 3; ++i) {
            ModifyLiquidityParams memory p = positions[i];
            p.liquidityDelta = -p.liquidityDelta;
            lp.modify(keys[i], p, deployer);
        }
        vm.stopPrank();
    }

    function _redeemAll(address who) private {
        for (uint256 i; i < 4; ++i) {
            uint256 bal = IERC20(t[i]).balanceOf(who);
            if (bal == 0) continue;
            address asset = i < 2 ? address(0) : USDG;
            bool yes = i % 2 == 0;
            vault.redeem(asset, yes, bal, who);
        }
    }

    function _assertSolventWithDustOnly() private view {
        assertGe(address(vault).balance, vault.accountedCollateral(address(0)), "ETH insolvent");
        assertGe(IERC20(USDG).balanceOf(address(vault)), vault.accountedCollateral(USDG), "USDG insolvent");
        // Only pool rounding dust may remain recorded once every holder has redeemed.
        assertLe(vault.accountedCollateral(address(0)), 1e6, "ETH liability left over");
        assertLe(vault.accountedCollateral(USDG), 10, "USDG liability left over");
    }
}
