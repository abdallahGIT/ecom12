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

For the 48HR service, set `ECOTRACK_PROVIDER` to the provider slug supplied for your account (for example, `48hr`) and add its private token in Vercel or the admin integration form. If the account uses a custom API host, set `ECOTRACK_API_URL` too. The storefront loads provider wilayas, communes, and `/get/fees` through server routes; confirmed customer orders have their delivery fee recalculated on the server. Without a configured provider token, delivery fees cannot load and customer checkout is held until pricing is available. Never put the token in frontend code or send it in chat.

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
