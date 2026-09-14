// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
/// @notice Operator-published testnet ETH/USD feed; production must use a reviewed network oracle.
contract TestnetPriceFeed {
    address public immutable publisher;
    uint8 public constant decimals = 8;
    int256 private answer;
    uint256 private updated;
    uint80 private round;
    constructor(address publisher_) { require(block.chainid == 31337 || block.chainid == 11155111 || block.chainid == 46630 || block.chainid == 84532 || block.chainid == 763373 || block.chainid == 5042002, "TESTNET_ONLY"); publisher = publisher_; }
    function publish(int256 value) external { require(msg.sender == publisher && value > 0, "PUBLISHER_PRICE"); answer = value; updated = block.timestamp; round++; }
    function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80) { return(round,answer,updated,updated,round); }
}
