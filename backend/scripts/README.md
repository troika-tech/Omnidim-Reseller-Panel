# Backend Scripts

This directory contains utility scripts for the calling panel backend.

## fetch-campaign-for-call-request.js

Fetches campaign information for a specific call_request_id from Omnidimension API and local database.

**Note**: The script expects the ID value from the `call_request_id` object. For example, if your data structure is:
```javascript
call_request_id: {
  id: 232278,
  type_of_request: "Call"
}
```
You would use `232278` as the parameter.

### Usage

```bash
# Run with specific call_request_id.id value
node scripts/fetch-campaign-for-call-request.js 232278

# Run with default call_request_id.id (232278)
node scripts/fetch-campaign-for-call-request.js
```

### What it does

1. **Connects to MongoDB** using environment variables
2. **Fetches call data** from Omnidimension API using the call_request_id
3. **Searches local database** for matching campaigns using multiple strategies:
   - Exact match by omnidimensionCallId
   - Match by campaign ID from API response
   - Match by phone number
4. **Returns comprehensive results** including campaign ID, name, and source

### Environment Variables Required

Make sure your `.env` file contains:
- `MONGODB_URI` - MongoDB connection string
- `OMNIDIMENSION_BASE_URL` - Omnidimension API base URL
- `OMNIDIMENSION_API_KEY` - Omnidimension API key
- `OMNIDIMENSION_API_TIMEOUT` - API timeout (optional)

### Output

The script provides detailed logging and returns a JSON object with:
- `source` - Where the campaign was found (local_database, api_campaign_id, phone_number_match, not_found)
- `campaignId` - Omnidimension campaign ID
- `localCampaignId` - Local MongoDB campaign ID
- `campaignName` - Campaign name
- `callData` - Raw call data from API
- `totalMatches` - Number of matches found (for phone number searches)

### Example Output

```json
{
  "source": "local_database",
  "campaignId": "12345",
  "localCampaignId": "507f1f77bcf86cd799439011",
  "campaignName": "Test Campaign",
  "callData": {
    "id": "232278",
    "to_number": "+1234567890",
    "time_of_call": "2025-11-10T05:06:00Z"
  }
}
```
