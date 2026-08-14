import { brand } from '@ccc/design';
import { privacyPolicySections, PRIVACY_POLICY_VERSION } from '@ccc/shared/legal';
import { Text } from '@ccc/ui';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, SafeAreaView, ScrollView, View } from 'react-native';

import { PolicyBody } from '~/legal/PolicyBody';

export default function PrivacidadeScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0a0a0a' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 20,
          paddingTop: 16,
          paddingBottom: 8,
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
          hitSlop={8}
          style={{
            height: 44,
            width: 44,
            alignItems: 'center',
            justifyContent: 'center',
            marginLeft: -8,
          }}
        >
          <ArrowLeft color="#F5F5F5" size={24} strokeWidth={1.75} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text variant="bodySm" tone="muted">
            {brand.name}
          </Text>
          <Text variant="h3" weight="bold">
            Política de privacidade
          </Text>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
      >
        <Text variant="caption" tone="muted" style={{ marginBottom: 24 }}>
          Versão: {PRIVACY_POLICY_VERSION}
        </Text>

        {privacyPolicySections.map((section) => (
          <View key={section.id} style={{ marginBottom: 28 }}>
            <Text variant="body" weight="semibold" style={{ marginBottom: 8 }}>
              {section.title}
            </Text>
            <PolicyBody text={section.body} />
          </View>
        ))}

        <View
          style={{ borderTopWidth: 1, borderTopColor: '#2a2a2a', paddingTop: 16, marginTop: 8 }}
        >
          <Text variant="caption" tone="muted">
            Dúvidas? Fale com nosso Encarregado:{'\n'}
            {brand.contact.privacyEmail}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
