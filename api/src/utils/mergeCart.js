// cartUtils.js

const Cart = require('../models/Cart');

exports.mergeCartsAfterLogin = async (userId, guestId) => {
    try {
        const guestCart = await Cart.findOne({ user: guestId, isGuest: true });
        let userCart = await Cart.findOne({ user: userId, isGuest: false });

        if (!userCart) {
            userCart = new Cart({ user: userId, items: [], subtotal: 0, total: 0, isGuest: false });
        }

        if (guestCart && guestCart.items.length > 0) {
            guestCart.items.forEach(guestItem => {
                const existingItemIndex = userCart.items.findIndex(
                    item => item.product.toString() === guestItem.product.toString()
                );

                if (existingItemIndex > -1) {
                    userCart.items[existingItemIndex].quantity += guestItem.quantity;
                } else {
                    userCart.items.push({
                        product: guestItem.product,
                        quantity: guestItem.quantity,
                        price: guestItem.price
                    });
                }
            });

            userCart.calculateTotal();
            await userCart.save();

            await Cart.deleteOne({ user: guestId, isGuest: true });
        }

        return userCart;
    } catch (error) {
        console.error('Error merging carts:', error);
        throw error;
    }
};