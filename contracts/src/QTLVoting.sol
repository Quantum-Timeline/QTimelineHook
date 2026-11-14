// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice One-token-one-vote escrow for choosing the next preconfigured market threshold.
contract QTLVoting is ReentrancyGuard {
    using SafeERC20 for IERC20;
    error Unauthorized(); error InvalidElection(); error ElectionNotOpen(); error AlreadyVoted(); error NothingToWithdraw();

    struct Election {
        bytes32 candidateA;
        bytes32 candidateB;
        uint64 depositStart;
        uint64 voteStart;
        uint64 voteEnd;
        uint64 withdrawAfter;
        uint256 totalEscrow;
        uint256 votesA;
        uint256 votesB;
        uint8 winner;
        bool finalized;
    }

    address public immutable deployer;
    IERC20 public qtl;
    bool public tokenBound;
    uint256 public nextElectionId;
    mapping(uint256 => Election) public elections;
    mapping(uint256 => mapping(address => uint256)) public escrowed;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event TokenBound(address indexed token);
    event ElectionConfigured(uint256 indexed electionId, bytes32 candidateA, bytes32 candidateB, uint64 depositStart, uint64 voteStart, uint64 voteEnd);
    event Deposited(uint256 indexed electionId, address indexed voter, uint256 amount);
    event Withdrawn(uint256 indexed electionId, address indexed voter, uint256 amount);
    event Voted(uint256 indexed electionId, address indexed voter, uint8 choice, uint256 weight);
    event ElectionFinalized(uint256 indexed electionId, uint8 winner, uint256 votesA, uint256 votesB);

    constructor(address deployer_) {
        require(deployer_ != address(0), "zero deployer");
        deployer = deployer_;
    }

    function bindToken(address token) external {
        if (msg.sender != deployer) revert Unauthorized();
        if (tokenBound || token == address(0)) revert InvalidElection();
        qtl = IERC20(token);
        tokenBound = true;
        emit TokenBound(token);
    }

    function configureElection(bytes32 candidateA, bytes32 candidateB, uint64 depositStart, uint64 voteStart, uint64 voteEnd, uint64 withdrawAfter) external returns (uint256 id) {
        if (msg.sender != deployer) revert Unauthorized();
        if (!tokenBound || candidateA == bytes32(0) || candidateB == bytes32(0) || candidateA == candidateB) revert InvalidElection();
        if (!(block.timestamp <= depositStart && depositStart < voteStart && voteStart < voteEnd && voteEnd <= withdrawAfter)) revert InvalidElection();
        if (nextElectionId > 0) {
            Election storage prev = elections[nextElectionId - 1];
            if (!prev.finalized && block.timestamp < prev.withdrawAfter) revert InvalidElection();
        }
        id = nextElectionId++;
        elections[id] = Election(candidateA, candidateB, depositStart, voteStart, voteEnd, withdrawAfter, 0, 0, 0, 0, false);
        emit ElectionConfigured(id, candidateA, candidateB, depositStart, voteStart, voteEnd);
    }

    function deposit(uint256 id, uint256 amount) external nonReentrant {
        Election storage e = elections[id];
        if (id >= nextElectionId || block.timestamp < e.depositStart || block.timestamp >= e.voteStart || amount == 0) revert ElectionNotOpen();
        uint256 beforeBalance = qtl.balanceOf(address(this));
        qtl.safeTransferFrom(msg.sender, address(this), amount);
        if (qtl.balanceOf(address(this)) - beforeBalance != amount) revert InvalidElection();
        escrowed[id][msg.sender] += amount;
        e.totalEscrow += amount;
        emit Deposited(id, msg.sender, amount);
    }

    function withdraw(uint256 id) external nonReentrant {
        Election storage e = elections[id];
        if (id >= nextElectionId || (block.timestamp >= e.voteStart && block.timestamp < e.voteEnd)) revert ElectionNotOpen();
        uint256 amount = escrowed[id][msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        escrowed[id][msg.sender] = 0;
        qtl.safeTransfer(msg.sender, amount);
        emit Withdrawn(id, msg.sender, amount);
    }

    function vote(uint256 id, uint8 choice) external {
        Election storage e = elections[id];
        if (id >= nextElectionId || block.timestamp < e.voteStart || block.timestamp >= e.voteEnd || choice > 1) revert ElectionNotOpen();
        if (hasVoted[id][msg.sender]) revert AlreadyVoted();
        uint256 weight = escrowed[id][msg.sender];
        if (weight == 0) revert InvalidElection();
        hasVoted[id][msg.sender] = true;
        if (choice == 0) e.votesA += weight; else e.votesB += weight;
        emit Voted(id, msg.sender, choice, weight);
    }

    function finalizeElection(uint256 id) external {
        Election storage e = elections[id];
        if (id >= nextElectionId || e.finalized || block.timestamp < e.voteEnd) revert ElectionNotOpen();
        e.winner = e.votesA > e.votesB ? 0 : 1; // candidate B is the announced tie/empty default
        e.finalized = true;
        emit ElectionFinalized(id, e.winner, e.votesA, e.votesB);
    }
}
