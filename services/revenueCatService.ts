// RevenueCat service for managing in-app purchases
// Uses react-native-purchases SDK for native Apple IAP
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';

const supabase = getSupabaseClient();

const RC_KEY_CACHE = 'ts_rc_ios_key';
const ENTITLEMENT_ID = 'premium';
const PRODUCT_ID = 'tradesight_pro_monthlyy';

// Session 144 — second RevenueCat offering for the ad-supported tier.
//   • Offering identifier in the RC dashboard: `basic_monthly`
//   • Product ID (App Store Connect / RC): `sight_pro_monthly_999`
// The original Pro monthly offering (current offering, product
// `tradesight_pro_monthlyy`) remains the ad-free $9.99 tier and is UNCHANGED.
export const BASIC_MONTHLY_OFFERING_ID = 'basic_monthly';
export const BASIC_MONTHLY_PRODUCT_ID = 'sight_pro_monthly_999';

let rcInitialized = false;
let rcModule: any = null;

// Dynamically import RevenueCat to handle cases where it might not be available
async function getRCModule() {
  if (rcModule) return rcModule;
  try {
    rcModule = await import('react-native-purchases');
    console.log('[RC] Module loaded successfully, keys:', Object.keys(rcModule).join(', '));
    return rcModule;
  } catch (e) {
    console.log('[RC] react-native-purchases not available:', e);
    return null;
  }
}

// Pre-warm customer info cache so purchase confirmation is instant
export async function preWarmEntitlements(): Promise<void> {
  const Purchases = await getRCModule();
  if (!Purchases?.default || !rcInitialized) return;
  try {
    await Purchases.default.getCustomerInfo();
  } catch {}
}

// Fetch the RevenueCat API key from the edge function
async function fetchRCKey(): Promise<string | null> {
  // Check cache first
  try {
    const cached = await AsyncStorage.getItem(RC_KEY_CACHE);
    if (cached && (cached.startsWith('appl_') || cached.startsWith('test_'))) {
      console.log('[RC] Using cached API key');
      return cached;
    }
  } catch {}

  try {
    console.log('[RC] Fetching API key from edge function...');
    const { data, error } = await supabase.functions.invoke('get-rc-config', {});
    console.log('[RC] Edge function response:', JSON.stringify({ data, error: error?.message }));
    if (error || !data?.ios_key) {
      console.log('[RC] No API key returned from edge function');
      return null;
    }
    const key = data.ios_key;
    if (key && (key.startsWith('appl_') || key.startsWith('test_'))) {
      await AsyncStorage.setItem(RC_KEY_CACHE, key);
      console.log('[RC] API key cached successfully');
      return key;
    }
    console.log('[RC] API key format invalid, expected appl_ or test_ prefix:', key?.substring(0, 10));
    return null;
  } catch (e) {
    console.log('[RC] Failed to fetch API key:', e);
    return null;
  }
}

// Initialize RevenueCat SDK
export async function initRevenueCat(userId?: string): Promise<boolean> {
  if (rcInitialized) {
    console.log('[RC] Already initialized');
    return true;
  }
  if (Platform.OS === 'web') {
    console.log('[RC] Skipping init on web platform');
    return false;
  }

  const Purchases = await getRCModule();
  if (!Purchases?.default) {
    console.log('[RC] Purchases module not available. Ensure react-native-purchases is installed and linked.');
    return false;
  }

  const apiKey = await fetchRCKey();
  if (!apiKey) {
    console.log('[RC] No API key available. Check that REVENUECAT_IOS_API_KEY is set in Edge Function secrets (Cloud Dashboard > Secrets).');
    return false;
  }

  try {
    // Set debug log level for troubleshooting
    if (Purchases.LOG_LEVEL) {
      Purchases.default.setLogLevel(Purchases.LOG_LEVEL.DEBUG);
    }
    
    console.log('[RC] Configuring with key:', apiKey.substring(0, 10) + '...', 'userId:', userId);
    await Purchases.default.configure({ apiKey, appUserID: userId ?? undefined });
    
    rcInitialized = true;
    console.log('[RC] Initialized successfully');
    return true;
  } catch (e) {
    console.log('[RC] Init failed:', e);
    // Reset module so it can be re-tried
    rcModule = null;
    return false;
  }
}

// Log in a user to RevenueCat (call after auth)
export async function loginRC(userId: string): Promise<void> {
  const Purchases = await getRCModule();
  if (!Purchases?.default || !rcInitialized) return;
  try {
    await Purchases.default.logIn(userId);
  } catch (e) {
    console.log('[RC] Login failed:', e);
  }
}

