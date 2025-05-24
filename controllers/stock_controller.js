const fs = require('fs');
const csv = require('csv-parser');
const Stock = require('../models/stock');
const { LongTermHolding, InitializationStatus } = require('../models/long_term_holding');
const sequelize = require('../config/database');
const { Op } = require('sequelize');
const e = require('express');
const express = require('express');
const app = express();
const investorService = require('../services/investor_service');

// Add these configurations before routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({
    extended: true,
    limit: '10mb'
}));

// Increase timeout
app.use((req, res, next) => {
    req.setTimeout(300000); // 5 minutes
    res.setTimeout(300000);
    next();
});

const validateSortField = (field) => {
    const allowedFields = ['date', 'symbol', 'securityName', 'clientName', 'tradeType', 'quantityTraded', 'tradePrice'];
    return allowedFields.includes(field) ? field : 'date';
};

const validateDateFormat = (dateString) => {
    const date = new Date(dateString);
    if (date instanceof Date && !isNaN(date)) {
        // Convert to IST (UTC+5:30)
        date.setMinutes(date.getMinutes() + 330);
        return date;
    }
    return null;
};

async function updateLongTermHoldings(transaction, newStocks) {
    // Group stocks by date for processing
    const stocksByDate = newStocks.reduce((acc, stock) => {
        const date = stock.date;
        if (!acc[date]) {
            acc[date] = [];
        }
        acc[date].push(stock);
        return acc;
    }, {});

    // Track if any long-term holding was closed or modified
    let holdingsChanged = false;

    // Process each date in chronological order
    const dates = Object.keys(stocksByDate).sort();
    
    for (const date of dates) {
        const dayStocks = stocksByDate[date];
        
        // Group same-day transactions by client and symbol
        const sameDayTrades = {};
        
        // Process all transactions for the day
        for (const stock of dayStocks) {
            const key = `${stock.clientName}-${stock.symbol}`;
            if (!sameDayTrades[key]) {
                sameDayTrades[key] = {
                    buys: [],
                    sells: []
                };
            }
            
            if (stock.tradeType.toLowerCase() === 'buy') {
                sameDayTrades[key].buys.push(stock);
            } else {
                sameDayTrades[key].sells.push(stock);
            }
        }

        // Process each client-symbol pair
        for (const [key, trades] of Object.entries(sameDayTrades)) {
            const [clientName, symbol] = key.split('-');
            
            // Skip if both buy and sell on same day (short-term trade)
            if (trades.buys.length > 0 && trades.sells.length > 0) {
                continue;
            }

            // Process buys
            if (trades.buys.length > 0) {
                const totalQuantity = trades.buys.reduce((sum, trade) => sum + trade.quantityTraded, 0);
                const averagePrice = trades.buys.reduce((sum, trade) => 
                    sum + (trade.quantityTraded * trade.tradePrice), 0) / totalQuantity;

                // Find or create holding
                let holding = await LongTermHolding.findOne({
                    where: {
                        clientName,
                        symbol,
                        status: 'HOLDING'
                    },
                    transaction
                });

                if (holding) {
                    // Update existing holding
                    const newTotalQuantity = holding.quantity + totalQuantity;
                    const newAveragePrice = ((holding.quantity * holding.averageBuyPrice) + 
                        (totalQuantity * averagePrice)) / newTotalQuantity;
                    
                    await holding.update({
                        quantity: newTotalQuantity,
                        averageBuyPrice: newAveragePrice,
                        latestPrice: trades.buys[0].tradePrice,
                        gainLossPercentage: ((trades.buys[0].tradePrice - newAveragePrice) / newAveragePrice) * 100,
                        holdingDuration: Math.floor((new Date(date) - new Date(holding.initialBuyDate)) / (1000 * 60 * 60 * 24)),
                        isLongTerm: Math.floor((new Date(date) - new Date(holding.initialBuyDate)) / (1000 * 60 * 60 * 24)) > 3
                    }, { transaction });
                } else {
                    // Create new holding
                    await LongTermHolding.create({
                        clientName,
                        symbol,
                        securityName: trades.buys[0].securityName,
                        initialBuyDate: date,
                        quantity: totalQuantity,
                        averageBuyPrice: averagePrice,
                        latestPrice: trades.buys[0].tradePrice,
                        gainLossPercentage: 0,
                        holdingDuration: 0,
                        status: 'HOLDING'
                    }, { transaction });
                }

                // Check if this is a long-term holding update
                const holdingDuration = Math.floor((new Date(date) - new Date(holding?.initialBuyDate || date)) / (1000 * 60 * 60 * 24));
                const isLongTerm = holdingDuration > 3;
                
                if (isLongTerm) {
                    holdingsChanged = true;
                }
            }

            // Process sells
            if (trades.sells.length > 0) {
                const totalSellQuantity = trades.sells.reduce((sum, trade) => sum + trade.quantityTraded, 0);
                const averageSellPrice = trades.sells.reduce((sum, trade) => 
                    sum + (trade.quantityTraded * trade.tradePrice), 0) / totalSellQuantity;

                // Find holding
                const holding = await LongTermHolding.findOne({
                    where: {
                        clientName,
                        symbol,
                        status: 'HOLDING'
                    },
                    transaction
                });

                if (holding) {
                    if (holding.quantity <= totalSellQuantity) {
                        // Close position
                        await holding.update({
                            status: 'CLOSED',
                            closedDate: date,
                            closedPrice: averageSellPrice,
                            gainLossPercentage: ((averageSellPrice - holding.averageBuyPrice) / holding.averageBuyPrice) * 100,
                            holdingDuration: Math.floor((new Date(date) - new Date(holding.initialBuyDate)) / (1000 * 60 * 60 * 24))
                        }, { transaction });
                    } else {
                        // Reduce position
                        await holding.update({
                            quantity: holding.quantity - totalSellQuantity,
                            latestPrice: trades.sells[0].tradePrice,
                            gainLossPercentage: ((trades.sells[0].tradePrice - holding.averageBuyPrice) / holding.averageBuyPrice) * 100
                        }, { transaction });
                    }

                    // If we're closing or updating a long-term holding, flag for recalculation
                    if (holding?.isLongTerm) {
                        holdingsChanged = true;
                    }
                }
            }
        }
    }

    // If any long-term holdings were changed, invalidate cache
    if (holdingsChanged) {
        try {
            // Invalidate the cache first
            investorService.invalidateCache();
            
            // Then trigger a recalculation (async, non-blocking)
            setTimeout(() => {
                investorService.getTopInvestors(true).catch(err => {
                    console.error('Error recalculating top investors:', err);
                });
            }, 0);
        } catch (error) {
            console.error('Error triggering top investors recalculation:', error);
        }
    }
}

