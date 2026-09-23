// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {DeedTypes, IDeedRegistry} from "./DeedTypes.sol";

contract DeedCollection is ERC721Enumerable, ERC2981, ReentrancyGuard, IDeedRegistry {
    using Strings for uint256;
    uint256 public constant MAX_SUPPLY = 1111;
    uint256 public constant MINT_PRICE = 0.001 ether;
    uint256 public constant MAX_TOLL_USD = 2 ether;
    address payable public immutable treasury;
    string public imageURI;
    uint256 public minted;
    mapping(address => bool) public hasMinted;
    mapping(uint256 => DeedTypes.State) private states;

    error MintPrice();
    error MintLimit();
    error OwnerOnly();
    error TreasuryPayment();
    error InvalidAddress();
    event ConfigurationChanged(uint256 indexed id, uint256 revision, address indexed owner);

    constructor(address payable treasury_, string memory image_) ERC721("Voiddeeds", "DEED") {
        if (treasury_ == address(0)) revert InvalidAddress();
        treasury = treasury_;
        imageURI = image_;
        _setDefaultRoyalty(treasury_, 1000);
    }

    function mint() external payable nonReentrant returns (uint256 id) {
        if (msg.value != MINT_PRICE) revert MintPrice();
        if (hasMinted[msg.sender] || minted == MAX_SUPPLY) revert MintLimit();
        hasMinted[msg.sender] = true;
        id = ++minted;
        _safeMint(msg.sender, id);
        (bool sent,) = treasury.call{value: msg.value}("");
        if (!sent) revert TreasuryPayment();
    }

    function configure(uint256 id, uint256 tollUsd, string calldata information,
        DeedTypes.Recipient[] calldata recipients) external {
        if (ownerOf(id) != msg.sender) revert OwnerOnly();
        DeedTypes.State memory next = DeedTypes.State(id, states[id].revision + 1,
            msg.sender, tollUsd, information, recipients);
        DeedTypes.validate(next);
        states[id] = next;
        emit ConfigurationChanged(id, next.revision, msg.sender);
    }

    function stateOf(uint256 id) external view returns (DeedTypes.State memory) {
        _requireOwned(id);
        return states[id];
    }

    function _update(address to, uint256 id, address auth) internal override returns (address from) {
        from = super._update(to, id, auth);
        if (from == to) return from;
        DeedTypes.State storage state = states[id];
        state.id = id;
        state.owner = to;
        ++state.revision;
        delete state.recipients;
        if (from == address(0)) state.tollUsd = 0.01 ether;
        emit ConfigurationChanged(id, state.revision, to);
    }

    function tokenURI(uint256 id) public view override returns (string memory) {
        _requireOwned(id);
        string memory number = id.toString();
        string memory padded = id < 10 ? string.concat("000", number) :
            id < 100 ? string.concat("00", number) : id < 1000 ? string.concat("0", number) : number;
        return string.concat("data:application/json;base64,", Base64.encode(bytes(string.concat(
            '{"name":"Voiddeed #', padded,
            '","description":"One of 1,111 independent application spaces. Testnet collection.","image":"',
            imageURI, '","external_url":"https://voiddeeds.xyz/revenues?deed=', number,
            '","attributes":[{"trait_type":"Deed","value":', number,
            '},{"trait_type":"Collection","value":"', Strings.toHexString(address(this)), '"}]}'
        ))));
    }

    function supportsInterface(bytes4 id) public view override(ERC721Enumerable, ERC2981) returns (bool) {
        return super.supportsInterface(id);
    }
}
