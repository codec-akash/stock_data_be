const { LongTermHolding } = require('../models/long_term_holding');
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

// Cache for stock investors data
const stockInvestorsCache = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds

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

/**
 * Get all investors currently holding a specific stock
 */
const getInvestorsByStock = async (req, res) => {
    try {
        const stockName = req.query['stock-name'];

        if (!stockName) {
            return res.status(400).json({
                error: 'Missing required query parameter: stock-name'
            });
        }

        // Check cache first
        const cacheKey = stockName.toLowerCase();
        const cachedData = stockInvestorsCache.get(cacheKey);
        if (cachedData && (Date.now() - cachedData.timestamp < CACHE_TTL)) {
            return res.status(200).json({
                message: 'Investors retrieved successfully',
                data: cachedData.data
            });
        }

        // Query to get all investors holding the stock with their metrics
        const query = `
            WITH investor_metrics AS (
                SELECT 
                    lth.clientName,
                    COUNT(DISTINCT CASE WHEN lth.status = 'CLOSED' AND lth.gainLossPercentage > 0 THEN lth.id END) as profitableTrades,
                    AVG(CASE WHEN lth.status = 'CLOSED' THEN lth.gainLossPercentage ELSE NULL END) as averageGainPercentage,
                    MAX(CASE WHEN lth.status = 'CLOSED' THEN lth.gainLossPercentage ELSE NULL END) as highestGainPercentage,
                    SUM(CASE WHEN lth.status = 'HOLDING' AND (lth.symbol = :stockName OR lth.securityName = :stockName) THEN 1 ELSE 0 END) as isCurrentHolder
                FROM 
                    long_term_holdings lth
                GROUP BY 
                    lth.clientName
                HAVING 
                    isCurrentHolder > 0
            )
            SELECT 
                clientName,
                profitableTrades,
                COALESCE(averageGainPercentage, 0) as averageGainPercentage,
                COALESCE(highestGainPercentage, 0) as highestGainPercentage
            FROM 
                investor_metrics
            ORDER BY 
                profitableTrades DESC;
        `;

        const investors = await sequelize.query(query, {
            replacements: { stockName: stockName },
            type: QueryTypes.SELECT
        });

        // Format the results
        const formattedInvestors = investors.map(investor => ({
            clientName: investor.clientName,
            profitableTrades: parseInt(investor.profitableTrades || 0),
            averageGainPercentage: parseFloat(investor.averageGainPercentage || 0).toFixed(2),
            highestGainPercentage: parseFloat(investor.highestGainPercentage || 0).toFixed(2)
        }));

        // Update cache
        stockInvestorsCache.set(cacheKey, {
            timestamp: Date.now(),
            data: formattedInvestors
        });

        return res.status(200).json({
            message: 'Investors retrieved successfully',
            data: formattedInvestors
        });

    } catch (error) {
        console.error('Error getting investors by stock:', error);
        return res.status(500).json({
            error: 'Failed to retrieve investors',
            details: error.message
        });
    }
};

// Function to invalidate cache for a specific stock
exports.invalidateStockCache = (stockName) => {
    if (stockName) {
        stockInvestorsCache.delete(stockName.toLowerCase());
    }
};

module.exports = {
    getInvestorTrades,
    getInvestorsByStock
}; 