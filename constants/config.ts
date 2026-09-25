export const config = {
  appName: 'Sight',
  appVersion: '1.0.0',
  subscription: {
    price: '$17.99',
    period: 'month',
    trialDays: 3,
  },
  disclaimer:
    'Sight provides financial insights and analysis for informational purposes only. This app does not guarantee profits or investment returns. We are not liable for any financial losses incurred based on information provided. This is not financial advice. Always consult with a qualified financial advisor before making investment decisions. Past performance does not indicate future results.',
  chartPeriods: [
    { id: '1D', label: '1D' },
    { id: '1W', label: '1W' },
    { id: '1M', label: '1M' },
    { id: '3M', label: '3M' },
    { id: '1Y', label: '1Y' },
  ] as const,
  signalTypes: {
    BUY: { label: 'Buy', color: '#10B981' },
    SELL: { label: 'Sell', color: '#EF4444' },
    HOLD: { label: 'Hold', color: '#F59E0B' },
  } as const,
  sentimentTypes: {
    POSITIVE: { label: 'Bullish', color: '#10B981', icon: 'trending-up' },
    NEGATIVE: { label: 'Bearish', color: '#EF4444', icon: 'trending-down' },
    NEUTRAL: { label: 'Neutral', color: '#F59E0B', icon: 'trending-flat' },
  } as const,
};