exports.uploadCSV = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const results = [];
        const duplicates = [];
        let processedCount = 0;

        // First, process CSV file and collect all data
        await new Promise((resolve, reject) => {
            fs.createReadStream(req.file.path)
                .pipe(csv({
                    mapHeaders: ({ header }) => {
                        return header?.trim().replace(/\n/g, '') || '';
                    },
                    skipLines: 0,
                    strict: true,
                    trim: true
                }))
                .on('data', (data) => {
                    processedCount++;
                    const isEmptyRow = Object.values(data).every(value =>
                        !value || value.toString().trim() === '');

                    if (isEmptyRow) {
                        console.log('Skipping empty row');
                        return;
                    }

                    // Standardize keys
                    findAndMapKey(data, 'DATE', 'date');
                    findAndMapKey(data, 'Symbol', 'symbol');
                    findAndMapKey(data, 'Security Name', 'security_name');
                    findAndMapKey(data, 'Client Name', 'client_name');
                    findAndMapKey(data, 'Buy', 'buy_sell');
                    findAndMapKey(data, 'Quantity', 'quantity_traded');
                    findAndMapKey(data, 'Trade Price', 'trade_price');
                    findAndMapKey(data, 'Remarks', 'remarks');

                    // Parse date properly
                    let parsedDate;
                    try {
                        parsedDate = new Date(data.date);
                        // Convert to IST (UTC+5:30)
                        parsedDate.setMinutes(parsedDate.getMinutes() + 330);
                        if (isNaN(parsedDate.getTime())) {
                            // Try parsing DD-MMM-YYYY format
                            const [day, month, year] = data.date.split('-');
                            parsedDate = new Date(`${month} ${day}, ${year}`);
                        }
                    } catch (error) {
                        console.error('Date parsing error:', error);
                        return;
                    }

                    const transformedData = {
                        date: parsedDate.toISOString().split('T')[0],
                        symbol: data.symbol?.trim(),
                        securityName: data.security_name?.trim(),
                        clientName: data.client_name?.trim(),
                        tradeType: data.buy_sell?.trim(),
                        quantityTraded: parseInt((data.quantity_traded || '').replace(/,/g, '')),
                        tradePrice: parseFloat((data.trade_price || '').replace(/,/g, '')),
                        remarks: data.remarks?.trim()
                    };

                    if (transformedData.symbol && transformedData.securityName &&
                        transformedData.clientName && transformedData.tradeType &&
                        !isNaN(transformedData.quantityTraded) &&
                        !isNaN(transformedData.tradePrice) &&
                        transformedData.date) {
                        results.push(transformedData);
                    } else {
                        console.log('Skipping row with missing or invalid fields:', transformedData);
                    }
                })
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`Total rows processed: ${processedCount}`);
        console.log(`Valid rows collected: ${results.length}`);

        // Then, process the collected data with transaction
        const transaction = await sequelize.transaction();
        try {
            // First get all existing records
            const allExistingRecords = await Stock.findAll({
                attributes: ['date', 'symbol', 'clientName', 'tradeType', 'quantityTraded', 'tradePrice'],
                raw: true,
                transaction
            });

            console.log('Total existing records:', allExistingRecords.length);

            // Create a Set of existing record keys for faster lookup
            const existingSet = new Set();
            allExistingRecords.forEach(record => {
                const key = `${record.date}-${record.symbol}-${record.clientName}-${record.tradeType}-${record.quantityTraded}-${record.tradePrice}`;
                existingSet.add(key);
            });

            console.log('Unique keys in database:', existingSet.size);

            // Debug: Log a few existing keys
            console.log('Sample existing keys:', Array.from(existingSet).slice(0, 5));

            // Filter out duplicates from results
            const uniqueResults = [];
            const seenKeys = new Set(); // Track keys within current batch

            results.forEach(data => {
                const key = `${data.date}-${data.symbol}-${data.clientName}-${data.tradeType}-${data.quantityTraded}-${data.tradePrice}`;

                // Debug log for sample records
                if (results.indexOf(data) < 5) {
                    console.log('Processing record:', {
                        key,
                        existsInDB: existingSet.has(key),
                        existsInBatch: seenKeys.has(key),
                        data
                    });
                }

                if (existingSet.has(key)) {
                    duplicates.push({
                        ...data,
                        reason: 'Duplicate entry found in database'
                    });
                } else if (seenKeys.has(key)) {
                    duplicates.push({
                        ...data,
                        reason: 'Duplicate entry in current batch'
                    });
                } else {
                    uniqueResults.push(data);
                    seenKeys.add(key);
                }
            });

            console.log('Unique keys in current batch:', seenKeys.size);
            console.log('Unique records to insert:', uniqueResults.length);
            console.log('Duplicates found:', duplicates.length);

            // Add detailed counts in response
            const duplicatesByReason = duplicates.reduce((acc, curr) => {
                acc[curr.reason] = (acc[curr.reason] || 0) + 1;
                return acc;
            }, {});

            // Bulk insert only non-duplicate data
            if (uniqueResults.length > 0) {
                const chunkSize = 1000;
                for (let i = 0; i < uniqueResults.length; i += chunkSize) {
                    const chunk = uniqueResults.slice(i, i + chunkSize);
                    await Stock.bulkCreate(chunk, {
                        transaction,
                        validate: true
                    });
                    console.log(`Inserted ${i + chunk.length} of ${uniqueResults.length} records`);
                }
            }

            // After successful stock insert, update long-term holdings
            await updateLongTermHoldings(transaction, uniqueResults);

            await transaction.commit();
            fs.unlinkSync(req.file.path);

            res.status(200).json({
                message: 'CSV file successfully processed',
                recordsImported: uniqueResults.length,
                duplicatesSkipped: duplicates.length,
                duplicatesByReason,
                totalProcessed: processedCount,
                databaseStats: {
                    existingRecordsCount: allExistingRecords.length,
                    uniqueKeysInDB: existingSet.size
                },
                sampleData: {
                    existingRecords: allExistingRecords.slice(0, 3),
                    duplicates: duplicates.slice(0, 3),
                    uniqueResults: uniqueResults.slice(0, 3)
                }
            });

        } catch (error) {
            await transaction.rollback();
            throw error;
        }

    } catch (error) {
        console.error('Error:', error);

        // Delete the uploaded file if it exists
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        res.status(500).json({
            error: 'Error processing CSV file',
            details: error.message
        });
    }
};

