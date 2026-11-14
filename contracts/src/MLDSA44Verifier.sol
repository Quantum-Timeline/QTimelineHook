// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @notice QTimeline deployment name for the exact pinned Fireblocks Labs verifier implementation.
/// @dev The upstream implementation is vendored at contracts/lib/evm-ml-dsa-verifier (commit cca262b).
import {MLDSA44Verifier as PinnedMLDSA44Verifier} from "@mldsa/MLDSA44Verifier.sol";

contract MLDSA44Verifier is PinnedMLDSA44Verifier {
    constructor(address keccakF1600Helper) PinnedMLDSA44Verifier(keccakF1600Helper) {}
}
