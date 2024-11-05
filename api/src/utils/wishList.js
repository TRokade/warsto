// wishlistUtils.js

const Wishlist = require('../models/WhishList');

exports.mergeWishlistsAfterLogin = async (userId, guestId) => {
    try {
        const guestWishlist = await Wishlist.findOne({ user: guestId, isGuest: true });
        let userWishlist = await Wishlist.findOne({ user: userId, isGuest: false });

        if (!userWishlist) {
            userWishlist = new Wishlist({ user: userId, products: [], isGuest: false });
        }

        if (guestWishlist && guestWishlist.products.length > 0) {
            userWishlist.products = [...new Set([...userWishlist.products, ...guestWishlist.products])];
            await userWishlist.save();

            await Wishlist.deleteOne({ user: guestId, isGuest: true });
        }

        return userWishlist;
    } catch (error) {
        console.error('Error merging wishlists:', error);
        throw error;
    }
};