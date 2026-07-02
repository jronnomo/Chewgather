import React from 'react';
import { View, Text, StyleSheet, Pressable, Modal } from 'react-native';
import { Pencil, ArrowRightLeft, XCircle, LogOut, CheckCircle2, Gavel } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { DiningPlan } from '../types';
import StaticColors from '../constants/colors';
import { useColors } from '../context/ThemeContext';

const Colors = StaticColors;

interface PlanActionSheetProps {
  visible: boolean;
  plan: DiningPlan | null;
  isOwner: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelegate: () => void;
  onMarkComplete: () => void;
  onCancel: () => void;
  onLeave: () => void;
  /** #323: owner-only escape hatch for group swipes stuck on absent voters. */
  onEndVoting?: () => void;
}

export default function PlanActionSheet({
  visible,
  plan,
  isOwner,
  onClose,
  onEdit,
  onDelegate,
  onMarkComplete,
  onCancel,
  onLeave,
  onEndVoting,
}: PlanActionSheetProps) {
  const Colors = useColors();

  if (!plan) return null;

  // #323: an owner can end voting early on a still-voting group swipe —
  // without this, one participant who never finishes stalls the plan forever.
  const canEndVoting =
    plan.type === 'group-swipe' && (plan.status ?? 'voting') === 'voting' && !!onEndVoting;

  const handleAction = (action: () => void) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onClose();
    // Small delay so modal closes before action fires (prevents visual overlap with Alert)
    setTimeout(action, 300);
  };

  // Determine if delegate is possible: need at least 2 invitees with at least 1 accepted
  const hasAcceptedInvitees = (plan.invites?.filter(i => i.status === 'accepted').length ?? 0) > 0;
  const hasEnoughForDelegate = (plan.invites?.length ?? 0) >= 2 && hasAcceptedInvitees;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={[styles.overlay, { backgroundColor: Colors.overlay }]} onPress={onClose}>
        <View style={[styles.sheet, { backgroundColor: Colors.card }]}>
          <View style={[styles.handle, { backgroundColor: Colors.border }]} />
          <Text style={[styles.title, { color: Colors.text }]} numberOfLines={1}>
            {plan.title}
          </Text>

          {isOwner ? (
            <>
              {/* End Voting (#323) — group-swipe still voting; picks the winner
                  from votes cast so far */}
              {canEndVoting && (
                <Pressable
                  style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
                  onPress={() => handleAction(onEndVoting!)}
                  testID="plan-action-end-voting"
                >
                  <Gavel size={20} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.actionText, { color: Colors.text }]}>End Voting Now</Text>
                    <Text style={[styles.actionHint, { color: Colors.textTertiary }]}>
                      Pick the winner from votes so far
                    </Text>
                  </View>
                </Pressable>
              )}

              {/* Edit — only for planned type (group-swipe has no edit screen) */}
              {plan.type !== 'group-swipe' && (
                <Pressable
                  style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
                  onPress={() => handleAction(onEdit)}
                >
                  <Pencil size={20} color={Colors.text} />
                  <Text style={[styles.actionText, { color: Colors.text }]}>Edit Plan</Text>
                </Pressable>
              )}

              {/* Delegate */}
              <Pressable
                style={[
                  styles.actionRow,
                  { borderBottomColor: Colors.borderLight },
                  !hasEnoughForDelegate && styles.actionDisabled,
                ]}
                onPress={hasEnoughForDelegate ? () => handleAction(onDelegate) : undefined}
                disabled={!hasEnoughForDelegate}
              >
                <ArrowRightLeft size={20} color={hasEnoughForDelegate ? Colors.text : Colors.textTertiary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.actionText, { color: hasEnoughForDelegate ? Colors.text : Colors.textTertiary }]}>
                    Delegate Organizer
                  </Text>
                  {!hasEnoughForDelegate && (
                    <Text style={[styles.actionHint, { color: Colors.textTertiary }]}>
                      Needs 2+ invitees with at least 1 accepted
                    </Text>
                  )}
                </View>
              </Pressable>

              {/* Mark Complete — only once a winner is locked in (confirmed) */}
              {plan.status === 'confirmed' && (
                <Pressable
                  style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
                  onPress={() => handleAction(onMarkComplete)}
                >
                  <CheckCircle2 size={20} color={Colors.success} />
                  <Text style={[styles.actionText, { color: Colors.text }]}>Mark Complete</Text>
                </Pressable>
              )}

              {/* Cancel */}
              <Pressable
                style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
                onPress={() => handleAction(onCancel)}
              >
                <XCircle size={20} color={Colors.error} />
                <Text style={[styles.actionText, { color: Colors.error }]}>Cancel Plan</Text>
              </Pressable>
            </>
          ) : (
            /* Participant: Leave */
            <Pressable
              style={[styles.actionRow, { borderBottomColor: Colors.borderLight }]}
              onPress={() => handleAction(onLeave)}
            >
              <LogOut size={20} color={Colors.error} />
              <Text style={[styles.actionText, { color: Colors.error }]}>Leave Plan</Text>
            </Pressable>
          )}

          {/* Close */}
          <Pressable style={styles.closeRow} onPress={onClose}>
            <Text style={[styles.closeText, { color: Colors.textSecondary }]}>Close</Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 34,
    paddingTop: 12,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '700' as const,
    color: Colors.text,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  actionText: {
    fontSize: 16,
    fontWeight: '500' as const,
    color: Colors.text,
  },
  actionHint: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2,
  },
  actionDisabled: {
    opacity: 0.5,
  },
  closeRow: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 4,
  },
  closeText: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
  },
});
