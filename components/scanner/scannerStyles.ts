import { StyleSheet, Dimensions } from 'react-native';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
export const FRAME_BASE_W = Math.min(SCREEN_W - 64, 320);
export const FRAME_BASE_H = Math.min(SCREEN_H * 0.36, 260);
export const SCREEN_WIDTH = SCREEN_W;
export const SCREEN_HEIGHT = SCREEN_H;
export const CORNER = 28;
export const CORNER_THICK = 4;

export const scannerStyles = StyleSheet.create({
  scannerRoot: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 8, zIndex: 10,
  },
  scannerTitle: { fontSize: 20, fontWeight: '800', color: '#FFF', letterSpacing: -0.3 },
  scannerSubtitle: { fontSize: 12, fontWeight: '500', color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  topBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#3B82F6' },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK, borderTopLeftRadius: 6 },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_THICK, borderRightWidth: CORNER_THICK, borderTopRightRadius: 6 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_THICK, borderLeftWidth: CORNER_THICK, borderBottomLeftRadius: 6 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_THICK, borderRightWidth: CORNER_THICK, borderBottomRightRadius: 6 },
  scanLine: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 3, borderRadius: 2,
    shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9, shadowRadius: 8, elevation: 6,
  },
  statusPillWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 5 },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1,
  },
  statusPillText: { fontSize: 12, fontWeight: '600' },
  previewBadgeWrap: { position: 'absolute', top: 84, left: 0, right: 0, alignItems: 'center', zIndex: 5 },
  previewBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,215,0,0.35)',
  },
  previewBadgeText: { fontSize: 11, fontWeight: '800', letterSpacing: 1.2, color: '#FFD700' },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingHorizontal: 32, zIndex: 10,
  },
  sideBtn: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  captureOuter: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  captureRing: {
    position: 'absolute', width: 84, height: 84, borderRadius: 42,
    borderWidth: 4, borderColor: 'rgba(255,255,255,0.9)',
  },
  captureInner: {
    width: 66, height: 66, borderRadius: 33,
    backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
  },
  permIconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(59,130,246,0.15)',
    borderWidth: 1, borderColor: 'rgba(59,130,246,0.3)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 22,
  },
  permTitle: {
    fontSize: 22, fontWeight: '800', color: '#FFFFFF',
    textAlign: 'center', marginBottom: 10, letterSpacing: -0.3,
  },
  permBody: {
    fontSize: 14, color: 'rgba(255,255,255,0.72)',
    textAlign: 'center', lineHeight: 22, marginBottom: 28, paddingHorizontal: 12,
  },
  permBtn: {
    height: 52, paddingHorizontal: 32, borderRadius: 12,
    backgroundColor: '#3B82F6', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#3B82F6', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  permBtnText: { fontSize: 16, fontWeight: '700', color: '#FFF' },
  resultHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 12,
  },
  resultTitle: { fontSize: 24, fontWeight: '700' },
  resultSubtitle: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  resetBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  chartPreview: { borderRadius: 16, overflow: 'hidden', borderWidth: 1, marginBottom: 16 },
  errorCard: { borderRadius: 16, padding: 20, borderWidth: 1, alignItems: 'center', marginBottom: 16 },
  tickerBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12,
    borderWidth: 1, marginBottom: 12,
  },
  signalCard: { borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 16 },
  signalIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  riskBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  confBar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  confBarFill: { height: 6, borderRadius: 3 },
  levelCard: { flex: 1, borderRadius: 12, padding: 14, borderWidth: 1, borderLeftWidth: 3 },
  sectionLabel: {
    fontSize: 12, fontWeight: '600', letterSpacing: 1,
    textTransform: 'uppercase', marginBottom: 10,
  },
  patternChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9999, borderWidth: 1,
  },
  reasonCard: { borderRadius: 12, padding: 16, borderWidth: 1 },
  newAnalysisBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    height: 52, borderRadius: 12, borderWidth: 1, gap: 8,
    marginTop: 8, paddingHorizontal: 16,
  },
});
