// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Hooks} from "@uniswap/v4-core/src/libraries/Hooks.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IQTimelineMarketRegistry} from "./interfaces/IQTimeline.sol";
import {TimelineHook} from "./TimelineHook.sol";

/// @notice CREATE2 deployer; callers mine salts off-chain for the callback permission bits.
contract TimelineHookDeployer {
    error Unauthorized();
    error InvalidHookAddress(address predicted);
    error DeploymentFailed();

    uint160 public constant REQUIRED_HOOK_MASK = 0x2880; // beforeInitialize | beforeAddLiquidity | beforeSwap
    address public immutable factory;

    constructor(address factory_) { require(factory_ != address(0), "zero factory"); factory = factory_; }

    function initCodeHash(IPoolManager manager, IQTimelineMarketRegistry registry, bytes32 marketId)
        public view returns (bytes32)
    {
        return keccak256(abi.encodePacked(type(TimelineHook).creationCode, abi.encode(manager, registry, factory, marketId)));
    }

    function predict(IPoolManager manager, IQTimelineMarketRegistry registry, bytes32 marketId, bytes32 salt)
        public view returns (address)
    {
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash(manager, registry, marketId))))));
    }

    function deploy(IPoolManager manager, IQTimelineMarketRegistry registry, bytes32 marketId, bytes32 salt)
        external returns (address hook)
    {
        if (msg.sender != factory) revert Unauthorized();
        address predicted = predict(manager, registry, marketId, salt);
        if (uint160(predicted) & Hooks.ALL_HOOK_MASK != REQUIRED_HOOK_MASK) revert InvalidHookAddress(predicted);
        hook = address(new TimelineHook{salt: salt}(manager, registry, factory, marketId));
        if (hook != predicted) revert DeploymentFailed();
    }
}
