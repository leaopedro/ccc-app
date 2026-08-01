import { Stack } from 'expo-router';

// Assinaturas renders its own in-screen header (per the design handoff), so the
// native stack header is hidden — mirrors the standalone-stack pattern used by
// the garage flow.
export default function AssinaturasLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
