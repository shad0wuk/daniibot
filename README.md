# Daniibot

This project is a **Discord selfbot** that listens to specific channels for messages and media content (like attachments and links). It then processes these messages by identifying role mentions, and sends the media content to predefined channels, based on a list of idols and associated Discord channels. Additionally, the bot logs errors and important events to a designated logging channel.

Based on KPF.

## Features

- **Listen to Multiple Channels**: The bot can monitor messages in specified channels, including channels across different servers.
- **Role-Based Media Handling**: For messages that mention roles, the bot checks if the mentioned roles correspond to specific idols and sends associated media to their designated channels.
- **Rate Limiting**: A rate limit is implemented using **Bottleneck** to avoid exceeding Discord's API rate limits.
- **Media Management**: The bot collects media from message attachments and links in the message content. It batches and sends them in groups of up to 5 per message to avoid hitting Discord's character limit.
- **Error and Event Logging**: Logs errors and important events (like bot startup) to a specific log channel for easy debugging and monitoring.

## Prerequisites

- **Node.js** (version 14 or above)
- **npm** (Node package manager)
- A **Discord account** (for selfbot usage)

> **Disclaimer**: Discord selfbots are against Discord's Terms of Service (ToS). Using a selfbot can lead to your account being banned. Use this project at your own risk.

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/discord-selfbot.git
   cd discord-selfbot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `config.json` file in the root directory of the project, and add your bot token:
   ```json
   {
       "token": "YOUR_DISCORD_BOT_TOKEN"
   }
   ```

4. Edit `db.json` file to map idols to their corresponding roles and channels. Here’s an example structure:
   ```json
   {
       "members": {
           "idol_name": {
               "id": "ROLE_ID",
               "channel_id": "CHANNEL_ID"
           }
       }
   }
   ```

5. Start the bot:
   ```bash
   node index.js
   ```

## Usage

- The bot listens to the channels specified in the `listenChannelIds` array.
- When a message is posted in one of the monitored channels, and it contains media (attachments or links), the bot checks for role mentions.
- If the mentioned roles correspond to an idol in the `db.json` file, the media content is forwarded to the idol’s associated channel.
- Log and error messages are sent to a specified logging channel.

## Configuration

- **config.json**:
   ```json
   {
       "token": "YOUR_DISCORD_BOT_TOKEN"
   }
   ```

- **db.json**:
   - Maps idols' roles to their associated Discord channels.

- **Rate Limiting**: The bot is configured to send no more than 35 requests per second to Discord's API. Discord API limit is 50.

## Dependencies

- `discord.js-selfbot-v13`: A Discord.js library for selfbots.
- `axios`: For making HTTP requests (if needed in future enhancements).
- `bottleneck`: To limit API request rates.
- `fs` and `path`: File system and path utilities.

Install dependencies using:
```bash
npm install discord.js-selfbot-v13 axios bottleneck
```

# License

This project is licensed under the **GNU General Public License v3.0**. You are free to:

- Use the software for any purpose
- Study how the program works, and change it to make it do what you wish
- Distribute copies of the original program
- Distribute modified versions of the program under the same license

## Conditions

1. If you modify the software and distribute it, you must distribute your modified version under the same license (GPL v3.0).
2. You must include a copy of the license when you distribute the software.
3. There is no warranty for the software; it is provided "as is".

See the full [LICENSE](./LICENSE) file for more details or please refer to the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html).

### Copyright Notice

Copyright (C) 2024 shad0wuk

---

Enjoy using the bot, and always be mindful of Discord's ToS.
