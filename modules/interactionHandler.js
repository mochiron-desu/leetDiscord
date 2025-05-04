const { addUser, removeUser, getGuildUsers, initializeGuildConfig, updateGuildChannel, addCronJob, removeCronJob, listCronJobs } = require('./configManager');
const { enhancedCheck } = require('./apiUtils');
const { updateGuildCronJobs } = require('./scheduledTasks');
const logger = require('./logger');
const { calculateStreak, calculateCompletionRates, generateLeaderboard } = require('./statsUtils');

async function handleInteraction(interaction) {
    logger.info(`Interaction received: ${interaction.commandName}`);

    if (!interaction.isCommand()) {
        logger.info('Interaction is not a command. Ignoring.');
        return;
    }

    const { commandName, guildId } = interaction;
    if (!guildId) {
        await interaction.reply('This command can only be used in a server.');
        return;
    }

    try {
        switch (commandName) {
            case 'check':
                await handleCheck(interaction);
                break;
            case 'adduser':
                await handleAddUser(interaction);
                break;
            case 'removeuser':
                await handleRemoveUser(interaction);
                break;
            case 'listusers':
                await handleListUsers(interaction);
                break;
            case 'setchannel':
                await handleSetChannel(interaction);
                break;
            case 'managecron':
                await handleManageCron(interaction);
                break;
            case 'botinfo':
                await handleBotInfo(interaction);
                break;
            case 'streak':
                await handleStreak(interaction);
                break;
            case 'leaderboard':
                await handleLeaderboard(interaction);
                break;
            case 'stats':
                await handleStats(interaction);
                break;
            default:
                await interaction.reply('Unknown command.');
        }
    } catch (error) {
        logger.error(`Error handling ${commandName}:`, error);
        // Only reply if we haven't already
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply('An error occurred while processing your command.');
        }
    }
}

async function handleCheck(interaction) {
    await interaction.deferReply();
    const users = Object.keys(await getGuildUsers(interaction.guildId));
    if (users.length === 0) {
        await interaction.editReply('No users are being tracked in this server.');
        return;
    }
    const checkResult = await enhancedCheck(users, interaction.client, interaction.channelId);
    await interaction.editReply(checkResult);
}

async function handleAddUser(interaction) {
    const username = interaction.options.getString('username');
    const targetUser = interaction.options.getUser('discord_user');
    const discordId = targetUser ? targetUser.id : null;
    
    // Check permissions - using correct permission flag 'ManageRoles'
    const hasPermission = interaction.member.permissions.has('ManageRoles') || interaction.member.permissions.has('Administrator');
    
    // If no permission, only allow adding self
    if (!hasPermission) {
        // If trying to add someone else's Discord account
        if (targetUser && targetUser.id !== interaction.user.id) {
            await interaction.reply('You can only add yourself to the tracking list. You need Manage Roles permission to add other users.');
            return;
        }
        // If no Discord user specified, ensure the leetcode username matches their Discord username
        if (!targetUser && username.toLowerCase() !== interaction.user.username.toLowerCase()) {
            await interaction.reply('You can only add yourself to the tracking list. Please use your Discord username as the LeetCode username or mention yourself.');
            return;
        }
    }
    
    logger.info(`Adding user: ${username} with Discord ID: ${discordId}`);
    const addResult = await addUser(interaction.guildId, username, discordId);
    await interaction.reply(addResult);
}

async function handleRemoveUser(interaction) {
    const username = interaction.options.getString('username');
    
    // Check permissions - using correct permission flag 'ManageRoles'
    const hasPermission = interaction.member.permissions.has('ManageRoles') || interaction.member.permissions.has('Administrator');
    
    // If no permission, verify they're removing themselves
    if (!hasPermission) {
        const guildUsers = await getGuildUsers(interaction.guildId);
        const userEntry = Object.entries(guildUsers).find(([leetcode]) => leetcode === username);
        
        if (!userEntry || userEntry[1] !== interaction.user.id) {
            await interaction.reply('You can only remove yourself from the tracking list. You need Manage Roles permission to remove other users.');
            return;
        }
    }
    
    logger.info(`Removing user: ${username}`);
    const removeResult = await removeUser(interaction.guildId, username);
    await interaction.reply(removeResult);
}

async function handleListUsers(interaction) {
    const users = await getGuildUsers(interaction.guildId);
    const userList = Object.entries(users)
        .map(([leetcode, discordId]) => 
            discordId ? 
            `• ${leetcode} (<@${discordId}>)` : 
            `• ${leetcode}`
        )
        .join('\n');
    
    await interaction.reply(
        userList ? 
        `Currently tracking these users:\n${userList}` : 
        'No users are being tracked in this server.'
    );
}

