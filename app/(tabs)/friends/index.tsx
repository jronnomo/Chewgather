import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  Alert,
  ActivityIndicator,
  Share,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus,
  Search,
  Users,
  Check,
  X,
  Smartphone,
  Link,
  Clock,
  ArrowLeft,
} from 'lucide-react-native';
import * as Contacts from 'expo-contacts';
import * as Haptics from 'expo-haptics';
import {
  getFriends,
  getFriendRequests,
  sendFriendRequest,
  respondToRequest,
  lookupByPhones,
  lookupByInviteCode,
} from '../../../services/friends';
import { useApp } from '../../../context/AppContext';
import { useAuth } from '../../../context/AuthContext';
import { NetworkError } from '../../../services/api';
import { Friend, FriendRequest } from '../../../types';
import StaticColors from '../../../constants/colors';
import { DEFAULT_AVATAR_URI } from '../../../constants/images';
import LockedTabScreen from '../../../components/LockedTabScreen';
import { useColors } from '../../../context/ThemeContext';
import { useThemeTransition, buildFriendAcceptChompConfig } from '../../../context/ThemeTransitionContext';
import SortHint from '../../../components/SortHint';

const Colors = StaticColors;

type Tab = 'friends' | 'requests' | 'add';

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}

export default function FriendsTabScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const Colors = useColors();
  const { isGuest } = useApp();
  const { user } = useAuth();
  const { requestChomp } = useThemeTransition();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tab?: string; from?: string }>();

  const [tab, setTab] = useState<Tab>('friends');

  // Deep link: switch to the requested tab (e.g. ?tab=requests from notifications)
  useEffect(() => {
    if (params.tab === 'requests' || params.tab === 'add') {
      setTab(params.tab);
    }
  }, [params.tab]);
  const [inviteCode, setInviteCode] = useState('');
  const [codeResult, setCodeResult] = useState<{ id: string; name: string; avatarUri?: string } | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [codeLoading, setCodeLoading] = useState(false);
  const [contactMatches, setContactMatches] = useState<{ id: string; name: string; phone?: string; avatarUri?: string }[]>([]);

  const { data: friends = [], isLoading: friendsLoading } = useQuery({
    queryKey: ['friends'],
    queryFn: getFriends,
  });

  const { data: requests = [], isLoading: requestsLoading } = useQuery({
    queryKey: ['friendRequests'],
    queryFn: getFriendRequests,
  });

  const sortedFriends = useMemo(
    () =>
      [...friends].sort((a, b) => {
        const planDiff = (b.mutualPlans ?? 0) - (a.mutualPlans ?? 0);
        if (planDiff !== 0) return planDiff;
        return String(a.name ?? '').localeCompare(String(b.name ?? ''));
      }),
    [friends],
  );

  const addMutation = useMutation({
    mutationFn: sendFriendRequest,
    onSuccess: () => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      queryClient.invalidateQueries({ queryKey: ['friendRequests'] });
      Alert.alert('Request Sent', 'Your friend request has been sent!');
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    },
  });

  const respondMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'decline' }) =>
      respondToRequest(id, action),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['friendRequests'] });
      queryClient.invalidateQueries({ queryKey: ['friends'] });
      if (variables.action === 'accept') {
        requestChomp(buildFriendAcceptChompConfig(Colors.primary), () => {});
      } else {
        // Decline is a neutral acknowledgement, not a celebration — a Success
        // haptic reads as "yay, declined!" which is tonally wrong (#180).
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    },
  });

  const handleScanContacts = useCallback(async () => {
    setScanLoading(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Contacts permission is needed to find friends.');
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers],
      });

      const phones: string[] = [];
      for (const contact of data) {
        for (const p of contact.phoneNumbers ?? []) {
          const normalized = normalizePhone(p.number ?? '');
          if (normalized) phones.push(normalized);
        }
      }

      const unique = [...new Set(phones)];
      if (unique.length === 0) {
        Alert.alert('No Contacts', 'No phone numbers found in your contacts.');
        return;
      }

      const matches = await lookupByPhones(unique);
      const friendIds = new Set(friends.map(f => f.id));
      const filtered = matches.filter(m => m.id !== user?.id && !friendIds.has(m.id));
      setContactMatches(filtered);

      if (filtered.length === 0) {
        Alert.alert('No Matches', 'None of your contacts are on Chewabl yet. Invite them with your link!');
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to scan contacts.');
      console.error(err);
    } finally {
      setScanLoading(false);
    }
  }, [user?.id, friends]);

  const handleInviteLink = useCallback(async () => {
    if (!user?.inviteCode) {
      // Silent no-op was the original behavior — the button looked tappable
      // but did nothing if the user record was missing inviteCode (e.g.
      // pre-migration accounts, or a backend race that returned an
      // incomplete user). Surface a real message so the user knows
      // something is off and can retry after sign-in.
      Alert.alert(
        'Invite link unavailable',
        "Your invite code hasn't loaded yet. Try signing out and back in, or pull to refresh on the Friends tab.",
      );
      return;
    }
    await Share.share({
      message: `Join me on Chewabl! Use my invite code: ${user.inviteCode}\n\nDownload the app and enter the code when signing up.`,
    });
  }, [user?.inviteCode]);

  const handleLookupCode = useCallback(async () => {
    const code = inviteCode.trim().toUpperCase();
    if (code.length < 6) {
      Alert.alert('Invalid Code', 'Please enter a valid invite code.');
      return;
    }
    setCodeLoading(true);
    try {
      const result = await lookupByInviteCode(code);
      if (!result || result.id === user?.id) {
        Alert.alert('Not Found', 'No user found with that invite code.');
        setCodeResult(null);
      } else {
        const friendIds = new Set(friends.map(f => f.id));
        if (friendIds.has(result.id)) {
          Alert.alert('Already Friends', 'You are already friends with this user.');
          setCodeResult(null);
        } else {
          setCodeResult(result);
        }
      }
    } catch (err: unknown) {
      setCodeResult(null);
      if (err instanceof NetworkError) {
        Alert.alert('Connection Error', 'Could not reach the server. Please check your connection.');
      } else {
        Alert.alert('Error', err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally {
      setCodeLoading(false);
    }
  }, [inviteCode, user?.id, friends]);

  const renderFriend = useCallback(({ item }: { item: Friend }) => {
    const mutualCount = item.mutualPlans ?? 0;
    const subtitle =
      mutualCount > 0
        ? mutualCount === 1
          ? '1 plan together'
          : `${mutualCount} plans together`
        : item.phone ?? null;

    return (
      <Pressable
        onPress={() => router.push(`/friend-plans/${item.id}` as never)}
        accessibilityRole="button"
        accessibilityLabel={`Open plans with ${item.name}`}
      >
        <View style={[styles.personRow, { backgroundColor: Colors.card }]}>
          <Image source={item.avatarUri || DEFAULT_AVATAR_URI} style={styles.avatar} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.personName, { color: Colors.text }]}>{item.name}</Text>
            {subtitle !== null && (
              <Text style={[styles.personSub, { color: Colors.textSecondary }]}>{subtitle}</Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  }, [Colors, router]);

  // ── Guest early return — placed AFTER all hooks (React rules of hooks) ──
  if (isGuest) return <LockedTabScreen variant="friends" />;

  const renderRequest = ({ item }: { item: FriendRequest }) => {
    if (item.direction === 'sent') {
      const person = item.to;
      return (
        <View style={[styles.personRow, { backgroundColor: Colors.card }]}>
          <Image source={person?.avatarUri || DEFAULT_AVATAR_URI} style={styles.avatar} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={[styles.personName, { color: Colors.text }]}>{person?.name}</Text>
            <Text style={{ fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}>Request sent</Text>
          </View>
          <View style={[styles.pendingBadge, { backgroundColor: Colors.primaryLight }]}>
            <Clock size={12} color={Colors.primary} />
            <Text style={{ fontSize: 12, fontWeight: '600', color: Colors.primary }}>Pending</Text>
          </View>
        </View>
      );
    }

    const person = item.from;
    return (
      <View style={[styles.personRow, { backgroundColor: Colors.card }]}>
        <Image source={person?.avatarUri || DEFAULT_AVATAR_URI} style={styles.avatar} contentFit="cover" />
        <Text style={[styles.personName, { flex: 1, color: Colors.text }]}>{person?.name}</Text>
        <Pressable
          style={[styles.respondBtn, styles.respondBtnAccept, { backgroundColor: Colors.success }]}
          onPress={() => respondMutation.mutate({ id: item.id, action: 'accept' })}
          disabled={respondMutation.isPending}
          accessibilityLabel="Accept friend request"
          accessibilityRole="button"
        >
          <Check size={16} color="#FFF" />
        </Pressable>
        <Pressable
          style={[styles.respondBtn, styles.respondBtnDecline, { borderColor: Colors.error }]}
          onPress={() => respondMutation.mutate({ id: item.id, action: 'decline' })}
          disabled={respondMutation.isPending}
          accessibilityLabel="Decline friend request"
          accessibilityRole="button"
        >
          <X size={16} color={Colors.error} />
        </Pressable>
      </View>
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: Colors.background }]}>
      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {params.from === 'notifications' && (
            <Pressable
              onPress={() => router.push('/notifications' as never)}
              style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}
              accessibilityLabel="Back to notifications"
              accessibilityRole="button"
            >
              <ArrowLeft size={18} color={Colors.text} />
            </Pressable>
          )}
          <Text style={[styles.headerTitle, { color: Colors.text }]}>Friends</Text>
        </View>
      </View>

      <View style={[styles.tabRow, { backgroundColor: Colors.card }]}>
        {(['friends', 'requests', 'add'] as Tab[]).map(t => (
          <Pressable
            key={t}
            style={[styles.tab, tab === t && { backgroundColor: Colors.primary }]}
            onPress={() => setTab(t)}
          >
            <Text style={[
              styles.tabText,
              { color: Colors.textSecondary },
              tab === t && { color: '#FFF' },
            ]}>
              {t === 'friends' ? 'Friends'
                : t === 'requests' ? 'Requests'
                : 'Add'}
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'friends' && (
        <>
          <SortHint />
          <FlatList
            data={sortedFriends}
            keyExtractor={item => item.id}
            renderItem={renderFriend}
            contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            friendsLoading ? (
              <ActivityIndicator style={styles.loader} color={Colors.primary} />
            ) : (
              <View style={styles.emptyState}>
                <Users size={40} color={Colors.border} />
                <Text style={[styles.emptyText, { color: Colors.text }]}>No friends yet</Text>
                <Text style={[styles.emptySub, { color: Colors.textSecondary }]}>Add friends to start group swiping</Text>
              </View>
            )
          }
          />
        </>
      )}

      {tab === 'requests' && (
        <FlatList
          data={requests}
          keyExtractor={item => item.id}
          renderItem={renderRequest}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            requestsLoading ? (
              <ActivityIndicator style={styles.loader} color={Colors.primary} />
            ) : (
              <View style={styles.emptyState}>
                <UserPlus size={40} color={Colors.border} />
                <Text style={[styles.emptyText, { color: Colors.text }]}>No pending requests</Text>
              </View>
            )
          }
        />
      )}

      {tab === 'add' && (
        <FlatList
          data={contactMatches}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={(
            <View>
              <Pressable style={[styles.actionCard, { backgroundColor: Colors.card }]} onPress={handleScanContacts} disabled={scanLoading}>
                {scanLoading ? (
                  <ActivityIndicator color={Colors.primary} />
                ) : (
                  <Smartphone size={22} color={Colors.primary} />
                )}
                <View style={styles.actionCardContent}>
                  <Text style={[styles.actionCardTitle, { color: Colors.text }]}>Scan Contacts</Text>
                  <Text style={[styles.actionCardSub, { color: Colors.textSecondary }]}>Find friends already on Chewabl</Text>
                </View>
              </Pressable>

              <Pressable style={[styles.actionCard, { backgroundColor: Colors.card }]} onPress={handleInviteLink}>
                <Link size={22} color={Colors.secondary} />
                <View style={styles.actionCardContent}>
                  <Text style={[styles.actionCardTitle, { color: Colors.text }]}>Invite by Link</Text>
                  <Text style={[styles.actionCardSub, { color: Colors.textSecondary }]}>
                    Your code: {user?.inviteCode ?? '\u2014'}
                  </Text>
                </View>
              </Pressable>

              <View style={styles.codeSection}>
                <Text style={[styles.codeSectionTitle, { color: Colors.text }]}>Enter Invite Code</Text>
                <View style={styles.codeRow}>
                  <TextInput
                    style={[styles.codeInput, { backgroundColor: Colors.card, color: Colors.text, borderColor: Colors.border }]}
                    placeholder="e.g. AB3K9X2M"
                    placeholderTextColor={Colors.textTertiary}
                    value={inviteCode}
                    onChangeText={t => setInviteCode(t.toUpperCase())}
                    autoCapitalize="characters"
                    maxLength={8}
                  />
                  <Pressable style={styles.codeBtn} onPress={handleLookupCode} disabled={codeLoading} accessibilityLabel="Look up invite code" accessibilityRole="button">
                    {codeLoading ? (
                      <ActivityIndicator color="#FFF" size="small" />
                    ) : (
                      <Search size={18} color="#FFF" />
                    )}
                  </Pressable>
                </View>

                {codeResult && (
                  <View style={[styles.personRow, { backgroundColor: Colors.card }]}>
                    <Image source={codeResult.avatarUri || DEFAULT_AVATAR_URI} style={styles.avatar} contentFit="cover" />
                    <Text style={[styles.personName, { flex: 1, color: Colors.text }]}>{codeResult.name}</Text>
                    <Pressable
                      style={[styles.addBtn, addMutation.isPending && styles.addBtnDisabled]}
                      disabled={addMutation.isPending}
                      onPress={() => {
                        addMutation.mutate(codeResult.id);
                        setCodeResult(null);
                        setInviteCode('');
                      }}
                    >
                      <UserPlus size={16} color="#FFF" />
                      <Text style={styles.addBtnText}>Add</Text>
                    </Pressable>
                  </View>
                )}
              </View>

              {contactMatches.length > 0 && (
                <Text style={[styles.matchesHeader, { color: Colors.text }]}>Contacts on Chewabl</Text>
              )}
            </View>
          )}
          renderItem={({ item }) => (
            <View style={[styles.personRow, { backgroundColor: Colors.card }]}>
              <Image source={item.avatarUri || DEFAULT_AVATAR_URI} style={styles.avatar} contentFit="cover" />
              <View style={{ flex: 1 }}>
                <Text style={[styles.personName, { color: Colors.text }]}>{item.name}</Text>
                {item.phone && <Text style={[styles.personSub, { color: Colors.textSecondary }]}>{item.phone}</Text>}
              </View>
              <Pressable
                style={[styles.addBtn, addMutation.isPending && styles.addBtnDisabled]}
                disabled={addMutation.isPending}
                onPress={() => {
                  addMutation.mutate(item.id);
                  setContactMatches(prev => prev.filter(m => m.id !== item.id));
                }}
              >
                <UserPlus size={16} color="#FFF" />
                <Text style={styles.addBtnText}>Add</Text>
              </Pressable>
            </View>
          )}
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
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.text,
  },
  tabRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 4,
    marginTop: 14,
    marginBottom: 16,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  loader: {
    marginTop: 40,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 60,
    gap: 10,
  },
  emptyText: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  emptySub: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  personName: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
  },
  personSub: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  respondBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  respondBtnAccept: {
    backgroundColor: Colors.success,
  },
  respondBtnDecline: {
    backgroundColor: Colors.card,
    borderWidth: 1.5,
    borderColor: Colors.error,
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  actionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 14,
  },
  actionCardContent: {
    flex: 1,
  },
  actionCardTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
  },
  actionCardSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  codeSection: {
    marginBottom: 20,
  },
  codeSectionTitle: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 10,
  },
  codeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  codeInput: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    borderWidth: 1.5,
    borderColor: Colors.border,
    letterSpacing: 2,
  },
  codeBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  matchesHeader: {
    fontSize: 15,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 10,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 5,
  },
  addBtnDisabled: {
    opacity: 0.5,
  },
  addBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#FFF',
  },
});
