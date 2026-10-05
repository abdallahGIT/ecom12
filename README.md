# Ecom12

Arabic-first Algerian e-commerce storefront for Kaki seeds, with an Express API, Neon PostgreSQL, and Vercel deployment support.

## Local development

```bash
npm install
cp .env.example .env
# Set DATABASE_URL in .env
npm run check
npm start
```

- Storefront: `http://localhost:3000/`
- Admin dashboard: `http://localhost:3000/admin`
- Health check: `http://localhost:3000/api/health`

## Admin access

The admin dashboard and management APIs are protected by an HttpOnly signed session cookie. Local development defaults to `ecom12`. In production, set `ADMIN_PASSWORD` in Vercel Environment Variables; the admin login stays disabled if it is missing. Changing the password invalidates existing sessions.

Order prices are read from the active product in Neon, and saving an order, marking its lead converted, and reducing stock happen in one database transaction. Product schema setup is serialized across cold starts and can retry after a failed connection or migration.

Seeded product images use WebP assets. Images uploaded from the admin are resized and compressed in the browser before they are stored; on Vercel their compressed data is stored in Neon because the function filesystem is temporary.

The API requires `DATABASE_URL`. The application no longer contains a database credential fallback; without the variable, the storefront remains deployable but database-backed API requests return a clear configuration error.

## EcoTrack Algeria courier integration

EcoTrack is intentionally called **only from the server**. Configure either Vercel environment variables or the admin integration form:

```text
ECOTRACK_PROVIDER=navexdelivery
ECOTRACK_API_TOKEN=your-private-token
```

For the 48HR service, set `ECOTRACK_PROVIDER` to the provider slug supplied for your account (for example, `48hr`) and add its private token in Vercel or the admin integration form. If the account uses a custom API host, set `ECOTRACK_API_URL` too. The storefront loads provider wilayas, communes, and `/get/fees` through server routes; confirmed customer orders have their delivery fee recalculated on the server. If a fee cannot be loaded, checkout still records the customer order and leaves its delivery fee pending. Never put the token in frontend code or send it in chat.

If the fee service errors or times out, checkout still saves the order with `delivery_fee_pending` set. The storefront tells the customer the delivery fee will be confirmed by phone. Admin orders display a pending marker and provide **تحديد رسوم التوصيل** to save the confirmed amount later.

The storefront captures a lead as soon as it detects a valid Algerian phone number, then updates that same lead as the customer fills in their name, wilaya, commune, or offer. The admin dashboard refreshes leads and orders every 15 seconds. Meta Pixel receives one `Lead` event per valid phone in the current page session, without sending the phone to Meta.

### Telegram lead and order alerts

Lead and order alerts are sent by the server-side `telegram.js` adapter to the configured operations group. A lead alert is sent once when a valid Algerian phone number is saved, even when checkout is incomplete; completing checkout sends a separate order alert after the order transaction commits. The lead notification claim is stored with the lead to avoid repeat alerts as the form fields update. The adapter calls Telegram directly and never reads Neon or stores bot credentials in the database. Telegram timeouts or outages do not undo a saved lead or order. Alerts include customer name and phone for staff follow-up.

Set `TELEGRAM_BOT_TOKEN` to a newly rotated token and `TELEGRAM_CHAT_ID` to the operations group in each runtime environment. The token that was pasted into chat must be revoked through BotFather before configuring its replacement. The configured group is an operations supergroup; it cannot be used to privately message customers. Direct customer messages require the customer to start the bot and provide a Telegram chat ID, plus consent for order updates.

Checkout requires a valid phone, wilaya, and commune. If a checkout request omits a field already captured on its lead, the server fills it from that lead. Repeated submits using the same lead session return the already-created order, so browser retries do not consume stock or send a second alert. Health checks now expose dependency status and a request ID, not customer/order counts or raw database errors. Hard-coded preview orders were removed from the browser data module; customer and database rows are preserved.

The admin dashboard supports token validation, official wilaya/commune/desk lookup, delivery fees, single and bulk shipment creation, editing before validation, shipment validation/pickup, cancellation, tracking history, shipment notes, return requests, returned-package receipt confirmation, PDF labels, status filtering, and synchronization. The customer browser never receives the courier token. Confirm an order first, then use **رفع للشحن**; after creation use **ترحيل** to call EcoTrack's `valid/order` endpoint.

The implementation follows the official collection at `https://documenter.getpostman.com/view/14517169/Tz5je15g`, including the documented `/api/v1` paths, Bearer authorization, 40-item paginated order lists, 100-item bulk-create limit, and the documented rate limits (50/minute, 1,500/hour, 15,000/day). An optional `ECOTRACK_API_URL` or `ecotrack_url` setting can override the provider-derived base URL when EcoTrack gives the account a custom endpoint.

## Vercel deployment

1. Import `abdallahGIT/ecom12` into Vercel.
2. Keep the project root as the repository root.
3. Add `DATABASE_URL` under **Settings → Environment Variables** for Production, Preview, and Development as needed.
4. Deploy with the default Vercel build settings. `vercel.json` routes the API to the serverless function and keeps static pages/assets on Vercel's filesystem/CDN.
5. Open `/api/health` after deployment to confirm the database connection and automatic schema initialization.

> Never commit `.env` or database credentials. If the old Neon credential was ever active, rotate it in Neon because it appeared in earlier repository history.

## Project identity

- GitHub: [abdallahGIT/ecom12](https://github.com/abdallahGIT/ecom12)
- Email: `114431339+abdallahGIT@users.noreply.github.com`