async function handleSetChannel(interaction) {
    if (!interaction.memberPermissions.has('ManageChannels')) {
        await interaction.reply('You need the Manage Channels permission to use this command.');
        return;
    }

    const channel = interaction.options.getChannel('channel');
    if (!channel || !channel.isTextBased()) {
        await interaction.reply('Please specify a valid text channel.');
        return;
    }

    // Check if bot has permission to send messages in the channel
    const botPermissions = channel.permissionsFor(interaction.client.user);
    if (!botPermissions.has(['SendMessages', 'ViewChannel', 'EmbedLinks'])) {
        await interaction.reply('I don\'t have permission to send messages or embeds in that channel. Please check my permissions and try again.');
        return;
    }

    await initializeGuildConfig(interaction.guildId, channel.id);
    await updateGuildChannel(interaction.guildId, channel.id);

    // Send test embed to the channel
    const testEmbed = {
        color: 0x00ff00,
        title: '📢 Channel Setup Successful!',
        description: 'I will send LeetCode activity updates in this channel.',
        footer: {
            text: 'You can change this channel at any time using /setchannel'
        },
        timestamp: new Date()
    };

    try {
        await channel.send({ embeds: [testEmbed] });
        await interaction.reply(`Successfully set ${channel} as the announcement channel!`);
    } catch (error) {
        logger.error('Error sending test message:', error);
        await interaction.reply('Channel was set but I encountered an error while sending a test message. Please check my permissions.');
    }
}

async function handleManageCron(interaction) {
    if (!interaction.memberPermissions.has('ManageChannels')) {
        await interaction.reply('You need the Manage Channels permission to use this command.');
        return;
    }

    const subcommand = interaction.options.getSubcommand();
    let result;

    switch (subcommand) {
        case 'add': {
            const hours = interaction.options.getInteger('hours');
            const minutes = interaction.options.getInteger('minutes');
            result = await addCronJob(interaction.guildId, hours, minutes);
            await interaction.reply(result);
            // Update cron jobs after adding
            await updateGuildCronJobs(interaction.guildId);
            break;
        }
        case 'remove': {
            const hours = interaction.options.getInteger('hours');
            const minutes = interaction.options.getInteger('minutes');
            result = await removeCronJob(interaction.guildId, hours, minutes);
            await interaction.reply(result);
            // Update cron jobs after removing
            await updateGuildCronJobs(interaction.guildId);
            break;
        }
        case 'list': {
            const times = await listCronJobs(interaction.guildId);
            if (times.length === 0) {
                await interaction.reply('No scheduled check times configured.');
            } else {
                await interaction.reply(`Scheduled check times:\n${times.join('\n')}`);
            }
            break;
        }
    }
}

async function handleBotInfo(interaction) {
    const botInfoEmbed = {
        color: 0x00ff00,
        title: '📚 LeetCode Discord Bot Info',
        description: 'I help track LeetCode activity for your server members. You can find my source code and contribute at:\nhttps://github.com/mochiron-desu/leetDiscord',
        fields: [
            {
                name: '🎯 Purpose',
                value: 'Track and encourage daily LeetCode challenge completion within your Discord community'
            },
            {
                name: '🤖 Features',
                value: '• Daily challenge tracking\n• Automatic progress checks\n• Multi-server support\n• User mentions\n• Flexible scheduling'
            },
            {
                name: '💡 Basic Commands',
                value: '`/setchannel` - Set announcement channel\n`/adduser` - Track a user\n`/check` - Manual progress check\n`/managecron` - Schedule checks'
            }
        ],
        footer: {
            text: 'Type / to see all available commands!'
        },
        timestamp: new Date()
    };

    await interaction.reply({ embeds: [botInfoEmbed] });
}

async function handleStreak(interaction) {
    await interaction.deferReply();
    const streak = await calculateStreak(interaction.user.id, interaction.guildId);
    await interaction.editReply(`Your current streak is **${streak}** days! Keep it up!`);
}

async function handleLeaderboard(interaction) {
    await interaction.deferReply();
    const leaderboard = await generateLeaderboard(interaction.guildId);
    if (leaderboard.length === 0) {
        await interaction.editReply('No leaderboard data available yet. Encourage your server members to participate!');
        return;
    }

    const leaderboardMessage = leaderboard
        .map(entry => `**#${entry.rank}** <@${entry.userId}> - **${entry.streak}** days`)
        .join('\n');

    await interaction.editReply(`🏆 **Leaderboard** 🏆\n${leaderboardMessage}`);
}

async function handleStats(interaction) {
    await interaction.deferReply();
    const period = interaction.options.getString('period');
    const stats = await calculateCompletionRates(interaction.user.id, interaction.guildId, period);
    await interaction.editReply(`You have completed **${stats.total}** challenges in the past ${stats.period}. Great job!`);
}

module.exports = { handleInteraction };