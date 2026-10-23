import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  NativeModules,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  AdminAppConfig,
  CACHED_USER_PROFILE_KEY,
  CachedUserProfile,
  CURRENT_APP_VERSION,
  PurchaseRecord,
  SUPER_ADMIN_EMAIL,
  clearAllLocalAccountData,
  getAccountCodeForUser,
  getAdminAppConfig,
  getUserPurchaseHistory,
  isUserAdmin,
  recordUserPurchaseHistory,
  restoreCloudBackupAfterGoogleLogin,
  saveAdminAppConfig,
  supabase,
  syncLocalDataToCloudIfOnline,
} from '../../lib/supabase';

const { FocusLock } = NativeModules;

export default function ProfileScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [syncingCloud, setSyncingCloud] = useState(false);
  const [userProfile, setUserProfile] = useState<CachedUserProfile>({
    id: 'local-user',
    email: 'user@toki.app',
    name: 'Toki Focus User',
    avatarUrl: '',
  });
  const [contactsCount, setContactsCount] = useState(0);
  const [schedulesCount, setSchedulesCount] = useState(0);
  const [logoutModalVisible, setLogoutModalVisible] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [focusStats, setFocusStats] = useState<{
    streakDays: number;
    emergencyPasses: number;
    daysUntilNextPass: number;
    totalFocusMinutes: number;
    completedSessions: number;
    heatmap: { date: string; minutes: number }[];
    isPro: boolean;
    proExpiresAt: number;
    proPlanName: string;
    proDaysRemaining: number;
    accountCode: string;
  }>({
    streakDays: 0,
    emergencyPasses: 0,
    daysUntilNextPass: 99,
    totalFocusMinutes: 0,
    completedSessions: 0,
    heatmap: [],
    isPro: false,
    proExpiresAt: 0,
    proPlanName: 'Free',
    proDaysRemaining: 0,
    accountCode: 'TK-USER0001',
  });

  // Admin & Store Config
  const [adminConfig, setAdminConfig] = useState<AdminAppConfig | null>(null);
  const [purchaseHistory, setPurchaseHistory] = useState<PurchaseRecord[]>([]);

  // Modals
  const [storeModalVisible, setStoreModalVisible] = useState(false);
  const [storeTab, setStoreTab] = useState<'PRO' | 'PASS' | 'REDEEM' | 'HISTORY'>('PRO');
  const [selectedPlanType, setSelectedPlanType] = useState<'PRO30' | 'PRO180' | 'PRO365' | 'PASS1' | 'PASS3'>('PRO180');
  const [trxIdInput, setTrxIdInput] = useState('');
  const [senderPhoneInput, setSenderPhoneInput] = useState('');
  const [activationKeyInput, setActivationKeyInput] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  // Admin Panel State
  const [adminModalVisible, setAdminModalVisible] = useState(false);
  const [adminTab, setAdminTab] = useState<'KEYS' | 'REQUESTS' | 'SETTINGS' | 'OTA'>('KEYS');
  const [targetUserAccountCode, setTargetUserAccountCode] = useState('');
  const [targetPlanType, setTargetPlanType] = useState<'PRO30' | 'PRO180' | 'PRO365' | 'PASS1' | 'PASS3'>('PRO180');
  const [generatedAdminKey, setGeneratedAdminKey] = useState('');

  // Admin Settings Drafts
  const [editWhatsapp, setEditWhatsapp] = useState('01761632836');
  const [editBkash, setEditBkash] = useState('01761632836');
  const [editPricePro30, setEditPricePro30] = useState('49');
  const [editPricePro180, setEditPricePro180] = useState('199');
  const [editPricePro365, setEditPricePro365] = useState('349');
  const [editPricePass1, setEditPricePass1] = useState('19');
  const [editPricePass3, setEditPricePass3] = useState('49');
  const [newAdminEmailInput, setNewAdminEmailInput] = useState('');

  // OTA Update Drafts
  const [editOtaVersion, setEditOtaVersion] = useState(CURRENT_APP_VERSION);
  const [editOtaUrl, setEditOtaUrl] = useState('');
  const [editOtaNotes, setEditOtaNotes] = useState('');
  const [editOtaForce, setEditOtaForce] = useState(false);

  // Toast / Alert Modal
  const [feedbackModal, setFeedbackModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({ visible: false, title: '', message: '', type: 'info' });

  const showFeedback = (title: string, message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setFeedbackModal({ visible: true, title, message, type });
  };

  const buildLast60DaysHeatmap = (historyObj: Record<string, number>) => {
    const arr: { date: string; minutes: number }[] = [];
    const today = new Date();
    for (let i = 59; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      const iso = d.toISOString().split('T')[0];
      arr.push({ date: iso, minutes: Number(historyObj[iso] || 0) });
    }
    return arr;
  };

  const loadAllProfileData = async () => {
    try {
      let currentEmail = 'user@toki.app';
      let currentId = 'local-user';
      const cachedRaw = await AsyncStorage.getItem(CACHED_USER_PROFILE_KEY);
      if (cachedRaw) {
        const parsed = JSON.parse(cachedRaw);
        if (parsed && parsed.email) {
          setUserProfile(parsed);
          currentEmail = parsed.email;
          currentId = parsed.id || parsed.email;
        }
      }

      try {
        const { data } = await supabase.auth.getUser();
        if (data?.user) {
          currentEmail = data.user.email || currentEmail;
          currentId = data.user.id || currentId;
          const freshProfile: CachedUserProfile = {
            id: data.user.id,
            email: data.user.email || 'user@toki.app',
            name:
              data.user.user_metadata?.full_name ||
              data.user.user_metadata?.name ||
              data.user.email?.split('@')[0] ||
              'Toki User',
            avatarUrl:
              data.user.user_metadata?.avatar_url ||
              data.user.user_metadata?.picture ||
              '',
            accountCode: getAccountCodeForUser(data.user.id || data.user.email || 'local-user'),
          };
          setUserProfile(freshProfile);
          await AsyncStorage.setItem(CACHED_USER_PROFILE_KEY, JSON.stringify(freshProfile));
        }
      } catch {}

      const deterministicCode = getAccountCodeForUser(currentId || currentEmail);

      // Load Admin Config & History
      const cfg = await getAdminAppConfig();
      setAdminConfig(cfg);
      setEditWhatsapp(cfg.whatsappNumber);
      setEditBkash(cfg.bkashNagadNumber);
      setEditPricePro30(String(cfg.prices.pro30));
      setEditPricePro180(String(cfg.prices.pro180));
      setEditPricePro365(String(cfg.prices.pro365));
      setEditPricePass1(String(cfg.prices.pass1));
      setEditPricePass3(String(cfg.prices.pass3));
      setEditOtaVersion(cfg.appUpdate.latestVersion || CURRENT_APP_VERSION);
      setEditOtaUrl(cfg.appUpdate.downloadUrl || '');
      setEditOtaNotes(cfg.appUpdate.releaseNotes || '');
      setEditOtaForce(!!cfg.appUpdate.forceUpdate);

      const history = await getUserPurchaseHistory();
      setPurchaseHistory(history);

      if (FocusLock?.getFocusSessionState) {
        const s = await FocusLock.getFocusSessionState();
        let historyObj: Record<string, number> = {};
        try {
          historyObj = JSON.parse(s.completedHistoryJson || '{}');
        } catch {}
        const heatmapArr = buildLast60DaysHeatmap(historyObj);
        const totalFocusMins = Object.values(historyObj).reduce(
          (acc, val) => acc + (Number(val) || 0),
          0
        );
        const proExpiresAt = Number(s.proExpiresAt ?? 0);
        const isPro = !!s.isPro && proExpiresAt > Date.now();
        const proDaysRemaining = isPro
          ? Math.max(1, Math.ceil((proExpiresAt - Date.now()) / 86400000))
          : 0;
        const streakDays = Number(s.streakDays ?? 0);

        setFocusStats({
          streakDays,
          emergencyPasses: Number(s.emergencyPasses ?? 0),
          daysUntilNextPass: Math.max(1, 99 - (streakDays % 99)),
          totalFocusMinutes: totalFocusMins > 0 ? totalFocusMins : Number(s.totalCompleted ?? 0) * 45,
          completedSessions: Number(s.totalCompleted ?? 0),
          heatmap: heatmapArr,
          isPro,
          proExpiresAt,
          proPlanName: s.proPlanName || (isPro ? 'Toki Pro' : 'Free'),
          proDaysRemaining,
          accountCode: deterministicCode,
        });
      }

      const rawScheds = await AsyncStorage.getItem('@focus_multi_schedules');
      if (rawScheds) {
        const parsed = JSON.parse(rawScheds || '[]');
        if (Array.isArray(parsed)) {
          setSchedulesCount(parsed.filter((s: any) => s.isEnabled || s.enabled).length);
        }
      } else {
        setSchedulesCount(0);
      }

      const rawContacts =
        (await AsyncStorage.getItem('@networking_contacts')) ||
        (await AsyncStorage.getItem('offline_contacts'));
      if (rawContacts) {
        const parsedContacts = JSON.parse(rawContacts);
        if (Array.isArray(parsedContacts)) {
          setContactsCount(parsedContacts.length);
        }
      } else {
        setContactsCount(0);
      }
    } catch {}
  };

  useFocusEffect(
    useCallback(() => {
      loadAllProfileData();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await syncLocalDataToCloudIfOnline();
    await loadAllProfileData();
    setRefreshing(false);
  };

  const handleManualCloudSync = async () => {
    setSyncingCloud(true);
    try {
      await syncLocalDataToCloudIfOnline();
      await restoreCloudBackupAfterGoogleLogin();
      await loadAllProfileData();
      showFeedback(
        'ক্লাউড সিঙ্ক সম্পন্ন ☁️',
        'আপনার সব ডেটা, স্ট্রিক এবং প্রো স্ট্যাটাস ক্লাউডে নিরাপদে সিঙ্ক হয়েছে।',
        'success'
      );
    } catch {
    } finally {
      setSyncingCloud(false);
    }
  };

  const handleLogoutConfirm = async () => {
    if (FocusLock?.getFocusSessionState) {
      const status = await FocusLock.getFocusSessionState();
      if (status?.active) {
        setLogoutModalVisible(false);
        showFeedback(
          'লক চলাকালীন লগআউট নিষিদ্ধ 🔒',
          'ফোকাস লক চলাকালীন অ্যাকাউন্ট লগআউট করা যাবে না।',
          'error'
        );
        return;
      }
    }
    setLoggingOut(true);
    try {
      await syncLocalDataToCloudIfOnline();
      try {
        await supabase.auth.signOut();
      } catch {}
      await clearAllLocalAccountData();
      setLogoutModalVisible(false);
      router.replace('/(auth)/login');
    } catch {
      await clearAllLocalAccountData();
      setLogoutModalVisible(false);
      router.replace('/(auth)/login');
    } finally {
      setLoggingOut(false);
    }
  };

  const getPlanDetails = (planType: 'PRO30' | 'PRO180' | 'PRO365' | 'PASS1' | 'PASS3') => {
    const prices = adminConfig?.prices || { pro30: 49, pro180: 199, pro365: 349, pass1: 19, pass3: 49 };
    switch (planType) {
      case 'PRO30':
        return { title: '১ মাস Toki Pro (৩০ দিন)', price: prices.pro30, bonusPass: 0, badge: 'Monthly' };
      case 'PRO180':
        return { title: '৬ মাস Semester Pro (১৮০ দিন)', price: prices.pro180, bonusPass: 1, badge: '🔥 Most Popular (+1 Free Pass)' };
      case 'PRO365':
        return { title: '১ বছর VIP Pro (৩৬৫ দিন)', price: prices.pro365, bonusPass: 1, badge: '👑 Best Value (+1 Free Pass)' };
      case 'PASS1':
        return { title: '১টি ইনস্ট্যান্ট এমারজেন্সি পাস', price: prices.pass1, bonusPass: 1, badge: 'Instant Pass' };
      case 'PASS3':
        return { title: '৩টি এমারজেন্সি পাস প্যাক', price: prices.pass3, bonusPass: 3, badge: 'Pass Bundle' };
    }
  };

  const handleRedeemActivationKey = async () => {
    if (!activationKeyInput.trim()) {
      showFeedback('কোড দিন', 'অনুগ্রহ করে আপনার Activation Key লিখুন।', 'error');
      return;
    }
    setSubmittingAction(true);
    try {
      if (FocusLock?.verifyAndApplyActivationKey) {
        const res = await FocusLock.verifyAndApplyActivationKey(
          focusStats.accountCode,
          activationKeyInput.trim()
        );
        if (res?.success) {
          const planType = (res.planType || 'PRO180') as any;
          const details = getPlanDetails(planType);
          const newRecord: PurchaseRecord = {
            id: `pur-${Date.now()}`,
            userEmail: userProfile.email,
            accountCode: focusStats.accountCode,
            planType,
            planTitle: details.title,
            amountBdt: details.price,
            trxId: `KEY:${activationKeyInput.trim().toUpperCase()}`,
            senderPhone: 'Activation Key',
            status: 'approved',
            activationKey: activationKeyInput.trim().toUpperCase(),
            createdAt: Date.now(),
            expiresAt: Number(res.proExpiresAt || Date.now() + 30 * 86400000),
          };
          await recordUserPurchaseHistory(newRecord);
          await syncLocalDataToCloudIfOnline();
          await loadAllProfileData();
          setActivationKeyInput('');
          showFeedback(
            'অভিনন্দন! সফলভাবে চালু হয়েছে 🎉',
            res.message || `${details.title} সফলভাবে চালু হয়েছে!`,
            'success'
          );
        } else {
          showFeedback(
            'ভুল অ্যাক্টিভেশন কোড ❌',
            res?.message || 'এই কোডটি আপনার অ্যাকাউন্টের জন্য নয় অথবা ইতিমধ্যে ব্যবহৃত হয়েছে।',
            'error'
          );
        }
      }
    } catch {
      showFeedback('ত্রুটি', 'কোড যাচাই করা যায়নি। আবার চেষ্টা করুন।', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleSubmitPaymentRequest = async () => {
    if (!trxIdInput.trim() || !senderPhoneInput.trim()) {
      showFeedback(
        'তথ্য দিন',
        'অনুগ্রহ করে বিকাশ/নগদ TrxID এবং যে নাম্বার থেকে টাকা পাঠিয়েছেন তা লিখুন।',
        'error'
      );
      return;
    }
    setSubmittingAction(true);
    try {
      const details = getPlanDetails(selectedPlanType);
      const record: PurchaseRecord = {
        id: `req-${Date.now()}`,
        userEmail: userProfile.email,
        accountCode: focusStats.accountCode,
        planType: selectedPlanType,
        planTitle: details.title,
        amountBdt: details.price,
        trxId: trxIdInput.trim().toUpperCase(),
        senderPhone: senderPhoneInput.trim(),
        status: 'pending',
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * 86400000,
      };
      await recordUserPurchaseHistory(record);
      if (adminConfig) {
        const updatedSales = [
          record,
          ...(adminConfig.salesHistory || []).filter((r) => r.id !== record.id),
        ];
        const nextCfg = { ...adminConfig, salesHistory: updatedSales };
        await saveAdminAppConfig(nextCfg);
        setAdminConfig(nextCfg);
      }
      await loadAllProfileData();
      const waNum = (adminConfig?.whatsappNumber || '01761632836').replace(/[^0-9]/g, '');
      const waPhone = waNum.startsWith('88') ? waNum : `88${waNum}`;
      const msg = encodeURIComponent(
        `Assalamu Alaikum Admin! 👑\nআমি *${details.title}* (৳${details.price}) এর জন্য পেমেন্ট করেছি।\n\n• Account Code: *${focusStats.accountCode}*\n• Email: ${userProfile.email}\n• Plan Code: *${selectedPlanType}*\n• TrxID: *${trxIdInput.trim().toUpperCase()}*\n• Sender Number: ${senderPhoneInput.trim()}\n\nআমাকে Activation Key দিন অথবা অ্যাপ্রুভ করে দিন।`
      );
      setTrxIdInput('');
      setSenderPhoneInput('');
      Linking.openURL(`https://wa.me/${waPhone}?text=${msg}`).catch(() => {});
      showFeedback(
        'পেমেন্ট রিকোয়েস্ট জমা হয়েছে ✅',
        'আপনার রিকোয়েস্ট হিস্ট্রিতে সেভ হয়েছে এবং অ্যাডমিনের WhatsApp-এ মেসেজ প্রস্তুত করা হয়েছে।',
        'success'
      );
    } catch {
      showFeedback('ত্রুটি', 'রিকোয়েস্ট জমা দেওয়া যায়নি।', 'error');
    } finally {
      setSubmittingAction(false);
    }
  };

  // Admin Panel Security Gate (Hardware Fingerprint / Screen Lock)
  const handleOpenAdminPanel = async () => {
    if (!isUserAdmin(userProfile.email, adminConfig)) {
      showFeedback(
        'প্রবেশাধিকার সংরক্ষিত 🔒',
        'শুধুমাত্র অনুমোদিত অ্যাডমিন এই প্যানেলে প্রবেশ করতে পারবেন।',
        'error'
      );
      return;
    }
    try {
      if (FocusLock?.authenticateAdminBiometric) {
        const verified = await FocusLock.authenticateAdminBiometric();
        if (!verified) {
          showFeedback(
            'ফিঙ্গারপ্রিন্ট যাচাই ব্যর্থ ❌',
            'অ্যাডমিন প্যানেলে ঢুকতে ফোনের ফিঙ্গারপ্রিন্ট বা স্ক্রিন লক ভেরিফিকেশন আবশ্যক।',
            'error'
          );
          return;
        }
      }
      setTargetUserAccountCode(focusStats.accountCode);
      setAdminModalVisible(true);
    } catch {
      showFeedback('নিরাপত্তা যাচাই ব্যর্থ', 'ফিঙ্গারপ্রিন্ট যাচাই সম্পন্ন হয়নি।', 'error');
    }
  };

  const handleAdminGenerateKey = async () => {
    const cleanCode = targetUserAccountCode.trim().toUpperCase();
    if (!cleanCode) {
      showFeedback('Account Code দিন', 'ইউজারের Account Code (যেমন TK-XXXXXXXX) লিখুন।', 'error');
      return;
    }
    try {
      if (FocusLock?.generateActivationKeyNative) {
        const key = await FocusLock.generateActivationKeyNative(cleanCode, targetPlanType);
        setGeneratedAdminKey(key);
      }
    } catch {
      showFeedback('ত্রুটি', 'অ্যাক্টিভেশন কোড তৈরি করা যায়নি।', 'error');
    }
  };

  const handleApproveRequestAndSendKey = async (req: PurchaseRecord) => {
    try {
      if (FocusLock?.authenticateAdminBiometric) {
        const ok = await FocusLock.authenticateAdminBiometric();
        if (!ok) return;
      }
      let key = req.activationKey || '';
      if (!key && FocusLock?.generateActivationKeyNative) {
        key = await FocusLock.generateActivationKeyNative(req.accountCode, req.planType);
      }
      if (adminConfig) {
        const updatedSales = (adminConfig.salesHistory || []).map((item) =>
          item.id === req.id ? { ...item, status: 'approved' as const, activationKey: key } : item
        );
        const nextCfg = { ...adminConfig, salesHistory: updatedSales };
        await saveAdminAppConfig(nextCfg);
        setAdminConfig(nextCfg);
      }
      if (
        req.accountCode === focusStats.accountCode &&
        key &&
        FocusLock?.verifyAndApplyActivationKey
      ) {
        await FocusLock.verifyAndApplyActivationKey(focusStats.accountCode, key);
        await loadAllProfileData();
      }
      const waPhone = req.senderPhone.replace(/[^0-9]/g, '');
      const formattedWa = waPhone.startsWith('88') ? waPhone : `88${waPhone}`;
      const msg = encodeURIComponent(
        `🎉 অভিনন্দন! আপনার *${req.planTitle}* পেমেন্ট ভেরিফাই হয়েছে।\n\n🔑 আপনার Activation Key:\n*${key}*\n\nToki অ্যাপের Profile -> Toki Pro -> Redeem Code এ গিয়ে এই কোডটি বসালেই আপনার প্রো/পাস চালু হয়ে যাবে!`
      );
      if (waPhone.length >= 11) {
        Linking.openURL(`https://wa.me/${formattedWa}?text=${msg}`).catch(() => {});
      } else {
        Share.share({ message: `Toki Activation Key (${req.accountCode}): ${key}` }).catch(() => {});
      }
    } catch {}
  };

  const handleSaveAdminSettings = async () => {
    try {
      if (FocusLock?.authenticateAdminBiometric) {
        const verified = await FocusLock.authenticateAdminBiometric();
        if (!verified) {
          showFeedback(
            'যাচাই ব্যর্থ',
            'অ্যাডমিন সেটিংস সেভ করতে ফিঙ্গারপ্রিন্ট যাচাই প্রয়োজন।',
            'error'
          );
          return;
        }
      }
      if (!adminConfig) return;
      const nextCfg: AdminAppConfig = {
        ...adminConfig,
        whatsappNumber: editWhatsapp.trim() || '01761632836',
        bkashNagadNumber: editBkash.trim() || '01761632836',
        prices: {
          pro30: Math.max(1, parseInt(editPricePro30, 10) || 49),
          pro180: Math.max(1, parseInt(editPricePro180, 10) || 199),
          pro365: Math.max(1, parseInt(editPricePro365, 10) || 349),
          pass1: Math.max(1, parseInt(editPricePass1, 10) || 19),
          pass3: Math.max(1, parseInt(editPricePass3, 10) || 49),
        },
        appUpdate: {
          latestVersion: editOtaVersion.trim() || CURRENT_APP_VERSION,
          downloadUrl: editOtaUrl.trim(),
          releaseNotes: editOtaNotes.trim(),
          forceUpdate: editOtaForce,
        },
      };
      await saveAdminAppConfig(nextCfg);
      setAdminConfig(nextCfg);
      showFeedback(
        'অ্যাডমিন কনফিগ সেভ হয়েছে ✅',
        'পেমেন্ট নাম্বার, প্যাকেজ রেট এবং আপডেট অ্যালার্ট সফলভাবে আপডেট হয়েছে।',
        'success'
      );
    } catch {
      showFeedback('ত্রুটি', 'সেটিংস সেভ করা যায়নি।', 'error');
    }
  };

  const handleAddAdminEmail = async () => {
    const clean = newAdminEmailInput.trim().toLowerCase();
    if (!clean || !clean.includes('@') || !adminConfig) return;
    if (adminConfig.adminEmails.includes(clean)) {
      setNewAdminEmailInput('');
      return;
    }
    const nextCfg: AdminAppConfig = {
      ...adminConfig,
      adminEmails: [...adminConfig.adminEmails, clean],
    };
    await saveAdminAppConfig(nextCfg);
    setAdminConfig(nextCfg);
    setNewAdminEmailInput('');
    showFeedback('নতুন অ্যাডমিন যুক্ত হয়েছে 👑', `${clean} এখন অ্যাডমিন হিসেবে যুক্ত হয়েছেন।`, 'success');
  };

  const handleRemoveAdminEmail = async (emailToRemove: string) => {
    if (emailToRemove.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
      showFeedback('সুপার অ্যাডমিন সুরক্ষিত 🛡️', 'মূল সুপার অ্যাডমিন ইমেইল রিমুভ করা যাবে না।', 'info');
      return;
    }
    if (!adminConfig) return;
    const nextCfg: AdminAppConfig = {
      ...adminConfig,
      adminEmails: adminConfig.adminEmails.filter(
        (e) => e.toLowerCase() !== emailToRemove.toLowerCase()
      ),
    };
    await saveAdminAppConfig(nextCfg);
    setAdminConfig(nextCfg);
  };

  const getHeatmapColor = (minutes: number) => {
    if (minutes <= 0) return '#1E293B';
    if (minutes < 45) return '#064E3B';
    if (minutes < 120) return '#047857';
    if (minutes < 240) return '#10B981';
    return '#34D399';
  };

  const totalHours = (focusStats.totalFocusMinutes / 60).toFixed(1);
  const userIsAdmin = isUserAdmin(userProfile.email, adminConfig);
  const streakProgress99 = Math.min(
    99,
    focusStats.streakDays % 99 || (focusStats.streakDays > 0 ? 99 : 0)
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#38BDF8" />
        }
      >
        {/* Top Profile Identity Card */}
        <View style={[styles.profileHeaderCard, focusStats.isPro && styles.profileHeaderCardPro]}>
          <View style={styles.avatarContainer}>
            {userProfile.avatarUrl ? (
              <Image source={{ uri: userProfile.avatarUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarFallbackText}>
                  {(userProfile.name || 'T').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={[styles.onlineBadge, focusStats.isPro && { backgroundColor: '#F59E0B' }]}>
              {focusStats.isPro ? (
                <MaterialCommunityIcons name="crown" size={13} color="#0F172A" />
              ) : (
                <Ionicons name="sparkles" size={11} color="#0F172A" />
              )}
            </View>
          </View>

          <Text style={styles.userName}>{userProfile.name}</Text>
          <Text style={styles.userEmail}>{userProfile.email}</Text>

          {/* Unique Account Code Pill */}
          <TouchableOpacity
            style={styles.accountCodePill}
            onPress={() =>
              Share.share({
                message: `My Toki Account Code: ${focusStats.accountCode} (${userProfile.email})`,
              }).catch(() => {})
            }
          >
            <Ionicons name="key-outline" size={13} color="#38BDF8" />
            <Text style={styles.accountCodeText}>Account Code: {focusStats.accountCode}</Text>
            <Feather name="copy" size={12} color="#94A3B8" />
          </TouchableOpacity>

          <View style={styles.headerActionRow}>
            <TouchableOpacity
              style={[styles.proStatusPill, focusStats.isPro && styles.proStatusPillActive]}
              onPress={() => {
                setStoreTab('PRO');
                setStoreModalVisible(true);
              }}
            >
              <MaterialCommunityIcons
                name="crown"
                size={15}
                color={focusStats.isPro ? '#0F172A' : '#FBBF24'}
              />
              <Text style={[styles.proStatusPillText, focusStats.isPro && { color: '#0F172A' }]}>
                {focusStats.isPro
                  ? `Toki Pro 👑 (${focusStats.proDaysRemaining} দিন বাকি)`
                  : 'Upgrade to Toki Pro 👑'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.syncButtonPill}
              onPress={handleManualCloudSync}
              disabled={syncingCloud}
            >
              {syncingCloud ? (
                <ActivityIndicator size="small" color="#38BDF8" />
              ) : (
                <>
                  <Feather name="refresh-cw" size={12} color="#38BDF8" />
                  <Text style={styles.syncButtonText}>Cloud Sync</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Super Admin Fingerprint Button (ONLY visible to Admin emails) */}
          {userIsAdmin && (
            <TouchableOpacity style={styles.adminAccessBtn} onPress={handleOpenAdminPanel}>
              <Ionicons name="finger-print" size={18} color="#FDE68A" />
              <Text style={styles.adminAccessBtnText}>
                👑 Admin Control Panel (Fingerprint Verified)
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {/* 99-Day Streak Challenge Banner */}
        <View style={styles.streakRewardCard}>
          <View style={styles.streakRewardTop}>
            <View style={styles.streakRewardBadge}>
              <Ionicons name="flame" size={20} color="#F97316" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.streakRewardTitle}>
                ৯৯ দিনের ফোকাস চ্যালেঞ্জ ({streakProgress99}/99 দিন)
              </Text>
              <Text style={styles.streakRewardSub}>
                প্রতিদিন অন্তত ৪৫ মিনিট লক পূর্ণ করে টানা ৯৯ দিন স্ট্রিক করলে ৭ দিনের Toki Pro সম্পূর্ণ ফ্রি! 🎁
              </Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.min(100, Math.round((streakProgress99 / 99) * 100))}%` },
              ]}
            />
          </View>
        </View>

        {/* Buy Emergency Pass & Redeem Code Quick Banner */}
        <View style={styles.quickStoreRow}>
          <TouchableOpacity
            style={styles.quickPassBtn}
            onPress={() => {
              setStoreTab('PASS');
              setSelectedPlanType('PASS1');
              setStoreModalVisible(true);
            }}
          >
            <Ionicons name="shield-checkmark" size={18} color="#10B981" />
            <View style={{ flex: 1 }}>
              <Text style={styles.quickPassTitle}>এমারজেন্সি পাস কিনুন</Text>
              <Text style={styles.quickPassSub}>
                বর্তমানে জমা আছে: {focusStats.emergencyPasses}টি পাস
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickRedeemBtn}
            onPress={() => {
              setStoreTab('REDEEM');
              setStoreModalVisible(true);
            }}
          >
            <Ionicons name="key" size={18} color="#38BDF8" />
            <Text style={styles.quickRedeemText}>Redeem Key</Text>
          </TouchableOpacity>
        </View>

        {/* Focus & Productivity Dashboard Grid */}
        <Text style={styles.sectionTitle}>আপনার প্রোডাক্টিভিটি ড্যাশবোর্ড</Text>
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <View style={[styles.statIconWrap, { backgroundColor: 'rgba(249, 115, 22, 0.15)' }]}>
              <Ionicons name="flame" size={22} color="#F97316" />
            </View>
            <Text style={styles.statValue}>{focusStats.streakDays} দিন</Text>
            <Text style={styles.statLabel}>টানা স্ট্রিক (≥45m)</Text>
          </View>

          <View style={styles.statBox}>
            <View style={[styles.statIconWrap, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
              <Ionicons name="time" size={22} color="#38BDF8" />
            </View>
            <Text style={styles.statValue}>{totalHours} ঘণ্টা</Text>
            <Text style={styles.statLabel}>মোট ডিপ ফোকাস</Text>
          </View>

          <View style={styles.statBox}>
            <View style={[styles.statIconWrap, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="shield-checkmark" size={22} color="#10B981" />
            </View>
            <Text style={styles.statValue}>{focusStats.emergencyPasses} টি</Text>
            <Text style={styles.statLabel}>এমারজেন্সি পাস</Text>
          </View>

          <View style={styles.statBox}>
            <View style={[styles.statIconWrap, { backgroundColor: 'rgba(168, 85, 247, 0.15)' }]}>
              <Ionicons name="ribbon" size={22} color="#A855F7" />
            </View>
            <Text style={styles.statValue}>{focusStats.completedSessions} বার</Text>
            <Text style={styles.statLabel}>সফল লক সেশন</Text>
          </View>
        </View>

        {/* 60-Day GitHub Style Focus Heatmap (Full for Pro, Preview for Free) */}
        <View style={styles.heatmapCard}>
          <View style={styles.heatmapHeaderRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heatmapTitle}>৬০ দিনের ফোকাস গ্রাফ</Text>
              <Text style={styles.heatmapSub}>
                {focusStats.isPro
                  ? 'Toki Pro গ্রিন স্ট্রিক অ্যাক্টিভিটি চার্ট'
                  : 'ফ্রি ভার্সনে ১৪ দিন দৃশ্যমান (৬০ দিনের পূর্ণ গ্রাফ দেখতে Toki Pro নিন)'}
              </Text>
            </View>
            <Ionicons name="flash" size={20} color="#10B981" />
          </View>

          <View style={styles.heatmapGrid}>
            {(focusStats.heatmap.length > 0
              ? focusStats.isPro
                ? focusStats.heatmap
                : focusStats.heatmap.slice(-14)
              : Array.from({ length: focusStats.isPro ? 60 : 14 }).map((_, i) => ({
                  date: `${i}`,
                  minutes: 0,
                }))
            ).map((item, idx) => (
              <View
                key={`${item.date}-${idx}`}
                style={[styles.heatmapCell, { backgroundColor: getHeatmapColor(item.minutes) }]}
              />
            ))}
          </View>
        </View>

        {/* Purchase & Pass History (60-Day Auto Clean) */}
        <View style={styles.summaryListCard}>
          <View style={styles.historyHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <MaterialCommunityIcons name="history" size={18} color="#38BDF8" />
              <Text style={styles.historyHeaderTitle}>প্রো ও পাস হিস্ট্রি (৬০ দিন অটো-ক্লিন)</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setStoreTab('HISTORY');
                setStoreModalVisible(true);
              }}
            >
              <Text style={styles.viewAllText}>সব দেখুন</Text>
            </TouchableOpacity>
          </View>

          {purchaseHistory.length === 0 ? (
            <Text style={styles.emptyHistoryText}>
              এখনো কোনো প্রো সাবস্ক্রিপশন বা পাস কেনার রেকর্ড নেই।
            </Text>
          ) : (
            purchaseHistory.slice(0, 3).map((rec) => (
              <View key={rec.id} style={styles.historyItemRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyItemTitle}>{rec.planTitle}</Text>
                  <Text style={styles.historyItemMeta}>
                    ৳{rec.amountBdt} • {rec.trxId} •{' '}
                    {new Date(rec.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusTag,
                    rec.status === 'approved' ? styles.statusApproved : styles.statusPending,
                  ]}
                >
                  <Text style={styles.statusTagText}>
                    {rec.status === 'approved' ? 'Active ✅' : 'Pending ⏳'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Quick App Summary */}
        <Text style={styles.sectionTitle}>অ্যাকাউন্ট ও মডিউল স্ট্যাটাস</Text>
        <View style={styles.summaryListCard}>
          <TouchableOpacity
            style={styles.summaryRow}
            onPress={() => router.push('/features/StrictFocusScreen')}
          >
            <View style={[styles.summaryIcon, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
              <Ionicons name="calendar" size={18} color="#38BDF8" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryRowTitle}>সক্রিয় ডেইলি শিডিউল লক</Text>
              <Text style={styles.summaryRowSub}>
                {focusStats.isPro
                  ? 'সর্বোচ্চ ৪টি শিডিউল (১৫ ঘণ্টা পর্যন্ত)'
                  : 'ফ্রি টিয়ারে সর্বোচ্চ ১টি শিডিউল'}
              </Text>
            </View>
            <Text style={styles.summaryBadge}>{schedulesCount} টি</Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.summaryRow}
            onPress={() => router.push('/features/SmartNetworking')}
          >
            <View style={[styles.summaryIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="people" size={18} color="#10B981" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryRowTitle}>নেটওয়ার্কিং কন্টাক্টস</Text>
              <Text style={styles.summaryRowSub}>
                {focusStats.isPro
                  ? 'আনলিমিটেড প্রো কন্টাক্ট সিঙ্ক'
                  : `${contactsCount}/5 টি ফ্রি কন্টাক্ট ব্যবহৃত`}
              </Text>
            </View>
            <Text style={styles.summaryBadge}>{contactsCount} জন</Text>
          </TouchableOpacity>
        </View>

        {/* Logout Action */}
        <TouchableOpacity style={styles.logoutBtn} onPress={() => setLogoutModalVisible(true)}>
          <Ionicons name="log-out-outline" size={19} color="#F87171" />
          <Text style={styles.logoutBtnText}>অ্যাকাউন্ট লগআউট করুন</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ===================================================================== */}
      {/* TOKI PRO & EMERGENCY PASS STORE MODAL                                 */}
      {/* ===================================================================== */}
      <Modal
        visible={storeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setStoreModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '92%', width: '100%' }]}>
            <View style={styles.storeHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <MaterialCommunityIcons name="crown" size={22} color="#FBBF24" />
                <Text style={styles.storeHeaderTitle}>Toki Pro 👑 & Pass Store</Text>
              </View>
              <TouchableOpacity onPress={() => setStoreModalVisible(false)}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={styles.storeTabsBar}>
              {(['PRO', 'PASS', 'REDEEM', 'HISTORY'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.storeTabItem, storeTab === t && styles.storeTabItemActive]}
                  onPress={() => {
                    setStoreTab(t);
                    if (t === 'PRO') setSelectedPlanType('PRO180');
                    if (t === 'PASS') setSelectedPlanType('PASS1');
                  }}
                >
                  <Text style={[styles.storeTabText, storeTab === t && styles.storeTabTextActive]}>
                    {t === 'PRO'
                      ? '👑 Pro Plans'
                      : t === 'PASS'
                      ? '🛡️ Buy Pass'
                      : t === 'REDEEM'
                      ? '🔑 কোড দিন'
                      : '📜 হিস্ট্রি'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {(storeTab === 'PRO' || storeTab === 'PASS') && (
                <View>
                  {storeTab === 'PRO' ? (
                    <>
                      <View style={styles.proComparisonBox}>
                        <Text style={styles.proComparisonTitle}>
                          ✨ Toki Pro মেম্বারশিপে যা যা থাকছে:
                        </Text>
                        <Text style={styles.proComparisonItem}>
                          • একটানা ৬ ঘণ্টা সেশন লক এবং ১৫ ঘণ্টা পর্যন্ত ৪টি ডেইলি শিডিউল
                        </Text>
                        <Text style={styles.proComparisonItem}>
                          • ৩.৫ ঘণ্টা YouTube Study Mode (অনুমোদিত চ্যানেল + ক্লাস ভিডিও)
                        </Text>
                        <Text style={styles.proComparisonItem}>
                          • লক চলাকালীন Study PDF Reader + ৬টি অ্যাপ ও ৫টি ওয়েবসাইট
                        </Text>
                        <Text style={styles.proComparisonItem}>
                          • আনলিমিটেড নেটওয়ার্কিং কন্টাক্ট + ৬০ দিনের গ্রিন ফোকাস চার্ট
                        </Text>
                        <Text style={styles.proComparisonItem}>
                          • ৬ মাস বা ১ বছরের প্যাকেজে সাথে ১টি ফ্রি এমারজেন্সি পাস বোনাস!
                        </Text>
                      </View>

                      {(['PRO30', 'PRO180', 'PRO365'] as const).map((plan) => {
                        const info = getPlanDetails(plan);
                        const selected = selectedPlanType === plan;
                        return (
                          <TouchableOpacity
                            key={plan}
                            style={[
                              styles.planOptionCard,
                              selected && styles.planOptionCardSelected,
                            ]}
                            onPress={() => setSelectedPlanType(plan)}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.planBadgeText}>{info.badge}</Text>
                              <Text style={styles.planTitleText}>{info.title}</Text>
                              <Text style={styles.planSubText}>
                                {info.bonusPass > 0
                                  ? `🎁 সাথে পাচ্ছেন +${info.bonusPass}টি ফ্রি এমারজেন্সি পাস`
                                  : 'সব প্রো ফিচার আনলক'}
                              </Text>
                            </View>
                            <Text style={styles.planPriceText}>৳{info.price}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      <View style={styles.proComparisonBox}>
                        <Text style={styles.proComparisonTitle}>
                          🛡️ ইনস্ট্যান্ট এমারজেন্সি পাস কেন প্রয়োজন?
                        </Text>
                        <Text style={styles.proComparisonItem}>
                          • জরুরি মুহূর্তে সক্রিয় ফোকাস বা শিডিউল লক তাৎক্ষণিক আনলক করতে
                        </Text>
                        <Text style={styles.proComparisonItem}>
                          • ফ্রি বা প্রো—যেকোনো ইউজার আলাদাভাবে শুধু পাস কিনতে পারবেন
                        </Text>
                      </View>

                      {(['PASS1', 'PASS3'] as const).map((plan) => {
                        const info = getPlanDetails(plan);
                        const selected = selectedPlanType === plan;
                        return (
                          <TouchableOpacity
                            key={plan}
                            style={[
                              styles.planOptionCard,
                              selected && styles.planOptionCardSelected,
                            ]}
                            onPress={() => setSelectedPlanType(plan)}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.planBadgeText}>{info.badge}</Text>
                              <Text style={styles.planTitleText}>{info.title}</Text>
                              <Text style={styles.planSubText}>তাৎক্ষণিক অ্যাকাউন্টে যুক্ত হবে</Text>
                            </View>
                            <Text style={styles.planPriceText}>৳{info.price}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}

                  {/* Payment Step Box */}
                  <View style={styles.paymentInstructionBox}>
                    <Text style={styles.paymentStepHeader}>💳 পেমেন্ট ও অ্যাক্টিভেশন পদ্ধতি:</Text>
                    <Text style={styles.paymentStepText}>
                      ১. নিচের বিকাশ/নগদ (Send Money) নাম্বারে নির্ধারিত টাকা পাঠান:{'\n'}
                      <Text style={{ color: '#FBBF24', fontWeight: '800', fontSize: 15 }}>
                        📱 bKash / Nagad: {adminConfig?.bkashNagadNumber || '01761632836'}
                      </Text>
                    </Text>
                    <Text style={styles.paymentStepText}>
                      ২. আপনার Account Code:{' '}
                      <Text style={{ color: '#38BDF8', fontWeight: '800' }}>
                        {focusStats.accountCode}
                      </Text>
                    </Text>

                    <TextInput
                      style={styles.storeInput}
                      placeholder="বিকাশ/নগদ TrxID লিখুন (যেমন: BKA8291XYZ)"
                      placeholderTextColor="#64748B"
                      value={trxIdInput}
                      onChangeText={setTrxIdInput}
                    />
                    <TextInput
                      style={styles.storeInput}
                      placeholder="যে নাম্বার থেকে টাকা পাঠিয়েছেন (017XXXXXXXX)"
                      placeholderTextColor="#64748B"
                      keyboardType="phone-pad"
                      value={senderPhoneInput}
                      onChangeText={setSenderPhoneInput}
                    />

                    <TouchableOpacity
                      style={styles.submitPaymentBtn}
                      onPress={handleSubmitPaymentRequest}
                      disabled={submittingAction}
                    >
                      <Ionicons name="logo-whatsapp" size={18} color="#0F172A" />
                      <Text style={styles.submitPaymentBtnText}>
                        পেমেন্ট সাবমিট করুন ও WhatsApp-এ কোড নিন
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {storeTab === 'REDEEM' && (
                <View style={styles.redeemBox}>
                  <Text style={styles.redeemTitle}>🔑 অ্যাক্টিভেশন কোড দিয়ে চালু করুন</Text>
                  <Text style={styles.redeemSub}>
                    অ্যাডমিনের কাছ থেকে পাওয়া আপনার অ্যাকাউন্টের বিশেষ Activation Key নিচে পেস্ট করুন:
                  </Text>
                  <View style={styles.accountCodeBanner}>
                    <Text style={styles.accountCodeBannerText}>
                      আপনার Account Code: {focusStats.accountCode}
                    </Text>
                  </View>
                  <TextInput
                    style={[
                      styles.storeInput,
                      { textAlign: 'center', fontWeight: '800', letterSpacing: 1 },
                    ]}
                    placeholder="TK-PRO180-XXXXX-XXXXXXXX"
                    placeholderTextColor="#64748B"
                    autoCapitalize="characters"
                    value={activationKeyInput}
                    onChangeText={setActivationKeyInput}
                  />
                  <TouchableOpacity
                    style={styles.submitPaymentBtn}
                    onPress={handleRedeemActivationKey}
                    disabled={submittingAction}
                  >
                    <Ionicons name="checkmark-circle" size={18} color="#0F172A" />
                    <Text style={styles.submitPaymentBtnText}>অ্যাক্টিভেট করুন</Text>
                  </TouchableOpacity>
                </View>
              )}

              {storeTab === 'HISTORY' && (
                <View style={{ paddingVertical: 8 }}>
                  <Text style={styles.redeemSub}>
                    নিরাপত্তা ও হালকা স্টোরেজের জন্য ৬০ দিনের পুরনো হিস্ট্রি স্বয়ংক্রিয়ভাবে ডিলিট হয়ে যায়।
                  </Text>
                  {purchaseHistory.length === 0 ? (
                    <Text style={styles.emptyHistoryText}>
                      কোনো পেমেন্ট বা অ্যাক্টিভেশন হিস্ট্রি নেই।
                    </Text>
                  ) : (
                    purchaseHistory.map((item) => (
                      <View key={item.id} style={styles.historyItemRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.historyItemTitle}>{item.planTitle}</Text>
                          <Text style={styles.historyItemMeta}>
                            ৳{item.amountBdt} • TrxID: {item.trxId}
                          </Text>
                          <Text style={styles.historyItemMeta}>
                            তারিখ: {new Date(item.createdAt).toLocaleString()}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.statusTag,
                            item.status === 'approved'
                              ? styles.statusApproved
                              : styles.statusPending,
                          ]}
                        >
                          <Text style={styles.statusTagText}>
                            {item.status === 'approved' ? 'Active ✅' : 'Pending ⏳'}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ===================================================================== */}
      {/* FINGERPRINT-PROTECTED SUPER ADMIN CONTROL PANEL                       */}
      {/* ===================================================================== */}
      <Modal
        visible={adminModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAdminModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxHeight: '94%', width: '100%' }]}>
            <View style={styles.storeHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="finger-print" size={22} color="#38BDF8" />
                <Text style={styles.storeHeaderTitle}>👑 Toki Admin Control Panel</Text>
              </View>
              <TouchableOpacity onPress={() => setAdminModalVisible(false)}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.storeTabsBar}>
              {(['KEYS', 'REQUESTS', 'SETTINGS', 'OTA'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.storeTabItem, adminTab === t && styles.storeTabItemActive]}
                  onPress={() => setAdminTab(t)}
                >
                  <Text style={[styles.storeTabText, adminTab === t && styles.storeTabTextActive]}>
                    {t === 'KEYS'
                      ? '🔑 Key Gen'
                      : t === 'REQUESTS'
                      ? `📩 Requests (${(adminConfig?.salesHistory || []).length})`
                      : t === 'SETTINGS'
                      ? '⚙️ পেমেন্ট/অ্যাডমিন'
                      : '🚀 OTA Update'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {adminTab === 'KEYS' && (
                <View>
                  <Text style={styles.redeemTitle}>ইউজারের জন্য Activation Key তৈরি করুন</Text>
                  <Text style={styles.redeemSub}>
                    ইউজারের Account Code (যেমন TK-XXXXXXXX) দিয়ে যেকোনো প্রো প্যাকেজ বা পাসের কোড জেনারেট করুন। এই কোড শুধু ওই ইউজারের ফোনেই কাজ করবে।
                  </Text>

                  <TextInput
                    style={styles.storeInput}
                    placeholder="User Account Code (যেমন: TK-8F92A1C0)"
                    placeholderTextColor="#64748B"
                    autoCapitalize="characters"
                    value={targetUserAccountCode}
                    onChangeText={setTargetUserAccountCode}
                  />

                  <View style={styles.adminPlanPickerGrid}>
                    {(['PRO30', 'PRO180', 'PRO365', 'PASS1', 'PASS3'] as const).map((p) => (
                      <TouchableOpacity
                        key={p}
                        style={[
                          styles.adminPlanChip,
                          targetPlanType === p && styles.adminPlanChipActive,
                        ]}
                        onPress={() => setTargetPlanType(p)}
                      >
                        <Text
                          style={[
                            styles.adminPlanChipText,
                            targetPlanType === p && { color: '#0F172A' },
                          ]}
                        >
                          {p}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <TouchableOpacity style={styles.submitPaymentBtn} onPress={handleAdminGenerateKey}>
                    <Ionicons name="key" size={18} color="#0F172A" />
                    <Text style={styles.submitPaymentBtnText}>Generate Cryptographic Key</Text>
                  </TouchableOpacity>

                  {generatedAdminKey ? (
                    <View style={styles.generatedKeyCard}>
                      <Text style={styles.generatedKeyLabel}>
                        Generated Key ({targetPlanType}):
                      </Text>
                      <Text selectable style={styles.generatedKeyValue}>
                        {generatedAdminKey}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                        <TouchableOpacity
                          style={[styles.smallAdminBtn, { backgroundColor: '#38BDF8', flex: 1 }]}
                          onPress={() =>
                            Share.share({
                              message: `🎉 আপনার Toki ${targetPlanType} Activation Key:\n${generatedAdminKey}\n\nToki অ্যাপের Profile -> Redeem Key অপশনে বসিয়ে অ্যাক্টিভ করুন!`,
                            }).catch(() => {})
                          }
                        >
                          <Ionicons name="send" size={14} color="#0F172A" />
                          <Text style={styles.smallAdminBtnText}>Share / Send Key</Text>
                        </TouchableOpacity>

                        {targetUserAccountCode.trim().toUpperCase() === focusStats.accountCode && (
                          <TouchableOpacity
                            style={[styles.smallAdminBtn, { backgroundColor: '#10B981', flex: 1 }]}
                            onPress={async () => {
                              if (FocusLock?.verifyAndApplyActivationKey) {
                                await FocusLock.verifyAndApplyActivationKey(
                                  focusStats.accountCode,
                                  generatedAdminKey
                                );
                                await loadAllProfileData();
                                showFeedback(
                                  'অ্যাক্টিভেটেড!',
                                  'আপনার নিজের অ্যাকাউন্টে কী-টি চালু হয়েছে।',
                                  'success'
                                );
                              }
                            }}
                          >
                            <Ionicons name="checkmark-circle" size={14} color="#0F172A" />
                            <Text style={styles.smallAdminBtnText}>Apply to My Phone</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  ) : null}
                </View>
              )}

              {adminTab === 'REQUESTS' && (
                <View>
                  <Text style={styles.redeemTitle}>
                    সকল প্রো ও পাস রিকোয়েস্ট (৬০ দিন অটো-ক্লিন)
                  </Text>
                  {(adminConfig?.salesHistory || []).length === 0 ? (
                    <Text style={styles.emptyHistoryText}>এখনো কোনো রিকোয়েস্ট আসেনি।</Text>
                  ) : (
                    (adminConfig?.salesHistory || []).map((req) => (
                      <View key={req.id} style={styles.adminReqCard}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={styles.historyItemTitle}>
                            {req.planTitle} (৳{req.amountBdt})
                          </Text>
                          <Text
                            style={{
                              color: req.status === 'approved' ? '#34D399' : '#FBBF24',
                              fontWeight: '800',
                              fontSize: 12,
                            }}
                          >
                            {req.status.toUpperCase()}
                          </Text>
                        </View>
                        <Text style={styles.historyItemMeta}>
                          User: {req.userEmail} • Code: {req.accountCode}
                        </Text>
                        <Text style={styles.historyItemMeta}>
                          TrxID: {req.trxId} • Phone: {req.senderPhone}
                        </Text>
                        {req.activationKey ? (
                          <Text selectable style={[styles.historyItemMeta, { color: '#38BDF8' }]}>
                            Key: {req.activationKey}
                          </Text>
                        ) : null}
                        <TouchableOpacity
                          style={[
                            styles.smallAdminBtn,
                            { backgroundColor: '#10B981', marginTop: 8, alignSelf: 'flex-start' },
                          ]}
                          onPress={() => handleApproveRequestAndSendKey(req)}
                        >
                          <Ionicons name="checkmark-circle" size={14} color="#0F172A" />
                          <Text style={styles.smallAdminBtnText}>
                            Approve & Send Key on WhatsApp
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}
                </View>
              )}

              {adminTab === 'SETTINGS' && (
                <View>
                  <Text style={styles.redeemTitle}>পেমেন্ট নাম্বার ও প্যাকেজ মূল্য পরিবর্তন</Text>
                  <Text style={styles.inputLabel}>
                    অ্যাডমিন WhatsApp নাম্বার (যেকোনো সময় পরিবর্তনযোগ্য):
                  </Text>
                  <TextInput
                    style={styles.storeInput}
                    value={editWhatsapp}
                    onChangeText={setEditWhatsapp}
                    keyboardType="phone-pad"
                  />

                  <Text style={styles.inputLabel}>বিকাশ / নগদ পেমেন্ট নাম্বার:</Text>
                  <TextInput
                    style={styles.storeInput}
                    value={editBkash}
                    onChangeText={setEditBkash}
                    keyboardType="phone-pad"
                  />

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLabel}>১ মাস প্রো (৳):</Text>
                      <TextInput
                        style={styles.storeInput}
                        value={editPricePro30}
                        onChangeText={setEditPricePro30}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLabel}>৬ মাস প্রো (৳):</Text>
                      <TextInput
                        style={styles.storeInput}
                        value={editPricePro180}
                        onChangeText={setEditPricePro180}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLabel}>১ বছর প্রো (৳):</Text>
                      <TextInput
                        style={styles.storeInput}
                        value={editPricePro365}
                        onChangeText={setEditPricePro365}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLabel}>১টি পাস (৳):</Text>
                      <TextInput
                        style={styles.storeInput}
                        value={editPricePass1}
                        onChangeText={setEditPricePass1}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.inputLabel}>৩টি পাস প্যাক (৳):</Text>
                      <TextInput
                        style={styles.storeInput}
                        value={editPricePass3}
                        onChangeText={setEditPricePass3}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>

                  <TouchableOpacity
                    style={styles.submitPaymentBtn}
                    onPress={handleSaveAdminSettings}
                  >
                    <Ionicons name="settings" size={18} color="#0F172A" />
                    <Text style={styles.submitPaymentBtnText}>সেটিংস সেভ করুন (Fingerprint)</Text>
                  </TouchableOpacity>

                  <View style={[styles.divider, { marginVertical: 16 }]} />

                  <Text style={styles.redeemTitle}>অ্যাডমিন ইমেইল তালিকা (Admin Access List)</Text>
                  {(adminConfig?.adminEmails || [SUPER_ADMIN_EMAIL]).map((email) => (
                    <View key={email} style={styles.adminEmailRow}>
                      <Text style={styles.adminEmailText}>{email}</Text>
                      {email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase() ? (
                        <Text style={styles.superAdminTag}>Super Admin</Text>
                      ) : (
                        <TouchableOpacity onPress={() => handleRemoveAdminEmail(email)}>
                          <Ionicons name="trash-outline" size={16} color="#F87171" />
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}

                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                    <TextInput
                      style={[styles.storeInput, { flex: 1, marginBottom: 0 }]}
                      placeholder="নতুন অ্যাডমিন Gmail যোগ করুন"
                      placeholderTextColor="#64748B"
                      value={newAdminEmailInput}
                      onChangeText={setNewAdminEmailInput}
                      autoCapitalize="none"
                    />
                    <TouchableOpacity style={styles.addAdminBtn} onPress={handleAddAdminEmail}>
                      <Ionicons name="add" size={20} color="#0F172A" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {adminTab === 'OTA' && (
                <View>
                  <Text style={styles.redeemTitle}>
                    🚀 ইন-অ্যাপ আপডেট নোটিফায়ার (Play Store ছাড়া আপডেট)
                  </Text>
                  <Text style={styles.redeemSub}>
                    আপনি নতুন APK বিল্ড করে Google Drive / GitHub / Telegram লিংক এখানে বসিয়ে ভার্সন বাড়িয়ে দিলেই সব ইউজারের ফোনে নতুন আপডেট পপ-আপ চলে যাবে!
                  </Text>

                  <Text style={styles.inputLabel}>
                    নতুন ভার্সন নাম্বার (বর্তমান: {CURRENT_APP_VERSION}):
                  </Text>
                  <TextInput
                    style={styles.storeInput}
                    placeholder="যেমন: 2.1.0"
                    placeholderTextColor="#64748B"
                    value={editOtaVersion}
                    onChangeText={setEditOtaVersion}
                  />

                  <Text style={styles.inputLabel}>নতুন APK ডাউনলোড লিংক (Drive/Website):</Text>
                  <TextInput
                    style={styles.storeInput}
                    placeholder="https://drive.google.com/..."
                    placeholderTextColor="#64748B"
                    value={editOtaUrl}
                    onChangeText={setEditOtaUrl}
                    autoCapitalize="none"
                  />

                  <Text style={styles.inputLabel}>নতুন আপডেটে কী কী থাকছে (Release Notes):</Text>
                  <TextInput
                    style={[styles.storeInput, { minHeight: 70 }]}
                    multiline
                    placeholder="নতুন ফিচার ও বাগ ফিক্স..."
                    placeholderTextColor="#64748B"
                    value={editOtaNotes}
                    onChangeText={setEditOtaNotes}
                  />

                  <TouchableOpacity
                    style={styles.forceUpdateToggle}
                    onPress={() => setEditOtaForce(!editOtaForce)}
                  >
                    <Ionicons
                      name="notifications"
                      size={18}
                      color={editOtaForce ? '#F59E0B' : '#94A3B8'}
                    />
                    <Text style={styles.forceUpdateText}>
                      Force Update (ইউজারকে অবশ্যই আপডেট করতে হবে):{' '}
                      {editOtaForce ? 'হ্যাঁ ✅' : 'না'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.submitPaymentBtn}
                    onPress={handleSaveAdminSettings}
                  >
                    <Ionicons name="send" size={18} color="#0F172A" />
                    <Text style={styles.submitPaymentBtnText}>আপডেট অ্যালার্ট পাবলিশ করুন</Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Feedback Modal */}
      <Modal
        visible={feedbackModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setFeedbackModal((p) => ({ ...p, visible: false }))}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{feedbackModal.title}</Text>
            <Text style={styles.modalSub}>{feedbackModal.message}</Text>
            <TouchableOpacity
              style={[
                styles.submitPaymentBtn,
                {
                  width: '100%',
                  backgroundColor:
                    feedbackModal.type === 'error'
                      ? '#EF4444'
                      : feedbackModal.type === 'success'
                      ? '#10B981'
                      : '#38BDF8',
                },
              ]}
              onPress={() => setFeedbackModal((p) => ({ ...p, visible: false }))}
            >
              <Text style={[styles.submitPaymentBtnText, { color: '#FFFFFF' }]}>ঠিক আছে</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Logout Confirmation Modal */}
      <Modal
        visible={logoutModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setLogoutModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIconWrap}>
              <Ionicons name="log-out-outline" size={28} color="#F87171" />
            </View>
            <Text style={styles.modalTitle}>অ্যাকাউন্ট লগআউট করবেন?</Text>
            <Text style={styles.modalSub}>
              লগআউট করার আগে আপনার সব কন্টাক্ট, শিডিউল ও প্রো স্ট্যাটাস ক্লাউডে ব্যাকআপ করে নেওয়া হবে।
            </Text>
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setLogoutModalVisible(false)}
                disabled={loggingOut}
              >
                <Text style={styles.modalCancelText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleLogoutConfirm}
                disabled={loggingOut}
              >
                {loggingOut ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalConfirmText}>লগআউট</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1120' },
  scrollContent: { padding: 18, paddingBottom: 42 },
  profileHeaderCard: {
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 16,
  },
  profileHeaderCardPro: {
    borderColor: '#F59E0B',
    backgroundColor: '#1E293B',
  },
  avatarContainer: { position: 'relative', marginBottom: 10 },
  avatarImage: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 3,
    borderColor: '#38BDF8',
  },
  avatarFallback: {
    width: 82,
    height: 82,
    borderRadius: 41,
    backgroundColor: '#0284C7',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#38BDF8',
  },
  avatarFallbackText: { color: '#FFFFFF', fontSize: 32, fontWeight: '900' },
  onlineBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#34D399',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#1E293B',
  },
  userName: { color: '#F8FAFC', fontSize: 21, fontWeight: '800', marginBottom: 2 },
  userEmail: { color: '#94A3B8', fontSize: 13, marginBottom: 10 },
  accountCodePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 12,
  },
  accountCodeText: { color: '#E2E8F0', fontSize: 12, fontWeight: '800', letterSpacing: 0.6 },
  headerActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  proStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  proStatusPillActive: {
    backgroundColor: '#FBBF24',
    borderColor: '#FDE68A',
  },
  proStatusPillText: { color: '#FBBF24', fontSize: 12, fontWeight: '800' },
  syncButtonPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  syncButtonText: { color: '#38BDF8', fontSize: 12, fontWeight: '700' },
  adminAccessBtn: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#7C2D12',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  adminAccessBtnText: { color: '#FEF3C7', fontSize: 13, fontWeight: '800' },
  streakRewardCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.35)',
    marginBottom: 14,
  },
  streakRewardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  streakRewardBadge: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakRewardTitle: { color: '#F8FAFC', fontSize: 15, fontWeight: '800' },
  streakRewardSub: { color: '#94A3B8', fontSize: 12, marginTop: 2, lineHeight: 17 },
  progressTrack: {
    height: 8,
    backgroundColor: '#0F172A',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#F97316', borderRadius: 999 },
  quickStoreRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  quickPassBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#1E293B',
    padding: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  quickPassTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' },
  quickPassSub: { color: '#34D399', fontSize: 11, marginTop: 2, fontWeight: '700' },
  quickRedeemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.4)',
  },
  quickRedeemText: { color: '#38BDF8', fontSize: 13, fontWeight: '800' },
  sectionTitle: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
    marginLeft: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 20,
  },
  statBox: {
    width: '48%',
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  statIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  statValue: { color: '#F8FAFC', fontSize: 20, fontWeight: '900' },
  statLabel: { color: '#94A3B8', fontSize: 12, marginTop: 3, fontWeight: '600' },
  heatmapCard: {
    backgroundColor: '#1E293B',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  heatmapHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  heatmapTitle: { color: '#F8FAFC', fontSize: 16, fontWeight: '800' },
  heatmapSub: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  heatmapGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  heatmapCell: { width: 16, height: 16, borderRadius: 4 },
  summaryListCard: {
    backgroundColor: '#1E293B',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 20,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  historyHeaderTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '800' },
  viewAllText: { color: '#38BDF8', fontSize: 12, fontWeight: '700' },
  emptyHistoryText: { color: '#64748B', fontSize: 12, paddingVertical: 10, textAlign: 'center' },
  historyItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#334155',
  },
  historyItemTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' },
  historyItemMeta: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  statusTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusApproved: { backgroundColor: 'rgba(16, 185, 129, 0.18)' },
  statusPending: { backgroundColor: 'rgba(245, 158, 11, 0.18)' },
  statusTagText: { color: '#F8FAFC', fontSize: 11, fontWeight: '800' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryRowTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '700' },
  summaryRowSub: { color: '#94A3B8', fontSize: 12, marginTop: 2 },
  summaryBadge: { color: '#38BDF8', fontSize: 14, fontWeight: '800' },
  divider: { height: 1, backgroundColor: '#334155', marginVertical: 4 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    paddingVertical: 15,
    borderRadius: 18,
  },
  logoutBtnText: { color: '#F87171', fontSize: 15, fontWeight: '800' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#1E293B',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  storeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  storeHeaderTitle: { color: '#F8FAFC', fontSize: 18, fontWeight: '900' },
  closeBtnText: { color: '#94A3B8', fontSize: 20, fontWeight: '800', paddingHorizontal: 6 },
  storeTabsBar: {
    flexDirection: 'row',
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 4,
    marginBottom: 14,
  },
  storeTabItem: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
  },
  storeTabItemActive: { backgroundColor: '#38BDF8' },
  storeTabText: { color: '#94A3B8', fontSize: 11, fontWeight: '800' },
  storeTabTextActive: { color: '#0F172A' },
  proComparisonBox: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  proComparisonTitle: { color: '#FBBF24', fontSize: 13, fontWeight: '800', marginBottom: 6 },
  proComparisonItem: { color: '#CBD5E1', fontSize: 12, lineHeight: 19 },
  planOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1.5,
    borderColor: '#334155',
  },
  planOptionCardSelected: {
    borderColor: '#FBBF24',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  planBadgeText: { color: '#FBBF24', fontSize: 10, fontWeight: '800', marginBottom: 2 },
  planTitleText: { color: '#F8FAFC', fontSize: 14, fontWeight: '800' },
  planSubText: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  planPriceText: { color: '#38BDF8', fontSize: 20, fontWeight: '900', marginLeft: 10 },
  paymentInstructionBox: {
    backgroundColor: '#0F172A',
    borderRadius: 16,
    padding: 14,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  paymentStepHeader: { color: '#F8FAFC', fontSize: 14, fontWeight: '800', marginBottom: 6 },
  paymentStepText: { color: '#CBD5E1', fontSize: 12, lineHeight: 19, marginBottom: 8 },
  storeInput: {
    backgroundColor: '#1E293B',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#F8FAFC',
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13,
    marginBottom: 10,
  },
  submitPaymentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FBBF24',
    paddingVertical: 13,
    borderRadius: 14,
    marginTop: 4,
  },
  submitPaymentBtnText: { color: '#0F172A', fontSize: 14, fontWeight: '900' },
  redeemBox: { paddingVertical: 8 },
  redeemTitle: { color: '#F8FAFC', fontSize: 15, fontWeight: '800', marginBottom: 4 },
  redeemSub: { color: '#94A3B8', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  accountCodeBanner: {
    backgroundColor: '#0F172A',
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  accountCodeBannerText: { color: '#38BDF8', fontSize: 13, fontWeight: '800' },
  adminPlanPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  adminPlanChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
  },
  adminPlanChipActive: {
    backgroundColor: '#38BDF8',
    borderColor: '#38BDF8',
  },
  adminPlanChipText: { color: '#E2E8F0', fontSize: 12, fontWeight: '800' },
  generatedKeyCard: {
    backgroundColor: '#0F172A',
    padding: 14,
    borderRadius: 16,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  generatedKeyLabel: { color: '#94A3B8', fontSize: 11, marginBottom: 4 },
  generatedKeyValue: { color: '#34D399', fontSize: 16, fontWeight: '900', letterSpacing: 1 },
  smallAdminBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  smallAdminBtnText: { color: '#0F172A', fontSize: 12, fontWeight: '800' },
  adminReqCard: {
    backgroundColor: '#0F172A',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inputLabel: { color: '#CBD5E1', fontSize: 12, fontWeight: '700', marginBottom: 4 },
  adminEmailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 6,
  },
  adminEmailText: { color: '#F8FAFC', fontSize: 13, fontWeight: '700' },
  superAdminTag: { color: '#FBBF24', fontSize: 11, fontWeight: '800' },
  addAdminBtn: {
    backgroundColor: '#38BDF8',
    width: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  forceUpdateToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0F172A',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  forceUpdateText: { color: '#E2E8F0', fontSize: 12, fontWeight: '700' },
  modalIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    alignSelf: 'center',
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSub: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  modalActionRow: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  modalCancelText: { color: '#CBD5E1', fontSize: 14, fontWeight: '700' },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    alignItems: 'center',
  },
  modalConfirmText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
