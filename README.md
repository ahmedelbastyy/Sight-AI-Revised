# Sight — AI Investing Assistant

Sight is an AI-powered investing app designed to make market research, stock analysis, portfolio tracking, and trade management easier to understand and use in one place.

Sight combines live market data, technical indicators, advanced charts, AI-generated analysis, brokerage connectivity, trade journaling, and subscription management into a single mobile experience.

Built as a student project for the RevenueCat Shipaton 2026 Next Gen Award.

## Features

- AI-powered stock analysis
- AI-generated trade ideas and market insights
- AI chart image analysis
- Live stock prices and market data
- Technical indicators and company fundamentals
- Advanced TradingView charts
- Stock watchlists
- Portfolio tracking
- Brokerage account connectivity through SnapTrade
- Supported trade submission
- Automatic trade journaling
- RevenueCat-powered subscriptions and premium access
- Authentication and account management
- Backend services powered through Supabase and OnSpace

## Tech Stack

Sight was built using:

- React Native
- Expo
- TypeScript
- Expo Router
- Supabase
- RevenueCat
- SnapTrade
- TradingView
- OnSpace
- React Native Paper
- Lottie
- React Native WebView

For the complete dependency list, see [`package.json`](./package.json).

## Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/ahmedelbastyy/Sight-AI-Revised.git
cd Sight-AI-Revised
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Project

Start the Expo development server:

```bash
npm run start
```

Run on a specific platform:

```bash
npm run ios
npm run android
npm run web
```

Reset the project if needed:

```bash
npm run reset-project
```

### 4. Lint the Code

```bash
npm run lint
```

## Environment Configuration

Sight uses environment variables and server-side configuration for its external services.

The project connects to services including:

- Supabase
- RevenueCat
- SnapTrade
- Market data services
- AI services

Some backend credentials and service secrets are intentionally not included in this public repository.

Sensitive credentials such as brokerage secrets, Supabase service-role credentials, payment secrets, and private API keys should remain server-side and should never be exposed in the mobile client.

Because some functionality depends on external services and private server-side credentials, cloning the repository alone may not provide access to every live production feature.

## Backend and Edge Functions

Sight uses backend services and Supabase Edge Functions for functionality including:

- Brokerage connectivity
- Brokerage account synchronization
- Trade submission
- AI-generated market analysis
- Chart analysis
- Subscription verification
- RevenueCat configuration
- Notifications and alerts
- Market and news services
- Account management

Backend credentials required by these services are stored outside of the mobile client.

## RevenueCat Integration

RevenueCat powers Sight's subscription and premium-access system.

RevenueCat is used to manage:

- Subscription products
- Purchases
- Premium entitlement status
- Access to premium features

This allows Sight to manage subscription access while keeping the subscription experience integrated directly into the application.

## Brokerage Integration

Sight integrates with SnapTrade to connect supported brokerage accounts.

The mobile application communicates with backend functions rather than storing private brokerage credentials directly in the client.

The integration supports functionality including:

- Connecting supported brokerage accounts
- Retrieving portfolio information
- Synchronizing account information
- Submitting supported trades
- Logging trades within Sight

## AI Features

Sight uses AI to make complex market information easier to understand.

AI-powered functionality includes:

- Market and stock analysis
- Potential trade analysis
- Explanations of market and technical information
- Chart image analysis

Users remain in control of whether they choose to act on information presented by Sight.

## Project Structure

```text
app/          Application routes and screens
components/   Reusable UI components
contexts/     React context providers
hooks/        Custom hooks
services/     Application services and integrations
constants/    Shared constants
assets/       Images and other application assets
supabase/     Backend and Edge Functions
scripts/      Development utilities
```

## Main Versions

- React Native: 0.79.4
- React: 19.0.0
- Expo: ~53.0.12
- Expo Router: ~5.1.0
- Supabase: ^2.50.0
- TypeScript: ~5.8.3
- ESLint: ^9.25.0

## Contributing

1. Fork this repository.

2. Create a new branch:

```bash
git checkout -b feature/your-feature
```

3. Commit your changes:

```bash
git commit -am "Add new feature"
```

4. Push your branch:

```bash
git push origin feature/your-feature
```

5. Open a Pull Request.

## License

Sight is licensed under the GNU General Public License v3.0 (GPL-3.0).

See the [`LICENSE`](./LICENSE) file for the complete license terms.

## Branding

The GPL-3.0 license applies to the software source code covered by the LICENSE file.

It does not grant permission to use the Sight name, Sight logos, icons, or other brand identifiers as trademarks or to imply endorsement by Sight or its creator.

Third-party software, libraries, APIs, assets, and other components remain subject to their respective licenses and terms.

## Author

Built by Ahmed Elbasty.

Created as a student project and submitted to RevenueCat Shipaton 2026.
