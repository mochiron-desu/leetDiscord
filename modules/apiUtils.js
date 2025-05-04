const axios = require('axios');
const logger = require('./logger');
const DailySubmission = require('./models/DailySubmission');
const { calculateStreak } = require('./statsUtils');

// Fetch today’s daily challenge slug
async function getDailySlug() {
    try {
        logger.info('Fetching daily challenge slug.');
        const res = await axios.get('https://leetcode-api-pied.vercel.app/daily');
        return res.data.question.titleSlug;
    } catch (error) {
        logger.error('Error fetching daily challenge slug:', error);
        throw error;
    }
}

// Fetch recent submissions for a user (limit 20)
async function getUserSubmissions(username) {
    try {
        logger.info(`Fetching submissions for user: ${username}`);
        const res = await axios.get(`https://leetcode-api-pied.vercel.app/user/${username}/submissions?limit=20`);
        return res.data; // array of { titleSlug, statusDisplay, ... }
    } catch (error) {
        logger.error(`Error fetching submissions for user: ${username}`, error);
        throw error;
    }
}

// Check whether user solved today’s slug
async function checkUser(username, slug) {
    try {
        logger.info(`Checking if user ${username} solved slug ${slug}`);
        const subs = await getUserSubmissions(username);
        return subs.some(s => s.titleSlug === slug && s.statusDisplay === 'Accepted');
    } catch (error) {
        logger.error(`Error checking user ${username} for slug ${slug}:`, error);
        throw error;
    }
}

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

// Enhanced check function with more problem details
async function enhancedCheck(users, client, channelId) {
    logger.info('Starting enhanced check for users:', users);
    try {
        const dailyData = await getDailySlug();
        const problemDetails = await axios.get(`https://leetcode-api-pied.vercel.app/problem/${dailyData}`);
        const problem = problemDetails.data;

        const topicTags = problem.topicTags ? problem.topicTags.map(tag => tag.name).join(', ') : 'N/A';
        const stats = problem.stats ? JSON.parse(problem.stats) : { acRate: 'N/A' };

        // Create problem info field
        const problemField = {
            name: 'Problem Info',
            value: `**${problem.title || 'Unknown Problem'}** (${problem.difficulty || 'N/A'})\n` +
                   `Topics: ${topicTags}\n` +
                   `Acceptance Rate: ${stats.acRate}\n` +
                   `[View Problem](${problem.url || 'N/A'})`
        };
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Create individual fields for each user status
        const userStatusFields = await Promise.all(users.map(async username => {
            const submissions = await getUserSubmissions(username);
            const todaysSubmission = submissions.find(sub => 
                sub.titleSlug === dailyData && 
                sub.statusDisplay === 'Accepted'
            );

            // If submission is found, record it in DailySubmission
            if (todaysSubmission) {
                try {
                    const channel = await client.channels.fetch(channelId);
                    const guild = channel.guild;
                    const member = await guild.members.fetch({ user: username, force: true }).catch(() => null);
                    const userId = member ? member.id : username;

                    // Check if we already have a submission record for today
                    const existingSubmission = await DailySubmission.findOne({
                        guildId: guild.id,
                        userId: userId,
                        leetcodeUsername: username,
                        questionSlug: dailyData,
                        date: {
                            $gte: today,
                            $lt: new Date(today.getTime() + 24 * 60 * 60 * 1000)
                        }
                    });

                    // Only create new submission if one doesn't exist
                    if (!existingSubmission) {
                        const submissionTime = parseSubmissionTime(todaysSubmission);
                        await DailySubmission.create({
                            guildId: guild.id,
                            userId,
                            leetcodeUsername: username,
                            date: today,
                            questionTitle: problem.title,
                            questionSlug: dailyData,
                            difficulty: problem.difficulty,
                            submissionTime,
                            completed: true,
                            streakCount: await calculateStreak(userId, guild.id)
                        });
                    }
                } catch (error) {
                    logger.error(`Error recording submission for ${username}:`, error);
                }
            }

            return {
                name: username,
                value: todaysSubmission ? '✅ Completed' : '❌ Not completed',
                inline: true
            };
        }));

        const statusEmbed = {
            title: 'Daily LeetCode Challenge Status',
            fields: [problemField, ...userStatusFields],
            color: 0x00ff00,
            timestamp: new Date()
        };

        return { embeds: [statusEmbed] };
    } catch (err) {
        logger.error('Error during enhanced check:', err);
        return { content: 'Error checking challenge status.' };
    }
}

module.exports = { getDailySlug, getUserSubmissions, checkUser, enhancedCheck };