// Log out from RevenueCat
export async function logoutRC(): Promise<void> {
  const Purchases = await getRCModule();
  if (!Purchases?.default || !rcInitialized) return;
  try {
    await Purchases.default.logOut();
  } catch (e) {
    console.log('[RC] Logout failed:', e);
  }
}

// Check if user has active premium entitlement
export async function checkRCSubscription(): Promise<{
  isSubscribed: boolean;
  expirationDate: string | null;
  willRenew: boolean;
  productId: string | null;
}> {
  const Purchases = await getRCModule();
  if (!Purchases?.default || !rcInitialized) {
    return { isSubscribed: false, expirationDate: null, willRenew: false, productId: null };
  }

  try {
    const customerInfo = await Purchases.default.getCustomerInfo();
    const entitlement = customerInfo.entitlements?.active?.[ENTITLEMENT_ID];
    
    if (entitlement) {
      return {
        isSubscribed: true,
        expirationDate: entitlement.expirationDate ?? null,
        willRenew: entitlement.willRenew ?? true,
        productId: entitlement.productIdentifier ?? null,
      };
    }
    return { isSubscribed: false, expirationDate: null, willRenew: false, productId: null };
  } catch (e) {
    console.log('[RC] Check subscription failed:', e);
    return { isSubscribed: false, expirationDate: null, willRenew: false, productId: null };
  }
}

// Get available offerings (products/prices)
export interface RCPackage {
  identifier: string;
  productId: string;
  title: string;
  description: string;
  priceString: string;
  price: number;
  introPrice?: {
    priceString: string;
    price: number;
    periodUnit: string;
    periodNumber: number;
    cycles: number;
  } | null;
  packageType: string;
}

function mapPackage(pkg: any): RCPackage {
  return {
    identifier: pkg.identifier,
    productId: pkg.product?.identifier ?? pkg.product?.productIdentifier ?? '',
    title: pkg.product?.title ?? 'Sight',
    description: pkg.product?.description ?? 'AI-powered trading intelligence',
    priceString: pkg.product?.priceString ?? '$17.99',
    price: pkg.product?.price ?? 17.99,
    introPrice: pkg.product?.introPrice ? {
      priceString: pkg.product.introPrice.priceString,
      price: pkg.product.introPrice.price,
      periodUnit: pkg.product.introPrice.periodUnit,
      periodNumber: pkg.product.introPrice.periodNumberOfUnits ?? 1,
      cycles: pkg.product.introPrice.cycles ?? 1,
    } : null,
    packageType: pkg.packageType ?? 'MONTHLY',
  };
}

