// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
contract AppGateway {
    address public immutable runtime;
    address public immutable implementation;
    uint256 public immutable deedId;
    constructor(address runtime_, uint256 deedId_, address implementation_, bytes memory init) payable {
        require(msg.sender == runtime_ && implementation_.code.length > 0, "IMPLEMENTATION");
        runtime = runtime_; deedId = deedId_; implementation = implementation_;
        if(init.length > 0) { (bool ok,bytes memory result) = implementation_.delegatecall(init); if(!ok) assembly("memory-safe") { revert(add(result,32), mload(result)) } }
    }
    function execute(bytes calldata data) external payable returns(bytes memory result) {
        require(msg.sender == runtime, "RUNTIME_ONLY");
        (bool ok,bytes memory output) = implementation.delegatecall(data);
        if(!ok) assembly("memory-safe") { revert(add(output,32), mload(output)) }
        return output;
    }
    function query(bytes calldata data) external view returns(bytes memory) {
        (bool ok,bytes memory result) = address(this).staticcall(abi.encodeCall(this.readInternal,(data)));
        require(ok, "QUERY_FAILED"); return abi.decode(result,(bytes));
    }
    function readInternal(bytes calldata data) external returns(bytes memory) {
        require(msg.sender == address(this), "SELF_ONLY");
        (bool ok,bytes memory result) = implementation.delegatecall(data); require(ok, "QUERY_FAILED"); return result;
    }
}
