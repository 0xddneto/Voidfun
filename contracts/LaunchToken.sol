// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
contract LaunchToken is ERC20 {
    string private tokenName;
    string private tokenSymbol;
    bool private initialized;
    constructor() ERC20("", "") {
        initialized = true;
    }
    function initialize(
        string calldata n,
        string calldata s,
        address curve,
        uint256 supply
    ) external {
        require(!initialized && curve != address(0), "INITIALIZED");
        initialized = true;
        tokenName = n;
        tokenSymbol = s;
        _mint(curve, supply);
    }
    function name() public view override returns (string memory) {
        return tokenName;
    }
    function symbol() public view override returns (string memory) {
        return tokenSymbol;
    }
}
