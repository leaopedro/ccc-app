import { Stack } from 'expo-router';

// Caixa renders its own in-screen header on every state (per the design
// handoff), so the native stack header is hidden — mirrors the
// assinaturas/_layout.tsx pattern.
export default function CaixaLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