function findAndMapKey(obj, searchText, standardKey) {
    const key = Object.keys(obj).find(key =>
        key.toLowerCase().includes(searchText.toLowerCase())
    );
    if (key) {
        // Create new key with standard name and copy value
        obj[standardKey] = obj[key];
        // Delete old key
        delete obj[key];
    }
    return standardKey;
}

exports.getStocks = async (req, res) => {
    try {
        // Pagination params
        const page = parseInt(req.query.page) || 1;

        // Sorting params for items within the same date
        const innerSortField = validateSortField(req.query.sortBy) || 'symbol';
        const innerSortOrder = req.query.sortOrder?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        // Filtering params
        const filters = {};
        const validFilters = {
            symbol: req.query.symbol,
            clientName: req.query.clientName,
            tradeType: req.query.tradeType,
            securityName: req.query.securityName
        };

        // Build filter conditions
        Object.entries(validFilters).forEach(([key, value]) => {
            if (value) {
                filters[key] = sequelize.where(
                    sequelize.fn('LOWER', sequelize.col(key)),
                    'LIKE',
                    `%${value.toLowerCase()}%`
                );
            }
        });

        // First, get all unique dates in descending order
        const uniqueDates = await Stock.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('date')), 'date']],
            order: [['date', 'DESC']],
            raw: true
        });

        const totalPages = uniqueDates.length;
        
        // If no data found
        if (totalPages === 0) {
            return res.status(200).json({
                currentPage: page,
                totalPages: 0,
                totalItems: 0,
                itemsPerPage: 0,
                data: [],
                hasNextPage: false,
                hasPreviousPage: false,
                currentDate: null
            });
        }

        // Get the date for the requested page
        const pageIndex = page - 1;
        if (pageIndex >= totalPages) {
            return res.status(400).json({
                error: 'Page number exceeds available dates'
            });
        }

        const currentDate = uniqueDates[pageIndex].date;

        // Get all stocks for the current date with filters
        const { count, rows } = await Stock.findAndCountAll({
            where: {
                ...filters,
                date: currentDate
            },
            order: [[innerSortField, innerSortOrder]],
        });

        res.status(200).json({
            currentPage: page,
            totalPages: totalPages,
            totalItems: count,
            itemsPerPage: count, // All items for the current date
            data: rows,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
            currentDate: currentDate,
            sortBy: innerSortField,
            sortOrder: innerSortOrder,
            appliedFilters: Object.entries(validFilters)
                .filter(([_, value]) => value !== undefined)
                .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {})
        });

    } catch (error) {
        console.error('Error fetching stocks:', error);
        res.status(500).json({
            error: 'Error fetching stocks',
            details: error.message
        });
    }
};

