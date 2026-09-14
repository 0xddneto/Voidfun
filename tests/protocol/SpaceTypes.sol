// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library SpaceTypes {
    uint256 internal constant MAX_TOLL_USD = 2e18;
    struct Split { address wallet; uint16 bps; }
    struct State {
        uint256 id;
        uint256 revision;
        address owner;
        bool active;
        uint256 tollUsd;
        string uri;
        Split[] splits;
    }
}
interface ISpaceRegistry { function space(uint256 id) external view returns (SpaceTypes.State memory); }
