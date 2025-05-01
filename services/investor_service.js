const { LongTermHolding } = require('../models/long_term_holding');
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

/**
 * Service class for handling investor-related operations
 */
class InvestorService {
  constructor() {
    this.cachedInvestors = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 60 * 60 * 1000; // 1 hour in milliseconds
  }

  /**
   * Get the top 30 investors based on defined criteria
   * @param {boolean} forceRefresh - Force a cache refresh
   * @returns {Promise<Array>} Array of top investors with their metrics
   */
  async getTopInvestors(forceRefresh = false) {
    try {
      // Return cached results if valid and not forcing refresh
      if (!forceRefresh && this.isCacheValid()) {
        console.log('Returning cached top investors data');
        return this.cachedInvestors;
      }

      // Using raw query for optimal performance with the specified criteria
      const query = `
        SELECT 
            clientName,
            COUNT(*) AS profitableTrades,
            AVG(gainLossPercentage) AS averageGainPercentage,
            MAX(gainLossPercentage) AS highestGainPercentage
        FROM 
            long_term_holdings
        WHERE 
            status = 'CLOSED'
            AND gainLossPercentage > 0
        GROUP BY 
            clientName
        HAVING 
            COUNT(*) >= 3
        ORDER BY 
            profitableTrades DESC
        LIMIT 30;
      `;

      console.log('Calculating top investors...');
      const topInvestors = await sequelize.query(query, { 
        type: QueryTypes.SELECT,
        raw: true 
      });

      // Format the results for better readability
      const formattedInvestors = topInvestors.map(investor => ({
        clientName: investor.clientName,
        profitableTrades: parseInt(investor.profitableTrades || 0),
        averageGainPercentage: parseFloat(investor.averageGainPercentage || 0).toFixed(2),
        highestGainPercentage: parseFloat(investor.highestGainPercentage || 0).toFixed(2)
      }));

      // Update cache
      this.cachedInvestors = formattedInvestors;
      this.cacheTimestamp = Date.now();
      console.log('Top investors cache updated');

      return formattedInvestors;
    } catch (error) {
      console.error('Error getting top investors:', error);
      throw error;
    }
  }

  /**
   * Check if the cache is still valid
   * @returns {boolean} True if cache is valid, false otherwise
   */
  isCacheValid() {
    return (
      this.cachedInvestors !== null &&
      this.cacheTimestamp !== null &&
      Date.now() - this.cacheTimestamp < this.cacheTTL
    );
  }

  /**
   * Invalidate the current cache
   */
  invalidateCache() {
    this.cachedInvestors = null;
    this.cacheTimestamp = null;
    console.log('Top investors cache invalidated');
  }

  /**
   * Add index to improve query performance for top investors
   * This should be called during application initialization
   */
  async createIndex() {
    try {
      // Check if indexes exist before creating them
      const [indexes] = await sequelize.query(`
        SHOW INDEX FROM long_term_holdings
      `);
      
      const existingIndexes = indexes.map(idx => idx.Key_name);
      
      // Add index on status for faster filtering (if not exists)
      if (!existingIndexes.includes('idx_status')) {
        await sequelize.query(`
          CREATE INDEX idx_status 
          ON long_term_holdings (status)
        `);
      }
      
      // Add index on clientName for faster grouping (if not exists)
      if (!existingIndexes.includes('idx_client_name')) {
        await sequelize.query(`
          CREATE INDEX idx_client_name 
          ON long_term_holdings (clientName)
        `);
      }
      
      // Add index on gainLossPercentage for faster filtering (if not exists)
      if (!existingIndexes.includes('idx_gain_loss')) {
        await sequelize.query(`
          CREATE INDEX idx_gain_loss 
          ON long_term_holdings (gainLossPercentage)
        `);
      }
      
      // Add composite index on status and gainLossPercentage (if not exists)
      if (!existingIndexes.includes('idx_status_gain_loss')) {
        await sequelize.query(`
          CREATE INDEX idx_status_gain_loss 
          ON long_term_holdings (status, gainLossPercentage)
        `);
      }
      
      console.log('Indexes for top investors query created successfully');
    } catch (error) {
      console.error('Error creating indexes for top investors query:', error);
    }
  }
}

module.exports = new InvestorService(); 