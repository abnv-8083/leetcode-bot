const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const axios = require('axios');

// ⚠️ IMPORTANT: Replace this with your exact WhatsApp group name
const TARGET_GROUP_NAME = 'Daily Leetcode';

// Initialize the WhatsApp Client with AWS-optimized settings
const client = new Client({
    authStrategy: new LocalAuth(),
    authTimeoutMs: 120000, // 2 minutes to handle slow loading
    webVersionCache: { type: 'none' }, // Prevents WhatsApp from reloading the page and destroying the execution context
    puppeteer: {
        headless: true,
        protocolTimeout: 0, // Disable timeout to avoid "Runtime.callFunctionOn timed out" on slow AWS instances
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Critical for AWS t2/t3 instances (1GB RAM)
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    }
});

// Generate and display the QR code in the terminal
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code above with your WhatsApp app to log in.');
});

// Let us know the scan worked while we wait for the background sync
client.on('authenticated', () => {
    console.log('📱 QR Scanned! Authentication successful. Syncing chats now... (Please wait)');
});

client.on('auth_failure', msg => {
    console.error('❌ Authentication failure:', msg);
});

client.on('disconnected', (reason) => {
    console.error('❌ Client was logged out or disconnected:', reason);
});

// The main loop once the bot is fully logged in and synced
client.on('ready', async () => {
    console.log('✅ WhatsApp Client is ready!');

    // Fetch all chats to find your specific group
    const chats = await client.getChats();
    const myGroup = chats.find((chat) => chat.isGroup && chat.name === TARGET_GROUP_NAME);

    if (!myGroup) {
        console.error(`❌ Could not find a group named "${TARGET_GROUP_NAME}". Make sure the name matches exactly.`);
        return;
    }
    console.log(`✅ Found group: ${myGroup.name}`);

    // Reusable function to fetch and send the question
    const sendDailyQuestion = async () => {
        console.log('Fetching daily LeetCode question...');
        const questionMessage = await fetchDailyLeetCode();
        
        if (questionMessage) {
            await client.sendMessage(myGroup.id._serialized, questionMessage);
            console.log('✅ Daily question sent to group!');
        } else {
            console.log('❌ Failed to fetch the daily question.');
        }
    };

    // Schedule the task - Currently set to run at 8:00 AM every day
    // The format is: minute hour dayOfMonth month dayOfWeek
    cron.schedule('0 8 * * *', sendDailyQuestion, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Force it to run at 8 AM IST (Indian Standard Time), ignoring the AWS UTC server time
    });
    
    console.log('⏳ Bot is now running and waiting for the scheduled time...');

    // Send the question immediately for today
    console.log('🚀 Sending today\'s question immediately upon startup...');
    await sendDailyQuestion();
});

// Function to get the daily question from LeetCode's GraphQL API
async function fetchDailyLeetCode() {
    try {
        const query = `
            query {
              activeDailyCodingChallengeQuestion {
                date
                link
                question {
                  title
                  difficulty
                }
              }
            }
        `;

        const response = await axios.post('https://leetcode.com/graphql', { query });
        const data = response.data.data.activeDailyCodingChallengeQuestion;

        const date = data.date;
        const title = data.question.title;
        const difficulty = data.question.difficulty;
        const link = `https://leetcode.com${data.link}`;

        // Format the message for WhatsApp
        return `🎯 *LeetCode Daily Challenge* (${date})\n\n*Question:* ${title}\n*Difficulty:* ${difficulty}\n*Link:* ${link}\n\nGood luck everyone! 🚀`;
    } catch (error) {
        console.error('❌ Error fetching LeetCode data:', error.message);
        return null;
    }
}

// Start the client
client.initialize();

// --- Graceful Shutdown Logic ---
// This safely closes the hidden browser to prevent memory leaks if you stop the script
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down bot... Closing browser safely.');
    await client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down bot... Closing browser safely.');
    await client.destroy();
    process.exit(0);
});

process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});