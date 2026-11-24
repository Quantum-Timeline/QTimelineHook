// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IQTimelineMarketRegistry} from "../interfaces/IQTimeline.sol";

interface IIpoPQKeyRegistry { function publicKeyBlob(address signer) external view returns (address); }
interface IIpoMLDSA44Verifier { function verify(address publicKeyBlob, bytes calldata message, bytes calldata signature) external view returns (bool); }
interface IIpoDeployerView { function deployer() external view returns (address); }

/// @notice Resolves the Anthropic IPO pricing market from the final offering price printed in the SEC final prospectus (424B4),
///         or permissionlessly cancels at expiry. Upgradeable behind a transparent proxy; a deployment fully separate from Core PCE.
/// @dev `valueBps` carries the final offering price in US cents ($74.00 is 7400), and the market's `thresholdBps` is a price in
///      cents too. The field name is kept so the signed report layout matches the shared registry and bot code. The EIP-712 domain
///      binds to the proxy address, so a signature for another contract does not verify here.
contract IpoResolutionAdapter is Initializable, EIP712 {
    using ECDSA for bytes32;

    error Unauthorized();
    error InvalidReport();
    error InvalidSignature();
    error InvalidEvidence();
    error Expired();

    bytes32 public constant REPORT_TYPEHASH = keccak256("ReportValue(bytes32 marketId,bytes32 sourceId,bytes32 periodId,int32 valueBps,bytes32 evidenceHash,uint64 signatureExpiry)");
    bytes32 public constant SOURCE_ID = keccak256("sec:edgar:424b4:ipo-offer-price-cents:first-filing");
    uint256 public constant MAX_EVIDENCE_BYTES = 4096;

    IQTimelineMarketRegistry public registry;
    IIpoPQKeyRegistry public keyRegistry;
    IIpoMLDSA44Verifier public verifier;
    address public authorizedSigner;
    /// @notice Source a market resolves from, chosen by the deployer before the earliest report. Zero means the original
    ///         SEC 424B4 source, so markets created before this field existed keep working unchanged.
    mapping(bytes32 => bytes32) public marketSource;
    uint256[45] private __gap;

    event ValueReported(bytes32 indexed marketId, bytes32 indexed periodId, int32 valueBps, bytes32 evidenceHash, address relayer);
    event MarketCancelled(bytes32 indexed marketId, address indexed caller);
    event MarketSourceSet(bytes32 indexed marketId, bytes32 indexed sourceId);

    struct Report {
        bytes32 marketId;
        bytes32 sourceId;
        bytes32 periodId;
        int32 valueBps;
        bytes32 evidenceHash;
        uint64 signatureExpiry;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() EIP712("QTimeline", "1") { _disableInitializers(); }

    function initialize(IQTimelineMarketRegistry registry_, IIpoPQKeyRegistry keys_, IIpoMLDSA44Verifier verifier_, address signer_) external initializer {
        require(address(registry_) != address(0) && address(keys_) != address(0) && address(verifier_) != address(0) && signer_ != address(0), "zero address");
        registry = registry_;
        keyRegistry = keys_;
        verifier = verifier_;
        authorizedSigner = signer_;
    }

    /// @notice Binds a market to the data source its report must name. Deployer only, once per market, before the earliest report.
    ///         Reports for a market must carry exactly this source id, so a report from another source cannot settle it.
    function setMarketSource(bytes32 marketId, bytes32 sourceId) external {
        if (msg.sender != IIpoDeployerView(address(registry)).deployer()) revert Unauthorized();
        IQTimelineMarketRegistry.Market memory m = registry.market(marketId);
        if (m.vault == address(0) || sourceId == bytes32(0) || marketSource[marketId] != bytes32(0) || block.timestamp >= m.releaseAt) revert InvalidReport();
        marketSource[marketId] = sourceId;
        emit MarketSourceSet(marketId, sourceId);
    }

    /// @notice The source id a report for this market must carry.
    function expectedSource(bytes32 marketId) public view returns (bytes32 source) {
        source = marketSource[marketId];
        if (source == bytes32(0)) source = SOURCE_ID;
    }

    function reportValue(Report calldata r, bytes calldata evidenceJson, bytes calldata ecdsaSig, bytes calldata pqSig) external {
        IQTimelineMarketRegistry.Market memory m = registry.market(r.marketId);
        bytes32 expected = expectedSource(r.marketId);
        // An offering price is a positive amount, so the original SEC source rejects zero or negative values. Other sources
        // (for example a month-over-month inflation print) can legitimately be zero or negative.
        if (!m.activated || r.sourceId != expected || r.periodId != m.periodId || r.evidenceHash == bytes32(0) || (expected == SOURCE_ID && r.valueBps <= 0)) revert InvalidReport();
        if (block.timestamp < m.releaseAt || block.timestamp >= m.deadline || block.timestamp > r.signatureExpiry || r.signatureExpiry > m.deadline) revert Expired();
        if (evidenceJson.length == 0 || evidenceJson.length > MAX_EVIDENCE_BYTES || keccak256(evidenceJson) != r.evidenceHash) revert InvalidEvidence();
        bytes32 structHash = keccak256(abi.encode(REPORT_TYPEHASH, r.marketId, r.sourceId, r.periodId, r.valueBps, r.evidenceHash, r.signatureExpiry));
        bytes32 digest = _hashTypedDataV4(structHash);
        if (ECDSA.recover(digest, ecdsaSig) != authorizedSigner) revert InvalidSignature();
        address pubkey = keyRegistry.publicKeyBlob(authorizedSigner);
        if (pubkey == address(0) || !verifier.verify(pubkey, abi.encodePacked(digest), pqSig)) revert InvalidSignature();
        IQTimelineMarketRegistry.Status outcome = r.valueBps >= m.thresholdBps ? IQTimelineMarketRegistry.Status.FinalYes : IQTimelineMarketRegistry.Status.FinalNo;
        registry.setTerminal(r.marketId, outcome, r.valueBps, r.evidenceHash);
        emit ValueReported(r.marketId, r.periodId, r.valueBps, r.evidenceHash, msg.sender);
    }

    function cancelExpired(bytes32 marketId) external {
        IQTimelineMarketRegistry.Market memory m = registry.market(marketId);
        if (!m.activated || block.timestamp < m.deadline) revert Expired();
        registry.setTerminal(marketId, IQTimelineMarketRegistry.Status.Cancelled, 0, bytes32(0));
        emit MarketCancelled(marketId, msg.sender);
    }
}
