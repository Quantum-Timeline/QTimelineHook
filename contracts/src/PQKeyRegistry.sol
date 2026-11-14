// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IMLDSA44KeyProof { function verify(address pkBlob, bytes calldata message, bytes calldata signature) external view returns (bool); }

/// @notice One-time ECDSA -> prepared ML-DSA-44 blob binding with proof of possession.
/// @dev The pinned Fireblocks verifier is research code. PoP alone does NOT exclude degenerate public keys;
/// deployment must validate raw-key derivation and the SAFETY.md non-degeneracy rule out of band.
contract PQKeyRegistry is EIP712 {
    error Unauthorized(); error AlreadyRegistered(); error InvalidKey(); error InvalidProof();
    bytes32 public constant REGISTER_TYPEHASH = keccak256("RegisterKey(address signer,address pkBlob,bytes32 codeHash,uint64 expiry)");
    uint256 public constant PREPARED_BLOB_SIZE = 20_545;
    address public immutable deployer;
    IMLDSA44KeyProof public immutable verifier;
    bool public isSealed;
    mapping(address => address) private _blobs;
    mapping(address => bytes32) public keyFingerprint;
    uint256 public registeredCount;

    event KeyRegistered(address indexed signer, address indexed pkBlob, bytes32 indexed fingerprint);
    event RegistrySealed();

    constructor(address deployer_, IMLDSA44KeyProof verifier_) EIP712("QTimeline Key Registry", "1") {
        if (deployer_ == address(0) || address(verifier_).code.length == 0) revert InvalidKey();
        deployer = deployer_;
        verifier = verifier_;
    }

    function register(address signer, address preparedPublicKeyBlob, uint64 expiry, bytes calldata ecdsaProof, bytes calldata pqProof) external {
        if (msg.sender != deployer || isSealed) revert Unauthorized();
        if (signer == address(0) || _blobs[signer] != address(0) || preparedPublicKeyBlob.code.length != PREPARED_BLOB_SIZE || block.timestamp > expiry) revert InvalidKey();
        bytes32 codeHash = preparedPublicKeyBlob.codehash;
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(REGISTER_TYPEHASH, signer, preparedPublicKeyBlob, codeHash, expiry)));
        if (ECDSA.recover(digest, ecdsaProof) != signer) revert InvalidProof();
        if (!verifier.verify(preparedPublicKeyBlob, abi.encodePacked(digest), pqProof)) revert InvalidProof();
        _blobs[signer] = preparedPublicKeyBlob;
        keyFingerprint[signer] = codeHash;
        ++registeredCount;
        emit KeyRegistered(signer, preparedPublicKeyBlob, codeHash);
    }

    function seal() external {
        if (msg.sender != deployer || isSealed || registeredCount < 2) revert Unauthorized();
        isSealed = true;
        emit RegistrySealed();
    }

    function publicKeyBlob(address signer) external view returns (address) { return _blobs[signer]; }
}
