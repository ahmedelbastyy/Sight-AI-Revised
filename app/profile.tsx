import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  KeyboardAvoidingView, Platform, Keyboard,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useApp } from '../contexts/AppContext';
import { useAlert } from '@/template';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { userName, userEmail, updateUserName, isSubscribed, currentTheme: t } = useApp();
  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState(userName);

  const handleSaveName = () => {
    if (newName.trim()) {
      updateUserName(newName.trim());
      setEditingName(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert('Updated', 'Your name has been updated successfully.');
    }
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.container, { backgroundColor: t.background }]}>
      <View style={[styles.header, { borderBottomColor: t.border }]}>
        <Pressable style={[styles.backBtn, { backgroundColor: t.surface, borderColor: t.border }]}
          onPress={() => { Haptics.selectionAsync(); router.back(); }}>
          <MaterialIcons name="arrow-back" size={22} color={t.textPrimary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: t.textPrimary }]}>Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always" keyboardDismissMode="on-drag" onScrollBeginDrag={Keyboard.dismiss}>
          {/* Avatar */}
          <View style={styles.avatarSection}>
            <View style={[styles.avatar, { backgroundColor: t.primary + '20' }]}>
              <Text style={[styles.avatarText, { color: t.primary }]}>
                {userName ? userName.charAt(0).toUpperCase() : 'T'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[styles.displayName, { color: t.textPrimary }]}>{userName || 'Trader'}</Text>
              {isSubscribed ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,215,0,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, gap: 3 }}>
                  <MaterialIcons name="workspace-premium" size={12} color="#FFD700" />
                  <Text style={{ fontSize: 10, fontWeight: '800', color: '#FFD700', letterSpacing: 1 }}>PRO</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.displayEmail, { color: t.textSecondary }]}>{userEmail || 'Not set'}</Text>
          </View>

          {/* Name */}
          <View style={[styles.fieldSection, { borderColor: t.border }]}>
            <Text style={[styles.fieldLabel, { color: t.textTertiary }]}>FULL NAME</Text>
            {editingName ? (
              <View style={styles.editRow}>
                <TextInput
                  style={[styles.editInput, { backgroundColor: t.surface, borderColor: t.border, color: t.textPrimary }]}
                  value={newName}
                  onChangeText={setNewName}
                  autoFocus
                  placeholder="Enter your name"
                  placeholderTextColor={t.textTertiary}
                  onSubmitEditing={handleSaveName}
                  returnKeyType="done"
                  blurOnSubmit={true}
                />
                <Pressable style={[styles.saveBtn, { backgroundColor: t.primary }]} onPress={handleSaveName}>
                  <Text style={styles.saveBtnText}>Save</Text>
                </Pressable>
                <Pressable onPress={() => { setEditingName(false); setNewName(userName); }}>
                  <Text style={{ color: t.textTertiary, fontWeight: '600' }}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Pressable style={styles.editableRow} onPress={() => setEditingName(true)}>
                <Text style={[styles.fieldValue, { color: t.textPrimary }]}>{userName || 'Not set'}</Text>
                <MaterialIcons name="edit" size={18} color={t.primary} />
              </Pressable>
            )}
          </View>

          {/* Email (read-only) */}
          <View style={[styles.fieldSection, { borderColor: t.border }]}>
            <Text style={[styles.fieldLabel, { color: t.textTertiary }]}>EMAIL</Text>
            <Text style={[styles.fieldValue, { color: t.textPrimary }]}>{userEmail || 'Not set'}</Text>
            <Text style={{ fontSize: 12, color: t.textTertiary, marginTop: 4 }}>This is the email used to create your account</Text>
          </View>

          {/* Subscription Status */}
          <View style={[styles.fieldSection, { borderColor: t.border }]}>
            <Text style={[styles.fieldLabel, { color: t.textTertiary }]}>SUBSCRIPTION</Text>
            <Text style={[styles.fieldValue, { color: isSubscribed ? t.bullish : t.textSecondary }]}>
              {isSubscribed ? 'Pro Plan - Active' : 'Free Plan'}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, gap: 8, borderBottomWidth: 1 },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  avatarSection: { alignItems: 'center', paddingVertical: 32 },
  avatar: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText: { fontSize: 32, fontWeight: '700' },
  displayName: { fontSize: 22, fontWeight: '700' },
  displayEmail: { fontSize: 14, marginTop: 4 },
  fieldSection: { marginHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1 },
  fieldLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  fieldValue: { fontSize: 16, fontWeight: '600' },
  editableRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editInput: { flex: 1, height: 44, borderRadius: 8, paddingHorizontal: 12, fontSize: 16, borderWidth: 1 },
  saveBtn: { paddingHorizontal: 16, height: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#FFF', fontWeight: '600', fontSize: 14 },
});
