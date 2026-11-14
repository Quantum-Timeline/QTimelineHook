// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IQTimelineMarketRegistry} from "../src/interfaces/IQTimeline.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {ConditionalVault} from "../src/ConditionalVault.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";

contract MockUSDG is ERC20 {
    constructor() ERC20("USDG", "USDG") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/// @dev Drives the vault through random split/merge/transfer/redeem sequences across every lifecycle phase.
///      The handler is the registry factory, resolver and treasury so it can move the market through its states.
contract VaultHandler is Test {
    uint64 public constant OPEN = 200_000;
    uint64 public constant RELEASE = 300_000;
    uint64 public constant CUTOFF = RELEASE - 300;
    uint64 public constant DEADLINE = RELEASE + 172_800;
    bytes32 public constant MID = keccak256("invariant-market");

    MarketRegistry public registry;
    ConditionalVault public vault;
    MockUSDG public usdg;
    OutcomeToken[2][2] public tokens; // [assetIndex][0=YES,1=NO]; assetIndex 0 = ETH, 1 = USDG
    address[3] public actors = [address(0xA11CE), address(0xB0B), address(0xCA201)];

    // ghost accounting
    uint256[2] public ghostSplit;
    uint256[2] public ghostMerged;
    uint256[2] public ghostPaid;

    constructor() {
        registry = new MarketRegistry(address(this), false);
        registry.wireAndSeal(address(this), address(this));
        usdg = new MockUSDG();
        tokens[0][0] = new OutcomeToken("ETH YES", "eYES", 18, address(this));
        tokens[0][1] = new OutcomeToken("ETH NO", "eNO", 18, address(this));
        tokens[1][0] = new OutcomeToken("USDG YES", "uYES", 6, address(this));
        tokens[1][1] = new OutcomeToken("USDG NO", "uNO", 6, address(this));
        vault = new ConditionalVault(
            address(this), address(this), MID, registry,
            address(0), address(tokens[0][0]), address(tokens[0][1]), 100 ether,
            address(usdg), address(tokens[1][0]), address(tokens[1][1]), 500_000_000
        );
        for (uint256 a; a < 2; ++a) for (uint256 o; o < 2; ++o) tokens[a][o].bindVault(address(vault));
        bytes32[3] memory pools = [keccak256("yes"), keccak256("no"), keccak256("prob")];
        registry.registerMarket(MID, keccak256("config"), address(vault), address(0), OPEN, CUTOFF, RELEASE, DEADLINE, keccak256("2026-10"), 30, pools);
        vm.warp(OPEN - 1 days);
        registry.activate(MID);
        vm.warp(OPEN);
        registry.syncTime(MID);
        for (uint256 i; i < actors.length; ++i) {
            vm.deal(actors[i], 1_000_000 ether);
            usdg.mint(actors[i], 1_000_000_000_000);
            vm.prank(actors[i]);
            usdg.approve(address(vault), type(uint256).max);
        }
    }

    receive() external payable {}

    function status() public view returns (IQTimelineMarketRegistry.Status) { return registry.market(MID).status; }
    function isTerminal() public view returns (bool) {
        IQTimelineMarketRegistry.Status s = status();
        return s == IQTimelineMarketRegistry.Status.FinalYes || s == IQTimelineMarketRegistry.Status.FinalNo || s == IQTimelineMarketRegistry.Status.Cancelled;
    }
    function assetOf(uint256 i) public view returns (address) { return i == 0 ? address(0) : address(usdg); }
    function assetBalance(uint256 i) public view returns (uint256) { return i == 0 ? address(vault).balance : usdg.balanceOf(address(vault)); }

    function split(uint256 actorSeed, uint256 assetSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 ai = assetSeed % 2;
        amount = bound(amount, 1, ai == 0 ? 5 ether : 100_000_000);
        if (status() != IQTimelineMarketRegistry.Status.Open) return;
        vm.prank(actor);
        try vault.split{value: ai == 0 ? amount : 0}(assetOf(ai), amount, actor) { ghostSplit[ai] += amount; } catch {}
    }

    function transferClaim(uint256 fromSeed, uint256 toSeed, uint256 assetSeed, uint256 sideSeed, uint256 amount) external {
        address from = actors[fromSeed % actors.length];
        address to = actors[toSeed % actors.length];
        OutcomeToken t = tokens[assetSeed % 2][sideSeed % 2];
        amount = bound(amount, 0, t.balanceOf(from));
        vm.prank(from);
        t.transfer(to, amount);
    }

    function merge(uint256 actorSeed, uint256 assetSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 ai = assetSeed % 2;
        uint256 maxPair = _min(tokens[ai][0].balanceOf(actor), tokens[ai][1].balanceOf(actor));
        if (maxPair == 0) return;
        amount = bound(amount, 1, maxPair);
        vm.prank(actor);
        try vault.merge(assetOf(ai), amount, actor) { ghostMerged[ai] += amount; ghostPaid[ai] += amount; } catch {}
    }

    function redeem(uint256 actorSeed, uint256 assetSeed, uint256 sideSeed, uint256 amount) external {
        address actor = actors[actorSeed % actors.length];
        uint256 ai = assetSeed % 2;
        bool yes = sideSeed % 2 == 0;
        uint256 bal = tokens[ai][yes ? 0 : 1].balanceOf(actor);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        uint256 beforeBal = actor == address(0) ? 0 : (ai == 0 ? actor.balance : usdg.balanceOf(actor));
        vm.prank(actor);
        try vault.redeem(assetOf(ai), yes, amount, actor) {
            uint256 afterBal = ai == 0 ? actor.balance : usdg.balanceOf(actor);
            ghostPaid[ai] += afterBal - beforeBal;
        } catch {}
    }

    /// @dev Sends unsolicited value to the vault; payable receive() reverts for ETH, and ERC20 donations must not break solvency.
    function donate(uint256 amount) external {
        amount = bound(amount, 1, 1_000_000);
        usdg.mint(address(vault), amount);
        vm.deal(address(this), address(this).balance + amount);
        (bool ok,) = address(vault).call{value: amount}("");
        assertFalse(ok, "vault accepted unsolicited ETH");
        // selfdestruct-style forced ETH is modelled with deal; accounted collateral must be unaffected.
        vm.deal(address(vault), address(vault).balance + amount);
    }

    /// @dev One-way lifecycle progression: 0 = stay, 1 = Final YES, 2 = Final NO, 3 = Cancelled.
    function finalize(uint256 kind) external {
        if (isTerminal()) return;
        kind = kind % 16; // finalize rarely so long pre-terminal sequences are explored
        if (kind == 0 || kind > 3) return;
        if (kind == 3) {
            vm.warp(DEADLINE);
            registry.setTerminal(MID, IQTimelineMarketRegistry.Status.Cancelled, 0, bytes32(0));
        } else {
            vm.warp(RELEASE);
            registry.setTerminal(
                MID,
                kind == 1 ? IQTimelineMarketRegistry.Status.FinalYes : IQTimelineMarketRegistry.Status.FinalNo,
                kind == 1 ? int32(30) : int32(20),
                keccak256("evidence")
            );
        }
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) { return a < b ? a : b; }
}

contract VaultInvariantTest is Test {
    VaultHandler private handler;
    ConditionalVault private vault;

    function setUp() public {
        handler = new VaultHandler();
        vault = handler.vault();
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = VaultHandler.split.selector;
        selectors[1] = VaultHandler.transferClaim.selector;
        selectors[2] = VaultHandler.merge.selector;
        selectors[3] = VaultHandler.redeem.selector;
        selectors[4] = VaultHandler.donate.selector;
        selectors[5] = VaultHandler.finalize.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function _supply(uint256 ai, uint256 side) private view returns (uint256) { return handler.tokens(ai, side).totalSupply(); }

    /// @dev The vault never owes more than it holds. Forced donations may only add surplus.
    function invariant_balanceCoversAccountedCollateral() public view {
        for (uint256 ai; ai < 2; ++ai) {
            assertGe(handler.assetBalance(ai), vault.accountedCollateral(handler.assetOf(ai)), "insolvent");
        }
    }

    /// @dev Before resolution every set is fully backed: YES supply = NO supply = recorded collateral.
    function invariant_preTerminalSetsAreFullyBacked() public view {
        if (handler.isTerminal()) return;
        for (uint256 ai; ai < 2; ++ai) {
            assertEq(_supply(ai, 0), _supply(ai, 1), "YES/NO supply diverged");
            assertEq(vault.accountedCollateral(handler.assetOf(ai)), _supply(ai, 0), "collateral != supply");
        }
    }

    /// @dev Final YES/NO: recorded collateral equals the winning supply, so every winning claim stays redeemable 1:1.
    function invariant_finalWinnerFullyCovered() public view {
        IQTimelineMarketRegistry.Status s = handler.status();
        if (s != IQTimelineMarketRegistry.Status.FinalYes && s != IQTimelineMarketRegistry.Status.FinalNo) return;
        uint256 win = s == IQTimelineMarketRegistry.Status.FinalYes ? 0 : 1;
        for (uint256 ai; ai < 2; ++ai) {
            assertEq(vault.accountedCollateral(handler.assetOf(ai)), _supply(ai, win), "winner not 1:1 covered");
        }
    }

    /// @dev Cancelled: every outstanding claim is worth floor(amount / 2); aggregate floors never exceed collateral.
    function invariant_cancelledPayoutsCovered() public view {
        if (handler.status() != IQTimelineMarketRegistry.Status.Cancelled) return;
        for (uint256 ai; ai < 2; ++ai) {
            uint256 owed = _supply(ai, 0) / 2 + _supply(ai, 1) / 2;
            assertGe(vault.accountedCollateral(handler.assetOf(ai)), owed, "cancel payout under-collateralised");
            assertGe(handler.assetBalance(ai), owed, "cancel payout under-funded");
        }
    }

    /// @dev Conservation: collateral in = collateral out + collateral still recorded.
    function invariant_collateralConservation() public view {
        for (uint256 ai; ai < 2; ++ai) {
            assertEq(handler.ghostSplit(ai), handler.ghostPaid(ai) + vault.accountedCollateral(handler.assetOf(ai)), "collateral not conserved");
        }
    }

    /// @dev Outcome tokens can only be minted/burned by the vault, so no EOA path can inflate supply.
    function testFuzz_onlyVaultMintsAndBurns(address attacker, uint256 amount) public {
        vm.assume(attacker != address(vault));
        OutcomeToken t = handler.tokens(0, 0);
        vm.prank(attacker);
        vm.expectRevert(OutcomeToken.OnlyVault.selector);
        t.mint(attacker, amount);
        vm.prank(attacker);
        vm.expectRevert(OutcomeToken.OnlyVault.selector);
        t.burn(attacker, amount);
    }

    /// @dev Split then merge by one actor is value-neutral for any amount inside the cap.
    function testFuzz_splitMergeRoundTrip(uint256 amount) public {
        amount = bound(amount, 1, 5 ether);
        address actor = address(0xA11CE);
        uint256 beforeBal = actor.balance;
        vm.prank(actor);
        vault.split{value: amount}(address(0), amount, actor);
        vm.prank(actor);
        vault.merge(address(0), amount, actor);
        assertEq(actor.balance, beforeBal, "round trip leaked value");
        assertEq(vault.accountedCollateral(address(0)), 0);
    }

    /// @dev Redeeming a cancelled single claim twice cannot pay more than its floor half.
    function testFuzz_cancelledRedeemNeverExceedsHalf(uint256 amount) public {
        amount = bound(amount, 1, 5 ether);
        address actor = address(0xA11CE);
        vm.prank(actor);
        vault.split{value: amount}(address(0), amount, actor);
        vm.warp(handler.DEADLINE());
        handler.finalize(3);
        uint256 beforeBal = actor.balance;
        vm.startPrank(actor);
        vault.redeem(address(0), true, amount, actor);
        vault.redeem(address(0), false, amount, actor);
        vm.stopPrank();
        assertEq(actor.balance - beforeBal, amount / 2 + amount / 2, "cancel payout mismatch");
        vm.prank(actor);
        vm.expectRevert();
        vault.redeem(address(0), true, 1, actor);
    }
}
