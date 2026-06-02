import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Plus, ArrowLeft } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import PlanCard from '../../../components/PlanCard';
import PlanActionSheet from '../../../components/PlanActionSheet';
import LockedTabScreen from '../../../components/LockedTabScreen';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { rsvpPlan, cancelPlan, delegateOrganizer, leavePlan, derivePlanPhase } from '../../../services/plans';
import { DiningPlan } from '../../../types';
import StaticColors from '../../../constants/colors';
import { useColors } from '../../../context/ThemeContext';
import { useThemeTransition, buildRsvpAcceptChompConfig } from '../../../context/ThemeTransitionContext';
import { formatTimeUntilDeadline } from '../../../lib/rsvpDeadline';

const Colors = StaticColors;

/** Returns true if the plan's date is strictly before today (ignoring time). */
function isPastPlan(plan: DiningPlan): boolean {
  if (!plan.date) return false; // no date (e.g. group-swipe) → not past
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const planDate = new Date(plan.date + 'T00:00:00'); // local midnight
  return planDate < today;
}

type TabFilter = 'upcoming' | 'past' | 'all';

export default function PlansScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const Colors = useColors();
  const { plans, localAvatarUri, preferences, isGuest } = useApp();
  const { user, isAuthenticated } = useAuth();
  const { requestChomp } = useThemeTransition();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabFilter>('upcoming');
  const { planId, from } = useLocalSearchParams<{ planId?: string; from?: string }>();
  const [actionSheetPlan, setActionSheetPlan] = useState<DiningPlan | null>(null);

  // Auto-switch tab when navigating with a planId deep link
  useEffect(() => {
    if (!planId || plans.length === 0) return;
    const target = plans.find(p => p.id === planId);
    if (!target) return;
    if (target.status === 'completed' || target.status === 'cancelled' || isPastPlan(target)) {
      setActiveTab('past');
    } else {
      setActiveTab('upcoming');
    }
  }, [planId, plans]);

  const rsvpMutation = useMutation({
    mutationFn: ({ planId, action }: { planId: string; action: 'accept' | 'decline' }) =>
      rsvpPlan(planId, action),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      if (variables.action === 'accept') {
        requestChomp(buildRsvpAcceptChompConfig(Colors.primary), () => {
          Alert.alert('Done', 'You accepted the invite!');
        });
      } else {
        Alert.alert('Done', 'Invite declined.');
      }
    },
    onError: (err: Error) => {
      Alert.alert('RSVP Failed', err.message || 'Something went wrong. Please try again.');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (planId: string) => cancelPlan(planId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      Alert.alert('Plan Cancelled', 'The plan has been cancelled and participants have been notified.');
    },
    onError: (err: Error) => {
      Alert.alert('Cancel Failed', err.message || 'Something went wrong.');
    },
  });

  const delegateMutation = useMutation({
    mutationFn: ({ planId, newOwnerId }: { planId: string; newOwnerId: string }) =>
      delegateOrganizer(planId, newOwnerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      Alert.alert('Organizer Changed', 'You have transferred organizer responsibilities and left the plan.');
    },
    onError: (err: Error) => {
      Alert.alert('Delegate Failed', err.message || 'Something went wrong.');
    },
  });

  const leaveMutation = useMutation({
    mutationFn: (planId: string) => leavePlan(planId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['plans'] });
      if (data.autoCancelled) {
        Alert.alert('Plan Cancelled', 'You were the last accepted participant — the plan has been auto-cancelled.');
      } else {
        Alert.alert('Left Plan', 'You have left the plan.');
      }
    },
    onError: (err: Error) => {
      Alert.alert('Leave Failed', err.message || 'Something went wrong.');
    },
  });

  const handlePlanPress = useCallback((plan: DiningPlan) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const phase = plan.type === 'group-swipe' ? null : derivePlanPhase(plan);

    // Check if user has a pending invite on this plan
    if (isAuthenticated && user && plan.invites) {
      const myInvite = plan.invites.find(i => i.userId === user.id && i.status === 'pending');
      if (myInvite) {
        const dateTimeStr = plan.date ? `${plan.date}${plan.time ? ` at ${plan.time}` : ''}` : 'No date set';
        Alert.alert(
          `"${plan.title}"`,
          `${dateTimeStr}\n\nWill you attend?`,
          [
            {
              text: 'Decline',
              style: 'destructive',
              onPress: () => rsvpMutation.mutate({ planId: plan.id, action: 'decline' }),
            },
            {
              text: 'Accept',
              onPress: () => rsvpMutation.mutate({ planId: plan.id, action: 'accept' }),
            },
          ]
        );
        return;
      }
    }

    // Phase-aware routing for planned events
    if (phase === 'rsvp_open') {
      // Show info about RSVP status
      const accepted = plan.invites?.filter(i => i.status === 'accepted').length ?? 0;
      const pending = plan.invites?.filter(i => i.status === 'pending').length ?? 0;
      const remaining = formatTimeUntilDeadline(plan.rsvpDeadline);

      Alert.alert(
        plan.title,
        `Waiting for RSVPs\n\n${accepted} accepted, ${pending} pending\n${remaining ? `${remaining} until deadline` : 'Deadline passed'}\n\nVoting will open after the RSVP deadline.`,
      );
      return;
    }

    if (phase === 'voting_open') {
      router.push(`/group-session?planId=${plan.id}&autoStart=true` as never);
      return;
    }

    // Group-swipe plans: voting → swipe, confirmed → show results
    if (plan.type === 'group-swipe' && (plan.status === 'voting' || plan.status === 'confirmed')) {
      router.push(`/group-session?planId=${plan.id}&autoStart=true` as never);
      return;
    }

    // Confirmed planned events → show results
    if (phase === 'confirmed') {
      router.push(`/group-session?planId=${plan.id}&autoStart=true` as never);
      return;
    }

    // F-005-008: onPress for non-voting plan cards — show info
    const infoDateStr = plan.date ? `${plan.date}${plan.time ? ` at ${plan.time}` : ''}` : 'No date';
    Alert.alert(
      plan.title,
      `${infoDateStr}\nStatus: ${plan.status}\nCuisine: ${plan.cuisine ?? 'Any'} · Budget: ${plan.budget ?? 'Any'}`,
    );
  }, [isAuthenticated, user, rsvpMutation, router]);

  const handlePlanEdit = useCallback((plan: DiningPlan) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/plan-event?planId=${plan.id}` as never);
  }, [router]);

  const handleMorePress = useCallback((plan: DiningPlan) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActionSheetPlan(plan);
  }, []);

  const handleCancelPlan = useCallback(() => {
    if (!actionSheetPlan) return;
    Alert.alert(
      'Cancel Plan?',
      `Are you sure you want to cancel "${actionSheetPlan.title}"? All participants will be notified.`,
      [
        { text: 'No', style: 'cancel' },
        { text: 'Yes, Cancel', style: 'destructive', onPress: () => cancelMutation.mutate(actionSheetPlan.id) },
      ]
    );
  }, [actionSheetPlan, cancelMutation]);

  const handleDelegatePlan = useCallback(() => {
    if (!actionSheetPlan) return;
    const accepted = actionSheetPlan.invites?.filter(i => i.status === 'accepted') ?? [];
    if (accepted.length === 0) {
      Alert.alert('No Eligible Members', 'There are no accepted invitees to delegate to.');
      return;
    }
    if (accepted.length === 1) {
      // Only one choice — confirm directly
      Alert.alert(
        'Delegate Organizer?',
        `Make ${accepted[0].name} the new organizer? You will leave the plan.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delegate', onPress: () => delegateMutation.mutate({ planId: actionSheetPlan.id, newOwnerId: accepted[0].userId }) },
        ]
      );
    } else {
      // Multiple choices — let user pick
      const buttons = accepted.map(inv => ({
        text: inv.name,
        onPress: () => {
          Alert.alert(
            'Confirm Delegation',
            `Make ${inv.name} the new organizer? You will leave the plan.`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Delegate', onPress: () => delegateMutation.mutate({ planId: actionSheetPlan.id, newOwnerId: inv.userId }) },
            ]
          );
        },
      }));
      buttons.push({ text: 'Cancel', onPress: () => {} });
      Alert.alert('Choose New Organizer', 'Select who should take over:', buttons);
    }
  }, [actionSheetPlan, delegateMutation]);

  const handleLeavePlan = useCallback(() => {
    if (!actionSheetPlan) return;
    const accepted = actionSheetPlan.invites?.filter(i => i.status === 'accepted') ?? [];
    // Check if after this user leaves, there are no other accepted participants
    const otherAccepted = accepted.filter(i => i.userId !== user?.id);
    const willAutoCancel = otherAccepted.length === 0 && accepted.some(i => i.userId === user?.id);

    const message = willAutoCancel
      ? `You are the only accepted participant. Leaving will cancel "${actionSheetPlan.title}" for everyone.`
      : `Are you sure you want to leave "${actionSheetPlan.title}"?`;

    Alert.alert(
      'Leave Plan?',
      message,
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => leaveMutation.mutate(actionSheetPlan.id) },
      ]
    );
  }, [actionSheetPlan, leaveMutation, user?.id]);

  const filteredPlans = useMemo(() => {
    switch (activeTab) {
      case 'upcoming':
        return plans.filter(p =>
          (p.status === 'voting' || p.status === 'confirmed') && !isPastPlan(p)
        );
      case 'past':
        return plans.filter(p =>
          p.status === 'completed' || p.status === 'cancelled' || isPastPlan(p)
        );
      default:
        return plans;
    }
  }, [plans, activeTab]);

  const handleNewPlan = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push('/plan-event' as never);
  }, [router]);

  // ── Guest early return — placed AFTER all hooks (React rules of hooks) ──
  if (isGuest) return <LockedTabScreen variant="plans" />;

  const tabs: { key: TabFilter; label: string }[] = [
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'past', label: 'Past' },
    { key: 'all', label: 'All' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {from === 'notifications' && (
            <Pressable
              onPress={() => router.push('/notifications' as never)}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}
              accessibilityLabel="Back to notifications"
              accessibilityRole="button"
            >
              <ArrowLeft size={18} color={Colors.text} />
            </Pressable>
          )}
          <Text style={[styles.headerTitle, { color: Colors.text }]}>My Plans</Text>
        </View>
        <Pressable style={styles.addBtn} onPress={handleNewPlan} testID="new-plan-btn" accessibilityLabel="Create new plan" accessibilityRole="button">
          <Plus size={20} color="#FFF" />
        </Pressable>
      </View>

      <View style={styles.tabsRow}>
        {tabs.map(tab => (
          <Pressable
            key={tab.key}
            style={[
              styles.tab,
              { backgroundColor: Colors.card, borderColor: Colors.border },
              activeTab === tab.key && { backgroundColor: Colors.primary, borderColor: Colors.primary },
            ]}
            onPress={() => {
              Haptics.selectionAsync();
              setActiveTab(tab.key);
            }}
          >
            <Text style={[styles.tabText, { color: Colors.textSecondary }, activeTab === tab.key && { color: '#FFF' }]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={filteredPlans}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <PlanCard
            plan={item}
            currentUserId={user?.id}
            currentUserAvatarUri={localAvatarUri || user?.avatarUri}
            onPress={() => handlePlanPress(item)}
            onMorePress={() => handleMorePress(item)}
            onRestaurantPress={item.restaurant ? () => router.push({
              pathname: '/restaurant/[id]',
              params: {
                id: item.restaurant!.id,
                planDate: item.date,
                planTime: item.time,
                planPartySize: String(parseInt(preferences?.groupSize?.[0] ?? '2', 10)),
              },
            } as never) : undefined}
          />
        )}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📅</Text>
            <Text style={[styles.emptyTitle, { color: Colors.text }]}>No plans yet</Text>
            <Text style={[styles.emptySubtext, { color: Colors.textSecondary }]}>Create a dining plan to get started</Text>
            <Pressable style={styles.emptyBtn} onPress={handleNewPlan}>
              <Text style={styles.emptyBtnText}>Create Plan</Text>
            </Pressable>
          </View>
        }
        ListFooterComponent={
          rsvpMutation.isPending ? (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <ActivityIndicator color={Colors.primary} />
            </View>
          ) : null
        }
      />

      <PlanActionSheet
        visible={!!actionSheetPlan}
        plan={actionSheetPlan}
        isOwner={actionSheetPlan?.ownerId === user?.id}
        onClose={() => setActionSheetPlan(null)}
        onEdit={() => actionSheetPlan && handlePlanEdit(actionSheetPlan)}
        onDelegate={handleDelegatePlan}
        onCancel={handleCancelPlan}
        onLeave={handleLeavePlan}
      />

      {(cancelMutation.isPending || delegateMutation.isPending || leaveMutation.isPending) && (
        <View style={[styles.mutationOverlay, { backgroundColor: Colors.overlay }]}>
          <ActivityIndicator size="large" color="#FFF" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  addBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 8,
  },
  tab: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabText: {
    fontSize: 14,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  emptySubtext: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  emptyBtn: {
    marginTop: 20,
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
  },
  emptyBtnText: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: '#FFF',
  },
  mutationOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
});
