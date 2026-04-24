# 🤖 Genos - World's First Open Source AI Optimization (AIO) / Generative Engine Optimization (GEO) Tool

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)
[![Next.js](https://img.shields.io/badge/Next.js-13.0-black.svg)](https://nextjs.org/)
[![Firebase](https://img.shields.io/badge/Firebase-9.0-orange.svg)](https://firebase.google.com/)

A comprehensive AI-powered monitoring and optimization tool for **AI Optimization (AIO)**, **Answer Engine Optimization (AEO)**, and **Generative Engine Optimization (GEO)**. Monitor your digital presence across AI-powered search engines and optimize your content for maximum visibility.

![Genos Preview](https://getcito.com/assets/images/template/ai-visibility-tracking.webp)

## 📚 Table of Contents

- [✨ Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [📋 Prerequisites](#-prerequisites)
- [⚙️ Installation](#️-installation)
- [🔧 Configuration](#-configuration)
- [🔐 Authentication Setup](#-authentication-setup)
- [🤖 AI Provider Configuration](#-ai-provider-configuration)
- [📁 Project Structure](#-project-structure)
- [🚀 Deployment](#-deployment)
- [🧪 Testing](#-testing)
- [🛠️ Troubleshooting](#️-troubleshooting)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)

## ✨ Features

### 🎯 Core Capabilities
- **Multi-Engine Optimization**: Optimize content for ChatGPT, Perplexity, Gemini, and other AI search engines
- **Real-time Monitoring**: Track your content's performance across AI-powered platforms
- **Advanced Analytics**: Get detailed insights into AI visibility and ranking factors
- **Content Optimization**: AI-powered suggestions for improving content discoverability

### 🛠️ Technical Features
- **Next.js 13+**: Server-side rendering with App Router and React Server Components
- **Multi-Provider AI**: Parallel fan-out across ChatGPT Search, Google AI Overview (via DataForSEO), and Perplexity. Google Gemini is also wired in and used for company-info extraction and brand onboarding flows.
- **Firebase Integration**: Authentication, Firestore database, and cloud functions
- **Responsive Design**: Mobile-first UI built with Tailwind CSS
- **Real-time Updates**: Live data synchronization and notifications
- **Enterprise Security**: Role-based access control and data encryption

### 🚀 Performance & Scalability
- **Automatic Code Splitting**: Optimized bundle sizes for faster loading
- **Edge Deployment**: Deploy globally with Vercel Edge Functions
- **Caching Strategy**: Intelligent caching for API responses and static assets
- **Progressive Web App**: Offline functionality and mobile app experience

## 🚀 Quick Start

Get up and running in less than 5 minutes:

```bash
# Clone the repository
git clone https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool.git
cd getcito-worlds-first-open-source-aio-aeo-or-geo-tool
# Install dependencies
npm install

# Copy environment template
cp .env.example .env.local

# Start development server
npm run dev


Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/basic-features/font-optimization) to automatically optimize and load Inter, a custom Google Font.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js/) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/deployment) for more details.

## Set Up Firebase

<https://console.firebase.google.com/>

- Log in with your Google account.
- Click on `Go to console` button.
- Click `Add Project` card.
- Give your project a name.
- Click on `Continue` button.
- Disable `Google Analytics for this project` (unless you wish to use it).
- Click `Create project` button.
- Click on the web icon button to create your web app. It will show a text popup `Web`.
- Register app by giving it a nickname and click `Register app` button.
- Where package.json is located, in your cli, type `npm i firebase`.
- Copy configuration file. Make a new file in `src` called `firebase` called `firebase.js`.
- In project root, create a file and name it `.env`.
- Make sure you add `.env.local` to your `.gitignore` so you don't expose your variables in git repo.
- Follow the instructions here at <https://nextjs.org/docs/pages/building-your-application/configuring/environment-variables#loading-environment-variables> to add your variables from firebase.js into this file.

Example...

# ChatGPT Search Configuration (OpenAI — used for ChatGPT Search provider)
# Either OPENAI_API_KEY or CHATGPT_SEARCH_API_KEY is accepted.
OPENAI_API_KEY=your_openai_api_key_here
# CHATGPT_SEARCH_API_KEY=your_openai_api_key_here

# Perplexity Configuration
PERPLEXITY_API_KEY=your_perplexity_api_key_here

# Google AI Overview via DataForSEO (both required to enable this provider)
DATAFORSEO_USERNAME=your_dataforseo_username
DATAFORSEO_PASSWORD=your_dataforseo_password

# Google Gemini Configuration (optional — used for company info + brand onboarding)
# Get your API key from: https://ai.google.dev/
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
# Alternative name for Gemini API key
# GEMINI_API_KEY=your_google_ai_api_key_here
# Optional: override the Gemini model (defaults to gemini-3.1-flash-lite-preview)
# GEMINI_MODEL=gemini-3.1-flash-lite-preview

# Firebase Configuration (Required for authentication and data storage)
NEXT_PUBLIC_FIREBASE_API_KEY=your_firebase_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=123456789
NEXT_PUBLIC_FIREBASE_APP_ID=1:123456789:web:abcdef123456

# Other API Keys (Optional)
# Add other API keys as needed for additional providers
# Firebase Configuration
# Get these values from your Firebase project settings
# https://console.firebase.google.com/


# Optional: Firebase Measurement ID (for Google Analytics)
# NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=your_measurement_id

# Next.js Configuration
NEXTAUTH_URL=
NEXTAUTH_SECRET=

# Development Environment
NODE_ENV=development

# Optional: Custom App Settings
NEXT_PUBLIC_APP_NAME=Genos Free & Open Source AIO, AEO or GEO Tool
NEXT_PUBLIC_APP_VERSION=10.0.0


SBOT_API_KEY=

SFLY_API_Key=


# Google Gemini Configuration (Optional)
# Get your API key from: https://ai.google.dev/
GOOGLE_AI_API_KEY=
# Alternative name for Gemini API key
GEMINI_API_KEY=


OPENAI_API_KEY=sk-xxxx-x


# DataForSEO Configuration (for Google AI Overview)
DATAFORSEO_USERNAME=
DATAFORSEO_PASSWORD=


PERPLEXITY_API_KEY=

FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=

# Sentry Error Reporting (Optional)
# If both are empty, Sentry is disabled and the app works fine without it.
# Point these at your own Sentry instance (self-hosted or sentry.io).
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# Scheduled Query Processing (required only if using the cron endpoint)
# Shared secret for /api/cron/process-scheduled. Generate with:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
CRON_SECRET=

# Base URL used for internal /api/user-query calls from the cron endpoint.
# Set in production; localhost is used as a fallback in dev.
NEXT_PUBLIC_APP_URL=https://your-deployed-app.example.com

- Duplicate the `env.example` file and paste these variables with your own information.
- Click on `Continue on console` button
- On your project homepage, choose a product to add to your app. First, click on `Authentication`.
- Under `Get started with Firebase Auth by adding your first sign-in method` select `Email/Password`.

You should now be setup to use Firebase.

## Authentication

The application includes comprehensive authentication and route protection:

### Firebase Authentication Setup
- In `src/firebase/auth` directory contains the logic for `signin`, `signup`, `signOut`, and `googleSignIn`
- Uses Firebase Auth for user management with email/password and Google OAuth

### Route Protection
- **Dashboard routes**: All `/dashboard/*` routes are protected and require authentication
- **Client-side protection**: Uses `AuthContext` and `ProtectedRoute` component for client-side route guards
- **API protection**: Optional server-side protection using middleware and token verification
- **Admin routes**: Special protection for admin-only pages using email whitelist

### Authentication Components
- `AuthContext`: Provides authentication state across the application
- `ProtectedRoute`: Reusable component for protecting routes
- `AuthStatus`: Shows current authentication status with sign-out functionality

### Usage Examples

```tsx
// Protect a route
<ProtectedRoute>
  <YourComponent />
</ProtectedRoute>

// Protect admin routes
<ProtectedRoute 
  requireAdmin={true} 
  adminEmails={['admin@example.com']}
>
  <AdminPanel />
</ProtectedRoute>

// Check auth status
const { user, loading } = useAuthContext();
```

### Security Features
- Automatic redirection to sign-in for unauthenticated users
- Loading states during authentication checks
- Admin role verification
- Firestore security rules (see `firestore.rules`)

## AI Provider Configuration

This application uses a multi-provider AI system that fans queries out in parallel to several third-party providers and aggregates their results. There is no primary/fallback chain — each provider is called concurrently and its result is treated independently. Providers are implemented under `src/lib/api-providers/` and wired together by `src/lib/api-providers/provider-manager.ts`.

### Providers

#### ChatGPT Search (OpenAI)

Implemented in `src/lib/api-providers/chatgptsearch-provider.ts`. Uses the OpenAI Responses API with the `web_search_preview` tool.

Reads the first non-empty value of:

```md
OPENAI_API_KEY=your_openai_api_key_here
# or
CHATGPT_SEARCH_API_KEY=your_openai_api_key_here
```

#### Perplexity

Implemented in `src/lib/api-providers/perplexity-provider.ts`. Calls `https://api.perplexity.ai/chat/completions` with the `sonar` / `sonar-pro` models.

```md
PERPLEXITY_API_KEY=your_perplexity_api_key_here
```

#### Google AI Overview (via DataForSEO)

Implemented in `src/lib/api-providers/google-ai-overview-provider.ts`. Hits the DataForSEO SERP API. Requires **both** credentials to be set, otherwise the provider is disabled at startup.

```md
DATAFORSEO_USERNAME=your_dataforseo_username
DATAFORSEO_PASSWORD=your_dataforseo_password
```

> DataForSEO is a paid service. Sign up at <https://dataforseo.com/> for API access.

#### Google Gemini (optional)

Implemented in `src/lib/api-providers/gemini-provider.ts`. Currently invoked from the company-info extraction API (`src/app/api/get-company-info/route.ts`) and the brand onboarding flow, alongside ChatGPT Search.

> TODO: Gemini is **not** invoked from `src/app/api/user-query/route.ts`, which hard-codes `['chatgptsearch', 'google-ai-overview', 'perplexity']`. If you want Gemini to participate in the main user-query fan-out, add it to that list.

Reads the first non-empty value of:

```md
GOOGLE_AI_API_KEY=your_google_ai_api_key_here
# or
GEMINI_API_KEY=your_gemini_api_key_here
# Optional: override the model (default: gemini-3.1-flash-lite-preview)
# GEMINI_MODEL=gemini-3.1-flash-lite-preview
```

### How the Multi-Provider System Works

- **Parallel fan-out, no fallback**: `ProviderManager.processRequest` maps each requested provider to a promise and awaits them with `Promise.allSettled`. There is no primary/secondary chain; every enabled provider is hit on every request.
- **Independent per-provider errors**: If a provider rejects or returns a non-success status, its entry is marked `status: 'error'` and excluded from the aggregated successful results — the other providers' responses still flow through.
- **Provider selection per call-site**: Each API route chooses which providers to invoke. For example, `src/app/api/user-query/route.ts` requests `['chatgptsearch', 'google-ai-overview', 'perplexity']`, while `src/app/api/get-company-info/route.ts` requests `['chatgptsearch', 'google-gemini']`.
- **Startup gating**: Providers whose env vars are missing at startup are skipped entirely — they never get registered with the `ProviderManager`. Requests for those providers return a `Provider not found` error.
- **Monitoring**: All provider responses, costs, and response times are logged to the server console.

## Error Reporting (Sentry)

The app ships with optional [Sentry](https://sentry.io/) integration via the open-source, MIT-licensed [`@sentry/nextjs`](https://github.com/getsentry/sentry-javascript) SDK. You can point it at the hosted service or your own self-hosted Sentry instance.

### Environment Variables

| Variable | Scope | Description |
| --- | --- | --- |
| `SENTRY_DSN` | Server-side (Node.js & Edge runtimes) | DSN used by `sentry.server.config.ts` and `sentry.edge.config.ts`. |
| `NEXT_PUBLIC_SENTRY_DSN` | Client-side (browser) | DSN used by `sentry.client.config.ts`. Can be the same DSN as `SENTRY_DSN`. |

**The app works fine without Sentry configured.** When neither variable is set, the SDK is initialized with `enabled: false` and no-ops — no events are sent, no replay/tracing is collected, and nothing is logged.

### What's wired up

- `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts` at the project root
- `src/instrumentation.ts` dispatches to the right config per `NEXT_RUNTIME`
- `next.config.js` wraps the exported config with `withSentryConfig` (lazy-loaded so the app builds before `npm install`)
- `src/app/error.tsx` captures uncaught errors from the App Router via `Sentry.captureException`

Source-map uploads are **not** configured — they require `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT`. See the TODO in `next.config.js` and wire them up when deployment is in place.

## Folder Structure

The folder structure of this project is organized as follows:

- `pages`: Contains the Next.js pages for server-side rendering.
- `components`: Holds the reusable React components.
- `lib`: Includes utility functions and modules.
- `public`: Stores static assets such as images, fonts, and stylesheets.
- `styles`: Contains global styles and Tailwind CSS configuration.
- `firebase`: Houses the Firebase configuration and Firebase-related functions.

Feel free to modify and expand the folder structure according to your project requirements.

## Scheduled Query Reprocessing

Brand query batches are re-run on a schedule (default: every 7 days per brand).
Triggering is done by hitting a protected endpoint externally — the app does not
self-schedule.

**Endpoint:** `POST /api/cron/process-scheduled`

**Auth:** `Authorization: Bearer $CRON_SECRET`

**Optional query params:**
| Param | Default | Meaning |
| --- | --- | --- |
| `intervalDays` | `7` | A brand is "due" when its most recent result is older than this many days (or never processed). |
| `maxBrands` | `50` | Safety cap on brands processed per invocation. Un-processed brands are picked up on the next run. |
| `brandId` | — | Process a single brand (useful for manual replays). |

**Preview:** `GET /api/cron/process-scheduled` returns the list of brands that
*would* be processed now, without running anything. Same auth.

**How it works:**
- Finds brands whose latest `queryProcessingResults[].date` is older than `intervalDays`.
- For each due brand, calls `/api/user-query` once per query with cron-mode auth
  (`Authorization: Bearer $CRON_SECRET` + `X-Cron-User-Id: <brand.userId>`).
- Credits are deducted from the brand owner just like a normal query. Owners
  out of credits will see per-query failures in the response summary.
- Execution is serial to stay within serverless timeouts.

### Hooking up a scheduler

Pick one:

**Firebase Cloud Scheduler → Cloud Function → HTTP call.** Create a tiny
scheduled Cloud Function that does:
```js
await fetch(`${APP_URL}/api/cron/process-scheduled`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
});
```
Schedule it at e.g. `every 24 hours`. Store `CRON_SECRET` and `APP_URL` as
function env vars.

**Vercel (if you switch host):** add to `vercel.json`:
```json
{ "crons": [{ "path": "/api/cron/process-scheduled", "schedule": "0 3 * * *" }] }
```
Vercel auto-adds the `Authorization` header with `CRON_SECRET`.

**GitHub Actions:** one workflow file with `on: schedule` and a `curl` step
pointing at the endpoint with the secret.

**External cron (EasyCron, cron-job.org, etc.):** configure a POST with the
`Authorization` header.

## Deployment

To deploy your Next.js application with Firebase, follow the Firebase deployment instructions specific to your hosting option (Firebase Hosting, Cloud Functions, etc.). Make sure to set up the appropriate environment variables for your production environment.

## Contributing

Contributions are welcome! If you encounter any issues or have suggestions for improvements, please feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the LICENSE file for more details.

## Acknowledgements

This project was created using the Next.js framework and Firebase platform.

Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Firebase Documentation](https://firebase.google.com/docs)
- [Tailwind CSS Documentation](https://tailwindcss.com/docs)

[World's First Open Source Generative Engine Optimization Tool Powered by Genos](https://getcito.com/)
