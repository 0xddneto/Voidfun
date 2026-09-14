// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC2981} from "@openzeppelin/contracts/token/common/ERC2981.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {SpaceTypes, ISpaceRegistry} from "./SpaceTypes.sol";

/// @notice Canonical Deed collection. Every one of the 1,111 NFTs is publicly mintable.
contract Deed is ERC721, ERC2981, ReentrancyGuard, ISpaceRegistry {
    uint256 public constant MAX_SUPPLY = 1111;
    uint256 public constant MINT_PRICE = 0.001 ether;
    uint256 public constant MAX_TOLL_USD = SpaceTypes.MAX_TOLL_USD;
    address payable public immutable treasury;
    uint256 public totalMinted;
    mapping(address => bool) public hasMinted;
    mapping(uint256 => SpaceTypes.State) private states;
    string private base;
    event SpaceChanged(uint256 indexed id, uint256 indexed revision, address indexed owner);

    constructor(address payable treasury_, string memory base_) ERC721("VOID Deeds", "DEED") {
        require(treasury_ != address(0), "TREASURY"); treasury = treasury_; base = base_;
        // Resale royalties belong to the collection deployer. The release deploy
        // script requires the treasury to be this same wallet.
        _setDefaultRoyalty(msg.sender, 1000);
    }
    function mint() external payable nonReentrant returns (uint256 id) {
        require(msg.value == MINT_PRICE, "MINT_PRICE");
        require(!hasMinted[msg.sender] && totalMinted < MAX_SUPPLY, "MINT_LIMIT");
        hasMinted[msg.sender] = true; id = ++totalMinted;
        _safeMint(msg.sender, id);
        (bool ok,) = treasury.call{value: msg.value}(""); require(ok, "TREASURY_SEND");
    }
    function _update(address to, uint256 id, address auth) internal override returns (address from) {
        from = super._update(to, id, auth);
        if (from != to) {
            SpaceTypes.State storage s = states[id];
            s.id = id; s.owner = to; s.revision++;
            delete s.splits;
            if (from == address(0)) { s.active = true; s.tollUsd = 1e16; }
            emit SpaceChanged(id, s.revision, to);
        }
    }
    function configure(uint256 id, bool active, uint256 tollUsd, string calldata uri, SpaceTypes.Split[] calldata splits) external {
        require(ownerOf(id) == msg.sender, "OWNER");
        // Keep the existing ABI, but minted Deeds can no longer be disabled.
        require(active, "ALWAYS_ACTIVE");
        require(tollUsd <= MAX_TOLL_USD, "TOLL_LIMIT");
        require(bytes(uri).length <= 2048 && splits.length <= 10, "SIZE");
        uint256 sum;
        for(uint256 i; i < splits.length; i++) {
            require(splits[i].wallet != address(0) && splits[i].bps > 0, "SPLIT");
            for(uint256 j; j < i; j++) require(splits[i].wallet != splits[j].wallet, "DUPLICATE");
            sum += splits[i].bps;
        }
        require(splits.length == 0 || sum == 10000, "SPLIT_TOTAL");
        SpaceTypes.State storage s = states[id];
        s.active = true; s.tollUsd = tollUsd; s.uri = uri;
        delete s.splits;
        for(uint256 i; i < splits.length; i++) s.splits.push(splits[i]);
        s.revision++; emit SpaceChanged(id, s.revision, msg.sender);
    }
    function space(uint256 id) external view returns (SpaceTypes.State memory) { ownerOf(id); return states[id]; }
    function tokenURI(uint256 id) public view override returns (string memory) { ownerOf(id); return string.concat(base, Strings.toString(id)); }
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC2981) returns(bool) { return super.supportsInterface(interfaceId); }
}
