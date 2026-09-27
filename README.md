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

The API requires `DATABASE_URL`. The application no longer contains a database credential fallback; without the variable, the storefront remains deployable but database-backed API requests return a clear configuration error.

## Vercel deployment

1. Import `abdallahGIT/ecom12` into Vercel.
2. Keep the project root as the repository root.
3. Add `DATABASE_URL` under **Settings → Environment Variables** for Production, Preview, and Development as needed.
4. Deploy with the default Vercel build settings. `vercel.json` routes the API to the serverless function and keeps static pages/assets on Vercel's filesystem/CDN.
5. Open `/api/health` after deployment to confirm the database connection and automatic schema initialization.

> Never commit `.env` or database credentials. If the old Neon credential was ever active, rotate it in Neon because it appeared in earlier repository history.

## Project identity

- GitHub: [abdallahGIT/ecom12](https://github.com/abdallahGIT/ecom12)
- Email: `114431339+114431339+abdallahGIT@users.noreply.github.com`
