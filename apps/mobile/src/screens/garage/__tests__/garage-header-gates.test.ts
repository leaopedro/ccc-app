import { describe, expect, it } from 'vitest';

import { hasExtraSpots, showExpiredPremiumNotice, showWelcomeBanner } from '../garage-header-gates';

import {
  garageReadFixtureAllFilled,
  garageReadFixtureEmptyFirstRun,
  garageReadFixtureMixed,
} from './fixtures';

import type { GarageReadResponse } from '~/api/garage';

const withGarage = (
  base: GarageReadResponse,
  patch: Partial<GarageReadResponse['garage']>,
): GarageReadResponse => ({
  ...base,
  garage: { ...base.garage, ...patch },
});

const ISO = '2026-05-20T12:00:00.000Z';

describe('garage-header-gates', () => {
  describe('showWelcomeBanner', () => {
    it('renders for a fresh (empty + never-premium) garage', () => {
      expect(showWelcomeBanner(garageReadFixtureEmptyFirstRun)).toBe(true);
    });

    it('suppresses when the garage already has cars', () => {
      expect(showWelcomeBanner(garageReadFixtureMixed)).toBe(false);
      expect(showWelcomeBanner(garageReadFixtureAllFilled)).toBe(false);
    });

    it('suppresses for a brand-new active-premium owner with zero cars', () => {
      const fixture = withGarage(garageReadFixtureEmptyFirstRun, {
        premiumTier: 'gold',
        premiumUntil: '2027-01-01T00:00:00.000Z',
        isPremiumActive: true,
        daysLeftUntilExpiry: 200,
      });
      expect(showWelcomeBanner(fixture)).toBe(false);
    });

    it('suppresses for a lapsed-premium owner with zero cars (premiumTier !== null wins)', () => {
      const fixture = withGarage(garageReadFixtureEmptyFirstRun, {
        premiumTier: 'silver',
        premiumUntil: '2025-01-01T00:00:00.000Z',
        isPremiumActive: false,
        daysLeftUntilExpiry: 0,
      });
      expect(showWelcomeBanner(fixture)).toBe(false);
    });
  });

  describe('showExpiredPremiumNotice', () => {
    it('renders for a lapsed premium garage (premiumTier !== null && !isPremiumActive)', () => {
      const fixture = withGarage(garageReadFixtureAllFilled, {
        premiumTier: 'bronze',
        premiumUntil: '2025-01-01T00:00:00.000Z',
        isPremiumActive: false,
        daysLeftUntilExpiry: 0,
      });
      expect(showExpiredPremiumNotice(fixture)).toBe(true);
    });

    it('does NOT render for an active premium owner whose membership expires today', () => {
      const fixture = withGarage(garageReadFixtureAllFilled, {
        premiumTier: 'gold',
        premiumUntil: ISO,
        isPremiumActive: true,
        daysLeftUntilExpiry: 0,
      });
      expect(showExpiredPremiumNotice(fixture)).toBe(false);
    });

    it('does NOT render for an active premium owner with days remaining', () => {
      const fixture = withGarage(garageReadFixtureAllFilled, {
        premiumTier: 'gold',
        premiumUntil: '2027-01-01T00:00:00.000Z',
        isPremiumActive: true,
        daysLeftUntilExpiry: 200,
      });
      expect(showExpiredPremiumNotice(fixture)).toBe(false);
    });

    it('does NOT render for a never-premium owner', () => {
      expect(showExpiredPremiumNotice(garageReadFixtureEmptyFirstRun)).toBe(false);
      expect(showExpiredPremiumNotice(garageReadFixtureMixed)).toBe(false);
    });
  });

  describe('welcome + expired mutual-exclusivity', () => {
    it('the two gates never both return true for the same input', () => {
      const fixtures: GarageReadResponse[] = [
        garageReadFixtureEmptyFirstRun,
        garageReadFixtureMixed,
        garageReadFixtureAllFilled,
        withGarage(garageReadFixtureEmptyFirstRun, {
          premiumTier: 'bronze',
          premiumUntil: '2025-01-01T00:00:00.000Z',
          isPremiumActive: false,
          daysLeftUntilExpiry: 0,
        }),
        withGarage(garageReadFixtureAllFilled, {
          premiumTier: 'gold',
          premiumUntil: '2027-01-01T00:00:00.000Z',
          isPremiumActive: true,
          daysLeftUntilExpiry: 100,
        }),
      ];
      for (const f of fixtures) {
        expect(showWelcomeBanner(f) && showExpiredPremiumNotice(f)).toBe(false);
      }
    });
  });

  describe('hasExtraSpots', () => {
    it('false when only default_free spots exist', () => {
      expect(hasExtraSpots(garageReadFixtureEmptyFirstRun)).toBe(false);
    });

    it('true when at least one purchase/admin_grant/premium_membership spot exists', () => {
      expect(hasExtraSpots(garageReadFixtureMixed)).toBe(true);
      expect(hasExtraSpots(garageReadFixtureAllFilled)).toBe(true);
    });
  });
});
