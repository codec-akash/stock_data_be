const investorService = require('./investor_service');
const sequelize = require('../config/database');
const { QueryTypes } = require('sequelize');

// Mock the sequelize query function
jest.mock('../config/database', () => ({
  query: jest.fn()
}));

describe('InvestorService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getTopInvestors', () => {
    it('should return formatted top investors data', async () => {
      // Mock data returned from the database
      const mockInvestors = [
        {
          clientName: 'Investor 1',
          profitableTrades: 7,
          averageGainPercentage: '12.50',
          highestGainPercentage: '25.75'
        },
        {
          clientName: 'Investor 2',
          profitableTrades: 5,
          averageGainPercentage: '8.75',
          highestGainPercentage: '18.30'
        }
      ];

      // Setup the mock implementation
      sequelize.query.mockResolvedValue([mockInvestors, null]);

      // Call the method
      const result = await investorService.getTopInvestors();

      // Assert on the result
      expect(result).toHaveLength(2);
      expect(result[0].clientName).toBe('Investor 1');
      expect(result[0].profitableTrades).toBe(7);
      expect(result[0].averageGainPercentage).toBe('12.50');
      expect(result[0].highestGainPercentage).toBe('25.75');
      
      // Verify the query was called with the correct parameters
      expect(sequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        { type: QueryTypes.SELECT, raw: true }
      );
    });

    it('should handle errors gracefully', async () => {
      // Setup the mock to throw an error
      const mockError = new Error('Database error');
      sequelize.query.mockRejectedValue(mockError);

      // Call the method and expect it to throw
      await expect(investorService.getTopInvestors()).rejects.toThrow(mockError);
    });
  });

  describe('createIndex', () => {
    it('should create necessary indexes', async () => {
      // Mock the show indexes query
      sequelize.query.mockResolvedValueOnce([[], null]); // No existing indexes
      
      // Mock the create index queries
      sequelize.query.mockResolvedValue([[], null]);

      // Call the method
      await investorService.createIndex();

      // Verify the queries were called correctly
      expect(sequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('SHOW INDEX FROM long_term_holdings')
      );
      
      // Should try to create all 4 indexes
      expect(sequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX idx_status')
      );
      expect(sequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX idx_client_name')
      );
      expect(sequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX idx_gain_loss')
      );
      expect(sequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX idx_status_gain_loss')
      );
    });
    
    it('should skip indexes that already exist', async () => {
      // Mock existing indexes
      sequelize.query.mockResolvedValueOnce([[
        { Key_name: 'idx_status' },
        { Key_name: 'idx_client_name' }
      ], null]);
      
      // Mock the create index queries
      sequelize.query.mockResolvedValue([[], null]);

      // Call the method
      await investorService.createIndex();

      // Should only create the two missing indexes
      expect(sequelize.query).not.toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX idx_status')
      );
      expect(sequelize.query).not.toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX idx_client_name')
      );
      expect(sequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX idx_gain_loss')
      );
      expect(sequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('CREATE INDEX idx_status_gain_loss')
      );
    });

    it('should handle errors gracefully', async () => {
      // Setup the mock to throw an error
      const mockError = new Error('Database error');
      sequelize.query.mockRejectedValue(mockError);

      // Call the method (should not throw)
      await investorService.createIndex();

      // Verify the method caught the error
      expect(sequelize.query).toHaveBeenCalled();
    });
  });
}); 