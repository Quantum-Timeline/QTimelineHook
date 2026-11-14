// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Faucet token for Robinhood Chain testnet only. Never deploy this as production USDG.
contract TestUSDG is ERC20 {
    constructor() ERC20("QTimeline Test USDG", "USDG") {}

    function decimals() public pure override returns (uint8) { return 6; }

    function faucet(address recipient, uint256 amount) external {
        require(recipient != address(0) && amount != 0, "invalid faucet request");
        _mint(recipient, amount);
    }
}
