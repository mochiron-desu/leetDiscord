const mongoose = require('mongoose');

const dailySubmissionSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true,
        index: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    leetcodeUsername: {
        type: String,
        required: true
    },
    date: {
        type: Date,
        required: true,
        index: true
    },
    questionTitle: {
        type: String,
        required: true
    },
    questionSlug: {
        type: String,
        required: true
    },
    difficulty: {
        type: String,
        enum: ['Easy', 'Medium', 'Hard'],
        required: true
    },
    submissionTime: {
        type: Date,
        required: true
    },
    completed: {
        type: Boolean,
        required: true,
        default: false
    },
    streakCount: {
        type: Number,
        required: false,
        default: 0
    }
});

// Compound index for efficient querying of user submissions within a guild
dailySubmissionSchema.index({ guildId: 1, userId: 1, date: -1 });

// Add pre-save middleware after the schema definition
dailySubmissionSchema.pre('save', async function(next) {
    if (this.isNew && this.completed) {
        const yesterday = new Date(this.date);
        yesterday.setDate(yesterday.getDate() - 1);

        // Find yesterday's submission
        const prevSubmission = await this.constructor.findOne({
            userId: this.userId,
            guildId: this.guildId,
            completed: true,
            date: {
                $gte: new Date(yesterday.setHours(0, 0, 0, 0)),
                $lt: new Date(yesterday.setHours(23, 59, 59, 999))
            }
        });

        // If there was a submission yesterday, increment that streak
        // Otherwise start a new streak at 1
        this.streakCount = prevSubmission ? prevSubmission.streakCount + 1 : 1;
    }
    next();
});

module.exports = mongoose.model('DailySubmission', dailySubmissionSchema);