exports.getFilters = async (req, res) => {
    try {
        // Get unique stock symbols and security names
        const stocks = await Stock.findAll({
            attributes: ['symbol', 'securityName'],
            group: ['symbol', 'securityName']
        });

        // Get unique client names
        const uniqueClientNames = await Stock.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('clientName')), 'clientName']]
        });

        // Get unique trade types
        const uniqueTradeTypes = await Stock.findAll({
            attributes: [[sequelize.fn('DISTINCT', sequelize.col('tradeType')), 'tradeType']]
        });

        res.status(200).json({
            clientName: uniqueClientNames.map(client => client.clientName),
            stocks: stocks.map(stock => ({
                symbol: stock.symbol,
                securityName: stock.securityName
            })),
            tradeType: uniqueTradeTypes.map(type => type.tradeType)
        });
    } catch (error) {
        console.error('Error fetching filters:', error);
        res.status(500).json({
            error: 'Error fetching filters',
            details: error.message
        });
    }
};

exports.getLongTermHoldings = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const itemsPerPage = 25;
        const profitType = req.query.profitType;

        // Get the latest prices for all symbols
        const latestPricesQuery = `
            SELECT s1.symbol, s1.tradePrice as latest_price
            FROM stocks s1
            INNER JOIN (
                SELECT symbol, MAX(date) as max_date
                FROM stocks
                GROUP BY symbol
            ) s2 ON s1.symbol = s2.symbol AND s1.date = s2.max_date
        `;
        const [latestPrices] = await sequelize.query(latestPricesQuery);
        const latestPriceMap = new Map(latestPrices.map(row => [row.symbol, row.latest_price]));

        // Get current holdings
        const whereClause = {
            status: 'HOLDING'
        };

        // Get all current holdings
        let holdings = await LongTermHolding.findAll({
            where: whereClause,
            raw: true
        });

        // Calculate current gain/loss for all holdings
        holdings = holdings.map(holding => {
            const latestPrice = latestPriceMap.get(holding.symbol) || 0;
            const gainLossPercentage = ((latestPrice - holding.averageBuyPrice) / holding.averageBuyPrice * 100);
            const today = new Date();
            const initialBuyDate = new Date(holding.initialBuyDate);
            const holdingDuration = Math.floor((today - initialBuyDate) / (1000 * 60 * 60 * 24));
            
            return {
                ...holding,
                latestPrice: latestPrice,
                gainLossPercentage: gainLossPercentage,
                holdingDuration: holdingDuration
            };
        });

        // Apply profit type filter if specified
        if (profitType) {
            holdings = holdings.filter(holding => 
                profitType === 'positive' ? holding.gainLossPercentage >= 0 : holding.gainLossPercentage < 0
            );
        }

        // Apply sorting based on the presence of profitType
        if (profitType) {
            // Sort by profit/loss percentage (highest first)
            holdings.sort((a, b) => b.gainLossPercentage - a.gainLossPercentage);
        } else {
            // Sort by date (most recent first)
            holdings.sort((a, b) => {
                const dateA = new Date(a.initialBuyDate);
                const dateB = new Date(b.initialBuyDate);
                return dateB - dateA; // Descending order (newest first)
            });
        }

        // Get total count after filtering
        const totalItems = holdings.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage);

        // Apply pagination
        holdings = holdings.slice((page - 1) * itemsPerPage, page * itemsPerPage);

        // Format numbers
        holdings = holdings.map(holding => ({
            ...holding,
            gainLossPercentage: holding.gainLossPercentage.toFixed(2),
            averageBuyPrice: Number(holding.averageBuyPrice).toFixed(2),
            latestPrice: Number(holding.latestPrice).toFixed(2)
        }));

        res.json({
            success: true,
            currentPage: page,
            totalPages: totalPages,
            totalItems: totalItems,
            itemsPerPage: itemsPerPage,
            data: holdings,
            hasNextPage: page < totalPages,
            hasPreviousPage: page > 1,
            appliedFilters: {
                profitType
            }
        });
    } catch (error) {
        console.error('Error in getLongTermHoldings:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve long-term holdings',
            details: error.message
        });
    }
};

