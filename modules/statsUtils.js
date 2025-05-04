const DailySubmission = require('./models/DailySubmission');

/**
 * Calculate streaks for a user based on their daily submissions.
 * @param {String} userId - The ID of the user.
 * @param {String} guildId - The ID of the guild.
 * @returns {Promise<Number>} - The current streak count.
 */
async function calculateStreak(userId, guildId) {
    const latestSubmission = await DailySubmission.findOne({
        userId,
        guildId,
        completed: true
    }).sort({ date: -1 });

    if (!latestSubmission) {
        return 0;
    }

    // Check if the latest submission is from today or yesterday
    const now = new Date();
    const submissionDate = new Date(latestSubmission.date);
    const isToday = submissionDate.toDateString() === now.toDateString();
    const isYesterday = submissionDate.toDateString() === new Date(now.setDate(now.getDate() - 1)).toDateString();

    // If the latest submission is not from today or yesterday, streak is broken
    if (!isToday && !isYesterday) {
        return 0;
    }

    return latestSubmission.streakCount;
}

/**
 * Calculate weekly or monthly completion rates for a user.
 * @param {String} userId - The ID of the user.
 * @param {String} guildId - The ID of the guild.
 * @param {String} period - 'weekly' or 'monthly'.
 * @returns {Promise<Object>} - Completion rates.
 */
async function calculateCompletionRates(userId, guildId, period) {
    const now = new Date();
    const startDate = new Date(
        period === 'weekly' ? now.setDate(now.getDate() - 7) : now.setMonth(now.getMonth() - 1)
    );

    const submissions = await DailySubmission.find({
        userId,
        guildId,
        date: { $gte: startDate },
        completed: true
    });

    return {
        total: submissions.length,
        period
    };
}

/**
 * Generate a leaderboard for a guild based on streaks.
 * @param {String} guildId - The ID of the guild.
 * @returns {Promise<Array>} - Leaderboard data.
 */
async function generateLeaderboard(guildId) {
    // Get latest submission for each user to check their current streak
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);

    // Find latest submissions within today or yesterday that have a streak
    const users = await DailySubmission.find({
        guildId,
        completed: true,
        date: {
            $gte: new Date(yesterday.setHours(0, 0, 0, 0))
        },
        streakCount: { $gt: 0 }
    }).sort({ streakCount: -1, date: -1 }).limit(10);

    // Map to leaderboard format
    return users.map((submission, index) => ({
        rank: index + 1,
        userId: submission.userId,
        streak: submission.streakCount
    }));
}

module.exports = {
    calculateStreak,
    calculateCompletionRates,
    generateLeaderboard
};