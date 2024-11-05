const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const passport = require('passport');
const razorpay = require('../config/razorpay');
const crypto = require('crypto');
const jwt = require("jsonwebtoken")

const nodemailer = require('nodemailer');
// const Invoice = require('../../../client/components/Invoice'); // Assuming you've exported your Invoice component
const { renderToString } = require('@react-pdf/renderer');
const User = require('../models/User');
const PDFDocument = require('pdfkit');
const { validateMeasurementSlot } = require('../utils/validationUtils');
const { getAvailableSlots } = require('../utils/slotService');
const { addDays, startOfDay } = require('date-fns');

const isSlotAvailable = async (date, timeRange) => {
    const existingOrder = await Order.findOne({
        'measurementSlot.date': date,
        'measurementSlot.timeRange': timeRange
    });
    return !existingOrder;
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

router.get('/available-slots', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const startDate = new Date();
        const endDate = addDays(startDate, 14); // Fetch slots for the next 14 days

        const availableSlots = await getAvailableSlots(startDate, endDate);

        res.json(availableSlots);
    } catch (error) {
        console.error("Error fetching available slots:", error);
        res.status(500).json({ message: 'Error fetching available slots', error: error.message });
    }
});

router.post('/create-razorpay-order', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const { shippingAddress, billingAddress, deliveryOption, mobileNumber, measurementSlot } = req.body;

        // Validate mobile number
        if (!/^[6-9]\d{9}$/.test(mobileNumber)) {
            return res.status(400).json({ message: 'Invalid Indian mobile number.' });
        }

        // Validate measurement slot
        if (!measurementSlot || !measurementSlot.date || !measurementSlot.timeRange || !measurementSlot.startTime) {
            return res.status(400).json({ message: 'Invalid measurement slot.' });
        }

        const slotDate = new Date(measurementSlot.startTime);
        const now = new Date();
        if (slotDate <= addDays(now, 1)) {
            return res.status(400).json({ message: 'Measurement slot must be at least 24 hours in advance.' });
        }

        // Check slot availability
        const slotAvailable = await getAvailableSlots(now, slotDate);
        const isAvailable = slotAvailable.some(slot =>
            slot.date === measurementSlot.date && slot.timeRange === measurementSlot.timeRange
        );

        if (!isAvailable) {
            return res.status(400).json({ message: 'Selected measurement slot is not available.' });
        }

        const cart = await Cart.findOne({ user: req.user._id }).populate('items.product');
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        const calculateCartFee = () => {
            return cart ? cart.total * 0.02 : 0;
          };

        const deliveryFee = deliveryOption === 'express' ? calculateCartFee() : 0;
        const total = cart.total + deliveryFee;

        const options = {
            amount: total * 100,
            currency: "INR",
            receipt: "order_receipt_" + Date.now(),
            payment_capture: 1,
        };

        const razorpayOrder = await razorpay.orders.create(options);

        const order = new Order({
            user: req.user._id,
            items: cart.items.map(item => ({
                product: item.product._id,
                productName: item.product.name,
                quantity: item.quantity,
                price: item.price
            })),
            subtotal: cart.subtotal,
            discount: cart.discount,
            deliveryFee,
            total,
            shippingAddress,
            billingAddress,
            deliveryOption,
            mobileNumber,
            measurementSlot,
            razorpayOrderId: razorpayOrder.id
        });

        await order.save();

        res.json({
            orderId: razorpayOrder.id,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            order: order
        });
    } catch (error) {
        console.error("Error creating Razorpay order:", error, razorpayOrder);
        res.status(500).json({ message: 'Error creating Razorpay order', error: error.message });
    }
});


