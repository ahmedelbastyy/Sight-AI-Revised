// Web-safe stub for revenueCatService
// react-native-purchases is iOS/Android only - on web it's not available
// This file is automatically selected by Metro/Webpack when bundling for web
// via the .web.ts / .native.ts platform extension convention.

export const BASIC_MONTHLY_OFFERING_ID = 'basic_monthly';
export const BASIC_MONTHLY_PRODUCT_ID = 'sight_pro_monthly_999';

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

export async function preWarmEntitlements(): Promise<void> {
  return;
}

export async function initRevenueCat(_userId?: string): Promise<boolean> {
  return false;
}

export async function loginRC(_userId: string): Promise<void> {
  return;
}

export async function logoutRC(): Promise<void> {
  return;
}

export async function checkRCSubscription(): Promise<{
  isSubscribed: boolean;
  expirationDate: string | null;
  willRenew: boolean;
  productId: string | null;
}> {
  return { isSubscribed: false, expirationDate: null, willRenew: false, productId: null };
}

export async function getOfferings(): Promise<{
  current: RCPackage[];
  introOffer: RCPackage | null;
  monthly: RCPackage | null;
  weekly: RCPackage | null;
  proMonthly: RCPackage | null;
  basicMonthly: RCPackage | null;
}> {
  return { current: [], introOffer: null, monthly: null, weekly: null, proMonthly: null, basicMonthly: null };
}

export async function purchasePackage(
  _packageIdentifier: string,
  _offeringId?: string,
): Promise<{
  success: boolean;
  customerInfo: any;
  error?: string;
  cancelled?: boolean;
}> {
  return { success: false, customerInfo: null, error: 'In-app purchases are only available in the mobile app.' };
}

export async function restorePurchases(): Promise<{
  success: boolean;
  isSubscribed: boolean;
  error?: string;
}> {
  return { success: false, isSubscribed: false, error: 'Restore is only available in the mobile app.' };
}

export async function purchaseWithPromoOffer(_packageIdentifier: string, _promoOfferId: string): Promise<{
  success: boolean;
  customerInfo: any;
  error?: string;
  cancelled?: boolean;
}> {
  return { success: false, customerInfo: null, error: 'In-app purchases are only available in the mobile app.' };
}

export async function resetRC(): Promise<void> {
  return;
}