export async function getOfferings(): Promise<{
  current: RCPackage[];
  introOffer: RCPackage | null;
  monthly: RCPackage | null;
  weekly: RCPackage | null;
  // Session 144 — separate handles for the ad-supported (basic_monthly)
  // and ad-free (current / Pro) monthly packages. `monthly` is retained as
  // an alias to `proMonthly` so all existing call-sites keep working
  // unchanged.
  proMonthly: RCPackage | null;
  basicMonthly: RCPackage | null;
}> {
  const Purchases = await getRCModule();
  if (!Purchases?.default || !rcInitialized) {
    return { current: [], introOffer: null, monthly: null, weekly: null, proMonthly: null, basicMonthly: null };
  }

  try {
    const offerings = await Purchases.default.getOfferings();
    const currentOffering = offerings.current;

    // Current offering = the ad-free Pro tier. UNCHANGED from prior behavior.
    const currentPackages: RCPackage[] = (currentOffering?.availablePackages || []).map(mapPackage);

    // Session 144/150 — pull the `basic_monthly` offering from the `all`
    // map so we can present the ad-supported plan alongside Pro. If that
    // offering is missing (e.g. not yet published in RC) we fall back to
    // searching EVERY offering (including the current one) for a package
    // whose product ID matches BASIC_MONTHLY_PRODUCT_ID. This guarantees
    // the ad-supported plan is available to purchase as long as the
    // product exists somewhere in the RC dashboard.
    const allOfferings = offerings.all ?? {};
    let basicOffering = allOfferings[BASIC_MONTHLY_OFFERING_ID] ?? null;
    let basicPackages: RCPackage[] = (basicOffering?.availablePackages || []).map(mapPackage);
    if (!basicPackages.find(p => p.productId === BASIC_MONTHLY_PRODUCT_ID)) {
      // Sweep every offering (current + all) looking for the product.
      const seen = new Set<string>();
      const sweepOfferings: any[] = [];
      if (currentOffering) sweepOfferings.push(currentOffering);
      for (const key of Object.keys(allOfferings)) {
        const off = allOfferings[key];
        if (off && !seen.has(off.identifier ?? key)) {
          seen.add(off.identifier ?? key);
          sweepOfferings.push(off);
        }
      }
      for (const off of sweepOfferings) {
        const pkgs = (off?.availablePackages || []).map(mapPackage);
        const found = pkgs.find((p: RCPackage) => p.productId === BASIC_MONTHLY_PRODUCT_ID);
        if (found) {
          basicOffering = off;
          basicPackages = pkgs;
          console.log('[RC] Found basic_monthly product in offering:', off.identifier);
          break;
        }
      }
    }

    // Pro monthly — search the current offering first (existing behavior),
    // matching by product ID → packageType → common identifiers.
    const proMonthly = currentPackages.find(p => p.productId === PRODUCT_ID)
      ?? currentPackages.find(p =>
        p.packageType === 'MONTHLY' ||
        p.identifier === '$rc_monthly' ||
        p.identifier === 'monthly'
      ) ?? currentPackages[0] ?? null;

    // Basic (ad-supported) monthly — search the `basic_monthly` offering by
    // product ID first, then by packageType/identifier. If the offering is
    // missing (e.g. not yet published in the RC dashboard) we return null
    // and the paywall gracefully falls back to hiding / disabling the tier.
    const basicMonthly = basicPackages.find(p => p.productId === BASIC_MONTHLY_PRODUCT_ID)
      ?? basicPackages.find(p =>
        p.packageType === 'MONTHLY' ||
        p.identifier === '$rc_monthly' ||
        p.identifier === 'monthly'
      ) ?? basicPackages[0] ?? null;

    // Weekly package — legacy behavior, still inside the current offering.
    const weekly = currentPackages.find(p => p.productId === 'tradesight_pro_weekly')
      ?? currentPackages.find(p =>
        p.packageType === 'WEEKLY' ||
        p.identifier === '$rc_weekly' ||
        p.identifier === 'weekly'
      ) ?? null;

    const introOffer = proMonthly?.introPrice ? proMonthly : null;

    console.log('[RC] Offerings resolved:', {
      proMonthly: proMonthly ? { id: proMonthly.identifier, product: proMonthly.productId, price: proMonthly.priceString } : null,
      basicMonthly: basicMonthly ? { id: basicMonthly.identifier, product: basicMonthly.productId, price: basicMonthly.priceString } : null,
      basicOfferingFound: !!basicOffering,
    });

    return {
      current: currentPackages,
      introOffer,
      monthly: proMonthly,
      weekly,
      proMonthly,
      basicMonthly,
    };
  } catch (e) {
    console.log('[RC] Get offerings failed:', e);
    return { current: [], introOffer: null, monthly: null, weekly: null, proMonthly: null, basicMonthly: null };
  }
}

// Session 150 — helper: resolves the basic offering. Because RC's SDK may
// only expose a package via a non-current offering, `purchasePackage` needs
// to look BEYOND `offerings.all[basic_monthly]` when the caller asked for
// the ad-supported tier. This helper centralises the sweep logic.
async function resolveBasicMonthlyOfferingAndPackage(): Promise<{ offering: any; pkg: any } | null> {
  const Purchases = await getRCModule();
  if (!Purchases?.default || !rcInitialized) return null;
  try {
    const offerings = await Purchases.default.getOfferings();
    const seen = new Set<string>();
    const sweep: any[] = [];
    if (offerings.all?.[BASIC_MONTHLY_OFFERING_ID]) sweep.push(offerings.all[BASIC_MONTHLY_OFFERING_ID]);
    if (offerings.current) sweep.push(offerings.current);
    for (const key of Object.keys(offerings.all ?? {})) {
      const off = offerings.all[key];
      if (off && !seen.has(off.identifier ?? key)) {
        seen.add(off.identifier ?? key);
        sweep.push(off);
      }
    }
    for (const off of sweep) {
      const pkgs = off?.availablePackages ?? [];
      const match = pkgs.find((p: any) => {
        const pid = p.product?.identifier ?? p.product?.productIdentifier;
        return pid === BASIC_MONTHLY_PRODUCT_ID;
      });
      if (match) return { offering: off, pkg: match };
    }
    return null;
  } catch (e) {
    console.log('[RC] resolveBasicMonthlyOfferingAndPackage failed:', e);
    return null;
  }
}

