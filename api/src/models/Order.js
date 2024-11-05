const mongoose = require('mongoose');

const AddressSchema = new mongoose.Schema({
    street: String,
    city: String,
    state: String,
    country: String,
    zipCode: String,
});

const OrderItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
});

const MeasurementSlotSchema = new mongoose.Schema({
    date: { type: Date, required: true },
    timeRange: {
        type: String,
        enum: ['10:00 - 12:00', '12:00 - 14:00', '14:00 - 16:00', '16:00 - 18:00'],
        required: true
    }
});

const OrderSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    items: [OrderItemSchema],
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    total: { type: Number, required: true },
    status: { type: String, enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled'], default: 'Pending' },
    shippingAddress: AddressSchema,
    billingAddress: AddressSchema,
    deliveryOption: { type: String, enum: ['standard', 'express'], default: 'standard' },
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Failed'], default: 'Pending' },
    measurementSlot: {
        type: MeasurementSlotSchema,
        required: true
    },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    mobileNumber: {
        type: String,
        validate: {
            validator: function (v) {
                return /^[6-9]\d{9}$/.test(v);
            },
            message: props => `${props.value} is not a valid Indian mobile number!`
        }
    },
}, { timestamps: true });

module.exports = mongoose.model('Order', OrderSchema);