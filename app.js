import { Client, MessageAttachment } from 'discord.js-selfbot-v13';
import fs from 'fs';
import axios from 'axios';
import path from 'path';
import fetch from 'node-fetch';
import { promises as fsPromises } from 'fs';
import Bottleneck from 'bottleneck';
import { error } from 'console';
import { fileURLToPath } from 'url';

// Load the bot token from the config file
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));
const botToken = config.token;
const webhookUrl = config.webhook_url;
const mentionUserId = config.mention_user_id;

// Load all channel and server IDs from config
const listenChannelIds = config.listen_channel_ids;
const logChannelId = config.log_channel_id;
const pingRolesChannelId = config.ping_roles_channel_id;
const targetGuildId = config.target_guild_id;
const newChannelCategoryId = config.new_channel_category_id;

// Load the JSON file containing idol data
let idols = JSON.parse(fs.readFileSync('db.json', 'utf8'));

// Initialize your Discord client
const client = new Client();

// Create a temporary directory for storing images
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempDir = path.join(__dirname, 'temp');

fsPromises.mkdir(tempDir, { recursive: true });

// Initialize Bottleneck with a rate limit of 35 requests per second
const limiter = new Bottleneck({
    minTime: 1000 / 35
});

// Cache for ping-roles channel messages
let roleCache = new Map();
let roleCacheInitialized = false;

// Track last role mention per user (for follow-up messages)
const userLastRoleMap = new Map(); // userId -> { roleIds: [], timestamp: Date }
const FOLLOW_UP_TIMEOUT = 5 * 60 * 1000; // 5 minutes

client.on('ready', async () => {
    console.log(`${client.user.username} is ready!`);
    
    // Log monitored channels
    console.log('\n📡 Monitoring these channels:');
    for (const channelId of listenChannelIds) {
        try {
            const channel = await client.channels.fetch(channelId);
            console.log(`  - #${channel.name} in ${channel.guild.name} (${channelId})`);
        } catch (error) {
            console.log(`  - ⚠️ Could not fetch channel ${channelId}`);
        }
    }
    
    // Log target server for new channels
    try {
        const targetGuild = await client.guilds.fetch(targetGuildId);
        console.log(`\n🎯 Creating new channels in: ${targetGuild.name} (${targetGuildId})`);
        
        if (newChannelCategoryId) {
            const category = await client.channels.fetch(newChannelCategoryId);
            console.log(`   Category: ${category.name}\n`);
        } else {
            console.log(`   ⚠️ Category ID not set in config.json! New channels will be created at root level.\n`);
        }
    } catch (error) {
        console.log(`\n⚠️ Could not fetch target guild ${targetGuildId}`);
        console.log(`   Make sure targetGuildId is set correctly!\n`);
    }
    
    await logMessage(`Bot started successfully: ${client.user.username}`);
    
    // Initialize role cache on startup
    await initializeRoleCache();
});

// Initialize role cache from ping-roles channel
async function initializeRoleCache() {
    try {
        const pingRolesChannel = await client.channels.fetch(pingRolesChannelId);
        if (!pingRolesChannel) {
            console.error('Could not find ping-roles channel');
            return;
        }

        console.log('Initializing role cache from ping-roles channel...');
        
        // Fetch messages from the channel
        const messages = await pingRolesChannel.messages.fetch({ limit: 100 });
        
        // Parse messages to build role cache
        messages.forEach(message => {
            const lines = message.content.split('\n');
            lines.forEach(line => {
                // Match pattern: "Name [Group] ID" or "Name ID" or "Group ID"
                const match = line.match(/^(.+?)\s+(\d{17,19})$/);
                if (match) {
                    const name = match[1].trim();
                    const roleId = match[2].trim();
                    roleCache.set(roleId, name);
                }
            });
        });
        
        roleCacheInitialized = true;
        console.log(`Role cache initialized with ${roleCache.size} entries`);
        await logMessage(`Role cache initialized with ${roleCache.size} entries`);
    } catch (error) {
        console.error('Error initializing role cache:', error);
        await logError(error);
    }
}

