/**
 * plan-detail.tsx — Full-screen plan detail hub (#40)
 *
 * Single file with module-level helper components per CLAUDE.md convention.
 * Every module-level helper that returns JSX calls useColors() in its own body.
 * Architecture: .feature-dev/2026-06-04-plan-detail-screen/agents/architecture-blueprint.md
 * Amendments: architecture-blueprint-v2.md (v2 wins on all conflicts)
 */
import React, {
  useState,
  useMemo,
  useEffect,
  useCallback,
} from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  Alert,
  ActivityIndicator,
  AccessibilityInfo,
  Dimensions,
} from 'react-native';
import AppText from '@/components/AppText';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Users,
  Star,
  ChevronRight,
  Vote,
  Check,
  X,
  Crown,
  MoreVertical,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { useApp } from '../context/AppContext';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';
import PlanActionSheet from '../components/PlanActionSheet';
import { ClosedWinnerFlag } from '../components/ClosedWinnerSheet';
import SizzleShimmer from '../components/SizzleShimmer';
import CrumbParticles, {
  createBurst,
  animateBurst,
  CrumbBurst,
} from '../components/CrumbParticles';
import {
  getPlan,
  rsvpPlan,
  cancelPlan,
  completePlan,
  delegateOrganizer,
  leavePlan,
  derivePlanPhase,
  requestToJoin,
  approveJoinRequest,
  denyJoinRequest,
} from '../services/plans';
import { blockUser, reportTarget, REPORT_REASON_LABELS } from '../services/moderation';
import { formatPlanDate } from '../lib/planDateTime';
import { formatTimeUntilDeadline } from '../lib/rsvpDeadline';
import { DEFAULT_AVATAR_URI } from '../constants/images';
import { DiningPlan, PlanJoinRequest, PlanPhase } from '../types';
import Snackbar from '@/components/Snackbar';

// Module-level Colors for StyleSheet.create()
const Colors = StaticColors;

// ---------------------------------------------------------------------------
// Local interfaces
// ---------------------------------------------------------------------------

interface AttendeeMember {
  userId: string;
  name: string;
  avatarUri?: string;
  status: 'accepted' | 'pending' | 'declined' | 'owner';
  isCurrentUser: boolean;
}

// ---------------------------------------------------------------------------
// LOCAL COPY of statusConfigStatic / getStatusColors (not exported from PlanCard)
// ---------------------------------------------------------------------------

const statusConfigStatic: Record<string, { label: string; icon: typeof Vote }> = {
  rsvp: { label: 'RSVP Open', icon: Clock },
  voting: { label: 'Voting', icon: Vote },
  confirmed: { label: 'Restaurant Set', icon: Check },
  completed: { label: 'Completed', icon: Clock },
  cancelled: { label: 'Cancelled', icon: X },
};

function getStatusColors(status: string, C: ReturnType<typeof useColors>) {
  switch (status) {
    case 'rsvp':      return { color: C.primary,      bg: C.primaryLight };
    case 'voting':    return { color: C.secondary,    bg: C.secondaryLight };
    case 'confirmed': return { color: C.success,      bg: C.success + '18' };
    case 'completed': return { color: C.textTertiary, bg: C.textTertiary + '18' };
    case 'cancelled': return { color: C.error,        bg: C.error + '18' };
    default:          return { color: C.textTertiary, bg: C.textTertiary + '18' };
  }
}

// Map PlanPhase to statusConfigStatic key
function phaseToStatusKey(phase: PlanPhase): string {
  switch (phase) {
    case 'rsvp_open':    return 'rsvp';
    case 'voting_open':  return 'voting';
    case 'confirmed':    return 'confirmed';
    case 'completed':    return 'completed';
    case 'cancelled':    return 'cancelled';
  }
}

// ---------------------------------------------------------------------------
// Component prop interfaces (local to this file)
// ---------------------------------------------------------------------------

interface PlanDetailHeaderProps {
  plan: DiningPlan;
  phase: PlanPhase;
  onBack: () => void;
  insetTop: number;
}

interface WhenBlockProps {
  plan: DiningPlan;
  phase: PlanPhase;
}

interface RestaurantBlockProps {
  plan: DiningPlan;
  onPress: () => void;
}

interface AttendeeSectionProps {
  plan: DiningPlan;
  phase: PlanPhase;
  currentUserId?: string;
  currentUserAvatarUri?: string;
}

interface DetailsBlockProps {
  cuisine: string;
  budget: string;
}

interface PlanActionBarProps {
  phase: PlanPhase;
  hasPendingInvite: boolean;
  hasDeclined: boolean;        // declined users are not participants — no voting CTA
  isOwner: boolean;
  isTerminal: boolean;         // B-1
  isRsvpPending: boolean;
  isManagePending: boolean;    // A-3
  onAccept: () => void;
  onDecline: () => void;
  onVoting: () => void;        // used for both "Go to voting" and "View results"
  onManage: () => void;
  insetBottom: number;
  // REQ-012: Request-to-join CTA (v2 DC-1: canRequestJoin replaces isNonParticipantEligible)
  canRequestJoin?: boolean;
  joinStatus?: 'none' | 'pending' | 'denied';
  isRequestPending?: boolean;
  onRequestJoin?: () => void;
}

// REQ-013: JoinRequestsSection props (v2 DC-6: per-row pendingActionUserId)
interface JoinRequestsSectionProps {
  requests: PlanJoinRequest[];           // pending only
  onApprove: (userId: string) => void;
  onDeny: (userId: string) => void;
  pendingActionUserId?: string;          // DC-6: only this row's buttons are disabled
}