const generateInvoicePDF = (order, user) => {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument();
        let buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => {
            let pdfData = Buffer.concat(buffers);
            resolve(pdfData);
        });

        // Add content to PDF
        doc.fontSize(18).text('Invoice', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Name: ${user.name}`);
        doc.moveDown();
        doc.fontSize(12).text(`Email: ${user.email}`);
        doc.moveDown();
        doc.fontSize(12).text(`Order ID: ${order._id}`);
        doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString()}`);
        doc.moveDown();
        doc.text('Items:');
        order.items.forEach(item => {
            doc.text(`${item.productName} - Quantity: ${item.quantity} - Price: ₹${item.price * item.quantity}`);
        });
        doc.moveDown();
        doc.text(`Total: ₹${order.total}`);

        doc.end();
    });
};

const sendOrderConfirmationEmail = async (order, user) => {
    try {
        const transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.EMAIL_ADDRESS,
                pass: process.env.EMAIL_PASSWORD
            }
        });

        const invoicePdf = await generateInvoicePDF(order, user);

        const mailOptions = {
            from: process.env.EMAIL_ADDRESS,
            to: user.email,
            subject: "Thank you for your order!",
            html: `
            <html>
              <head>
                <style>
                  body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                  .container { width: 100%; max-width: 600px; margin: 0 auto; }
                  .header { background-color: #f4f4f4; padding: 20px; text-align: center; }
                  .content { padding: 20px; }
                  .order-summary { background-color: #f9f9f9; padding: 15px; margin-top: 20px; }
                  .button { display: inline-block; padding: 10px 20px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 5px; }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h1>Order Confirmation</h1>
                  </div>
                  <div class="content">
                    <p>Dear ${user.name},</p>
                    <p>Thank you for your order! We're pleased to confirm that we've received your purchase.</p>
                    <p><strong>Order Number:</strong> ${order._id}</p>
                    <p><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
                    <p><strong>Measurement Slot:</strong> ${order.measurementSlot.date.toLocaleDateString()} - ${order.measurementSlot.timeRange}</p>
                    <div class="order-summary">
                      <h2>Order Summary:</h2>
                      <ul>
                        ${order.items.map(item => `
                          <li>${item.productName} - Quantity: ${item.quantity} - Price: ₹${item.price * item.quantity}</li>
                        `).join('')}
                      </ul>
                      <p><strong>Total: ₹${order.total}</strong></p>
                    </div>
                    
                    <p>We're currently processing your order and will send you another email when it ships.</p>
                    <p>You can find your invoice attached to this email.</p>
                    
                  </div>
                </div>
              </body>
            </html>
          `,
            attachments: [
                {
                    filename: 'invoice.pdf',
                    content: invoicePdf,
                    contentType: 'application/pdf'
                }
            ]
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('Order confirmation email sent: ', info.response);
    } catch (error) {
        console.error('Error sending order confirmation email:', error);
    }
};
router.post('/verify-payment', async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

        const body = razorpay_order_id + "|" + razorpay_payment_id;

        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        const isAuthentic = expectedSignature === razorpay_signature;

        if (isAuthentic) {
            const order = await Order.findOne({ razorpayOrderId: razorpay_order_id });
            if (!order) {
                return res.status(404).json({ success: false, message: 'Order not found' });
            }

            order.status = 'Processing';
            order.paymentStatus = 'Paid';
            order.razorpayPaymentId = razorpay_payment_id;
            order.razorpaySignature = razorpay_signature;
            await order.save();

            await Cart.findOneAndUpdate({ user: order.user }, { $set: { items: [], total: 0, discount: 0 } });

            const user = await User.findById(order.user);
            if (user && user.email) {
                await sendOrderConfirmationEmail(order, user);
            }

            res.json({
                success: true,
                message: 'Payment has been verified and order confirmation email sent',
                order: order
            });
        } else {
            res.json({
                success: false,
                message: 'Payment verification failed'
            });
        }
    } catch (error) {
        console.error('Error in payment verification:', error);
        res.status(500).json({
            success: false,
            message: 'Internal Server Error',
            error: error.message
        });
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

// Get a specific order
router.get('/:id', passport.authenticate('jwt', { session: false }), async (req, res) => {
    try {
        const order = await Order.findOne({ _id: req.params.id, user: req.user._id });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json(order);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching order', error: error.message });
    }
});


module.exports = router;