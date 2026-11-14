// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

library ProbabilitySellMath {
    function mergeAmount(uint128 totalAmount, uint128 swapAmount, uint128 swapOut) internal pure returns (uint128) {
        uint128 unswapped = totalAmount - swapAmount;
        return unswapped < swapOut ? unswapped : swapOut;
    }
}
