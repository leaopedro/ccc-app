import { brand } from '~/brand';

type AppTabPlatform = 'native' | 'web';

export function getAppTabScreenOptions(platform: AppTabPlatform) {
  const isWeb = platform === 'web';

  return {
    headerShown: false,
    tabBarActiveTintColor: brand.color.brand,
    tabBarInactiveTintColor: '#8A8A93',
    tabBarStyle: {
      backgroundColor: '#0a0a0a',
      borderTopColor: '#2A2A2A',
      borderTopWidth: 1,
      height: 84,
      paddingTop: 10,
      paddingBottom: 18,
    },
    tabBarLabelStyle: {
      fontFamily: 'Inter_500Medium',
      fontSize: 11,
      lineHeight: 14,
      letterSpacing: 0.4,
      marginTop: 4,
      ...(isWeb
        ? {
            minHeight: 14,
            paddingBottom: 3,
          }
        : null),
    },
    tabBarIconStyle: {
      marginBottom: 2,
    },
  } as const;
}