// Message listener
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (!listenChannelIds.includes(message.channel.id)) return;

    let mediaUrls = [];
    let roleIds = [];

    // Gather media URLs from the message
    if (message.attachments.size > 0) {
        message.attachments.forEach(attachment => mediaUrls.push(attachment.url));
    }
    if (message.content) {
        const linkRegex = /(https?:\/\/[^\s]+)/g;
        const links = message.content.match(linkRegex);
        if (links) {
            const cleanLinks = links.map(link => link.trim().replace(/>$/, ''));
            mediaUrls.push(...cleanLinks);
        }
    }

    try {
        // Check for role mentions in the current message
        const mentionedRoles = message.mentions.roles;

        if (mentionedRoles.size > 0) {
            // Collect all role IDs
            for (const roleMentioned of mentionedRoles.values()) {
                roleIds.push(roleMentioned.id);
            }

            // Update the user's last role cache
            userLastRoleMap.set(message.author.id, {
                roleIds: roleIds,
                timestamp: Date.now()
            });

            // Process the media for these roles
            for (const roleId of roleIds) {
                await limiter.schedule(() => sendMediaForRole(roleId, mediaUrls));
            }
        } 
        // If no role mentions but message has media, check if this is a follow-up from the same user
        else if (mediaUrls.length > 0 && userLastRoleMap.has(message.author.id)) {
            const lastRole = userLastRoleMap.get(message.author.id);
            const timeSinceLastMention = Date.now() - lastRole.timestamp;

            // If within timeout period, treat this as a follow-up message
            if (timeSinceLastMention <= FOLLOW_UP_TIMEOUT) {
                console.log(`Follow-up media from ${message.author.tag} (${timeSinceLastMention}ms ago)`);
                await logMessage(`📎 Follow-up media detected from ${message.author.tag}`);

                // Send media to the same roles as the previous message
                for (const roleId of lastRole.roleIds) {
                    await limiter.schedule(() => sendMediaForRole(roleId, mediaUrls));
                }

                // Update timestamp to keep the window open
                lastRole.timestamp = Date.now();
            }
        }
    } catch (error) {
        await logError(error);
    }
});

// Function to send media to the specified role's channel
async function sendMediaForRole(roleId, mediaUrls) {
    // Check if the role ID corresponds to an idol in the JSON members
    const memberData = Object.entries(idols.members).find(([name, member]) => {
        if (Array.isArray(member)) {
            return member.some(entry => entry.id === roleId);
        } else {
            return member.id === roleId;
        }
    });

    if (memberData) {
        const [memberName, member] = memberData;

        if (Array.isArray(member)) {
            const specificGroupEntry = member.find(entry => entry.id === roleId);
            if (specificGroupEntry && specificGroupEntry.channel_id) {
                await sendMediaToChannel(specificGroupEntry.channel_id, mediaUrls);
            } else {
                console.log(`No channel found for group with role ID: ${roleId}`);
                await logMessage(`No channel found for group with role ID: ${roleId}`);
            }
        } else if (member.channel_id) {
            await sendMediaToChannel(member.channel_id, mediaUrls);
        } else {
            console.log(`No channel found for member with role ID: ${roleId}`);
            await logMessage(`No channel found for member with role ID: ${roleId}`);
        }
    } else {
        // Role not found - attempt auto-setup
        await handleUnknownRole(roleId, mediaUrls);
    }
}

// Handle unknown role by auto-creating channel and database entry
async function handleUnknownRole(roleId, mediaUrls) {
    console.log(`Unknown role ID detected: ${roleId}`);
    
    // Check if role cache is initialized
    if (!roleCacheInitialized) {
        await logMessage(`⚠️ Role cache not initialized yet for role ID: ${roleId}`);
        await logUnknownRole(roleId, mediaUrls);
        return;
    }

    // Look up role name in cache
    const roleName = roleCache.get(roleId);
    
    if (!roleName) {
        await logMessage(`⚠️ Role ID ${roleId} not found in ping-roles channel`);
        await logUnknownRole(roleId, mediaUrls);
        return;
    }

    console.log(`Found role name: ${roleName} for ID: ${roleId}`);
    
    try {
        // Create new channel
        const newChannel = await createChannelForRole(roleName, roleId);
        
        if (newChannel) {
            // Add to database
            await addToDatabase(roleName, roleId, newChannel.id);
            
            // Send media to the new channel
            await sendMediaToChannel(newChannel.id, mediaUrls);
            
            // Log success
            await logMessage(`✅ Auto-created channel and database entry for: ${roleName}\nRole ID: ${roleId}\nChannel: <#${newChannel.id}>`);
        } else {
            await logUnknownRole(roleId, mediaUrls);
        }
    } catch (error) {
        console.error('Error in handleUnknownRole:', error);
        await logError(error);
        await logUnknownRole(roleId, mediaUrls);
    }
}

