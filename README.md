# Portfolio Builder 500

Internal research tool for Alexander Capital. Builds a sector-diversified portfolio from the
S&P 500 and backtests it against the index.

## How it works
1. For each of the 11 GICS sectors, ranks a pool of the largest S&P 500 names by **live market cap**
   (Yahoo Finance) and keeps the top two: 22 stocks.
2. Backtests $10,000 over 5, 10 and 20 years, buy-and-hold, dividends reinvested (adjusted close).
3. Drops the two worst performers over each period and holds the remaining 20 at 5% each.
   If a stock wasn't public at the start date, it's excluded and the rest are equal-weighted.
4. Compares against all 22 equal-weighted and SPY.
5. Prices refresh every 60 seconds while the page is open.

## Project layout
- `public/` – the website (index.html, app.js)
- `netlify/functions/portfolio.mjs` – `/api/portfolio`: live quotes + top-2-per-sector ranking
- `netlify/functions/history.mjs` – `/api/history`: monthly price history for backtests
- `netlify/lib/yahoo.mjs` – Yahoo Finance helper
- The sector candidate list lives at the top of `portfolio.mjs`. Review it once or twice a year.

## Deploy
1. Create a new GitHub repo named `portfolio-builder-500` and upload these files.
2. In Netlify: Add new site → Import an existing project → GitHub → pick the repo.
3. Leave build command blank; Netlify reads `netlify.toml`. Click Deploy.

## Notes
- Yahoo Finance has no official public API. If it changes its endpoints, the data functions may need updating.
- Results are hypothetical and backtested with hindsight. Internal use only; review with compliance before sharing.
