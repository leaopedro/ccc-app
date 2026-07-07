import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PremiumBadge } from '../premium-badge';

describe('PremiumBadge (admin web twin)', () => {
  describe('passive render gate', () => {
    it('renders nothing when isPremiumActive is false', () => {
      expect(renderToStaticMarkup(<PremiumBadge isPremiumActive={false} />)).toBe('');
    });

    it('renders nothing when isPremiumActive is null', () => {
      expect(renderToStaticMarkup(<PremiumBadge isPremiumActive={null} />)).toBe('');
    });

    it('renders nothing when isPremiumActive is undefined', () => {
      expect(renderToStaticMarkup(<PremiumBadge isPremiumActive={undefined} />)).toBe('');
    });
  });

  describe('tier label + contrast color', () => {
    it('renders Gold solid block with gold token color for tier=gold', () => {
      const html = renderToStaticMarkup(<PremiumBadge isPremiumActive={true} tier="gold" />);
      expect(html).toContain('Gold');
      // gold token = #E8B339
      expect(html.toLowerCase()).toContain('#e8b339');
      // text contrast color is locked to #0A0A0A
      expect(html.toLowerCase()).toContain('#0a0a0a');
    });

    it('renders Silver solid block with silver token color for tier=silver', () => {
      const html = renderToStaticMarkup(<PremiumBadge isPremiumActive={true} tier="silver" />);
      expect(html).toContain('Silver');
      expect(html.toLowerCase()).toContain('#d6d8dc');
    });

    it('renders Bronze solid block with bronze token color for tier=bronze', () => {
      const html = renderToStaticMarkup(<PremiumBadge isPremiumActive={true} tier="bronze" />);
      expect(html).toContain('Bronze');
      expect(html.toLowerCase()).toContain('#c58a52');
    });

    it('falls back to Premium label with brand color when no tier passed', () => {
      const html = renderToStaticMarkup(<PremiumBadge isPremiumActive={true} />);
      expect(html).toContain('Premium');
      // brand base = #D4AF37
      expect(html.toLowerCase()).toContain('#d4af37');
    });
  });

  describe('days-left suffix', () => {
    it('renders Nd suffix when daysLeftUntilExpiry is within (0, 7]', () => {
      const html = renderToStaticMarkup(
        <PremiumBadge isPremiumActive={true} tier="gold" daysLeftUntilExpiry={3} />,
      );
      expect(html).toContain('3d');
    });

    it('renders Nd suffix at boundary daysLeftUntilExpiry=7', () => {
      const html = renderToStaticMarkup(
        <PremiumBadge isPremiumActive={true} tier="gold" daysLeftUntilExpiry={7} />,
      );
      expect(html).toContain('7d');
    });

    it('renders Nd suffix at lower boundary daysLeftUntilExpiry=1', () => {
      const html = renderToStaticMarkup(
        <PremiumBadge isPremiumActive={true} tier="gold" daysLeftUntilExpiry={1} />,
      );
      expect(html).toContain('1d');
    });

    it('does not render Nd suffix when daysLeftUntilExpiry=0', () => {
      const html = renderToStaticMarkup(
        <PremiumBadge isPremiumActive={true} tier="gold" daysLeftUntilExpiry={0} />,
      );
      expect(html).not.toContain('0d');
    });

    it('does not render Nd suffix when daysLeftUntilExpiry>7', () => {
      const html = renderToStaticMarkup(
        <PremiumBadge isPremiumActive={true} tier="gold" daysLeftUntilExpiry={14} />,
      );
      expect(html).not.toContain('14d');
    });

    it('does not render Nd suffix when daysLeftUntilExpiry is null', () => {
      const html = renderToStaticMarkup(
        <PremiumBadge isPremiumActive={true} tier="gold" daysLeftUntilExpiry={null} />,
      );
      expect(html).not.toMatch(/\dd</);
    });
  });

  describe('interaction wrapper', () => {
    it('renders as <button> with aria-label when onPress is provided', () => {
      const html = renderToStaticMarkup(
        <PremiumBadge isPremiumActive={true} tier="gold" onPress={() => {}} />,
      );
      expect(html).toContain('<button');
      expect(html).toContain('type="button"');
      expect(html).toContain('aria-label="Premium Gold"');
    });

    it('renders as <span> wrapper with role="img" + aria-label when onPress is absent', () => {
      const html = renderToStaticMarkup(<PremiumBadge isPremiumActive={true} tier="silver" />);
      expect(html).toContain('aria-label="Premium Silver"');
      expect(html).toContain('role="img"');
      expect(html).not.toContain('<button');
    });
  });

  describe('border style', () => {
    it('renders an explicit solid border on the wrapper so HTML default border-style:none does not hide it', () => {
      const html = renderToStaticMarkup(<PremiumBadge isPremiumActive={true} tier="gold" />);
      expect(html.replace(/\s+/g, '')).toContain('border-style:solid');
    });
  });

  describe('size variants', () => {
    it('applies md height + font classes when size="md"', () => {
      const html = renderToStaticMarkup(
        <PremiumBadge isPremiumActive={true} tier="gold" size="md" />,
      );
      expect(html).toContain('h-7');
      expect(html).toContain('text-[11px]');
    });

    it('defaults to sm height + font classes', () => {
      const html = renderToStaticMarkup(<PremiumBadge isPremiumActive={true} tier="gold" />);
      expect(html).toContain('h-6');
      expect(html).toContain('text-[10px]');
    });
  });
});
