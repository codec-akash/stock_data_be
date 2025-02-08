
const { validateDateFormat } = require('./stock_controller');


describe('validateDateFormat', () => {
    test('handles valid ISO date strings', () => {
        const result = validateDateFormat('2024-03-20');
        expect(result).toBeInstanceOf(Date);
        expect(result.toISOString()).toContain('2024-03-20');
    });

    test('handles valid date with time', () => {
        const result = validateDateFormat('2024-03-20T10:30:00');
        expect(result).toBeInstanceOf(Date);
        expect(result.toISOString()).toContain('2024-03-20');
    });

    test('returns null for invalid dates', () => {
        expect(validateDateFormat('invalid-date')).toBeNull();
        expect(validateDateFormat('')).toBeNull();
        expect(validateDateFormat('2024-13-45')).toBeNull();
    });

    test('handles different date formats', () => {
        const result = validateDateFormat('20-Mar-2024');
        expect(result).toBeInstanceOf(Date);
        expect(result.toISOString()).toContain('2024-03-20');
    });

    test('handles Text date formats', () => {
        const result = validateDateFormat('31-JAN-2024');
        expect(result).toBeInstanceOf(Date);
        expect(result.toISOString()).toContain('2024-01-31');
    });


});