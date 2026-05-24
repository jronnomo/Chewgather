import React, { useMemo } from 'react';
import {
  View,
  Text,
  SectionList,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useApp } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { getFriends } from '../../services/friends';
import { DiningPlan } from '../../types';
import StaticColors from '../../constants/colors';
import { useColors } from '../../context/ThemeContext';
import FriendPlansHeader from '../../components/FriendPlansHeader';
import FriendPlansEmptyState from '../../components/FriendPlansEmptyState';
import PlanCard from '../../components/PlanCard';
import ScallopDivider from '../../components/ScallopDivider';

const Colors = StaticColors;

/** Format a Date to YYYY-MM-DD in local time (avoids UTC shift from toISOString) */
function localDateStr(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface Section {
  title: string;
  data: DiningPlan[];
}

function SectionHeader({ title, count, isUpcoming }: { title: string; count: number; isUpcoming: boolean }) {
  const Colors = useColors();
  return (
    <View style={styles.sectionHeaderContainer}>
      <View style={styles.sectionHeaderRow}>
        <Text
          style={[
            styles.sectionHeaderText,
            { color: isUpcoming ? Colors.text : Colors.textSecondary },
          ]}
        >
          {title}
        </Text>
        <View style={[styles.countPill, { backgroundColor: Colors.background }]}>
          <Text style={[styles.countPillText, { color: Colors.textSecondary }]}>
            {count}
          </Text>
        </View>
      </View>
      {isUpcoming && <ScallopDivider color={Colors.background} />}
    </View>
  );
}

export default function FriendPlansScreen() {
  const Colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: friendId } = useLocalSearchParams<{ id: string }>();

  const { plans, isLoading } = useApp();
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';

  const { data: friendsList = [], isLoading: friendsLoading } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
  });

  const friend = friendsList.find(f => f.id === friendId);

  const showSkeleton = isLoading || friendsLoading;

  const mutualPlans = useMemo(() => {
    if (!friendId || !currentUserId) return [];
    return plans.filter(plan => {
      if (plan.status === 'cancelled') return false;

      const inviteUserIds = (plan.invites ?? []).map(i => i.userId);

      const clauseA = plan.ownerId === friendId && inviteUserIds.includes(currentUserId);
      const clauseB = plan.ownerId === currentUserId && inviteUserIds.includes(friendId);
      const clauseC = inviteUserIds.includes(currentUserId) && inviteUserIds.includes(friendId);

      return clauseA || clauseB || clauseC;
    });
  }, [plans, friendId, currentUserId]);

  const nowDateStr = useMemo(() => localDateStr(new Date()), []);

  const upcoming = useMemo(() =>
    mutualPlans
      .filter(p => p.date && p.date >= nowDateStr)
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')),
    [mutualPlans, nowDateStr]
  );

  const past = useMemo(() =>
    mutualPlans
      .filter(p => p.date && p.date < nowDateStr)
      .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    [mutualPlans, nowDateStr]
  );

  const sections: Section[] = [];
  if (upcoming.length > 0) {
    sections.push({ title: 'Upcoming', data: upcoming });
  }
  if (past.length > 0) {
    sections.push({ title: 'Past', data: past });
  }

  const firstName = friend?.name?.split(' ')[0] ?? 'your friend';

  if (showSkeleton) {
    return (
      <View style={[styles.container, { backgroundColor: Colors.background, paddingTop: insets.top }]}>
        <ActivityIndicator
          size="large"
          color={Colors.primary}
          style={styles.centered}
        />
      </View>
    );
  }

  if (!friend) {
    return (
      <View style={[styles.container, { backgroundColor: Colors.background, paddingTop: insets.top }]}>
        <View style={styles.centeredContent}>
          <Text style={[styles.notFoundText, { color: Colors.text }]}>
            Friend not found
          </Text>
          <Pressable onPress={() => router.back()} style={styles.backLink}>
            <Text style={[styles.backLinkText, { color: Colors.primary }]}>Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const isEmpty = sections.length === 0;

  return (
    <View style={[styles.container, { backgroundColor: Colors.background, paddingTop: insets.top }]}>
      <FriendPlansHeader
        name={friend!.name}
        avatarUri={friend!.avatarUri}
        mutualCount={mutualPlans.length}
        onBack={() => router.back()}
      />
      {isEmpty ? (
        <FriendPlansEmptyState
          firstName={firstName}
          avatarUri={friend!.avatarUri}
          onPlanPress={() =>
            router.push(`/plan-event?preselectFriendId=${friendId}` as never)
          }
        />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={item => item.id}
          renderItem={({ item }) => (
            <PlanCard
              plan={item}
              currentUserId={currentUserId}
              currentUserAvatarUri={user?.avatarUri}
            />
          )}
          renderSectionHeader={({ section }) => (
            <SectionHeader
              title={section.title.toUpperCase()}
              count={section.data.length}
              isUpcoming={section.title === 'Upcoming'}
            />
          )}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    flex: 1,
  },
  centeredContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  notFoundText: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },
  backLink: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  backLinkText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
  },
  sectionHeaderContainer: {
    paddingTop: 16,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 8,
    gap: 8,
  },
  sectionHeaderText: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: Colors.text,
  },
  countPill: {
    borderRadius: 99,
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: Colors.background,
  },
  countPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  listContent: {
    paddingBottom: 32,
  },
});
