const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const passport = require('passport');
const razorpay = require('../config/razorpay');
const crypto = require('crypto');
const jwt = require("jsonwebtoken");
const nodemailer = require('nodemailer');

// Middleware to check if the user is an admin
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Access denied' });
    }
    next();
};

// Create a new order
router.post('/', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { mobileNumber, shippingAddress } = req.body;

        // Validate mobile number
        if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
            return res.status(400).json({ message: 'Invalid Indian mobile number. Please enter a 10-digit number starting with 6, 7, 8, or 9.' });
        }

        const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        const order = new Order({
            user: req.user._id,
            items: cart.items.map(item => ({
                product: item.product._id,
                quantity: item.quantity,
                price: item.price
            })),
            subtotal: cart.subtotal,
            discount: cart.discount,
            total: cart.total,
            shippingAddress,
            mobileNumber
        });

        await order.save();

        // Clear the cart
        cart.items = [];
        cart.subtotal = 0;
        cart.discount = 0;
        cart.total = 0;
        await cart.save();

        res.status(201).json({
            message: 'Order created successfully',
            order: order
        });
    } catch (error) {
        res.status(500).json({ message: 'Error creating order', error: error.message });
    }
});

// Get all orders (admin only)
router.get('/', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const filter = {};
        if (req.query.status) filter.status = req.query.status;
        if (req.query.minTotal) filter.total = { $gte: parseFloat(req.query.minTotal) };
        if (req.query.maxTotal) filter.total = { ...filter.total, $lte: parseFloat(req.query.maxTotal) };
        if (req.query.paymentStatus) filter.paymentStatus = req.query.paymentStatus;

        const orders = await Order.find(filter)
            .sort('-createdAt')
            .skip(skip)
            .limit(limit)
            .populate('user', 'name email');

        const totalOrders = await Order.countDocuments(filter);
        const totalPages = Math.ceil(totalOrders / limit);

        res.json({
            orders,
            currentPage: page,
            totalPages,
            totalOrders
        });
    } catch (error) {
        res.status(500).json({ message: 'Error fetching orders', error: error.message });
    }
});

// Get a specific order (admin only)
router.get('/:id', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id).populate('user', 'name email');
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching order', error: error.message });
    }
});

const sendOrderUpdateEmail = async (order, user) => {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        let reviewLink = '';
        if (order.status === 'Delivered') {
            const token = jwt.sign({ userId: user._id, orderId: order._id }, process.env.JWT_SECRET, { expiresIn: '7d' });
            reviewLink = `${process.env.FRONTEND_URL}/order-review?orderId=${order._id}&token=${token}`;
        }

        const mailOptions = {
            from: process.env.EMAIL_ADDRESS,
            to: user.email,
            subject: `Order Status Update - ${order.status}`,
            html: `
                <html>
                  <head>
                    <style>
                      body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                      .container { width: 100%; max-width: 600px; margin: 0 auto; }
                      .header { background-color: #f4f4f4; padding: 20px; text-align: center; }
                      .content { padding: 20px; }
                    </style>
                  </head>
             <body>
            <div class="container">
              <div class="header">
                <h1>Order Status Update</h1>
              </div>
              <div class="content">
                <p>Dear ${user.name},</p>
                <p>Your order status has been updated.</p>
                <p><strong>Order Number:</strong> ${order._id}</p>
                <div class="order-summary">
                  <h4>Order Summary:</h4>
                  <ul>
                    ${order.items.map(item => `
                      <li>${item.productName} - Quantity: ${item.quantity} - Price: ₹${item.price * item.quantity}</li>
                    `).join('')}
                  </ul>
                  <p><strong>Total: ₹${order.total}</strong></p>
                </div>
                <p><strong>New Status:</strong> ${order.status}</p>
                ${order.status === 'Delivered' ? `
                  <p>We'd love to hear your thoughts on the products you received. Please click the link below to leave a review:</p>
                  <p><a href="${reviewLink}">Review Your Order</a></p>
                ` : ''}
                <p>If you have any questions about your order, please don't hesitate to contact us.</p>
                <p>Thank you for shopping with us!</p>
              </div>
            </div>
          </body>
                </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Order update email sent: ', info.response);
    } catch (error) {
        console.error('Error sending order update email:', error);
    }
};

// In your orders.js API file
router.put('/:id/status', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const { status, paymentStatus } = req.body;
        const updateData = {};
        if (status) updateData.status = status;
        if (paymentStatus) updateData.paymentStatus = paymentStatus;

        const order = await Order.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        ).populate('user');

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        // Send email notification
        if (order.user && order.user.email) {
            await sendOrderUpdateEmail(order, order.user);
        }

        res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Error updating order status', error: error.message });
    }
});

// update payment details
router.put('/:id/payment', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;
        const order = await Order.findByIdAndUpdate(
            req.params.id,
            {
                razorpayOrderId,
                razorpayPaymentId,
                razorpaySignature,
                paymentStatus: 'Paid'
            },
            { new: true }
        );

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Error updating payment details', error: error.message });
    }
});

// Delete an order (admin only)
router.delete('/:id', passport.authenticate('jwt', { session: false }), isAdmin, async (req, res) => {
    try {
        const order = await Order.findByIdAndDelete(req.params.id);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json({ message: 'Order deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Error deleting order', error: error.message });
    }
});

// Get user's order history
router.get('/history', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user._id }).sort('-createdAt');
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching order history', error: error.message });
    }
});



module.exports = router;

/*

GET /orders

GET /orders/123456789

PUT /orders/123456789/status
{
  "status": "shipped"
}

*/