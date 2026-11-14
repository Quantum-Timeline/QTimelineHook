// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IQTimelineMarketRegistry} from "../interfaces/IQTimeline.sol";
import {IpoTimelineHook} from "./IpoTimelineHook.sol";

interface IIpoBeacon { function implementation() external view returns (address); }

/// @notice CREATE2 deployer for the upgradeable hooks. Uniswap v4 reads permission flags from the hook address, so both the hook
///         implementation and every per-market hook proxy must land on an address whose low bits equal the required flags.
/// @dev Callers mine salts off-chain with the predict functions. The owner deploys implementations; the factory deploys market proxies.
contract IpoHookDeployer {
    error Unauthorized();
    error InvalidHookAddress(address predicted);
    error DeploymentFailed();
    error NotConfigured();

    uint160 public constant REQUIRED_HOOK_MASK = 0x2880; // beforeInitialize | beforeAddLiquidity | beforeSwap

    address public immutable owner;
    address public factory;
    address public beacon;
    address public latestImplementation;

    event ImplementationDeployed(address indexed implementation);
    event Configured(address indexed factory, address indexed beacon);

    constructor(address owner_) { require(owner_ != address(0), "zero owner"); owner = owner_; }

    // ------------------------------------------------------------ hook implementations (owner)

    function implementationInitCodeHash(IPoolManager manager) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(type(IpoTimelineHook).creationCode, abi.encode(manager)));
    }

    function predictImplementation(IPoolManager manager, bytes32 salt) public view returns (address) {
        return _create2(salt, implementationInitCodeHash(manager));
    }

    function deployImplementation(IPoolManager manager, bytes32 salt) external returns (address implementation) {
        if (msg.sender != owner) revert Unauthorized();
        address predicted = predictImplementation(manager, salt);
        if (uint160(predicted) & Hooks.ALL_HOOK_MASK != REQUIRED_HOOK_MASK) revert InvalidHookAddress(predicted);
        implementation = address(new IpoTimelineHook{salt: salt}(manager));
        if (implementation != predicted) revert DeploymentFailed();
        latestImplementation = implementation;
        emit ImplementationDeployed(implementation);
    }

    /// @notice Points the deployer at the factory and the hook beacon. The beacon must already serve a hook implementation from here.
    function configure(address factory_, address beacon_) external {
        if (msg.sender != owner || factory != address(0)) revert Unauthorized();
        if (factory_ == address(0) || beacon_ == address(0) || IIpoBeacon(beacon_).implementation() != latestImplementation) revert NotConfigured();
        factory = factory_;
        beacon = beacon_;
        emit Configured(factory_, beacon_);
    }

    // ------------------------------------------------------------ market hook proxies (factory)

    function _initData(IQTimelineMarketRegistry registry, bytes32 marketId) private view returns (bytes memory) {
        return abi.encodeCall(IpoTimelineHook.initialize, (registry, factory, marketId));
    }

    function proxyInitCodeHash(IQTimelineMarketRegistry registry, bytes32 marketId) public view returns (bytes32) {
        return keccak256(abi.encodePacked(type(BeaconProxy).creationCode, abi.encode(beacon, _initData(registry, marketId))));
    }

    function predict(IQTimelineMarketRegistry registry, bytes32 marketId, bytes32 salt) public view returns (address) {
        return _create2(salt, proxyInitCodeHash(registry, marketId));
    }

    function deploy(IQTimelineMarketRegistry registry, bytes32 marketId, bytes32 salt) external returns (address hook) {
        if (msg.sender != factory || factory == address(0)) revert Unauthorized();
        address predicted = predict(registry, marketId, salt);
        if (uint160(predicted) & Hooks.ALL_HOOK_MASK != REQUIRED_HOOK_MASK) revert InvalidHookAddress(predicted);
        hook = address(new BeaconProxy{salt: salt}(beacon, _initData(registry, marketId)));
        if (hook != predicted) revert DeploymentFailed();
    }

    function _create2(bytes32 salt, bytes32 initCodeHash) private view returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash)))));
    }
}
