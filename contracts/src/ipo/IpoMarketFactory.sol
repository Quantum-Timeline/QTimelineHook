// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {StateLibrary} from "@uniswap/v4-core/src/libraries/StateLibrary.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IQTimelineMarketRegistry} from "../interfaces/IQTimeline.sol";
import {IpoOutcomeToken} from "./IpoOutcomeToken.sol";
import {IpoConditionalVault} from "./IpoConditionalVault.sol";
import {IpoHookDeployer} from "./IpoHookDeployer.sol";
import {IIpoScheduleParams} from "./IpoMarketRegistry.sol";

interface IIpoKeyLookup { function publicKeyBlob(address signer) external view returns (address); }
interface IIpoSignatureVerifier { function verify(address publicKeyBlob, bytes calldata message, bytes calldata signature) external view returns (bool); }

/// @notice Restricted market creation for the Anthropic IPO pricing market, upgradeable behind a transparent proxy.
/// @dev Mirrors MarketFactory with two differences: the gap between swap cutoff and earliest report (and the report window) come from the
///      IPO registry, and every market's vault, four claim tokens and hook are proxies pointing at beacons. A beacon upgrade changes the
///      logic of all markets' vaults, tokens or hooks at once while their balances and settings stay in each market's own proxy.
///      Thresholds are prices in US cents.
contract IpoMarketFactory is Initializable, EIP712 {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;
    error Unauthorized(); error InvalidConfig(); error InvalidSignature(); error InvalidHook(); error AlreadyCreated();

    bytes32 public constant CREATE_TYPEHASH = keccak256("CreateMarket(bytes32 configHash,uint256 nonce,uint64 signatureExpiry)");
    address public deployer;
    address public usdg;
    uint8 public usdgDecimals;
    uint64 public releaseDelay;
    uint64 public resolutionWindow;
    IPoolManager public poolManager;
    IQTimelineMarketRegistry public registry;
    IIpoKeyLookup public keyRegistry;
    IIpoSignatureVerifier public verifier;
    address public tokenBeacon;
    address public vaultBeacon;
    IpoHookDeployer public hookDeployer;
    mapping(address => uint256) public nonces;
    mapping(bytes32 => bool) public created;
    mapping(bytes32 => address[4]) private _tokens;
    mapping(bytes32 => address) public vaultOf;
    mapping(bytes32 => address) public hookOf;
    mapping(bytes32 => PoolKey[3]) private _poolKeys;
    mapping(bytes32 => bool) public poolsInitialized;
    uint256[30] private __gap;

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

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() EIP712("QTimeline", "1") { _disableInitializers(); }

    function initialize(
        address deployer_, address usdg_, IPoolManager manager_, IQTimelineMarketRegistry registry_, IIpoKeyLookup keys_, IIpoSignatureVerifier verifier_,
        address tokenBeacon_, address vaultBeacon_
    ) external initializer {
        require(deployer_ != address(0) && usdg_.code.length != 0 && address(manager_).code.length != 0, "invalid core");
        require(address(registry_).code.length != 0 && address(keys_).code.length != 0 && address(verifier_).code.length != 0, "invalid security");
        require(tokenBeacon_.code.length != 0 && vaultBeacon_.code.length != 0, "invalid beacons");
        deployer = deployer_;
        usdg = usdg_;
        usdgDecimals = IERC20Metadata(usdg_).decimals();
        poolManager = manager_;
        registry = registry_;
        keyRegistry = keys_;
        verifier = verifier_;
        tokenBeacon = tokenBeacon_;
        vaultBeacon = vaultBeacon_;
        releaseDelay = IIpoScheduleParams(address(registry_)).releaseDelay();
        resolutionWindow = IIpoScheduleParams(address(registry_)).resolutionWindow();
    }

    function setHookDeployer(IpoHookDeployer deployer_) external {
        if (msg.sender != deployer) revert Unauthorized();
        if (address(hookDeployer) != address(0) || address(deployer_).code.length == 0 || deployer_.factory() != address(this)) revert InvalidConfig();
        hookDeployer = deployer_;
    }

    function createMarket(MarketConfig calldata c, bytes calldata ecdsaSig, bytes calldata pqSig, bytes32 hookSalt)
        external returns (bytes32 marketId)
    {
        if (msg.sender != deployer || address(hookDeployer) == address(0)) revert Unauthorized();
        // Schedule bounds mirror the registry (5 minutes to 7 days from cutoff to earliest report, 1 to 14 days report window), and the
        // threshold is any signed value so a month-over-month print can sit at or below zero.
        if (!(c.opensAt < c.cutoffAt && c.releaseAt >= c.cutoffAt + 300 && c.releaseAt <= c.cutoffAt + 7 days
                && c.deadline >= c.releaseAt + 1 days && c.deadline <= c.releaseAt + 14 days)
            || c.periodId == bytes32(0) || c.nonce != nonces[deployer]
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

        address yesEth = _newToken("QTimeline ETH YES", "qtETH-YES", 18);
        address noEth = _newToken("QTimeline ETH NO", "qtETH-NO", 18);
        address yesUsd = _newToken("QTimeline USDG YES", "qtUSDG-YES", usdgDecimals);
        address noUsd = _newToken("QTimeline USDG NO", "qtUSDG-NO", usdgDecimals);
        address vault = address(new BeaconProxy(vaultBeacon, abi.encodeCall(IpoConditionalVault.initialize, (
            address(this), deployer, marketId, registry, address(0), yesEth, noEth, c.ethCollateralCap, usdg, yesUsd, noUsd, c.usdgCollateralCap
        ))));
        IpoOutcomeToken(yesEth).bindVault(vault); IpoOutcomeToken(noEth).bindVault(vault);
        IpoOutcomeToken(yesUsd).bindVault(vault); IpoOutcomeToken(noUsd).bindVault(vault);

        address hook = hookDeployer.deploy(registry, marketId, hookSalt);
        PoolKey[3] memory keys = _makeKeys(yesEth, noEth, yesUsd, noUsd, hook);
        bytes32[3] memory poolIds;
        for (uint256 i; i < 3; ++i) poolIds[i] = PoolId.unwrap(keys[i].toId());
        registry.registerMarket(marketId, configHash, vault, usdg, c.opensAt, c.cutoffAt, c.releaseAt, c.deadline, c.periodId, c.thresholdBps, poolIds);

        created[marketId] = true;
        nonces[deployer] = c.nonce + 1;
        vaultOf[marketId] = vault;
        hookOf[marketId] = hook;
        _tokens[marketId] = [yesEth, noEth, yesUsd, noUsd];
        _poolKeys[marketId] = keys;
        emit MarketCreated(marketId, configHash, vault, hook, yesEth, noEth, yesUsd, noUsd);
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

    function _newToken(string memory name, string memory symbol, uint8 decimals_) private returns (address) {
        return address(new BeaconProxy(tokenBeacon, abi.encodeCall(IpoOutcomeToken.initialize, (name, symbol, decimals_, address(this)))));
    }

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
