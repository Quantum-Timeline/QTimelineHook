// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IQTimelineMarketRegistry} from "./interfaces/IQTimeline.sol";

interface IPQKeyRegistry { function publicKeyBlob(address signer) external view returns (address); }
interface IMLDSA44Verifier { function verify(address publicKeyBlob, bytes calldata message, bytes calldata signature) external view returns (bool); }

/// @notice Resolves the exact signed first-release BEA observation or permissionlessly cancels at expiry.
contract ResolutionAdapter is EIP712 {
    using ECDSA for bytes32;

    error InvalidReport();
    error InvalidSignature();
    error InvalidEvidence();
    error Expired();

    bytes32 public constant REPORT_TYPEHASH = keccak256("ReportValue(bytes32 marketId,bytes32 sourceId,bytes32 periodId,int32 valueBps,bytes32 evidenceHash,uint64 signatureExpiry)");
    bytes32 public constant SOURCE_ID = keccak256("bea:core-pce:mom:first-release");
    bytes32 public constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public constant NAME_HASH = keccak256("QTimeline");
    bytes32 public constant VERSION_HASH = keccak256("1");
    uint256 public constant MAX_EVIDENCE_BYTES = 4096;

    IQTimelineMarketRegistry public immutable registry;
    IPQKeyRegistry public immutable keyRegistry;
    IMLDSA44Verifier public immutable verifier;
    address public immutable authorizedSigner;

    event ValueReported(bytes32 indexed marketId, bytes32 indexed periodId, int32 valueBps, bytes32 evidenceHash, address relayer);
    event MarketCancelled(bytes32 indexed marketId, address indexed caller);

    struct Report {
        bytes32 marketId;
        bytes32 sourceId;
        bytes32 periodId;
        int32 valueBps;
        bytes32 evidenceHash;
        uint64 signatureExpiry;
    }

    constructor(IQTimelineMarketRegistry registry_, IPQKeyRegistry keys_, IMLDSA44Verifier verifier_, address signer_)
        EIP712("QTimeline", "1")
    {
        require(address(registry_) != address(0) && address(keys_) != address(0) && address(verifier_) != address(0) && signer_ != address(0), "zero address");
        registry = registry_;
        keyRegistry = keys_;
        verifier = verifier_;
        authorizedSigner = signer_;
    }

    function reportValue(Report calldata r, bytes calldata evidenceJson, bytes calldata ecdsaSig, bytes calldata pqSig) external {
        IQTimelineMarketRegistry.Market memory m = registry.market(r.marketId);
        if (!m.activated || r.sourceId != SOURCE_ID || r.periodId != m.periodId || r.evidenceHash == bytes32(0)) revert InvalidReport();
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
