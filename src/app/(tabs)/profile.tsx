import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  NativeModules,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AdminAppConfig,
  CACHED_USER_PROFILE_KEY,
  CachedUserProfile,
  CURRENT_APP_VERSION,
  PurchaseRecord,
  SUPER_ADMIN_EMAIL,
  adminApprovePaymentRequestInCloud,
  adminCancelOrRevokePurchaseInCloud,
  clearAllLocalAccountData,
  getAccountCodeForUser,
  getAdminAppConfig,
  getPlanDurationMs,
  getUserPurchaseHistory,
  isSuperAdminEmail,
  isUserAdmin,
  recordUserPurchaseHistory,
  restoreCloudBackupAfterGoogleLogin,
  saveAdminAppConfig,
  submitUserPaymentRequestToCloud,
  supabase,
  syncLocalDataToCloudIfOnline,
} from '../../lib/supabase';

const { FocusLock } = NativeModules;

interface HeatmapDayCell {
  date: string;
  dateNum: number;
  monthLabel: string;
  dayName: string;
  minutes: number;
  isToday: boolean;
  globalIdx: number;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

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

  const [selectedHeatmapDay, setSelectedHeatmapDay] = useState<HeatmapDayCell | null>(null);

  const [focusStats, setFocusStats] = useState<{
    streakDays: number;
    emergencyPasses: number;
    daysUntilNextPass: number;
    totalFocusMinutes: number;
    completedSessions: number;
    historyMap: Record<string, number>;
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
    historyMap: {},
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
  const [selectedPlanType, setSelectedPlanType] = useState<
    'PRO30' | 'PRO180' | 'PRO365' | 'PASS1' | 'PASS3'
  >('PRO180');
  const [trxIdInput, setTrxIdInput] = useState('');
  const [senderPhoneInput, setSenderPhoneInput] = useState('');
  const [activationKeyInput, setActivationKeyInput] = useState('');
  const [submittingAction, setSubmittingAction] = useState(false);

  // Admin Panel State
  const [adminModalVisible, setAdminModalVisible] = useState(false);
  const [adminTab, setAdminTab] = useState<'KEYS' | 'REQUESTS' | 'SETTINGS' | 'OTA'>('KEYS');
  const [targetUserAccountCode, setTargetUserAccountCode] = useState('');
  const [revokeAccountCodeInput, setRevokeAccountCodeInput] = useState('');
  const [targetPlanType, setTargetPlanType] = useState<
    'PRO30' | 'PRO180' | 'PRO365' | 'PASS1' | 'PASS3'
  >('PRO180');
  const [generatedAdminKey, setGeneratedAdminKey] = useState('');

  // Admin Settings Drafts
  const [editWhatsapp, setEditWhatsapp] = useState('01761632836');
  const [editBkash, setEditBkash] = useState('01761632836');
  const [editPricePro30, setEditPricePro30] = useState('49');
  const [editPricePro180, setEditPricePro180] = useState('199');
  const [editPricePro365, setEditPricePro365] = useState('349');
  const [editPricePass1, setEditPricePass1] = useState('19');
  const [editPricePass3, setEditPricePass3] = useState('49');
  const [editFreeTrialEnabled, setEditFreeTrialEnabled] = useState(true);
  const [editMaxTrialUsersCap, setEditMaxTrialUsersCap] = useState('500');
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

  const showFeedback = (
    title: string,
    message: string,
    type: 'success' | 'error' | 'info' = 'info'
  ) => {
    setFeedbackModal({ visible: true, title, message, type });
  };

  const loadAllProfileData = async (forceCloudCheck: boolean = false) => {
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

      if (Platform.OS === 'android' && FocusLock?.setSuperAdminUserEmail && currentEmail) {
        try {
          await FocusLock.setSuperAdminUserEmail(currentEmail);
        } catch {}
      }

      const deterministicCode = getAccountCodeForUser(currentId || currentEmail);
      const superAdmin = isSuperAdminEmail(currentEmail);

      // Load Admin Config & History
      const cfg = await getAdminAppConfig(forceCloudCheck);
      setAdminConfig(cfg);
      setEditWhatsapp(cfg.whatsappNumber);
      setEditBkash(cfg.bkashNagadNumber);
      setEditPricePro30(String(cfg.prices.pro30));
      setEditPricePro180(String(cfg.prices.pro180));
      setEditPricePro365(String(cfg.prices.pro365));
      setEditPricePass1(String(cfg.prices.pass1));
      setEditPricePass3(String(cfg.prices.pass3));
      setEditFreeTrialEnabled(cfg.freeTrialEnabled !== false);
      setEditMaxTrialUsersCap(String(cfg.maxTrialUsersCap || cfg.maxEarlyUsersCap || 500));
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
        const totalFocusMins = Object.values(historyObj).reduce(
          (acc, val) => acc + (Number(val) || 0),
          0
        );
        const proExpiresAt = superAdmin ? 4102444800000 : Number(s.proExpiresAt ?? 0);
        const isPro = superAdmin || (!!s.isPro && proExpiresAt > Date.now());
        const proDaysRemaining = superAdmin
          ? 9999
          : isPro
          ? Math.max(1, Math.ceil((proExpiresAt - Date.now()) / 86400000))
          : 0;
        const streakDays = Number(s.streakDays ?? 0);

        setFocusStats({
          streakDays,
          emergencyPasses: Number(s.emergencyPasses ?? 0),
          daysUntilNextPass: Math.max(1, 99 - (streakDays % 99)),
          totalFocusMinutes:
            totalFocusMins > 0 ? totalFocusMins : Number(s.totalCompleted ?? 0) * 45,
          completedSessions: Number(s.totalCompleted ?? 0),
          historyMap: historyObj,
          isPro,
          proExpiresAt,
          proPlanName: superAdmin
            ? 'Super Admin Lifetime Pro'
            : s.proPlanName || (isPro ? 'Toki Pro' : 'Free'),
          proDaysRemaining,
          accountCode: deterministicCode,
        });
      } else {
        setFocusStats((prev) => ({
          ...prev,
          isPro: superAdmin,
          proPlanName: superAdmin ? 'Super Admin Lifetime Pro' : 'Free',
          proDaysRemaining: superAdmin ? 9999 : 0,
          accountCode: deterministicCode,
        }));
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
      void syncLocalDataToCloudIfOnline(true).then(() => loadAllProfileData(true));
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await syncLocalDataToCloudIfOnline(true);
    await loadAllProfileData(true);
    setRefreshing(false);
  };

  const handleManualCloudSync = async () => {
    setSyncingCloud(true);
    try {
      await syncLocalDataToCloudIfOnline(true);
      await restoreCloudBackupAfterGoogleLogin();
      await loadAllProfileData(true);
      showFeedback(
        'ক্লাউড সিঙ্ক সম্পন্ন ☁️',
        'আপনার সব ডেটা, পেমেন্ট স্ট্যাটাস, স্ট্রিক এবং প্রো মেম্বারশিপ ক্লাউডে সিঙ্ক হয়েছে।',
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
      // Refresh session token first so offline-completed sessions are uploaded before wiping local storage!
      try {
        await supabase.auth.getSession();
      } catch {}
      await syncLocalDataToCloudIfOnline(true);
      try {
        await GoogleSignin.signOut();
      } catch {}
      try {
        await supabase.auth.signOut();
      } catch {}
      await clearAllLocalAccountData();
      setLogoutModalVisible(false);
      router.replace('/(auth)/login');
    } catch {
      try {
        await GoogleSignin.signOut();
      } catch {}
      await clearAllLocalAccountData();
      setLogoutModalVisible(false);
      router.replace('/(auth)/login');
    } finally {
      setLoggingOut(false);
    }
  };

  const getPlanDetails = (planType: 'PRO30' | 'PRO180' | 'PRO365' | 'PASS1' | 'PASS3') => {
    const prices = adminConfig?.prices || {
      pro30: 49,
      pro180: 199,
      pro365: 349,
      pass1: 19,
      pass3: 49,
    };
    switch (planType) {
      case 'PRO30':
        return {
          title: '১ মাস Toki Pro (৩০ দিন)',
          price: prices.pro30,
          bonusPass: 0,
          badge: 'MONTHLY PLAN',
        };
      case 'PRO180':
        return {
          title: '৬ মাস Semester Pro (১৮০ দিন)',
          price: prices.pro180,
          bonusPass: 1,
          badge: 'POPULAR • +1 FREE PASS',
        };
      case 'PRO365':
        return {
          title: '১ বছর VIP Pro (৩৬৫ দিন)',
          price: prices.pro365,
          bonusPass: 2,
          badge: 'BEST VALUE • +2 FREE PASSES',
        };
      case 'PASS1':
        return {
          title: '১টি ইনস্ট্যান্ট এমারজেন্সি পাস',
          price: prices.pass1,
          bonusPass: 1,
          badge: 'SINGLE PASS',
        };
      case 'PASS3':
        return {
          title: '৩টি এমারজেন্সি পাস প্যাক',
          price: prices.pass3,
          bonusPass: 3,
          badge: 'PASS BUNDLE',
        };
    }
  };

  const handleRedeemActivationKey = async () => {
    const cleanKey = activationKeyInput.trim().toUpperCase();
    if (!cleanKey) {
      showFeedback('কোড দিন', 'অনুগ্রহ করে আপনার Activation Key লিখুন।', 'error');
      return;
    }
    setSubmittingAction(true);
    try {
      if (FocusLock?.verifyAndApplyActivationKey) {
        const res = await FocusLock.verifyAndApplyActivationKey(
          focusStats.accountCode,
          cleanKey
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
            trxId: `KEY:${cleanKey}`,
            senderPhone: 'Activation Key',
            status: 'approved',
            activationKey: cleanKey,
            createdAt: Date.now(),
            expiresAt: Number(res.proExpiresAt || Date.now() + getPlanDurationMs(planType)),
          };
          await recordUserPurchaseHistory(newRecord);
          await syncLocalDataToCloudIfOnline(true);
          await loadAllProfileData(true);
          setActivationKeyInput('');
          showFeedback(
            'অভিনন্দন! সফলভাবে চালু হয়েছে 🎉',
            res.message || `${details.title} সফলভাবে চালু হয়েছে!`,
            'success'
          );
        } else {
          showFeedback(
            'ভুল অ্যাক্টিভেশন কোড ❌',
            res?.message ||
              'এই কোডটি আপনার অ্যাকাউন্টের জন্য নয় অথবা ইতিমধ্যে ব্যবহৃত হয়েছে।',
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

  // Separate Submit Modes: openWhatsAppAfter = false (In-App only) OR true (Submit + WhatsApp)
  const handleSubmitPaymentRequest = async (openWhatsAppAfter: boolean) => {
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
      const now = Date.now();
      const record: PurchaseRecord = {
        id: `req-${now}`,
        userEmail: userProfile.email,
        accountCode: focusStats.accountCode,
        planType: selectedPlanType,
        planTitle: details.title,
        amountBdt: details.price,
        trxId: trxIdInput.trim().toUpperCase(),
        senderPhone: senderPhoneInput.trim(),
        status: 'pending',
        createdAt: now,
        expiresAt: now + getPlanDurationMs(selectedPlanType),
      };

      await submitUserPaymentRequestToCloud(record);
      await loadAllProfileData(true);

      const savedTrx = trxIdInput.trim().toUpperCase();
      const savedPhone = senderPhoneInput.trim();
      setTrxIdInput('');
      setSenderPhoneInput('');

      if (openWhatsAppAfter) {
        const waNum = (adminConfig?.whatsappNumber || '01761632836').replace(/[^0-9]/g, '');
        const waPhone = waNum.startsWith('88') ? waNum : `88${waNum}`;
        const msg = encodeURIComponent(
          `Assalamu Alaikum Admin! 👑\nআমি *${details.title}* (৳${details.price}) এর জন্য পেমেন্ট করেছি।\n\n• Account Code: *${focusStats.accountCode}*\n• Email: ${userProfile.email}\n• Plan Code: *${selectedPlanType}*\n• TrxID: *${savedTrx}*\n• Sender Number: ${savedPhone}\n\nঅনুগ্রহ করে আমার রিকোয়েস্ট Approve করুন অথবা Activation Key দিন।`
        );
        Linking.openURL(`https://wa.me/${waPhone}?text=${msg}`).catch(() => {});
      }

      showFeedback(
        'পেমেন্ট রিকোয়েস্ট জমা হয়েছে ✅',
        openWhatsAppAfter
          ? 'অ্যাডমিন প্যানেলে রিকোয়েস্ট জমা হয়েছে এবং WhatsApp চ্যাট ওপেন করা হয়েছে।'
          : 'আপনার রিকোয়েস্ট সরাসরি অ্যাডমিনের প্যানেলে জমা হয়েছে! অ্যাডমিন Approve করলেই আপনার অ্যাপে অটোমেটিক প্রো/পাস চালু হয়ে যাবে।',
        'success'
      );
    } catch {
      showFeedback('ত্রুটি', 'রিকোয়েস্ট জমা দেওয়া যায়নি। ইন্টারনেট সংযোগ চেক করুন।', 'error');
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
      await loadAllProfileData(true);
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

  // Button 1 in Admin Requests: ONLY Approve / Active in Cloud (No doubling if re-approved!)
  const handleApproveRequestOnly = async (req: PurchaseRecord) => {
    try {
      if (FocusLock?.authenticateAdminBiometric) {
        const ok = await FocusLock.authenticateAdminBiometric();
        if (!ok) return;
      }
      let key = req.activationKey || '';
      if (!key && FocusLock?.generateActivationKeyNative) {
        key = await FocusLock.generateActivationKeyNative(req.accountCode, req.planType);
      }
      await adminApprovePaymentRequestInCloud(req.id, key);
      await syncLocalDataToCloudIfOnline(true);
      await loadAllProfileData(true);
      showFeedback(
        'রিকোয়েস্ট Approved হয়েছে ✅',
        `ইউজারের (${req.accountCode}) প্রো/পাস ক্লাউডে Active করে দেওয়া হয়েছে (নির্ধারিত মেয়াদের জন্য, ডাবল হবে না)।`,
        'success'
      );
    } catch {
      showFeedback('ত্রুটি', 'রিকোয়েস্ট অ্যাপ্রুভ করা যায়নি।', 'error');
    }
  };

  // Button 2 in Admin Requests: Send Key via WhatsApp separately
  const handleSendKeyOnWhatsApp = async (req: PurchaseRecord) => {
    try {
      let key = req.activationKey || '';
      if (!key && FocusLock?.generateActivationKeyNative) {
        key = await FocusLock.generateActivationKeyNative(req.accountCode, req.planType);
        await adminApprovePaymentRequestInCloud(req.id, key);
        await loadAllProfileData(true);
      }
      const waPhone = req.senderPhone.replace(/[^0-9]/g, '');
      const formattedWa = waPhone.startsWith('88') ? waPhone : `88${waPhone}`;
      const msg = encodeURIComponent(
        `🎉 অভিনন্দন! আপনার *${req.planTitle}* পেমেন্ট ভেরিফাই ও Active করা হয়েছে।\n\n🔑 আপনার Activation Key:\n*${key}*\n\nToki অ্যাপ রিফ্রেশ করলেই অটো চালু হয়ে যাবে, অথবা Profile -> Redeem Key-তে গিয়ে এই কোডটি বসাতে পারেন!`
      );
      if (waPhone.length >= 11) {
        Linking.openURL(`https://wa.me/${formattedWa}?text=${msg}`).catch(() => {});
      } else {
        Share.share({ message: `Toki Activation Key (${req.accountCode}): ${key}` }).catch(
          () => {}
        );
      }
    } catch {}
  };

  // Button 3 in Admin Requests / Key Tab: Cancel / Revoke Subscription or Pass!
  const handleCancelOrRevokeRequest = async (reqOrAccountCode: PurchaseRecord | string) => {
    try {
      if (FocusLock?.authenticateAdminBiometric) {
        const ok = await FocusLock.authenticateAdminBiometric();
        if (!ok) return;
      }
      const targetIdOrCode =
        typeof reqOrAccountCode === 'string'
          ? reqOrAccountCode.trim().toUpperCase()
          : reqOrAccountCode.id;
      const targetAcc =
        typeof reqOrAccountCode === 'string'
          ? reqOrAccountCode.trim().toUpperCase()
          : reqOrAccountCode.accountCode;

      if (!targetIdOrCode) {
        showFeedback('Account Code দিন', 'বাতিল করার জন্য ইউজারের Account Code লিখুন।', 'error');
        return;
      }

      await adminCancelOrRevokePurchaseInCloud(targetIdOrCode);
      setRevokeAccountCodeInput('');
      await syncLocalDataToCloudIfOnline(true);
      await loadAllProfileData(true);
      showFeedback(
        'সাবস্ক্রিপশন / পাস বাতিল করা হয়েছে 🚫',
        `ইউজারের (${targetAcc}) প্রো সাবস্ক্রিপশন ও বোনাস পাস ক্লাউড ও ডিভাইস থেকে সাথে সাথে বাতিল (Cancelled) করা হয়েছে।`,
        'info'
      );
    } catch {
      showFeedback('ত্রুটি', 'সাবস্ক্রিপশন বাতিল করা যায়নি।', 'error');
    }
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
        freeTrialEnabled: editFreeTrialEnabled,
        maxTrialUsersCap: Math.max(1, parseInt(editMaxTrialUsersCap, 10) || 500),
        maxEarlyUsersCap: Math.max(1, parseInt(editMaxTrialUsersCap, 10) || 500),
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
        'পেমেন্ট নাম্বার, প্যাকেজ রেট এবং আপডেট অ্যালার্ট সফলভাবে ক্লাউডে আপডেট হয়েছে।',
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
    showFeedback(
      'নতুন অ্যাডমিন যুক্ত হয়েছে 👑',
      `${clean} এখন অ্যাডমিন হিসেবে যুক্ত হয়েছেন (শুধুমাত্র সুপার অ্যাডমিন বাই-ডিফল্ট ফ্রি প্রো পাবেন)।`,
      'success'
    );
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

  const getHeatmapCellColor = (minutes: number, isLockedCell: boolean) => {
    if (isLockedCell) return '#0F172A';
    if (minutes <= 0) return '#1E293B';
    if (minutes < 45) return '#065F46';
    if (minutes < 120) return '#059669';
    if (minutes < 240) return '#10B981';
    return '#34D399';
  };

  // 🌟 v1.8.0 Classic Interactive GitHub Contribution Graph (9 Weekly Columns x 7 Days Sun..Sat)
  const githubWeeklyColumns = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const totalDays = 63; // 9 full weeks (last ~60 days)
    const cells: HeatmapDayCell[] = [];

    for (let i = totalDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const iso = `${yyyy}-${mm}-${dd}`;
      const mins = Number(focusStats.historyMap[iso] || 0);
      cells.push({
        date: iso,
        dateNum: d.getDate(),
        monthLabel: `${d.getDate()} ${MONTH_NAMES[d.getMonth()]} ${yyyy}`,
        dayName: DAY_SHORT[d.getDay()],
        minutes: mins,
        isToday: i === 0,
        globalIdx: totalDays - 1 - i,
      });
    }

    const weeks: HeatmapDayCell[][] = [];
    for (let w = 0; w < 9; w++) {
      weeks.push(cells.slice(w * 7, w * 7 + 7));
    }
    return weeks;
  }, [focusStats.historyMap]);

  const activeDayDetail = useMemo(() => {
    if (selectedHeatmapDay) return selectedHeatmapDay;
    const lastWeek = githubWeeklyColumns[githubWeeklyColumns.length - 1] || [];
    return lastWeek[lastWeek.length - 1] || null;
  }, [selectedHeatmapDay, githubWeeklyColumns]);

  const totalHours = (focusStats.totalFocusMinutes / 60).toFixed(1);
  const userIsAdmin = isUserAdmin(userProfile.email, adminConfig);
  const userIsSuperAdmin = isSuperAdminEmail(userProfile.email);
  const streakProgress99 = Math.min(
    99,
    focusStats.streakDays % 99 || (focusStats.streakDays > 0 ? 99 : 0)
  );

  return (
    <View style={styles.container}>
      <StatusBar style="light" backgroundColor="#0B1120" />
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(16, insets.top + 12),
            paddingBottom: Math.max(40, insets.bottom + 24),
          },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#38BDF8" />
        }
      >
        {/* =================================================================== */}
        {/* 1. LUXURY GRADIENT HERO PROFILE CARD (SAFE-AREA & OVERFLOW PROOF)   */}
        {/* =================================================================== */}
        <LinearGradient
          colors={
            focusStats.isPro
              ? ['#1E1B4B', '#131C31', '#0F172A']
              : ['#0F172A', '#131C31', '#1E293B']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, focusStats.isPro && styles.heroCardPro]}
        >
          {/* Top Bar inside Hero: Tier Pill + Cloud Sync Button */}
          <View style={styles.heroTopRow}>
            <View
              style={[
                styles.tierBadgePill,
                focusStats.isPro ? styles.tierBadgePro : styles.tierBadgeFree,
              ]}
            >
              <MaterialCommunityIcons
                name={focusStats.isPro ? 'crown' : 'shield-outline'}
                size={13}
                color={focusStats.isPro ? '#FBBF24' : '#94A3B8'}
              />
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={[
                  styles.tierBadgeText,
                  { color: focusStats.isPro ? '#FDE68A' : '#CBD5E1' },
                ]}
              >
                {userIsSuperAdmin
                  ? 'SUPER ADMIN VIP PRO'
                  : focusStats.isPro
                  ? `TOKI PRO • ${focusStats.proDaysRemaining}D LEFT`
                  : 'TOKI FREE TIER'}
              </Text>
            </View>

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
                  <Text allowFontScaling={false} style={styles.syncButtonText}>
                    Sync
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Avatar & Identity Row */}
          <View style={styles.identityRow}>
            <View style={styles.avatarContainer}>
              {userProfile.avatarUrl ? (
                <Image source={{ uri: userProfile.avatarUrl }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Text allowFontScaling={false} style={styles.avatarFallbackText}>
                    {(userProfile.name || 'T').charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <View
                style={[
                  styles.onlineBadge,
                  focusStats.isPro && { backgroundColor: '#F59E0B' },
                ]}
              >
                <MaterialCommunityIcons
                  name={focusStats.isPro ? 'crown' : 'check-bold'}
                  size={12}
                  color="#0F172A"
                />
              </View>
            </View>

            <View style={styles.identityTextCol}>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.userName}>
                {userProfile.name}
              </Text>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.userEmail}>
                {userProfile.email}
              </Text>

              <TouchableOpacity
                style={styles.accountCodePill}
                onPress={() =>
                  Share.share({
                    message: `My Toki Account Code: ${focusStats.accountCode} (${userProfile.email})`,
                  }).catch(() => {})
                }
              >
                <Ionicons name="key-outline" size={12} color="#38BDF8" />
                <Text allowFontScaling={false} numberOfLines={1} style={styles.accountCodeText}>
                  {focusStats.accountCode}
                </Text>
                <Feather name="share-2" size={11} color="#94A3B8" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Upgrade / Manage Pro CTA Button */}
          <TouchableOpacity
            activeOpacity={0.85}
            style={[styles.proMainCtaBtn, focusStats.isPro && styles.proMainCtaBtnActive]}
            onPress={() => {
              setStoreTab('PRO');
              setStoreModalVisible(true);
            }}
          >
            <MaterialCommunityIcons name="crown" size={18} color="#0F172A" />
            <Text allowFontScaling={false} numberOfLines={1} style={styles.proMainCtaText}>
              {userIsSuperAdmin
                ? 'Toki Pro 👑 (Super Admin Lifetime Active)'
                : focusStats.isPro
                ? `Toki Pro 👑 সচল আছে (${focusStats.proDaysRemaining} দিন বাকি)`
                : 'Upgrade to Toki Pro 👑 (৳49 থেকে শুরু)'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color="#0F172A" />
          </TouchableOpacity>

          {/* Super Admin / Admin Fingerprint Button */}
          {userIsAdmin && (
            <TouchableOpacity style={styles.adminAccessBtn} onPress={handleOpenAdminPanel}>
              <Ionicons name="finger-print" size={17} color="#FDE68A" />
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={styles.adminAccessBtnText}
              >
                Admin Control Panel (Fingerprint Verified)
              </Text>
              <Ionicons name="chevron-forward" size={15} color="#FDE68A" />
            </TouchableOpacity>
          )}
        </LinearGradient>

        {/* =================================================================== */}
        {/* 2. QUICK STORE & REDEEM BAR                                         */}
        {/* =================================================================== */}
        <View style={styles.quickStoreRow}>
          <TouchableOpacity
            style={styles.quickPassBtn}
            onPress={() => {
              setStoreTab('PASS');
              setSelectedPlanType('PASS1');
              setStoreModalVisible(true);
            }}
          >
            <View style={styles.quickPassIconWrap}>
              <MaterialCommunityIcons name="ticket-confirmation" size={18} color="#10B981" />
            </View>
            <View style={{ flex: 1 }}>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.quickPassTitle}>
                Emergency Pass কিনুন
              </Text>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.quickPassSub}>
                জমা আছে: {focusStats.emergencyPasses}টি পাস
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
            <Ionicons name="key" size={16} color="#38BDF8" />
            <Text allowFontScaling={false} style={styles.quickRedeemText}>
              Redeem Key
            </Text>
          </TouchableOpacity>
        </View>

        {/* =================================================================== */}
        {/* 3. 99-DAY STREAK CHALLENGE CARD                                     */}
        {/* =================================================================== */}
        <View style={styles.streakRewardCard}>
          <View style={styles.streakRewardTop}>
            <View style={styles.streakRewardBadge}>
              <Ionicons name="flame" size={20} color="#F97316" />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.streakTitleRow}>
                <Text allowFontScaling={false} numberOfLines={1} style={styles.streakRewardTitle}>
                  ৯৯ দিনের ফোকাস চ্যালেঞ্জ
                </Text>
                <Text allowFontScaling={false} style={styles.streakCounterPill}>
                  {streakProgress99}/99 দিন
                </Text>
              </View>
              <Text allowFontScaling={false} style={styles.streakRewardSub}>
                প্রতিদিন অন্তত ৪৫ মিনিট লক পূর্ণ করে টানা ৯৯ দিন স্ট্রিক করলে ৭ দিনের Toki Pro সম্পূর্ণ ফ্রি!
              </Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.max(4, Math.min(100, Math.round((streakProgress99 / 99) * 100)))}%` },
              ]}
            />
          </View>
        </View>

        {/* =================================================================== */}
        {/* 4. 2x2 MODERN BENTO STATS GRID                                      */}
        {/* =================================================================== */}
        <Text allowFontScaling={false} style={styles.sectionTitle}>
          প্রোডাক্টিভিটি ড্যাশবোর্ড
        </Text>
        <View style={styles.statsGrid}>
          <View style={styles.statBox}>
            <View style={[styles.statIconWrap, { backgroundColor: 'rgba(249, 115, 22, 0.15)' }]}>
              <Ionicons name="flame" size={20} color="#F97316" />
            </View>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.statValue}>
              {focusStats.streakDays} দিন
            </Text>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.statLabel}>
              টানা স্ট্রিক (≥45m)
            </Text>
          </View>

          <View style={styles.statBox}>
            <View style={[styles.statIconWrap, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
              <Ionicons name="time" size={20} color="#38BDF8" />
            </View>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.statValue}>
              {totalHours} ঘণ্টা
            </Text>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.statLabel}>
              মোট ডিপ ফোকাস
            </Text>
          </View>

          <View style={styles.statBox}>
            <View style={[styles.statIconWrap, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="shield-checkmark" size={20} color="#10B981" />
            </View>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.statValue}>
              {focusStats.emergencyPasses} টি
            </Text>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.statLabel}>
              এমারজেন্সি পাস
            </Text>
          </View>

          <View style={styles.statBox}>
            <View style={[styles.statIconWrap, { backgroundColor: 'rgba(168, 85, 247, 0.15)' }]}>
              <Ionicons name="ribbon" size={20} color="#A855F7" />
            </View>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.statValue}>
              {focusStats.completedSessions} বার
            </Text>
            <Text allowFontScaling={false} numberOfLines={1} style={styles.statLabel}>
              সফল লক সেশন
            </Text>
          </View>
        </View>

        {/* =================================================================== */}
        {/* 5. v1.8.0 CLASSIC INTERACTIVE GITHUB CONTRIBUTION HEATMAP           */}
        {/* =================================================================== */}
        <View style={styles.heatmapCard}>
          <View style={styles.heatmapHeaderRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text allowFontScaling={false} style={styles.heatmapTitle}>
                ৬০ দিনের গিটহাব ফোকাস গ্রাফ
              </Text>
              <Text allowFontScaling={false} style={styles.heatmapSub}>
                {focusStats.isPro
                  ? 'যেকোনো বক্সে ট্যাপ করে ওই দিনের ফোকাস বিস্তারিত দেখুন'
                  : 'ফ্রি ভার্সনে শেষ ১৪ দিন সচল (পূর্ণ ৬০ দিনের চার্ট দেখতে Toki Pro নিন)'}
              </Text>
            </View>
            <View style={styles.heatmapBadge}>
              <MaterialCommunityIcons name="calendar-check" size={14} color="#34D399" />
              <Text allowFontScaling={false} style={styles.heatmapBadgeText}>
                60D
              </Text>
            </View>
          </View>

          {/* v1.8.0 Weekly Columns Layout (Day Labels on Left + 9 Weekly Columns of 7 Days) */}
          <View style={styles.ghGraphContainer}>
            {/* Left Day-of-Week Labels */}
            <View style={styles.ghDayLabelsCol}>
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((dLabel, idx) => (
                <View key={dLabel} style={styles.ghDayLabelCell}>
                  <Text
                    allowFontScaling={false}
                    style={[
                      styles.ghDayLabelText,
                      idx % 2 === 1 && { opacity: 0.45 },
                    ]}
                  >
                    {dLabel}
                  </Text>
                </View>
              ))}
            </View>

            {/* 9 Weekly Columns */}
            <View style={styles.ghColumnsArea}>
              {githubWeeklyColumns.map((weekCol, wIdx) => (
                <View key={`week-${wIdx}`} style={styles.ghWeekCol}>
                  {weekCol.map((cell) => {
                    const isLockedForFree = !focusStats.isPro && cell.globalIdx < 49;
                    const isSelected = activeDayDetail?.date === cell.date;
                    const done = cell.minutes >= 45 && !isLockedForFree;
                    return (
                      <TouchableOpacity
                        key={cell.date}
                        activeOpacity={0.75}
                        onPress={() => setSelectedHeatmapDay(cell)}
                        style={[
                          styles.ghSquareCell,
                          {
                            backgroundColor: getHeatmapCellColor(cell.minutes, isLockedForFree),
                            borderColor: isSelected
                              ? '#38BDF8'
                              : cell.isToday
                              ? '#34D399'
                              : isLockedForFree
                              ? '#1E293B'
                              : 'rgba(255,255,255,0.08)',
                            borderWidth: isSelected || cell.isToday ? 1.5 : 1,
                          },
                        ]}
                      >
                        {done ? (
                          <MaterialCommunityIcons
                            name="check-bold"
                            size={10}
                            color="#064E3B"
                          />
                        ) : (
                          <Text
                            allowFontScaling={false}
                            style={[
                              styles.ghSquareDateNum,
                              {
                                color: cell.isToday
                                  ? '#34D399'
                                  : isLockedForFree
                                  ? '#334155'
                                  : '#94A3B8',
                              },
                            ]}
                          >
                            {cell.dateNum}
                          </Text>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>

          {/* Interactive Selected Day Info Pill */}
          {activeDayDetail && (
            <View style={styles.ghSelectedDayBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Ionicons
                  name={activeDayDetail.minutes >= 45 ? 'checkmark-circle' : 'calendar-outline'}
                  size={15}
                  color={activeDayDetail.minutes >= 45 ? '#34D399' : '#38BDF8'}
                />
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={styles.ghSelectedDayText}
                >
                  {activeDayDetail.dayName}, {activeDayDetail.monthLabel}
                  {activeDayDetail.isToday ? ' (Today)' : ''}
                </Text>
              </View>
              <Text
                allowFontScaling={false}
                style={[
                  styles.ghSelectedMinsText,
                  { color: activeDayDetail.minutes >= 45 ? '#34D399' : '#94A3B8' },
                ]}
              >
                {activeDayDetail.minutes > 0
                  ? `${activeDayDetail.minutes} মিনিট ফোকাস`
                  : 'কোনো লক সেশন নেই'}
              </Text>
            </View>
          )}

          {/* Legend Row */}
          <View style={styles.heatmapLegendRow}>
            <Text allowFontScaling={false} style={styles.legendText}>
              Less
            </Text>
            {['#1E293B', '#065F46', '#059669', '#10B981', '#34D399'].map((col, idx) => (
              <View key={idx} style={[styles.legendBox, { backgroundColor: col }]} />
            ))}
            <Text allowFontScaling={false} style={styles.legendText}>
              More (≥45m✓)
            </Text>
          </View>
        </View>

        {/* =================================================================== */}
        {/* 6. PURCHASE & PASS HISTORY CARD (60-DAY AUTO CLEAN)                 */}
        {/* =================================================================== */}
        <View style={styles.summaryListCard}>
          <View style={styles.historyHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
              <MaterialCommunityIcons name="history" size={18} color="#38BDF8" />
              <Text
                allowFontScaling={false}
                numberOfLines={1}
                style={styles.historyHeaderTitle}
              >
                প্রো ও পাস হিস্ট্রি (৬০ দিন অটো-ক্লিন)
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setStoreTab('HISTORY');
                setStoreModalVisible(true);
              }}
            >
              <Text allowFontScaling={false} style={styles.viewAllText}>
                সব দেখুন
              </Text>
            </TouchableOpacity>
          </View>

          {purchaseHistory.length === 0 ? (
            <Text allowFontScaling={false} style={styles.emptyHistoryText}>
              এখনো কোনো প্রো সাবস্ক্রিপশন বা পাস কেনার রেকর্ড নেই।
            </Text>
          ) : (
            purchaseHistory.slice(0, 3).map((rec) => (
              <View key={rec.id} style={styles.historyItemRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={styles.historyItemTitle}
                  >
                    {rec.planTitle}
                  </Text>
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={styles.historyItemMeta}
                  >
                    ৳{rec.amountBdt} • {rec.trxId} •{' '}
                    {new Date(rec.createdAt).toLocaleDateString()}
                  </Text>
                </View>
                <View
                  style={[
                    styles.statusTag,
                    rec.status === 'approved'
                      ? styles.statusApproved
                      : rec.status === 'cancelled'
                      ? styles.statusCancelled
                      : styles.statusPending,
                  ]}
                >
                  <Text allowFontScaling={false} style={styles.statusTagText}>
                    {rec.status === 'approved'
                      ? 'Active ✅'
                      : rec.status === 'cancelled'
                      ? 'Cancelled ❌'
                      : 'Pending ⏳'}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* =================================================================== */}
        {/* 7. ACCOUNT & MODULE STATUS                                          */}
        {/* =================================================================== */}
        <Text allowFontScaling={false} style={styles.sectionTitle}>
          মডিউল ও কোটা স্ট্যাটাস
        </Text>
        <View style={styles.summaryListCard}>
          <TouchableOpacity
            style={styles.summaryRow}
            onPress={() => router.push('/features/StrictFocusScreen')}
          >
            <View style={[styles.summaryIcon, { backgroundColor: 'rgba(56, 189, 248, 0.15)' }]}>
              <Ionicons name="calendar" size={18} color="#38BDF8" />
            </View>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.summaryRowTitle}>
                ডেইলি শিডিউল ও ব্রেক সিস্টেম
              </Text>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.summaryRowSub}>
                {focusStats.isPro
                  ? '৪টি শিডিউল + 25m/50m ব্রেক সিস্টেম আনলকড'
                  : 'ফ্রি টিয়ারে সর্বোচ্চ ১টি শিডিউল (ব্রেক শুধু Pro-তে)'}
              </Text>
            </View>
            <Text allowFontScaling={false} style={styles.summaryBadge}>
              {schedulesCount} টি
            </Text>
          </TouchableOpacity>

          <View style={styles.divider} />

          <TouchableOpacity
            style={styles.summaryRow}
            onPress={() => router.push('/features/SmartNetworking')}
          >
            <View style={[styles.summaryIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
              <Ionicons name="people" size={18} color="#10B981" />
            </View>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.summaryRowTitle}>
                স্মার্ট নেটওয়ার্কিং কন্টাক্টস
              </Text>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.summaryRowSub}>
                {focusStats.isPro
                  ? 'আনলিমিটেড প্রো কন্টাক্ট সিঙ্ক'
                  : `${contactsCount}/5 টি ফ্রি কন্টাক্ট ব্যবহৃত`}
              </Text>
            </View>
            <Text allowFontScaling={false} style={styles.summaryBadge}>
              {contactsCount} জন
            </Text>
          </TouchableOpacity>
        </View>

        {/* Logout Action */}
        <TouchableOpacity style={styles.logoutBtn} onPress={() => setLogoutModalVisible(true)}>
          <Ionicons name="log-out-outline" size={19} color="#F87171" />
          <Text allowFontScaling={false} style={styles.logoutBtnText}>
            অ্যাকাউন্ট লগআউট / জিমেইল পরিবর্তন করুন
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ===================================================================== */}
      {/* TOKI PRO & EMERGENCY PASS STORE MODAL (KEYBOARD & OVERFLOW SAFE)      */}
      {/* ===================================================================== */}
      <Modal
        visible={storeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setStoreModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetBackdrop}
        >
          <View
            style={[
              styles.sheetCard,
              { paddingBottom: Math.max(20, insets.bottom + 12) },
            ]}
          >
            <View style={styles.storeHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <MaterialCommunityIcons name="crown" size={22} color="#FBBF24" />
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={styles.storeHeaderTitle}
                >
                  Toki Pro 👑 & Pass Store
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeCircleBtn}
                onPress={() => setStoreModalVisible(false)}
              >
                <Ionicons name="close" size={18} color="#94A3B8" />
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
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={[styles.storeTabText, storeTab === t && styles.storeTabTextActive]}
                  >
                    {t === 'PRO'
                      ? 'Pro Plans'
                      : t === 'PASS'
                      ? 'Buy Pass'
                      : t === 'REDEEM'
                      ? 'কোড দিন'
                      : 'হিস্ট্রি'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 28 }}
            >
              {(storeTab === 'PRO' || storeTab === 'PASS') && (
                <View>
                  {storeTab === 'PRO' ? (
                    <>
                      <View style={styles.proComparisonBox}>
                        <Text allowFontScaling={false} style={styles.proComparisonTitle}>
                          Toki Pro মেম্বারশিপে যা যা থাকছে:
                        </Text>
                        <Text allowFontScaling={false} style={styles.proComparisonItem}>
                          • একটানা ৬ ঘণ্টা সেশন লক এবং ১৫ ঘণ্টা পর্যন্ত ৪টি ডেইলি শিডিউল
                        </Text>
                        <Text allowFontScaling={false} style={styles.proComparisonItem}>
                          • সেশন (25m+5m) ও শিডিউল (50m+10m) অটো-ব্রেক সিস্টেম
                        </Text>
                        <Text allowFontScaling={false} style={styles.proComparisonItem}>
                          • ৩.৫ ঘণ্টা YouTube Study Mode + লক স্ক্রিনে Study PDF Reader
                        </Text>
                        <Text allowFontScaling={false} style={styles.proComparisonItem}>
                          • ৬টি অ্যাপ, ৫টি ওয়েবসাইট, আনলিমিটেড কন্টাক্ট ও ৬০ দিনের চার্ট
                        </Text>
                        <Text allowFontScaling={false} style={styles.proComparisonItem}>
                          • ৬ মাস প্রো-তে +১টি এবং ১ বছর প্রো-তে +২টি ফ্রি এমারজেন্সি পাস!
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
                            <View style={{ flex: 1, paddingRight: 8 }}>
                              <Text allowFontScaling={false} style={styles.planBadgeText}>
                                {info.badge}
                              </Text>
                              <Text allowFontScaling={false} style={styles.planTitleText}>
                                {info.title}
                              </Text>
                              <Text allowFontScaling={false} style={styles.planSubText}>
                                {info.bonusPass > 0
                                  ? `সাথে পাচ্ছেন +${info.bonusPass}টি ফ্রি এমারজেন্সি পাস`
                                  : 'সব প্রো ফিচার ও ব্রেক সিস্টেম আনলক'}
                              </Text>
                            </View>
                            <Text allowFontScaling={false} style={styles.planPriceText}>
                              ৳{info.price}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  ) : (
                    <>
                      <View style={styles.proComparisonBox}>
                        <Text allowFontScaling={false} style={styles.proComparisonTitle}>
                          ইনস্ট্যান্ট এমারজেন্সি পাস কেন প্রয়োজন?
                        </Text>
                        <Text allowFontScaling={false} style={styles.proComparisonItem}>
                          • জরুরি মুহূর্তে সক্রিয় ফোকাস বা শিডিউল লক তাৎক্ষণিক আনলক করতে
                        </Text>
                        <Text allowFontScaling={false} style={styles.proComparisonItem}>
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
                            <View style={{ flex: 1, paddingRight: 8 }}>
                              <Text allowFontScaling={false} style={styles.planBadgeText}>
                                {info.badge}
                              </Text>
                              <Text allowFontScaling={false} style={styles.planTitleText}>
                                {info.title}
                              </Text>
                              <Text allowFontScaling={false} style={styles.planSubText}>
                                তাৎক্ষণিক অ্যাকাউন্টে যুক্ত হবে
                              </Text>
                            </View>
                            <Text allowFontScaling={false} style={styles.planPriceText}>
                              ৳{info.price}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}

                  {/* Payment Step Box with 2 Separate Submit Buttons */}
                  <View style={styles.paymentInstructionBox}>
                    <Text allowFontScaling={false} style={styles.paymentStepHeader}>
                      পেমেন্ট ও অ্যাক্টিভেশন পদ্ধতি:
                    </Text>
                    <Text allowFontScaling={false} style={styles.paymentStepText}>
                      ১. নিচের বিকাশ/নগদ (Send Money) নাম্বারে নির্ধারিত টাকা পাঠান:{'\n'}
                      <Text style={{ color: '#FBBF24', fontWeight: '800', fontSize: 14 }}>
                        bKash / Nagad: {adminConfig?.bkashNagadNumber || '01761632836'}
                      </Text>
                    </Text>
                    <Text allowFontScaling={false} style={styles.paymentStepText}>
                      ২. আপনার Account Code:{' '}
                      <Text style={{ color: '#38BDF8', fontWeight: '800' }}>
                        {focusStats.accountCode}
                      </Text>
                    </Text>

                    <TextInput
                      style={styles.storeInput}
                      placeholder="বিকাশ/নগদ TrxID লিখুন (যেমন: BKA8291XYZ)"
                      placeholderTextColor="#64748B"
                      autoCapitalize="characters"
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

                    {/* Button 1: Submit In-App Only */}
                    <TouchableOpacity
                      style={styles.submitPaymentBtn}
                      onPress={() => void handleSubmitPaymentRequest(false)}
                      disabled={submittingAction}
                    >
                      {submittingAction ? (
                        <ActivityIndicator size="small" color="#0F172A" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={18} color="#0F172A" />
                          <Text allowFontScaling={false} style={styles.submitPaymentBtnText}>
                            শুধুমাত্র পেমেন্ট রিকোয়েস্ট সাবমিট করুন
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>

                    {/* Button 2: Submit + Open WhatsApp */}
                    <TouchableOpacity
                      style={styles.submitWhatsAppBtn}
                      onPress={() => void handleSubmitPaymentRequest(true)}
                      disabled={submittingAction}
                    >
                      <Ionicons name="logo-whatsapp" size={17} color="#34D399" />
                      <Text allowFontScaling={false} style={styles.submitWhatsAppBtnText}>
                        সাবমিট করুন + WhatsApp-এ মেসেজ দিন
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              {storeTab === 'REDEEM' && (
                <View style={styles.redeemBox}>
                  <Text allowFontScaling={false} style={styles.redeemTitle}>
                    অ্যাক্টিভেশন কোড দিয়ে চালু করুন
                  </Text>
                  <Text allowFontScaling={false} style={styles.redeemSub}>
                    অ্যাডমিনের কাছ থেকে পাওয়া আপনার অ্যাকাউন্টের বিশেষ Activation Key নিচে পেস্ট করুন:
                  </Text>
                  <View style={styles.accountCodeBanner}>
                    <Text allowFontScaling={false} style={styles.accountCodeBannerText}>
                      আপনার Account Code: {focusStats.accountCode}
                    </Text>
                  </View>
                  <TextInput
                    style={[
                      styles.storeInput,
                      { textAlign: 'center', fontWeight: '800', letterSpacing: 0.8 },
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
                    <Text allowFontScaling={false} style={styles.submitPaymentBtnText}>
                      অ্যাক্টিভেট করুন
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {storeTab === 'HISTORY' && (
                <View style={{ paddingVertical: 6 }}>
                  <View style={styles.historyRefreshRow}>
                    <Text
                      allowFontScaling={false}
                      style={[styles.redeemSub, { flex: 1, marginBottom: 0 }]}
                    >
                      ৬০ দিনের পুরনো হিস্ট্রি স্বয়ংক্রিয়ভাবে ক্লিন হয়ে যায়।
                    </Text>
                    <TouchableOpacity
                      style={styles.miniRefreshBtn}
                      onPress={handleManualCloudSync}
                    >
                      <Feather name="refresh-cw" size={12} color="#38BDF8" />
                      <Text allowFontScaling={false} style={styles.miniRefreshText}>
                        স্ট্যাটাস রিফ্রেশ
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {purchaseHistory.length === 0 ? (
                    <Text allowFontScaling={false} style={styles.emptyHistoryText}>
                      কোনো পেমেন্ট বা অ্যাক্টিভেশন হিস্ট্রি নেই।
                    </Text>
                  ) : (
                    purchaseHistory.map((item) => (
                      <View key={item.id} style={styles.historyItemRow}>
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text allowFontScaling={false} style={styles.historyItemTitle}>
                            {item.planTitle}
                          </Text>
                          <Text allowFontScaling={false} style={styles.historyItemMeta}>
                            ৳{item.amountBdt} • TrxID: {item.trxId}
                          </Text>
                          <Text allowFontScaling={false} style={styles.historyItemMeta}>
                            তারিখ: {new Date(item.createdAt).toLocaleString()}
                          </Text>
                        </View>
                        <View
                          style={[
                            styles.statusTag,
                            item.status === 'approved'
                              ? styles.statusApproved
                              : item.status === 'cancelled'
                              ? styles.statusCancelled
                              : styles.statusPending,
                          ]}
                        >
                          <Text allowFontScaling={false} style={styles.statusTagText}>
                            {item.status === 'approved'
                              ? 'Active ✅'
                              : item.status === 'cancelled'
                              ? 'Cancelled ❌'
                              : 'Pending ⏳'}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ===================================================================== */}
      {/* FINGERPRINT-PROTECTED SUPER ADMIN CONTROL PANEL (KEYBOARD SAFE)       */}
      {/* ===================================================================== */}
      <Modal
        visible={adminModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setAdminModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.sheetBackdrop}
        >
          <View
            style={[
              styles.sheetCard,
              { paddingBottom: Math.max(20, insets.bottom + 12) },
            ]}
          >
            <View style={styles.storeHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                <Ionicons name="finger-print" size={22} color="#38BDF8" />
                <Text
                  allowFontScaling={false}
                  numberOfLines={1}
                  style={styles.storeHeaderTitle}
                >
                  Toki Admin Control Panel
                </Text>
              </View>
              <TouchableOpacity
                style={styles.closeCircleBtn}
                onPress={() => setAdminModalVisible(false)}
              >
                <Ionicons name="close" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <View style={styles.storeTabsBar}>
              {(['KEYS', 'REQUESTS', 'SETTINGS', 'OTA'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.storeTabItem, adminTab === t && styles.storeTabItemActive]}
                  onPress={() => setAdminTab(t)}
                >
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={[styles.storeTabText, adminTab === t && styles.storeTabTextActive]}
                  >
                    {t === 'KEYS'
                      ? 'Key / Cancel'
                      : t === 'REQUESTS'
                      ? `Requests (${(adminConfig?.salesHistory || []).length})`
                      : t === 'SETTINGS'
                      ? 'পেমেন্ট/অ্যাডমিন'
                      : 'OTA Update'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 32 }}
            >
              {adminTab === 'KEYS' && (
                <View>
                  <Text allowFontScaling={false} style={styles.redeemTitle}>
                    ১. ইউজারের জন্য Activation Key তৈরি করুন
                  </Text>
                  <Text allowFontScaling={false} style={styles.redeemSub}>
                    ইউজারের Account Code (যেমন TK-XXXXXXXX) দিয়ে প্রো বা পাসের কোড জেনারেট করুন।
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
                          allowFontScaling={false}
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
                    <Text allowFontScaling={false} style={styles.submitPaymentBtnText}>
                      Generate Cryptographic Key
                    </Text>
                  </TouchableOpacity>

                  {generatedAdminKey ? (
                    <View style={styles.generatedKeyCard}>
                      <Text allowFontScaling={false} style={styles.generatedKeyLabel}>
                        Generated Key ({targetPlanType}):
                      </Text>
                      <Text
                        selectable
                        allowFontScaling={false}
                        style={styles.generatedKeyValue}
                      >
                        {generatedAdminKey}
                      </Text>
                      <View
                        style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}
                      >
                        <TouchableOpacity
                          style={[styles.smallAdminBtn, { backgroundColor: '#38BDF8', flex: 1 }]}
                          onPress={() =>
                            Share.share({
                              message: `🎉 আপনার Toki ${targetPlanType} Activation Key:\n${generatedAdminKey}\n\nToki অ্যাপের Profile -> Redeem Key অপশনে বসিয়ে অ্যাক্টিভ করুন!`,
                            }).catch(() => {})
                          }
                        >
                          <Ionicons name="share-social" size={14} color="#0F172A" />
                          <Text allowFontScaling={false} style={styles.smallAdminBtnText}>
                            Share / Copy Key
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}

                  <View style={[styles.divider, { marginVertical: 18 }]} />

                  {/* Direct Subscription / Pass Cancel by Account Code */}
                  <Text allowFontScaling={false} style={[styles.redeemTitle, { color: '#F87171' }]}>
                    ২. ইউজারের সাবস্ক্রিপশন / পাস বাতিল করুন (Cancel / Revoke)
                  </Text>
                  <Text allowFontScaling={false} style={styles.redeemSub}>
                    ভুল করে কারো প্রো বা পাস চালু হয়ে গেলে তার Account Code (যেমন TK-XXXXXXXX) লিখে নিচে চাপলে তার ফোন থেকে প্রো ও পাস সাথে সাথে বাতিল হয়ে ফ্রি মোডে ফিরে যাবে।
                  </Text>
                  <TextInput
                    style={styles.storeInput}
                    placeholder="User Account Code (যেমন: TK-8F92A1C0)"
                    placeholderTextColor="#64748B"
                    autoCapitalize="characters"
                    value={revokeAccountCodeInput}
                    onChangeText={setRevokeAccountCodeInput}
                  />
                  <TouchableOpacity
                    style={[styles.submitPaymentBtn, { backgroundColor: '#EF4444' }]}
                    onPress={() => void handleCancelOrRevokeRequest(revokeAccountCodeInput)}
                  >
                    <Ionicons name="close-circle" size={18} color="#FFFFFF" />
                    <Text
                      allowFontScaling={false}
                      style={[styles.submitPaymentBtnText, { color: '#FFFFFF' }]}
                    >
                      Cancel / Revoke User Subscription
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {adminTab === 'REQUESTS' && (
                <View>
                  <View style={styles.historyRefreshRow}>
                    <Text
                      allowFontScaling={false}
                      style={[styles.redeemTitle, { flex: 1, marginBottom: 0 }]}
                    >
                      সকল পেমেন্ট রিকোয়েস্ট (৬০ দিন অটো-ক্লিন)
                    </Text>
                    <TouchableOpacity
                      style={styles.miniRefreshBtn}
                      onPress={() => void loadAllProfileData(true)}
                    >
                      <Feather name="refresh-cw" size={12} color="#38BDF8" />
                      <Text allowFontScaling={false} style={styles.miniRefreshText}>
                        রিফ্রেশ
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {(adminConfig?.salesHistory || []).length === 0 ? (
                    <Text allowFontScaling={false} style={styles.emptyHistoryText}>
                      এখনো কোনো রিকোয়েস্ট আসেনি।
                    </Text>
                  ) : (
                    (adminConfig?.salesHistory || []).map((req) => (
                      <View key={req.id} style={styles.adminReqCard}>
                        <View
                          style={{
                            flexDirection: 'row',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginBottom: 4,
                          }}
                        >
                          <Text
                            allowFontScaling={false}
                            numberOfLines={1}
                            style={[styles.historyItemTitle, { flex: 1, paddingRight: 8 }]}
                          >
                            {req.planTitle} (৳{req.amountBdt})
                          </Text>
                          <Text
                            allowFontScaling={false}
                            style={{
                              color:
                                req.status === 'approved'
                                  ? '#34D399'
                                  : req.status === 'cancelled'
                                  ? '#F87171'
                                  : '#FBBF24',
                              fontWeight: '900',
                              fontSize: 11,
                            }}
                          >
                            {req.status === 'approved'
                              ? 'APPROVED ✅'
                              : req.status === 'cancelled'
                              ? 'CANCELLED ❌'
                              : 'PENDING ⏳'}
                          </Text>
                        </View>
                        <Text allowFontScaling={false} style={styles.historyItemMeta}>
                          Email: {req.userEmail} • Code: {req.accountCode}
                        </Text>
                        <Text allowFontScaling={false} style={styles.historyItemMeta}>
                          TrxID: {req.trxId} • Sender: {req.senderPhone}
                        </Text>
                        {req.activationKey ? (
                          <Text
                            selectable
                            allowFontScaling={false}
                            style={[styles.historyItemMeta, { color: '#38BDF8', fontWeight: '700' }]}
                          >
                            Key: {req.activationKey}
                          </Text>
                        ) : null}

                        {/* Separate Action Buttons: 1. Approve Only | 2. Send WhatsApp | 3. Cancel/Revoke */}
                        <View style={styles.adminActionBtnsRow}>
                          {req.status !== 'approved' && (
                            <TouchableOpacity
                              style={[styles.smallAdminBtn, { backgroundColor: '#10B981' }]}
                              onPress={() => void handleApproveRequestOnly(req)}
                            >
                              <Ionicons name="checkmark-circle" size={14} color="#0F172A" />
                              <Text allowFontScaling={false} style={styles.smallAdminBtnText}>
                                Approve / Active করুন
                              </Text>
                            </TouchableOpacity>
                          )}

                          <TouchableOpacity
                            style={[
                              styles.smallAdminBtn,
                              {
                                backgroundColor: 'rgba(56, 189, 248, 0.2)',
                                borderWidth: 1,
                                borderColor: '#38BDF8',
                              },
                            ]}
                            onPress={() => void handleSendKeyOnWhatsApp(req)}
                          >
                            <Ionicons name="logo-whatsapp" size={14} color="#38BDF8" />
                            <Text
                              allowFontScaling={false}
                              style={[styles.smallAdminBtnText, { color: '#38BDF8' }]}
                            >
                              WhatsApp-এ কোড পাঠান
                            </Text>
                          </TouchableOpacity>

                          {req.status !== 'cancelled' && (
                            <TouchableOpacity
                              style={[
                                styles.smallAdminBtn,
                                {
                                  backgroundColor: 'rgba(239, 68, 68, 0.18)',
                                  borderWidth: 1,
                                  borderColor: '#EF4444',
                                },
                              ]}
                              onPress={() => void handleCancelOrRevokeRequest(req)}
                            >
                              <Ionicons name="close-circle" size={14} color="#F87171" />
                              <Text
                                allowFontScaling={false}
                                style={[styles.smallAdminBtnText, { color: '#F87171' }]}
                              >
                                Cancel / Revoke
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    ))
                  )}
                </View>
              )}

              {adminTab === 'SETTINGS' && (
                <View>
                  <Text allowFontScaling={false} style={styles.redeemTitle}>
                    পেমেন্ট নাম্বার ও প্যাকেজ মূল্য পরিবর্তন
                  </Text>
                  <Text allowFontScaling={false} style={styles.inputLabel}>
                    অ্যাডমিন WhatsApp নাম্বার:
                  </Text>
                  <TextInput
                    style={styles.storeInput}
                    value={editWhatsapp}
                    onChangeText={setEditWhatsapp}
                    keyboardType="phone-pad"
                  />

                  <Text allowFontScaling={false} style={styles.inputLabel}>
                    বিকাশ / নগদ পেমেন্ট নাম্বার:
                  </Text>
                  <TextInput
                    style={styles.storeInput}
                    value={editBkash}
                    onChangeText={setEditBkash}
                    keyboardType="phone-pad"
                  />

                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text allowFontScaling={false} style={styles.inputLabel}>
                        ১ মাস প্রো (৳):
                      </Text>
                      <TextInput
                        style={styles.storeInput}
                        value={editPricePro30}
                        onChangeText={setEditPricePro30}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text allowFontScaling={false} style={styles.inputLabel}>
                        ৬ মাস প্রো (৳):
                      </Text>
                      <TextInput
                        style={styles.storeInput}
                        value={editPricePro180}
                        onChangeText={setEditPricePro180}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text allowFontScaling={false} style={styles.inputLabel}>
                        ১ বছর প্রো (৳):
                      </Text>
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
                      <Text allowFontScaling={false} style={styles.inputLabel}>
                        ১টি পাস (৳):
                      </Text>
                      <TextInput
                        style={styles.storeInput}
                        value={editPricePass1}
                        onChangeText={setEditPricePass1}
                        keyboardType="numeric"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text allowFontScaling={false} style={styles.inputLabel}>
                        ৩টি পাস প্যাক (৳):
                      </Text>
                      <TextInput
                        style={styles.storeInput}
                        value={editPricePass3}
                        onChangeText={setEditPricePass3}
                        keyboardType="numeric"
                      />
                    </View>
                  </View>

                  <View style={[styles.divider, { marginVertical: 12 }]} />

                  <Text allowFontScaling={false} style={styles.redeemTitle}>
                    🎁 নতুন ইউজার ৭ দিনের ফ্রি Pro ট্রায়াল কন্ট্রোল
                  </Text>
                  <Text allowFontScaling={false} style={styles.redeemSub}>
                    এখন পর্যন্ত ফ্রি ট্রায়াল নিয়েছে: {(adminConfig?.claimedTrialDeviceIds || []).length} / {editMaxTrialUsersCap} টি ডিভাইস (Hardware ID লকড)
                  </Text>

                  <TouchableOpacity
                    style={styles.forceUpdateToggle}
                    onPress={() => setEditFreeTrialEnabled(!editFreeTrialEnabled)}
                  >
                    <MaterialCommunityIcons
                      name="gift-outline"
                      size={18}
                      color={editFreeTrialEnabled ? "#34D399" : "#94A3B8"}
                    />
                    <Text allowFontScaling={false} style={styles.forceUpdateText}>
                      নতুন ইউজারদের অটো ৭ দিন ফ্রি Pro ট্রায়াল: {editFreeTrialEnabled ? "চালু আছে ✅" : "বন্ধ আছে 🚫"}
                    </Text>
                  </TouchableOpacity>

                  <Text allowFontScaling={false} style={styles.inputLabel}>
                    সর্বোচ্চ কতজন নতুন ইউজার অটো ৭ দিন ফ্রি ট্রায়াল পাবে (ডিফল্ট: 500):
                  </Text>
                  <TextInput
                    style={styles.storeInput}
                    value={editMaxTrialUsersCap}
                    onChangeText={setEditMaxTrialUsersCap}
                    keyboardType="numeric"
                  />

                  <TouchableOpacity
                    style={styles.submitPaymentBtn}
                    onPress={handleSaveAdminSettings}
                  >
                    <Ionicons name="settings" size={18} color="#0F172A" />
                    <Text allowFontScaling={false} style={styles.submitPaymentBtnText}>
                      সেটিংস সেভ করুন (Fingerprint)
                    </Text>
                  </TouchableOpacity>

                  <View style={[styles.divider, { marginVertical: 16 }]} />

                  <Text allowFontScaling={false} style={styles.redeemTitle}>
                    অ্যাডমিন ইমেইল তালিকা (Admin Access List)
                  </Text>
                  <Text allowFontScaling={false} style={styles.redeemSub}>
                    শুধুমাত্র Super Admin ({SUPER_ADMIN_EMAIL}) বাই-ডিফল্ট ফ্রি প্রো পাবেন; অন্য অ্যাডমিনরা শুধু প্যানেল পরিচালনা করতে পারবেন।
                  </Text>
                  {(adminConfig?.adminEmails || [SUPER_ADMIN_EMAIL]).map((email) => (
                    <View key={email} style={styles.adminEmailRow}>
                      <Text
                        allowFontScaling={false}
                        numberOfLines={1}
                        style={[styles.adminEmailText, { flex: 1, paddingRight: 8 }]}
                      >
                        {email}
                      </Text>
                      {email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase() ? (
                        <Text allowFontScaling={false} style={styles.superAdminTag}>
                          Super Admin 👑
                        </Text>
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
                  <Text allowFontScaling={false} style={styles.redeemTitle}>
                    ইন-অ্যাপ আপডেট নোটিফায়ার (Play Store ছাড়া আপডেট)
                  </Text>
                  <Text allowFontScaling={false} style={styles.redeemSub}>
                    নতুন APK বিল্ড করে Google Drive / GitHub লিংক এখানে বসিয়ে ভার্সন বাড়িয়ে দিলেই সব ইউজারের ফোনে নতুন আপডেট পপ-আপ চলে যাবে!
                  </Text>

                  <Text allowFontScaling={false} style={styles.inputLabel}>
                    নতুন ভার্সন নাম্বার (বর্তমান: {CURRENT_APP_VERSION}):
                  </Text>
                  <TextInput
                    style={styles.storeInput}
                    placeholder="যেমন: 2.2.0"
                    placeholderTextColor="#64748B"
                    value={editOtaVersion}
                    onChangeText={setEditOtaVersion}
                  />

                  <Text allowFontScaling={false} style={styles.inputLabel}>
                    নতুন APK ডাউনলোড লিংক (Drive/Website):
                  </Text>
                  <TextInput
                    style={styles.storeInput}
                    placeholder="https://drive.google.com/..."
                    placeholderTextColor="#64748B"
                    value={editOtaUrl}
                    onChangeText={setEditOtaUrl}
                    autoCapitalize="none"
                  />

                  <Text allowFontScaling={false} style={styles.inputLabel}>
                    নতুন আপডেটে কী কী থাকছে (Release Notes):
                  </Text>
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
                    <Text allowFontScaling={false} style={styles.forceUpdateText}>
                      Force Update (ইউজারকে অবশ্যই আপডেট করতে হবে):{' '}
                      {editOtaForce ? 'হ্যাঁ ✅' : 'না'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.submitPaymentBtn}
                    onPress={handleSaveAdminSettings}
                  >
                    <Ionicons name="send" size={18} color="#0F172A" />
                    <Text allowFontScaling={false} style={styles.submitPaymentBtnText}>
                      আপডেট অ্যালার্ট পাবলিশ করুন
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
            <Text allowFontScaling={false} style={styles.modalTitle}>
              {feedbackModal.title}
            </Text>
            <Text allowFontScaling={false} style={styles.modalSub}>
              {feedbackModal.message}
            </Text>
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
              <Text
                allowFontScaling={false}
                style={[styles.submitPaymentBtnText, { color: '#FFFFFF' }]}
              >
                ঠিক আছে
              </Text>
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
            <Text allowFontScaling={false} style={styles.modalTitle}>
              অ্যাকাউন্ট লগআউট করবেন?
            </Text>
            <Text allowFontScaling={false} style={styles.modalSub}>
              লগআউট করার আগে আপনার অফলাইনের সব সেশন, কন্টাক্ট, শিডিউল ও প্রো স্ট্যাটাস ক্লাউডে ব্যাকআপ করে নেওয়া হবে।
            </Text>
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setLogoutModalVisible(false)}
                disabled={loggingOut}
              >
                <Text allowFontScaling={false} style={styles.modalCancelText}>
                  বাতিল
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={handleLogoutConfirm}
                disabled={loggingOut}
              >
                {loggingOut ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text allowFontScaling={false} style={styles.modalConfirmText}>
                    লগআউট
                  </Text>
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
  scrollContent: { paddingHorizontal: 16 },
  heroCard: {
    borderRadius: 28,
    padding: 18,
    borderWidth: 1,
    borderColor: '#334155',
    marginBottom: 14,
  },
  heroCardPro: {
    borderColor: 'rgba(245, 158, 11, 0.55)',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 8,
  },
  tierBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    flexShrink: 1,
  },
  tierBadgePro: {
    backgroundColor: 'rgba(245, 158, 11, 0.16)',
    borderColor: 'rgba(245, 158, 11, 0.45)',
  },
  tierBadgeFree: {
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderColor: '#334155',
  },
  tierBadgeText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  syncButtonPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  syncButtonText: { color: '#38BDF8', fontSize: 11, fontWeight: '800' },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  avatarContainer: { position: 'relative' },
  avatarImage: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2.5,
    borderColor: '#38BDF8',
  },
  avatarFallback: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#0284C7',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2.5,
    borderColor: '#38BDF8',
  },
  avatarFallbackText: { color: '#FFFFFF', fontSize: 26, fontWeight: '900' },
  onlineBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#34D399',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#0F172A',
  },
  identityTextCol: { flex: 1 },
  userName: { color: '#F8FAFC', fontSize: 18, fontWeight: '900', marginBottom: 2 },
  userEmail: { color: '#94A3B8', fontSize: 12, marginBottom: 8 },
  accountCodePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
  },
  accountCodeText: { color: '#38BDF8', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  proMainCtaBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FBBF24',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  proMainCtaBtnActive: {
    backgroundColor: '#34D399',
  },
  proMainCtaText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '900',
    flex: 1,
    textAlign: 'center',
  },
  adminAccessBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    backgroundColor: 'rgba(124, 45, 18, 0.65)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.5)',
  },
  adminAccessBtnText: {
    color: '#FEF3C7',
    fontSize: 12,
    fontWeight: '800',
    flex: 1,
  },
  quickStoreRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  quickPassBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#131C31',
    padding: 12,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  quickPassIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickPassTitle: { color: '#F8FAFC', fontSize: 12, fontWeight: '800' },
  quickPassSub: { color: '#34D399', fontSize: 11, marginTop: 1, fontWeight: '700' },
  quickRedeemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#131C31',
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  quickRedeemText: { color: '#38BDF8', fontSize: 12, fontWeight: '800' },
  streakRewardCard: {
    backgroundColor: '#131C31',
    borderRadius: 20,
    padding: 15,
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.35)',
    marginBottom: 18,
  },
  streakRewardTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  streakRewardBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  streakRewardTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '800', flex: 1 },
  streakCounterPill: {
    color: '#FB923C',
    fontSize: 12,
    fontWeight: '900',
    backgroundColor: 'rgba(249, 115, 22, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  streakRewardSub: { color: '#94A3B8', fontSize: 11, marginTop: 3, lineHeight: 16 },
  progressTrack: {
    height: 8,
    backgroundColor: '#0B1120',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: '#F97316', borderRadius: 999 },
  sectionTitle: {
    color: '#E2E8F0',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 10,
    marginLeft: 4,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 18,
  },
  statBox: {
    width: '48.2%',
    backgroundColor: '#131C31',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  statIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: { color: '#F8FAFC', fontSize: 18, fontWeight: '900' },
  statLabel: { color: '#94A3B8', fontSize: 11, marginTop: 2, fontWeight: '600' },
  heatmapCard: {
    backgroundColor: '#131C31',
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 18,
  },
  heatmapHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  heatmapTitle: { color: '#F8FAFC', fontSize: 15, fontWeight: '800' },
  heatmapSub: { color: '#94A3B8', fontSize: 11, marginTop: 2, lineHeight: 15 },
  heatmapBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  heatmapBadgeText: { color: '#34D399', fontSize: 11, fontWeight: '900' },
  ghGraphContainer: {
    flexDirection: 'row',
    backgroundColor: '#0B1120',
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1E293B',
    alignItems: 'center',
  },
  ghDayLabelsCol: {
    marginRight: 8,
    justifyContent: 'space-between',
    gap: 4,
  },
  ghDayLabelCell: {
    height: 24,
    justifyContent: 'center',
  },
  ghDayLabelText: {
    color: '#64748B',
    fontSize: 9,
    fontWeight: '800',
  },
  ghColumnsArea: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  ghWeekCol: {
    flex: 1,
    gap: 4,
  },
  ghSquareCell: {
    height: 24,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghSquareDateNum: {
    fontSize: 8.5,
    fontWeight: '800',
  },
  ghSelectedDayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0B1120',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginTop: 10,
    gap: 8,
  },
  ghSelectedDayText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '800',
    flex: 1,
  },
  ghSelectedMinsText: {
    fontSize: 11,
    fontWeight: '900',
  },
  heatmapLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
    marginTop: 10,
  },
  legendBox: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendText: { color: '#64748B', fontSize: 10, fontWeight: '700', marginHorizontal: 2 },
  summaryListCard: {
    backgroundColor: '#131C31',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 18,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  historyHeaderTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '800', flex: 1 },
  viewAllText: { color: '#38BDF8', fontSize: 12, fontWeight: '800' },
  emptyHistoryText: { color: '#64748B', fontSize: 12, paddingVertical: 10, textAlign: 'center' },
  historyItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
  },
  historyItemTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' },
  historyItemMeta: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  statusTag: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  statusApproved: { backgroundColor: 'rgba(16, 185, 129, 0.18)' },
  statusCancelled: { backgroundColor: 'rgba(239, 68, 68, 0.18)' },
  statusPending: { backgroundColor: 'rgba(245, 158, 11, 0.18)' },
  statusTagText: { color: '#F8FAFC', fontSize: 10, fontWeight: '800' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 },
  summaryIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryRowTitle: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' },
  summaryRowSub: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  summaryBadge: { color: '#38BDF8', fontSize: 13, fontWeight: '900' },
  divider: { height: 1, backgroundColor: '#1E293B', marginVertical: 4 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    paddingVertical: 14,
    borderRadius: 18,
  },
  logoutBtnText: { color: '#F87171', fontSize: 14, fontWeight: '800' },
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    justifyContent: 'flex-end',
  },
  sheetCard: {
    width: '100%',
    maxHeight: '92%',
    backgroundColor: '#131C31',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 18,
    borderTopWidth: 1,
    borderColor: '#334155',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#131C31',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  storeHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    gap: 8,
  },
  storeHeaderTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: '900', flex: 1 },
  closeCircleBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  storeTabsBar: {
    flexDirection: 'row',
    backgroundColor: '#0B1120',
    borderRadius: 14,
    padding: 4,
    marginBottom: 12,
    gap: 4,
  },
  storeTabItem: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storeTabItemActive: { backgroundColor: '#38BDF8' },
  storeTabText: { color: '#94A3B8', fontSize: 11, fontWeight: '800' },
  storeTabTextActive: { color: '#0F172A' },
  proComparisonBox: {
    backgroundColor: '#0B1120',
    borderRadius: 16,
    padding: 13,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  proComparisonTitle: { color: '#FBBF24', fontSize: 12, fontWeight: '800', marginBottom: 6 },
  proComparisonItem: { color: '#CBD5E1', fontSize: 11, lineHeight: 18 },
  planOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0B1120',
    borderRadius: 16,
    padding: 13,
    marginBottom: 9,
    borderWidth: 1.5,
    borderColor: '#1E293B',
  },
  planOptionCardSelected: {
    borderColor: '#FBBF24',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
  },
  planBadgeText: { color: '#FBBF24', fontSize: 9, fontWeight: '900', marginBottom: 2 },
  planTitleText: { color: '#F8FAFC', fontSize: 13, fontWeight: '800' },
  planSubText: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  planPriceText: { color: '#38BDF8', fontSize: 18, fontWeight: '900', marginLeft: 8 },
  paymentInstructionBox: {
    backgroundColor: '#0B1120',
    borderRadius: 16,
    padding: 14,
    marginTop: 4,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  paymentStepHeader: { color: '#F8FAFC', fontSize: 13, fontWeight: '800', marginBottom: 6 },
  paymentStepText: { color: '#CBD5E1', fontSize: 12, lineHeight: 18, marginBottom: 8 },
  storeInput: {
    backgroundColor: '#131C31',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#F8FAFC',
    paddingHorizontal: 13,
    paddingVertical: 10,
    fontSize: 13,
    marginBottom: 10,
  },
  submitPaymentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FBBF24',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginTop: 2,
  },
  submitPaymentBtnText: { color: '#0F172A', fontSize: 13, fontWeight: '900' },
  submitWhatsAppBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 14,
    marginTop: 8,
  },
  submitWhatsAppBtnText: { color: '#34D399', fontSize: 12, fontWeight: '800' },
  redeemBox: { paddingVertical: 6 },
  redeemTitle: { color: '#F8FAFC', fontSize: 14, fontWeight: '800', marginBottom: 4 },
  redeemSub: { color: '#94A3B8', fontSize: 11, lineHeight: 17, marginBottom: 10 },
  accountCodeBanner: {
    backgroundColor: '#0B1120',
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  accountCodeBannerText: { color: '#38BDF8', fontSize: 12, fontWeight: '800' },
  historyRefreshRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  miniRefreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.35)',
  },
  miniRefreshText: { color: '#38BDF8', fontSize: 11, fontWeight: '800' },
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
    backgroundColor: '#0B1120',
    borderWidth: 1,
    borderColor: '#334155',
  },
  adminPlanChipActive: {
    backgroundColor: '#38BDF8',
    borderColor: '#38BDF8',
  },
  adminPlanChipText: { color: '#E2E8F0', fontSize: 12, fontWeight: '800' },
  generatedKeyCard: {
    backgroundColor: '#0B1120',
    padding: 14,
    borderRadius: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  generatedKeyLabel: { color: '#94A3B8', fontSize: 11, marginBottom: 4 },
  generatedKeyValue: { color: '#34D399', fontSize: 15, fontWeight: '900', letterSpacing: 0.8 },
  adminActionBtnsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  smallAdminBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  smallAdminBtnText: { color: '#0F172A', fontSize: 11, fontWeight: '800' },
  adminReqCard: {
    backgroundColor: '#0B1120',
    borderRadius: 16,
    padding: 13,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  inputLabel: { color: '#CBD5E1', fontSize: 11, fontWeight: '700', marginBottom: 4 },
  adminEmailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0B1120',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 6,
  },
  adminEmailText: { color: '#F8FAFC', fontSize: 12, fontWeight: '700' },
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
    backgroundColor: '#0B1120',
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  forceUpdateText: { color: '#E2E8F0', fontSize: 12, fontWeight: '700', flex: 1 },
  modalIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    alignSelf: 'center',
  },
  modalTitle: {
    color: '#F8FAFC',
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  modalSub: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: 18,
  },
  modalActionRow: { flexDirection: 'row', gap: 12, width: '100%' },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#0B1120',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
  },
  modalCancelText: { color: '#CBD5E1', fontSize: 13, fontWeight: '700' },
  modalConfirmBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    alignItems: 'center',
  },
  modalConfirmText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});
