// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Control addresses are immutable bytecode values, never app-writable storage.
contract Gateway {
    address public immutable runtime;
    address public immutable implementation;
    uint256 public immutable deedId;
    error RuntimeOnly();
    error SelfOnly();
    error InvalidImplementation();
    error QueryFailed();

    constructor(uint256 id, address target, bytes memory initialization) {
        if (target.code.length == 0) revert InvalidImplementation();
        runtime = msg.sender;
        implementation = target;
        deedId = id;
        if (initialization.length > 0) {
            (bool success, bytes memory reason) = target.delegatecall(initialization);
            if (!success) assembly ("memory-safe") { revert(add(reason, 32), mload(reason)) }
        }
    }

    function execute(bytes calldata data) external payable {
        if (msg.sender != runtime) revert RuntimeOnly();
        address target = implementation;
        // Do not copy arbitrary application returndata into Runtime memory.
        assembly ("memory-safe") {
            let pointer := mload(0x40)
            calldatacopy(pointer, data.offset, data.length)
            let success := delegatecall(gas(), target, pointer, data.length, 0, 0)
            if iszero(success) { revert(0, 0) }
        }
    }

    function query(bytes calldata data) external view returns (bytes memory) {
        (bool success, bytes memory result) = address(this).staticcall(abi.encodeCall(this.read, (data)));
        if (!success) revert QueryFailed();
        return abi.decode(result, (bytes));
    }

    function read(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(this)) revert SelfOnly();
        (bool success, bytes memory result) = implementation.delegatecall(data);
        if (!success) revert QueryFailed();
        return result;
    }
}
