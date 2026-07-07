import { describe, expect, it } from 'vitest';

import { getAppTabScreenOptions } from './app-tab-screen-options';

describe('getAppTabScreenOptions', () => {
  it('expands the web tab label box so descenders are not clipped', () => {
    expect(getAppTabScreenOptions('web').tabBarLabelStyle).toMatchObject({
      lineHeight: 14,
      minHeight: 14,
      paddingBottom: 3,
    });
  });

  it('keeps native tab labels on the shared baseline styles', () => {
    expect(getAppTabScreenOptions('native').tabBarLabelStyle).toMatchObject({
      lineHeight: 14,
      marginTop: 4,
    });
    expect(getAppTabScreenOptions('native').tabBarLabelStyle).not.toHaveProperty('minHeight');
    expect(getAppTabScreenOptions('native').tabBarLabelStyle).not.toHaveProperty('paddingBottom');
  });
});
