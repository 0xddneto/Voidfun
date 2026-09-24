// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {DeedRuntime} from "./DeedRuntime.sol";
import {DeedTypes, IDeedRegistry, IPriceOracle} from "./DeedTypes.sol";

contract RuntimeFactory is ReentrancyGuard {
    IDeedRegistry public immutable registry;
    IPriceOracle public immutable oracle;
    address payable public immutable treasury;
    mapping(uint256 => address) public runtimeOf;
    address[] private runtimes;
    error InvalidAddress();
    event RuntimeCreated(uint256 indexed deedId, address indexed runtime);

    constructor(IDeedRegistry registry_, IPriceOracle oracle_, address payable treasury_) {
        if (address(registry_).code.length == 0 || address(oracle_).code.length == 0 || treasury_ == address(0)) revert InvalidAddress();
        registry = registry_;
        oracle = oracle_;
        treasury = treasury_;
    }

    function create(uint256 id) external nonReentrant returns (address) { return _runtime(id); }
    function publish(uint256 id, address implementation, bytes calldata initialization, bytes32 salt)
        external nonReentrant returns (address gateway) {
        return DeedRuntime(_runtime(id)).publishFor(msg.sender, implementation, initialization, salt);
    }

    function _runtime(uint256 id) private returns (address runtime) {
        DeedTypes.validate(registry.stateOf(id));
        runtime = runtimeOf[id];
        if (runtime != address(0)) return runtime;
        runtime = address(new DeedRuntime{salt: bytes32(id)}(id, registry, oracle, treasury));
        runtimeOf[id] = runtime;
        runtimes.push(runtime);
        emit RuntimeCreated(id, runtime);
    }

    function runtimeCount() external view returns (uint256) { return runtimes.length; }
    function runtimeAt(uint256 index) external view returns (address) { return runtimes[index]; }
}