// Purchase a package — STRICT MATCHING ONLY.
//
// CRITICAL BUG FIX: The previous implementation had a dangerous fallback that
// looked up a hard-coded PRODUCT_ID (the monthly product) when the requested
// package identifier did not match exactly. This caused the weekly Subscribe
// button to silently launch the monthly purchase flow whenever the App Store
// Connect / RevenueCat package identifiers differed from the expected '$rc_weekly'.
//
// We now match only by:
//   1. Exact package identifier (e.g. '$rc_weekly', '$rc_monthly', or a custom id)
//   2. Exact productId (e.g. 'tradesight_pro_weekly', 'tradesight_pro_monthlyy')
//   3. packageType (WEEKLY / MONTHLY / ANNUAL etc.) derived from the identifier
//
// If none match we FAIL LOUDLY rather than silently selling a different tier.
export async function purchasePackage(
  packageIdentifier: string,
  offeringId?: string,
): Promise<{
  success: boolean;
  customerInfo: any;
  error?: string;
  cancelled?: boolean;
}> {
  const Purchases = await getRCModule();
  if (!Purchases?.default || !rcInitialized) {
    return { success: false, customerInfo: null, error: 'RevenueCat not initialized' };
  }

  try {
    const offerings = await Purchases.default.getOfferings();
    // Session 144/150 — when the caller specified the basic_monthly
    // offering, sweep every offering looking for the product id so the
    // purchase succeeds even if the RC dashboard hasn't set the basic
    // offering as the current one. Falls back to the ad-free Pro tier
    // only when no offering is provided (existing behavior UNCHANGED).
    let targetOffering: any = null;
    if (offeringId === BASIC_MONTHLY_OFFERING_ID) {
      const resolved = await resolveBasicMonthlyOfferingAndPackage();
      if (resolved) {
        targetOffering = resolved.offering;
      } else {
        return { success: false, customerInfo: null, error: 'The ad-supported plan is not available right now. Please try again shortly or choose Sight Pro.' };
      }
    } else if (offeringId) {
      targetOffering = offerings.all?.[offeringId] ?? offerings.current;
    } else {
      targetOffering = offerings.current;
    }
    if (!targetOffering) {
      return { success: false, customerInfo: null, error: `Offering ${offeringId ?? 'current'} unavailable` };
    }

    const all = targetOffering.availablePackages || [];
    console.log('[RC] purchasePackage using offering:', offeringId ?? '(current)');
    // Detailed logging for purchase diagnostics — helps catch tier mismatches in TestFlight logs
    console.log('[RC] purchasePackage requested:', packageIdentifier);
    console.log('[RC] available packages:', all.map((p: any) => ({
      identifier: p.identifier,
      packageType: p.packageType,
      productId: p.product?.identifier ?? p.product?.productIdentifier,
      priceString: p.product?.priceString,
    })));

    // Derive the desired tier from the identifier so we can match by packageType too.
    // Examples we want to recognize: '$rc_weekly', '$rc_monthly', 'weekly', 'monthly',
    // 'tradesight_pro_weekly', 'tradesight_pro_monthlyy'.
    const lcId = packageIdentifier.toLowerCase();
    const requestedType: string | null =
      lcId.includes('weekly') ? 'WEEKLY' :
      lcId.includes('monthly') ? 'MONTHLY' :
      lcId.includes('annual') || lcId.includes('yearly') ? 'ANNUAL' :
      null;

    // 1. exact identifier match
    let pkg = all.find((p: any) => p.identifier === packageIdentifier);
    // 2. exact productId match
    if (!pkg) {
      pkg = all.find((p: any) => (p.product?.identifier ?? p.product?.productIdentifier) === packageIdentifier);
    }
    // 3. packageType match — only if the requested tier is unambiguous
    if (!pkg && requestedType) {
      pkg = all.find((p: any) => (p.packageType || '').toString().toUpperCase() === requestedType);
    }

    if (!pkg) {
      console.log('[RC] No matching package found for', packageIdentifier, '- failing rather than substituting another tier');
      return {
        success: false,
        customerInfo: null,
        error: `Selected plan is unavailable. Please reopen the paywall and try again.`,
      };
    }

    // Sanity guard: if a tier was requested explicitly, refuse to sell a different one.
    const matchedType = (pkg.packageType || '').toString().toUpperCase();
    if (requestedType && matchedType && matchedType !== requestedType) {
      console.log('[RC] Refusing purchase: requested', requestedType, 'but matched package is', matchedType);
      return {
        success: false,
        customerInfo: null,
        error: `Selected plan mismatch. Please reopen the paywall and try again.`,
      };
    }

    console.log('[RC] Purchasing package:', {
      identifier: pkg.identifier,
      packageType: pkg.packageType,
      productId: pkg.product?.identifier ?? pkg.product?.productIdentifier,
    });

    const { customerInfo } = await Purchases.default.purchasePackage(pkg);
    const isActive = customerInfo.entitlements?.active?.[ENTITLEMENT_ID] !== undefined;

    return { success: isActive, customerInfo };
  } catch (e: any) {
    if (e.userCancelled) {
      return { success: false, customerInfo: null, cancelled: true };
    }
    return { success: false, customerInfo: null, error: e.message ?? 'Purchase failed' };
  }
}

