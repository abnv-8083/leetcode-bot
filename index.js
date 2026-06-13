const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const axios = require('axios');

// Replace this with your exact WhatsApp group name
const TARGET_GROUP_NAME = 'Daily Leetcode'; 

// Initialize the WhatsApp Client
// LocalAuth saves your session so you don't have to scan the QR code every time you restart the script.
const client = new Client({
    authStrategy: new LocalAuth(),
});

// Generate and display the QR code in the terminal
client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true });
    console.log('Scan the QR code above with your WhatsApp app to log in.');
});

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

    // Schedule the task - Currently set to run at 8:00 AM every day
    // The format is: minute hour dayOfMonth month dayOfWeek
    cron.schedule('0 8 * * *', async () => {
        console.log('Fetching daily LeetCode question...');
        const questionMessage = await fetchDailyLeetCode();
        
        if (questionMessage) {
            await client.sendMessage(myGroup.id._serialized, questionMessage);
            console.log('✅ Daily question sent to group!');
        }
    });
    
    console.log('⏳ Bot is now running and waiting for the scheduled time...');
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