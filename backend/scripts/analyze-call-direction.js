require('dotenv').config({ path: '../.env' });
const mongoose = require('mongoose');
const CallLog = require('../models/CallLog');
const User = require('../models/User');

async function analyzeCallDirection() {
  try {
    console.log('🔍 Analyzing Call Direction Data Structure...');
    console.log('================================================\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get a sample user with call logs
    const user = await User.findOne({ exotelNumbers: { $exists: true, $ne: [] } });
    if (!user) {
      console.log('❌ No user found with Exotel numbers');
      return;
    }

    console.log(`👤 Analyzing user: ${user.email || user._id}`);
    console.log(`📞 User's Exotel numbers: ${JSON.stringify(user.exotelNumbers)}\n`);

    // Get sample call logs for this user
    const callLogs = await CallLog.find({ userId: user._id })
      .limit(10)
      .sort({ createdAt: -1 })
      .lean();

    if (callLogs.length === 0) {
      console.log('❌ No call logs found for this user');
      return;
    }

    console.log(`📊 Found ${callLogs.length} call logs. Analyzing structure...\n`);

    // Analyze each call log
    callLogs.forEach((log, index) => {
      console.log(`📞 CALL ${index + 1}:`);
      console.log(`   ID: ${log._id}`);
      console.log(`   Source: ${log.source}`);
      console.log(`   Phone Number: ${log.phoneNumber}`);
      console.log(`   To Number: ${log.toNumber}`);
      console.log(`   Normalized Source: ${log.normalizedSource}`);
      console.log(`   Normalized Phone Number: ${log.normalizedPhoneNumber}`);
      console.log(`   Call Request ID: ${JSON.stringify(log.call_request_id)}`);
      console.log(`   Bot Name: ${log.bot_name}`);
      console.log(`   Agent Used: ${log.agentUsed}`);
      console.log(`   Status: ${log.status}`);
      console.log(`   Duration: ${log.duration}`);
      console.log(`   Created At: ${log.createdAt}`);

      // Analyze direction based on user's Exotel numbers
      const userNumbers = user.exotelNumbers;
      const isSourceUserNumber = userNumbers.includes(log.source);
      const isPhoneNumberUserNumber = userNumbers.includes(log.phoneNumber);
      const isToNumberUserNumber = userNumbers.includes(log.toNumber);

      console.log(`   \n   🔍 DIRECTION ANALYSIS:`);
      console.log(`   User's number in source: ${isSourceUserNumber}`);
      console.log(`   User's number in phoneNumber: ${isPhoneNumberUserNumber}`);
      console.log(`   User's number in toNumber: ${isToNumberUserNumber}`);

      // Determine call direction
      let direction = 'UNKNOWN';
      let explanation = '';

      if (isSourceUserNumber && !isToNumberUserNumber) {
        direction = 'OUTGOING';
        explanation = 'User\'s number is source, calling external number';
      } else if (!isSourceUserNumber && isToNumberUserNumber) {
        direction = 'INCOMING';
        explanation = 'External number calling user\'s number';
      } else if (isSourceUserNumber && isToNumberUserNumber) {
        direction = 'INTERNAL';
        explanation = 'Call between user\'s own numbers';
      } else if (isPhoneNumberUserNumber) {
        direction = 'RELATED';
        explanation = 'User\'s number appears in phoneNumber field';
      } else {
        direction = 'UNRELATED';
        explanation = 'User\'s number not found in expected fields';
      }

      console.log(`   📍 DIRECTION: ${direction}`);
      console.log(`   📝 EXPLANATION: ${explanation}`);
      console.log(`   ----------------------------------------\n`);
    });

    // Summary analysis
    console.log('\n📈 SUMMARY ANALYSIS:');
    console.log('====================');

    const directionCounts = {
      OUTGOING: 0,
      INCOMING: 0,
      INTERNAL: 0,
      RELATED: 0,
      UNRELATED: 0
    };

    callLogs.forEach(log => {
      const userNumbers = user.exotelNumbers;
      const isSourceUserNumber = userNumbers.includes(log.source);
      const isPhoneNumberUserNumber = userNumbers.includes(log.phoneNumber);
      const isToNumberUserNumber = userNumbers.includes(log.toNumber);

      if (isSourceUserNumber && !isToNumberUserNumber) {
        directionCounts.OUTGOING++;
      } else if (!isSourceUserNumber && isToNumberUserNumber) {
        directionCounts.INCOMING++;
      } else if (isSourceUserNumber && isToNumberUserNumber) {
        directionCounts.INTERNAL++;
      } else if (isPhoneNumberUserNumber) {
        directionCounts.RELATED++;
      } else {
        directionCounts.UNRELATED++;
      }
    });

    Object.entries(directionCounts).forEach(([direction, count]) => {
      console.log(`${direction}: ${count} calls`);
    });

    // Field usage analysis
    console.log('\n🔍 FIELD USAGE ANALYSIS:');
    console.log('========================');

    const fieldStats = {
      hasSource: 0,
      hasPhoneNumber: 0,
      hasToNumber: 0,
      hasNormalizedSource: 0,
      hasNormalizedPhoneNumber: 0,
      hasCallRequestId: 0,
      hasBotName: 0,
      hasAgentUsed: 0
    };

    callLogs.forEach(log => {
      if (log.source) fieldStats.hasSource++;
      if (log.phoneNumber) fieldStats.hasPhoneNumber++;
      if (log.toNumber) fieldStats.hasToNumber++;
      if (log.normalizedSource) fieldStats.hasNormalizedSource++;
      if (log.normalizedPhoneNumber) fieldStats.hasNormalizedPhoneNumber++;
      if (log.call_request_id) fieldStats.hasCallRequestId++;
      if (log.bot_name) fieldStats.hasBotName++;
      if (log.agentUsed) fieldStats.hasAgentUsed++;
    });

    Object.entries(fieldStats).forEach(([field, count]) => {
      const percentage = ((count / callLogs.length) * 100).toFixed(1);
      console.log(`${field}: ${count}/${callLogs.length} (${percentage}%)`);
    });

    // Recommendations
    console.log('\n💡 RECOMMENDATIONS:');
    console.log('===================');
    
    if (directionCounts.OUTGOING > 0) {
      console.log('✅ OUTGOING calls detected: source = user\'s number, toNumber = external');
    }
    
    if (directionCounts.INCOMING > 0) {
      console.log('✅ INCOMING calls detected: source = external, toNumber = user\'s number');
    }
    
    if (directionCounts.RELATED > 0) {
      console.log('⚠️  RELATED calls detected: user\'s number in phoneNumber field - need to analyze context');
    }
    
    if (directionCounts.UNRELATED > 0) {
      console.log('❌ UNRELATED calls detected: user\'s number not in expected fields - check filtering logic');
    }

    console.log('\n🎯 SUGGESTED LOGIC:');
    console.log('==================');
    console.log('OUTGOING: source IN userNumbers AND toNumber NOT IN userNumbers');
    console.log('INCOMING: source NOT IN userNumbers AND toNumber IN userNumbers');
    console.log('INTERNAL: source IN userNumbers AND toNumber IN userNumbers');

  } catch (error) {
    console.error('❌ Error analyzing call direction:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from MongoDB');
  }
}

// Run the analysis
analyzeCallDirection().catch(console.error);
