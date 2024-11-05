const express = require('express');
const router = express.Router();
const Cart = require('../models/Cart');
const Product = require('../models/Product');
const passport = require('passport');
const mongoose = require('mongoose');
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const User = require('../models/User');
const { v4: uuidv4 } = require('uuid');
// router.get('/', (req, res, next) => {
//     console.log("Incoming request to /api/cart");
//     console.log("Headers:", req.headers);
//     next();
// }, passport.authenticate('jwt', { session: false }), (req, res, next) => {
//     console.log("Passport authentication passed");
//     console.log("Authenticated user:", req.user);
//     next();
// }, (req, res) => {
//     // Your existing getCart logic here
//     console.log("Sending cart response");
//     res.json(req.cart);
// });

// Middleware to get cart

const getCart = async (req, res, next) => {
    try {
        let userId;
        let isGuest = false;

        if (req.headers.authorization) {
            const token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            userId = decoded.id;
        } else {
            userId = req.headers['x-guest-id'] || uuidv4();
            isGuest = true;
            res.setHeader('X-Guest-ID', userId);
        }

        let cart = await Cart.findOne({ user: userId });
        if (!cart) {
            cart = new Cart({ user: userId, items: [], subtotal: 0, total: 0, isGuest });
        }

        // Parse the user field if it contains JSON data
        if (typeof cart.user === 'string' && cart.user.startsWith('{')) {
            try {
                const userData = JSON.parse(cart.user);
                if (userData.productId && userData.quantity) {
                    cart.items.push({
                        product: userData.productId,
                        quantity: parseInt(userData.quantity),
                        price: 0 // You'll need to fetch the actual price from the product
                    });
                    cart.user = userId; // Reset the user field to just the ID
                    await cart.save();
                }
            } catch (e) {
                console.error('Error parsing user data:', e);
            }
        }

        req.cart = cart;
        req.userId = userId;
        req.isGuest = isGuest;
        next();
    } catch (error) {
        res.status(500).json({ message: 'Error fetching cart', error: error.message });
    }
};

// Get user's cart
router.get('/', getCart, async (req, res) => {
    try {
        const populatedCart = await Cart.findById(req.cart._id).populate('items.product');
        res.json(populatedCart);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching populated cart', error: error.message });
    }
});

