const { REST, Routes, SlashCommandBuilder } = require('discord.js');
require('dotenv').config();
const logger = require('./logger');

const commands = [
    new SlashCommandBuilder()
        .setName('check')
        .setDescription('Run a manual check of today\'s LeetCode challenge status')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('adduser')
        .setDescription('Add a LeetCode username to track')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The LeetCode username to add')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('discord_user')
                .setDescription('The Discord user to associate with this LeetCode account')
                .setRequired(false))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('removeuser')
        .setDescription('Remove a LeetCode username from tracking')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('The LeetCode username to remove')
                .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('listusers')
        .setDescription('List all tracked LeetCode usernames')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set the announcement channel for this server')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('The channel to send announcements to')
                .setRequired(true))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('managecron')
        .setDescription('Manage cron schedules for LeetCode checks')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add a new check time')
                .addIntegerOption(option =>
                    option.setName('hours')
                        .setDescription('Hour in 24H format (0-23)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(23))
                .addIntegerOption(option =>
                    option.setName('minutes')
                        .setDescription('Minutes (0-59)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(59)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Remove an existing check time')
                .addIntegerOption(option =>
                    option.setName('hours')
                        .setDescription('Hour in 24H format (0-23)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(23))
                .addIntegerOption(option =>
                    option.setName('minutes')
                        .setDescription('Minutes (0-59)')
                        .setRequired(true)
                        .setMinValue(0)
                        .setMaxValue(59)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all scheduled check times'))
        .toJSON(),
    new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('Display information about the bot and its GitHub repository')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('streak')
        .setDescription('Check your current streak for completing LeetCode Daily Challenges')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('View the leaderboard for LeetCode Daily Challenge streaks in this server')
        .toJSON(),
    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View your weekly or monthly completion stats for LeetCode Daily Challenges')
        .addStringOption(option =>
            option.setName('period')
                .setDescription('Choose the period: weekly or monthly')
                .setRequired(true)
                .addChoices(
                    { name: 'Weekly', value: 'weekly' },
                    { name: 'Monthly', value: 'monthly' }
                ))
        .toJSON()
];

async function registerCommands(clientId) {
    if (!clientId) {
        logger.error('Failed to register commands: No client ID provided');
        return;
    }
    
    logger.info(`Initializing command registration for clientId: ${clientId}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    try {
        logger.info('Started refreshing application (/) commands.');

        // Register commands globally instead of per-guild
        await rest.put(
            Routes.applicationCommands(clientId),
            { body: commands }
        );

        logger.info('Successfully reloaded application (/) commands.');
    } catch (error) {
        logger.error('Error reloading commands:', error);
        throw error; // Propagate error for proper handling
    }
}

module.exports = { registerCommands };