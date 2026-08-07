// 用法：node scratch/check-pwd.js <明文密码> <bcrypt哈希>
// admin 密码是随机生成的，无法写死，需手动传入。
const bcrypt = require('bcryptjs');
const [password, hash] = process.argv.slice(2);

if (!password || !hash) {
  console.error('用法：node scratch/check-pwd.js <明文密码> <bcrypt哈希>');
  process.exit(1);
}

console.log('Match:', bcrypt.compareSync(password, hash));
