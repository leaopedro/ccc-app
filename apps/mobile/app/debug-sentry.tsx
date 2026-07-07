import * as Sentry from '@sentry/react-native';
import { Redirect } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { theme } from '~/theme';

export default function SentryDebugScreen() {
  if (!__DEV__) return <Redirect href="/welcome" />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sentry Debug</Text>
      <TouchableOpacity
        style={styles.button}
        onPress={() => {
          Sentry.captureException(new Error('Sentry test error from mobile — intentional'));
        }}
      >
        <Text style={styles.buttonText}>Capture test error</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.bg,
    gap: 24,
  },
  title: {
    color: theme.colors.fg,
    fontSize: 18,
    fontWeight: '600',
  },
  button: {
    backgroundColor: theme.colors.accent,
    borderRadius: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
});