// ---------------------------------------------------------------------------
// JoinRequestsSection — module-level helper (REQ-013)
// Renders only when the plan owner has pending join requests.
// MANDATE per CLAUDE.md: declares its own const Colors = useColors()
// ---------------------------------------------------------------------------
function JoinRequestsSection({
  requests,
  onApprove,
  onDeny,
  pendingActionUserId,
}: JoinRequestsSectionProps) {
  const Colors = useColors(); // CLAUDE.md mandate for module-level helpers

  if (requests.length === 0) return null;

  return (
    <View
      testID="join-requests-section"
      style={[
        styles.section,
        { borderBottomColor: Colors.borderLight },
      ]}
      accessibilityLabel={`Requests to join, ${requests.length} pending`}
    >
      {/* Header with count badge */}
      <View style={styles.joinRequestsHeader}>
        <AppText
          variant="dense"
          style={[styles.sectionLabel, { color: Colors.textTertiary }]}
        >
          REQUESTS TO JOIN
        </AppText>
        <View
          style={[
            styles.joinRequestsBadge,
            { backgroundColor: Colors.primary },
          ]}
        >
          <AppText variant="dense" style={styles.joinRequestsBadgeText}>
            {requests.length}
          </AppText>
        </View>
      </View>

      {/* Request rows — mirror friends-tab renderRequest styling */}
      {requests.map((request) => {
        const isThisRowPending = pendingActionUserId === request.userId;
        return (
          <View
            key={request.userId}
            testID={`join-request-row-${request.userId}`}
            style={[styles.joinRequestRow, { backgroundColor: Colors.card }]}
          >
            <Image
              source={request.avatarUri ?? DEFAULT_AVATAR_URI}
              style={styles.joinRequestAvatar}
              contentFit="cover"
            />
            <AppText
              variant="dense"
              style={[styles.joinRequestName, { color: Colors.text, flex: 1 }]}
              numberOfLines={1}
            >
              {request.name}
            </AppText>

            {/* Approve button: tint pattern per A11Y-013-2 */}
            <Pressable
              testID={`join-request-approve-${request.userId}`}
              onPress={() => onApprove(request.userId)}
              disabled={isThisRowPending}
              accessibilityRole="button"
              accessibilityLabel={`Seat ${request.name}`}
              accessibilityState={{ disabled: isThisRowPending }}
              style={[
                styles.joinRequestBtn,
                styles.joinRequestApproveBtn,
                {
                  backgroundColor: Colors.success + '18',
                  opacity: isThisRowPending ? 0.5 : 1,
                },
              ]}
            >
              {isThisRowPending ? (
                <ActivityIndicator size="small" color={Colors.success} />
              ) : (
                <AppText
                  variant="dense"
                  style={[styles.joinRequestApproveBtnText, { color: Colors.success }]}
                >
                  Seat &apos;em
                </AppText>
              )}
            </Pressable>

            {/* Deny button: ghost border pattern */}
            <Pressable
              testID={`join-request-deny-${request.userId}`}
              onPress={() => onDeny(request.userId)}
              disabled={isThisRowPending}
              accessibilityRole="button"
              accessibilityLabel={`Decline ${request.name}'s request`}
              accessibilityState={{ disabled: isThisRowPending }}
              style={[
                styles.joinRequestBtn,
                styles.joinRequestDenyBtn,
                {
                  borderColor: Colors.error,
                  opacity: isThisRowPending ? 0.5 : 1,
                },
              ]}
            >
              <X size={18} color={Colors.error} />
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PlanDetailHeader — module-level helper
// ---------------------------------------------------------------------------
function PlanDetailHeader({ plan, phase, onBack, insetTop }: PlanDetailHeaderProps) {
  const Colors = useColors(); // CLAUDE.md mandate for module-level helpers

  const statusKey = phaseToStatusKey(phase);
  const statusConfig = statusConfigStatic[statusKey];
  const statusColors = getStatusColors(statusKey, Colors);
  const StatusIcon = statusConfig?.icon ?? Clock;

  const isTerminal = phase === 'completed' || phase === 'cancelled';
  const hasHero = !!plan.restaurant?.imageUrl;

  const headerContent = hasHero ? (
    <SizzleShimmer>
      <Image
        source={{ uri: plan.restaurant!.imageUrl }}
        style={[styles.heroImage, isTerminal && { opacity: 0.85 }]}
        contentFit="cover"
        accessibilityIgnoresInvertColors
      />
    </SizzleShimmer>
  ) : (
    <View style={isTerminal ? { opacity: 0.85 } : undefined}>
      <LinearGradient
        colors={[Colors.primary, Colors.secondary]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.gradientBanner}
      >
        <AppText style={styles.gradientPlateEmoji}>🍽</AppText>
      </LinearGradient>
    </View>
  );

  return (
    <View>
      {headerContent}

      {/* Back chevron */}
      <Pressable
        testID="plan-detail-back"
        onPress={onBack}
        style={[
          styles.backBtn,
          { top: insetTop + 8 },
          hasHero
            ? { backgroundColor: 'rgba(0,0,0,0.35)' }
            : { backgroundColor: Colors.card },
        ]}
        accessibilityLabel="Go back"
        accessibilityRole="button"
        hitSlop={8}
      >
        <ArrowLeft size={20} color={hasHero ? '#FFF' : Colors.text} />
      </Pressable>

      {/* Status badge */}
      <View
        testID="plan-detail-status-badge"
        style={[
          styles.statusBadge,
          { top: insetTop + 8, backgroundColor: statusColors.bg },
        ]}
      >
        <StatusIcon size={12} color={statusColors.color} />
        <AppText
          variant="dense"
          style={[styles.statusBadgeText, { color: statusColors.color }]}
        >
          {statusConfig?.label ?? plan.status}
        </AppText>
      </View>

      {/* Content sheet overlay — overlaps bottom of header */}
      <View
        style={[
          styles.contentSheetOverlap,
          { backgroundColor: Colors.background },
        ]}
      >
        <AppText
          variant="display"
          style={[styles.planTitle, { color: Colors.text }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {plan.title}
        </AppText>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// WhenBlock — module-level helper
// ---------------------------------------------------------------------------
function WhenBlock({ plan, phase }: WhenBlockProps) {
  const Colors = useColors(); // CLAUDE.md mandate

  // Local-time date parse per v2 A-2 — NEVER use new Date(plan.date)
  const displayDate = (() => {
    if (!plan.date) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(plan.date);
    const d = m
      ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      : new Date(plan.date);
    return formatPlanDate(d);
  })();

  const dateTimeStr =
    plan.type === 'group-swipe'
      ? null
      : displayDate
      ? `${displayDate}${plan.time ? ` · ${plan.time}` : ''}`
      : null;

  // RSVP deadline countdown
  const deadlineMs = plan.rsvpDeadline
    ? new Date(plan.rsvpDeadline).getTime() - Date.now()
    : null;
  const deadlineLabel =
    phase === 'rsvp_open' && plan.rsvpDeadline
      ? formatTimeUntilDeadline(plan.rsvpDeadline)
      : null;
  const deadlineUrgent = deadlineMs !== null && deadlineMs < 6 * 3600 * 1000;

  return (
    <View style={[styles.section, { borderBottomColor: Colors.borderLight }]}>
      <AppText
        variant="dense"
        style={[styles.sectionLabel, { color: Colors.textTertiary }]}
      >
        WHEN
      </AppText>

      {plan.type === 'group-swipe' ? (
        <View style={styles.sectionRow}>
          <Users size={16} color={Colors.textSecondary} />
          <AppText
            variant="dense"
            style={[styles.sectionValue, { color: Colors.text }]}
          >
            Group Decision
          </AppText>
        </View>
      ) : dateTimeStr ? (
        <View style={styles.sectionRow}>
          <CalendarDays size={16} color={Colors.textSecondary} />
          <AppText
            variant="dense"
            style={[styles.sectionValue, { color: Colors.text }]}
          >
            {dateTimeStr}
          </AppText>
        </View>
      ) : (
        <AppText
          variant="dense"
          style={[styles.sectionValue, { color: Colors.textTertiary }]}
        >
          No date set
        </AppText>
      )}

      {deadlineLabel && (
        <View style={[styles.sectionRow, { marginTop: 6 }]}>
          <Clock size={14} color={Colors.primary} />
          <AppText
            variant="dense"
            style={[
              styles.deadlineText,
              { color: Colors.primary },
              deadlineUrgent && styles.deadlineUrgent,
            ]}
          >
            RSVP closes in {deadlineLabel}
          </AppText>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// RestaurantBlock — module-level helper
// ---------------------------------------------------------------------------
function RestaurantBlock({ plan, onPress }: RestaurantBlockProps) {
  const Colors = useColors(); // CLAUDE.md mandate

  const scaleAnim = React.useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.98,
      tension: 300,
      friction: 10,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      tension: 300,
      friction: 10,
      useNativeDriver: true,
    }).start();
  }, [scaleAnim]);

  const restaurant = plan.restaurant!;

  return (
    <View style={[styles.section, { borderBottomColor: Colors.borderLight }]}>
      <AppText
        variant="dense"
        style={[styles.sectionLabel, { color: Colors.textTertiary }]}
      >
        WHERE
      </AppText>

      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <Pressable
          testID="plan-detail-restaurant-block"
          onPress={onPress}
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          style={[
            styles.restaurantCard,
            {
              backgroundColor: Colors.card,
              borderColor: Colors.border,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={`View ${restaurant.name} restaurant details`}
        >
          <Image
            source={{ uri: restaurant.imageUrl }}
            style={styles.restaurantThumb}
            contentFit="cover"
          />
          <View style={styles.restaurantMeta}>
            <AppText
              variant="dense"
              style={[styles.restaurantName, { color: Colors.text }]}
              numberOfLines={1}
            >
              {restaurant.name}
            </AppText>
            {!!restaurant.address && (
              <AppText
                variant="dense"
                style={[styles.restaurantAddress, { color: Colors.textSecondary }]}
                numberOfLines={1}
              >
                {restaurant.address}
              </AppText>
            )}
            <View style={styles.restaurantRatingRow}>
              <Star size={12} color={Colors.star} fill={Colors.star} />
              <AppText
                variant="dense"
                style={[styles.restaurantRating, { color: Colors.star }]}
              >
                {restaurant.rating?.toFixed(1) ?? '—'}
              </AppText>
            </View>
          </View>
          <ChevronRight size={16} color={Colors.textTertiary} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// AttendeeSection — module-level helper
// ---------------------------------------------------------------------------
function AttendeeSection({ plan, phase, currentUserId, currentUserAvatarUri }: AttendeeSectionProps) {
  const Colors = useColors(); // CLAUDE.md mandate

  // Once voting is open (or the winner is set), the meaningful distinction is
  // "in but hasn't voted yet" vs "finished voting" — not just RSVP status.
  const votingActive = phase === 'voting_open' || phase === 'confirmed';
  const hasVoted = (uid: string) => plan.swipesCompleted?.includes(uid) ?? false;

  // v2 B-3: filter owner out of invites before counting
  const invitesNoOwner = (plan.invites ?? []).filter(
    (i) => i.userId !== plan.ownerId,
  );
  // "In" = owner (always) + accepted invitees — the people expected to vote.
  const accepted = invitesNoOwner.filter((i) => i.status === 'accepted').length + 1; // +1 = owner
  const pending  = invitesNoOwner.filter((i) => i.status === 'pending').length;
  const declined = invitesNoOwner.filter((i) => i.status === 'declined').length;
  const total    = accepted + pending + declined;

  // Build allMembers: owner first, then invitesNoOwner
  const isCurrentUserOwner =
    !!(currentUserId && plan.ownerId && currentUserId === plan.ownerId);
  const ownerAvatarUri = isCurrentUserOwner
    ? (currentUserAvatarUri ?? plan.ownerAvatarUri)
    : plan.ownerAvatarUri;

  const allMembers: AttendeeMember[] = [
    {
      userId: plan.ownerId ?? 'owner',
      name: plan.ownerName ?? 'Host',
      avatarUri: ownerAvatarUri,
      status: 'owner',
      isCurrentUser: isCurrentUserOwner,
    },
    ...invitesNoOwner.map((inv) => ({
      userId: inv.userId,
      name: inv.name,
      avatarUri:
        currentUserId && inv.userId === currentUserId
          ? currentUserAvatarUri ?? inv.avatarUri
          : inv.avatarUri,
      status: inv.status,
      isCurrentUser: currentUserId === inv.userId,
    })),
  ];

  // Voting progress = how many of the "in" members have finished swiping.
  const votedCount = allMembers.filter(
    (m) => (m.status === 'owner' || m.status === 'accepted') && hasVoted(m.userId),
  ).length;

  const fillPct = votingActive
    ? (accepted > 0 ? (votedCount / accepted) * 100 : 100)
    : (total > 0 ? (accepted / total) * 100 : 100);
  const tallyLabel = votingActive
    ? `${votedCount} of ${accepted} voted`
    : `${accepted} chomping${pending > 0 ? ` · ${pending} nibbling` : ''}${declined > 0 ? ` · ${declined} passed` : ''}`;

  // Per-member chip: phase-aware. In the voting phase an "in" member splits into
  // "Voted" (finished swiping) vs "Yet to vote"; otherwise it's RSVP status.
  const chipFor = (member: AttendeeMember) => {
    if (member.status === 'declined') {
      return { label: 'Passed', color: Colors.textTertiary, bg: Colors.textTertiary + '18', voted: false };
    }
    if (member.status === 'pending') {
      return { label: 'Nibbling', color: Colors.secondary, bg: Colors.secondaryLight, voted: false };
    }
    // "In" member (owner or accepted)
    if (votingActive) {
      // Copy matches the group-session waiting screen: Done / Swiping...
      return hasVoted(member.userId)
        ? { label: 'Done', color: Colors.success, bg: Colors.success + '18', voted: true }
        : { label: 'Swiping...', color: Colors.secondary, bg: Colors.secondaryLight, voted: false };
    }
    return member.status === 'owner'
      ? { label: 'Host', color: Colors.primary, bg: Colors.primaryLight, voted: false }
      : { label: 'Chomping', color: Colors.success, bg: Colors.success + '18', voted: false };
  };

  return (
    <View style={[styles.section, { borderBottomColor: Colors.borderLight }]}>
      <AppText
        variant="dense"
        style={[styles.sectionLabel, { color: Colors.textTertiary }]}
      >
        WHO'S AT THE TABLE
      </AppText>

      {/* TallyBar — D: add testID */}
      <View
        testID="plan-detail-tally-bar"
        style={styles.tallyBarContainer}
        accessibilityLabel={tallyLabel}
      >
        <View style={[styles.tallyTrack, { backgroundColor: Colors.skeleton }]}>
          <View
            style={[
              styles.tallyFill,
              { width: `${fillPct}%` as unknown as number, backgroundColor: Colors.success },
            ]}
          />
        </View>
        <AppText
          variant="dense"
          style={[styles.tallyText, { color: Colors.textSecondary }]}
        >
          {tallyLabel}
        </AppText>
      </View>

      {/* Attendee rows — v2 C-2: always render all, no showAll cap */}
      {allMembers.map((member) => {
        const isOwnerRow = member.status === 'owner';
        const chip = chipFor(member);

        return (
          <View
            key={member.userId}
            testID={`plan-detail-attendee-${member.userId}`}
            style={[
              styles.attendeeRow,
              member.status === 'declined' && { opacity: 0.4 },
              member.isCurrentUser && { backgroundColor: Colors.primaryLight },
            ]}
            accessibilityLabel={`${member.name}, ${chip.label}`}
          >
            {/* Avatar with optional crown. Voters get a green border, mirroring
                the accepted-avatar treatment on the Plans overview cards. */}
            <View style={styles.avatarWrapper}>
              {isOwnerRow && (
                <Crown
                  size={14}
                  color={Colors.star}
                  fill={Colors.star}
                  style={styles.crownIcon}
                  accessibilityElementsHidden
                />
              )}
              <Image
                source={member.avatarUri ?? DEFAULT_AVATAR_URI}
                style={[
                  styles.attendeeAvatar,
                  { borderColor: chip.voted ? Colors.success : 'transparent' },
                ]}
                contentFit="cover"
              />
            </View>

            {/* Name */}
            <AppText
              variant="dense"
              style={[styles.attendeeName, { color: Colors.text, flex: 1 }]}
              numberOfLines={1}
            >
              {member.name}
            </AppText>

            {/* Status chip — RSVP status, or Voted/Yet-to-vote during voting */}
            <View
              style={[
                styles.rsvpChip,
                { backgroundColor: chip.bg, borderColor: chip.color },
              ]}
            >
              {chip.voted && <Check size={11} color={chip.color} />}
              <AppText
                variant="dense"
                style={[styles.rsvpChipText, { color: chip.color }]}
              >
                {chip.label}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// DetailsBlock — module-level helper
// ---------------------------------------------------------------------------
function DetailsBlock({ cuisine, budget }: DetailsBlockProps) {
  const Colors = useColors(); // CLAUDE.md mandate

  return (
    <View style={[styles.section, { borderBottomColor: Colors.borderLight }]}>
      <AppText
        variant="dense"
        style={[styles.sectionLabel, { color: Colors.textTertiary }]}
      >
        THE DETAILS
      </AppText>
      <View style={styles.tagsRow}>
        <View style={[styles.tag, { backgroundColor: Colors.primaryLight }]}>
          <AppText
            variant="dense"
            style={[styles.tagText, { color: Colors.primary }]}
          >
            {cuisine}
          </AppText>
        </View>
        <View style={[styles.tag, { backgroundColor: Colors.secondaryLight }]}>
          <AppText
            variant="dense"
            style={[styles.tagText, { color: Colors.secondary }]}
          >
            {budget}
          </AppText>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// PlanActionBar — module-level helper (v2 F final props)
// ---------------------------------------------------------------------------
function PlanActionBar({
  phase,
  hasPendingInvite,
  hasDeclined,
  isOwner,
  isTerminal,
  isRsvpPending,
  isManagePending,
  onAccept,
  onDecline,
  onVoting,
  onManage,
  insetBottom,
  canRequestJoin,
  joinStatus = 'none',
  isRequestPending,
  onRequestJoin,
}: PlanActionBarProps) {
  const Colors = useColors(); // CLAUDE.md mandate

  if (isTerminal) return null;

  const barStyle = [
    styles.actionBar,
    {
      backgroundColor: Colors.card,
      borderTopColor: Colors.borderLight,
      paddingBottom: insetBottom + 12,
    },
  ];

  // Declined: not a participant. Do NOT offer "Go to voting" — the backend
  // rejects their vote submission, so swiping would dead-end in an error.
  if (hasDeclined) {
    return (
      <View testID="plan-detail-declined-state" style={barStyle}>
        <View style={styles.actionBarRow}>
          <AppText
            variant="dense"
            style={[styles.mutedStatusText, { color: Colors.textTertiary, flex: 1 }]}
          >
            You passed on this plan
          </AppText>
        </View>
      </View>
    );
  }

  // REQ-012: Non-participant request-to-join CTA (v2 DC-1)
  // Only shown when canRequestJoin is true — owners/invitees/terminal phases never see this.
  if (canRequestJoin) {
    const isPending = joinStatus === 'pending';
    const isDenied = joinStatus === 'denied';

    return (
      <View style={barStyle}>
        {isDenied && (
          <AppText
            testID="plan-detail-join-denied"
            variant="dense"
            style={[styles.actionBarMicro, { color: Colors.textTertiary }]}
          >
            Last time wasn&apos;t a fit — try again?
          </AppText>
        )}
        <Pressable
          testID={isPending ? 'plan-detail-join-pending' : 'plan-detail-request-join-btn'}
          onPress={isPending ? undefined : onRequestJoin}
          disabled={isPending || isRequestPending}
          accessibilityRole="button"
          accessibilityLabel={
            isPending
              ? 'Seat requested, waiting on host'
              : isDenied
              ? 'Ask again'
              : 'Ask for a seat'
          }
          accessibilityState={{ disabled: isPending || isRequestPending }}
          style={[
            styles.ctaBtn,
            styles.ctaBtnPrimary,
            {
              backgroundColor: Colors.primary,
              shadowColor: Colors.primary,
              flex: 1,
              opacity: isPending || isRequestPending ? 0.5 : 1,
              minHeight: 44,
            },
          ]}
        >
          {isRequestPending ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <AppText variant="dense" style={styles.ctaBtnTextPrimary}>
              {isPending ? 'Seat requested' : isDenied ? 'Ask again' : 'Ask for a seat'}
            </AppText>
          )}
        </Pressable>
      </View>
    );
  }

  const manageBtn = (
    <Pressable
      testID="plan-detail-manage-btn"
      onPress={onManage}
      disabled={isManagePending}
      accessibilityLabel="Plan options"
      accessibilityRole="button"
      accessibilityState={{ disabled: isManagePending }}
      style={[
        styles.manageBtn,
        { backgroundColor: Colors.surfaceElevated },
        isManagePending && { opacity: 0.5 },
      ]}
    >
      <MoreVertical size={20} color={Colors.textSecondary} />
    </Pressable>
  );

  // Pending invite: Accept + Decline side by side
  if (hasPendingInvite) {
    return (
      <View style={barStyle}>
        <AppText
          variant="dense"
          style={[styles.actionBarMicro, { color: Colors.textSecondary }]}
        >
          Will you join the table?
        </AppText>
        <View style={styles.actionBarRow}>
          <Pressable
            testID="plan-detail-decline-btn"
            onPress={onDecline}
            disabled={isRsvpPending}
            accessibilityRole="button"
            accessibilityLabel="Pass for now"
            accessibilityState={{ disabled: isRsvpPending }}
            style={[
              styles.ctaBtn,
              styles.ctaBtnGhost,
              {
                borderColor: Colors.border,
                opacity: isRsvpPending ? 0.5 : 1,
              },
            ]}
          >
            <AppText
              variant="dense"
              style={[styles.ctaBtnTextGhost, { color: Colors.textSecondary }]}
            >
              Pass for now
            </AppText>
          </Pressable>
          <Pressable
            testID="plan-detail-accept-btn"
            onPress={onAccept}
            disabled={isRsvpPending}
            accessibilityRole="button"
            accessibilityLabel="Chomp — I'm in!"
            accessibilityState={{ disabled: isRsvpPending }}
            style={[
              styles.ctaBtn,
              styles.ctaBtnPrimary,
              {
                backgroundColor: Colors.primary,
                shadowColor: Colors.primary,
                opacity: isRsvpPending ? 0.5 : 1,
              },
            ]}
          >
            <AppText variant="dense" style={styles.ctaBtnTextPrimary}>
              Chomp — I'm in!
            </AppText>
          </Pressable>
        </View>
      </View>
    );
  }

  // RSVP open (no pending invite — owner or already responded)
  if (phase === 'rsvp_open') {
    return (
      <View style={barStyle}>
        <View style={styles.actionBarRow}>
          <AppText
            variant="dense"
            style={[styles.mutedStatusText, { color: Colors.textTertiary, flex: 1 }]}
          >
            Waiting on RSVPs…
          </AppText>
          {manageBtn}
        </View>
      </View>
    );
  }

  // Voting open
  if (phase === 'voting_open') {
    return (
      <View style={barStyle}>
        <View style={styles.actionBarRow}>
          <Pressable
            testID="plan-detail-voting-btn"
            onPress={onVoting}
            style={[
              styles.ctaBtn,
              styles.ctaBtnPrimary,
              { backgroundColor: Colors.primary, shadowColor: Colors.primary, flex: 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Go to voting"
          >
            <AppText variant="dense" style={styles.ctaBtnTextPrimary}>
              Go to voting
            </AppText>
          </Pressable>
          {manageBtn}
        </View>
      </View>
    );
  }

  // Confirmed
  if (phase === 'confirmed') {
    return (
      <View style={barStyle}>
        <View style={styles.actionBarRow}>
          <Pressable
            testID="plan-detail-results-btn"
            onPress={onVoting}
            style={[
              styles.ctaBtn,
              styles.ctaBtnPrimary,
              { backgroundColor: Colors.primary, shadowColor: Colors.primary, flex: 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="View results"
          >
            <AppText variant="dense" style={styles.ctaBtnTextPrimary}>
              View results
            </AppText>
          </Pressable>
          {manageBtn}
        </View>
      </View>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// PlanDetailScreen — default export
// ---------------------------------------------------------------------------
export default function PlanDetailScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { localAvatarUri, preferences } = useApp();

  const { id } = useLocalSearchParams<{ id: string }>();
  const currentUserId = user?.id;
  const currentUserAvatarUri = localAvatarUri ?? user?.avatarUri;

  // Reduce-motion gate
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // REQ-012: Snackbar for surface 403 errors on request-join
  const [snackbar, setSnackbar] = useState<{ message: string } | null>(null);

  // REQ-013: Per-row pending state (v2 DC-6)
  const [pendingActionUserId, setPendingActionUserId] = useState<string | undefined>(undefined);

  // Content fade animation (v2 C-1: single contentOpacity instead of 5-value stagger)
  const contentOpacity = React.useRef(new Animated.Value(0)).current;

  // CrumbParticles state (v2 C-3: fixed origin, no measure())
  const [bursts, setBursts] = useState<CrumbBurst[]>([]);

  // Action sheet visibility
  const [actionSheetVisible, setActionSheetVisible] = useState(false);

  // Seed initialData from list cache for instant render
  const initialData = useMemo(
    () =>
      queryClient
        .getQueryData<DiningPlan[]>(['plans'])
        ?.find((p) => p.id === id),
    [queryClient, id],
  );

  const {
    data: plan,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['plan', id],
    queryFn: () => getPlan(id!),
    initialData,
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });

  // Animate content in when plan is available
  useEffect(() => {
    if (!plan) return;
    if (reduceMotion) {
      contentOpacity.setValue(1);
      return;
    }
    Animated.timing(contentOpacity, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [plan, reduceMotion, contentOpacity]);

  // ---------------------------------------------------------------------------
  // Derived state (v2 B-2: single source, no isAuthenticated)
  // ---------------------------------------------------------------------------
  const phase: PlanPhase = plan ? derivePlanPhase(plan) : 'rsvp_open';
  const isTerminal = phase === 'completed' || phase === 'cancelled';

  const myInvite = plan?.invites?.find((i) => i.userId === currentUserId);
  const hasPendingInvite = myInvite?.status === 'pending';
  const isOwner = !!(currentUserId && plan?.ownerId && currentUserId === plan.ownerId);
  // A user who declined is NOT a participant — the backend rejects their vote
  // submission (plans.ts: "You are not a participant"). Owners can never be declined.
  const hasDeclined = !isOwner && myInvite?.status === 'declined';

  // REQ-012: Non-participant eligibility (v2 DC-1 full derivation)
  // isInviteeActive: any invite that hasn't been declined counts as participation.
  const isInviteeActive = !!myInvite && myInvite.status !== 'declined';
  const withinWindow: boolean =
    plan?.status === 'voting' &&
    (!plan?.rsvpDeadline || new Date(plan.rsvpDeadline).getTime() > Date.now());
  const canRequestJoin: boolean =
    !isOwner &&
    !isInviteeActive &&
    (plan?.visibility === 'public' || plan?.visibility === 'friends_request') &&
    withinWindow;

  // joinStatus: derive from plan.joinRequests (authoritative) falling back to myJoinRequestStatus
  const joinStatus: 'none' | 'pending' | 'denied' = (() => {
    const fromRequests = plan?.joinRequests?.find(
      (r) => r.userId === currentUserId,
    )?.status;
    const raw = fromRequests ?? plan?.myJoinRequestStatus ?? null;
    if (raw === 'pending') return 'pending';
    if (raw === 'denied') return 'denied';
    return 'none';
  })();

  // REQ-013: Pending join requests visible only to owner
  const pendingJoinRequests: PlanJoinRequest[] = isOwner
    ? (plan?.joinRequests ?? []).filter((r) => r.status === 'pending')
    : [];

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const rsvpMutation = useMutation({
    mutationFn: ({
      planId,
      action,
    }: {
      planId: string;
      action: 'accept' | 'decline';
    }) => rsvpPlan(planId, action),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      if (variables.action === 'accept') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        // v2 C-3: fixed-origin CrumbParticles burst
        const { width, height } = Dimensions.get('window');
        const cx = width / 2;
        const cy = height - insets.bottom - 40;
        const seed = id ? id.length : 1;
        const burst = createBurst(cx, cy, 12, Colors.primary, seed);
        animateBurst(burst, seed);
        setBursts((prev) => [...prev, burst]);
        setTimeout(() => setBursts([]), 700);
      } else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    onError: (err: Error) => {
      Alert.alert('RSVP Failed', err.message || 'Something went wrong.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (planId: string) => cancelPlan(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      router.back();
    },
    onError: (err: Error) =>
      Alert.alert('Cancel Failed', err.message || 'Something went wrong.'),
  });

  const completeMutation = useMutation({
    mutationFn: (planId: string) => completePlan(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      router.back();
    },
    onError: (err: Error) =>
      Alert.alert('Could Not Complete', err.message || 'Something went wrong.'),
  });

  // #321: report plan / block organizer (UGC safety)
  const reportPlanMutation = useMutation({
    mutationFn: (reason: (typeof REPORT_REASON_LABELS)[number]['value']) =>
      reportTarget('plan', id!, reason),
    onSuccess: () => {
      setSnackbar({ message: "Thanks \u2014 we received your report." });
    },
    onError: () => {
      setSnackbar({ message: "Couldn't send the report \u2014 try again." });
    },
  });

  const blockOwnerMutation = useMutation({
    mutationFn: (ownerId: string) => blockUser(ownerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      queryClient.invalidateQueries({ queryKey: ['discoverFeed'] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      Alert.alert('Blocked', "You won't see this person's plans anymore.");
      router.back();
    },
    onError: (err: Error) =>
      Alert.alert('Could Not Block', err.message || 'Something went wrong.'),
  });

  const delegateMutation = useMutation({
    mutationFn: ({
      planId,
      newOwnerId,
    }: {
      planId: string;
      newOwnerId: string;
    }) => delegateOrganizer(planId, newOwnerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      router.back();
    },
    onError: (err: Error) =>
      Alert.alert('Delegate Failed', err.message || 'Something went wrong.'),
  });

  const leaveMutation = useMutation({
    mutationFn: (planId: string) => leavePlan(planId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      if (data.autoCancelled) {
        Alert.alert(
          'Plan Cancelled',
          'You were the last accepted participant — the plan has been auto-cancelled.',
        );
      }
      router.back();
    },
    onError: (err: Error) =>
      Alert.alert('Leave Failed', err.message || 'Something went wrong.'),
  });

  // REQ-012: requestJoinMutation
  const requestJoinMutation = useMutation({
    mutationFn: () => requestToJoin(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      queryClient.invalidateQueries({ queryKey: ['discoverFeed'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // CrumbParticles burst at CTA center (fixed-origin, same as rsvpMutation accept)
      if (!reduceMotion) {
        const { width, height } = Dimensions.get('window');
        const cx = width / 2;
        const cy = height - insets.bottom - 40;
        const seed = id ? id.length : 1;
        const burst = createBurst(cx, cy, 12, Colors.primary, seed);
        animateBurst(burst, seed);
        setBursts((prev) => [...prev, burst]);
        setTimeout(() => setBursts([]), 700);
      }
    },
    onError: (err: Error) => {
      setSnackbar({ message: err instanceof Error ? err.message : 'Something went wrong' });
    },
  });

  // REQ-013: approveMutation (v2 DC-6: onMutate/onSettled track pendingActionUserId)
  const approveMutation = useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      approveJoinRequest(id!, userId),
    onMutate: ({ userId }) => setPendingActionUserId(userId),
    onSettled: () => setPendingActionUserId(undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // CrumbParticles burst on approve
      if (!reduceMotion) {
        const { width, height } = Dimensions.get('window');
        const cx = width / 2;
        const cy = height / 2;
        const seed = id ? id.length + 1 : 2;
        const burst = createBurst(cx, cy, 12, Colors.success, seed);
        animateBurst(burst, seed);
        setBursts((prev) => [...prev, burst]);
        setTimeout(() => setBursts([]), 700);
      }
    },
    onError: (err: Error) => {
      setSnackbar({ message: err instanceof Error ? err.message : 'Something went wrong' });
    },
  });

  // REQ-013: denyMutation (v2 DC-6: onMutate/onSettled track pendingActionUserId)
  const denyMutation = useMutation({
    mutationFn: ({ userId }: { userId: string }) =>
      denyJoinRequest(id!, userId),
    onMutate: ({ userId }) => setPendingActionUserId(userId),
    onSettled: () => setPendingActionUserId(undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plan', id] });
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    onError: (err: Error) => {
      Alert.alert('Deny Failed', err.message || 'Something went wrong.');
    },
  });

  // v2 A-3: isManagePending for double-fire guard
  const isManagePending =
    cancelMutation.isPending ||
    completeMutation.isPending ||
    delegateMutation.isPending ||
    leaveMutation.isPending;

  // ---------------------------------------------------------------------------
  // Action handlers
  // ---------------------------------------------------------------------------
  const handleBack = useCallback(() => {
    router.back();
  }, [router]);

  const handleAccept = useCallback(() => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    rsvpMutation.mutate({ planId: id, action: 'accept' });
  }, [id, rsvpMutation]);

  const handleDecline = useCallback(() => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    rsvpMutation.mutate({ planId: id, action: 'decline' });
  }, [id, rsvpMutation]);

  const handleVoting = useCallback(() => {
    if (!id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/group-session?planId=${id}&autoStart=true` as never);
  }, [id, router]);

  const handleRestaurantPress = useCallback(() => {
    if (!plan?.restaurant) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push({
      pathname: '/restaurant/[id]',
      params: {
        id: plan.restaurant.id,
        planDate: plan.date,
        planTime: plan.time,
        planPartySize: String(
          parseInt(preferences?.groupSize?.[0] ?? '2', 10),
        ),
      },
    } as never);
  }, [plan, preferences, router]);

  const handleManage = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActionSheetVisible(true);
  }, []);

  const handleCancelPlan = useCallback(() => {
    if (!plan) return;
    Alert.alert(
      'Cancel Plan?',
      `Are you sure you want to cancel "${plan.title}"? All participants will be notified.`,
      [
        { text: 'No', style: 'cancel' },
        {
          text: 'Yes, Cancel',
          style: 'destructive',
          onPress: () => cancelMutation.mutate(plan.id),
        },
      ],
    );
  }, [plan, cancelMutation]);

  const handleCompletePlan = useCallback(() => {
    if (!plan) return;
    Alert.alert(
      'Mark Complete?',
      `Mark "${plan.title}" as completed? It'll move to your Past plans.`,
      [
        { text: 'Not Yet', style: 'cancel' },
        {
          text: 'Mark Complete',
          onPress: () => completeMutation.mutate(plan.id),
        },
      ],
    );
  }, [plan, completeMutation]);

  // #321: reason picker via stacked Alert buttons, then submit the report.
  const handleReportPlan = useCallback(() => {
    if (!plan) return;
    Alert.alert(
      'Report Plan',
      'Why are you reporting this plan?',
      [
        ...REPORT_REASON_LABELS.map(r => ({
          text: r.label,
          onPress: () => reportPlanMutation.mutate(r.value),
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
    );
  }, [plan, reportPlanMutation]);

  const handleBlockOwner = useCallback(() => {
    if (!plan?.ownerId) return;
    Alert.alert(
      `Block ${plan.ownerName ?? 'this organizer'}?`,
      "You'll be removed from their plans and neither of you will be able to send friend requests or invites. You can unblock from Profile \u2192 Blocked Users.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: () => blockOwnerMutation.mutate(plan.ownerId!) },
      ],
    );
  }, [plan, blockOwnerMutation]);

  // v2 B-5: use plan (query data) not actionSheetPlan
  const handleDelegatePlan = useCallback(() => {
    if (!plan) return;
    const accepted = plan.invites?.filter((i) => i.status === 'accepted') ?? [];
    if (accepted.length === 0) {
      Alert.alert(
        'No Eligible Members',
        'There are no accepted invitees to delegate to.',
      );
      return;
    }
    if (accepted.length === 1) {
      Alert.alert(
        'Delegate Organizer?',
        `Make ${accepted[0].name} the new organizer? You will leave the plan.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delegate',
            onPress: () =>
              delegateMutation.mutate({
                planId: plan.id,
                newOwnerId: accepted[0].userId,
              }),
          },
        ],
      );
    } else {
      const buttons: { text: string; onPress: () => void }[] = accepted.map((inv) => ({
        text: inv.name,
        onPress: () => {
          Alert.alert(
            'Confirm Delegation',
            `Make ${inv.name} the new organizer? You will leave the plan.`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delegate',
                onPress: () =>
                  delegateMutation.mutate({
                    planId: plan.id,
                    newOwnerId: inv.userId,
                  }),
              },
            ],
          );
        },
      }));
      buttons.push({ text: 'Cancel', onPress: () => {} });
      Alert.alert('Choose New Organizer', 'Select who should take over:', buttons);
    }
  }, [plan, delegateMutation]);

  const handleLeavePlan = useCallback(() => {
    if (!plan || !user) return;
    const accepted = plan.invites?.filter((i) => i.status === 'accepted') ?? [];
    const otherAccepted = accepted.filter((i) => i.userId !== user.id);
    const willAutoCancel =
      otherAccepted.length === 0 && accepted.some((i) => i.userId === user.id);
    const message = willAutoCancel
      ? `You are the only accepted participant. Leaving will cancel "${plan.title}" for everyone.`
      : `Are you sure you want to leave "${plan.title}"?`;
    Alert.alert('Leave Plan?', message, [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => leaveMutation.mutate(plan.id),
      },
    ]);
  }, [plan, user, leaveMutation]);

  const handlePlanEdit = useCallback(() => {
    if (!plan) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/plan-event?planId=${plan.id}` as never);
  }, [plan, router]);

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------
  if (isLoading && !plan) {
    return (
      <View
        style={[
          styles.centeredState,
          { backgroundColor: Colors.background, paddingTop: insets.top },
        ]}
      >
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if ((isError && !plan) || (!isLoading && !plan)) {
    return (
      <View
        style={[
          styles.centeredState,
          { backgroundColor: Colors.background, paddingTop: insets.top },
        ]}
      >
        <Pressable
          onPress={handleBack}
          style={[styles.backBtnStandalone, { backgroundColor: Colors.card }]}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft size={20} color={Colors.text} />
        </Pressable>
        <AppText
          variant="dense"
          style={[styles.errorText, { color: Colors.textSecondary }]}
        >
          {isError ? 'Could not load plan.' : 'Plan not found.'}
        </AppText>
      </View>
    );
  }

  // plan is guaranteed non-null here
  const p = plan!;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <View
      testID="plan-detail-screen"
      style={[styles.root, { backgroundColor: Colors.background }]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + (isTerminal ? 20 : 80) },
        ]}
        bounces
      >
        {/* Header */}
        <PlanDetailHeader
          plan={p}
          phase={phase}
          onBack={handleBack}
          insetTop={insets.top}
        />

        {/* Body content with fade-in animation */}
        <Animated.View style={{ opacity: contentOpacity }}>
          {/* WHEN */}
          <WhenBlock plan={p} phase={phase} />

          {/* WHERE — omit when no restaurant */}
          {!!p.restaurant && (
            <RestaurantBlock plan={p} onPress={handleRestaurantPress} />
          )}

          {/* ClosedWinnerFlag — v2 B-6: passive, no onOwnerTap */}
          {!!p.winnerClosedAt && (
            <View
              style={[
                styles.closedWinnerFlagContainer,
                { borderBottomColor: Colors.borderLight },
              ]}
            >
              <ClosedWinnerFlag plan={p} isOwner={isOwner} />
            </View>
          )}

          {/* REQ-013: Join Requests — visible to owner only, directly above AttendeeSection */}
          {pendingJoinRequests.length > 0 && (
            <JoinRequestsSection
              requests={pendingJoinRequests}
              onApprove={(userId) => approveMutation.mutate({ userId })}
              onDeny={(userId) => denyMutation.mutate({ userId })}
              pendingActionUserId={pendingActionUserId}
            />
          )}

          {/* WHO'S AT THE TABLE */}
          <AttendeeSection
            plan={p}
            phase={phase}
            currentUserId={currentUserId}
            currentUserAvatarUri={currentUserAvatarUri}
          />

          {/* THE DETAILS */}
          <DetailsBlock cuisine={p.cuisine} budget={p.budget} />

          {/* Terminal micro-copy */}
          {phase === 'completed' && (
            <View style={[styles.terminalCopy, { borderBottomColor: Colors.borderLight }]}>
              <AppText
                variant="dense"
                style={[styles.terminalText, { color: Colors.textTertiary }]}
              >
                That's a wrap. Hope it was delicious.
              </AppText>
            </View>
          )}
          {phase === 'cancelled' && (
            <View style={[styles.terminalCopy, { borderBottomColor: Colors.borderLight }]}>
              <AppText
                variant="dense"
                style={[styles.terminalText, { color: Colors.textTertiary }]}
              >
                This plan was cancelled.
              </AppText>
            </View>
          )}
        </Animated.View>
      </ScrollView>

      {/* Sticky action bar */}
      <PlanActionBar
        phase={phase}
        hasPendingInvite={!!hasPendingInvite}
        hasDeclined={!!hasDeclined}
        isOwner={isOwner}
        isTerminal={isTerminal}
        isRsvpPending={rsvpMutation.isPending}
        isManagePending={isManagePending}
        onAccept={handleAccept}
        onDecline={handleDecline}
        onVoting={handleVoting}
        onManage={handleManage}
        insetBottom={insets.bottom}
        canRequestJoin={canRequestJoin}
        joinStatus={joinStatus}
        isRequestPending={requestJoinMutation.isPending}
        onRequestJoin={() => requestJoinMutation.mutate()}
      />

      {/* PlanActionSheet — v2 A-1 exact render */}
      <PlanActionSheet
        visible={actionSheetVisible}
        plan={p ?? null}
        isOwner={isOwner}
        onClose={() => setActionSheetVisible(false)}
        onEdit={handlePlanEdit}
        onDelegate={handleDelegatePlan}
        onMarkComplete={handleCompletePlan}
        onCancel={handleCancelPlan}
        onLeave={handleLeavePlan}
        onReportPlan={handleReportPlan}
        onBlockOwner={plan?.ownerId ? handleBlockOwner : undefined}
      />

      {/* Busy overlay for manage mutations — v2 A-3 */}
      {isManagePending && (
        <View
          style={[styles.mutationOverlay, { backgroundColor: Colors.overlay }]}
          pointerEvents="auto"
        >
          <ActivityIndicator size="large" color="#FFF" />
        </View>
      )}

      {/* CrumbParticles — absolute-fill overlay, pointerEvents none */}
      <CrumbParticles bursts={bursts} />

      {/* REQ-012: Snackbar for surfaced 403 errors on request-join */}
      <Snackbar
        visible={snackbar !== null}
        message={snackbar?.message ?? ''}
        onDismiss={() => setSnackbar(null)}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    // paddingBottom set inline
  },
  centeredState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontSize: 16,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  backBtnStandalone: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },

  // Header
  heroImage: {
    width: '100%',
    height: 260,
  },
  gradientBanner: {
    width: '100%',
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradientPlateEmoji: {
    fontSize: 48,
    opacity: 0.3,
    color: Colors.textTertiary,
  },
  backBtn: {
    position: 'absolute',
    left: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusBadge: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },
  contentSheetOverlap: {
    marginTop: -20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: Colors.background,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 4,
  },
  planTitle: {
    fontSize: 22,
    fontWeight: '800' as const,
    color: Colors.text,
    lineHeight: 28,
  },

  // Sections
  section: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    color: Colors.textTertiary,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionValue: {
    fontSize: 16,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  deadlineText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.primary,
  },
  deadlineUrgent: {
    // Pulsing effect would be Animated; for static this just applies a slightly brighter color
    fontWeight: '700' as const,
  },

  // Restaurant card
  restaurantCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    minHeight: 72,
    backgroundColor: Colors.card,
    borderColor: Colors.border,
  },
  restaurantThumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    flexShrink: 0,
  },
  restaurantMeta: {
    flex: 1,
    gap: 2,
  },
  restaurantName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  restaurantAddress: {
    fontSize: 13,
    color: Colors.textSecondary,
  },
  restaurantRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  restaurantRating: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.star,
  },

  // Tally bar
  tallyBarContainer: {
    marginBottom: 14,
    gap: 6,
  },
  tallyTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.skeleton,
    overflow: 'hidden',
  },
  tallyFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  tallyText: {
    fontSize: 13,
    color: Colors.textSecondary,
  },

  // Attendee rows
  attendeeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 2,
    marginBottom: 4,
  },
  avatarWrapper: {
    position: 'relative',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crownIcon: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    zIndex: 1,
  },
  attendeeAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: 'transparent', // overridden to success green for voters
  },
  attendeeName: {
    fontSize: 15,
    color: Colors.text,
  },
  rsvpChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
  },
  rsvpChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
  },

  // Details (tags)
  tagsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  tag: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  tagText: {
    fontSize: 13,
    fontWeight: '600' as const,
  },

  // ClosedWinnerFlag container
  closedWinnerFlagContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },

  // Terminal copy
  terminalCopy: {
    paddingHorizontal: 20,
    paddingVertical: 20,
    alignItems: 'center',
  },
  terminalText: {
    fontSize: 14,
    fontStyle: 'italic',
    color: Colors.textTertiary,
    textAlign: 'center',
  },

  // Action bar
  actionBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 12,
    paddingHorizontal: 20,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: Colors.card,
    borderTopColor: Colors.borderLight,
  },
  actionBarMicro: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 8,
  },
  actionBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mutedStatusText: {
    fontSize: 14,
    color: Colors.textTertiary,
    fontStyle: 'italic',
  },
  manageBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },

  // CTA buttons
  ctaBtn: {
    minHeight: 52,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  ctaBtnPrimary: {
    backgroundColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  ctaBtnGhost: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: 'transparent',
  },
  ctaBtnTextPrimary: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700' as const,
  },
  ctaBtnTextGhost: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },

  // Mutation overlay
  mutationOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 200,
  },

  // REQ-013: JoinRequestsSection styles
  joinRequestsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  joinRequestsBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
  },
  joinRequestsBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
    color: '#FFFFFF',
  },
  joinRequestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 56,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 4,
    backgroundColor: Colors.card,
  },
  joinRequestAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    flexShrink: 0,
  },
  joinRequestName: {
    fontSize: 15,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  joinRequestBtn: {
    minHeight: 44,
    minWidth: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  joinRequestApproveBtn: {
    backgroundColor: Colors.success + '18',
  },
  joinRequestApproveBtnText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.success,
  },
  joinRequestDenyBtn: {
    borderWidth: 1.5,
    borderColor: Colors.error,
    backgroundColor: 'transparent',
  },
});
