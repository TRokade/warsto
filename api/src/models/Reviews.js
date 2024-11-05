// models/Review.js
const mongoose = require('mongoose');

const ReviewSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: String,
    images: [{
        url: String,
        caption: String
    }],
    helpful: { type: Number, default: 0 },
    verified: { type: Boolean, default: false },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
}, { timestamps: true });

ReviewSchema.index({ product: 1, user: 1 }, { unique: true });

module.exports = mongoose.model('Review', ReviewSchema);