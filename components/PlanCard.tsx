import React, { useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Animated } from 'react-native';
import { Image } from 'expo-image';
import { CalendarDays, Users, Check, Vote, Clock, X, MoreVertical, Crown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { DiningPlan } from '../types';
import { derivePlanPhase } from '../services/plans';
import StaticColors from '../constants/colors';
import { DEFAULT_AVATAR_URI } from '../constants/images';
import { useColors } from '../context/ThemeContext';
import SizzleShimmer from './SizzleShimmer';

const Colors = StaticColors;

interface PlanCardProps {
  plan: DiningPlan;
  currentUserId?: string;
  currentUserAvatarUri?: string;
  onPress?: () => void;
  onMorePress?: () => void;
  onRestaurantPress?: () => void;
}

const statusConfigStatic: Record<string, { label: string; icon: typeof Vote }> = {
  rsvp: { label: 'RSVP Open', icon: Clock },
  voting: { label: 'Voting', icon: Vote },
  confirmed: { label: 'Restaurant Set', icon: Check },
  completed: { label: 'Completed', icon: Clock },
  cancelled: { label: 'Cancelled', icon: X },
};

function getStatusColors(status: string, Colors: ReturnType<typeof useColors>) {
  switch (status) {
    case 'rsvp':
      return { color: Colors.primary, bg: Colors.primaryLight };
    case 'voting':
      return { color: Colors.secondary, bg: Colors.secondaryLight };
    case 'confirmed':
      return { color: Colors.success, bg: Colors.success + '18' };
    case 'completed':
      return { color: Colors.textTertiary, bg: Colors.textTertiary + '18' };
    case 'cancelled':
      return { color: Colors.error, bg: Colors.error + '18' };
    default:
      return { color: Colors.textTertiary, bg: Colors.textTertiary + '18' };
  }
}

function PlanCardFooter({ plan, currentUserId, currentUserAvatarUri }: { plan: DiningPlan; currentUserId?: string; currentUserAvatarUri?: string }) {
  const Colors = useColors(); // F-005-001: Module-level helper needs its own useColors()
  // Prefer the backend invites shape; fall back to legacy invitees
  if (plan.invites !== undefined) {
    const accepted = plan.invites.filter(i => i.status === 'accepted').length;
    const pending = plan.invites.filter(i => i.status === 'pending').length;

    // Always include owner in total — owner is implicitly "accepted"
    const totalMembers = plan.invites.length + 1;
    const acceptedCount = accepted + 1;

    const isCurrentUserOwner = currentUserId && plan.ownerId && currentUserId === plan.ownerId;
    const ownerAvatarUri = isCurrentUserOwner ? (currentUserAvatarUri ?? plan.ownerAvatarUri) : plan.ownerAvatarUri;

    // Build avatar list: owner first, then invitees
    const allAvatars: { key: string; uri?: string; status: string }[] = [
      { key: `owner-${plan.ownerId ?? 'host'}`, uri: ownerAvatarUri, status: 'accepted' },
      ...plan.invites.map(inv => ({
        key: inv.userId,
        uri: (currentUserId && inv.userId === currentUserId) ? (currentUserAvatarUri ?? inv.avatarUri) : inv.avatarUri,
        status: inv.status,
      })),
    ];

    return (
      <View style={[styles.footer, { borderTopColor: Colors.borderLight }]}>
        <View style={styles.footerParticipants}>
          <View style={styles.avatarsRow}>
            {allAvatars.slice(0, 5).map((av, i) => (
              <View key={`index-${i}`} style={[{ position: 'relative' }, i > 0 && { marginLeft: -8 }, i === 0 && { marginTop: 6 }]}>
                {i === 0 && (
                  <Crown size={14} color={Colors.star} fill={Colors.star} style={{ position: 'absolute', top: -8, alignSelf: 'center', zIndex: 1 }} />
                )}
                <View
                  style={[
                    styles.avatarContainer,
                    { borderColor: Colors.card },
                    av.status === 'accepted' && styles.avatarAccepted,
                    av.status === 'declined' && styles.avatarDeclined,
                  ]}
                >
                  <Image source={av.uri || DEFAULT_AVATAR_URI} style={styles.avatar} contentFit="cover" />
                </View>
              </View>
            ))}
            {allAvatars.length > 5 && (
              <View style={[styles.avatarContainer, { marginLeft: -8, backgroundColor: Colors.primaryLight }]}>
                <Text style={[styles.moreText, { color: Colors.primary }]}>+{allAvatars.length - 5}</Text>
              </View>
            )}
          </View>
          <View style={styles.inviteeInfo}>
            <Users size={13} color={Colors.textSecondary} />
            <Text style={[styles.inviteeText, { color: Colors.textSecondary }]}>
              {acceptedCount}/{totalMembers} accepted{pending > 0 ? ` · ${pending} pending` : ''}
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // Legacy invitees fallback
  const legacyInvitees = plan.invitees ?? [];
  if (legacyInvitees.length === 0) return null;
  return (
    <View style={[styles.footer, { borderTopColor: Colors.borderLight }]}>
      <View style={styles.avatarsRow}>
        {legacyInvitees.slice(0, 4).map((invitee, i) => (
          <View key={`index-${i}`} style={[styles.avatarContainer, { borderColor: Colors.card }, i > 0 && { marginLeft: -8 }]}>
            <Image source={{ uri: invitee.avatar }} style={styles.avatar} contentFit="cover" />
          </View>
        ))}
        {legacyInvitees.length > 4 && (
          <View style={[styles.avatarContainer, { marginLeft: -8, backgroundColor: Colors.primaryLight }]}>
            <Text style={[styles.moreText, { color: Colors.primary }]}>+{legacyInvitees.length - 4}</Text>
          </View>
        )}
      </View>
      <View style={styles.inviteeInfo}>
        <Users size={13} color={Colors.textSecondary} />
        <Text style={[styles.inviteeText, { color: Colors.textSecondary }]}>{legacyInvitees.length} people</Text>
      </View>
    </View>
  );
}

export default React.memo(function PlanCard({ plan, currentUserId, currentUserAvatarUri, onPress, onMorePress, onRestaurantPress }: PlanCardProps) {
  const Colors = useColors();
  // Derive display status for planned events
  const phase = derivePlanPhase(plan);
  const displayStatus = phase === 'rsvp_open' ? 'rsvp' : plan.status;
  const configStatic = statusConfigStatic[displayStatus] || statusConfigStatic[plan.status];
  const statusColors = getStatusColors(displayStatus, Colors);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const StatusIcon = configStatic.icon;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, { toValue: 1, friction: 3, useNativeDriver: true }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress?.();
  }, [onPress]);

  // plan.date is a 'YYYY-MM-DD' string. `new Date('YYYY-MM-DD')` parses as UTC
  // midnight, which renders as the *previous* day in negative-UTC timezones.
  // Build a local-time Date from the parts so the displayed day is correct.
  const formattedDate = (() => {
    if (!plan.date) return '';
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(plan.date);
    const localDate = parts
      ? new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
      : new Date(plan.date);
    return localDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  })();

  const a11yLabel = `${plan.title}, ${configStatic.label}${formattedDate ? `, ${formattedDate}` : ''}`;

  // Maestro flows can't tap a PlanCard by title text — the accessibilityLabel
  // above collapses children, so the bare title doesn't appear in the
  // text/title/value attributes Maestro searches. Embed the title slug in
  // the testID so flows can target a specific plan via
  // `plan-card-<id>-title-weekend-brunch` (regex-matchable). The legacy
  // `plan-card-<id>` prefix is preserved so existing `plan-card-.*` matches
  // still work.
  const titleSlug = plan.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return (
    <View
      testID={`plan-card-${plan.id}-title-${titleSlug}`}
      accessibilityLabel={a11yLabel}
      accessibilityRole="button"
    >
    <Pressable onPress={handlePress} onPressIn={handlePressIn} onPressOut={handlePressOut}>
      <SizzleShimmer>
      <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }], backgroundColor: Colors.card }]}>
        <View style={styles.header}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: Colors.text }]} numberOfLines={1}>{plan.title}</Text>
            <View style={styles.titleRowRight}>
              <View style={[styles.statusBadge, { backgroundColor: statusColors.bg }]}>
                <StatusIcon size={11} color={statusColors.color} />
                <Text style={[styles.statusText, { color: statusColors.color }]}>{configStatic.label}</Text>
              </View>
              {onMorePress && plan.status !== 'completed' && plan.status !== 'cancelled' && (
                <Pressable
                  style={[styles.editBtn, { backgroundColor: Colors.surfaceElevated }]}
                  onPress={e => { e.stopPropagation?.(); onMorePress(); }}
                  hitSlop={8}
                  testID="plan-more-btn"
                  accessibilityLabel="Plan options"
                  accessibilityRole="button"
                >
                  <MoreVertical size={16} color={Colors.textSecondary} />
                </Pressable>
              )}
            </View>
          </View>
          <View style={styles.metaRow}>
            {plan.type === 'group-swipe' ? (
              <>
                <Users size={13} color={Colors.textSecondary} />
                <Text style={[styles.metaText, { color: Colors.textSecondary }]}>Group Decision</Text>
              </>
            ) : (
              <>
                <CalendarDays size={13} color={Colors.textSecondary} />
                <Text style={[styles.metaText, { color: Colors.textSecondary }]}>{formattedDate}{plan.time ? ` at ${plan.time}` : ''}</Text>
              </>
            )}
          </View>
          {displayStatus === 'rsvp' && plan.rsvpDeadline && (
            <View style={styles.metaRow}>
              <Clock size={13} color={Colors.primary} />
              <Text style={[styles.metaText, { color: Colors.primary }]}>
                {(() => {
                  const deadline = new Date(plan.rsvpDeadline);
                  const hoursLeft = Math.max(0, Math.ceil((deadline.getTime() - Date.now()) / (1000 * 60 * 60)));
                  return hoursLeft > 0 ? `RSVP deadline in ${hoursLeft}h` : 'RSVP deadline passed';
                })()}
              </Text>
            </View>
          )}
          <View style={styles.metaRow}>
            <Text style={[styles.cuisineTag, { color: Colors.primary, backgroundColor: Colors.primaryLight }]}>{plan.cuisine}</Text>
            <Text style={[styles.budgetTag, { color: Colors.secondary, backgroundColor: Colors.secondaryLight }]}>{plan.budget}</Text>
          </View>
          {plan.type === 'group-swipe' && plan.status === 'voting' && currentUserId && (
            <Text style={{ fontSize: 12, color: Colors.textTertiary, marginTop: 2 }}>
              {plan.swipesCompleted?.includes(currentUserId)
                ? `Waiting for ${((plan.invites?.filter(i => i.status === 'accepted').length ?? 0) + 1) - (plan.swipesCompleted?.length ?? 0)} others...`
                : 'Tap to swipe'}
            </Text>
          )}
        </View>

        {plan.restaurant && (
          <Pressable
            onPress={e => { e.stopPropagation?.(); onRestaurantPress?.(); }}
            disabled={!onRestaurantPress}
          >
            <View style={[styles.restaurantPreview, { backgroundColor: Colors.surfaceElevated }]}>
              <Image source={{ uri: plan.restaurant.imageUrl }} style={styles.restaurantImage} contentFit="cover" />
              <View style={styles.restaurantInfo}>
                <Text style={[styles.restaurantName, { color: Colors.text }]} numberOfLines={1}>{plan.restaurant.name}</Text>
                <Text style={[styles.restaurantAddress, { color: Colors.textSecondary }]}>{plan.restaurant.address}</Text>
              </View>
            </View>
          </Pressable>
        )}

        <PlanCardFooter plan={plan} currentUserId={currentUserId} currentUserAvatarUri={currentUserAvatarUri} />
      </Animated.View>
      </SizzleShimmer>
    </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 10,
    elevation: 2,
  },
  header: {
    gap: 8,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  titleRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  editBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  metaText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  cuisineTag: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary,
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  budgetTag: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.secondary,
    backgroundColor: Colors.secondaryLight,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: 'hidden',
  },
  restaurantPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 12,
    marginTop: 12,
    overflow: 'hidden',
  },
  restaurantImage: {
    width: 56,
    height: 56,
  },
  restaurantInfo: {
    flex: 1,
    padding: 10,
  },
  restaurantName: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  restaurantAddress: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  footer: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  footerParticipants: {
    alignItems: 'flex-start',
    gap: 6,
  },
  avatarsRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  avatarContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.card,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  moreText: {
    fontSize: 10,
    fontWeight: '700' as const,
    color: Colors.primary,
  },
  avatarAccepted: {
    borderColor: Colors.success,
  },
  avatarDeclined: {
    opacity: 0.4,
  },
  inviteeInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inviteeText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
});
