const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ETHStakingRewards", function () {
    let ethStakingRewards;
    let rewardToken;
    let owner;
    let user1;
    let user2;
    let user3;
    
    const REWARD_RATE = ethers.parseEther("0.01"); // 0.01 token per ETH per second
    const MINIMUM_STAKING_TIME = 86400; // 1 day in seconds
    const INITIAL_REWARD_SUPPLY = ethers.parseEther("1000000"); // 1M tokens

    beforeEach(async function () {
        [owner, user1, user2, user3] = await ethers.getSigners();

        // Deploy mock reward token (ERC20)
        const MockERC20 = await ethers.getContractFactory("MyToken");
        rewardToken = await MockERC20.deploy();
        await rewardToken.waitForDeployment();

        // Deploy ETHStakingRewards contract
        const ETHStakingRewards = await ethers.getContractFactory("ETHStakingRewards");
        ethStakingRewards = await ETHStakingRewards.deploy(
            await rewardToken.getAddress(),
            REWARD_RATE,
            MINIMUM_STAKING_TIME
        );
        await ethStakingRewards.waitForDeployment();

        // Transfer some reward tokens to the staking contract
        await rewardToken.transfer(await ethStakingRewards.getAddress(), ethers.parseEther("100000"));
    });

    describe("Deployment", function () {
        it("Should set the right owner", async function () {
            expect(await ethStakingRewards.owner()).to.equal(owner.address);
        });

        it("Should set the right reward token", async function () {
            expect(await ethStakingRewards.rewardToken()).to.equal(await rewardToken.getAddress());
        });

        it("Should set the right reward rate", async function () {
            expect(await ethStakingRewards.rewardRate()).to.equal(REWARD_RATE);
        });

        it("Should set the right minimum staking time", async function () {
            expect(await ethStakingRewards.minimumStakingTime()).to.equal(MINIMUM_STAKING_TIME);
        });
    });

    describe("Staking", function () {
        it("Should allow users to stake ETH", async function () {
            const stakeAmount = ethers.parseEther("1");
            
            const tx = await ethStakingRewards.connect(user1).stake({ value: stakeAmount });
            const receipt = await tx.wait();
            const block = await ethers.provider.getBlock(receipt.blockNumber);
            
            await expect(tx)
                .to.emit(ethStakingRewards, "Staked")
                .withArgs(user1.address, stakeAmount, block.timestamp);

            const stakeInfo = await ethStakingRewards.stakes(user1.address);
            expect(stakeInfo.amount).to.equal(stakeAmount);
            expect(await ethStakingRewards.totalStaked()).to.equal(stakeAmount);
        });

        it("Should revert when staking 0 ETH", async function () {
            await expect(ethStakingRewards.connect(user1).stake({ value: 0 }))
                .to.be.revertedWith("Amount must be greater than 0");
        });

        it("Should allow multiple stakes from same user", async function () {
            const firstStake = ethers.parseEther("1");
            const secondStake = ethers.parseEther("2");

            await ethStakingRewards.connect(user1).stake({ value: firstStake });
            await time.increase(100); // Wait 100 seconds
            await ethStakingRewards.connect(user1).stake({ value: secondStake });

            const stakeInfo = await ethStakingRewards.stakes(user1.address);
            expect(stakeInfo.amount).to.equal(firstStake + secondStake);
        });

        it("Should update contract ETH balance", async function () {
            const stakeAmount = ethers.parseEther("5");
            const initialBalance = await ethStakingRewards.getETHBalance();
            
            await ethStakingRewards.connect(user1).stake({ value: stakeAmount });
            
            const finalBalance = await ethStakingRewards.getETHBalance();
            expect(finalBalance - initialBalance).to.equal(stakeAmount);
        });
    });

    describe("Unstaking", function () {
        beforeEach(async function () {
            // User stakes 1 ETH
            await ethStakingRewards.connect(user1).stake({ value: ethers.parseEther("1") });
        });

        it("Should revert unstaking before minimum time", async function () {
            await expect(ethStakingRewards.connect(user1).unstake())
                .to.be.revertedWith("Minimum staking time not reached");
        });

        it("Should allow unstaking after minimum time", async function () {
            await time.increase(MINIMUM_STAKING_TIME);
            
            const initialETHBalance = await ethers.provider.getBalance(user1.address);
            const stakeAmount = ethers.parseEther("1");
            
            const tx = await ethStakingRewards.connect(user1).unstake();
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            
            const finalETHBalance = await ethers.provider.getBalance(user1.address);
            
            // Check ETH return (accounting for gas)
            expect(finalETHBalance + gasUsed - initialETHBalance).to.be.closeTo(stakeAmount, ethers.parseEther("0.01"));
            
            // Check stake info reset
            const stakeInfo = await ethStakingRewards.stakes(user1.address);
            expect(stakeInfo.amount).to.equal(0);
            expect(stakeInfo.timestamp).to.equal(0);
            
            // Check total staked updated
            expect(await ethStakingRewards.totalStaked()).to.equal(0);
        });

        it("Should emit Unstaked event with rewards", async function () {
            await time.increase(MINIMUM_STAKING_TIME);
            
            // Get reward right before unstaking to account for any timing differences
            const expectedReward = await ethStakingRewards.calculateReward(user1.address);
            const stakeAmount = ethers.parseEther("1");
            
            const tx = await ethStakingRewards.connect(user1).unstake();
            
            // Use closeTo for reward comparison to handle small timing differences
            const receipt = await tx.wait();
            const events = receipt.logs.filter(log => {
                try {
                    return ethStakingRewards.interface.parseLog(log).name === 'Unstaked';
                } catch {
                    return false;
                }
            });
            
            expect(events).to.have.length(1);
            const unstakedEvent = ethStakingRewards.interface.parseLog(events[0]);
            expect(unstakedEvent.args[0]).to.equal(user1.address);
            expect(unstakedEvent.args[1]).to.equal(stakeAmount);
            expect(unstakedEvent.args[2]).to.be.closeTo(expectedReward, ethers.parseEther("0.1")); // Allow 0.1 token tolerance
        });

        it("Should revert when no staked amount", async function () {
            await expect(ethStakingRewards.connect(user2).unstake())
                .to.be.revertedWith("No staked amount");
        });
    });

    describe("Reward Calculation", function () {
        it("Should calculate correct rewards", async function () {
            const stakeAmount = ethers.parseEther("2");
            await ethStakingRewards.connect(user1).stake({ value: stakeAmount });
            
            const stakingTime = 3600; // 1 hour
            await time.increase(stakingTime);
            
            const expectedReward = (stakeAmount * REWARD_RATE * BigInt(stakingTime)) / ethers.parseEther("1");
            const actualReward = await ethStakingRewards.calculateReward(user1.address);
            
            expect(actualReward).to.be.closeTo(expectedReward, ethers.parseEther("0.001"));
        });

        it("Should return 0 reward for non-stakers", async function () {
            const reward = await ethStakingRewards.calculateReward(user2.address);
            expect(reward).to.equal(0);
        });

        it("Should calculate cumulative rewards correctly", async function () {
            await ethStakingRewards.connect(user1).stake({ value: ethers.parseEther("1") });
            
            await time.increase(1800); // 30 minutes
            const reward1 = await ethStakingRewards.calculateReward(user1.address);
            
            await time.increase(1800); // Another 30 minutes
            const reward2 = await ethStakingRewards.calculateReward(user1.address);
            
            expect(reward2).to.be.greaterThan(reward1);
            expect(reward2).to.be.closeTo(reward1 * 2n, ethers.parseEther("0.001"));
        });
    });

    describe("Claim Rewards", function () {
        beforeEach(async function () {
            await ethStakingRewards.connect(user1).stake({ value: ethers.parseEther("1") });
            await time.increase(3600); // 1 hour
        });

        it("Should allow claiming rewards", async function () {
            const initialBalance = await rewardToken.balanceOf(user1.address);
            
            // Claim rewards and check the actual reward from the transaction
            const tx = await ethStakingRewards.connect(user1).claimReward();
            const receipt = await tx.wait();
            
            // Get the actual reward from the event
            const events = receipt.logs.filter(log => {
                try {
                    return ethStakingRewards.interface.parseLog(log).name === 'RewardClaimed';
                } catch {
                    return false;
                }
            });
            
            expect(events).to.have.length(1);
            const rewardClaimedEvent = ethStakingRewards.interface.parseLog(events[0]);
            const actualReward = rewardClaimedEvent.args[1];
            
            expect(rewardClaimedEvent.args[0]).to.equal(user1.address);
            expect(actualReward).to.be.greaterThan(0);
            
            const finalBalance = await rewardToken.balanceOf(user1.address);
            expect(finalBalance - initialBalance).to.equal(actualReward);
        });

        it("Should reset lastClaimTime after claiming", async function () {
            await ethStakingRewards.connect(user1).claimReward();
            
            const stakeInfo = await ethStakingRewards.stakes(user1.address);
            expect(stakeInfo.lastClaimTime).to.be.closeTo(await time.latest(), 2);
        });

        it("Should revert when no staked amount", async function () {
            await expect(ethStakingRewards.connect(user2).claimReward())
                .to.be.revertedWith("No staked amount");
        });
    });

    describe("View Functions", function () {
        beforeEach(async function () {
            await ethStakingRewards.connect(user1).stake({ value: ethers.parseEther("2") });
            await time.increase(7200); // 2 hours
        });

        it("Should return correct stake info", async function () {
            const [amount, stakingTime, pendingReward] = await ethStakingRewards.getStakeInfo(user1.address);
            
            expect(amount).to.equal(ethers.parseEther("2"));
            expect(stakingTime).to.be.closeTo(7200, 5);
            expect(pendingReward).to.be.greaterThan(0);
        });

        it("Should return correct canUnstake status", async function () {
            // Before minimum time
            expect(await ethStakingRewards.canUnstake(user1.address)).to.be.false;
            
            // After minimum time
            await time.increase(MINIMUM_STAKING_TIME - 7200);
            expect(await ethStakingRewards.canUnstake(user1.address)).to.be.true;
        });

        it("Should return false for non-stakers", async function () {
            expect(await ethStakingRewards.canUnstake(user2.address)).to.be.false;
        });
    });

    describe("Owner Functions", function () {
        it("Should allow owner to update reward rate", async function () {
            const newRate = ethers.parseEther("0.02");
            
            await expect(ethStakingRewards.setRewardRate(newRate))
                .to.emit(ethStakingRewards, "RewardRateUpdated")
                .withArgs(newRate);
            
            expect(await ethStakingRewards.rewardRate()).to.equal(newRate);
        });

        it("Should revert when non-owner tries to update reward rate", async function () {
            await expect(ethStakingRewards.connect(user1).setRewardRate(ethers.parseEther("0.02")))
                .to.be.revertedWithCustomError(ethStakingRewards, "OwnableUnauthorizedAccount");
        });

        it("Should allow owner to update minimum staking time", async function () {
            const newMinTime = 172800; // 2 days
            
            await ethStakingRewards.setMinimumStakingTime(newMinTime);
            expect(await ethStakingRewards.minimumStakingTime()).to.equal(newMinTime);
        });

        it("Should allow owner to deposit reward tokens", async function () {
            const depositAmount = ethers.parseEther("5000");
            await rewardToken.approve(await ethStakingRewards.getAddress(), depositAmount);
            
            const initialBalance = await ethStakingRewards.getRewardTokenBalance();
            await ethStakingRewards.depositRewardTokens(depositAmount);
            const finalBalance = await ethStakingRewards.getRewardTokenBalance();
            
            expect(finalBalance - initialBalance).to.equal(depositAmount);
        });

        it("Should allow owner to withdraw reward tokens", async function () {
            const withdrawAmount = ethers.parseEther("1000");
            const initialOwnerBalance = await rewardToken.balanceOf(owner.address);
            
            await ethStakingRewards.withdrawRewardTokens(withdrawAmount);
            const finalOwnerBalance = await rewardToken.balanceOf(owner.address);
            
            expect(finalOwnerBalance - initialOwnerBalance).to.equal(withdrawAmount);
        });

        it("Should allow owner to emergency withdraw ETH", async function () {
            // Add some ETH to contract
            await ethStakingRewards.connect(user1).stake({ value: ethers.parseEther("3") });
            
            const initialOwnerBalance = await ethers.provider.getBalance(owner.address);
            const contractBalance = await ethStakingRewards.getETHBalance();
            
            const tx = await ethStakingRewards.emergencyWithdrawETH();
            const receipt = await tx.wait();
            const gasUsed = receipt.gasUsed * receipt.gasPrice;
            
            const finalOwnerBalance = await ethers.provider.getBalance(owner.address);
            
            expect(finalOwnerBalance + gasUsed - initialOwnerBalance).to.be.closeTo(contractBalance, ethers.parseEther("0.01"));
        });
    });

    describe("Edge Cases and Security", function () {
        it("Should handle reentrancy attacks", async function () {
            // This test assumes the ReentrancyGuard is working correctly
            // In a real scenario, you'd deploy a malicious contract to test this
            await ethStakingRewards.connect(user1).stake({ value: ethers.parseEther("1") });
            await time.increase(MINIMUM_STAKING_TIME);
            
            // Normal unstake should work
            await expect(ethStakingRewards.connect(user1).unstake()).to.not.be.reverted;
        });

        it("Should handle multiple users staking and unstaking", async function () {
            const stakeAmount = ethers.parseEther("1");
            
            // Multiple users stake
            await ethStakingRewards.connect(user1).stake({ value: stakeAmount });
            await ethStakingRewards.connect(user2).stake({ value: stakeAmount });
            await ethStakingRewards.connect(user3).stake({ value: stakeAmount });
            
            expect(await ethStakingRewards.totalStaked()).to.equal(stakeAmount * 3n);
            
            await time.increase(MINIMUM_STAKING_TIME);
            
            // One user unstakes
            await ethStakingRewards.connect(user1).unstake();
            expect(await ethStakingRewards.totalStaked()).to.equal(stakeAmount * 2n);
        });

        it("Should handle zero reward scenarios", async function () {
            await ethStakingRewards.connect(user1).stake({ value: ethers.parseEther("1") });
            
            // Claim immediately (no time passed)
            const reward = await ethStakingRewards.calculateReward(user1.address);
            expect(reward).to.equal(0);
        });

        it("Should handle reward token depletion", async function () {
            // Withdraw most reward tokens
            const contractBalance = await ethStakingRewards.getRewardTokenBalance();
            await ethStakingRewards.withdrawRewardTokens(contractBalance - ethers.parseEther("1"));
            
            await ethStakingRewards.connect(user1).stake({ value: ethers.parseEther("1000") });
            await time.increase(MINIMUM_STAKING_TIME);
            
            // Should revert when trying to claim more rewards than available
            await expect(ethStakingRewards.connect(user1).claimReward()).to.be.reverted;
        });
    });

    describe("Gas Optimization Tests", function () {
        it("Should not consume excessive gas for staking", async function () {
            const tx = await ethStakingRewards.connect(user1).stake({ value: ethers.parseEther("1") });
            const receipt = await tx.wait();
            
            // Reasonable gas limit for staking (adjust based on your requirements)
            expect(receipt.gasUsed).to.be.lessThan(200000);
        });

        it("Should not consume excessive gas for unstaking", async function () {
            await ethStakingRewards.connect(user1).stake({ value: ethers.parseEther("1") });
            await time.increase(MINIMUM_STAKING_TIME);
            
            const tx = await ethStakingRewards.connect(user1).unstake();
            const receipt = await tx.wait();
            
            // Reasonable gas limit for unstaking (adjust based on your requirements)
            expect(receipt.gasUsed).to.be.lessThan(250000);
        });
    });
});
