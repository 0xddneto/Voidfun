// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SpaceTypes, ISpaceRegistry} from "./SpaceTypes.sol";
import {NativePrice} from "./NativePrice.sol";
import {AppGateway} from "./AppGateway.sol";

contract Runtime is ReentrancyGuard {
    ISpaceRegistry public immutable registry;
    NativePrice public immutable price;
    address payable public immutable treasury;
    uint256 public constant PROTOCOL_BPS = 500;
    uint256 public constant PAYOUT_GAS = 40000;
    uint256 public constant MAX_TOLL_USD = SpaceTypes.MAX_TOLL_USD;
    struct App { uint256 deedId; address publisher; bool registered; }
    mapping(address => App) public apps;
    mapping(address => uint256) public publishedAtBlock;
    mapping(uint256 => uint256) public ownerRevenue;
    mapping(uint256 => uint256) public executionCount;
    address public executingUser;
    address public executingApp;
    event AppPublished(uint256 indexed deedId, address indexed app, address indexed publisher, address implementation);
    event AppRemoved(address indexed app);
    event Executed(uint256 indexed deedId, address indexed app, address indexed user, uint256 toll, uint256 revision);
    event Paid(uint256 indexed deedId, address indexed recipient, uint256 amount);
    event PaymentRedirected(uint256 indexed deedId, address indexed rejectedRecipient, uint256 amount);

    constructor(ISpaceRegistry registry_, NativePrice price_, address payable treasury_) {
        require(address(registry_).code.length > 0 && address(price_).code.length > 0 && treasury_ != address(0), "ADDRESS");
        registry = registry_; price = price_; treasury = treasury_;
    }
    function publish(uint256 id, address implementation, bytes calldata init, bytes32 salt) external nonReentrant returns(address app) {
        require(registry.space(id).active, "INACTIVE"); require(init.length <= 16384, "SIZE");
        app = address(new AppGateway{salt: keccak256(abi.encode(msg.sender,id,implementation,keccak256(init),salt))}(address(this),id,implementation,init));
        require(apps[app].publisher == address(0), "REPUBLISH");
        publishedAtBlock[app] = block.number;
        apps[app] = App(id,msg.sender,true); emit AppPublished(id,app,msg.sender,implementation);
    }
    function unregister(address app) external { require(apps[app].publisher == msg.sender, "PUBLISHER"); apps[app].registered = false; emit AppRemoved(app); }
    function quote(uint256 id) external view returns(uint256 toll, uint256 revision) { SpaceTypes.State memory s = registry.space(id); require(s.active, "INACTIVE"); require(s.tollUsd <= MAX_TOLL_USD, "TOLL_LIMIT"); return(price.quote(s.tollUsd),s.revision); }
    function execute(address app, bytes calldata data, uint256 revision, uint256 maxToll, uint256 appValue, uint256 appGas, uint256 deadline) external payable nonReentrant {
        App memory a = apps[app]; require(a.registered, "APP"); require(block.timestamp <= deadline, "DEADLINE");
        require(app.code.length > 0, "APP_CODE");
        // Constructor SELFDESTRUCT takes effect at transaction end. Do not allow
        // execution in the publication block, even while code is still visible.
        require(block.number > publishedAtBlock[app], "APP_NOT_READY");
        SpaceTypes.State memory s = registry.space(a.deedId);
        require(s.active && revision == s.revision, "CONFIGURATION");
        require(s.tollUsd <= MAX_TOLL_USD, "TOLL_LIMIT");
        uint256 toll = price.quote(s.tollUsd); require(toll <= maxToll && msg.value == toll + appValue, "PAYMENT");
        require(data.length <= 16384 && appGas >= 50000 && appGas <= 2000000, "SIZE");
        bytes memory payload = abi.encodeCall(AppGateway.execute,(data));
        require(gasleft() > appGas * 64 / 63 + 750000, "FINALIZATION_GAS");
        executingUser = msg.sender; executingApp = app;
        bool ok;
        assembly("memory-safe") { ok := call(appGas,app,appValue,add(payload,32),mload(payload),0,0) }
        require(ok, "APP_FAILED"); executingUser = address(0); executingApp = address(0);
        executionCount[a.deedId]++;
        uint256 protocol = Math.mulDiv(toll,PROTOCOL_BPS,10000);
        uint256 net = toll - protocol; uint256 redirected;
        if(s.splits.length == 0) redirected = _pay(a.deedId,s.owner,net);
        else {
            uint256 sent;
            for(uint256 i; i < s.splits.length; i++) {
                uint256 amount = i + 1 == s.splits.length ? net - sent : Math.mulDiv(net,s.splits[i].bps,10000);
                sent += amount; redirected += _pay(a.deedId,s.splits[i].wallet,amount);
            }
        }
        ownerRevenue[a.deedId] += net - redirected;
        if(protocol + redirected > 0) { (bool paid,) = treasury.call{value: protocol + redirected, gas: PAYOUT_GAS}(""); require(paid, "TREASURY_SEND"); }
        emit Executed(a.deedId,app,msg.sender,toll,revision);
    }
    function _pay(uint256 id, address recipient, uint256 amount) private returns(uint256) {
        if(amount == 0) return 0;
        bool ok;
        assembly("memory-safe") { ok := call(40000,recipient,amount,0,0,0,0) }
        if(ok) { emit Paid(id,recipient,amount); return 0; }
        emit PaymentRedirected(id,recipient,amount); return amount;
    }
}