const sendProductAddedToCartEmail = async (user, product) => {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_ADDRESS,
            to: user.email,
            subject: "Product added to your cart",
            html: `
            <html>
              <body>
                <h1>New Item in Your Cart</h1>
                <p>Dear ${user.name},</p>
                <p>The product "${product.name}" has been added to your cart.</p>
                <p>Price: ${product.price.amount} ${product.price.currency}</p>
                <p>Visit our website to complete your purchase!</p>
              </body>
            </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Product added to cart email sent: ', info.response);
    } catch (error) {
        console.error('Error sending product added to cart email:', error);
    }
};

// Add item to cart
router.post('/add', getCart, async (req, res) => {
    try {
        const { productId, quantity } = req.body;
        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ message: 'Product not found' });
        }

        const existingItemIndex = req.cart.items.findIndex(item => item.product.toString() === productId);
        if (existingItemIndex > -1) {
            req.cart.items[existingItemIndex].quantity += quantity;
        } else {
            req.cart.items.push({ product: productId, quantity, price: product.price.amount });
        }

        req.cart.calculateTotal();
        await req.cart.save();
        // const user = await User.findById(req.user._id);
        // if (user && user.email) {
        //     await sendProductAddedToCartEmail(user, product);
        // }
        const populatedCart = await Cart.findById(req.cart._id).populate('items.product');
        res.json(populatedCart);
    } catch (error) {
        res.status(500).json({ message: 'Error adding item to cart', error: error.message });
    }
});

// Merge guest cart with user cart
router.post('/merge', async (req, res) => {
    try {
        let userId;
        const guestId = req.headers['x-guest-id'];

        if (req.headers.authorization) {
            const token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            userId = decoded.id;
        } else {
            return res.status(401).json({ message: 'Authentication required' });
        }

        if (!guestId || !userId) {
            return res.status(400).json({ message: 'Both guest ID and user authentication are required' });
        }

        console.log('Merging carts for guestId:', guestId, 'and userId:', userId);

        const guestCart = await Cart.findOne({ user: guestId, isGuest: true });
        let userCart = await Cart.findOne({ user: userId, isGuest: false });

        if (!userCart) {
            userCart = new Cart({ user: userId, items: [], subtotal: 0, total: 0, isGuest: false });
            console.log('Created new user cart:', userCart);
        }

        if (guestCart && guestCart.items.length > 0) {
            // Merge items from guest cart to user cart
            guestCart.items.forEach(guestItem => {
                const existingItemIndex = userCart.items.findIndex(
                    item => item.product.toString() === guestItem.product.toString()
                );

                if (existingItemIndex > -1) {
                    // If item exists, update quantity
                    userCart.items[existingItemIndex].quantity += guestItem.quantity;
                } else {
                    // If item doesn't exist, add it to user cart
                    userCart.items.push({
                        product: guestItem.product,
                        quantity: guestItem.quantity,
                        price: guestItem.price
                    });
                }
            });

            // Recalculate totals
            userCart.calculateTotal();
            await userCart.save();
            console.log('Merged cart:', userCart);

            // Delete the guest cart
            await Cart.deleteOne({ user: guestId, isGuest: true });
            console.log('Deleted guest cart');
        } else {
            console.log('No guest cart found or guest cart is empty');
        }

        const populatedCart = await Cart.findById(userCart._id).populate('items.product');
        res.json(populatedCart);
    } catch (error) {
        console.error('Error merging carts:', error);
        res.status(500).json({ message: 'Error merging carts', error: error.message });
    }
});

// Remove item from cart
router.post('/remove', passport.authenticate('jwt', { session: false }), getCart, async (req, res) => {
    try {
        const { productId } = req.body;
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({ message: 'Invalid product ID' });
        }

        req.cart.items = req.cart.items.filter(item => item.product._id.toString() !== productId);
        req.cart.calculateTotal();
        await req.cart.save();
        res.json(req.cart);
    } catch (error) {
        res.status(500).json({ message: 'Error removing item from cart', error: error.message });
    }
});

// Update item quantity
router.put('/update', passport.authenticate('jwt', { session: false }), getCart, async (req, res) => {
    try {
        const { productId, quantity } = req.body;
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).json({ message: 'Invalid product ID' });
        }

        const item = req.cart.items.find(item => item.product._id.toString() === productId);
        if (!item) {
            return res.status(404).json({ message: 'Item not found in cart' });
        }

        item.quantity = quantity;
        req.cart.calculateTotal();
        await req.cart.save();
        res.json(req.cart);
    } catch (error) {
        res.status(500).json({ message: 'Error updating item quantity', error: error.message });
    }
});

// Apply discount
router.post('/apply-discount', passport.authenticate('jwt', { session: false }), getCart, async (req, res) => {
    try {
        const { discountAmount } = req.body;
        const newTotal = req.cart.applyDiscount(discountAmount);
        await req.cart.save();
        res.json({
            message: 'Discount applied',
            subtotal: req.cart.subtotal,
            discount: req.cart.discount,
            newTotal,
            cart: req.cart
        });
    } catch (error) {
        res.status(500).json({ message: 'Error applying discount', error: error.message });
    }
});

// Clear cart

router.post('/clear', getCart, async (req, res) => {
    try {
        req.cart.items = [];
        req.cart.total = 0;
        req.cart.discount = 0;
        await req.cart.save();

        // Send email notification
        const user = await User.findById(req.user._id);
        if (user && user.email) {
            await sendCartClearedEmail(user);
        }

        res.json({ message: 'Cart cleared', cart: req.cart });
    } catch (error) {
        res.status(500).json({ message: 'Error clearing cart', error: error.message });
    }
});

const sendCartClearedEmail = async (user) => {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        const mailOptions = {
            from: process.env.EMAIL_ADDRESS,
            to: user.email,
            subject: "Your cart has been cleared",
            html: `
            <html>
              <body>
                <h1>Cart Cleared</h1>
                <p>Dear ${user.name},</p>
                <p>Your shopping cart has been cleared. If you didn't do this, please contact our customer support.</p>
              </body>
            </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Cart cleared email sent: ', info.response);
    } catch (error) {
        console.error('Error sending cart cleared email:', error);
    }
};

module.exports = router;