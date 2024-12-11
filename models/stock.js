const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Stock = sequelize.define('stocks', {
    date: {
        type: DataTypes.STRING,
        allowNull: false
    },
    symbol: {
        type: DataTypes.STRING,
        allowNull: false
    },
    securityName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    clientName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    buyOrSell: {
        type: DataTypes.STRING,
        allowNull: false
    },
    quantityTraded: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    tradePrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    remarks: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    tableName: 'stocks',
    timestamps: true
});

module.exports = Stock; 