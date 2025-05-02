const { LongTermHolding } = require('../models/long_term_holding');
const { Op } = require('sequelize');

// Controller to get trades for a specific investor
const getInvestorTrades = async (req, res) => {
    try {
        const { clientName } = req.params;
        const { holding = 'all' } = req.query;
        
        let whereCondition = { clientName };
        
        // Filter by holding status if specified
        if (holding.toLowerCase() === 'open') {
            whereCondition.status = 'HOLDING';
        } else if (holding.toLowerCase() === 'closed') {
            whereCondition.status = 'CLOSED';
        }
        
        const trades = await LongTermHolding.findAll({
            where: whereCondition,
            order: [['initialBuyDate', 'DESC']]
        });
        
        // Calculate investor metrics
        const totalTrades = trades.length;
        const profitableTrades = trades.filter(trade => parseFloat(trade.gainLossPercentage) > 0).length;
        const lossTrades = trades.filter(trade => parseFloat(trade.gainLossPercentage) <= 0).length;
        
        // Calculate average profit/loss ratio
        let avgProfitLossRatio = 0;
        if (totalTrades > 0) {
            const totalGainLossPercentage = trades.reduce((sum, trade) => sum + parseFloat(trade.gainLossPercentage), 0);
            avgProfitLossRatio = totalGainLossPercentage / totalTrades;
        }
        
        res.json({
            success: true,
            count: trades.length,
            investorMetrics: {
                totalTrades,
                profitableTrades,
                lossTrades,
                avgProfitLossRatio: parseFloat(avgProfitLossRatio.toFixed(2))
            },
            data: trades
        });
    } catch (error) {
        console.error('Error fetching investor trades:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch investor trades',
            details: error.message
        });
    }
};

module.exports = {
    getInvestorTrades
}; 