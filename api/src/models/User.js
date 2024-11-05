const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    googleId: String,
    email: { type: String, unique: true, required: true },
    password: { type: String },
    name: String,
    mobileNumber: { type: String, unique: true },
    addresses: [{
        street: String,
        city: String,
        state: String,
        country: String,
        zipCode: String,
        isDefault: Boolean
    }],
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    resetPasswordToken: String,
    resetPasswordExpires: Date
}, { timestamps: true });

userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 10);
    next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
    return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);