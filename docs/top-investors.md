# Top Investors Feature

This document describes the Top Investors feature that ranks investors based on their profitable closed long-term holdings.

## API Endpoints

### Get Top Investors
```
GET /api/stocks/top-investors
```

Returns the top 30 investors ranked by the number of profitable trades they have closed. Only includes investors with at least 3 profitable trades.

**Response Example:**
```json
{
  "message": "Top investors retrieved successfully",
  "data": [
    {
      "clientName": "Investor Name",
      "profitableTrades": 8,
      "averageGainPercentage": "15.75",
      "highestGainPercentage": "32.50"
    },
    // ... more investors
  ]
}
```

### Refresh Top Investors Cache
```
POST /api/stocks/top-investors/refresh
```

Manually forces a refresh of the top investors cache.

**Response Example:**
```json
{
  "message": "Top investors cache refreshed successfully"
}
```

## Ranking Criteria

Investors are ranked based on a single primary criterion:

**Number of Profitable Closed Trades**
- Count of trades where status = 'CLOSED' and gainLossPercentage > 0
- Only investors with at least 3 profitable trades are included
- Investors are sorted by the number of profitable trades in descending order

## Additional Data Returned

For each top investor, the API also returns:

1. **Average Gain Percentage**
   - Average of gainLossPercentage across their profitable closed trades

2. **Highest Gain Percentage**
   - Maximum gainLossPercentage value among their profitable closed trades

## Caching Mechanism

To improve performance and reduce database load:

- The top investors results are cached for 1 hour by default
- The cache is automatically invalidated when any long-term holding is updated or closed
- The cache can be manually refreshed using the refresh endpoint

## Database Optimizations

The following indexes are created to optimize query performance:

- `idx_status` - Index on status for faster filtering
- `idx_client_name` - Index on clientName for faster grouping
- `idx_gain_loss` - Index on gainLossPercentage for faster filtering
- `idx_status_gain_loss` - Composite index on (status, gainLossPercentage) for the specific query

These indexes are created during application initialization if they don't already exist. The application checks for existing indexes first to avoid duplicate creation.

## Implementation Details

- The feature uses a raw SQL query for optimal performance
- Results are cached in-memory with automatic invalidation
- All calculations happen on the server side to reduce client-side processing
- The list is limited to the top 30 investors to keep response times fast 