// slotService.js
const { addDays, startOfDay, endOfDay, eachDayOfInterval, isSunday, format, isAfter } = require('date-fns');
const Order = require('../models/Order');

const SLOT_TIMES = [
    { start: '10:00', end: '12:00' },
    { start: '12:00', end: '14:00' },
    { start: '14:00', end: '16:00' },
    { start: '16:00', end: '18:00' },
];

const HOLIDAYS = [
    '2024-01-01',
    '2024-01-26',
    '2024-08-15',
    '2024-10-02',
];

const isHoliday = (date) => HOLIDAYS.includes(format(date, 'yyyy-MM-dd'));

const getAvailableSlots = async (startDate, endDate) => {
    const start = startOfDay(addDays(new Date(startDate), 1));
    const end = endOfDay(new Date(endDate));

    const dateRange = eachDayOfInterval({ start, end });
    const availableSlots = [];

    for (const date of dateRange) {
        if (isSunday(date) || isHoliday(date)) continue;

        for (const slot of SLOT_TIMES) {
            const slotStart = new Date(`${format(date, 'yyyy-MM-dd')}T${slot.start}:00`);
            const slotEnd = new Date(`${format(date, 'yyyy-MM-dd')}T${slot.end}:00`);

            // Only include slots that are at least 24 hours in the future
            if (isAfter(slotStart, addDays(new Date(), 1))) {
                const isBooked = await Order.findOne({
                    'measurementSlot.date': format(date, 'yyyy-MM-dd'),
                    'measurementSlot.timeRange': `${slot.start} - ${slot.end}`
                });

                if (!isBooked) {
                    availableSlots.push({
                        date: format(date, 'yyyy-MM-dd'),
                        timeRange: `${slot.start} - ${slot.end}`,
                        startTime: slotStart.toISOString(),
                        endTime: slotEnd.toISOString()
                    });
                }
            }
        }
    }

    return availableSlots;
};
module.exports = { getAvailableSlots };