// Create a new channel for a role
async function createChannelForRole(roleName, roleId) {
    try {
        // Get YOUR guild (not KPF!)
        const guild = await client.guilds.fetch(targetGuildId);
        
        if (!guild) {
            console.error('Could not find target guild');
            await logMessage('❌ Could not find target guild for channel creation');
            return null;
        }

        console.log(`Attempting to create channel in guild: ${guild.name} (${guild.id})`);
        console.log(`My permissions:`, guild.members.cache.get(client.user.id)?.permissions.toArray());

        // Format channel name (lowercase, replace spaces and brackets with hyphens)
        const channelName = roleName
            .toLowerCase()
            .replace(/[\[\]]/g, '-')
            .replace(/\s+/g, '-')
            .replace(/--+/g, '-')
            .replace(/^-|-$/g, '');

        console.log(`Creating channel with name: ${channelName}`);
        console.log(`Category ID: ${newChannelCategoryId}`);

        // Create the channel
        const newChannel = await guild.channels.create(channelName, {
            type: 'GUILD_TEXT',
            parent: newChannelCategoryId || null,
            reason: `Auto-created for role: ${roleName} (${roleId})`
        });

        console.log(`✅ Created new channel: ${newChannel.name} (${newChannel.id})`);
        return newChannel;
    } catch (error) {
        console.error('❌ Error creating channel:', error.message);
        console.error('Error details:', error);
        await logMessage(`❌ Error creating channel: ${error.message}\nRole: ${roleName}\nRole ID: ${roleId}`);
        return null;
    }
}

// Add new entry to database
async function addToDatabase(roleName, roleId, channelId) {
    try {
        // Parse role name to extract group if present
        const groupMatch = roleName.match(/\[(.+?)\]/);
        const group = groupMatch ? groupMatch[1] : null;
        const cleanName = roleName.replace(/\s*\[.+?\]\s*/g, '').trim();
        
        // Create new entry
        const newEntry = {
            id: roleId,
            channel_id: channelId
        };
        
        if (group) {
            newEntry.group = group;
        }

        // Add to idols object
        idols.members[cleanName] = newEntry;

        // Write to file
        await fsPromises.writeFile('db.json', JSON.stringify(idols, null, 2), 'utf8');
        
        console.log(`Added ${cleanName} to database`);
    } catch (error) {
        console.error('Error adding to database:', error);
        await logError(error);
    }
}

// Log unknown role with media (fallback for manual handling)
async function logUnknownRole(roleId, mediaUrls) {
    let errorMessage = `No idol found for role ID: ${roleId}`;
    if (mediaUrls.length > 0) {
        errorMessage += `\nAttached media:`;
        const mediaChunks = splitMessageIntoChunks(mediaUrls.join(`\n`), 2000 - errorMessage.length - 5);
        for (const chunk of mediaChunks) {
            await logMessage(`${errorMessage}\n${chunk}`);
        }
    } else {
        console.log(errorMessage);
        await logMessage(errorMessage);
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

    if (currentChunk) chunks.push(currentChunk);
    return chunks;
}

// Updated function to send media to the specified channel, limiting 5 links per message
async function sendMediaToChannel(channelId, mediaUrls) {
    const idolChannel = await client.channels.fetch(channelId);
    if (idolChannel) {
        if (mediaUrls.length > 0) {
            const urlBatches = [];
            while (mediaUrls.length) {
                urlBatches.push(mediaUrls.splice(0, 5));
            }

            for (const batch of urlBatches) {
                const message = batch.join('\n');
                await idolChannel.send(message);
            }
        }
    } else {
        console.log(`Channel ID ${channelId} not found.`);
        await logMessage(`Channel ID ${channelId} not found.`);
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
        await logChannel.send(`Error: ${error.message}`);
    } else {
        console.error(`Log channel ID ${logChannelId} not found.`);
    }
}

async function sendErrorToWebhook(errorMessage) {
    try {
        const messageContent = `<@${mentionUserId}> **Error Notification:**\n${errorMessage}`;

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: messageContent }),
        });

        if (response.ok) {
            console.log("Webhook sent successfully!");
        } else {
            console.error("Failed to send webhook. Status:", response.status);
        }
    } catch (err) {
        console.error("Failed to send message to webhook:", err.message);
    }
}

// Attempt to log in
client.login(botToken)
    .then(() => {
        console.log("Token is valid. Bot logging in...");
    })
    .catch((error) => {
        console.error("Error occurred during login:", error.message);
        sendErrorToWebhook(`Error during login: ${error.message}`);
    });