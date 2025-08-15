// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";


/**
 * @title ETHStakingRewards
 * @dev Contract cho phép người dùng stake ETH và nhận phần thưởng token ERC20
 */
contract ETHStakingRewards is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Token thưởng ERC20
    IERC20 public rewardToken;
    
    // Thông tin staking của mỗi user
    struct StakeInfo {
        uint256 amount;        // Số ETH đã stake
        uint256 timestamp;     // Thời điểm bắt đầu stake
        uint256 lastClaimTime; // Lần cuối claim reward
    }
    
    // Mapping từ address -> thông tin stake
    mapping(address => StakeInfo) public stakes;
    
    // Thống kê tổng quan
    uint256 public totalStaked;           // Tổng ETH đã stake
    uint256 public rewardRate;            // Số token thưởng mỗi ETH mỗi giây
    uint256 public minimumStakingTime;    // Thời gian stake tối thiểu
    
    // Events
    event Staked(address indexed user, uint256 amount, uint256 timestamp);
    event Unstaked(address indexed user, uint256 amount, uint256 reward);
    event RewardClaimed(address indexed user, uint256 reward);
    event RewardRateUpdated(uint256 newRate);
    
    constructor(
        address _rewardToken,
        uint256 _rewardRate,
        uint256 _minimumStakingTime
    ) Ownable((msg.sender)) {
        rewardToken = IERC20(_rewardToken);
        rewardRate = _rewardRate;
        minimumStakingTime = _minimumStakingTime;
    }
    
    /**
     * @dev Stake ETH vào contract
     */
    function stake() external payable nonReentrant {
        require(msg.value > 0, "Amount must be greater than 0");
        
        StakeInfo storage userStake = stakes[msg.sender];
        
        // Nếu user đã có stake trước đó, claim reward trước
        if (userStake.amount > 0) {
            _claimReward();
        }
        
        // Cập nhật thông tin stake
        userStake.amount += msg.value;
        userStake.timestamp = block.timestamp;
        userStake.lastClaimTime = block.timestamp;
        
        totalStaked += msg.value;
        
        emit Staked(msg.sender, msg.value, block.timestamp);
    }
    
    /**
     * @dev Unstake ETH và claim reward
     */
    function unstake() external nonReentrant {
        StakeInfo storage userStake = stakes[msg.sender];
        require(userStake.amount > 0, "No staked amount");
        require(
            block.timestamp >= userStake.timestamp + minimumStakingTime,
            "Minimum staking time not reached"
        );
        
        uint256 stakedAmount = userStake.amount;
        uint256 reward = calculateReward(msg.sender);
        
        // Reset thông tin stake
        userStake.amount = 0;
        userStake.timestamp = 0;
        userStake.lastClaimTime = 0;
        
        totalStaked -= stakedAmount;
        
        // Trả ETH cho user
        payable(msg.sender).transfer(stakedAmount);
        
        // Trả reward token nếu có
        if (reward > 0) {
            rewardToken.safeTransfer(msg.sender, reward);
        }
        
        emit Unstaked(msg.sender, stakedAmount, reward);
    }
    
    /**
     * @dev Claim reward mà không unstake
     */
    function claimReward() external nonReentrant {
        require(stakes[msg.sender].amount > 0, "No staked amount");
        _claimReward();
    }
    
    /**
     * @dev Internal function để claim reward
     */
    function _claimReward() internal {
        uint256 reward = calculateReward(msg.sender);
        
        if (reward > 0) {
            stakes[msg.sender].lastClaimTime = block.timestamp;
            rewardToken.safeTransfer(msg.sender, reward);
            emit RewardClaimed(msg.sender, reward);
        }
    }
    
    /**
     * @dev Tính toán reward cho user
     * @param user Địa chỉ user
     * @return Số token reward
     */
    function calculateReward(address user) public view returns (uint256) {
        StakeInfo memory userStake = stakes[user];
        
        if (userStake.amount == 0) {
            return 0;
        }
        
        uint256 stakingDuration = block.timestamp - userStake.lastClaimTime;
        
        // Tính reward: amount * rewardRate * thời gian stake
        // rewardRate là số token per ETH per second
        uint256 reward = (userStake.amount * rewardRate * stakingDuration) / 1e18;
        
        return reward;
    }
    
    /**
     * @dev Lấy thông tin stake của user
     * @param user Địa chỉ user
     * @return amount Số ETH đã stake
     * @return stakingTime Thời gian đã stake (giây)
     * @return pendingReward Reward đang chờ claim
     */
    function getStakeInfo(address user) external view returns (
        uint256 amount,
        uint256 stakingTime,
        uint256 pendingReward
    ) {
        StakeInfo memory userStake = stakes[user];
        
        amount = userStake.amount;
        stakingTime = userStake.amount > 0 ? block.timestamp - userStake.timestamp : 0;
        pendingReward = calculateReward(user);
    }
    
    /**
     * @dev Kiểm tra user có thể unstake không
     * @param user Địa chỉ user
     * @return Có thể unstake hay không
     */
    function canUnstake(address user) external view returns (bool) {
        StakeInfo memory userStake = stakes[user];
        
        if (userStake.amount == 0) {
            return false;
        }
        
        return block.timestamp >= userStake.timestamp + minimumStakingTime;
    }
    
    // ===== OWNER FUNCTIONS =====
    
    /**
     * @dev Cập nhật reward rate (chỉ owner)
     * @param _newRate Reward rate mới
     */
    function setRewardRate(uint256 _newRate) external onlyOwner {
        rewardRate = _newRate;
        emit RewardRateUpdated(_newRate);
    }
    
    /**
     * @dev Cập nhật thời gian stake tối thiểu (chỉ owner)
     * @param _newMinimumTime Thời gian tối thiểu mới (giây)
     */
    function setMinimumStakingTime(uint256 _newMinimumTime) external onlyOwner {
        minimumStakingTime = _newMinimumTime;
    }
    
    /**
     * @dev Nạp reward token vào contract (chỉ owner)
     * @param amount Số token cần nạp
     */
    function depositRewardTokens(uint256 amount) external onlyOwner {
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
    }
    
    /**
     * @dev Rút reward token dư thừa (chỉ owner)
     * @param amount Số token cần rút
     */
    function withdrawRewardTokens(uint256 amount) external onlyOwner {
        rewardToken.safeTransfer(msg.sender, amount);
    }
    
    /**
     * @dev Emergency withdraw ETH (chỉ owner)
     * Chỉ sử dụng trong trường hợp khẩn cấp
     */
    function emergencyWithdrawETH() external onlyOwner {
        payable(owner()).transfer(address(this).balance);
    }
    
    /**
     * @dev Lấy số dư reward token trong contract
     * @return Số token có sẵn
     */
    function getRewardTokenBalance() external view returns (uint256) {
        return rewardToken.balanceOf(address(this));
    }
    
    /**
     * @dev Lấy số dư ETH trong contract
     * @return Số ETH có sẵn
     */
    function getETHBalance() external view returns (uint256) {
        return address(this).balance;
    }
    
    // Fallback function để nhận ETH
    receive() external payable {}
}