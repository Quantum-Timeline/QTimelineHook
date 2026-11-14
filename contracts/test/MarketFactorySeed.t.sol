// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {MarketFactory, IQTPQRegistry, IQTVerifier} from "../src/MarketFactory.sol";
import {MarketRegistry} from "../src/MarketRegistry.sol";
import {ConditionalVault} from "../src/ConditionalVault.sol";
import {TimelineHookDeployer} from "../src/TimelineHookDeployer.sol";
import {OutcomeToken} from "../src/OutcomeToken.sol";
import {TestUSDG} from "../src/testnet/TestUSDG.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

interface VmSeed {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function deal(address account, uint256 balance) external;
    function warp(uint256 timestamp) external;
    function prank(address sender) external;
}

contract SeedTestPoolManager {}

contract SeedTestKeys {
    function publicKeyBlob(address) external pure returns (address) { return address(0xCAFE); }
}

contract SeedTestVerifier {
    function verify(address, bytes calldata, bytes calldata) external pure returns (bool) { return true; }
}

contract MarketFactorySeedTest {
    VmSeed private constant vm = VmSeed(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant DEPLOYER_KEY = 0xA11CE;
    address private deployer;
    MarketRegistry private registry;
    MarketFactory private factory;
    TestUSDG private usdg;
    TimelineHookDeployer private hookDeployer;
    SeedTestVerifier private verifier;
    bytes32 private marketId;

    function setUp() public {
        vm.warp(1_800_000_000);
        deployer = vm.addr(DEPLOYER_KEY);
        usdg = new TestUSDG();
        registry = new MarketRegistry(deployer, false);
        verifier = new SeedTestVerifier();
        SeedTestKeys keys = new SeedTestKeys();
        SeedTestPoolManager manager = new SeedTestPoolManager();
        factory = new MarketFactory(deployer, address(usdg), IPoolManager(address(manager)), registry, IQTPQRegistry(address(keys)), IQTVerifier(address(verifier)), false);
        hookDeployer = new TimelineHookDeployer(address(factory));

        vm.prank(deployer);
        factory.setHookDeployer(hookDeployer);
        vm.prank(deployer);
        registry.wireAndSeal(address(factory), address(verifier));
        marketId = _createDraftMarket(address(manager));
    }

    function testTreasuryCanSplitCollateralIntoDraftClaims() public {
        uint256 amount = 0.01 ether;
        vm.deal(deployer, amount);
        address vaultAddress = factory.vaultOf(marketId);
        vm.prank(deployer);
        ConditionalVault(payable(vaultAddress)).split{value: amount}(address(0), amount, deployer);
        require(ConditionalVault(payable(vaultAddress)).accountedCollateral(address(0)) == amount, "draft seed collateral missing");
        address yes = ConditionalVault(payable(vaultAddress)).outcomeToken(address(0), true);
        address no = ConditionalVault(payable(vaultAddress)).outcomeToken(address(0), false);
        require(OutcomeToken(yes).balanceOf(deployer) == amount, "YES claim missing");
        require(OutcomeToken(no).balanceOf(deployer) == amount, "NO claim missing");
        require(yes != no, "outcome claims must differ");
    }

    function testNonTreasuryCannotSplitDraftCollateral() public {
        address vaultAddress = factory.vaultOf(marketId);
        (bool ok,) = vaultAddress.call{value: 1 wei}(abi.encodeCall(ConditionalVault.split, (address(0), 1, address(this))));
        require(!ok, "non-treasury split draft collateral");
    }

    function _createDraftMarket(address manager) private returns (bytes32 id) {
        uint64 nowAt = uint64(block.timestamp);
        MarketFactory.MarketConfig memory c = MarketFactory.MarketConfig({
            opensAt: nowAt + 3600,
            cutoffAt: nowAt + 172800 - 300,
            releaseAt: nowAt + 172800,
            deadline: nowAt + 172800 + 172800,
            periodId: keccak256("test-period"),
            thresholdBps: 30,
            ethCollateralCap: 0.1 ether,
            usdgCollateralCap: 500_000_000,
            nonce: 0,
            signatureExpiry: nowAt + 1800
        });
        bytes32 configHash = keccak256(abi.encode(block.chainid, address(factory), c.opensAt, c.cutoffAt, c.releaseAt, c.deadline, c.periodId, c.thresholdBps, c.ethCollateralCap, c.usdgCollateralCap));
        id = keccak256(abi.encode(configHash, c.nonce));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("QTimeline"), keccak256("1"), block.chainid, address(factory)
        ));
        bytes32 structHash = keccak256(abi.encode(factory.CREATE_TYPEHASH(), configHash, c.nonce, c.signatureExpiry));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(DEPLOYER_KEY, digest);
        bytes memory ecdsaSignature = abi.encodePacked(r, s, v);
        bytes32 salt;
        for (uint256 i; i < 1_000_000; ++i) {
            salt = bytes32(i);
            address predicted = hookDeployer.predict(IPoolManager(manager), registry, id, salt);
            if ((uint160(predicted) & 0x3fff) == 0x2880) break;
        }
        vm.prank(deployer);
        factory.createMarket(c, ecdsaSignature, hex"01", salt);
    }
}
