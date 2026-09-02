import type { PublicProfile } from '@ccc/shared/profile';
import { PremiumBadge } from '@ccc/ui';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  Bell,
  BellDot,
  CarFront,
  ChevronRight,
  Gem,
  LogOut,
  MapPinned,
  MessageCircle,
  Package,
  PencilLine,
  ShieldCheck,
  Ticket,
} from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getProfile, updateProfile } from '~/api/profile';
import { useAuth } from '~/auth/context';
import { authCopy } from '~/copy/auth';
import { notificationsCopy } from '~/copy/notifications';
import { profileCopy } from '~/copy/profile';
import { usePremiumPlans } from '~/hooks/usePremiumPlans';
import { usePremiumSubscription } from '~/hooks/usePremiumSubscription';
import { useUnreadCount } from '~/hooks/useUnreadCount';
import { pickAndUpload } from '~/lib/upload-image';
import { PREMIUM_BILLING_ENABLED } from '~/lib/premium-runtime';
import { theme } from '~/theme';

type MenuRowProps = {
  icon: ReactNode;
  label: string;
  hint: string;
  onPress: () => void;
  accent?: boolean;
};

function MenuRow({ icon, label, hint, onPress, accent = false }: MenuRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: theme.spacing.lg,
        marginBottom: theme.spacing.sm,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: accent ? '#3A1818' : '#2A2A30',
        backgroundColor: '#111217',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          flex: 1,
          minWidth: 0,
        }}
      >
        <View style={[styles.menuIconWrap, accent ? styles.menuIconWrapDanger : null]}>{icon}</View>
        <View style={{ flex: 1, minWidth: 0, marginRight: theme.spacing.sm }}>
          <Text style={[styles.menuLabel, accent ? styles.menuLabelDanger : null]}>{label}</Text>
          <Text style={styles.menuHint}>{hint}</Text>
        </View>
      </View>
      <ChevronRight
        color={accent ? theme.colors.accent : theme.colors.muted}
        size={18}
        strokeWidth={1.75}
      />
    </Pressable>
  );
}

