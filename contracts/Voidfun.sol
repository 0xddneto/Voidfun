// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {LaunchToken} from "./LaunchToken.sol";
import {LaunchCurve} from "./LaunchCurve.sol";
interface IRuntime {
    function executingUser() external view returns (address);
    function executingApp() external view returns (address);
}
interface IPrice {
    function quote(uint256 usd18) external view returns (uint256);
}
/// @notice Delegatecall implementation for a Deed gateway; RH testnet only.
contract Voidfun {
    address public immutable RUNTIME;
    address public immutable PRICE;
    address public immutable TREASURY;
    address public immutable TOKEN_LOGIC;
    address public immutable CURVE_LOGIC;
    uint256 public immutable TRADE_FEE_BPS;
    uint256 public immutable PROTOCOL_SHARE_BPS;
    uint256 public immutable CREATE_FEE;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    address[] private curves;
    mapping(address => bool) public isCurve;
    mapping(address => string) public metadata;
    event Launched(
        address indexed curve,
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string uri,
        uint256 initialFdvEth
    );
    constructor(
        address runtime_,
        address price_,
        address treasury_,
        address tokenLogic,
        address curveLogic,
        uint256 fee,
        uint256 share,
        uint256 creationFee
    ) {
        require(
            block.chainid == 31337 || block.chainid == 46630,
            "TESTNET_ONLY"
        );
        require(
            runtime_.code.length > 0 &&
                price_.code.length > 0 &&
                tokenLogic.code.length > 0 &&
                curveLogic.code.length > 0 &&
                treasury_ != address(0),
            "CONFIG"
        );
        require(fee <= 1000 && share <= 5000, "FEES");
        RUNTIME = runtime_;
        PRICE = price_;
        TREASURY = treasury_;
        TOKEN_LOGIC = tokenLogic;
        CURVE_LOGIC = curveLogic;
        TRADE_FEE_BPS = fee;
        PROTOCOL_SHARE_BPS = share;
        CREATE_FEE = creationFee;
    }
    function _user() private view returns (address user) {
        require(
            msg.sender == RUNTIME &&
                IRuntime(RUNTIME).executingApp() == address(this),
            "RUNTIME"
        );
        user = IRuntime(RUNTIME).executingUser();
        require(user != address(0), "USER");
    }
    function createToken(
        string calldata name,
        string calldata symbol,
        string calldata uri
    ) external payable returns (address curve) {
        address user = _user();
        require(
            bytes(name).length > 0 &&
                bytes(name).length <= 64 &&
                bytes(symbol).length > 0 &&
                bytes(symbol).length <= 12 &&
                bytes(uri).length <= 512,
            "METADATA"
        );
        require(msg.value == CREATE_FEE, "CREATE_FEE");
        uint256 phantom = IPrice(PRICE).quote(3000 ether);
        require(phantom > 0, "PRICE");
        uint256 ethUsd = Math.mulDiv(3000 ether, 1e18, phantom);
        curve = Clones.clone(CURVE_LOGIC);
        address token = Clones.clone(TOKEN_LOGIC);
        LaunchCurve(curve).initialize(
            token,
            user,
            TREASURY,
            phantom,
            SUPPLY,
            ethUsd,
            TRADE_FEE_BPS,
            PROTOCOL_SHARE_BPS,
            2000
        );
        LaunchToken(token).initialize(name, symbol, curve, SUPPLY);
        curves.push(curve);
        isCurve[curve] = true;
        metadata[curve] = uri;
        if (msg.value > 0) {
            (bool ok, ) = payable(TREASURY).call{value: msg.value}("");
            require(ok, "FEE");
        }
        emit Launched(curve, token, user, name, symbol, uri, phantom);
    }
    function buy(address curve, uint256 minimum) external payable {
        address user = _user();
        require(isCurve[curve], "CURVE");
        LaunchCurve(curve).buy{value: msg.value}(user, minimum);
    }
    function sell(address curve, uint256 amount, uint256 minimum) external {
        address user = _user();
        require(isCurve[curve], "CURVE");
        LaunchCurve(curve).sell(user, amount, minimum);
    }
    function launchCount() external view returns (uint256) {
        return curves.length;
    }
    function launches(
        uint256 offset,
        uint256 limit
    ) external view returns (address[] memory list) {
        require(limit <= 100, "LIMIT");
        uint256 end = Math.min(curves.length, offset + limit);
        if (offset >= end) return new address[](0);
        list = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) list[i - offset] = curves[i];
    }
}
