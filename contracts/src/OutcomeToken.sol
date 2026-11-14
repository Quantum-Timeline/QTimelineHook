// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Per-market claim token. Minting and burning are restricted to its vault.
contract OutcomeToken is ERC20 {
    error OnlyVault();

    address public immutable factory;
    address public vault;

    constructor(string memory name_, string memory symbol_, uint8 decimals_, address factory_)
        ERC20(name_, symbol_)
    {
        require(factory_ != address(0), "zero factory");
        factory = factory_;
        _decimals = decimals_;
    }

    uint8 private immutable _decimals;

    function decimals() public view override returns (uint8) { return _decimals; }

    /// @notice Resolves the vault/token deployment cycle exactly once during factory setup.
    function bindVault(address vault_) external {
        if (msg.sender != factory || vault != address(0) || vault_ == address(0)) revert OnlyVault();
        vault = vault_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != vault) revert OnlyVault();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != vault) revert OnlyVault();
        _burn(from, amount);
    }
}