export default function ProfileMenuScreen() {
  const { logout } = useAuth();
  const router = useRouter();
  const { count: unreadCount } = useUnreadCount(true);
  const { subscription } = usePremiumSubscription();
  // Platform gate (final review, Critical 1) — the same reasoning as
  // SubscriptionSection on /inicio: this row leads to /assinaturas, a NEW
  // purchase entry point, and /inicio is the gate's own redirect target. A
  // gated build must not offer a second path back to itself.
  const { subscriptionsEnabled } = usePremiumPlans();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = (msg: string) => {
    if (bannerTimer.current) clearTimeout(bannerTimer.current);
    setBanner(msg);
    bannerTimer.current = setTimeout(() => setBanner(null), 3000);
  };

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      setProfile(await getProfile());
    } catch {
      showBanner(profileCopy.profile.loadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile]),
  );

  const onChangeAvatar = async () => {
    setUploading(true);
    try {
      const up = await pickAndUpload('avatar');
      if (!up) return;
      const updated = await updateProfile({ avatarObjectKey: up.presign.objectKey });
      setProfile(updated);
    } catch {
      showBanner(profileCopy.errors.unknown);
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.banner}>{profileCopy.profile.loadFailed}</Text>
      </View>
    );
  }

  const location = [profile.city, profile.stateCode].filter(Boolean).join(' / ');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable
        onPress={() => void onChangeAvatar()}
        style={styles.heroCard}
        accessibilityRole="button"
        accessibilityLabel={
          uploading ? profileCopy.profile.avatarUploading : profileCopy.profile.avatarChange
        }
        accessibilityState={{ busy: uploading }}
      >
        {profile.avatarUrl ? (
          <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} accessible={false} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]} />
        )}
        <View style={styles.heroText}>
          <Text style={styles.name}>{profile.name}</Text>
          <Text style={styles.meta}>{profile.email}</Text>
          {location ? <Text style={styles.meta}>{location}</Text> : null}
          {subscription?.active && subscription.tier ? (
            <View style={styles.premiumRow}>
              <PremiumBadge isPremiumActive tier={subscription.tier} />
              <Text style={styles.premiumLabel}>
                {profileCopy.profile.memberTier(subscription.tier)}
              </Text>
            </View>
          ) : null}
          <Text style={styles.avatarLink}>
            {uploading ? profileCopy.profile.avatarUploading : profileCopy.profile.avatarChange}
          </Text>
        </View>
      </Pressable>

      <Text style={styles.subtitle}>{profileCopy.menu.subtitle}</Text>

      {banner ? <Text style={styles.banner}>{banner}</Text> : null}

      <View style={styles.menuList}>
        <MenuRow
          icon={<PencilLine color={theme.colors.fg} size={18} strokeWidth={1.75} />}
          label={profileCopy.profile.editDetails}
          hint={profileCopy.menu.editHint}
          onPress={() => router.push('/profile/edit' as never)}
        />
        <MenuRow
          icon={
            <BellDot
              color={unreadCount > 0 ? theme.colors.accent : theme.colors.fg}
              size={18}
              strokeWidth={1.75}
            />
          }
          label={notificationsCopy.menu.label}
          hint={notificationsCopy.menu.hint}
          onPress={() => router.push('/notifications' as never)}
        />
        <MenuRow
          icon={<Bell color={theme.colors.fg} size={18} strokeWidth={1.75} />}
          label={profileCopy.menu.pushPreferences}
          hint={profileCopy.menu.pushPreferencesHint}
          onPress={() => router.push('/profile/push-preferences' as never)}
        />
        <MenuRow
          icon={<Package color={theme.colors.fg} size={18} strokeWidth={1.75} />}
          label={profileCopy.menu.orders}
          hint={profileCopy.menu.ordersHint}
          onPress={() => router.push('/profile/orders' as never)}
        />
        <MenuRow
          icon={<MapPinned color={theme.colors.fg} size={18} strokeWidth={1.75} />}
          label={profileCopy.menu.shipping}
          hint={profileCopy.menu.shippingHint}
          onPress={() => router.push('/profile/shipping' as never)}
        />
        <MenuRow
          icon={<Ticket color={theme.colors.fg} size={18} strokeWidth={1.75} />}
          label={profileCopy.menu.tickets}
          hint={profileCopy.menu.ticketsHint}
          onPress={() => router.push('/tickets' as never)}
        />
        <MenuRow
          icon={<CarFront color={theme.colors.fg} size={18} strokeWidth={1.75} />}
          label={profileCopy.menu.garage}
          hint={profileCopy.menu.garageHint}
          onPress={() => router.push('/profile/garage' as never)}
        />
        {/* Gated on the same flag as the tab bar. The tab was already hidden when
            billing is off, but this row was not, so the billing-unavailable
            placeholder stayed two taps from the Profile tab — placeholder content
            on a primary path is an App Store 2.1 rejection. */}
        {PREMIUM_BILLING_ENABLED && subscriptionsEnabled ? (
          <MenuRow
            icon={<Gem color={theme.colors.fg} size={18} strokeWidth={1.75} />}
            label={profileCopy.menu.assinatura}
            hint={profileCopy.menu.assinaturaHint}
            onPress={() => router.push('/assinaturas' as never)}
          />
        ) : null}
        <MenuRow
          icon={<MessageCircle color={theme.colors.fg} size={18} strokeWidth={1.75} />}
          label={profileCopy.menu.support}
          hint={profileCopy.menu.supportHint}
          onPress={() => router.push('/profile/support' as never)}
        />
        <MenuRow
          icon={<ShieldCheck color={theme.colors.fg} size={18} strokeWidth={1.75} />}
          label={profileCopy.menu.privacy}
          hint={profileCopy.menu.privacyHint}
          onPress={() => router.push('/profile/privacy' as never)}
        />
        <MenuRow
          icon={<LogOut color={theme.colors.accent} size={18} strokeWidth={1.75} />}
          label={authCopy.common.logout}
          hint={profileCopy.menu.logoutHint}
          onPress={() => void logout()}
          accent
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing.xl,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: theme.colors.bg,
  },
  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: '#111217',
  },
  avatar: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: { backgroundColor: theme.colors.muted },
  heroText: { flex: 1, gap: theme.spacing.xs },
  name: { color: theme.colors.fg, fontSize: theme.font.size.xl, fontWeight: '700' },
  meta: { color: theme.colors.muted, fontSize: theme.font.size.md },
  premiumRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  premiumLabel: { color: theme.colors.fg, fontSize: 12, fontWeight: '600' },
  avatarLink: {
    marginTop: theme.spacing.sm,
    color: theme.colors.fg,
    textDecorationLine: 'underline',
    fontSize: theme.font.size.md,
  },
  subtitle: { color: theme.colors.muted, fontSize: theme.font.size.md },
  banner: { color: theme.colors.muted },
  menuList: { marginTop: theme.spacing.sm },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.lg,
    marginBottom: theme.spacing.sm,
    borderRadius: theme.radii.lg,
    borderWidth: 1,
    borderColor: '#2A2A30',
    backgroundColor: '#111217',
  },
  menuRowPressed: { opacity: 0.82 },
  menuRowDanger: { borderColor: '#3A1818' },
  menuLead: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  menuIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1A1C23',
    marginRight: theme.spacing.md,
  },
  menuIconWrapDanger: { backgroundColor: '#261012' },
  menuText: { flex: 1, flexShrink: 1, minWidth: 0, marginRight: theme.spacing.sm },
  menuLabel: { color: theme.colors.fg, fontSize: theme.font.size.lg, fontWeight: '600' },
  menuLabelDanger: { color: theme.colors.accent },
  menuHint: { color: theme.colors.muted, fontSize: theme.font.size.md },
});
