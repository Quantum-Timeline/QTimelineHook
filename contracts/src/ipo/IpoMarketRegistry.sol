// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IQTimelineMarketRegistry} from "../interfaces/IQTimeline.sol";

/// @notice Timing parameters the IPO factory reads so market creation and registration agree on one schedule.
interface IIpoScheduleParams {
    function releaseDelay() external view returns (uint64);
    function resolutionWindow() external view returns (uint64);
    function minimumTradingWindow() external view returns (uint64);
}

/// @notice Lifecycle source for the Anthropic IPO pricing market, a deployment fully separate from the Core PCE system.
/// @dev Same lifecycle and interface as MarketRegistry, so the shared vault, hook and router work unchanged. The differences are
///      that the gap between swap cutoff and the earliest report, the report window, and the minimum trading window are
///      constructor parameters instead of fixed constants. An IPO is priced in the evening and its final prospectus is filed the
///      next morning, so the cutoff must sit hours (not minutes) before the earliest report.
contract IpoMarketRegistry is IQTimelineMarketRegistry, IIpoScheduleParams {
    error Unauthorized();
    error AlreadyWired();
    error NotWired();
    error InvalidConfig();
    error AlreadyExists();
    error InvalidTransition();

    address public immutable deployer;
    /// @inheritdoc IIpoScheduleParams
    uint64 public immutable releaseDelay;
    /// @inheritdoc IIpoScheduleParams
    uint64 public immutable resolutionWindow;
    /// @inheritdoc IIpoScheduleParams
    uint64 public immutable minimumTradingWindow;
    address public factory;
    address public resolver;
    bool public isSealed;

    mapping(bytes32 => Market) private _markets;
    mapping(bytes32 => mapping(bytes32 => bool)) private _registeredPools;
    mapping(bytes32 => int32) public reportedValueBps;
    mapping(bytes32 => bytes32) public evidenceHash;

    event WiringSealed(address indexed factory, address indexed resolver);
    event MarketRegistered(bytes32 indexed marketId, bytes32 configHash, address vault);
    event MarketStatusChanged(bytes32 indexed marketId, Status status, int32 valueBps, bytes32 evidenceHash);

    constructor(address deployer_, uint64 releaseDelay_, uint64 resolutionWindow_, uint64 minimumTradingWindow_) {
        if (deployer_ == address(0)) revert InvalidConfig();
        // Bounds keep a typo from producing a market that can never open, never resolve, or cancels almost immediately.
        if (releaseDelay_ < 300 || releaseDelay_ > 7 days) revert InvalidConfig();
        if (resolutionWindow_ < 1 days || resolutionWindow_ > 14 days) revert InvalidConfig();
        if (minimumTradingWindow_ < 1 hours || minimumTradingWindow_ > 7 days) revert InvalidConfig();
        deployer = deployer_;
        releaseDelay = releaseDelay_;
        resolutionWindow = resolutionWindow_;
        minimumTradingWindow = minimumTradingWindow_;
    }

    function wireAndSeal(address factory_, address resolver_) external {
        if (msg.sender != deployer) revert Unauthorized();
        if (isSealed) revert AlreadyWired();
        if (factory_ == address(0) || resolver_ == address(0)) revert InvalidConfig();
        factory = factory_;
        resolver = resolver_;
        isSealed = true;
        emit WiringSealed(factory_, resolver_);
    }

    function registerMarket(
        bytes32 marketId,
        bytes32 configHash,
        address vault,
        address asset,
        uint64 opensAt,
        uint64 cutoffAt,
        uint64 releaseAt,
        uint64 deadline,
        bytes32 periodId,
        int32 thresholdBps,
        bytes32[3] calldata poolIds
    ) external override {
        if (!isSealed) revert NotWired();
        if (msg.sender != factory) revert Unauthorized();
        if (_markets[marketId].vault != address(0)) revert AlreadyExists();
        if (marketId == bytes32(0) || configHash == bytes32(0) || vault == address(0) || periodId == bytes32(0)) revert InvalidConfig();
        if (!(opensAt < cutoffAt && cutoffAt < releaseAt && releaseAt < deadline)) revert InvalidConfig();
        if (cutoffAt + releaseDelay != releaseAt || deadline != releaseAt + resolutionWindow) revert InvalidConfig();
        if (poolIds[0] == bytes32(0) || poolIds[1] == bytes32(0) || poolIds[2] == bytes32(0)) revert InvalidConfig();
        if (poolIds[0] == poolIds[1] || poolIds[0] == poolIds[2] || poolIds[1] == poolIds[2]) revert InvalidConfig();

        _markets[marketId] = Market({
            configHash: configHash, vault: vault, asset: asset, opensAt: opensAt, cutoffAt: cutoffAt,
            releaseAt: releaseAt, deadline: deadline, periodId: periodId, thresholdBps: thresholdBps,
            status: Status.Draft, activated: false
        });
        for (uint256 i; i < 3; ++i) _registeredPools[marketId][poolIds[i]] = true;
        emit MarketRegistered(marketId, configHash, vault);
    }

    function activate(bytes32 marketId) external override {
        if (msg.sender != factory) revert Unauthorized();
        Market storage m = _markets[marketId];
        uint256 tradingStart = block.timestamp > m.opensAt ? block.timestamp : m.opensAt;
        if (m.vault == address(0) || m.activated || tradingStart + minimumTradingWindow > m.cutoffAt) revert InvalidTransition();
        m.activated = true;
        m.status = block.timestamp < m.opensAt ? Status.Scheduled : Status.Open;
        emit MarketStatusChanged(marketId, m.status, 0, bytes32(0));
    }

    /// @notice Permissionless time synchronization; swaps additionally check timestamps in the hook.
    function syncTime(bytes32 marketId) external returns (Status next) {
        Market storage m = _markets[marketId];
        if (!m.activated || m.status == Status.FinalYes || m.status == Status.FinalNo || m.status == Status.Cancelled || m.status == Status.Discarded) revert InvalidTransition();
        if (block.timestamp < m.opensAt) next = Status.Scheduled;
        else if (block.timestamp < m.cutoffAt) next = Status.Open;
        else next = Status.AwaitingResult;
        if (m.status != next) {
            m.status = next;
            emit MarketStatusChanged(marketId, next, 0, bytes32(0));
        }
    }

    function discardDraft(bytes32 marketId) external {
        if (msg.sender != deployer && block.timestamp < _markets[marketId].cutoffAt - minimumTradingWindow) revert Unauthorized();
        Market storage m = _markets[marketId];
        if (m.vault == address(0) || m.activated || m.status != Status.Draft) revert InvalidTransition();
        m.status = Status.Discarded;
        emit MarketStatusChanged(marketId, Status.Discarded, 0, bytes32(0));
    }

    function setTerminal(bytes32 marketId, Status status, int32 valueBps, bytes32 evidence) external override {
        if (msg.sender != resolver) revert Unauthorized();
        Market storage m = _markets[marketId];
        if (!m.activated || (m.status != Status.AwaitingResult && m.status != Status.Open && m.status != Status.Scheduled)) revert InvalidTransition();
        if (status != Status.FinalYes && status != Status.FinalNo && status != Status.Cancelled) revert InvalidConfig();
        if (status != Status.Cancelled && evidence == bytes32(0)) revert InvalidConfig();
        if (status == Status.Cancelled) {
            if (block.timestamp < m.deadline) revert InvalidTransition();
        } else if (block.timestamp < m.releaseAt || block.timestamp >= m.deadline) {
            revert InvalidTransition();
        }
        m.status = status;
        reportedValueBps[marketId] = valueBps;
        evidenceHash[marketId] = evidence;
        emit MarketStatusChanged(marketId, status, valueBps, evidence);
    }

    function market(bytes32 marketId) external view override returns (Market memory) { return _markets[marketId]; }
    function isRegisteredPool(bytes32 marketId, bytes32 poolId) external view override returns (bool) { return _registeredPools[marketId][poolId]; }
}
