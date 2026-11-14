// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {TransparentUpgradeableProxy, ITransparentUpgradeableProxy} from "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";
import {ProxyAdmin} from "@openzeppelin/contracts/proxy/transparent/ProxyAdmin.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IQTimelineMarketRegistry} from "../src/interfaces/IQTimeline.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";
import {IpoMarketRegistry} from "../src/ipo/IpoMarketRegistry.sol";
import {IpoMarketFactory, IIpoKeyLookup, IIpoSignatureVerifier} from "../src/ipo/IpoMarketFactory.sol";
import {IpoResolutionAdapter, IIpoPQKeyRegistry, IIpoMLDSA44Verifier} from "../src/ipo/IpoResolutionAdapter.sol";
import {IpoConditionalVault} from "../src/ipo/IpoConditionalVault.sol";
import {IpoOutcomeToken} from "../src/ipo/IpoOutcomeToken.sol";
import {IpoTimelineHook} from "../src/ipo/IpoTimelineHook.sol";
import {IpoHookDeployer} from "../src/ipo/IpoHookDeployer.sol";

contract IpoStubPoolManager {}

contract IpoStubKeys {
    mapping(address => address) public blobOf;
    function setBlob(address signer, address blob) external { blobOf[signer] = blob; }
    function publicKeyBlob(address signer) external view returns (address) { return blobOf[signer]; }
}

/// @dev Accepts exactly one agreed post-quantum signature string so tests can present a good and a bad one.
contract IpoStubVerifier {
    function verify(address, bytes calldata, bytes calldata signature) external pure returns (bool) { return keccak256(signature) == keccak256("pq-ok"); }
}

// Next-version stand-ins used to prove that upgrades keep state and that only the admin can perform them.
contract RegistryV2 is IpoMarketRegistry { function version() external pure returns (uint256) { return 2; } }
contract AdapterV2 is IpoResolutionAdapter { function version() external pure returns (uint256) { return 2; } }
contract VaultV2 is IpoConditionalVault { function version() external pure returns (uint256) { return 2; } }
contract HookV2 is IpoTimelineHook {
    constructor(IPoolManager manager) IpoTimelineHook(manager) {}
    function version() external pure returns (uint256) { return 2; }
}

