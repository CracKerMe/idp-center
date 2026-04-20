const bcrypt = require('bcryptjs');
const password = 'Admin@IdpCenter2024!';
const hash = '$2b$10$fOpTuAazRvN1Hh57op/5B.BbxnrnYIe7Te6XYd7ei4z/73JDUBuua';
console.log('Match:', bcrypt.compareSync(password, hash));
