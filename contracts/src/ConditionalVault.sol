// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOutcomeToken, IQTimelineMarketRegistry} from "./interfaces/IQTimeline.sol";

/// @notice Holds ETH-native and USDG collateral independently for one market's four outcome claims.
contract ConditionalVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    error Unauthorized(); error InvalidAmount(); error InvalidRecipient(); error InvalidAsset(); error InvalidState(); error WrongValue(); error CapExceeded(); error InsufficientPair(); error Insolvent();

    address public immutable factory;
    address public immutable treasury;
    bytes32 public immutable marketId;
    IQTimelineMarketRegistry public immutable registry;
    address[2] public assets;
    mapping(address => address[2]) private _tokens; // outcome index 0=YES, 1=NO
    mapping(address => uint256) public collateralCap;
    mapping(address => uint256) public accountedCollateral;

    event Split(address indexed caller, address indexed asset, address indexed recipient, uint256 amount);
    event Merge(address indexed caller, address indexed asset, address indexed recipient, uint256 amount);
    event Redeem(address indexed caller, address indexed asset, address indexed recipient, bool yes, uint256 amount, uint256 payout);

    constructor(
        address factory_, address treasury_, bytes32 marketId_, IQTimelineMarketRegistry registry_,
        address asset0, address yes0, address no0, uint256 cap0,
        address asset1, address yes1, address no1, uint256 cap1
    ) {
        require(factory_ != address(0) && treasury_ != address(0) && address(registry_).code.length != 0, "zero authority");
        require(asset0 != asset1 && yes0 != address(0) && no0 != address(0) && yes1 != address(0) && no1 != address(0), "invalid pair");
        require(yes0 != no0 && yes1 != no1 && cap0 != 0 && cap1 != 0, "invalid cap");
        factory = factory_;
        treasury = treasury_;
        marketId = marketId_;
        registry = registry_;
        assets = [asset0, asset1];
        _tokens[asset0] = [yes0, no0];
        _tokens[asset1] = [yes1, no1];
        collateralCap[asset0] = cap0;
        collateralCap[asset1] = cap1;
    }

    function outcomeToken(address asset, bool yes) external view returns (address) {
        _requireAsset(asset);
        return _tokens[asset][yes ? 0 : 1];
    }

    function split(address asset, uint256 amount, address recipient) external payable nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        _requireAsset(asset);
        IQTimelineMarketRegistry.Market memory m = registry.market(marketId);
        if (m.status != IQTimelineMarketRegistry.Status.Draft && m.status != IQTimelineMarketRegistry.Status.Open) revert InvalidState();
        if (m.status == IQTimelineMarketRegistry.Status.Draft && msg.sender != treasury) revert Unauthorized();
        if (m.status == IQTimelineMarketRegistry.Status.Open && (block.timestamp < m.opensAt || block.timestamp >= m.cutoffAt)) revert InvalidState();
        if (accountedCollateral[asset] + amount > collateralCap[asset]) revert CapExceeded();
        if (asset == address(0)) {
            if (msg.value != amount) revert WrongValue();
        } else {
            if (msg.value != 0) revert WrongValue();
            uint256 beforeBalance = IERC20(asset).balanceOf(address(this));
            IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
            if (IERC20(asset).balanceOf(address(this)) - beforeBalance != amount) revert InvalidAmount();
        }
        accountedCollateral[asset] += amount;
        IOutcomeToken(_tokens[asset][0]).mint(recipient, amount);
        IOutcomeToken(_tokens[asset][1]).mint(recipient, amount);
        emit Split(msg.sender, asset, recipient, amount);
    }

    function merge(address asset, uint256 amount, address recipient) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        _requireAsset(asset);
        IQTimelineMarketRegistry.Status s = registry.market(marketId).status;
        if (s == IQTimelineMarketRegistry.Status.FinalYes || s == IQTimelineMarketRegistry.Status.FinalNo || s == IQTimelineMarketRegistry.Status.Cancelled) revert InvalidState();
        address yes = _tokens[asset][0]; address no = _tokens[asset][1];
        if (IOutcomeToken(yes).balanceOf(msg.sender) < amount || IOutcomeToken(no).balanceOf(msg.sender) < amount) revert InsufficientPair();
        IOutcomeToken(yes).burn(msg.sender, amount);
        IOutcomeToken(no).burn(msg.sender, amount);
        accountedCollateral[asset] -= amount;
        _pay(asset, recipient, amount);
        emit Merge(msg.sender, asset, recipient, amount);
    }

    function redeem(address asset, bool yes, uint256 amount, address recipient) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        if (recipient == address(0)) revert InvalidRecipient();
        _requireAsset(asset);
        IQTimelineMarketRegistry.Status s = registry.market(marketId).status;
        uint256 payout;
        if (s == IQTimelineMarketRegistry.Status.FinalYes || s == IQTimelineMarketRegistry.Status.FinalNo) {
            bool winningOutcome = (s == IQTimelineMarketRegistry.Status.FinalYes) == yes;
            payout = winningOutcome ? amount : 0;
        } else if (s == IQTimelineMarketRegistry.Status.Cancelled) payout = amount / 2;
        else revert InvalidState();
        IOutcomeToken(_tokens[asset][yes ? 0 : 1]).burn(msg.sender, amount);
        accountedCollateral[asset] -= payout;
        if (payout != 0) _pay(asset, recipient, payout);
        emit Redeem(msg.sender, asset, recipient, yes, amount, payout);
    }

    function _requireAsset(address asset) private view {
        if (asset != assets[0] && asset != assets[1]) revert InvalidAsset();
    }

    function _pay(address asset, address recipient, uint256 amount) private {
        if (asset == address(0)) {
            if (address(this).balance < amount) revert Insolvent();
            (bool ok,) = recipient.call{value: amount}("");
            if (!ok) revert Insolvent();
        } else {
            if (IERC20(asset).balanceOf(address(this)) < amount) revert Insolvent();
            IERC20(asset).safeTransfer(recipient, amount);
        }
    }

    receive() external payable { revert WrongValue(); }
}
