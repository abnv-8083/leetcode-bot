const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const axios = require('axios');
const fs = require('fs');
const express = require('express');

// --- Web Server Setup ---
const app = express();
app.use(express.json());
app.use(express.static('public'));

// ⚠️ IMPORTANT: Replace this with your exact WhatsApp group name
const TARGET_GROUP_NAME = 'Daily Leetcode';
const STATS_FILE = './stats.json';
const PROFILES_FILE = './profiles.json';

// Helper to get today's date string in IST (e.g. "2026-06-15")
const getTodayDateStr = () => {
    const d = new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Kolkata"}));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Helper to load/save stats
const loadStats = () => {
    if (fs.existsSync(STATS_FILE)) {
        return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    }
    return {};
};
const saveStats = (stats) => fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));

// Helper to load/save profiles
const loadProfiles = () => {
    if (fs.existsSync(PROFILES_FILE)) {
        return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8'));
    }
    return {};
};
const saveProfiles = (profiles) => fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));

// Helper to mark a user as done for today
const markUserDone = (userId) => {
    if (!userId) return false;
    // Strip multi-device tags (e.g. 919876543210:1@c.us -> 919876543210@c.us) but preserve @lid or @c.us domains
    const cleanId = userId.replace(/:\d+@/, '@');
    
    const stats = loadStats();
    const today = getTodayDateStr();
    if (!stats[today]) stats[today] = [];
    if (!stats[today].includes(cleanId)) {
        stats[today].push(cleanId);
        saveStats(stats);
        return true; // Newly marked
    }
    return false; // Already marked
};

const getDoneUsersToday = () => {
    const stats = loadStats();
    return stats[getTodayDateStr()] || [];
};

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

