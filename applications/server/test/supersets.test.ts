import { describe, expect, it } from 'vitest';
import { foldText, fuzzyIncludes } from '../src/supersets.js';

describe('foldText', () => {
    it('folds case, punctuation runs, accents and full-width forms', () => {
        expect(foldText('Half-Life: Blue Shift')).toBe('half life blue shift');
        expect(foldText('  half  LIFE   blue shift ')).toBe('half life blue shift');
        expect(foldText('Pokémon Café')).toBe('pokemon cafe');
        expect(foldText('Ｆ－Ｚｅｒｏ')).toBe('f zero');
        expect(foldText('Chrono Trigger (Japan)')).toBe('chrono trigger japan');
    });

    it('keeps non-Latin scripts searchable', () => {
        expect(foldText('ゼルダの伝説')).toBe('ゼルダの伝説');
        expect(foldText('???')).toBe('');
    });
});

describe('fuzzyIncludes', () => {
    it('matches folded substrings', () => {
        expect(fuzzyIncludes('half life blue shift', 'half life blue shift')).toBe(true);
        expect(fuzzyIncludes('half life blue shift', 'blue shift')).toBe(true);
    });

    it('matches every word regardless of order', () => {
        expect(fuzzyIncludes('chrono trigger japan', 'trigger chrono')).toBe(true);
        expect(fuzzyIncludes('half life blue shift', 'shift half')).toBe(true);
    });

    it('rejects partial and empty queries', () => {
        expect(fuzzyIncludes('chrono trigger japan', 'final fantasy')).toBe(false);
        expect(fuzzyIncludes('chrono trigger japan', '')).toBe(false);
        expect(fuzzyIncludes('', 'chrono')).toBe(false);
    });
});
