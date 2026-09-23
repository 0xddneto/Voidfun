// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

library DeedTypes {
    uint256 internal constant SUPPLY = 1111;
    uint256 internal constant MAX_TOLL = 2 ether; // USD with 18 decimals, not native ETH.
    struct Recipient { address wallet; uint16 bps; }
    struct State {
        uint256 id;
        uint256 revision;
        address owner;
        uint256 tollUsd;
        string information;
        Recipient[] recipients;
    }

    error InvalidState();
    error InvalidRecipients();
    error TollLimit();

    function validate(State memory state) internal pure {
        if (state.id == 0 || state.id > SUPPLY || state.owner == address(0) ||
            state.revision == 0 || bytes(state.information).length > 2048) revert InvalidState();
        if (state.tollUsd > MAX_TOLL) revert TollLimit();
        validateRecipients(state.recipients);
    }

    function validateRecipients(Recipient[] memory recipients) internal pure {
        if (recipients.length > 10) revert InvalidRecipients();
        uint256 total;
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i].wallet == address(0) || recipients[i].bps == 0) revert InvalidRecipients();
            for (uint256 j; j < i; ++j) {
                if (recipients[i].wallet == recipients[j].wallet) revert InvalidRecipients();
            }
            total += recipients[i].bps;
        }
        if (recipients.length != 0 && total != 10000) revert InvalidRecipients();
    }
}

interface IDeedRegistry {
    function stateOf(uint256 id) external view returns (DeedTypes.State memory);
}

interface IPriceOracle {
    function quote(uint256 usdAmount) external view returns (uint256);
}
