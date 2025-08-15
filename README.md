1. Smart Contract đơn giản là tạo ra một cái hợp đồng nơi mà người dùng có thể gửi rút coin vào trong đấy, hoặc dùng để  2 user có thể chuyển coin cho nhau qua hợp đồng này. Mỗi khi người dùng thao tác với ví trên blockchain sẽ là hành động transaction.
2. Khi người dùng tạo ra smart contract thì phải test cẩn thận khi deploy trên local hoặc viết test case đầy đủ để không bị lỗi, nếu mà người tạo hợp đồng này deploy lên trên blockchain thì sẽ không thể thay đổi được bất cứ thứ gì trong hợp đồng nữa.
3. Về code solidity: Đã hiểu cơ bản về cách tạo biến, định dạng của biến, mapping, pure, view, function, for, if...else, struct, event.
4.  - Về task được giao: Về cơ bản thì có thể hiểu được việc gửi/rút coin trong smart contract và mỗi khi rút sẽ căn cứ vào thời gian để nhận thêm token là khi chúng ta đi mua hàng của một siêu thị nào đấy sẽ được nhận thêm đồ được đi kèm với hàng đấy(mua mì được nhận thêm chai nước mắm trong thùng khi mua cả thùng).   
    - Về code thì sẽ gồm các function: stake(stake vào contract), unstake(rút coin ra khỏi contract, khi rút coin sẽ căn cứ vào thời gian gửi để nhận thêm token, sẽ có minimumStakingTime để tránh người dùng spam), claimReward(có thể nhận được token mà không phải unstake). Và một số function cho onwer như transfer, transferFrom của ERC20 trong thư viện openzepplin.
5. Đã hiểu được cách tạo project smart contract với hardhat: 
- npm init
- npm install --save-dev hardhat
- npx hardhat --init
- Cài thư viện openzepplin: npm install --save-dev @openzepplin/upgrade
- Tạo .env: npm install dotenv
- Lệnh test: npx hardhat test
- Lệnh deploy netword sepolia: npx hardhat run scripts/deploy.js --network sepolia