// Restore purchases (for users who reinstall or switch devices)
export async function restorePurchases(): Promise<{
  success: boolean;
  isSubscribed: boolean;
  error?: string;
}> {
  const Purchases = await getRCModule();
  if (!Purchases?.default || !rcInitialized) {
    return { success: false, isSubscribed: false, error: 'RevenueCat not initialized' };
  }

  try {
    const customerInfo = await Purchases.default.restorePurchases();
    const isActive = customerInfo.entitlements?.active?.[ENTITLEMENT_ID] !== undefined;
    return { success: true, isSubscribed: isActive };
  } catch (e: any) {
    return { success: false, isSubscribed: false, error: e.message ?? 'Restore failed' };
  }
}

// Purchase with a promotional offer (for $7.99 intro deal)
export async function purchaseWithPromoOffer(packageIdentifier: string, promoOfferId: string): Promise<{
  success: boolean;
  customerInfo: any;
  error?: string;
  cancelled?: boolean;
}> {
  const Purchases = await getRCModule();
  if (!Purchases?.default || !rcInitialized) {
    return { success: false, customerInfo: null, error: 'RevenueCat not initialized' };
  }

  try {
    const offerings = await Purchases.default.getOfferings();
    const currentOffering = offerings.current;
    if (!currentOffering) {
      return { success: false, customerInfo: null, error: 'No offerings available' };
    }

    // Find package
    const pkg = currentOffering.availablePackages.find(
      (p: any) => p.identifier === packageIdentifier
    ) ?? currentOffering.availablePackages.find(
      (p: any) => (p.product?.identifier ?? p.product?.productIdentifier) === PRODUCT_ID
    ) ?? currentOffering.availablePackages[0];

    if (!pkg) {
      return { success: false, customerInfo: null, error: 'Package not found' };
    }

    // Try to get the promotional offer discount
    const product = pkg.product;
    let promoOffer = null;
    
    // Check if product has promotional offers (discounts)
    if (product?.discounts && product.discounts.length > 0) {
      const discount = product.discounts.find(
        (d: any) => d.identifier === promoOfferId
      ) ?? product.discounts[0];
      
      if (discount) {
        try {
          // Get promotional offer for signing
          promoOffer = await Purchases.default.getPromotionalOffer(
            product,
            discount
          );
        } catch (e) {
          console.log('[RC] Could not get promo offer, falling back to standard purchase:', e);
        }
      }
    }

    // Purchase with promo offer if available, otherwise standard
    let customerInfo;
    if (promoOffer) {
      const result = await Purchases.default.purchasePackage(pkg, { promotionalOffer: promoOffer });
      customerInfo = result.customerInfo;
    } else {
      // Promotional offer not available on this product - fall back to normal purchase
      // This will apply the introductory offer (3-day trial) if eligible
      const result = await Purchases.default.purchasePackage(pkg);
      customerInfo = result.customerInfo;
    }

    const isActive = customerInfo.entitlements?.active?.[ENTITLEMENT_ID] !== undefined;
    return { success: isActive, customerInfo };
  } catch (e: any) {
    if (e.userCancelled) {
      return { success: false, customerInfo: null, cancelled: true };
    }
    return { success: false, customerInfo: null, error: e.message ?? 'Purchase failed' };
  }
}

// Reset RC state (for logout) — also clears cached API key so fresh key is fetched
export async function resetRC() {
  rcInitialized = false;
  rcModule = null;
  try { await AsyncStorage.removeItem(RC_KEY_CACHE); } catch {}
}
