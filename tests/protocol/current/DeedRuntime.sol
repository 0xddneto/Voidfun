// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DeedTypes, IDeedRegistry, IPriceOracle} from "./DeedTypes.sol";
import {Gateway} from "./Gateway.sol";

contract DeedRuntime is ReentrancyGuard {
    struct Application { address publisher; address implementation; uint64 publishedBlock; bool registered; }
    struct Execution { address app; bytes data; uint256 revision; uint256 maxToll; uint256 appValue; uint256 appGas; uint256 deadline; }
    IDeedRegistry public immutable registry;
    IPriceOracle public immutable oracle;
    address payable public immutable treasury;
    address public immutable factory;
    uint256 public immutable deedId;
    uint256 public constant PROTOCOL_BPS = 1000;
    mapping(address => Application) public applications;
    mapping(bytes32 => bool) public usedSalts;
    address[] private gateways;
    uint256 public totalTolls;
    uint256 public ownerPaid;
    uint256 public treasuryPaid;
    uint256 public executions;
    address public executingUser;
    address public executingApp;

    error Unauthorized();
    error UnknownApp();
    error MissingCode();
    error AppNotReady();
    error SaltUsed();
    error InvalidExecution();
    error ConfigurationChanged();
    error PaymentMismatch();
    error InsufficientGas();
    error ApplicationFailed();
    error TreasuryPaymentFailed();

    event Published(uint256 indexed deedId, address indexed gateway, address indexed publisher, address implementation);
    event Removed(address indexed gateway);
    event Executed(uint256 indexed deedId, address indexed gateway, address indexed user, uint256 toll, uint256 revision);
    event Paid(uint256 indexed deedId, address indexed recipient, uint256 amount);
    event Redirected(uint256 indexed deedId, address indexed rejectedRecipient, uint256 amount);
    event TreasuryPaid(uint256 indexed deedId, uint256 amount);

    constructor(uint256 id, IDeedRegistry registry_, IPriceOracle oracle_, address payable treasury_) {
        if (address(registry_).code.length == 0 || address(oracle_).code.length == 0 || treasury_ == address(0)) revert Unauthorized();
        deedId = id;
        registry = registry_;
        oracle = oracle_;
        treasury = treasury_;
        factory = msg.sender;
    }

    function publish(address implementation, bytes calldata initialization, bytes32 salt) external nonReentrant returns (address) {
        return _publish(msg.sender, implementation, initialization, salt);
    }

    function publishFor(address publisher, address implementation, bytes calldata initialization, bytes32 salt)
        external nonReentrant returns (address) {
        if (msg.sender != factory) revert Unauthorized();
        return _publish(publisher, implementation, initialization, salt);
    }

    function _publish(address publisher, address implementation, bytes calldata initialization, bytes32 salt) private returns (address gateway) {
        DeedTypes.validate(registry.stateOf(deedId));
        if (implementation.code.length == 0) revert MissingCode();
        if (initialization.length > 16384) revert InvalidExecution();
        bytes32 key = keccak256(abi.encode(publisher, salt));
        if (usedSalts[key]) revert SaltUsed();
        usedSalts[key] = true;
        gateway = address(new Gateway{salt: key}(deedId, implementation, initialization));
        if (gateway.code.length == 0) revert MissingCode();
        applications[gateway] = Application(publisher, implementation, uint64(block.number), true);
        gateways.push(gateway);
        emit Published(deedId, gateway, publisher, implementation);
    }

    function remove(address gateway) external nonReentrant {
        Application storage app = applications[gateway];
        if (app.publisher != msg.sender) revert Unauthorized();
        if (!app.registered) revert UnknownApp();
        app.registered = false;
        emit Removed(gateway);
    }

    function appCount() external view returns (uint256) { return gateways.length; }
    function appAt(uint256 index) external view returns (address) { return gateways[index]; }
    function quote() external view returns (uint256 toll, uint256 revision) {
        DeedTypes.State memory state = registry.stateOf(deedId);
        DeedTypes.validate(state);
        return (oracle.quote(state.tollUsd), state.revision);
    }

    function execute(Execution calldata request) external payable nonReentrant {
        Application memory app = applications[request.app];
        if (!app.registered) revert UnknownApp();
        if (request.app.code.length == 0 || app.implementation.code.length == 0) revert MissingCode();
        if (block.number <= app.publishedBlock) revert AppNotReady();
        if (block.timestamp > request.deadline || request.data.length > 16384 ||
            request.appGas < 50000 || request.appGas > 2_000_000) revert InvalidExecution();
        DeedTypes.State memory state = registry.stateOf(deedId);
        DeedTypes.validate(state);
        if (request.revision != state.revision) revert ConfigurationChanged();
        uint256 toll = oracle.quote(state.tollUsd);
        if (toll > request.maxToll || msg.value != toll + request.appValue) revert PaymentMismatch();
        bytes memory payload = abi.encodeCall(Gateway.execute, (request.data));
        uint256 appGas = request.appGas;
        address target = request.app;
        uint256 value = request.appValue;
        if (gasleft() <= appGas * 64 / 63 + 800_000) revert InsufficientGas();
        executingUser = msg.sender;
        executingApp = target;
        bool success;
        assembly ("memory-safe") { success := call(appGas, target, value, add(payload, 32), mload(payload), 0, 0) }
        if (!success) revert ApplicationFailed();
        executingUser = address(0);
        executingApp = address(0);

        uint256 protocol = Math.mulDiv(toll, PROTOCOL_BPS, 10000);
        uint256 share = toll - protocol;
        uint256 redirected;
        if (state.recipients.length == 0) redirected = _pay(state.owner, share);
        else {
            uint256 allocated;
            for (uint256 i; i < state.recipients.length; ++i) {
                uint256 amount = i + 1 == state.recipients.length ? share - allocated :
                    Math.mulDiv(share, state.recipients[i].bps, 10000);
                allocated += amount;
                redirected += _pay(state.recipients[i].wallet, amount);
            }
        }
        uint256 treasuryAmount = protocol + redirected;
        if (treasuryAmount > 0) {
            if (!_send(treasury, treasuryAmount)) revert TreasuryPaymentFailed();
            emit TreasuryPaid(deedId, treasuryAmount);
        }
        totalTolls += toll;
        ownerPaid += share - redirected;
        treasuryPaid += treasuryAmount;
        ++executions;
        emit Executed(deedId, target, msg.sender, toll, state.revision);
    }

    function _pay(address recipient, uint256 amount) private returns (uint256) {
        if (amount == 0) return 0;
        if (_send(recipient, amount)) { emit Paid(deedId, recipient, amount); return 0; }
        emit Redirected(deedId, recipient, amount);
        return amount;
    }

    function _send(address recipient, uint256 amount) private returns (bool success) {
        assembly ("memory-safe") { success := call(40000, recipient, amount, 0, 0, 0, 0) }
    }
}