/// @notice Offline coverage of the upgradeable Anthropic IPO pricing system: schedule rules, price report handling, payouts,
///         and that every upgrade path keeps state and obeys the admin.
contract IpoMarketTest is Test {
    bytes32 private constant ADMIN_SLOT = 0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103;
    uint256 private constant DEPLOYER_KEY = 0xA11CE;
    uint256 private constant SIGNER_KEY = 0xB0B;
    int32 private constant THRESHOLD_CENTS = 7400; // $74.00, the midpoint of the announced $70-$78 range
    bytes32 private constant PERIOD = keccak256("ANT-IPO-PRICE-2026-11");
    uint64 private constant RELEASE_DELAY = 18 hours;
    uint64 private constant WINDOW = 48 hours;
    uint64 private constant MIN_TRADING = 6 hours;

    address private deployer;
    address private signer;
    IpoMarketRegistry private registry;
    IpoMarketFactory private factory;
    IpoResolutionAdapter private adapter;
    IpoStubKeys private keys;
    IpoStubVerifier private verifier;
    IpoHookDeployer private hookDeployer;
    UpgradeableBeacon private tokenBeacon;
    UpgradeableBeacon private vaultBeacon;
    UpgradeableBeacon private hookBeacon;
    TestUSDG private usdg;
    IpoStubPoolManager private manager;

    bytes32 private marketId;
    IpoConditionalVault private vault;
    uint64 private opensAt;
    uint64 private cutoffAt;
    uint64 private releaseAt;
    uint64 private deadline;

    function setUp() public {
        vm.warp(1_800_000_000);
        deployer = vm.addr(DEPLOYER_KEY);
        signer = vm.addr(SIGNER_KEY);
        usdg = new TestUSDG();
        verifier = new IpoStubVerifier();
        keys = new IpoStubKeys();
        keys.setBlob(deployer, address(0xCAFE));
        keys.setBlob(signer, address(0xBEEF));
        manager = new IpoStubPoolManager();

        registry = IpoMarketRegistry(_proxy(address(new IpoMarketRegistry()), abi.encodeCall(IpoMarketRegistry.initialize, (deployer, RELEASE_DELAY, WINDOW, MIN_TRADING))));

        // Per-market logic sits behind beacons; the hook implementation must itself carry the v4 permission bits.
        hookDeployer = new IpoHookDeployer(deployer);
        bytes32 implSalt = _mineSalt(address(hookDeployer), keccak256(abi.encodePacked(type(IpoTimelineHook).creationCode, abi.encode(manager))));
        vm.prank(deployer);
        address hookImpl = hookDeployer.deployImplementation(IPoolManager(address(manager)), implSalt);
        tokenBeacon = new UpgradeableBeacon(address(new IpoOutcomeToken()), deployer);
        vaultBeacon = new UpgradeableBeacon(address(new IpoConditionalVault()), deployer);
        hookBeacon = new UpgradeableBeacon(hookImpl, deployer);

        factory = IpoMarketFactory(_proxy(address(new IpoMarketFactory()), abi.encodeCall(IpoMarketFactory.initialize, (
            deployer, address(usdg), IPoolManager(address(manager)), registry, IIpoKeyLookup(address(keys)), IIpoSignatureVerifier(address(verifier)),
            address(tokenBeacon), address(vaultBeacon)
        ))));
        adapter = IpoResolutionAdapter(_proxy(address(new IpoResolutionAdapter()), abi.encodeCall(IpoResolutionAdapter.initialize, (
            registry, IIpoPQKeyRegistry(address(keys)), IIpoMLDSA44Verifier(address(verifier)), signer
        ))));
        vm.startPrank(deployer);
        hookDeployer.configure(address(factory), address(hookBeacon));
        factory.setHookDeployer(hookDeployer);
        registry.wireAndSeal(address(factory), address(adapter));
        vm.stopPrank();

        opensAt = uint64(block.timestamp + 1 hours);
        cutoffAt = uint64(block.timestamp + 3 days);
        releaseAt = cutoffAt + RELEASE_DELAY;
        deadline = releaseAt + WINDOW;
        marketId = _create(opensAt, cutoffAt, releaseAt, deadline, THRESHOLD_CENTS, 0);
        vault = IpoConditionalVault(payable(factory.vaultOf(marketId)));
    }

    // ---------------------------------------------------------------- schedule and configuration

    function testRegistryRejectsOutOfRangeScheduleParameters() public {
        address impl = address(new IpoMarketRegistry());
        vm.expectRevert(IpoMarketRegistry.InvalidConfig.selector);
        _proxy(impl, abi.encodeCall(IpoMarketRegistry.initialize, (deployer, 299, WINDOW, MIN_TRADING)));
        vm.expectRevert(IpoMarketRegistry.InvalidConfig.selector);
        _proxy(impl, abi.encodeCall(IpoMarketRegistry.initialize, (deployer, RELEASE_DELAY, 1 hours, MIN_TRADING)));
        vm.expectRevert(IpoMarketRegistry.InvalidConfig.selector);
        _proxy(impl, abi.encodeCall(IpoMarketRegistry.initialize, (deployer, RELEASE_DELAY, WINDOW, 30 minutes)));
        vm.expectRevert(IpoMarketRegistry.InvalidConfig.selector);
        _proxy(impl, abi.encodeCall(IpoMarketRegistry.initialize, (address(0), RELEASE_DELAY, WINDOW, MIN_TRADING)));
    }

    function testFactoryReadsTheRegistrySchedule() public view {
        assertEq(factory.releaseDelay(), RELEASE_DELAY);
        assertEq(factory.resolutionWindow(), WINDOW);
    }

    function testCreationRejectsTheCorePceFiveMinuteGap() public {
        uint64 cutoff = uint64(block.timestamp + 3 days);
        IpoMarketFactory.MarketConfig memory c = _config(opensAt, cutoff, cutoff + 300, cutoff + 300 + WINDOW, THRESHOLD_CENTS, 1);
        (bytes memory ecdsaSig, bytes32 salt) = _sign(c);
        vm.prank(deployer);
        vm.expectRevert(IpoMarketFactory.InvalidConfig.selector);
        factory.createMarket(c, ecdsaSig, "pq-ok", salt);
    }

    function testCreationRejectsZeroAndNegativeThresholds() public {
        for (int32 bad = -1; bad <= 0; ++bad) {
            IpoMarketFactory.MarketConfig memory c = _config(opensAt, cutoffAt, releaseAt, deadline, bad, 1);
            (bytes memory ecdsaSig, bytes32 salt) = _sign(c);
            vm.prank(deployer);
            vm.expectRevert(IpoMarketFactory.InvalidConfig.selector);
            factory.createMarket(c, ecdsaSig, "pq-ok", salt);
        }
    }

    function testOnlyTheDeployerCanCreateAndTheSignatureMustMatch() public {
        IpoMarketFactory.MarketConfig memory c = _config(opensAt, cutoffAt, releaseAt, deadline, THRESHOLD_CENTS, 1);
        (bytes memory ecdsaSig, bytes32 salt) = _sign(c);
        vm.expectRevert(IpoMarketFactory.Unauthorized.selector);
        factory.createMarket(c, ecdsaSig, "pq-ok", salt);
        vm.prank(deployer);
        vm.expectRevert(IpoMarketFactory.InvalidSignature.selector);
        factory.createMarket(c, ecdsaSig, "pq-bad", salt);
    }

    function testActivationNeedsTheConfiguredMinimumTradingWindow() public {
        vm.warp(cutoffAt - MIN_TRADING + 1);
        vm.prank(address(factory));
        vm.expectRevert(IpoMarketRegistry.InvalidTransition.selector);
        registry.activate(marketId);
        vm.warp(cutoffAt - MIN_TRADING);
        vm.prank(address(factory));
        registry.activate(marketId);
        assertEq(uint8(registry.market(marketId).status), uint8(IQTimelineMarketRegistry.Status.Open));
    }

    // ---------------------------------------------------------------- price reports

    function testPriceAtOrAboveTheThresholdIsYesAndBelowIsNo() public {
        _activate();
        uint256 snap = vm.snapshotState();
        _report(7800, PERIOD);
        assertEq(uint8(registry.market(marketId).status), uint8(IQTimelineMarketRegistry.Status.FinalYes));
        assertEq(registry.reportedValueBps(marketId), 7800);
        vm.revertToState(snap);
        _report(7400, PERIOD);
        assertEq(uint8(registry.market(marketId).status), uint8(IQTimelineMarketRegistry.Status.FinalYes), "boundary must be YES");
        vm.revertToState(snap);
        _report(7399, PERIOD);
        assertEq(uint8(registry.market(marketId).status), uint8(IQTimelineMarketRegistry.Status.FinalNo), "one cent below must be NO");
    }

    function testRejectsAReportBeforeTheEarliestReleaseAndAtTheDeadline() public {
        _activate();
        vm.warp(releaseAt - 1);
        IpoResolutionAdapter.Report memory r = _makeReport(7800, PERIOD, "x");
        (bytes memory e, bytes memory p) = _signReport(r);
        vm.expectRevert(IpoResolutionAdapter.Expired.selector);
        adapter.reportValue(r, "x", e, p);
        vm.warp(deadline);
        r = _makeReport(7800, PERIOD, "x");
        r.signatureExpiry = deadline;
        (e, p) = _signReport(r);
        vm.expectRevert(IpoResolutionAdapter.Expired.selector);
        adapter.reportValue(r, "x", e, p);
    }

    function testRejectsWrongSourceWrongPeriodAndNonPositivePrices() public {
        _activate();
        vm.warp(releaseAt);
        IpoResolutionAdapter.Report memory r = _makeReport(7800, PERIOD, "evidence");
        r.sourceId = keccak256("bea:core-pce:mom:first-release"); // the Core PCE source must not resolve this market
        (bytes memory e, bytes memory p) = _signReport(r);
        vm.expectRevert(IpoResolutionAdapter.InvalidReport.selector);
        adapter.reportValue(r, "evidence", e, p);

        r = _makeReport(7800, keccak256("2026-10"), "evidence");
        (e, p) = _signReport(r);
        vm.expectRevert(IpoResolutionAdapter.InvalidReport.selector);
        adapter.reportValue(r, "evidence", e, p);

        for (int32 bad = -1; bad <= 0; ++bad) {
            r = _makeReport(bad, PERIOD, "evidence");
            (e, p) = _signReport(r);
            vm.expectRevert(IpoResolutionAdapter.InvalidReport.selector);
            adapter.reportValue(r, "evidence", e, p);
        }
    }

    function testRejectsEvidenceThatDoesNotMatchTheSignedHash() public {
        _activate();
        vm.warp(releaseAt);
        IpoResolutionAdapter.Report memory r = _makeReport(7800, PERIOD, "evidence");
        (bytes memory e, bytes memory p) = _signReport(r);
        vm.expectRevert(IpoResolutionAdapter.InvalidEvidence.selector);
        adapter.reportValue(r, "different evidence", e, p);
        vm.expectRevert(IpoResolutionAdapter.InvalidEvidence.selector);
        adapter.reportValue(r, "", e, p);
        bytes memory tooLong = new bytes(4097);
        r = _makeReport(7800, PERIOD, tooLong);
        (e, p) = _signReport(r);
        vm.expectRevert(IpoResolutionAdapter.InvalidEvidence.selector);
        adapter.reportValue(r, tooLong, e, p);
    }

    function testRejectsAnUnauthorizedOrMismatchedSignature() public {
        _activate();
        vm.warp(releaseAt);
        IpoResolutionAdapter.Report memory r = _makeReport(7800, PERIOD, "evidence");
        bytes32 digest = _reportDigest(r, address(adapter));
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(DEPLOYER_KEY, digest); // valid signature from the wrong key
        vm.expectRevert(IpoResolutionAdapter.InvalidSignature.selector);
        adapter.reportValue(r, "evidence", abi.encodePacked(rr, s, v), "pq-ok");

        (bytes memory e,) = _signReport(r);
        vm.expectRevert(IpoResolutionAdapter.InvalidSignature.selector);
        adapter.reportValue(r, "evidence", e, "pq-bad"); // right ECDSA, wrong post-quantum signature

        keys.setBlob(signer, address(0)); // signer without a registered post-quantum key
        vm.expectRevert(IpoResolutionAdapter.InvalidSignature.selector);
        adapter.reportValue(r, "evidence", e, "pq-ok");
    }

    function testASignatureForAnotherAdapterAddressDoesNotVerifyHere() public {
        _activate();
        vm.warp(releaseAt);
        IpoResolutionAdapter.Report memory r = _makeReport(7800, PERIOD, "evidence");
        bytes32 foreignDigest = _reportDigest(r, address(0xCE11)); // e.g. the Core PCE adapter's domain
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(SIGNER_KEY, foreignDigest);
        vm.expectRevert(IpoResolutionAdapter.InvalidSignature.selector);
        adapter.reportValue(r, "evidence", abi.encodePacked(rr, s, v), "pq-ok");
    }

    function testAMarketCannotBeResolvedTwiceAndAnInactiveMarketCannotBeReported() public {
        vm.warp(releaseAt);
        IpoResolutionAdapter.Report memory r = _makeReport(7800, PERIOD, "evidence");
        (bytes memory e, bytes memory p) = _signReport(r);
        vm.expectRevert(IpoResolutionAdapter.InvalidReport.selector); // Draft: never activated
        adapter.reportValue(r, "evidence", e, p);

        vm.warp(cutoffAt - MIN_TRADING);
        vm.prank(address(factory));
        registry.activate(marketId);
        vm.warp(releaseAt);
        r.signatureExpiry = uint64(block.timestamp + 1 hours);
        (e, p) = _signReport(r);
        adapter.reportValue(r, "evidence", e, p);
        vm.expectRevert(IpoMarketRegistry.InvalidTransition.selector);
        adapter.reportValue(r, "evidence", e, p);
    }

    // ---------------------------------------------------------------- money

    function testWinningClaimsRedeemOneToOneAndLosingClaimsPayNothing() public {
        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        vault.split{value: 0.01 ether}(address(0), 0.01 ether, deployer);
        _activate();
        _report(7800, PERIOD); // YES
        IpoOutcomeToken yes = IpoOutcomeToken(vault.outcomeToken(address(0), true));
        IpoOutcomeToken no = IpoOutcomeToken(vault.outcomeToken(address(0), false));
        uint256 before = deployer.balance;
        vm.startPrank(deployer);
        vault.redeem(address(0), true, 0.01 ether, deployer);
        vault.redeem(address(0), false, 0.01 ether, deployer);
        vm.stopPrank();
        assertEq(deployer.balance - before, 0.01 ether, "winner must pay 1:1 and loser nothing");
        assertEq(yes.totalSupply() + no.totalSupply(), 0);
        assertEq(vault.accountedCollateral(address(0)), 0);
    }

    function testExpiryCancelsPermissionlesslyAndEveryClaimPaysHalf() public {
        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        vault.split{value: 0.01 ether}(address(0), 0.01 ether, deployer);
        _activate();
        vm.warp(deadline - 1);
        vm.expectRevert(IpoResolutionAdapter.Expired.selector);
        adapter.cancelExpired(marketId);
        vm.warp(deadline);
        vm.prank(address(0xBAD)); // anyone
        adapter.cancelExpired(marketId);
        assertEq(uint8(registry.market(marketId).status), uint8(IQTimelineMarketRegistry.Status.Cancelled));
        uint256 before = deployer.balance;
        vm.startPrank(deployer);
        vault.redeem(address(0), true, 0.01 ether, deployer);
        vault.redeem(address(0), false, 0.01 ether, deployer);
        vm.stopPrank();
        assertEq(deployer.balance - before, 0.01 ether, "a YES and a NO claim together recover the full collateral");
    }

    function testSourceIdIsSeparateFromCorePce() public view {
        assertTrue(adapter.SOURCE_ID() != keccak256("bea:core-pce:mom:first-release"));
    }

    // ---------------------------------------------------------------- upgradeability

    function testImplementationsAndProxiesCannotBeInitializedAgain() public {
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        registry.initialize(address(1), RELEASE_DELAY, WINDOW, MIN_TRADING);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vault.initialize(address(1), address(1), bytes32(uint256(1)), registry, address(0), address(2), address(3), 1, address(4), address(5), address(6), 1);
        address bareImpl = address(new IpoResolutionAdapter());
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        IpoResolutionAdapter(bareImpl).initialize(registry, IIpoPQKeyRegistry(address(keys)), IIpoMLDSA44Verifier(address(verifier)), signer);
    }

    function testOnlyTheProxyAdminOwnerCanUpgradeAndTheNewLogicKeepsAllState() public {
        // fill the registry and the vault with state first
        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        vault.split{value: 0.01 ether}(address(0), 0.01 ether, deployer);
        IQTimelineMarketRegistry.Market memory before = registry.market(marketId);

        address newImpl = address(new RegistryV2());
        ProxyAdmin admin = _adminOf(address(registry));
        assertEq(admin.owner(), deployer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        admin.upgradeAndCall(ITransparentUpgradeableProxy(address(registry)), newImpl, "");
        vm.prank(deployer);
        admin.upgradeAndCall(ITransparentUpgradeableProxy(address(registry)), newImpl, "");

        assertEq(RegistryV2(address(registry)).version(), 2);
        IQTimelineMarketRegistry.Market memory afterUpgrade = registry.market(marketId);
        assertEq(afterUpgrade.configHash, before.configHash);
        assertEq(afterUpgrade.vault, before.vault);
        assertEq(registry.factory(), address(factory));
        assertEq(registry.resolver(), address(adapter));
        assertEq(registry.releaseDelay(), RELEASE_DELAY);
        assertEq(vault.accountedCollateral(address(0)), 0.01 ether);
    }

    function testAdapterUpgradeKeepsItsWiring() public {
        address newImpl = address(new AdapterV2());
        vm.prank(deployer);
        _adminOf(address(adapter)).upgradeAndCall(ITransparentUpgradeableProxy(address(adapter)), newImpl, "");
        assertEq(AdapterV2(address(adapter)).version(), 2);
        assertEq(adapter.authorizedSigner(), signer);
        assertEq(address(adapter.registry()), address(registry));
        // still resolves
        _activate();
        _report(7800, PERIOD);
        assertEq(uint8(registry.market(marketId).status), uint8(IQTimelineMarketRegistry.Status.FinalYes));
    }

    function testVaultBeaconUpgradeKeepsBalancesAndStillPays() public {
        vm.deal(deployer, 1 ether);
        vm.prank(deployer);
        vault.split{value: 0.01 ether}(address(0), 0.01 ether, deployer);
        address newImpl = address(new VaultV2());
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        vaultBeacon.upgradeTo(newImpl);
        vm.prank(deployer);
        vaultBeacon.upgradeTo(newImpl);
        assertEq(VaultV2(payable(address(vault))).version(), 2);
        assertEq(vault.accountedCollateral(address(0)), 0.01 ether);
        assertEq(address(vault).balance, 0.01 ether);
        _activate();
        _report(7800, PERIOD);
        uint256 before = deployer.balance;
        vm.prank(deployer);
        vault.redeem(address(0), true, 0.01 ether, deployer);
        assertEq(deployer.balance - before, 0.01 ether);
    }

    function testHookBeaconUpgradeNeedsANewMinedImplementationAndKeepsTheMarketBinding() public {
        address hook = factory.hookOf(marketId);
        assertEq(IpoTimelineHook(hook).marketId(), marketId);
        // a new implementation that does not carry the v4 permission bits cannot even be constructed
        vm.expectRevert();
        new HookV2(IPoolManager(address(manager)));
        // mined, it deploys and the beacon can adopt it
        bytes32 salt = _mineSalt(address(this), keccak256(abi.encodePacked(type(HookV2).creationCode, abi.encode(manager))));
        address newImpl = address(new HookV2{salt: salt}(IPoolManager(address(manager))));
        vm.prank(deployer);
        hookBeacon.upgradeTo(newImpl);
        assertEq(HookV2(hook).version(), 2);
        assertEq(IpoTimelineHook(hook).marketId(), marketId);
        assertEq(address(IpoTimelineHook(hook).registry()), address(registry));
        assertEq(IpoTimelineHook(hook).factory(), address(factory));
    }

    function testTheAdminCanHandOverOrPermanentlyGiveUpUpgradeRights() public {
        ProxyAdmin admin = _adminOf(address(registry));
        address newImpl = address(new RegistryV2());
        address anotherImpl = address(new RegistryV2()); // built before the cheatcodes: a creation would consume them
        address newOwner = address(0xAD11);
        vm.prank(deployer);
        admin.transferOwnership(newOwner);
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, deployer));
        admin.upgradeAndCall(ITransparentUpgradeableProxy(address(registry)), newImpl, "");
        vm.prank(newOwner);
        admin.upgradeAndCall(ITransparentUpgradeableProxy(address(registry)), newImpl, "");
        assertEq(RegistryV2(address(registry)).version(), 2);
        // renouncing freezes the contract for good
        vm.prank(newOwner);
        admin.renounceOwnership();
        vm.prank(newOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        admin.upgradeAndCall(ITransparentUpgradeableProxy(address(registry)), anotherImpl, "");
    }

    function testEveryProxyAndBeaconIsOwnedByTheDeployer() public view {
        assertEq(_adminOf(address(registry)).owner(), deployer);
        assertEq(_adminOf(address(factory)).owner(), deployer);
        assertEq(_adminOf(address(adapter)).owner(), deployer);
        assertEq(tokenBeacon.owner(), deployer);
        assertEq(vaultBeacon.owner(), deployer);
        assertEq(hookBeacon.owner(), deployer);
    }

    // ---------------------------------------------------------------- helpers

    function _proxy(address impl, bytes memory data) private returns (address) {
        return address(new TransparentUpgradeableProxy(impl, deployer, data));
    }

    function _adminOf(address proxy) private view returns (ProxyAdmin) {
        return ProxyAdmin(address(uint160(uint256(vm.load(proxy, ADMIN_SLOT)))));
    }

    function _mineSalt(address from, bytes32 initCodeHash) private pure returns (bytes32 salt) {
        for (uint256 i; i < 2_000_000; ++i) {
            salt = bytes32(i);
            address predicted = address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), from, salt, initCodeHash)))));
            if ((uint160(predicted) & 0x3fff) == 0x2880) return salt;
        }
        revert("no salt");
    }

    function _activate() private {
        vm.warp(cutoffAt - MIN_TRADING);
        vm.prank(address(factory));
        registry.activate(marketId);
        vm.warp(releaseAt);
    }

    function _report(int32 price, bytes32 period) private {
        vm.warp(releaseAt);
        IpoResolutionAdapter.Report memory r = _makeReport(price, period, "evidence");
        (bytes memory e, bytes memory p) = _signReport(r);
        adapter.reportValue(r, "evidence", e, p);
    }

    function _makeReport(int32 price, bytes32 period, bytes memory evidence) private view returns (IpoResolutionAdapter.Report memory r) {
        r = IpoResolutionAdapter.Report({
            marketId: marketId, sourceId: adapter.SOURCE_ID(), periodId: period, valueBps: price,
            evidenceHash: keccak256(evidence), signatureExpiry: deadline
        });
    }

    function _reportDigest(IpoResolutionAdapter.Report memory r, address verifying) private view returns (bytes32) {
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("QTimeline"), keccak256("1"), block.chainid, verifying
        ));
        bytes32 structHash = keccak256(abi.encode(adapter.REPORT_TYPEHASH(), r.marketId, r.sourceId, r.periodId, r.valueBps, r.evidenceHash, r.signatureExpiry));
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _signReport(IpoResolutionAdapter.Report memory r) private view returns (bytes memory ecdsaSig, bytes memory pqSig) {
        (uint8 v, bytes32 rr, bytes32 s) = vm.sign(SIGNER_KEY, _reportDigest(r, address(adapter)));
        return (abi.encodePacked(rr, s, v), bytes("pq-ok"));
    }

    function _config(uint64 o, uint64 c, uint64 r, uint64 d, int32 threshold, uint256 nonce) private view returns (IpoMarketFactory.MarketConfig memory) {
        return IpoMarketFactory.MarketConfig({
            opensAt: o, cutoffAt: c, releaseAt: r, deadline: d, periodId: PERIOD, thresholdBps: threshold,
            ethCollateralCap: 0.1 ether, usdgCollateralCap: 500_000_000, nonce: nonce, signatureExpiry: uint64(block.timestamp + 30 minutes)
        });
    }

    function _sign(IpoMarketFactory.MarketConfig memory c) private view returns (bytes memory ecdsaSig, bytes32 salt) {
        bytes32 configHash = keccak256(abi.encode(block.chainid, address(factory), c.opensAt, c.cutoffAt, c.releaseAt, c.deadline, c.periodId, c.thresholdBps, c.ethCollateralCap, c.usdgCollateralCap));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("QTimeline"), keccak256("1"), block.chainid, address(factory)
        ));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, keccak256(abi.encode(factory.CREATE_TYPEHASH(), configHash, c.nonce, c.signatureExpiry))));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DEPLOYER_KEY, digest);
        ecdsaSig = abi.encodePacked(r, s, v);
        bytes32 id = keccak256(abi.encode(configHash, c.nonce));
        for (uint256 i; i < 2_000_000; ++i) {
            salt = bytes32(i);
            if ((uint160(hookDeployer.predict(registry, id, salt)) & 0x3fff) == 0x2880) break;
        }
    }

    function _create(uint64 o, uint64 c, uint64 r, uint64 d, int32 threshold, uint256 nonce) private returns (bytes32 id) {
        IpoMarketFactory.MarketConfig memory cfg = _config(o, c, r, d, threshold, nonce);
        (bytes memory ecdsaSig, bytes32 salt) = _sign(cfg);
        bytes32 configHash = keccak256(abi.encode(block.chainid, address(factory), cfg.opensAt, cfg.cutoffAt, cfg.releaseAt, cfg.deadline, cfg.periodId, cfg.thresholdBps, cfg.ethCollateralCap, cfg.usdgCollateralCap));
        id = keccak256(abi.encode(configHash, nonce));
        vm.prank(deployer);
        factory.createMarket(cfg, ecdsaSig, "pq-ok", salt);
    }
}
