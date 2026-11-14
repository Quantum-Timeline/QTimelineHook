// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IQTimelineMarketRegistry {
    enum Status { Draft, Scheduled, Open, AwaitingResult, FinalYes, FinalNo, Cancelled, Discarded }

    struct Market {
        bytes32 configHash;
        address vault;
        address asset;
        uint64 opensAt;
        uint64 cutoffAt;
        uint64 releaseAt;
        uint64 deadline;
        bytes32 periodId;
        int32 thresholdBps;
        Status status;
        bool activated;
    }

    function market(bytes32 marketId) external view returns (Market memory);
    function isRegisteredPool(bytes32 marketId, bytes32 poolId) external view returns (bool);
    function registerMarket(bytes32 marketId, bytes32 configHash, address vault, address asset, uint64 opensAt, uint64 cutoffAt, uint64 releaseAt, uint64 deadline, bytes32 periodId, int32 thresholdBps, bytes32[3] calldata poolIds) external;
    function activate(bytes32 marketId) external;
    function setTerminal(bytes32 marketId, Status status, int32 reportedValueBps, bytes32 evidenceHash) external;
}

interface IOutcomeToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
    function balanceOf(address account) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

interface IConditionalVault {
    function marketId() external view returns (bytes32);
    function assets(uint256 index) external view returns (address);
    function split(address asset, uint256 amount, address recipient) external payable;
    function merge(address asset, uint256 amount, address recipient) external;
    function redeem(address asset, bool yes, uint256 amount, address recipient) external;
    function outcomeToken(address asset, bool yes) external view returns (address);
}