// Function to check if a user has solved today's question
const checkLeetCodeSubmission = async (username, targetSlug) => {
    try {
        const query = `
            query recentAcSubmissions($username: String!, $limit: Int!) {
              recentAcSubmissionList(username: $username, limit: $limit) {
                titleSlug
                timestamp
              }
            }
        `;
        const response = await axios.post('https://leetcode.com/graphql', {
            query,
            variables: { username, limit: 15 }
        });
        
        const submissions = response.data.data.recentAcSubmissionList;
        if (!submissions || submissions.length === 0) return false;

        const now = Date.now() / 1000;
        // Check if any recent submission matches the target slug within 24h
        return submissions.some(sub => sub.titleSlug === targetSlug && (now - sub.timestamp) < 86400);
    } catch (e) {
        console.error('❌ Error checking LeetCode submission:', e.message);
        return false;
    }
}

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
    global.myGroup = myGroup; // Export for Web API

    // Function to generate and send stats summary
    const sendStatsSummary = async () => {
        // Clean any saved multi-device IDs to match participant formats
        const doneUserIds = getDoneUsersToday().map(id => id.replace(/:\d+@/, '@'));
        
        // Refresh group participants just in case
        const groupChat = await client.getChatById(myGroup.id._serialized);
        const allParticipants = groupChat.participants;
        
        const doneMentions = [];
        const notDoneMentions = [];
        const mentionsArgs = [];

        for (let participant of allParticipants) {
            if (doneUserIds.includes(participant.id._serialized)) {
                doneMentions.push(`@${participant.id.user}`);
                mentionsArgs.push(participant.id._serialized);
            } else {
                notDoneMentions.push(`@${participant.id.user}`);
                mentionsArgs.push(participant.id._serialized);
            }
        }

        const report = `📊 *Daily LeetCode Progress (${getTodayDateStr()})* 📊\n\n` +
                       `✅ *Finished:*\n${doneMentions.length > 0 ? doneMentions.join(', ') : 'No one yet! 😢'}\n\n` +
                       `❌ *Not Finished:*\n${notDoneMentions.length > 0 ? notDoneMentions.join('\n') : 'Everyone is done! 🎉'}`;

        await groupChat.sendMessage(report, { mentions: mentionsArgs });
    };

    // Listen to messages for completions and commands
    client.on('message', async (msg) => {
        try {
            const chat = await msg.getChat();
            if (chat.isGroup && chat.name === TARGET_GROUP_NAME) {
                const text = msg.body.toLowerCase().trim();
                const doneKeywords = ['done', 'completed', 'finished', '👍', '👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿'];
                
                // Guide command
                if (text === '!guide' || text === '!help') {
                    const guideMsg = `*🤖 BOT GUIDE:*\n\n` +
                                     `1️⃣ *Link Profile:* Type \`!link your_leetcode_username\` (e.g. \`!link neal_wu\`) to connect your account. You only need to do this once!\n\n` +
                                     `2️⃣ *Submit:* Solve the daily problem on LeetCode. Make sure your profile is Public!\n\n` +
                                     `3️⃣ *Verify:* Type \`done\` in this group. The bot will automatically scan your LeetCode profile to verify your "Accepted" submission for today.\n\n` +
                                     `4️⃣ *Progress:* Type \`!stats\` to see who has finished today's challenge.`;
                    await msg.reply(guideMsg);
                    return;
                }

                // Link profile
                if (text.startsWith('!link ')) {
                    const username = text.split(' ')[1];
                    if (username) {
                        const profiles = loadProfiles();
                        const userId = msg.fromMe ? client.info.wid._serialized : msg.author;
                        const cleanId = userId ? userId.replace(/:\d+@/, '@') : null;
                        if (cleanId) {
                            profiles[cleanId] = username;
                            saveProfiles(profiles);
                            await msg.reply(`✅ Successfully linked your WhatsApp to LeetCode profile: *${username}*`);
                        }
                    }
                    return;
                }

                if (doneKeywords.some(kw => text.includes(kw))) {
                    const idsToMark = [];
                    if (msg.fromMe) {
                        idsToMark.push(client.info.wid._serialized);
                    } else {
                        if (msg.author) idsToMark.push(msg.author);
                        try {
                            const contact = await msg.getContact();
                            if (contact && contact.id && contact.id._serialized) {
                                idsToMark.push(contact.id._serialized);
                            }
                        } catch (err) {}
                    }

                    if (idsToMark.length === 0) return;

                    // Verify via LeetCode API first
                    const profiles = loadProfiles();
                    let linkedUsername = null;
                    for (let id of idsToMark) {
                        const cleanId = id.replace(/:\d+@/, '@');
                        if (profiles[cleanId]) {
                            linkedUsername = profiles[cleanId];
                            break;
                        }
                    }

                    if (!linkedUsername) {
                        await msg.reply('❌ You need to link your LeetCode profile first! Type `!link your_username` to link it.');
                        return;
                    }

                    if (!global.todayTitleSlug) {
                        await msg.reply('❌ Today\'s question data is not loaded yet. Try again later.');
                        return;
                    }

                    await msg.react('⏳'); // show it's checking
                    const hasSolved = await checkLeetCodeSubmission(linkedUsername, global.todayTitleSlug);

                    if (!hasSolved) {
                        await msg.reply(`❌ I checked LeetCode (*${linkedUsername}*) and couldn't find an accepted submission for today's challenge. Make sure your solution is accepted!`);
                        await msg.react('❌');
                        return;
                    }

                    let isNew = false;
                    for (let id of idsToMark) {
                        if (markUserDone(id)) {
                            isNew = true;
                        }
                    }

                    if (isNew) {
                        console.log(`✅ Verified and marked user as done (${idsToMark.join(', ')}).`);
                        await msg.react('✅');
                    } else {
                        await msg.react('👍'); // Already marked, but verified again
                    }
                }

                if (text === 'stats' || text === '!stats') {
                    console.log('📊 Stats command triggered.');
                    await sendStatsSummary();
                }
            }
        } catch (err) {
            console.error('Error in message listener:', err);
        }
    });

    // Reusable function to fetch and send the question
    const sendDailyQuestion = async () => {
        console.log('Fetching daily LeetCode question...');
        const questionMessage = await fetchDailyLeetCode();
        
        if (questionMessage) {
            await client.sendMessage(global.myGroup.id._serialized, questionMessage);
            console.log('✅ Daily question sent to group!');
        } else {
            console.log('❌ Failed to fetch the daily question.');
        }
    };
    global.sendDailyQuestionRef = sendDailyQuestion; // Export for Web API

    // Schedule the task - Currently set to run at 8:00 AM every day
    // The format is: minute hour dayOfMonth month dayOfWeek
    cron.schedule('0 8 * * *', sendDailyQuestion, {
        scheduled: true,
        timezone: "Asia/Kolkata" // Force it to run at 8 AM IST (Indian Standard Time), ignoring the AWS UTC server time
    });

    // Schedule the end-of-day stats summary at 11:30 PM IST
    cron.schedule('30 23 * * *', async () => {
        console.log('Sending end-of-day stats summary...');
        await sendStatsSummary();
    }, {
        scheduled: true,
        timezone: "Asia/Kolkata"
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
        global.todayTitleSlug = data.link.split('/')[2];

        // Format the message for WhatsApp
        return `🎯 *LeetCode Daily Challenge* (${date})\n\n*Question:* ${title}\n*Difficulty:* ${difficulty}\n*Link:* ${link}\n\nGood luck everyone! 🚀\n\n` +
               `*🤖 BOT GUIDE:*\n` +
               `1️⃣ *Link:* Type \`!link your_leetcode_username\`\n` +
               `2️⃣ *Submit:* Get an "Accepted" result on LeetCode.\n` +
               `3️⃣ *Verify:* Type \`done\` here to be automatically verified!\n` +
               `4️⃣ *Progress:* Type \`!stats\``;
    } catch (error) {
        console.error('❌ Error fetching LeetCode data:', error.message);
        return null;
    }
}

