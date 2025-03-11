const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Add a model to track initialization status
const InitializationStatus = sequelize.define('initialization_status', {
    isInitialized: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    initializedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    tableName: 'initialization_status',
    timestamps: true
});

const LongTermHolding = sequelize.define('long_term_holdings', {
    clientName: {
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
    initialBuyDate: {
        type: DataTypes.DATEONLY,
        allowNull: false
    },
    quantity: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    averageBuyPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    latestPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('HOLDING', 'CLOSED'),
        allowNull: false,
        defaultValue: 'HOLDING'
    },
    isLongTerm: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    gainLossPercentage: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0
    },
    holdingDuration: {
        type: DataTypes.INTEGER, // in days
        allowNull: false,
        defaultValue: 0
    },
    closedDate: {
        type: DataTypes.DATEONLY,
        allowNull: true
    },
    closedPrice: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
    }
}, {
    tableName: 'long_term_holdings',
    timestamps: true,
    indexes: [
        {
            fields: ['clientName', 'symbol', 'status']
        },
        {
            fields: ['initialBuyDate']
        },
        {
            fields: ['status']
        }
    ]
});

module.exports = { LongTermHolding, InitializationStatus }; 