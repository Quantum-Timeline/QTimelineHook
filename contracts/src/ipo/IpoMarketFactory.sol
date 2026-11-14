// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IQTimelineMarketRegistry} from "../interfaces/IQTimeline.sol";
import {OutcomeToken} from "../OutcomeToken.sol";
import {ConditionalVault} from "../ConditionalVault.sol";
import {TimelineHookDeployer} from "../TimelineHookDeployer.sol";
import {IIpoScheduleParams} from "./IpoMarketRegistry.sol";

interface IIpoKeyLookup { function publicKeyBlob(address signer) external view returns (address); }
interface IIpoSignatureVerifier { function verify(address publicKeyBlob, bytes calldata message, bytes calldata signature) external view returns (bool); }

/// @notice Restricted market creation and immutable wiring for the Anthropic IPO pricing market (two collateral assets, three pools).
/// @dev Mirrors MarketFactory with one difference: the gap between swap cutoff and earliest report, and the report window,
///      come from the IPO registry instead of being fixed at five minutes and 48 hours. Thresholds are prices in US cents.
contract IpoMarketFactory is EIP712 {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    error Unauthorized(); error InvalidConfig(); error InvalidSignature(); error InvalidHook(); error AlreadyCreated();

    bytes32 public constant CREATE_TYPEHASH = keccak256("CreateMarket(bytes32 configHash,uint256 nonce,uint64 signatureExpiry)");
    address public immutable deployer;
    address public immutable usdg;
    uint8 public immutable usdgDecimals;
    uint64 public immutable releaseDelay;
    uint64 public immutable resolutionWindow;
    IPoolManager public immutable poolManager;
    IQTimelineMarketRegistry public immutable registry;
    IIpoKeyLookup public immutable keyRegistry;
    IIpoSignatureVerifier public immutable verifier;
    TimelineHookDeployer public hookDeployer;
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public created;
    mapping(bytes32 => address[4]) private _tokens;
    mapping(bytes32 => address) public vaultOf;
    mapping(bytes32 => address) public hookOf;
    mapping(bytes32 => PoolKey[3]) private _poolKeys;
    mapping(bytes32 => bool) public poolsInitialized;

    struct MarketConfig {
        uint64 opensAt;
        uint64 cutoffAt;
        uint64 releaseAt;
        uint64 deadline;
        bytes32 periodId;
        int32 thresholdBps; // final offering price in US cents
        uint256 ethCollateralCap;
        uint256 usdgCollateralCap;
        uint256 nonce;
        uint64 signatureExpiry;
    }

    event MarketCreated(bytes32 indexed marketId, bytes32 indexed configHash, address vault, address hook, address yesEth, address noEth, address yesUsdg, address noUsdg);
    event PoolsInitialized(bytes32 indexed marketId, uint160[3] sqrtPriceX96);

    constructor(
        address deployer_, address usdg_, IPoolManager manager_, IQTimelineMarketRegistry registry_, IIpoKeyLookup keys_, IIpoSignatureVerifier verifier_
    ) EIP712("QTimeline", "1") {
        require(deployer_ != address(0) && usdg_.code.length != 0 && address(manager_).code.length != 0, "invalid core");
        require(address(registry_).code.length != 0 && address(keys_).code.length != 0 && address(verifier_).code.length != 0, "invalid security");
        deployer = deployer_;
        usdg = usdg_;
        usdgDecimals = IERC20Metadata(usdg_).decimals();
        poolManager = manager_;
        registry = registry_;
        keyRegistry = keys_;
        verifier = verifier_;
        releaseDelay = IIpoScheduleParams(address(registry_)).releaseDelay();
        resolutionWindow = IIpoScheduleParams(address(registry_)).resolutionWindow();
    }

    function setHookDeployer(TimelineHookDeployer deployer_) external {
        if (msg.sender != deployer) revert Unauthorized();
        if (address(hookDeployer) != address(0) || address(deployer_).code.length == 0 || deployer_.factory() != address(this)) revert InvalidConfig();
        hookDeployer = deployer_;
    }

    function createMarket(MarketConfig calldata c, bytes calldata ecdsaSig, bytes calldata pqSig, bytes32 hookSalt)
        external returns (bytes32 marketId)
    {
        if (msg.sender != deployer || address(hookDeployer) == address(0)) revert Unauthorized();
        if (!(c.opensAt < c.cutoffAt && c.cutoffAt + releaseDelay == c.releaseAt && c.deadline == c.releaseAt + resolutionWindow)
            || c.periodId == bytes32(0) || c.thresholdBps <= 0 || c.nonce != nonces[deployer]
            || block.timestamp > c.signatureExpiry || c.signatureExpiry > c.opensAt
            || c.ethCollateralCap == 0 || c.ethCollateralCap > 0.1 ether
            || c.usdgCollateralCap == 0 || c.usdgCollateralCap > 500 * 10 ** usdgDecimals) revert InvalidConfig();
        bytes32 configHash = keccak256(abi.encode(block.chainid, address(this), c.opensAt, c.cutoffAt, c.releaseAt, c.deadline, c.periodId, c.thresholdBps, c.ethCollateralCap, c.usdgCollateralCap));
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CREATE_TYPEHASH, configHash, c.nonce, c.signatureExpiry)));
        if (ECDSA.recover(digest, ecdsaSig) != deployer) revert InvalidSignature();
        address pubkey = keyRegistry.publicKeyBlob(deployer);
        if (pubkey == address(0) || !verifier.verify(pubkey, abi.encodePacked(digest), pqSig)) revert InvalidSignature();
        marketId = keccak256(abi.encode(configHash, c.nonce));
        if (created[marketId]) revert AlreadyCreated();

        OutcomeToken yesEth = new OutcomeToken("QTimeline ANT ETH YES", "qtETH-YES", 18, address(this));
        OutcomeToken noEth = new OutcomeToken("QTimeline ANT ETH NO", "qtETH-NO", 18, address(this));
        OutcomeToken yesUsd = new OutcomeToken("QTimeline ANT USDG YES", "qtUSDG-YES", usdgDecimals, address(this));
        OutcomeToken noUsd = new OutcomeToken("QTimeline ANT USDG NO", "qtUSDG-NO", usdgDecimals, address(this));
        ConditionalVault vault = new ConditionalVault(address(this), deployer, marketId, registry, address(0), address(yesEth), address(noEth), c.ethCollateralCap, usdg, address(yesUsd), address(noUsd), c.usdgCollateralCap);
        yesEth.bindVault(address(vault)); noEth.bindVault(address(vault)); yesUsd.bindVault(address(vault)); noUsd.bindVault(address(vault));

        address hook = hookDeployer.deploy(poolManager, registry, marketId, hookSalt);
        PoolKey[3] memory keys = _makeKeys(address(yesEth), address(noEth), address(yesUsd), address(noUsd), hook);
        bytes32[3] memory poolIds;
        for (uint256 i; i < 3; ++i) poolIds[i] = PoolId.unwrap(keys[i].toId());
        registry.registerMarket(marketId, configHash, address(vault), usdg, c.opensAt, c.cutoffAt, c.releaseAt, c.deadline, c.periodId, c.thresholdBps, poolIds);

        created[marketId] = true;
        nonces[deployer] = c.nonce + 1;
        vaultOf[marketId] = address(vault);
        hookOf[marketId] = hook;
        _tokens[marketId] = [address(yesEth), address(noEth), address(yesUsd), address(noUsd)];
        _poolKeys[marketId] = keys;
        emit MarketCreated(marketId, configHash, address(vault), hook, address(yesEth), address(noEth), address(yesUsd), address(noUsd));
    }

    /// @notice Initializes the three frozen PoolKeys. Liquidity must be seeded before activateMarket.
    function initializePools(bytes32 marketId, uint160[3] calldata pricesX96) external {
        if (msg.sender != deployer || !created[marketId] || poolsInitialized[marketId]) revert Unauthorized();
        for (uint256 i; i < 3; ++i) {
            if (pricesX96[i] == 0) revert InvalidConfig();
            poolManager.initialize(_poolKeys[marketId][i], pricesX96[i]);
        }
        poolsInitialized[marketId] = true;
        emit PoolsInitialized(marketId, pricesX96);
    }

    function activateMarket(bytes32 marketId) external {
        if (msg.sender != deployer || !poolsInitialized[marketId]) revert Unauthorized();
        PoolKey[3] storage keys = _poolKeys[marketId];
        for (uint256 i; i < 3; ++i) {
            if (poolManager.getLiquidity(keys[i].toId()) == 0) revert InvalidConfig();
        }
        registry.activate(marketId);
    }

    function tokens(bytes32 marketId) external view returns (address[4] memory) { return _tokens[marketId]; }
    function poolKeys(bytes32 marketId) external view returns (PoolKey[3] memory) { return _poolKeys[marketId]; }

    function _makeKeys(address yesEth, address noEth, address yesUsd, address noUsd, address hook) private pure returns (PoolKey[3] memory keys) {
        keys[0] = _key(yesEth, yesUsd, hook);
        keys[1] = _key(noEth, noUsd, hook);
        keys[2] = _key(yesUsd, noUsd, hook);
    }

    function _key(address a, address b, address hook) private pure returns (PoolKey memory k) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        k = PoolKey({currency0: Currency.wrap(c0), currency1: Currency.wrap(c1), fee: 3000, tickSpacing: 60, hooks: IHooks(hook)});
    }
}