// Start the client
client.initialize();

// --- Web API Routes ---
const ADMIN_PASS = 'admin123';

const checkAuth = (req, res, next) => {
    if (req.headers.authorization !== ADMIN_PASS) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
};

app.get('/api/status', checkAuth, (req, res) => {
    res.json({
        ready: client.info !== undefined,
        groupFound: global.myGroup !== undefined,
        todayDate: getTodayDateStr()
    });
});

app.get('/api/stats', checkAuth, async (req, res) => {
    const rawProfiles = loadProfiles();
    const enrichedProfiles = {};
    
    // Check block status and group status for each user
    if (client.info && global.myGroup) {
        try {
            const groupChat = await client.getChatById(global.myGroup.id._serialized);
            const participants = groupChat.participants.map(p => p.id._serialized);

            for (const [id, username] of Object.entries(rawProfiles)) {
                let isBlocked = false;
                try {
                    const contact = await client.getContactById(id);
                    isBlocked = contact.isBlocked;
                } catch (e) {}

                enrichedProfiles[id] = {
                    username: username,
                    isBlocked: isBlocked,
                    inGroup: participants.includes(id)
                };
            }
        } catch(e) {
            console.error("Error enriching profiles:", e);
        }
    }

    res.json({
        stats: loadStats(),
        profiles: Object.keys(enrichedProfiles).length > 0 ? enrichedProfiles : rawProfiles // fallback
    });
});

app.post('/api/reset-stats', checkAuth, (req, res) => {
    const stats = loadStats();
    stats[getTodayDateStr()] = [];
    saveStats(stats);
    res.json({ success: true });
});

app.post('/api/trigger-daily', checkAuth, async (req, res) => {
    if (!global.sendDailyQuestionRef) {
        return res.status(400).json({ error: 'Bot is not ready yet' });
    }
    await global.sendDailyQuestionRef();
    res.json({ success: true });
});

app.post('/api/user-action', checkAuth, async (req, res) => {
    const { action, userId } = req.body;
    if (!action || !userId || !global.myGroup) {
        return res.status(400).json({ error: 'Bad Request' });
    }

    try {
        if (action === 'block' || action === 'unblock') {
            const contact = await client.getContactById(userId);
            if (action === 'block') await contact.block();
            if (action === 'unblock') await contact.unblock();
        } else if (action === 'kick') {
            await global.myGroup.removeParticipants([userId]);
        } else if (action === 'add') {
            await global.myGroup.addParticipants([userId]);
        }
        res.json({ success: true });
    } catch (e) {
        console.error('Error in user action:', e);
        res.status(500).json({ error: e.message });
    }
});

// Start the Dashboard Server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`🌐 Web Admin Dashboard running on http://localhost:${PORT}`);
});

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