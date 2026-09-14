// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
/// @notice Testnet curve; completion has no DEX migration and closes trading permanently.
contract LaunchCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;
    bool private initialized;
    address public gateway;
    address public token;
    address public creator;
    address public treasury;
    uint256 public phantomQuote;
    uint256 public trackedTokens;
    uint256 public reservedTokens;
    uint256 public realReserve;
    uint256 public supply;
    uint256 public initialEthUsd;
    uint256 public feeBps;
    uint256 public protocolShareBps;
    bool public complete;
    mapping(address => uint256) public claimable;
    event Trade(
        address indexed user,
        bool buy,
        uint256 quote,
        uint256 tokens,
        uint256 fee,
        uint256 reserve,
        uint256 tokenReserve
    );
    event CurveCompleted(uint256 quoteReserve, uint256 reservedTokens);
    event Claimed(
        address indexed user,
        address indexed recipient,
        uint256 amount
    );
    constructor() {
        initialized = true;
    }
    function initialize(
        address token_,
        address creator_,
        address treasury_,
        uint256 phantom,
        uint256 supply_,
        uint256 ethUsd,
        uint256 fee,
        uint256 share,
        uint256 reservedBps
    ) external {
        require(!initialized, "INITIALIZED");
        require(
            token_ != address(0) &&
                creator_ != address(0) &&
                treasury_ != address(0),
            "ADDRESS"
        );
        require(
            phantom > 0 &&
                supply_ > 0 &&
                fee <= 1000 &&
                share <= 5000 &&
                reservedBps > 0 &&
                reservedBps < 10000,
            "TERMS"
        );
        initialized = true;
        gateway = msg.sender;
        token = token_;
        creator = creator_;
        treasury = treasury_;
        phantomQuote = phantom;
        supply = supply_;
        trackedTokens = supply_;
        reservedTokens = Math.mulDiv(supply_, reservedBps, 10000);
        initialEthUsd = ethUsd;
        feeBps = fee;
        protocolShareBps = share;
    }
    modifier onlyGateway() {
        require(msg.sender == gateway, "GATEWAY");
        _;
    }
    function spotPrice() external view returns (uint256) {
        return Math.mulDiv(phantomQuote + realReserve, 1e18, trackedTokens);
    }
    function fdv() external view returns (uint256) {
        return Math.mulDiv(phantomQuote + realReserve, supply, trackedTokens);
    }
    function remainingCost() public view returns (uint256) {
        uint256 available = trackedTokens - reservedTokens;
        if (available == 0) return 0;
        uint256 net = Math.mulDiv(
            available,
            phantomQuote + realReserve,
            reservedTokens,
            Math.Rounding.Ceil
        );
        return Math.mulDiv(net, 10000, 10000 - feeBps, Math.Rounding.Ceil);
    }
    function quoteBuy(
        uint256 amount
    ) public view returns (uint256 tokens, uint256 spent, uint256 fee) {
        require(!complete && amount > 0, "CLOSED_OR_ZERO");
        spent = Math.min(amount, remainingCost());
        fee = Math.mulDiv(spent, feeBps, 10000);
        uint256 net = spent - fee;
        tokens = Math.min(
            trackedTokens - reservedTokens,
            Math.mulDiv(net, trackedTokens, phantomQuote + realReserve + net)
        );
    }
    function quoteSell(
        uint256 amount
    ) public view returns (uint256 payout, uint256 fee) {
        require(!complete && amount > 0, "CLOSED_OR_ZERO");
        uint256 gross = Math.mulDiv(
            amount,
            phantomQuote + realReserve,
            trackedTokens + amount
        );
        require(gross <= realReserve, "RESERVE");
        fee = Math.mulDiv(gross, feeBps, 10000);
        payout = gross - fee;
    }
    function _fee(uint256 fee) private {
        uint256 protocol = Math.mulDiv(fee, protocolShareBps, 10000);
        claimable[treasury] += protocol;
        claimable[creator] += fee - protocol;
    }
    function buy(
        address user,
        uint256 minimum
    ) external payable onlyGateway nonReentrant returns (uint256 tokens) {
        uint256 spent;
        uint256 fee;
        (tokens, spent, fee) = quoteBuy(msg.value);
        require(tokens > 0 && tokens >= minimum, "OUTPUT");
        realReserve += spent - fee;
        trackedTokens -= tokens;
        _fee(fee);
        if (trackedTokens == reservedTokens) {
            complete = true;
            emit CurveCompleted(realReserve, reservedTokens);
        }
        IERC20(token).safeTransfer(user, tokens);
        if (msg.value > spent) {
            (bool ok, ) = payable(user).call{value: msg.value - spent}("");
            require(ok, "REFUND");
        }
        emit Trade(user, true, spent, tokens, fee, realReserve, trackedTokens);
    }
    function sell(
        address user,
        uint256 amount,
        uint256 minimum
    ) external onlyGateway nonReentrant returns (uint256 payout) {
        uint256 fee;
        (payout, fee) = quoteSell(amount);
        require(payout > 0 && payout >= minimum, "OUTPUT");
        IERC20(token).safeTransferFrom(user, address(this), amount);
        trackedTokens += amount;
        realReserve -= payout + fee;
        _fee(fee);
        (bool ok, ) = payable(user).call{value: payout}("");
        require(ok, "PAYOUT");
        emit Trade(
            user,
            false,
            payout,
            amount,
            fee,
            realReserve,
            trackedTokens
        );
    }
    function claim(address payable recipient) external nonReentrant {
        require(recipient != address(0), "ADDRESS");
        uint256 amount = claimable[msg.sender];
        require(amount > 0, "EMPTY");
        claimable[msg.sender] = 0;
        (bool ok, ) = recipient.call{value: amount}("");
        require(ok, "PAYOUT");
        emit Claimed(msg.sender, recipient, amount);
    }
}
