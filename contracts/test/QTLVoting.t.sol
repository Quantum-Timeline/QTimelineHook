// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {QTLVoting} from "../src/QTLVoting.sol";

interface VmVote { function warp(uint256) external; function prank(address) external; }
contract MockQTL is ERC20 { constructor() ERC20("QTL", "QTL") {} function mint(address to, uint256 amount) external { _mint(to, amount); } }

contract QTLVotingTest {
    VmVote private constant vm = VmVote(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockQTL private token;
    QTLVoting private voting;
    address private alice = address(0xA11CE);
    address private bob = address(0xB0B);

    function setUp() public {
        token = new MockQTL();
        voting = new QTLVoting(address(this));
        voting.bindToken(address(token));
        token.mint(alice, 10 ether);
        token.mint(bob, 10 ether);
        vm.prank(alice); token.approve(address(voting), type(uint256).max);
        vm.prank(bob); token.approve(address(voting), type(uint256).max);
    }

    function _election() private returns (uint256) {
        vm.warp(100);
        return voting.configureElection(keccak256("0.2"), keccak256("0.3"), 110, 120, 130, 130);
    }

    function testEscrowSnapshotVotesAndReturnsDepositsAfterClose() public {
        uint256 id = _election();
        vm.warp(110);
        vm.prank(alice); voting.deposit(id, 5 ether);
        vm.prank(bob); voting.deposit(id, 3 ether);
        vm.warp(120);
        vm.prank(alice); voting.vote(id, 0);
        vm.prank(bob); voting.vote(id, 1);
        vm.warp(130);
        voting.finalizeElection(id);
        (, , , , , , , uint256 votesA, uint256 votesB, uint8 winner, bool finalized) = voting.elections(id);
        require(votesA == 5 ether && votesB == 3 ether && winner == 0 && finalized, "wrong election result");
        vm.prank(alice); voting.withdraw(id);
        vm.prank(bob); voting.withdraw(id);
        require(token.balanceOf(alice) == 10 ether && token.balanceOf(bob) == 10 ether, "escrow not returned");
    }

    function testEmptyElectionDefaultsToCandidateB() public {
        uint256 id = _election();
        vm.warp(130);
        voting.finalizeElection(id);
        (, , , , , , , , , uint8 winner, bool finalized) = voting.elections(id);
        require(finalized && winner == 1, "candidate B default missing");
    }

    function testCannotDepositAfterSnapshotOrVoteTwice() public {
        uint256 id = _election();
        vm.warp(110);
        vm.prank(alice); voting.deposit(id, 1 ether);
        vm.warp(120);
        (bool lateDeposit,) = address(voting).call(abi.encodeCall(voting.deposit, (id, 1 ether)));
        require(!lateDeposit, "late deposit accepted");
        vm.prank(alice); voting.vote(id, 0);
        vm.prank(alice);
        (bool secondVote,) = address(voting).call(abi.encodeCall(voting.vote, (id, 1)));
        require(!secondVote, "second vote accepted");
    }
}
