// Annual Sector Select: the two largest S&P 500 stocks in each sector, as
// picked on January 1 of each year.
//
// These are APPROXIMATE rankings by market value at the end of the prior year,
// put together from general knowledge, not from a market-cap database. Edit
// any year here; the page recalculates automatically.
//
// Note: Visa and Mastercard counted as Information Technology until the
// March 2023 sector reshuffle, when they moved to Financials. 2026 matches the
// list on the Sector portfolio tab.
const ANNUAL_PICKS = {
  2022: {
    "Information Technology": ["AAPL", "MSFT"],
    "Communication Services": ["GOOGL", "META"],
    "Consumer Discretionary": ["AMZN", "TSLA"],
    "Financials": ["BRK-B", "JPM"],
    "Health Care": ["UNH", "JNJ"],
    "Consumer Staples": ["WMT", "PG"],
    "Energy": ["XOM", "CVX"],
    "Industrials": ["UPS", "UNP"],
    "Materials": ["LIN", "SHW"],
    "Utilities": ["NEE", "DUK"],
    "Real Estate": ["AMT", "PLD"],
  },
  2023: {
    "Information Technology": ["AAPL", "MSFT"],
    "Communication Services": ["GOOGL", "META"],
    "Consumer Discretionary": ["AMZN", "TSLA"],
    "Financials": ["BRK-B", "JPM"],
    "Health Care": ["UNH", "JNJ"],
    "Consumer Staples": ["WMT", "PG"],
    "Energy": ["XOM", "CVX"],
    "Industrials": ["UPS", "RTX"],
    "Materials": ["LIN", "SHW"],
    "Utilities": ["NEE", "DUK"],
    "Real Estate": ["PLD", "AMT"],
  },
  2024: {
    "Information Technology": ["AAPL", "MSFT"],
    "Communication Services": ["GOOGL", "META"],
    "Consumer Discretionary": ["AMZN", "TSLA"],
    "Financials": ["BRK-B", "V"],
    "Health Care": ["LLY", "UNH"],
    "Consumer Staples": ["WMT", "PG"],
    "Energy": ["XOM", "CVX"],
    "Industrials": ["CAT", "UNP"],
    "Materials": ["LIN", "SHW"],
    "Utilities": ["NEE", "SO"],
    "Real Estate": ["PLD", "AMT"],
  },
  2025: {
    "Information Technology": ["AAPL", "NVDA"],
    "Communication Services": ["GOOGL", "META"],
    "Consumer Discretionary": ["AMZN", "TSLA"],
    "Financials": ["BRK-B", "JPM"],
    "Health Care": ["LLY", "UNH"],
    "Consumer Staples": ["WMT", "COST"],
    "Energy": ["XOM", "CVX"],
    "Industrials": ["GE", "CAT"],
    "Materials": ["LIN", "SHW"],
    "Utilities": ["NEE", "SO"],
    "Real Estate": ["PLD", "AMT"],
  },
  2026: {
    "Information Technology": ["NVDA", "MSFT"],
    "Communication Services": ["GOOGL", "META"],
    "Consumer Discretionary": ["AMZN", "TSLA"],
    "Financials": ["BRK-B", "JPM"],
    "Health Care": ["LLY", "JNJ"],
    "Consumer Staples": ["WMT", "COST"],
    "Energy": ["XOM", "CVX"],
    "Industrials": ["GE", "CAT"],
    "Materials": ["LIN", "SHW"],
    "Utilities": ["NEE", "CEG"],
    "Real Estate": ["WELL", "PLD"],
  },
};
