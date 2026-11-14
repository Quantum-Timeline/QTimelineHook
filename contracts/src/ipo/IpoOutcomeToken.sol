// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

/// @dev Upgradeable per-market claim token, deployed behind a beacon. Minting and burning are restricted to its vault.
///      Balances and supply live in the proxy, so upgrading the implementation never moves or resets them.
contract IpoOutcomeToken is Initializable, ERC20Upgradeable {
    error OnlyVault();

    address public factory;
    address public vault;
    uint8 private _tokenDecimals;
    uint256[46] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() { _disableInitializers(); }

    function initialize(string calldata name_, string calldata symbol_, uint8 decimals_, address factory_) external initializer {
        require(factory_ != address(0), "zero factory");
        __ERC20_init(name_, symbol_);
        factory = factory_;
        _tokenDecimals = decimals_;
    }

    function decimals() public view override returns (uint8) { return _tokenDecimals; }

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