// Add new endpoint to initialize long-term holdings
exports.initializeLongTermHoldings = async (req, res) => {
    const transaction = await sequelize.transaction();
    try {
        // Check if already initialized
        const initStatus = await InitializationStatus.findOne({
            where: { isInitialized: true }
        });

        if (initStatus) {
            return res.status(400).json({
                error: 'Long-term holdings already initialized',
                initializedAt: initStatus.initializedAt
            });
        }

        // First, clear existing long-term holdings (just in case)
        await LongTermHolding.destroy({
            where: {},
            transaction
        });

        // Get all stocks up to yesterday (to avoid processing today's data)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];

        const stocks = await Stock.findAll({
            where: {
                date: {
                    [Op.lte]: yesterdayStr
                }
            },
            order: [['date', 'ASC']],
            raw: true,
            transaction
        });

        // Process them using the existing updateLongTermHoldings function
        await updateLongTermHoldings(transaction, stocks);

        // Mark as initialized
        await InitializationStatus.create({
            isInitialized: true,
            initializedAt: new Date()
        }, { transaction });

        await transaction.commit();

        res.status(200).json({
            message: 'Long-term holdings initialized successfully',
            processedCount: stocks.length,
            initializedAt: new Date()
        });
    } catch (error) {
        await transaction.rollback();
        console.error('Error initializing long-term holdings:', error);
        res.status(500).json({
            error: 'Error initializing long-term holdings',
            details: error.message
        });
    }
};

// Add this new controller method
exports.getTopInvestors = async (req, res) => {
    try {
        const topInvestors = await investorService.getTopInvestors();
        
        return res.status(200).json({
            message: 'Top investors retrieved successfully',
            data: topInvestors
        });
    } catch (error) {
        console.error('Error retrieving top investors:', error);
        return res.status(500).json({
            error: 'Failed to retrieve top investors',
            details: error.message
        });
    }
};

// Initialize indexes when server starts - call this in the initDatabase function
exports.initializeIndexes = async () => {
    try {
        await investorService.createIndex();
    } catch (error) {
        console.error('Error initializing indexes:', error);
    }
};

// Add a controller method to refresh top investors cache
exports.refreshTopInvestorsCache = async (req, res) => {
    try {
        // Force a refresh of the cache
        await investorService.getTopInvestors(true);
        
        return res.status(200).json({
            message: 'Top investors cache refreshed successfully'
        });
    } catch (error) {
        console.error('Error refreshing top investors cache:', error);
        return res.status(500).json({
            error: 'Failed to refresh top investors cache',
            details: error.message
        });
    }
};
