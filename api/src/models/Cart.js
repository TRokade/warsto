const mongoose = require('mongoose');

const CartItemSchema = new mongoose.Schema({
    product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    quantity: { type: Number, required: true, min: 1 },
    price: { type: Number, required: true },
});

const CartSchema = new mongoose.Schema({
    user: { type: String, required: true },
    items: [CartItemSchema],
    subtotal: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    isGuest: { type: Boolean, default: false },
}, { timestamps: true });

CartSchema.methods.calculateTotal = function () {
    this.subtotal = this.items.reduce((total, item) => total + (item.price * item.quantity), 0);
    this.total = Math.max(0, this.subtotal - this.discount);
    return this.total;
};

CartSchema.methods.applyDiscount = function (discountAmount) {
    this.discount = discountAmount;
    return this.calculateTotals();
};

module.exports = mongoose.model('Cart', CartSchema);