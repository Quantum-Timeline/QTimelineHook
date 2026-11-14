// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {PQKeyRegistry} from "../src/PQKeyRegistry.sol";
import {MarketFactory, IQTPQRegistry, IQTVerifier} from "../src/MarketFactory.sol";
import {ResolutionAdapter, IPQKeyRegistry, IMLDSA44Verifier} from "../src/ResolutionAdapter.sol";
import {IMLDSA44KeyProof} from "../src/PQKeyRegistry.sol";
import {TimelineHookDeployer} from "../src/TimelineHookDeployer.sol";
import {TimelineRouter} from "../src/TimelineRouter.sol";
import {QTLVoting} from "../src/QTLVoting.sol";

contract MainnetForkVerifierStub {
    function verify(address, bytes calldata, bytes calldata) external pure returns (bool) { return true; }
}

contract MainnetForkTest is Test {
    address private constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address private constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address private constant QUOTER = 0x8Dc178eFB8111BB0973Dd9d722ebeFF267c98F94;
    address private constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address private constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    function setUp() public {
        if (block.chainid != 4663) vm.skip(true, "requires the Robinhood Mainnet fork profile");
    }

    function testOfficialRobinhoodMainnetDeploymentsAndAssets() public view {
        assertEq(block.chainid, 4663);
        assertGt(POOL_MANAGER.code.length, 0);
        assertGt(POSITION_MANAGER.code.length, 0);
        assertGt(QUOTER.code.length, 0);
        assertGt(WETH.code.length, 0);
        assertGt(USDG.code.length, 0);
        assertEq(IERC20Metadata(USDG).symbol(), "USDG");
        assertEq(IERC20Metadata(USDG).decimals(), 6);
        assertEq(IERC20Metadata(WETH).symbol(), "WETH");
        assertEq(IERC20Metadata(WETH).decimals(), 18);
    }

    function testProtocolConstructorsWireAgainstOfficialMainnetCore() public {
        address resolver = address(0xB07);
        MarketRegistry registry = new MarketRegistry(address(this), false);
        MainnetForkVerifierStub verifier = new MainnetForkVerifierStub();
        PQKeyRegistry keys = new PQKeyRegistry(address(this), IMLDSA44KeyProof(address(verifier)));
        MarketFactory factory = new MarketFactory(address(this), USDG, IPoolManager(POOL_MANAGER), registry, IQTPQRegistry(address(keys)), IQTVerifier(address(verifier)), false);
        ResolutionAdapter adapter = new ResolutionAdapter(registry, IPQKeyRegistry(address(keys)), IMLDSA44Verifier(address(verifier)), resolver);
        TimelineHookDeployer hookDeployer = new TimelineHookDeployer(address(factory));
        TimelineRouter router = new TimelineRouter(IPoolManager(POOL_MANAGER), registry);
        QTLVoting voting = new QTLVoting(address(this));

        factory.setHookDeployer(hookDeployer);
        registry.wireAndSeal(address(factory), address(adapter));

        assertEq(factory.usdg(), USDG);
        assertEq(factory.usdgDecimals(), 6);
        assertEq(address(factory.poolManager()), POOL_MANAGER);
        assertFalse(factory.shortTestMode());
        assertEq(address(registry.factory()), address(factory));
        assertEq(address(registry.resolver()), address(adapter));
        assertTrue(registry.isSealed());
        assertEq(address(factory.hookDeployer()), address(hookDeployer));
        assertEq(address(router.poolManager()), POOL_MANAGER);
        assertEq(address(router.registry()), address(registry));
        assertEq(voting.deployer(), address(this));
        assertEq(adapter.authorizedSigner(), resolver);
    }
}
