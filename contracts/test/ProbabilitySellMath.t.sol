// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ProbabilitySellMath} from "../src/libraries/ProbabilitySellMath.sol";

contract ProbabilitySellMathTest {
    function testMergeAmountIsLimitedByUnswappedClaimAndSwapOutput() public pure {
        require(ProbabilitySellMath.mergeAmount(100, 40, 80) == 60, "must cap at remaining claim");
        require(ProbabilitySellMath.mergeAmount(100, 40, 30) == 30, "must cap at swap proceeds");
    }

    function testMergeAmountIsZeroWhenNoUnswappedClaimRemains() public pure {
        require(ProbabilitySellMath.mergeAmount(100, 100, 100) == 0, "full swap cannot be merged");
    }
}
