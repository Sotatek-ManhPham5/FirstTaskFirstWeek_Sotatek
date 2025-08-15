const hre = require("hardhat");

async function main() {
  // Lấy contract factory
  const ETHStakingRewards = await hre.ethers.getContractFactory("ETHStakingRewards");

  // Các tham số cho constructor
  const rewardToken = "0x7187f070AdC0766bb3b44Fd8739c02f3aC5AD3c8"; // Địa chỉ ERC20 token
  const rewardRate = hre.ethers.parseUnits("1", 18);
  const minStakingTime = 60; 

  // Deploy contract
  const staking = await ETHStakingRewards.deploy(
    rewardToken,
    rewardRate,
    minStakingTime
  );

  await staking.waitForDeployment();

  console.log("ETHStakingRewards deployed to:", await staking.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
