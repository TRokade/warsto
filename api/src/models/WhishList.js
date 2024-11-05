const mongoose = require('mongoose');

const WishlistSchema = new mongoose.Schema({
    user: { type: String, required: true },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    isGuest: { type: Boolean, default: false },
}, { timestamps: true });

WishlistSchema.index({ user: 1 });

module.exports = mongoose.model('Wishlist', WishlistSchema);