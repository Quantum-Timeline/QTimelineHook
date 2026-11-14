// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IQTimelineMarketRegistry} from "../src/interfaces/IQTimeline.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {ConditionalVault} from "../src/ConditionalVault.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";

interface Vm { function warp(uint256) external; function deal(address, uint256) external; function prank(address) external; function chainId(uint256) external; }

contract MarketRegistryTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MarketRegistry private registry;
    ConditionalVault private vault;
    OutcomeToken private yesToken;
    OutcomeToken private noToken;
    OutcomeToken private yesUsd;
    OutcomeToken private noUsd;
    bytes32 private constant MID = keccak256("market-1");
    uint64 private constant OPEN = 200_000;
    uint64 private constant RELEASE = 300_000;
    uint64 private constant CUTOFF = RELEASE - 300;
    uint64 private constant DEADLINE = RELEASE + 172_800;

    receive() external payable {}

    function setUp() public {
        registry = new MarketRegistry(address(this), false);
        registry.wireAndSeal(address(this), address(this));
        yesToken = new OutcomeToken("ETH YES", "eYES", 18, address(this));
        noToken = new OutcomeToken("ETH NO", "eNO", 18, address(this));
        yesUsd = new OutcomeToken("USDG YES", "uYES", 6, address(this));
        noUsd = new OutcomeToken("USDG NO", "uNO", 6, address(this));
        vault = new ConditionalVault(address(this), address(this), MID, registry, address(0), address(yesToken), address(noToken), 1 ether, address(0x1234), address(yesUsd), address(noUsd), 500_000_000);
        yesToken.bindVault(address(vault));
        noToken.bindVault(address(vault));
        yesUsd.bindVault(address(vault));
        noUsd.bindVault(address(vault));
        bytes32[3] memory pools = [keccak256("yes"), keccak256("no"), keccak256("probability")];
        registry.registerMarket(MID, keccak256("config"), address(vault), address(0), OPEN, CUTOFF, RELEASE, DEADLINE, keccak256("2026-10"), 30, pools);
    }

    function testFactoryDraftSplitMintsMatchedClaimsAndMergeReturnsCollateral() public {
        vm.deal(address(this), 1 ether);
        vault.split{value: 0.4 ether}(address(0), 0.4 ether, address(this));
        require(yesToken.balanceOf(address(this)) == 0.4 ether, "YES mismatch");
        require(noToken.balanceOf(address(this)) == 0.4 ether, "NO mismatch");
        uint256 before = address(this).balance;
        vault.merge(address(0), 0.25 ether, address(this));
        require(address(this).balance == before + 0.25 ether, "collateral mismatch");
        require(yesToken.balanceOf(address(this)) == 0.15 ether && noToken.balanceOf(address(this)) == 0.15 ether, "claims mismatch");
    }

    function testVaultRejectsCollateralAboveAssetCap() public {
        vm.deal(address(this), 2 ether);
        vault.split{value: 1 ether}(address(0), 1 ether, address(this));
        (bool ok,) = address(vault).call{value: 1}(
            abi.encodeCall(vault.split, (address(0), uint256(1), address(this)))
        );
        require(!ok, "cap overflow accepted");
        require(vault.accountedCollateral(address(0)) == 1 ether, "cap failure changed collateral accounting");
    }

    function testVaultRejectsUnregisteredCollateralAsset() public {
        (bool ok,) = address(vault).call(
            abi.encodeCall(vault.split, (address(0x9999), uint256(1), address(this)))
        );
        require(!ok, "unregistered asset accepted");
    }

    function testFinalYesSupportsPartialWinnerAndLosingClaimRedemptions() public {
        vm.deal(address(this), 1 ether);
        vault.split{value: 5}(address(0), 5, address(this));
        vm.warp(OPEN - 86_400);
        registry.activate(MID);
        vm.warp(RELEASE);
        registry.setTerminal(MID, IQTimelineMarketRegistry.Status.FinalYes, 30, keccak256("evidence"));
        uint256 before = address(this).balance;
        vault.redeem(address(0), true, 2, address(this));
        vault.redeem(address(0), true, 3, address(this));
        vault.redeem(address(0), false, 5, address(this));
        require(address(this).balance == before + 5, "partial winner payout mismatch");
        require(yesToken.balanceOf(address(this)) == 0 && noToken.balanceOf(address(this)) == 0, "partial claims were not burned");
        require(vault.accountedCollateral(address(0)) == 0, "partial redemption left collateral liability");
    }

    function testCancelledOddClaimsRoundDownIndependently() public {
        vm.deal(address(this), 1 ether);
        vault.split{value: 5}(address(0), 5, address(this));
        vm.warp(OPEN - 86_400);
        registry.activate(MID);
        vm.warp(DEADLINE);
        registry.syncTime(MID);
        registry.setTerminal(MID, IQTimelineMarketRegistry.Status.Cancelled, 0, bytes32(0));
        uint256 before = address(this).balance;
        vault.redeem(address(0), true, 5, address(this));
        vault.redeem(address(0), false, 5, address(this));
        require(address(this).balance == before + 4, "odd cancellation claims must each floor to two wei");
        require(yesToken.balanceOf(address(this)) == 0 && noToken.balanceOf(address(this)) == 0, "cancelled claims were not burned");
        require(vault.accountedCollateral(address(0)) == 1, "odd-claim rounding residue mismatch");
    }

    function testUnregisteredPoolCannotPassRegistryGate() public {
        require(!registry.isRegisteredPool(MID, keccak256("other")), "unexpected pool");
    }

    function testActivationRequiresTwentyFourHoursToCutoff() public {
        vm.warp(OPEN - 86_400);
        registry.activate(MID);
        require(registry.market(MID).status == IQTimelineMarketRegistry.Status.Scheduled, "not scheduled");
        vm.warp(OPEN);
        registry.syncTime(MID);
        require(registry.market(MID).status == IQTimelineMarketRegistry.Status.Open, "not open");
    }

    function testSplitChecksCutoffEvenWhenRegistryStatusHasNotBeenSynced() public {
        vm.deal(address(this), 1 ether);
        vm.warp(OPEN - 86_400);
        registry.activate(MID);
        vm.warp(OPEN);
        registry.syncTime(MID);
        require(registry.market(MID).status == IQTimelineMarketRegistry.Status.Open, "not open");
        vm.warp(CUTOFF);
        (bool ok,) = address(vault).call{value: 1}(
            abi.encodeCall(vault.split, (address(0), uint256(1), address(this)))
        );
        require(!ok, "split accepted after cutoff while status was stale");
        require(vault.accountedCollateral(address(0)) == 0, "rejected split changed collateral accounting");
    }

    function testAnyoneCanCancelAfterDeadlineAndRegistryClosesMarket() public {
        vm.warp(OPEN - 86_400);
        registry.activate(MID);
        vm.warp(DEADLINE);
        registry.syncTime(MID);
        registry.setTerminal(MID, IQTimelineMarketRegistry.Status.Cancelled, 0, bytes32(0));
        require(registry.market(MID).status == IQTimelineMarketRegistry.Status.Cancelled, "not cancelled");
    }

    function testTerminalResultCannotBeWrittenBeforeRelease() public {
        vm.warp(OPEN - 86_400);
        registry.activate(MID);
        vm.warp(CUTOFF);
        registry.syncTime(MID);
        (bool ok,) = address(registry).call(abi.encodeCall(registry.setTerminal, (MID, IQTimelineMarketRegistry.Status.FinalYes, int32(30), keccak256("evidence"))));
        require(!ok, "early report accepted");
    }

    function testCancellationRedeemsHalfPerClaimAndCanClearVault() public {
        vm.deal(address(this), 1 ether);
        vault.split{value: 0.4 ether}(address(0), 0.4 ether, address(this));
        vm.warp(OPEN - 86_400);
        registry.activate(MID);
        vm.warp(DEADLINE);
        registry.syncTime(MID);
        registry.setTerminal(MID, IQTimelineMarketRegistry.Status.Cancelled, 0, bytes32(0));
        uint256 before = address(this).balance;
        vault.redeem(address(0), true, 0.4 ether, address(this));
        vault.redeem(address(0), false, 0.4 ether, address(this));
        require(address(this).balance == before + 0.4 ether, "cancel payout mismatch");
        require(vault.accountedCollateral(address(0)) == 0, "vault liability remains");
    }

    function testFinalYesRedeemsWinnerAndBurnsLosingClaimsForZero() public {
        vm.deal(address(this), 1 ether);
        vault.split{value: 0.4 ether}(address(0), 0.4 ether, address(this));
        vm.warp(OPEN - 86_400);
        registry.activate(MID);
        vm.warp(RELEASE);
        registry.setTerminal(MID, IQTimelineMarketRegistry.Status.FinalYes, 30, keccak256("evidence"));
        uint256 before = address(this).balance;
        vault.redeem(address(0), true, 0.4 ether, address(this));
        vault.redeem(address(0), false, 0.4 ether, address(this));
        require(address(this).balance == before + 0.4 ether, "winner payout mismatch");
        require(yesToken.balanceOf(address(this)) == 0 && noToken.balanceOf(address(this)) == 0, "claims were not burned");
        require(vault.accountedCollateral(address(0)) == 0, "vault liability remains");
    }

    function testFinalNoRedeemsWinnerAndBurnsLosingClaimsForZero() public {
        vm.deal(address(this), 1 ether);
        vault.split{value: 0.4 ether}(address(0), 0.4 ether, address(this));
        vm.warp(OPEN - 86_400);
        registry.activate(MID);
        vm.warp(RELEASE);
        registry.setTerminal(MID, IQTimelineMarketRegistry.Status.FinalNo, 29, keccak256("evidence"));
        uint256 before = address(this).balance;
        vault.redeem(address(0), true, 0.4 ether, address(this));
        vault.redeem(address(0), false, 0.4 ether, address(this));
        require(address(this).balance == before + 0.4 ether, "winner payout mismatch");
        require(yesToken.balanceOf(address(this)) == 0 && noToken.balanceOf(address(this)) == 0, "claims were not burned");
        require(vault.accountedCollateral(address(0)) == 0, "vault liability remains");
    }

    function testShortTestnetMarketCanOpenResolveAndCancelWithinMinutes() public {
        vm.chainId(46630);
        vm.warp(1_000_000);
        MarketRegistry shortRegistry = new MarketRegistry(address(this), true);
        shortRegistry.wireAndSeal(address(this), address(this));
        bytes32[3] memory pools = [keccak256("short-yes"), keccak256("short-no"), keccak256("short-probability")];
        uint64 opensAt = 1_000_060;
        uint64 cutoffAt = opensAt + 300;
        uint64 releaseAt = cutoffAt + 10;
        uint64 deadline = releaseAt + 120;
        bytes32 shortMarket = keccak256("short-market");
        bytes32 cancelMarket = keccak256("short-cancel-market");
        shortRegistry.registerMarket(shortMarket, keccak256("short-config"), address(vault), address(0), opensAt, cutoffAt, releaseAt, deadline, keccak256("short-period"), 30, pools);
        shortRegistry.registerMarket(cancelMarket, keccak256("short-cancel-config"), address(vault), address(0), opensAt, cutoffAt, releaseAt, deadline, keccak256("short-cancel-period"), 30, pools);
        shortRegistry.activate(shortMarket);
        shortRegistry.activate(cancelMarket);
        vm.warp(opensAt);
        shortRegistry.syncTime(shortMarket);
        require(shortRegistry.market(shortMarket).status == IQTimelineMarketRegistry.Status.Open, "short market did not open");
        vm.warp(releaseAt);
        shortRegistry.setTerminal(shortMarket, IQTimelineMarketRegistry.Status.FinalYes, 30, keccak256("yes-evidence"));
        require(shortRegistry.market(shortMarket).status == IQTimelineMarketRegistry.Status.FinalYes, "short market did not resolve");
        vm.warp(deadline);
        shortRegistry.setTerminal(cancelMarket, IQTimelineMarketRegistry.Status.Cancelled, 0, bytes32(0));
        require(shortRegistry.market(cancelMarket).status == IQTimelineMarketRegistry.Status.Cancelled, "short market did not cancel at deadline");
    }
}
