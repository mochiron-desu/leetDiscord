const cron = require('node-cron');
const { getUserSubmissions, getDailySlug } = require('./apiUtils');
const { PermissionsBitField } = require('discord.js');
const axios = require('axios');
const logger = require('./logger');
const Guild = require('./models/Guild');
const DailySubmission = require('./models/DailySubmission');
const { calculateStreak } = require('./statsUtils');

// Helper function to safely parse submission timestamp
function parseSubmissionTime(submission) {
    if (!submission.timestamp) {
        logger.warn('No timestamp in submission:', submission);
        return new Date(); // Fallback to current time if no timestamp
    }

    // Try parsing as unix timestamp (seconds or milliseconds)
    const timestamp = parseInt(submission.timestamp);
    if (!isNaN(timestamp)) {
        // Check if it's in seconds (Unix timestamp) or milliseconds
        const date = timestamp > 9999999999 ? new Date(timestamp) : new Date(timestamp * 1000);
        if (date.toString() !== 'Invalid Date') {
            return date;
        }
    }

    // Try parsing as ISO string
    const isoDate = new Date(submission.timestamp);
    if (isoDate.toString() !== 'Invalid Date') {
        return isoDate;
    }

    logger.warn(`Invalid timestamp format: ${submission.timestamp}, using current time`);
    return new Date(); // Fallback to current time if parsing fails
}

const activeCronJobs = new Map();
let discordClient = null;

async function initializeScheduledTasks(client) {
    discordClient = client;  // Store the client instance
    try {
        // Get all guilds from MongoDB
        const guilds = await Guild.find({});
        
        for (const guild of guilds) {
            // Initialize cron jobs for each guild
            guild.cronJobs.forEach(job => {
                if (job.task === 'runCheck') {
                    scheduleDailyCheck(client, guild.guildId, guild.channelId, job.schedule);
                }
            });
        }
        logger.info('Scheduled tasks initialized successfully');
    } catch (error) {
        logger.error('Error initializing scheduled tasks:', error);
    }
}

