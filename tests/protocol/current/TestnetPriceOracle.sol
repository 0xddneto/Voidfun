// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPriceOracle} from "./DeedTypes.sol";

/// @notice Operator-maintained test reference. Arc's native test USDC has a fixed USD 1 reference.
contract TestnetPriceOracle is IPriceOracle {
    address public immutable publisher;
    bool public immutable stableNative;
    uint256 public constant MAX_AGE = 2 hours;
    uint256 public usdPerNative; // 8 decimals.
    uint256 public updatedAt;
    error PublisherOnly();
    error PriceUnavailable();
    error InvalidPrice();
    error InvalidNetwork();
    event PriceUpdated(uint256 usdPerNative, uint256 timestamp);

    constructor(address publisher_, bool stableNative_) {
        if (block.chainid != 31337 && block.chainid != 11155111 && block.chainid != 46630 &&
            block.chainid != 84532 && block.chainid != 763373 && block.chainid != 5042002) revert InvalidNetwork();
        if (publisher_ == address(0) || (block.chainid != 31337 && stableNative_ != (block.chainid == 5042002))) revert InvalidPrice();
        publisher = publisher_;
        stableNative = stableNative_;
        if (stableNative_) { usdPerNative = 1e8; updatedAt = block.timestamp; }
    }

    function publish(uint256 value) external {
        if (msg.sender != publisher) revert PublisherOnly();
        if (stableNative || value < 1e8 || value > 1_000_000e8) revert InvalidPrice();
        usdPerNative = value;
        updatedAt = block.timestamp;
        emit PriceUpdated(value, block.timestamp);
    }

    function quote(uint256 usdAmount) external view returns (uint256) {
        if (usdAmount == 0) return 0;
        if (!stableNative && (updatedAt == 0 || block.timestamp > updatedAt + MAX_AGE)) revert PriceUnavailable();
        return Math.mulDiv(usdAmount, 1e8, usdPerNative, Math.Rounding.Ceil);
    }
}
