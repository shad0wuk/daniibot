const { Client, MessageAttachment } = require('discord.js-selfbot-v13'); // Import without GatewayIntentBits
const fs = require('fs'); // Import the file system module
const axios = require('axios'); // Import axios for making HTTP requests
const path = require('path'); // Import path module for file handling
const fsPromises = fs.promises; // Use fs.promises for promise-based file system operations

// Load the bot token from the config file
const config = JSON.parse(fs.readFileSync('config.json', 'utf8')); // Load config.json
const botToken = config.token; // Extract the bot token

// Load the JSON file containing idol data
const idols = JSON.parse(fs.readFileSync('db.json', 'utf8'));

// Initialize your Discord client
const client = new Client(); // No intents needed for selfbot

// Specify the channel ID(s) you want to listen to, including those from other servers
const listenChannelIds = [
    '124767749099618304' // Add your channel IDs here
];

// Channel ID for logging
const logChannelId = '1293355436782784543';

// Create a temporary directory for storing images
const tempDir = path.join(__dirname, 'temp');

fsPromises.mkdir(tempDir, { recursive: true }); // Create temp directory if it doesn't exist

// Initialize Bottleneck with a rate limit of 35 requests per second
const Bottleneck = require('bottleneck'); // Import Bottleneck
const limiter = new Bottleneck({
    minTime: 1000 / 35 // 35 requests per second
});

client.on('ready', async () => {
    console.log(`${client.user.username} is ready!`);
    await logMessage(`Bot started successfully: ${client.user.username}`); // Log bot startup
});

// Combined listener for new messages and replies
client.on('messageCreate', async (message) => {
    if (message.author.bot) return; // Ignore messages from bots

    // Check if the message is from the specified channel(s)
    if (!listenChannelIds.includes(message.channel.id)) return; // Exit if not from the desired channel

    let mediaUrls = []; // Array to hold media URLs

    // Gather media URLs from the message
    if (message.attachments.size > 0) {
        message.attachments.forEach(attachment => mediaUrls.push(attachment.url)); // Extract attachment URLs
    }
    if (message.content) {
        // Extract any links in the message content
        const linkRegex = /(https?:\/\/[^\s]+)/g; // Simple regex to find links
        const links = message.content.match(linkRegex);
        if (links) mediaUrls.push(...links); // Add found links to mediaUrls
    }

    try {
        // Check if the message is a reply
        if (message.reference) {
            // If it's a reply, fetch the referenced message
            const referencedMessage = await message.channel.messages.fetch(message.reference.messageId);

            // Find the role ID of the referenced message
            const mentionedRoles = referencedMessage.mentions.roles;

            // Process roles from the referenced message
            if (mentionedRoles.size > 0) {
                for (const roleMentioned of mentionedRoles.values()) {
                    const roleId = roleMentioned.id;
                    await limiter.schedule(() => sendMediaForRole(roleId, mediaUrls)); // Use limiter to control rate
                }
            }
        } else {
            // If it's a new message, check for role mentions
            const mentionedRoles = message.mentions.roles;

            // Process roles from the new message
            if (mentionedRoles.size > 0) {
                for (const roleMentioned of mentionedRoles.values()) {
                    const roleId = roleMentioned.id;
                    await limiter.schedule(() => sendMediaForRole(roleId, mediaUrls)); // Use limiter to control rate
                }
            }
        }
    } catch (error) {
        await logError(error); // Log the error message
    }
});

// Function to send media to the specified role's channel
async function sendMediaForRole(roleId, mediaUrls) {
    // Check if the role ID corresponds to an idol in the JSON members
    const memberData = Object.entries(idols.members).find(([name, member]) => {
        if (Array.isArray(member)) {
            // Handle members with multiple groups
            return member.some(entry => entry.id === roleId);
        } else {
            // Handle single members
            return member.id === roleId;
        }
    });

    if (memberData) {
        const [memberName, member] = memberData;

        if (Array.isArray(member)) {
            // Handle the case where the member has multiple group entries
            const specificGroupEntry = member.find(entry => entry.id === roleId);
            if (specificGroupEntry && specificGroupEntry.channel_id) {
                await sendMediaToChannel(specificGroupEntry.channel_id, mediaUrls);
            } else {
                console.log(`No channel found for group with role ID: ${roleId}`);
                await logMessage(`No channel found for group with role ID: ${roleId}`); // Log the message
            }
        } else if (member.channel_id) {
            // Handle single member case
            await sendMediaToChannel(member.channel_id, mediaUrls);
        } else {
            console.log(`No channel found for member with role ID: ${roleId}`);
            await logMessage(`No channel found for member with role ID: ${roleId}`); // Log the message
        }
    } else {
        console.log(`No idol found for role ID: ${roleId}`);
        await logMessage(`No idol found for role ID: ${roleId}`); // Log the message
    }
}

// Function to split a message into chunks under 2000 characters
function splitMessageIntoChunks(message, maxLength = 2000) {
    let chunks = [];
    let currentChunk = "";

    for (const line of message.split('\n')) {
        if (currentChunk.length + line.length + 1 > maxLength) {
            chunks.push(currentChunk);
            currentChunk = line;
        } else {
            currentChunk += (currentChunk ? '\n' : '') + line;
        }
    }

    if (currentChunk) chunks.push(currentChunk); // Add any remaining content
    return chunks;
}

// Updated function to send media to the specified channel, limiting 5 links per message
async function sendMediaToChannel(channelId, mediaUrls) {
    const idolChannel = await client.channels.fetch(channelId);
    if (idolChannel) {
        if (mediaUrls.length > 0) {
            // Split mediaUrls into batches of 5 links each
            const urlBatches = [];
            while (mediaUrls.length) {
                urlBatches.push(mediaUrls.splice(0, 5));
            }

            // Send each batch as a separate message
            for (const batch of urlBatches) {
                const message = batch.join('\n'); // Join URLs into a single message (max 5 links)
                await idolChannel.send(message); // Send each message containing up to 5 links
            }
        }
    } else {
        console.log(`Channel ID ${channelId} not found.`);
        await logMessage(`Channel ID ${channelId} not found.`); // Log the message
    }
}


// Function to log messages to the designated channel
async function logMessage(message) {
    const logChannel = await client.channels.fetch(logChannelId);
    if (logChannel) {
        await logChannel.send(message);
    } else {
        console.error(`Log channel ID ${logChannelId} not found.`);
    }
}

// Function to log errors to the designated channel
async function logError(error) {
    const logChannel = await client.channels.fetch(logChannelId);
    if (logChannel) {
        await logChannel.send(`Error: ${error.message}`); // Send error message
    } else {
        console.error(`Log channel ID ${logChannelId} not found.`);
    }
}

// Log in using the token from config.json
client.login(botToken);
