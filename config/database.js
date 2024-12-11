const Sequelize = require('sequelize');
require('dotenv').config();


const sequelize = new Sequelize('Stocks', process.env.USER_NAME, process.env.DB_PASSWORD, {
    host: 'localhost',
    dialect: 'mysql'
});

module.exports = sequelize;