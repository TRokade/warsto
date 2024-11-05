// utils/validationUtils.js

const { addDays, isSunday, isAfter, startOfDay, parseISO } = require('date-fns');

const validateMeasurementSlot = (slot) => {
    if (!slot || !slot.date || !slot.timeRange) return false;

    const slotDate = parseISO(slot.date);
    const today = new Date();
    const minDate = addDays(today, 1);

    // Check if the date is valid (not a Sunday and at least 24 hours in advance)
    if (isSunday(slotDate) || !isAfter(startOfDay(slotDate), startOfDay(minDate))) {
        return false;
    }

    // Check if the time range is valid
    const validTimeRanges = ['morning', 'afternoon', 'evening'];
    if (!validTimeRanges.includes(slot.timeRange)) {
        return false;
    }

    return true;
};

module.exports = {
    validateMeasurementSlot
};