async function scheduleDailyCheck(client, guildId, channelId, schedule) {
    const jobKey = `${guildId}-${schedule}`;
    
    // Clear existing job if it exists
    if (activeCronJobs.has(jobKey)) {
        activeCronJobs.get(jobKey).stop();
        activeCronJobs.delete(jobKey);
    }

    const job = cron.schedule(schedule, async () => {
        try {
            const guild = await Guild.findOne({ guildId });
            if (!guild) {
                logger.error(`Guild ${guildId} not found in database`);
                return;
            }

            const channel = await client.channels.fetch(guild.channelId);
            if (!channel) {
                logger.error(`Channel ${guild.channelId} not found for guild ${guildId}`);
                return;
            }

            // Check if bot has permission to send messages in this channel
            const botMember = await channel.guild.members.fetchMe();
            const permissions = channel.permissionsFor(botMember);
            
            if (!permissions?.has(PermissionsBitField.Flags.SendMessages)) {
                logger.error(`Bot lacks permission to send messages in channel ${channel.name} (${channel.id}) in guild ${guild.name} (${guildId})`);
                // Try to notify guild owner about permission issue
                try {
                    const guildOwner = await channel.guild.fetchOwner();
                    await guildOwner.send(
                        'I don\'t have permission to send messages in #' + channel.name + ' in ' + guild.name + '. ' +
                        'Please grant me the \'Send Messages\' permission in that channel or set a different channel using /setchannel.'
                    );
                } catch (dmError) {
                    logger.error('Failed to notify guild owner about permissions:', dmError);
                }
                return;
            }

            const users = Object.fromEntries(guild.users);
            if (Object.keys(users).length === 0) {
                return;
            }

            // Get today's daily challenge slug and problem details
            const dailySlug = await getDailySlug();
            if (!dailySlug) {
                logger.error('Failed to fetch daily challenge slug');
                return;
            }

            // Fetch problem details to get difficulty
            const problemDetails = await axios.get(`https://leetcode-api-pied.vercel.app/problem/${dailySlug}`);
            const problem = problemDetails.data;
            if (!problem || !problem.difficulty) {
                logger.error('Failed to fetch problem details or missing difficulty');
                return;
            }

            const incompleteUsers = [];
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            for (const [username, discordId] of Object.entries(users)) {
                try {
                    const submissions = await getUserSubmissions(username);
                    if (submissions && submissions.length > 0) {
                        // Check if user has completed today's challenge
                        const todaysSubmission = submissions.find(sub => 
                            sub.titleSlug === dailySlug && 
                            sub.statusDisplay === 'Accepted'
                        );

                        if (todaysSubmission) {
                            // Check if we already have a submission record for today
                            const existingSubmission = await DailySubmission.findOne({
                                guildId,
                                userId: discordId || username,
                                leetcodeUsername: username,
                                questionSlug: dailySlug,
                                date: {
                                    $gte: today,
                                    $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                                }
                            });

                            // Only create new submission if one doesn't exist
                            if (!existingSubmission) {
                                const submissionTime = parseSubmissionTime(todaysSubmission);
                                await DailySubmission.create({
                                    guildId,
                                    userId: discordId || username,
                                    leetcodeUsername: username,
                                    date: today,
                                    questionTitle: problem.title,
                                    questionSlug: dailySlug,
                                    difficulty: problem.difficulty,
                                    submissionTime,
                                    completed: true,
                                    streakCount: await calculateStreak(discordId || username, guildId)
                                });
                            }
                        } else {
                            const mention = discordId ? `<@${discordId}>` : username;
                            incompleteUsers.push(mention);
                        }
                    } else {
                        // If no submissions at all, add to incomplete users
                        const mention = discordId ? `<@${discordId}>` : username;
                        incompleteUsers.push(mention);
                    }
                } catch (error) {
                    logger.error(`Error fetching submissions for ${username}:`, error);
                }
            }

            // Send a single message mentioning all users who haven't completed the challenge
            if (incompleteUsers.length > 0) {
                try {
                    const message = `⚠️ ${incompleteUsers.join(', ')}\nDon't forget to complete today's LeetCode Daily Challenge!`;
                    await channel.send(message);
                } catch (sendError) {
                    if (sendError.code === 50001 || sendError.code === 50013) { // Missing Access or Missing Permissions
                        logger.error(`Permission error when sending message in channel ${channel.name} (${channel.id}):`, sendError);
                        // Try to notify guild owner
                        try {
                            const guildOwner = await channel.guild.fetchOwner();
                            await guildOwner.send(
                                'I encountered a permission error when trying to send messages in #' + channel.name + ' in ' + guild.name + '. ' +
                                'Please check my permissions and make sure I can:\n' +
                                '- View the channel\n' +
                                '- Send messages\n' +
                                '- Mention users (if you want me to ping people)'
                            );
                        } catch (dmError) {
                            logger.error('Failed to notify guild owner about permissions:', dmError);
                        }
                    } else {
                        logger.error(`Error sending message in channel ${channel.name} (${channel.id}):`, sendError);
                    }
                }
            }
        } catch (error) {
            logger.error('Error in scheduled task:', error);
        }
    });

    activeCronJobs.set(jobKey, job);
}

async function updateGuildCronJobs(guildId) {
    try {
        const guild = await Guild.findOne({ guildId });
        if (!guild) {
            logger.error(`Guild ${guildId} not found when updating cron jobs`);
            return;
        }

        // Clear all existing jobs for this guild
        const guildJobKeys = Array.from(activeCronJobs.keys())
            .filter(key => key.startsWith(guildId));
        
        guildJobKeys.forEach(key => {
            activeCronJobs.get(key).stop();
            activeCronJobs.delete(key);
        });

        // Set up new jobs based on current configuration
        guild.cronJobs.forEach(job => {
            if (job.task === 'runCheck') {
                scheduleDailyCheck(discordClient, guildId, guild.channelId, job.schedule);  // Use stored client instance
            }
        });
    } catch (error) {
        logger.error('Error updating guild cron jobs:', error);
    }
}

module.exports = {
    initializeScheduledTasks,
    scheduleDailyCheck,
    updateGuildCronJobs
};