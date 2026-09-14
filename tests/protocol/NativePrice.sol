// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
interface IAggregator {
    function decimals() external view returns(uint8);
    function latestRoundData() external view returns(uint80,int256,uint256,uint256,uint80);
}
contract NativePrice {
    IAggregator public immutable feed;
    uint256 public immutable maxAge;
    constructor(IAggregator feed_, uint256 maxAge_) { require(address(feed_).code.length > 0 && maxAge_ > 0, "FEED"); require(feed_.decimals() <= 18, "DECIMALS"); feed = feed_; maxAge = maxAge_; }
    function quote(uint256 usd18) external view returns(uint256) {
        if(usd18 == 0) return 0;
        (uint80 round,int256 answer,,uint256 updated,uint80 answered) = feed.latestRoundData();
        require(answer > 0 && updated > 0 && updated <= block.timestamp && block.timestamp - updated <= maxAge && answered >= round, "STALE_PRICE");
        return Math.mulDiv(usd18, 10 ** feed.decimals(), uint256(answer), Math.Rounding.Ceil);
    }
}
