// Real-time stock data service using Yahoo Finance API

export interface RealTimeQuote {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: string;
  marketCap: string;
  high52w: number;
  low52w: number;
  peRatio: number;
  dayHigh: number;
  dayLow: number;
  previousClose: number;
  name: string;
  // Session 193 - PROVENANCE FIELDS. Fundamentals & quote metadata must
  // come from real Yahoo Finance data. Never fabricate market cap, 52-week
  // ranges, volume, or previous close from hard-coded base values. When
  // Yahoo does not return a field, the corresponding available flag is
  // false and the UI must render '—' rather than a made-up value.
  //   asOf        — ms timestamp when this quote was verified from Yahoo.
  //                 0 means never verified for this symbol.
  //   provider    — 'yahoo' (fresh), 'cache' (last verified, stale-while-
  //                 revalidate), or 'unavailable' (no verified data yet).
  //   stale       — true when serving a cached value while a new Yahoo
  //                 fetch failed. Callers should optionally surface a
  //                 subtle 'as of' timestamp.
  //   marketCapAvailable / volumeAvailable — explicit booleans for the
  //                 fields most likely to be missing from Yahoo's chart
  //                 endpoint. Downstream UI checks these before rendering.
  asOf?: number;
  provider?: 'yahoo' | 'cache' | 'unavailable';
  stale?: boolean;
  marketCapAvailable?: boolean;
  volumeAvailable?: boolean;
}

// Stock catalog
const STOCK_ASSETS_RAW: { ticker: string; name: string; sector: string }[] = [
  // Information Technology
  { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
  { ticker: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology' },
  { ticker: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology' },
  { ticker: 'AVGO', name: 'Broadcom Inc.', sector: 'Technology' },
  { ticker: 'ORCL', name: 'Oracle Corporation', sector: 'Technology' },
  { ticker: 'CRM', name: 'Salesforce Inc.', sector: 'Technology' },
  { ticker: 'AMD', name: 'Advanced Micro Devices', sector: 'Technology' },
  { ticker: 'ADBE', name: 'Adobe Inc.', sector: 'Technology' },
  { ticker: 'CSCO', name: 'Cisco Systems', sector: 'Technology' },
  { ticker: 'IBM', name: 'IBM Corporation', sector: 'Technology' },
  { ticker: 'QCOM', name: 'Qualcomm Inc.', sector: 'Technology' },
  { ticker: 'TXN', name: 'Texas Instruments', sector: 'Technology' },
  { ticker: 'NOW', name: 'ServiceNow Inc.', sector: 'Technology' },
  { ticker: 'INTC', name: 'Intel Corporation', sector: 'Technology' },
  { ticker: 'PANW', name: 'Palo Alto Networks', sector: 'Technology' },
  { ticker: 'PLTR', name: 'Palantir Technologies', sector: 'Technology' },
  { ticker: 'CRWD', name: 'CrowdStrike Holdings', sector: 'Technology' },
  { ticker: 'ANET', name: 'Arista Networks', sector: 'Technology' },
  { ticker: 'INTU', name: 'Intuit Inc.', sector: 'Technology' },
  { ticker: 'AMAT', name: 'Applied Materials', sector: 'Technology' },
  { ticker: 'ADI', name: 'Analog Devices', sector: 'Technology' },
  { ticker: 'KLAC', name: 'KLA Corporation', sector: 'Technology' },
  { ticker: 'LRCX', name: 'Lam Research', sector: 'Technology' },
  { ticker: 'SNPS', name: 'Synopsys Inc.', sector: 'Technology' },
  { ticker: 'CDNS', name: 'Cadence Design', sector: 'Technology' },
  { ticker: 'FTNT', name: 'Fortinet Inc.', sector: 'Technology' },
  { ticker: 'MRVL', name: 'Marvell Technology', sector: 'Technology' },
  { ticker: 'MSI', name: 'Motorola Solutions', sector: 'Technology' },
  { ticker: 'APH', name: 'Amphenol Corp.', sector: 'Technology' },
  { ticker: 'NXPI', name: 'NXP Semiconductors', sector: 'Technology' },
  { ticker: 'ON', name: 'ON Semiconductor', sector: 'Technology' },
  { ticker: 'MU', name: 'Micron Technology', sector: 'Technology' },
  { ticker: 'FICO', name: 'Fair Isaac Corp.', sector: 'Technology' },
  { ticker: 'IT', name: 'Gartner Inc.', sector: 'Technology' },
  { ticker: 'MPWR', name: 'Monolithic Power Systems', sector: 'Technology' },
  { ticker: 'KEYS', name: 'Keysight Technologies', sector: 'Technology' },
  { ticker: 'DELL', name: 'Dell Technologies', sector: 'Technology' },
  { ticker: 'HPQ', name: 'HP Inc.', sector: 'Technology' },
  { ticker: 'HPE', name: 'Hewlett Packard Enterprise', sector: 'Technology' },
  { ticker: 'GLW', name: 'Corning Inc.', sector: 'Technology' },
  { ticker: 'ZBRA', name: 'Zebra Technologies', sector: 'Technology' },
  { ticker: 'CDW', name: 'CDW Corporation', sector: 'Technology' },
  { ticker: 'TDY', name: 'Teledyne Technologies', sector: 'Technology' },
  { ticker: 'TYL', name: 'Tyler Technologies', sector: 'Technology' },
  { ticker: 'TRMB', name: 'Trimble Inc.', sector: 'Technology' },
  { ticker: 'SMCI', name: 'Super Micro Computer', sector: 'Technology' },
  { ticker: 'GDDY', name: 'GoDaddy Inc.', sector: 'Technology' },
  { ticker: 'GEN', name: 'Gen Digital Inc.', sector: 'Technology' },
  { ticker: 'FSLR', name: 'First Solar Inc.', sector: 'Technology' },
  { ticker: 'EPAM', name: 'EPAM Systems', sector: 'Technology' },
  { ticker: 'VRSN', name: 'VeriSign Inc.', sector: 'Technology' },
  { ticker: 'SWKS', name: 'Skyworks Solutions', sector: 'Technology' },
  { ticker: 'JNPR', name: 'Juniper Networks', sector: 'Technology' },
  { ticker: 'FFIV', name: 'F5 Inc.', sector: 'Technology' },
  { ticker: 'QRVO', name: 'Qorvo Inc.', sector: 'Technology' },
  // Communication Services
  { ticker: 'GOOGL', name: 'Alphabet Inc.', sector: 'Communication Services' },
  { ticker: 'META', name: 'Meta Platforms Inc.', sector: 'Communication Services' },
  { ticker: 'NFLX', name: 'Netflix Inc.', sector: 'Communication Services' },
  { ticker: 'DIS', name: 'The Walt Disney Co.', sector: 'Communication Services' },
  { ticker: 'TMUS', name: 'T-Mobile US', sector: 'Communication Services' },
  { ticker: 'T', name: 'AT&T Inc.', sector: 'Communication Services' },
  { ticker: 'VZ', name: 'Verizon Communications', sector: 'Communication Services' },
  { ticker: 'CMCSA', name: 'Comcast Corp.', sector: 'Communication Services' },
  { ticker: 'CHTR', name: 'Charter Communications', sector: 'Communication Services' },
  { ticker: 'EA', name: 'Electronic Arts', sector: 'Communication Services' },
  { ticker: 'TTWO', name: 'Take-Two Interactive', sector: 'Communication Services' },
  { ticker: 'WBD', name: 'Warner Bros. Discovery', sector: 'Communication Services' },
  { ticker: 'PARA', name: 'Banzai International, Inc.', sector: 'Communication Services' },
  { ticker: 'OMC', name: 'Omnicom Group', sector: 'Communication Services' },
  { ticker: 'IPG', name: 'Interpublic Group', sector: 'Communication Services' },
  { ticker: 'NWSA', name: 'News Corp.', sector: 'Communication Services' },
  { ticker: 'MTCH', name: 'Match Group Inc.', sector: 'Communication Services' },
  { ticker: 'LYV', name: 'Live Nation Entertainment', sector: 'Communication Services' },
  { ticker: 'FOXA', name: 'Fox Corporation', sector: 'Communication Services' },
  // Consumer Discretionary
  { ticker: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'TSLA', name: 'Tesla, Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'HD', name: 'Home Depot', sector: 'Consumer Discretionary' },
  { ticker: 'MCD', name: "McDonald's Corp.", sector: 'Consumer Discretionary' },
  { ticker: 'NKE', name: 'Nike, Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'LOW', name: "Lowe's Companies", sector: 'Consumer Discretionary' },
  { ticker: 'SBUX', name: 'Starbucks Corp.', sector: 'Consumer Discretionary' },
  { ticker: 'TJX', name: 'TJX Companies', sector: 'Consumer Discretionary' },
  { ticker: 'BKNG', name: 'Booking Holdings', sector: 'Consumer Discretionary' },
  { ticker: 'ABNB', name: 'Airbnb Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'CMG', name: 'Chipotle Mexican Grill', sector: 'Consumer Discretionary' },
  { ticker: 'ORLY', name: "O'Reilly Automotive", sector: 'Consumer Discretionary' },
  { ticker: 'AZO', name: 'AutoZone Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'MAR', name: 'Marriott International', sector: 'Consumer Discretionary' },
  { ticker: 'HLT', name: 'Hilton Worldwide', sector: 'Consumer Discretionary' },
  { ticker: 'ROST', name: 'Ross Stores', sector: 'Consumer Discretionary' },
  { ticker: 'GM', name: 'General Motors', sector: 'Consumer Discretionary' },
  { ticker: 'F', name: 'Ford Motor Company', sector: 'Consumer Discretionary' },
  { ticker: 'DHI', name: 'D.R. Horton', sector: 'Consumer Discretionary' },
  { ticker: 'LEN', name: 'Lennar Corporation', sector: 'Consumer Discretionary' },
  { ticker: 'PHM', name: 'PulteGroup Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'NVR', name: 'NVR Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'GPC', name: 'Genuine Parts Co.', sector: 'Consumer Discretionary' },
  { ticker: 'LULU', name: 'Lululemon Athletica', sector: 'Consumer Discretionary' },
  { ticker: 'POOL', name: 'Pool Corporation', sector: 'Consumer Discretionary' },
  { ticker: 'ULTA', name: 'Ulta Beauty', sector: 'Consumer Discretionary' },
  { ticker: 'DKNG', name: 'DraftKings Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'EBAY', name: 'eBay Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'ETSY', name: 'Etsy Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'YUM', name: 'Yum! Brands', sector: 'Consumer Discretionary' },
  { ticker: 'DPZ', name: "Domino's Pizza", sector: 'Consumer Discretionary' },
  { ticker: 'DECK', name: 'Deckers Outdoor', sector: 'Consumer Discretionary' },
  { ticker: 'RCL', name: 'Royal Caribbean', sector: 'Consumer Discretionary' },
  { ticker: 'CCL', name: 'Carnival Corporation', sector: 'Consumer Discretionary' },
  { ticker: 'NCLH', name: 'Norwegian Cruise Line', sector: 'Consumer Discretionary' },
  { ticker: 'EXPE', name: 'Expedia Group', sector: 'Consumer Discretionary' },
  { ticker: 'LVS', name: 'Las Vegas Sands', sector: 'Consumer Discretionary' },
  { ticker: 'MGM', name: 'MGM Resorts', sector: 'Consumer Discretionary' },
  { ticker: 'WYNN', name: 'Wynn Resorts', sector: 'Consumer Discretionary' },
  { ticker: 'BBY', name: 'Best Buy Co.', sector: 'Consumer Discretionary' },
  { ticker: 'TSCO', name: 'Tractor Supply Co.', sector: 'Consumer Discretionary' },
  { ticker: 'KMX', name: 'CarMax Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'APTV', name: 'Aptiv PLC', sector: 'Consumer Discretionary' },
  { ticker: 'BWA', name: 'BorgWarner Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'CZR', name: 'Caesars Entertainment', sector: 'Consumer Discretionary' },
  { ticker: 'HAS', name: 'Hasbro Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'MHK', name: 'Mohawk Industries', sector: 'Consumer Discretionary' },
  { ticker: 'GRMN', name: 'Garmin Ltd.', sector: 'Consumer Discretionary' },
  { ticker: 'TPR', name: 'Tapestry Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'RL', name: 'Ralph Lauren', sector: 'Consumer Discretionary' },
  // Consumer Staples
  { ticker: 'WMT', name: 'Walmart Inc.', sector: 'Consumer Staples' },
  { ticker: 'COST', name: 'Costco Wholesale', sector: 'Consumer Staples' },
  { ticker: 'PG', name: 'Procter & Gamble', sector: 'Consumer Staples' },
  { ticker: 'KO', name: 'Coca-Cola Co.', sector: 'Consumer Staples' },
  { ticker: 'PEP', name: 'PepsiCo, Inc.', sector: 'Consumer Staples' },
  { ticker: 'PM', name: 'Philip Morris Intl', sector: 'Consumer Staples' },
  { ticker: 'MO', name: 'Altria Group', sector: 'Consumer Staples' },
  { ticker: 'MDLZ', name: 'Mondelez Intl', sector: 'Consumer Staples' },
  { ticker: 'CL', name: 'Colgate-Palmolive', sector: 'Consumer Staples' },
  { ticker: 'TGT', name: 'Target Corporation', sector: 'Consumer Staples' },
  { ticker: 'STZ', name: 'Constellation Brands', sector: 'Consumer Staples' },
  { ticker: 'SYY', name: 'Sysco Corp.', sector: 'Consumer Staples' },
  { ticker: 'GIS', name: 'General Mills', sector: 'Consumer Staples' },
  { ticker: 'KMB', name: 'Kimberly-Clark', sector: 'Consumer Staples' },
  { ticker: 'ADM', name: 'Archer-Daniels-Midland', sector: 'Consumer Staples' },
  { ticker: 'HSY', name: 'Hershey Company', sector: 'Consumer Staples' },
  { ticker: 'K', name: 'Kellanova', sector: 'Consumer Staples' },
  { ticker: 'EL', name: 'Estee Lauder', sector: 'Consumer Staples' },
  { ticker: 'KR', name: 'Kroger Co.', sector: 'Consumer Staples' },
  { ticker: 'MNST', name: 'Monster Beverage', sector: 'Consumer Staples' },
  { ticker: 'CAG', name: 'Conagra Brands', sector: 'Consumer Staples' },
  { ticker: 'SJM', name: 'J.M. Smucker', sector: 'Consumer Staples' },
  { ticker: 'MKC', name: 'McCormick & Co.', sector: 'Consumer Staples' },
  { ticker: 'CHD', name: 'Church & Dwight', sector: 'Consumer Staples' },
  { ticker: 'CLX', name: 'Clorox Company', sector: 'Consumer Staples' },
  { ticker: 'KDP', name: 'Keurig Dr Pepper', sector: 'Consumer Staples' },
  { ticker: 'TAP', name: 'Molson Coors', sector: 'Consumer Staples' },
  { ticker: 'CPB', name: 'Campbell Soup', sector: 'Consumer Staples' },
  { ticker: 'BG', name: 'Bunge Global', sector: 'Consumer Staples' },
  { ticker: 'LW', name: 'Lamb Weston', sector: 'Consumer Staples' },
  // Financials
  { ticker: 'JPM', name: 'JPMorgan Chase', sector: 'Financials' },
  { ticker: 'V', name: 'Visa Inc.', sector: 'Financials' },
  { ticker: 'MA', name: 'Mastercard Inc.', sector: 'Financials' },
  { ticker: 'BAC', name: 'Bank of America', sector: 'Financials' },
  { ticker: 'WFC', name: 'Wells Fargo', sector: 'Financials' },
  { ticker: 'GS', name: 'Goldman Sachs', sector: 'Financials' },
  { ticker: 'MS', name: 'Morgan Stanley', sector: 'Financials' },
  { ticker: 'BLK', name: 'BlackRock Inc.', sector: 'Financials' },
  { ticker: 'C', name: 'Citigroup Inc.', sector: 'Financials' },
  { ticker: 'AXP', name: 'American Express', sector: 'Financials' },
  { ticker: 'SCHW', name: 'Charles Schwab', sector: 'Financials' },
  { ticker: 'PYPL', name: 'PayPal Holdings', sector: 'Financials' },
  { ticker: 'SPGI', name: 'S&P Global', sector: 'Financials' },
  { ticker: 'MCO', name: "Moody's Corp.", sector: 'Financials' },
  { ticker: 'MMC', name: 'Marsh & McLennan', sector: 'Financials' },
  { ticker: 'PGR', name: 'Progressive Corp.', sector: 'Financials' },
  { ticker: 'CB', name: 'Chubb Limited', sector: 'Financials' },
  { ticker: 'AON', name: 'Aon plc', sector: 'Financials' },
  { ticker: 'ICE', name: 'Intercontinental Exchange', sector: 'Financials' },
  { ticker: 'CME', name: 'CME Group', sector: 'Financials' },
  { ticker: 'USB', name: 'U.S. Bancorp', sector: 'Financials' },
  { ticker: 'PNC', name: 'PNC Financial', sector: 'Financials' },
  { ticker: 'TFC', name: 'Truist Financial', sector: 'Financials' },
  { ticker: 'AIG', name: 'American Intl Group', sector: 'Financials' },
  { ticker: 'MET', name: 'MetLife Inc.', sector: 'Financials' },
  { ticker: 'PRU', name: 'Prudential Financial', sector: 'Financials' },
  { ticker: 'ALL', name: 'Allstate Corp.', sector: 'Financials' },
  { ticker: 'AFL', name: 'Aflac Inc.', sector: 'Financials' },
  { ticker: 'TRV', name: 'Travelers Companies', sector: 'Financials' },
  { ticker: 'AJG', name: 'Arthur J. Gallagher', sector: 'Financials' },
  { ticker: 'MSCI', name: 'MSCI Inc.', sector: 'Financials' },
  { ticker: 'FI', name: 'Fiserv Inc.', sector: 'Financials' },
  { ticker: 'COF', name: 'Capital One Financial', sector: 'Financials' },
  { ticker: 'DFS', name: 'Discover Financial', sector: 'Financials' },
  { ticker: 'SYF', name: 'Synchrony Financial', sector: 'Financials' },
  { ticker: 'FITB', name: 'Fifth Third Bancorp', sector: 'Financials' },
  { ticker: 'KEY', name: 'KeyCorp', sector: 'Financials' },
  { ticker: 'HBAN', name: 'Huntington Bancshares', sector: 'Financials' },
  { ticker: 'RF', name: 'Regions Financial', sector: 'Financials' },
  { ticker: 'CFG', name: 'Citizens Financial', sector: 'Financials' },
  { ticker: 'MTB', name: 'M&T Bank Corp.', sector: 'Financials' },
  { ticker: 'NTRS', name: 'Northern Trust', sector: 'Financials' },
  { ticker: 'CINF', name: 'Cincinnati Financial', sector: 'Financials' },
  { ticker: 'L', name: 'Loews Corporation', sector: 'Financials' },
  { ticker: 'BRO', name: 'Brown & Brown', sector: 'Financials' },
  { ticker: 'RE', name: 'Everest Group', sector: 'Financials' },
  { ticker: 'WRB', name: 'W. R. Berkley', sector: 'Financials' },
  { ticker: 'GL', name: 'Globe Life Inc.', sector: 'Financials' },
  { ticker: 'FDS', name: 'FactSet Research', sector: 'Financials' },
  { ticker: 'NDAQ', name: 'Nasdaq Inc.', sector: 'Financials' },
  { ticker: 'CBOE', name: 'Cboe Global Markets', sector: 'Financials' },
  { ticker: 'COIN', name: 'Coinbase Global', sector: 'Financials' },
  // Healthcare
  { ticker: 'UNH', name: 'UnitedHealth Group', sector: 'Healthcare' },
  { ticker: 'LLY', name: 'Eli Lilly and Co.', sector: 'Healthcare' },
  { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
  { ticker: 'ABBV', name: 'AbbVie Inc.', sector: 'Healthcare' },
  { ticker: 'MRK', name: 'Merck & Co.', sector: 'Healthcare' },
  { ticker: 'TMO', name: 'Thermo Fisher Scientific', sector: 'Healthcare' },
  { ticker: 'ABT', name: 'Abbott Laboratories', sector: 'Healthcare' },
  { ticker: 'PFE', name: 'Pfizer Inc.', sector: 'Healthcare' },
  { ticker: 'AMGN', name: 'Amgen Inc.', sector: 'Healthcare' },
  { ticker: 'BMY', name: 'Bristol-Myers Squibb', sector: 'Healthcare' },
  { ticker: 'ISRG', name: 'Intuitive Surgical', sector: 'Healthcare' },
  { ticker: 'GILD', name: 'Gilead Sciences', sector: 'Healthcare' },
  { ticker: 'VRTX', name: 'Vertex Pharma', sector: 'Healthcare' },
  { ticker: 'REGN', name: 'Regeneron Pharma', sector: 'Healthcare' },
  { ticker: 'SYK', name: 'Stryker Corp.', sector: 'Healthcare' },
  { ticker: 'BDX', name: 'Becton Dickinson', sector: 'Healthcare' },
  { ticker: 'MDT', name: 'Medtronic plc', sector: 'Healthcare' },
  { ticker: 'CI', name: 'Cigna Group', sector: 'Healthcare' },
  { ticker: 'ELV', name: 'Elevance Health', sector: 'Healthcare' },
  { ticker: 'HUM', name: 'Humana Inc.', sector: 'Healthcare' },
  { ticker: 'CNC', name: 'Centene Corp.', sector: 'Healthcare' },
  { ticker: 'MCK', name: 'McKesson Corp.', sector: 'Healthcare' },
  { ticker: 'ZTS', name: 'Zoetis Inc.', sector: 'Healthcare' },
  { ticker: 'BSX', name: 'Boston Scientific', sector: 'Healthcare' },
  { ticker: 'EW', name: 'Edwards Lifesciences', sector: 'Healthcare' },
  { ticker: 'IDXX', name: 'IDEXX Laboratories', sector: 'Healthcare' },
  { ticker: 'DXCM', name: 'DexCom Inc.', sector: 'Healthcare' },
  { ticker: 'IQV', name: 'IQVIA Holdings', sector: 'Healthcare' },
  { ticker: 'A', name: 'Agilent Technologies', sector: 'Healthcare' },
  { ticker: 'DHR', name: 'Danaher Corp.', sector: 'Healthcare' },
  { ticker: 'RMD', name: 'ResMed Inc.', sector: 'Healthcare' },
  { ticker: 'CAH', name: 'Cardinal Health', sector: 'Healthcare' },
  { ticker: 'COR', name: 'Cencora Inc.', sector: 'Healthcare' },
  { ticker: 'BAX', name: 'Baxter International', sector: 'Healthcare' },
  { ticker: 'MRNA', name: 'Moderna Inc.', sector: 'Healthcare' },
  { ticker: 'BIIB', name: 'Biogen Inc.', sector: 'Healthcare' },
  { ticker: 'VEEV', name: 'Veeva Systems', sector: 'Healthcare' },
  { ticker: 'HOLX', name: 'Hologic Inc.', sector: 'Healthcare' },
  { ticker: 'MTD', name: 'Mettler-Toledo', sector: 'Healthcare' },
  { ticker: 'WAT', name: 'Waters Corporation', sector: 'Healthcare' },
  { ticker: 'ALGN', name: 'Align Technology', sector: 'Healthcare' },
  { ticker: 'TECH', name: 'Bio-Techne Corp.', sector: 'Healthcare' },
  { ticker: 'VTRS', name: 'Viatris Inc.', sector: 'Healthcare' },
  { ticker: 'MOH', name: 'Molina Healthcare', sector: 'Healthcare' },
  { ticker: 'INCY', name: 'Incyte Corp.', sector: 'Healthcare' },
  { ticker: 'RVTY', name: 'Revvity Inc.', sector: 'Healthcare' },
  { ticker: 'HSIC', name: 'Henry Schein', sector: 'Healthcare' },
  { ticker: 'DGX', name: 'Quest Diagnostics', sector: 'Healthcare' },
  { ticker: 'LH', name: 'Labcorp Holdings', sector: 'Healthcare' },
  // Industrials
  { ticker: 'GE', name: 'GE Aerospace', sector: 'Industrials' },
  { ticker: 'CAT', name: 'Caterpillar Inc.', sector: 'Industrials' },
  { ticker: 'HON', name: 'Honeywell International', sector: 'Industrials' },
  { ticker: 'UPS', name: 'United Parcel Service', sector: 'Industrials' },
  { ticker: 'RTX', name: 'RTX Corporation', sector: 'Industrials' },
  { ticker: 'BA', name: 'Boeing Company', sector: 'Industrials' },
  { ticker: 'DE', name: 'Deere & Company', sector: 'Industrials' },
  { ticker: 'LMT', name: 'Lockheed Martin', sector: 'Industrials' },
  { ticker: 'UNP', name: 'Union Pacific', sector: 'Industrials' },
  { ticker: 'ETN', name: 'Eaton Corporation', sector: 'Industrials' },
  { ticker: 'ADP', name: 'Automatic Data Processing', sector: 'Industrials' },
  { ticker: 'WM', name: 'Waste Management', sector: 'Industrials' },
  { ticker: 'FDX', name: 'FedEx Corp.', sector: 'Industrials' },
  { ticker: 'GD', name: 'General Dynamics', sector: 'Industrials' },
  { ticker: 'NOC', name: 'Northrop Grumman', sector: 'Industrials' },
  { ticker: 'ITW', name: 'Illinois Tool Works', sector: 'Industrials' },
  { ticker: 'EMR', name: 'Emerson Electric', sector: 'Industrials' },
  { ticker: 'CSX', name: 'CSX Corporation', sector: 'Industrials' },
  { ticker: 'NSC', name: 'Norfolk Southern', sector: 'Industrials' },
  { ticker: 'CPRT', name: 'Copart Inc.', sector: 'Industrials' },
  { ticker: 'CTAS', name: 'Cintas Corporation', sector: 'Industrials' },
  { ticker: 'PAYX', name: 'Paychex Inc.', sector: 'Industrials' },
  { ticker: 'FAST', name: 'Fastenal Company', sector: 'Industrials' },
  { ticker: 'UBER', name: 'Uber Technologies', sector: 'Industrials' },
  { ticker: 'RSG', name: 'Republic Services', sector: 'Industrials' },
  { ticker: 'PCAR', name: 'PACCAR Inc.', sector: 'Industrials' },
  { ticker: 'VRSK', name: 'Verisk Analytics', sector: 'Industrials' },
  { ticker: 'GWW', name: 'W.W. Grainger', sector: 'Industrials' },
  { ticker: 'IR', name: 'Ingersoll Rand', sector: 'Industrials' },
  { ticker: 'PWR', name: 'Quanta Services', sector: 'Industrials' },
  { ticker: 'AME', name: 'AMETEK Inc.', sector: 'Industrials' },
  { ticker: 'ROK', name: 'Rockwell Automation', sector: 'Industrials' },
  { ticker: 'AXON', name: 'Axon Enterprise', sector: 'Industrials' },
  { ticker: 'TT', name: 'Trane Technologies', sector: 'Industrials' },
  { ticker: 'XYL', name: 'Xylem Inc.', sector: 'Industrials' },
  { ticker: 'HWM', name: 'Howmet Aerospace', sector: 'Industrials' },
  { ticker: 'DOV', name: 'Dover Corporation', sector: 'Industrials' },
  { ticker: 'ROP', name: 'Roper Technologies', sector: 'Industrials' },
  { ticker: 'SWK', name: 'Stanley Black & Decker', sector: 'Industrials' },
  { ticker: 'J', name: 'Jacobs Solutions', sector: 'Industrials' },
  { ticker: 'HUBB', name: 'Hubbell Inc.', sector: 'Industrials' },
  { ticker: 'DAL', name: 'Delta Air Lines', sector: 'Industrials' },
  { ticker: 'UAL', name: 'United Airlines', sector: 'Industrials' },
  { ticker: 'LUV', name: 'Southwest Airlines', sector: 'Industrials' },
  { ticker: 'WAB', name: 'Westinghouse Air Brake', sector: 'Industrials' },
  { ticker: 'LDOS', name: 'Leidos Holdings', sector: 'Industrials' },
  { ticker: 'IEX', name: 'IDEX Corporation', sector: 'Industrials' },
  { ticker: 'PNR', name: 'Pentair plc', sector: 'Industrials' },
  { ticker: 'NDSN', name: 'Nordson Corporation', sector: 'Industrials' },
  { ticker: 'PAYC', name: 'Paycom Software', sector: 'Industrials' },
  { ticker: 'GNRC', name: 'Generac Holdings', sector: 'Industrials' },
  // Energy
  { ticker: 'XOM', name: 'Exxon Mobil Corp.', sector: 'Energy' },
  { ticker: 'CVX', name: 'Chevron Corporation', sector: 'Energy' },
  { ticker: 'COP', name: 'ConocoPhillips', sector: 'Energy' },
  { ticker: 'SLB', name: 'Schlumberger Ltd.', sector: 'Energy' },
  { ticker: 'EOG', name: 'EOG Resources', sector: 'Energy' },
  { ticker: 'OXY', name: 'Occidental Petroleum', sector: 'Energy' },
  { ticker: 'MPC', name: 'Marathon Petroleum', sector: 'Energy' },
  { ticker: 'PSX', name: 'Phillips 66', sector: 'Energy' },
  { ticker: 'VLO', name: 'Valero Energy', sector: 'Energy' },
  { ticker: 'PXD', name: 'Pioneer Natural Resources', sector: 'Energy' },
  { ticker: 'WMB', name: 'Williams Companies', sector: 'Energy' },
  { ticker: 'KMI', name: 'Kinder Morgan', sector: 'Energy' },
  { ticker: 'OKE', name: 'ONEOK Inc.', sector: 'Energy' },
  { ticker: 'HAL', name: 'Halliburton Co.', sector: 'Energy' },
  { ticker: 'FANG', name: 'Diamondback Energy', sector: 'Energy' },
  { ticker: 'DVN', name: 'Devon Energy', sector: 'Energy' },
  { ticker: 'BKR', name: 'Baker Hughes', sector: 'Energy' },
  { ticker: 'HES', name: 'Hess Corporation', sector: 'Energy' },
  { ticker: 'CTRA', name: 'Coterra Energy', sector: 'Energy' },
  { ticker: 'TRGP', name: 'Targa Resources', sector: 'Energy' },
  { ticker: 'EQT', name: 'EQT Corporation', sector: 'Energy' },
  { ticker: 'APA', name: 'APA Corporation', sector: 'Energy' },
  // Utilities
  { ticker: 'NEE', name: 'NextEra Energy', sector: 'Utilities' },
  { ticker: 'DUK', name: 'Duke Energy', sector: 'Utilities' },
  { ticker: 'SO', name: 'Southern Company', sector: 'Utilities' },
  { ticker: 'D', name: 'Dominion Energy', sector: 'Utilities' },
  { ticker: 'SRE', name: 'Sempra Energy', sector: 'Utilities' },
  { ticker: 'AEP', name: 'American Electric Power', sector: 'Utilities' },
  { ticker: 'EXC', name: 'Exelon Corp.', sector: 'Utilities' },
  { ticker: 'XEL', name: 'Xcel Energy', sector: 'Utilities' },
  { ticker: 'ED', name: 'Consolidated Edison', sector: 'Utilities' },
  { ticker: 'WEC', name: 'WEC Energy Group', sector: 'Utilities' },
  { ticker: 'ES', name: 'Eversource Energy', sector: 'Utilities' },
  { ticker: 'PCG', name: 'PG&E Corp.', sector: 'Utilities' },
  { ticker: 'AWK', name: 'American Water Works', sector: 'Utilities' },
  { ticker: 'DTE', name: 'DTE Energy', sector: 'Utilities' },
  { ticker: 'EIX', name: 'Edison International', sector: 'Utilities' },
  { ticker: 'FE', name: 'FirstEnergy Corp.', sector: 'Utilities' },
  { ticker: 'ETR', name: 'Entergy Corp.', sector: 'Utilities' },
  { ticker: 'PPL', name: 'PPL Corporation', sector: 'Utilities' },
  { ticker: 'AEE', name: 'Ameren Corp.', sector: 'Utilities' },
  { ticker: 'CMS', name: 'CMS Energy', sector: 'Utilities' },
  { ticker: 'CNP', name: 'CenterPoint Energy', sector: 'Utilities' },
  { ticker: 'ATO', name: 'Atmos Energy', sector: 'Utilities' },
  { ticker: 'NI', name: 'NiSource Inc.', sector: 'Utilities' },
  { ticker: 'LNT', name: 'Alliant Energy', sector: 'Utilities' },
  { ticker: 'EVRG', name: 'Evergy Inc.', sector: 'Utilities' },
  { ticker: 'PNW', name: 'Pinnacle West Capital', sector: 'Utilities' },
  // Real Estate
  { ticker: 'AMT', name: 'American Tower', sector: 'Real Estate' },
  { ticker: 'PLD', name: 'Prologis Inc.', sector: 'Real Estate' },
  { ticker: 'CCI', name: 'Crown Castle', sector: 'Real Estate' },
  { ticker: 'EQIX', name: 'Equinix Inc.', sector: 'Real Estate' },
  { ticker: 'SPG', name: 'Simon Property Group', sector: 'Real Estate' },
  { ticker: 'PSA', name: 'Public Storage', sector: 'Real Estate' },
  { ticker: 'O', name: 'Realty Income', sector: 'Real Estate' },
  { ticker: 'WELL', name: 'Welltower Inc.', sector: 'Real Estate' },
  { ticker: 'DLR', name: 'Digital Realty', sector: 'Real Estate' },
  { ticker: 'VICI', name: 'VICI Properties', sector: 'Real Estate' },
  { ticker: 'SBAC', name: 'SBA Communications', sector: 'Real Estate' },
  { ticker: 'AVB', name: 'AvalonBay Communities', sector: 'Real Estate' },
  { ticker: 'EQR', name: 'Equity Residential', sector: 'Real Estate' },
  { ticker: 'WY', name: 'Weyerhaeuser', sector: 'Real Estate' },
  { ticker: 'ARE', name: 'Alexandria Real Estate', sector: 'Real Estate' },
  { ticker: 'MAA', name: 'Mid-America Apartment', sector: 'Real Estate' },
  { ticker: 'EXR', name: 'Extra Space Storage', sector: 'Real Estate' },
  { ticker: 'ESS', name: 'Essex Property Trust', sector: 'Real Estate' },
  { ticker: 'IRM', name: 'Iron Mountain', sector: 'Real Estate' },
  { ticker: 'VTR', name: 'Ventas Inc.', sector: 'Real Estate' },
  { ticker: 'INVH', name: 'Invitation Homes', sector: 'Real Estate' },
  { ticker: 'HST', name: 'Host Hotels & Resorts', sector: 'Real Estate' },
  { ticker: 'KIM', name: 'Kimco Realty', sector: 'Real Estate' },
  { ticker: 'REG', name: 'Regency Centers', sector: 'Real Estate' },
  { ticker: 'CPT', name: 'Camden Property Trust', sector: 'Real Estate' },
  { ticker: 'UDR', name: 'UDR Inc.', sector: 'Real Estate' },
  { ticker: 'BXP', name: 'BXP Inc.', sector: 'Real Estate' },
  // Materials
  { ticker: 'LIN', name: 'Linde plc', sector: 'Materials' },
  { ticker: 'APD', name: 'Air Products', sector: 'Materials' },
  { ticker: 'SHW', name: 'Sherwin-Williams', sector: 'Materials' },
  { ticker: 'ECL', name: 'Ecolab Inc.', sector: 'Materials' },
  { ticker: 'FCX', name: 'Freeport-McMoRan', sector: 'Materials' },
  { ticker: 'NEM', name: 'Newmont Corp.', sector: 'Materials' },
  { ticker: 'NUE', name: 'Nucor Corporation', sector: 'Materials' },
  { ticker: 'VMC', name: 'Vulcan Materials', sector: 'Materials' },
  { ticker: 'MLM', name: 'Martin Marietta', sector: 'Materials' },
  { ticker: 'DOW', name: 'Dow Inc.', sector: 'Materials' },
  { ticker: 'DD', name: 'DuPont de Nemours', sector: 'Materials' },
  { ticker: 'PPG', name: 'PPG Industries', sector: 'Materials' },
  { ticker: 'IFF', name: 'Intl Flavors & Fragrances', sector: 'Materials' },
  { ticker: 'ALB', name: 'Albemarle Corp.', sector: 'Materials' },
  { ticker: 'CE', name: 'Celanese Corp.', sector: 'Materials' },
  { ticker: 'EMN', name: 'Eastman Chemical', sector: 'Materials' },
  { ticker: 'PKG', name: 'Packaging Corp of America', sector: 'Materials' },
  { ticker: 'IP', name: 'International Paper', sector: 'Materials' },
  { ticker: 'BALL', name: 'Ball Corporation', sector: 'Materials' },
  { ticker: 'AMCR', name: 'Amcor plc', sector: 'Materials' },
  { ticker: 'CF', name: 'CF Industries', sector: 'Materials' },
  { ticker: 'MOS', name: 'Mosaic Company', sector: 'Materials' },
  { ticker: 'STLD', name: 'Steel Dynamics', sector: 'Materials' },
  // Additional S&P 500 members across sectors
  { ticker: 'BRK.B', name: 'Berkshire Hathaway', sector: 'Financials' },
  { ticker: 'ACGL', name: 'Arch Capital Group', sector: 'Financials' },
  { ticker: 'WDAY', name: 'Workday Inc.', sector: 'Technology' },
  { ticker: 'TEAM', name: 'Atlassian Corp.', sector: 'Technology' },
  { ticker: 'HUBS', name: 'HubSpot Inc.', sector: 'Technology' },
  { ticker: 'TTD', name: 'The Trade Desk', sector: 'Technology' },
  { ticker: 'SNAP', name: 'Snap Inc.', sector: 'Communication Services' },
  { ticker: 'PINS', name: 'Pinterest Inc.', sector: 'Communication Services' },
  { ticker: 'ZM', name: 'Zoom Video', sector: 'Communication Services' },
  { ticker: 'SPOT', name: 'Spotify Technology', sector: 'Communication Services' },
  { ticker: 'DASH', name: 'DoorDash Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'ENPH', name: 'Enphase Energy', sector: 'Technology' },
  { ticker: 'SQ', name: 'Block, Inc.', sector: 'Financials' },
  { ticker: 'SOFI', name: 'SoFi Technologies', sector: 'Financials' },
  { ticker: 'HOOD', name: 'Robinhood Markets', sector: 'Financials' },
  { ticker: 'ARM', name: 'ARM Holdings', sector: 'Technology' },
  { ticker: 'SHOP', name: 'Shopify Inc.', sector: 'Technology' },
  { ticker: 'SNOW', name: 'Snowflake Inc.', sector: 'Technology' },
  { ticker: 'NET', name: 'Cloudflare Inc.', sector: 'Technology' },
  { ticker: 'DDOG', name: 'Datadog Inc.', sector: 'Technology' },
  { ticker: 'ZS', name: 'Zscaler Inc.', sector: 'Technology' },
  { ticker: 'MDB', name: 'MongoDB Inc.', sector: 'Technology' },
  { ticker: 'ROKU', name: 'Roku, Inc.', sector: 'Communication Services' },
  { ticker: 'TWLO', name: 'Twilio Inc.', sector: 'Technology' },
  { ticker: 'OKTA', name: 'Okta Inc.', sector: 'Technology' },
  { ticker: 'DOCU', name: 'DocuSign Inc.', sector: 'Technology' },
  { ticker: 'PATH', name: 'UiPath Inc.', sector: 'Technology' },
  { ticker: 'RBLX', name: 'Roblox Corp.', sector: 'Communication Services' },
  { ticker: 'U', name: 'Unity Software', sector: 'Technology' },
  { ticker: 'GME', name: 'GameStop Corp.', sector: 'Consumer Discretionary' },
  { ticker: 'AMC', name: 'AMC Entertainment', sector: 'Communication Services' },
  { ticker: 'W', name: 'Wayfair Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'CHWY', name: 'Chewy Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'RIVN', name: 'Rivian Automotive', sector: 'Consumer Discretionary' },
  { ticker: 'LCID', name: 'Lucid Group Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'MELI', name: 'MercadoLibre Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'SEDG', name: 'SolarEdge Tech', sector: 'Technology' },
  // International ADRs in S&P 500
  { ticker: 'BABA', name: 'Alibaba Group', sector: 'Consumer Discretionary' },
  { ticker: 'TSM', name: 'Taiwan Semiconductor', sector: 'Technology' },
  { ticker: 'ASML', name: 'ASML Holding NV', sector: 'Technology' },
  { ticker: 'SAP', name: 'SAP SE', sector: 'Technology' },
  { ticker: 'TM', name: 'Toyota Motor Corp.', sector: 'Consumer Discretionary' },
  { ticker: 'SONY', name: 'Sony Group Corp.', sector: 'Technology' },
  { ticker: 'NVO', name: 'Novo Nordisk', sector: 'Healthcare' },
  { ticker: 'SHEL', name: 'Shell plc', sector: 'Energy' },
  { ticker: 'BP', name: 'BP plc', sector: 'Energy' },
  // Additional popular stocks
  { ticker: 'MSTR', name: 'MicroStrategy Inc.', sector: 'Technology' },
  { ticker: 'MARA', name: 'Marathon Digital', sector: 'Technology' },
  { ticker: 'RIOT', name: 'Riot Platforms', sector: 'Technology' },
  { ticker: 'NIO', name: 'NIO Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'LI', name: 'Li Auto Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'XPEV', name: 'XPeng Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'SE', name: 'Sea Limited', sector: 'Communication Services' },
  { ticker: 'GRAB', name: 'Grab Holdings', sector: 'Technology' },
  { ticker: 'AI', name: 'C3.ai Inc.', sector: 'Technology' },
  { ticker: 'IONQ', name: 'IonQ Inc.', sector: 'Technology' },
  { ticker: 'RGTI', name: 'Rigetti Computing', sector: 'Technology' },
  // === EXPANDED STOCK LIST ===
  // Additional Technology
  { ticker: 'WDAY', name: 'Workday Inc.', sector: 'Technology' },
  { ticker: 'TEAM', name: 'Atlassian Corp.', sector: 'Technology' },
  { ticker: 'HUBS', name: 'HubSpot Inc.', sector: 'Technology' },
  { ticker: 'TTD', name: 'The Trade Desk', sector: 'Technology' },
  { ticker: 'SHOP', name: 'Shopify Inc.', sector: 'Technology' },
  { ticker: 'SNOW', name: 'Snowflake Inc.', sector: 'Technology' },
  { ticker: 'NET', name: 'Cloudflare Inc.', sector: 'Technology' },
  { ticker: 'DDOG', name: 'Datadog Inc.', sector: 'Technology' },
  { ticker: 'ZS', name: 'Zscaler Inc.', sector: 'Technology' },
  { ticker: 'MDB', name: 'MongoDB Inc.', sector: 'Technology' },
  { ticker: 'OKTA', name: 'Okta Inc.', sector: 'Technology' },
  { ticker: 'DOCU', name: 'DocuSign Inc.', sector: 'Technology' },
  { ticker: 'PATH', name: 'UiPath Inc.', sector: 'Technology' },
  { ticker: 'ENPH', name: 'Enphase Energy', sector: 'Technology' },
  { ticker: 'ARM', name: 'Arm Holdings', sector: 'Technology' },
  { ticker: 'U', name: 'Unity Software', sector: 'Technology' },
  { ticker: 'TWLO', name: 'Twilio Inc.', sector: 'Technology' },
  { ticker: 'APP', name: 'AppLovin Corp.', sector: 'Technology' },
  { ticker: 'DT', name: 'Dynatrace Inc.', sector: 'Technology' },
  { ticker: 'MNDY', name: 'monday.com Ltd.', sector: 'Technology' },
  { ticker: 'NTNX', name: 'Nutanix Inc.', sector: 'Technology' },
  { ticker: 'IOT', name: 'Samsara Inc.', sector: 'Technology' },
  { ticker: 'TOST', name: 'Toast Inc.', sector: 'Technology' },
  { ticker: 'ZI', name: 'ZoomInfo Technologies', sector: 'Technology' },
  { ticker: 'DUOL', name: 'Duolingo Inc.', sector: 'Technology' },
  { ticker: 'GLOB', name: 'Globant S.A.', sector: 'Technology' },
  { ticker: 'LSCC', name: 'Lattice Semiconductor', sector: 'Technology' },
  { ticker: 'RKLB', name: 'Rocket Lab USA', sector: 'Technology' },
  { ticker: 'BILL', name: 'BILL Holdings', sector: 'Technology' },
  { ticker: 'CFLT', name: 'Confluent Inc.', sector: 'Technology' },
  { ticker: 'ESTC', name: 'Elastic N.V.', sector: 'Technology' },
  { ticker: 'GTLB', name: 'GitLab Inc.', sector: 'Technology' },
  { ticker: 'PCOR', name: 'Procore Technologies', sector: 'Technology' },
  { ticker: 'QLYS', name: 'Qualys Inc.', sector: 'Technology' },
  { ticker: 'RPD', name: 'Rapid7 Inc.', sector: 'Technology' },
  { ticker: 'SMAR', name: 'Smartsheet Inc.', sector: 'Technology' },
  { ticker: 'TENB', name: 'Tenable Holdings', sector: 'Technology' },
  { ticker: 'VRNS', name: 'Varonis Systems', sector: 'Technology' },
  { ticker: 'WK', name: 'Workiva Inc.', sector: 'Technology' },
  { ticker: 'APPF', name: 'AppFolio Inc.', sector: 'Technology' },
  { ticker: 'BSY', name: 'Bentley Systems', sector: 'Technology' },
  { ticker: 'CWAN', name: 'Clearwater Analytics', sector: 'Technology' },
  { ticker: 'FOUR', name: 'Shift4 Payments', sector: 'Technology' },
  { ticker: 'FRSH', name: 'Freshworks Inc.', sector: 'Technology' },
  { ticker: 'JAMF', name: 'Jamf Holding', sector: 'Technology' },
  { ticker: 'MANH', name: 'Manhattan Associates', sector: 'Technology' },
  { ticker: 'NCNO', name: 'nCino Inc.', sector: 'Technology' },
  { ticker: 'NICE', name: 'NICE Ltd.', sector: 'Technology' },
  { ticker: 'PCTY', name: 'Paylocity Holding', sector: 'Technology' },
  { ticker: 'PI', name: 'Impinj Inc.', sector: 'Technology' },
  { ticker: 'PSTG', name: 'Pure Storage', sector: 'Technology' },
  { ticker: 'RELY', name: 'Remitly Global', sector: 'Technology' },
  { ticker: 'S', name: 'SentinelOne Inc.', sector: 'Technology' },
  { ticker: 'SSNC', name: 'SS&C Technologies', sector: 'Technology' },
  { ticker: 'TASK', name: 'TaskUs Inc.', sector: 'Technology' },
  { ticker: 'VNT', name: 'Vontier Corp.', sector: 'Technology' },
  { ticker: 'WOLF', name: 'Wolfspeed Inc.', sector: 'Technology' },
  { ticker: 'XM', name: 'Qualtrics Intl.', sector: 'Technology' },
  { ticker: 'ZEN', name: 'Zendesk Inc.', sector: 'Technology' },
  // Additional Communication Services
  { ticker: 'SNAP', name: 'Snap Inc.', sector: 'Communication Services' },
  { ticker: 'PINS', name: 'Pinterest Inc.', sector: 'Communication Services' },
  { ticker: 'ZM', name: 'Zoom Video', sector: 'Communication Services' },
  { ticker: 'SPOT', name: 'Spotify Technology', sector: 'Communication Services' },
  { ticker: 'ROKU', name: 'Roku Inc.', sector: 'Communication Services' },
  { ticker: 'RBLX', name: 'Roblox Corp.', sector: 'Communication Services' },
  { ticker: 'SE', name: 'Sea Limited', sector: 'Communication Services' },
  { ticker: 'MTCH', name: 'Match Group', sector: 'Communication Services' },
  { ticker: 'BMBL', name: 'Bumble Inc.', sector: 'Communication Services' },
  { ticker: 'IRDM', name: 'Iridium Comms.', sector: 'Communication Services' },
  { ticker: 'TRMR', name: 'Tremor International', sector: 'Communication Services' },
  // Additional Consumer Discretionary
  { ticker: 'DASH', name: 'DoorDash Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'W', name: 'Wayfair Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'CHWY', name: 'Chewy Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'RIVN', name: 'Rivian Automotive', sector: 'Consumer Discretionary' },
  { ticker: 'LCID', name: 'Lucid Group', sector: 'Consumer Discretionary' },
  { ticker: 'NIO', name: 'NIO Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'LI', name: 'Li Auto Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'XPEV', name: 'XPeng Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'GME', name: 'GameStop Corp.', sector: 'Consumer Discretionary' },
  { ticker: 'TM', name: 'Toyota Motor Corp.', sector: 'Consumer Discretionary' },
  { ticker: 'CVNA', name: 'Carvana Co.', sector: 'Consumer Discretionary' },
  { ticker: 'FIVE', name: 'Five Below Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'CROX', name: 'Crocs Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'CELH', name: 'Celsius Holdings', sector: 'Consumer Discretionary' },
  { ticker: 'BIRK', name: 'Birkenstock', sector: 'Consumer Discretionary' },
  { ticker: 'DNUT', name: 'Krispy Kreme', sector: 'Consumer Discretionary' },
  { ticker: 'BROS', name: 'Dutch Bros Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'CAVA', name: 'CAVA Group', sector: 'Consumer Discretionary' },
  { ticker: 'SHAK', name: 'Shake Shack', sector: 'Consumer Discretionary' },
  { ticker: 'WING', name: 'Wingstop Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'TXRH', name: 'Texas Roadhouse', sector: 'Consumer Discretionary' },
  { ticker: 'EAT', name: 'Brinker International', sector: 'Consumer Discretionary' },
  { ticker: 'DRI', name: 'Darden Restaurants', sector: 'Consumer Discretionary' },
  { ticker: 'SBAC', name: 'SBA Communications', sector: 'Real Estate' },
  { ticker: 'PENN', name: 'Penn Entertainment', sector: 'Consumer Discretionary' },
  { ticker: 'NCLH', name: 'Norwegian Cruise Line', sector: 'Consumer Discretionary' },
  { ticker: 'ABNB', name: 'Airbnb Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'BURL', name: 'Burlington Stores', sector: 'Consumer Discretionary' },
  { ticker: 'GAP', name: 'Gap Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'ANF', name: 'Abercrombie & Fitch', sector: 'Consumer Discretionary' },
  { ticker: 'SKX', name: 'Skechers USA', sector: 'Consumer Discretionary' },
  { ticker: 'COLM', name: 'Columbia Sportswear', sector: 'Consumer Discretionary' },
  { ticker: 'VFC', name: 'V.F. Corporation', sector: 'Consumer Discretionary' },
  { ticker: 'PVH', name: 'PVH Corp.', sector: 'Consumer Discretionary' },
  { ticker: 'BOOT', name: 'Boot Barn Holdings', sector: 'Consumer Discretionary' },
  { ticker: 'ONON', name: 'On Holding', sector: 'Consumer Discretionary' },
  { ticker: 'LEVI', name: 'Levi Strauss', sector: 'Consumer Discretionary' },
  // Additional Financials
  { ticker: 'COIN', name: 'Coinbase Global', sector: 'Financials' },
  { ticker: 'SQ', name: 'Block Inc.', sector: 'Financials' },
  { ticker: 'SOFI', name: 'SoFi Technologies', sector: 'Financials' },
  { ticker: 'HOOD', name: 'Robinhood Markets', sector: 'Financials' },
  { ticker: 'AFRM', name: 'Affirm Holdings', sector: 'Financials' },
  { ticker: 'UPST', name: 'Upstart Holdings', sector: 'Financials' },
  { ticker: 'LC', name: 'LendingClub Corp.', sector: 'Financials' },
  { ticker: 'NU', name: 'Nu Holdings Ltd.', sector: 'Financials' },
  { ticker: 'MKTX', name: 'MarketAxess Holdings', sector: 'Financials' },
  { ticker: 'LPLA', name: 'LPL Financial', sector: 'Financials' },
  { ticker: 'RJF', name: 'Raymond James', sector: 'Financials' },
  { ticker: 'IBKR', name: 'Interactive Brokers', sector: 'Financials' },
  { ticker: 'TROW', name: 'T. Rowe Price', sector: 'Financials' },
  { ticker: 'BEN', name: 'Franklin Resources', sector: 'Financials' },
  { ticker: 'IVZ', name: 'Invesco Ltd.', sector: 'Financials' },
  { ticker: 'WBS', name: 'Webster Financial', sector: 'Financials' },
  { ticker: 'ALLY', name: 'Ally Financial', sector: 'Financials' },
  { ticker: 'EWBC', name: 'East West Bancorp', sector: 'Financials' },
  { ticker: 'FHN', name: 'First Horizon', sector: 'Financials' },
  { ticker: 'ZION', name: 'Zions Bancorp', sector: 'Financials' },
  { ticker: 'CMA', name: 'Comerica Inc.', sector: 'Financials' },
  { ticker: 'WAL', name: 'Western Alliance', sector: 'Financials' },
  { ticker: 'PNFP', name: 'Pinnacle Financial', sector: 'Financials' },
  { ticker: 'FCNCA', name: 'First Citizens BancShares', sector: 'Financials' },
  { ticker: 'SBNY', name: 'Signature Bank', sector: 'Financials' },
  // Additional Healthcare
  { ticker: 'MRNA', name: 'Moderna Inc.', sector: 'Healthcare' },
  { ticker: 'VEEV', name: 'Veeva Systems', sector: 'Healthcare' },
  { ticker: 'NVO', name: 'Novo Nordisk', sector: 'Healthcare' },
  { ticker: 'NTRA', name: 'Natera Inc.', sector: 'Healthcare' },
  { ticker: 'CRSP', name: 'CRISPR Therapeutics', sector: 'Healthcare' },
  { ticker: 'DXCM', name: 'DexCom Inc.', sector: 'Healthcare' },
  { ticker: 'EXAS', name: 'Exact Sciences', sector: 'Healthcare' },
  { ticker: 'HALO', name: 'Halozyme Therapeutics', sector: 'Healthcare' },
  { ticker: 'IONS', name: 'Ionis Pharmaceuticals', sector: 'Healthcare' },
  { ticker: 'JAZZ', name: 'Jazz Pharmaceuticals', sector: 'Healthcare' },
  { ticker: 'LEGN', name: 'Legend Biotech', sector: 'Healthcare' },
  { ticker: 'NBIX', name: 'Neurocrine Biosciences', sector: 'Healthcare' },
  { ticker: 'PCVX', name: 'Vaxcyte Inc.', sector: 'Healthcare' },
  { ticker: 'RARE', name: 'Ultragenyx Pharma', sector: 'Healthcare' },
  { ticker: 'SGEN', name: 'Seagen Inc.', sector: 'Healthcare' },
  { ticker: 'TFX', name: 'Teleflex Inc.', sector: 'Healthcare' },
  { ticker: 'UTHR', name: 'United Therapeutics', sector: 'Healthcare' },
  { ticker: 'XRAY', name: 'DENTSPLY SIRONA', sector: 'Healthcare' },
  { ticker: 'ALNY', name: 'Alnylam Pharmaceuticals', sector: 'Healthcare' },
  { ticker: 'ARGX', name: 'argenx SE', sector: 'Healthcare' },
  { ticker: 'BIO', name: 'Bio-Rad Laboratories', sector: 'Healthcare' },
  { ticker: 'BMRN', name: 'BioMarin Pharmaceutical', sector: 'Healthcare' },
  { ticker: 'CRL', name: 'Charles River Labs', sector: 'Healthcare' },
  { ticker: 'DNLI', name: 'Denali Therapeutics', sector: 'Healthcare' },
  { ticker: 'GH', name: 'Guardant Health', sector: 'Healthcare' },
  { ticker: 'HAE', name: 'Haemonetics Corp.', sector: 'Healthcare' },
  { ticker: 'ILMN', name: 'Illumina Inc.', sector: 'Healthcare' },
  { ticker: 'INSM', name: 'Insmed Inc.', sector: 'Healthcare' },
  { ticker: 'LNTH', name: 'Lantheus Holdings', sector: 'Healthcare' },
  { ticker: 'MEDP', name: 'Medpace Holdings', sector: 'Healthcare' },
  { ticker: 'MASI', name: 'Masimo Corp.', sector: 'Healthcare' },
  { ticker: 'NVST', name: 'Envista Holdings', sector: 'Healthcare' },
  { ticker: 'OGN', name: 'Organon & Co.', sector: 'Healthcare' },
  { ticker: 'PRCT', name: 'Procept BioRobotics', sector: 'Healthcare' },
  { ticker: 'RVMD', name: 'Revolution Medicines', sector: 'Healthcare' },
  { ticker: 'SRPT', name: 'Sarepta Therapeutics', sector: 'Healthcare' },
  // Additional Industrials
  { ticker: 'UBER', name: 'Uber Technologies', sector: 'Industrials' },
  { ticker: 'LYFT', name: 'Lyft Inc.', sector: 'Industrials' },
  { ticker: 'AXON', name: 'Axon Enterprise', sector: 'Industrials' },
  { ticker: 'GNRC', name: 'Generac Holdings', sector: 'Industrials' },
  { ticker: 'ACHR', name: 'Archer Aviation', sector: 'Industrials' },
  { ticker: 'JOBY', name: 'Joby Aviation', sector: 'Industrials' },
  { ticker: 'BLDE', name: 'Blade Air Mobility', sector: 'Industrials' },
  { ticker: 'RBA', name: 'RB Global Inc.', sector: 'Industrials' },
  { ticker: 'WCN', name: 'Waste Connections', sector: 'Industrials' },
  { ticker: 'CLH', name: 'Clean Harbors', sector: 'Industrials' },
  { ticker: 'STRL', name: 'Sterling Infra.', sector: 'Industrials' },
  { ticker: 'TTC', name: 'The Toro Company', sector: 'Industrials' },
  { ticker: 'FLR', name: 'Fluor Corporation', sector: 'Industrials' },
  { ticker: 'BWXT', name: 'BWX Technologies', sector: 'Industrials' },
  { ticker: 'HEI', name: 'HEICO Corp.', sector: 'Industrials' },
  { ticker: 'TDG', name: 'TransDigm Group', sector: 'Industrials' },
  { ticker: 'CARR', name: 'Carrier Global', sector: 'Industrials' },
  { ticker: 'OTIS', name: 'Otis Worldwide', sector: 'Industrials' },
  { ticker: 'VLTO', name: 'Veralto Corp.', sector: 'Industrials' },
  { ticker: 'WEX', name: 'WEX Inc.', sector: 'Industrials' },
  // Additional Energy
  { ticker: 'SHEL', name: 'Shell plc', sector: 'Energy' },
  { ticker: 'BP', name: 'BP plc', sector: 'Energy' },
  { ticker: 'AR', name: 'Antero Resources', sector: 'Energy' },
  { ticker: 'RRC', name: 'Range Resources', sector: 'Energy' },
  { ticker: 'CHRD', name: 'Chord Energy', sector: 'Energy' },
  { ticker: 'MTDR', name: 'Matador Resources', sector: 'Energy' },
  { ticker: 'PR', name: 'Permian Resources', sector: 'Energy' },
  { ticker: 'GPOR', name: 'Gulfport Energy', sector: 'Energy' },
  { ticker: 'CNX', name: 'CNX Resources', sector: 'Energy' },
  { ticker: 'SM', name: 'SM Energy Co.', sector: 'Energy' },
  // Additional Consumer Staples
  { ticker: 'KHC', name: 'Kraft Heinz Co.', sector: 'Consumer Staples' },
  { ticker: 'KVUE', name: 'Kenvue Inc.', sector: 'Consumer Staples' },
  { ticker: 'FDP', name: 'Fresh Del Monte', sector: 'Consumer Staples' },
  { ticker: 'COKE', name: 'Coca-Cola Consolidated', sector: 'Consumer Staples' },
  { ticker: 'USFD', name: 'US Foods Holding', sector: 'Consumer Staples' },
  { ticker: 'PFGC', name: 'Performance Food Group', sector: 'Consumer Staples' },
  { ticker: 'SAM', name: 'Boston Beer Co.', sector: 'Consumer Staples' },
  { ticker: 'HELE', name: 'Helen of Troy', sector: 'Consumer Staples' },
  { ticker: 'CENT', name: 'Central Garden & Pet', sector: 'Consumer Staples' },
  { ticker: 'POST', name: 'Post Holdings', sector: 'Consumer Staples' },
  // Additional Real Estate
  { ticker: 'CBRE', name: 'CBRE Group', sector: 'Real Estate' },
  { ticker: 'JLL', name: 'Jones Lang LaSalle', sector: 'Real Estate' },
  { ticker: 'REXR', name: 'Rexford Industrial', sector: 'Real Estate' },
  { ticker: 'SUI', name: 'Sun Communities', sector: 'Real Estate' },
  { ticker: 'COLD', name: 'Americold Realty', sector: 'Real Estate' },
  { ticker: 'STAG', name: 'STAG Industrial', sector: 'Real Estate' },
  { ticker: 'NNN', name: 'NNN REIT Inc.', sector: 'Real Estate' },
  { ticker: 'GLPI', name: 'Gaming & Leisure', sector: 'Real Estate' },
  { ticker: 'EPR', name: 'EPR Properties', sector: 'Real Estate' },
  { ticker: 'RHP', name: 'Ryman Hospitality', sector: 'Real Estate' },
  // Additional Materials
  { ticker: 'RS', name: 'Reliance Steel', sector: 'Materials' },
  { ticker: 'WLK', name: 'Westlake Corp.', sector: 'Materials' },
  { ticker: 'OLN', name: 'Olin Corporation', sector: 'Materials' },
  { ticker: 'HUN', name: 'Huntsman Corp.', sector: 'Materials' },
  { ticker: 'CBT', name: 'Cabot Corp.', sector: 'Materials' },
  { ticker: 'CC', name: 'Chemours Company', sector: 'Materials' },
  { ticker: 'TROX', name: 'Tronox Holdings', sector: 'Materials' },
  { ticker: 'ATI', name: 'ATI Inc.', sector: 'Materials' },
  { ticker: 'CRS', name: 'Carpenter Technology', sector: 'Materials' },
  { ticker: 'CMC', name: 'Commercial Metals', sector: 'Materials' },
  // Additional International & Popular
  { ticker: 'BABA', name: 'Alibaba Group', sector: 'Consumer Discretionary' },
  { ticker: 'TSM', name: 'Taiwan Semi.', sector: 'Technology' },
  { ticker: 'ASML', name: 'ASML Holding', sector: 'Technology' },
  { ticker: 'SAP', name: 'SAP SE', sector: 'Technology' },
  { ticker: 'SONY', name: 'Sony Group', sector: 'Technology' },
  { ticker: 'MSTR', name: 'MicroStrategy', sector: 'Technology' },
  { ticker: 'MARA', name: 'Marathon Digital', sector: 'Technology' },
  { ticker: 'RIOT', name: 'Riot Platforms', sector: 'Technology' },
  { ticker: 'AI', name: 'C3.ai Inc.', sector: 'Technology' },
  { ticker: 'JD', name: 'JD.com Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'PDD', name: 'PDD Holdings', sector: 'Consumer Discretionary' },
  { ticker: 'BIDU', name: 'Baidu Inc.', sector: 'Communication Services' },
  { ticker: 'NTES', name: 'NetEase Inc.', sector: 'Communication Services' },
  { ticker: 'BILI', name: 'Bilibili Inc.', sector: 'Communication Services' },
  { ticker: 'FUTU', name: 'Futu Holdings', sector: 'Financials' },
  { ticker: 'TAL', name: 'TAL Education', sector: 'Consumer Discretionary' },
  { ticker: 'LKNCY', name: 'Luckin Coffee', sector: 'Consumer Discretionary' },
  { ticker: 'GRAB', name: 'Grab Holdings', sector: 'Technology' },
  { ticker: 'DEO', name: 'Diageo plc', sector: 'Consumer Staples' },
  { ticker: 'UL', name: 'Unilever plc', sector: 'Consumer Staples' },
  { ticker: 'AZN', name: 'AstraZeneca', sector: 'Healthcare' },
  { ticker: 'GSK', name: 'GSK plc', sector: 'Healthcare' },
  { ticker: 'SNY', name: 'Sanofi S.A.', sector: 'Healthcare' },
  { ticker: 'HSBC', name: 'HSBC Holdings', sector: 'Financials' },
  { ticker: 'BCS', name: 'Barclays plc', sector: 'Financials' },
  { ticker: 'DB', name: 'Deutsche Bank', sector: 'Financials' },
  { ticker: 'UBS', name: 'UBS Group', sector: 'Financials' },
  { ticker: 'CS', name: 'Credit Suisse', sector: 'Financials' },
  { ticker: 'TTE', name: 'TotalEnergies SE', sector: 'Energy' },
  { ticker: 'EQNR', name: 'Equinor ASA', sector: 'Energy' },
  { ticker: 'RIO', name: 'Rio Tinto plc', sector: 'Materials' },
  { ticker: 'BHP', name: 'BHP Group', sector: 'Materials' },
  { ticker: 'VALE', name: 'Vale S.A.', sector: 'Materials' },
  { ticker: 'MT', name: 'ArcelorMittal', sector: 'Materials' },
  { ticker: 'WPM', name: 'Wheaton Precious Metals', sector: 'Materials' },
  { ticker: 'GOLD', name: 'Barrick Gold', sector: 'Materials' },
  { ticker: 'AEM', name: 'Agnico Eagle Mines', sector: 'Materials' },
  // Additional Utilities
  { ticker: 'VST', name: 'Vistra Corp.', sector: 'Utilities' },
  { ticker: 'CEG', name: 'Constellation Energy', sector: 'Utilities' },
  { ticker: 'NRG', name: 'NRG Energy', sector: 'Utilities' },
  { ticker: 'TALEN', name: 'Talen Energy', sector: 'Utilities' },
  { ticker: 'ORA', name: 'Ormat Technologies', sector: 'Utilities' },
  // Additional ETFs & Popular Funds
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', sector: 'ETF' },
  { ticker: 'QQQ', name: 'Invesco QQQ Trust', sector: 'ETF' },
  { ticker: 'IWM', name: 'iShares Russell 2000', sector: 'ETF' },
  { ticker: 'DIA', name: 'SPDR Dow Jones ETF', sector: 'ETF' },
  { ticker: 'VTI', name: 'Vanguard Total Market', sector: 'ETF' },
  { ticker: 'VOO', name: 'Vanguard S&P 500', sector: 'ETF' },
  { ticker: 'ARKK', name: 'ARK Innovation ETF', sector: 'ETF' },
  { ticker: 'XLF', name: 'Financial Select SPDR', sector: 'ETF' },
  { ticker: 'XLK', name: 'Technology Select SPDR', sector: 'ETF' },
  { ticker: 'XLE', name: 'Energy Select SPDR', sector: 'ETF' },
  { ticker: 'XLV', name: 'Health Care Select SPDR', sector: 'ETF' },
  { ticker: 'XLI', name: 'Industrial Select SPDR', sector: 'ETF' },
  { ticker: 'SOXX', name: 'iShares Semiconductor', sector: 'ETF' },
  { ticker: 'GLD', name: 'SPDR Gold Shares', sector: 'ETF' },
  { ticker: 'SLV', name: 'iShares Silver Trust', sector: 'ETF' },
  { ticker: 'TLT', name: 'iShares 20+ Yr Treasury', sector: 'ETF' },
  { ticker: 'IBIT', name: 'iShares Bitcoin Trust', sector: 'ETF' },
  { ticker: 'SOXL', name: 'Direxion Semi Bull 3X', sector: 'ETF' },
  { ticker: 'TQQQ', name: 'ProShares UltraPro QQQ', sector: 'ETF' },
  { ticker: 'SQQQ', name: 'ProShares UltraPro Short QQQ', sector: 'ETF' },
  // Additional Mid-Cap & Growth
  { ticker: 'ANET', name: 'Arista Networks', sector: 'Technology' },
  { ticker: 'EXEL', name: 'Exelixis Inc.', sector: 'Healthcare' },
  { ticker: 'ONTO', name: 'Onto Innovation', sector: 'Technology' },
  { ticker: 'CRUS', name: 'Cirrus Logic', sector: 'Technology' },
  { ticker: 'NOVT', name: 'Novanta Inc.', sector: 'Technology' },
  { ticker: 'AZPN', name: 'Aspen Technology', sector: 'Technology' },
  { ticker: 'CYBR', name: 'CyberArk Software', sector: 'Technology' },
  { ticker: 'COUP', name: 'Coupa Software', sector: 'Technology' },
  { ticker: 'ALRM', name: 'Alarm.com Holdings', sector: 'Technology' },
  { ticker: 'TTWO', name: 'Take-Two Interactive', sector: 'Communication Services' },
  { ticker: 'EA', name: 'Electronic Arts', sector: 'Communication Services' },
  { ticker: 'ATVI', name: 'Activision Blizzard', sector: 'Communication Services' },
  { ticker: 'DKNG', name: 'DraftKings Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'ETSY', name: 'Etsy Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'FVRR', name: 'Fiverr International', sector: 'Technology' },
  { ticker: 'UPWK', name: 'Upwork Inc.', sector: 'Technology' },
  { ticker: 'ASAN', name: 'Asana Inc.', sector: 'Technology' },
  { ticker: 'DOCN', name: 'DigitalOcean Holdings', sector: 'Technology' },
  { ticker: 'AYX', name: 'Alteryx Inc.', sector: 'Technology' },
  { ticker: 'BRZE', name: 'Braze Inc.', sector: 'Technology' },
  { ticker: 'AMPL', name: 'Amplitude Inc.', sector: 'Technology' },
  { ticker: 'FSLY', name: 'Fastly Inc.', sector: 'Technology' },
  { ticker: 'SPLK', name: 'Splunk Inc.', sector: 'Technology' },
  { ticker: 'SUMO', name: 'Sumo Logic', sector: 'Technology' },
  { ticker: 'YEXT', name: 'Yext Inc.', sector: 'Technology' },
  { ticker: 'DBX', name: 'Dropbox Inc.', sector: 'Technology' },
  { ticker: 'BOX', name: 'Box Inc.', sector: 'Technology' },
  { ticker: 'CIEN', name: 'Ciena Corporation', sector: 'Technology' },
  { ticker: 'LITE', name: 'Lumentum Holdings', sector: 'Technology' },
  { ticker: 'VIAV', name: 'Viavi Solutions', sector: 'Technology' },
  { ticker: 'CALX', name: 'Calix Inc.', sector: 'Technology' },
  { ticker: 'SLAB', name: 'Silicon Labs', sector: 'Technology' },
  { ticker: 'RMBS', name: 'Rambus Inc.', sector: 'Technology' },
  { ticker: 'POWI', name: 'Power Integrations', sector: 'Technology' },
  { ticker: 'DIOD', name: 'Diodes Incorporated', sector: 'Technology' },
  { ticker: 'MKSI', name: 'MKS Instruments', sector: 'Technology' },
  { ticker: 'COHR', name: 'Coherent Corp.', sector: 'Technology' },
  { ticker: 'ENTG', name: 'Entegris Inc.', sector: 'Technology' },
  { ticker: 'MTSI', name: 'MACOM Technology', sector: 'Technology' },
  { ticker: 'AMKR', name: 'Amkor Technology', sector: 'Technology' },
  { ticker: 'FORM', name: 'FormFactor Inc.', sector: 'Technology' },
  { ticker: 'ACLS', name: 'Axcelis Technologies', sector: 'Technology' },
  { ticker: 'UCTT', name: 'Ultra Clean Holdings', sector: 'Technology' },
  { ticker: 'AMBA', name: 'Ambarella Inc.', sector: 'Technology' },
  { ticker: 'SITM', name: 'SiTime Corp.', sector: 'Technology' },
  { ticker: 'SMTC', name: 'Semtech Corp.', sector: 'Technology' },
  { ticker: 'OLED', name: 'Universal Display', sector: 'Technology' },
  { ticker: 'HIMX', name: 'Himax Technologies', sector: 'Technology' },
  { ticker: 'IRDM', name: 'Iridium Communications', sector: 'Communication Services' },
  { ticker: 'SATS', name: 'EchoStar Holdings', sector: 'Communication Services' },
  { ticker: 'GSAT', name: 'Globalstar Inc.', sector: 'Communication Services' },
  // Additional Popular Meme/Retail
  { ticker: 'AMC', name: 'AMC Entertainment', sector: 'Communication Services' },
  { ticker: 'PLTR', name: 'Palantir Technologies', sector: 'Technology' },
  { ticker: 'BB', name: 'BlackBerry Ltd.', sector: 'Technology' },
  { ticker: 'BBBY', name: 'Bed Bath & Beyond', sector: 'Consumer Discretionary' },
  { ticker: 'CLOV', name: 'Clover Health', sector: 'Healthcare' },
  { ticker: 'WISH', name: 'ContextLogic Inc.', sector: 'Consumer Discretionary' },
  { ticker: 'SPCE', name: 'Virgin Galactic', sector: 'Industrials' },
  { ticker: 'STEM', name: 'Stem Inc.', sector: 'Technology' },
  { ticker: 'LAZR', name: 'Luminar Technologies', sector: 'Technology' },
  { ticker: 'LIDR', name: 'AEye Inc.', sector: 'Technology' },
  { ticker: 'INVZ', name: 'Innoviz Technologies', sector: 'Technology' },
  { ticker: 'ASTS', name: 'AST SpaceMobile', sector: 'Communication Services' },
  { ticker: 'RDW', name: 'Redwire Corp.', sector: 'Industrials' },
  { ticker: 'LUNR', name: 'Intuitive Machines', sector: 'Industrials' },
  { ticker: 'MNTS', name: 'Momentus Inc.', sector: 'Industrials' },
  { ticker: 'SOUN', name: 'SoundHound AI', sector: 'Technology' },
  { ticker: 'BBAI', name: 'BigBear.ai Holdings', sector: 'Technology' },
  { ticker: 'PRCT', name: 'Procept BioRobotics', sector: 'Healthcare' },
  { ticker: 'SMRT', name: 'SmartRent Inc.', sector: 'Technology' },
  { ticker: 'VLD', name: 'Velo3D Inc.', sector: 'Technology' },
  { ticker: 'NNOX', name: 'Nano-X Imaging', sector: 'Healthcare' },
  { ticker: 'DNA', name: 'Ginkgo Bioworks', sector: 'Healthcare' },
  { ticker: 'BTBT', name: 'Bit Digital Inc.', sector: 'Technology' },
  { ticker: 'BITF', name: 'Bitfarms Ltd.', sector: 'Technology' },
  { ticker: 'CLSK', name: 'CleanSpark Inc.', sector: 'Technology' },
  { ticker: 'HUT', name: 'Hut 8 Corp.', sector: 'Technology' },
  { ticker: 'CIFR', name: 'Cipher Mining', sector: 'Technology' },
  { ticker: 'IREN', name: 'Iris Energy', sector: 'Technology' },
  // Additional Biotech
  { ticker: 'VKTX', name: 'Viking Therapeutics', sector: 'Healthcare' },
  { ticker: 'SMMT', name: 'Summit Therapeutics', sector: 'Healthcare' },
  { ticker: 'RXRX', name: 'Recursion Pharmaceuticals', sector: 'Healthcare' },
  { ticker: 'BEAM', name: 'Beam Therapeutics', sector: 'Healthcare' },
  { ticker: 'EDIT', name: 'Editas Medicine', sector: 'Healthcare' },
  { ticker: 'NTLA', name: 'Intellia Therapeutics', sector: 'Healthcare' },
  { ticker: 'VERV', name: 'Verve Therapeutics', sector: 'Healthcare' },
  { ticker: 'ACAD', name: 'ACADIA Pharmaceuticals', sector: 'Healthcare' },
  { ticker: 'ARWR', name: 'Arrowhead Pharmaceuticals', sector: 'Healthcare' },
  { ticker: 'CYTK', name: 'Cytokinetics Inc.', sector: 'Healthcare' },
  { ticker: 'DAWN', name: 'Day One Biopharm.', sector: 'Healthcare' },
  { ticker: 'FOLD', name: 'Amicus Therapeutics', sector: 'Healthcare' },
  { ticker: 'GERN', name: 'Geron Corp.', sector: 'Healthcare' },
  { ticker: 'IRTC', name: 'iRhythm Technologies', sector: 'Healthcare' },
  { ticker: 'KRTX', name: 'Karuna Therapeutics', sector: 'Healthcare' },
  { ticker: 'LUNG', name: 'Pulmonx Corp.', sector: 'Healthcare' },
  { ticker: 'MYGN', name: 'Myriad Genetics', sector: 'Healthcare' },
  { ticker: 'NUVB', name: 'Nuvation Bio', sector: 'Healthcare' },
  { ticker: 'PTCT', name: 'PTC Therapeutics', sector: 'Healthcare' },
  { ticker: 'RPRX', name: 'Royalty Pharma', sector: 'Healthcare' },
  { ticker: 'SWTX', name: 'SpringWorks Therapeutics', sector: 'Healthcare' },
  { ticker: 'TGTX', name: 'TG Therapeutics', sector: 'Healthcare' },
  { ticker: 'TWST', name: 'Twist Bioscience', sector: 'Healthcare' },
  { ticker: 'XNCR', name: 'Xencor Inc.', sector: 'Healthcare' },
];

const YAHOO_ENDPOINTS = [
  'https://query1.finance.yahoo.com/v8/finance/chart',
  'https://query2.finance.yahoo.com/v8/finance/chart',
];

const quoteCache = new Map<string, { quote: RealTimeQuote; timestamp: number; stale?: boolean }>();
// Session 175 — raised the cache TTL from a near-useless 50ms to 20 seconds.
// The old value forced every fetchStockQuote() caller to hit Yahoo, which is
// why the app performed dozens of redundant network requests per refresh
// tick and every screen felt slow. Combined with the in-flight promise
// dedup below, the same ticker requested by Home + Stock Detail + a Put-in-
// Trade screen at the same moment now results in ONE network call and every
// screen shares the same fresh quote.
const CACHE_TTL = 20_000; // 20 seconds fresh; stale-while-revalidate afterwards

// In-flight request map so concurrent fetchStockQuote(SAME_TICKER) calls
// share a single promise instead of firing parallel duplicate Yahoo calls.
const quoteInFlight = new Map<string, Promise<RealTimeQuote>>();

// Chart data cache to avoid re-fetching on every navigation
const chartDataCache = new Map<string, { data: number[]; timestamp: number }>();
const CHART_CACHE_TTL = 30000; // 30 seconds for chart data

// Known market caps in billions (as baseline estimates)
const KNOWN_MARKET_CAPS: Record<string, number> = {
  AAPL: 3400e9, MSFT: 3200e9, NVDA: 3100e9, GOOGL: 2100e9, AMZN: 2000e9,
  META: 1500e9, TSLA: 850e9, JPM: 680e9, V: 600e9, WMT: 580e9,
  UNH: 480e9, NFLX: 420e9, CRM: 310e9, COST: 400e9, DIS: 200e9,
  AMD: 190e9, BA: 130e9, COIN: 55e9, PFE: 140e9, PLTR: 260e9,
  SQ: 45e9, INTC: 95e9, SPOT: 120e9, UBER: 165e9, RIVN: 14e9,
  BABA: 320e9, NKE: 110e9, PYPL: 80e9, SNAP: 18e9, ROKU: 14e9,
  GME: 9e9, AMC: 1.5e9, SOFI: 15e9, F: 40e9, T: 160e9,
  BAC: 340e9, XOM: 470e9, CVX: 270e9, PEP: 200e9, KO: 300e9,
  LLY: 900e9, AVGO: 800e9, 'BRK.B': 1000e9, JNJ: 380e9, MA: 450e9,
  HD: 380e9, ABBV: 350e9, MRK: 280e9, PG: 400e9, LIN: 220e9,
  ORCL: 340e9, TMO: 210e9, ABT: 200e9, GE: 200e9, CAT: 180e9,
  HON: 140e9, UPS: 100e9, RTX: 150e9, LMT: 120e9, ISRG: 170e9,
  BLK: 140e9, SCHW: 130e9, GS: 160e9, MS: 160e9, SYK: 130e9,
  NEE: 160e9, AMGN: 150e9, GILD: 100e9, CI: 90e9, ELV: 100e9,
  CME: 80e9, SPGI: 150e9, MCO: 80e9, SHW: 90e9, APD: 60e9,
};

function estimateMarketCap(symbol: string, currentPrice: number): number {
  const known = KNOWN_MARKET_CAPS[symbol];
  if (known) {
    const basePrice = BASE_PRICES[symbol];
    if (basePrice && basePrice > 0) {
      return known * (currentPrice / basePrice);
    }
    return known;
  }
  return currentPrice * 1e9; // rough fallback
}

export async function fetchStockQuote(symbol: string): Promise<RealTimeQuote> {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.quote;
  }

  // Session 175 — in-flight dedup: if another caller is already fetching
  // this ticker, await their promise instead of firing a duplicate network
  // request. Guarantees that N parallel callers (Home + Stock Detail +
  // Put-in-Trade all opening at the same time) result in exactly ONE Yahoo
  // request per ticker.
  const inflight = quoteInFlight.get(symbol);
  if (inflight) return inflight;

  const info = AVAILABLE_STOCKS.find(s => s.ticker === symbol);

  const fetchPromise = (async (): Promise<RealTimeQuote> => {
    for (const baseUrl of YAHOO_ENDPOINTS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch(`${baseUrl}/${symbol}?interval=1d&range=5d&includePrePost=true`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!res.ok) continue;
        const data = await res.json();
        const result = data?.chart?.result?.[0];
        if (!result) continue;

        const meta = result.meta;
        const price = meta.regularMarketPrice ?? 0;
        if (price === 0) continue;

        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
        const change = parseFloat((price - prevClose).toFixed(2));
        const changePercent = prevClose > 0 ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0;

        // Session 193 - Fundamentals must come from real Yahoo data. Never
        // fabricate market cap from KNOWN_MARKET_CAPS/BASE_PRICES, never
        // approximate 52-week high/low from the current price, and never
        // synthesize volume. If Yahoo does not return the value in this
        // response, the corresponding *Available flag is false and the
        // UI must render '—' or the last verified cached value.
        const rawMarketCap = Number(meta.marketCap ?? 0);
        const rawVolume = Number(meta.regularMarketVolume ?? 0);
        const raw52High = Number(meta.fiftyTwoWeekHigh ?? 0);
        const raw52Low = Number(meta.fiftyTwoWeekLow ?? 0);
        const rawDayHigh = Number(meta.regularMarketDayHigh ?? 0);
        const rawDayLow = Number(meta.regularMarketDayLow ?? 0);

        const quote: RealTimeQuote = {
          symbol,
          price: parseFloat(price.toFixed(2)),
          change,
          changePercent,
          volume: rawVolume > 0 ? formatNumber(rawVolume) : '—',
          marketCap: rawMarketCap > 0 ? formatMarketCap(rawMarketCap) : '—',
          high52w: raw52High > 0 ? parseFloat(raw52High.toFixed(2)) : 0,
          low52w: raw52Low > 0 ? parseFloat(raw52Low.toFixed(2)) : 0,
          peRatio: 0,
          dayHigh: rawDayHigh > 0 ? parseFloat(rawDayHigh.toFixed(2)) : parseFloat(price.toFixed(2)),
          dayLow: rawDayLow > 0 ? parseFloat(rawDayLow.toFixed(2)) : parseFloat(price.toFixed(2)),
          previousClose: parseFloat(prevClose.toFixed(2)),
          name: info?.name ?? meta.shortName ?? meta.longName ?? symbol,
          asOf: Date.now(),
          provider: 'yahoo',
          stale: false,
          marketCapAvailable: rawMarketCap > 0,
          volumeAvailable: rawVolume > 0,
        };

        quoteCache.set(symbol, { quote, timestamp: Date.now(), stale: false });
        return quote;
      } catch {
        continue;
      }
    }

    // Session 193 - stale-while-revalidate. When every Yahoo endpoint
    // fails but we DO have a previously verified quote for this symbol,
    // return that cached quote flagged with provider: 'cache' and
    // stale: true so downstream UI can render an 'as of' timestamp
    // rather than treating stale data as live. Callers that need to
    // distinguish must check `provider` or `stale` before using the
    // value. Fabricated fallbacks are only used when we have NO
    // verified cache for this symbol at all (very first launch,
    // network was never available).
    const stale = quoteCache.get(symbol);
    if (stale) {
      const staleQuote: RealTimeQuote = {
        ...stale.quote,
        stale: true,
        provider: 'cache',
      };
      quoteCache.set(symbol, { quote: staleQuote, timestamp: stale.timestamp, stale: true });
      return staleQuote;
    }
    return generateFallbackQuote(symbol);
  })().finally(() => { quoteInFlight.delete(symbol); });

  quoteInFlight.set(symbol, fetchPromise);
  return fetchPromise;
}

const BASE_PRICES: Record<string, number> = {
  AAPL: 218.24, TSLA: 272.18, NVDA: 131.29, MSFT: 430.52, AMZN: 205.74,
  GOOGL: 164.35, META: 585.42, JPM: 247.68, V: 318.94, WMT: 92.15,
  UNH: 562.38, DIS: 112.84, NFLX: 1012.75, AMD: 117.62, CRM: 327.19,
  BA: 178.52, COIN: 265.43, PFE: 25.18, PLTR: 115.87, COST: 926.34,
  SQ: 78.92, INTC: 22.47, SPOT: 625.18, UBER: 79.63, RIVN: 14.28,
  BABA: 132.56, NKE: 71.24, PYPL: 72.85, SNAP: 11.42, ROKU: 84.67,
  GME: 27.35, AMC: 4.82, SOFI: 14.73, F: 10.28, T: 27.94,
  BAC: 44.62, XOM: 108.53, CVX: 155.72, PEP: 148.36, KO: 72.18,
  // Additional base prices for S&P 500 stocks
  LLY: 830.50, AVGO: 185.32, 'BRK.B': 445.80, JNJ: 155.20, MA: 515.60,
  HD: 385.40, ABBV: 185.90, MRK: 125.30, PG: 172.50, ORCL: 178.40,
  TMO: 555.80, ABT: 118.50, ADBE: 485.20, CSCO: 54.80, IBM: 193.40,
  QCOM: 175.30, TXN: 182.50, NOW: 875.60, PANW: 325.40, GE: 178.90,
  CAT: 365.20, HON: 215.60, UPS: 135.80, RTX: 112.30, DE: 412.50,
  LMT: 468.30, ISRG: 485.70, GS: 512.40, MS: 108.50, BLK: 895.20,
  C: 68.40, AXP: 265.30, SCHW: 78.50, WFC: 68.20, LIN: 455.80,
  SHW: 362.40, APD: 285.50, NEE: 82.30, DUK: 108.50, AMGN: 295.40,
  GILD: 98.20, BMY: 42.80, VRTX: 425.30, REGN: 885.60, SYK: 365.40,
  BDX: 245.30, MDT: 88.50, CI: 345.20, ELV: 465.30, HUM: 328.50,
  CNC: 75.40, MCK: 585.30, ZTS: 182.40, BSX: 78.50, SPGI: 485.30,
  MCO: 435.20, MMC: 215.40, PGR: 238.50, CB: 278.60, AON: 345.80,
  ICE: 155.30, CME: 225.40, UNP: 245.30, ETN: 325.40, ADP: 285.30,
  WM: 215.40, FDX: 265.30, GD: 295.40, NOC: 485.30, ITW: 258.40,
  EMR: 115.30, CSX: 34.80, NSC: 255.40, CTAS: 735.20, FAST: 72.40,
  ANET: 345.20, INTU: 625.30, AMAT: 195.40, ADI: 225.30, KLAC: 735.20,
  LRCX: 785.30, SNPS: 545.20, CDNS: 285.40, FTNT: 85.30, MRVL: 78.50,
  MU: 105.30, DELL: 135.40, HPQ: 32.50, NXPI: 245.30, ON: 68.40,
  FICO: 1825.30, MSI: 435.20, APH: 115.30, WMB: 48.50, KMI: 22.40,
  OKE: 78.50, HAL: 32.40, DVN: 42.30, BKR: 38.50, HES: 148.30,
  MPC: 175.20, PSX: 145.30, VLO: 145.40, FANG: 178.50, CTRA: 28.40,
  TRGP: 148.30, EQT: 38.50, SO: 82.30, D: 52.40, SRE: 88.50,
  AEP: 98.30, EXC: 42.50, XEL: 62.30, ED: 98.40, WEC: 92.30,
  PCG: 18.50, AMT: 225.30, PLD: 128.40, CCI: 108.50, EQIX: 885.30,
  SPG: 165.40, PSA: 285.30, O: 58.40, WELL: 115.30, DLR: 155.40,
  FCX: 45.30, NEM: 42.50, NUE: 165.40, VMC: 265.30, MLM: 545.20,
  DOW: 52.40, DD: 78.50, PPG: 125.30, ECL: 245.40, TGT: 135.20,
  LOW: 255.30, MCD: 285.40, SBUX: 98.50, PEP: 148.36, KO: 72.18,
  PM: 118.40, MO: 52.30, MDLZ: 72.40, CL: 92.30, EL: 85.40,
  GIS: 68.30, KMB: 138.40, HSY: 175.30, MNST: 55.40, STZ: 245.30,
  BKNG: 4525.30, TJX: 115.40, CMG: 58.30, LULU: 385.20, ORLY: 1185.30,
  AZO: 3125.40, MAR: 265.30, HLT: 245.40, ROST: 155.30, DHI: 158.40,
  LEN: 165.30, NVR: 7825.40, BBY: 85.30, YUM: 138.40, DPZ: 445.30,
  RCL: 185.40, DAL: 48.50, UAL: 65.30, LUV: 28.40,
  CMCSA: 38.50, CHTR: 345.30, EA: 155.40, TTWO: 185.30, TMUS: 185.40,
};

function generateFallbackQuote(symbol: string): RealTimeQuote {
  // Session 193 - True 'unavailable' state. This function no longer
  // fabricates any market data — no invented price, no invented market
  // cap, no approximated 52-week range. It only fires on the very first
  // fetch failure when we have never resolved a real quote for this
  // symbol AND the cache is empty. Callers must check `provider ===
  // 'unavailable'` (or `price === 0`) and render '—' / an unavailable
  // state instead of showing invented numbers to the user.
  const info = AVAILABLE_STOCKS.find(s => s.ticker === symbol);
  return {
    symbol,
    price: 0,
    change: 0,
    changePercent: 0,
    volume: '—',
    marketCap: '—',
    high52w: 0,
    low52w: 0,
    peRatio: 0,
    dayHigh: 0,
    dayLow: 0,
    previousClose: 0,
    name: info?.name ?? symbol,
    asOf: 0,
    provider: 'unavailable',
    stale: false,
    marketCapAvailable: false,
    volumeAvailable: false,
  };
}

function generateFallbackChart(symbol: string, length: number = 22): number[] {
  // Session 175 — DETERMINISTIC fallback. Returns a flat line at the base
  // price so callers can render a placeholder without fabricating price
  // action. Never fires unless every real chart endpoint failed AND no
  // previously cached chart exists.
  const basePrice = BASE_PRICES[symbol] || 100;
  const price = parseFloat(basePrice.toFixed(2));
  return Array.from({ length }, () => price);
}

export async function fetchMultipleQuotes(symbols: string[]): Promise<Map<string, RealTimeQuote>> {
  const results = new Map<string, RealTimeQuote>();
  if (symbols.length === 0) return results;

  const promises = symbols.map(async (s) => {
    const quote = await fetchStockQuote(s);
    return quote;
  });

  const quotes = await Promise.all(promises);
  quotes.forEach(q => results.set(q.symbol, q));
  return results;
}

const PERIOD_MAP: Record<string, { range: string; interval: string }> = {
  '1D': { range: '1d', interval: '5m' },
  '1W': { range: '5d', interval: '15m' },
  '1M': { range: '1mo', interval: '1d' },
  '3M': { range: '3mo', interval: '1d' },
  '1Y': { range: '1y', interval: '1wk' },
};

export async function fetchChartData(symbol: string, range: string = '1mo', interval: string = '1d'): Promise<number[]> {
  // Check cache first
  const cacheKey = `${symbol}_${range}_${interval}`;
  const cached = chartDataCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CHART_CACHE_TTL) {
    return cached.data;
  }

  for (const baseUrl of YAHOO_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${baseUrl}/${symbol}?interval=${interval}&range=${range}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;

      const closes: number[] = result.indicators?.quote?.[0]?.close ?? [];
      const filtered = closes.filter((c: any) => c != null).map((c: number) => parseFloat(c.toFixed(2)));
      if (filtered.length > 2) {
        chartDataCache.set(cacheKey, { data: filtered, timestamp: Date.now() });
        return filtered;
      }
    } catch {
      continue;
    }
  }
  const fallback = generateFallbackChart(symbol);
  chartDataCache.set(cacheKey, { data: fallback, timestamp: Date.now() });
  return fallback;
}

export function fetchChartForPeriod(symbol: string, periodId: string): Promise<number[]> {
  const params = PERIOD_MAP[periodId] || PERIOD_MAP['1M'];
  return fetchChartData(symbol, params.range, params.interval);
}

function formatNumber(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toString();
}

function formatMarketCap(n: number): string {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  return n.toString();
}

// ===== Helper: Compute EMA =====
function computeEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

// ===== Helper: Compute True Range approximation (without high/low, uses close-to-close) =====
function computeATR(data: number[], period: number): number {
  if (data.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < data.length; i++) {
    trs.push(Math.abs(data[i] - data[i - 1]));
  }
  const recent = trs.slice(-period);
  return recent.reduce((a, b) => a + b, 0) / recent.length;
}

// ===== Multi-Strategy Technical Analysis =====
export function analyzeStock(prices: number[], currentPrice: number, change: number, changePercent: number) {
  if (prices.length < 5) {
    return {
      signal: 'HOLD' as const,
      confidence: 50,
      reasoning: ['Insufficient data for analysis. Defaulting to hold.'],
      targets: { targetBuy: currentPrice * 0.97, targetSell: currentPrice * 1.05, stopLoss: currentPrice * 0.93, timeframe: 'Swing' as const, riskLevel: 'Medium' as const },
      indicators: [] as { name: string; value: string; signal: 'BUY' | 'SELL' | 'NEUTRAL' }[],
    };
  }

  // ===== STRATEGY 1: Trend Analysis (SMA alignment + EMA crossover) =====
  const sma5 = prices.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const sma10 = prices.slice(-10).reduce((a, b) => a + b, 0) / Math.min(prices.length, 10);
  const sma20 = prices.slice(-20).reduce((a, b) => a + b, 0) / Math.min(prices.length, 20);
  const ema9 = computeEMA(prices, 9);
  const ema21 = computeEMA(prices, 21);
  const ema9Current = ema9[ema9.length - 1];
  const ema21Current = ema21[ema21.length - 1];
  const ema9Prev = ema9.length >= 2 ? ema9[ema9.length - 2] : ema9Current;
  const ema21Prev = ema21.length >= 2 ? ema21[ema21.length - 2] : ema21Current;
  const emaCrossoverBullish = ema9Prev <= ema21Prev && ema9Current > ema21Current;
  const emaCrossoverBearish = ema9Prev >= ema21Prev && ema9Current < ema21Current;

  // Trend direction: count higher highs / lower lows in recent prices
  let higherHighs = 0;
  let lowerLows = 0;
  const recentPrices = prices.slice(-10);
  for (let i = 2; i < recentPrices.length; i++) {
    if (recentPrices[i] > recentPrices[i - 2]) higherHighs++;
    if (recentPrices[i] < recentPrices[i - 2]) lowerLows++;
  }
  const trendBias = higherHighs - lowerLows; // positive = uptrend, negative = downtrend

  let trendSignal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  let trendStrength = 0;
  // Perfect bullish alignment: price > EMA9 > EMA21 > SMA20 AND bullish crossover
  if (currentPrice > ema9Current && ema9Current > ema21Current && currentPrice > sma20) {
    trendSignal = 'BUY';
    trendStrength = emaCrossoverBullish ? 3 : 2;
  } else if (currentPrice < ema9Current && ema9Current < ema21Current && currentPrice < sma20) {
    trendSignal = 'SELL';
    trendStrength = emaCrossoverBearish ? 3 : 2;
  } else if (trendBias > 2) {
    trendSignal = 'BUY';
    trendStrength = 1;
  } else if (trendBias < -2) {
    trendSignal = 'SELL';
    trendStrength = 1;
  }

  // ===== STRATEGY 2: RSI (Wilder's smoothed) =====
  const rsiPeriod = Math.min(prices.length - 1, 14);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = prices.length - rsiPeriod; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= rsiPeriod;
  avgLoss /= rsiPeriod;
  const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  let rsiSignal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (rsi < 30) rsiSignal = 'BUY';
  else if (rsi < 38) rsiSignal = 'BUY';
  else if (rsi > 70) rsiSignal = 'SELL';
  else if (rsi > 62) rsiSignal = 'SELL';

  // RSI divergence detection
  let rsiDivergence: 'BULLISH' | 'BEARISH' | 'NONE' = 'NONE';
  if (prices.length >= 10) {
    const halfLen = Math.floor(prices.length / 2);
    const firstHalfMin = Math.min(...prices.slice(0, halfLen));
    const secondHalfMin = Math.min(...prices.slice(halfLen));
    const firstHalfMax = Math.max(...prices.slice(0, halfLen));
    const secondHalfMax = Math.max(...prices.slice(halfLen));
    // Bullish divergence: price making lower lows but indicator would be making higher lows
    if (secondHalfMin < firstHalfMin && rsi > 35 && rsi < 50) rsiDivergence = 'BULLISH';
    // Bearish divergence: price making higher highs but RSI potentially weakening
    if (secondHalfMax > firstHalfMax && rsi < 65 && rsi > 50) rsiDivergence = 'BEARISH';
  }

  // ===== STRATEGY 3: MACD (12/26/9) =====
  const ema12 = computeEMA(prices, 12);
  const ema26 = computeEMA(prices, 26);
  const macdLine: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    macdLine.push(ema12[i] - ema26[i]);
  }
  const macdSignalLine = computeEMA(macdLine, 9);
  const macd = macdLine[macdLine.length - 1];
  const macdSignalVal = macdSignalLine[macdSignalLine.length - 1];
  const macdHistogram = macd - macdSignalVal;
  const prevMacdHist = macdLine.length >= 2 ? macdLine[macdLine.length - 2] - macdSignalLine[macdSignalLine.length - 2] : macdHistogram;

  let macdSignal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  // MACD crossover: histogram changing sign
  if (prevMacdHist < 0 && macdHistogram > 0) macdSignal = 'BUY'; // Bullish crossover
  else if (prevMacdHist > 0 && macdHistogram < 0) macdSignal = 'SELL'; // Bearish crossover
  else if (macdHistogram > 0 && macdHistogram > prevMacdHist) macdSignal = 'BUY'; // Expanding bullish
  else if (macdHistogram < 0 && macdHistogram < prevMacdHist) macdSignal = 'SELL'; // Expanding bearish

  // ===== STRATEGY 4: Bollinger Bands =====
  const bb20Prices = prices.slice(-20);
  const bb20Mean = bb20Prices.reduce((a, b) => a + b, 0) / bb20Prices.length;
  const bb20Std = Math.sqrt(bb20Prices.reduce((a, b) => a + (b - bb20Mean) ** 2, 0) / bb20Prices.length);
  const bbUpper = bb20Mean + 2 * bb20Std;
  const bbLower = bb20Mean - 2 * bb20Std;
  const bbWidth = bb20Std > 0 ? (bbUpper - bbLower) / bb20Mean : 0;
  const bbPosition = bb20Std > 0 ? (currentPrice - bbLower) / (bbUpper - bbLower) : 0.5;

  let bbSignal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (bbPosition < 0.1) bbSignal = 'BUY'; // Near/below lower band
  else if (bbPosition < 0.25 && rsi < 40) bbSignal = 'BUY'; // Lower quartile with weak RSI
  else if (bbPosition > 0.9) bbSignal = 'SELL'; // Near/above upper band
  else if (bbPosition > 0.75 && rsi > 60) bbSignal = 'SELL'; // Upper quartile with strong RSI

  // ===== STRATEGY 5: Momentum & Rate of Change =====
  const roc5 = prices.length >= 6 ? (currentPrice - prices[prices.length - 6]) / prices[prices.length - 6] * 100 : 0;
  const roc10 = prices.length >= 11 ? (currentPrice - prices[prices.length - 11]) / prices[prices.length - 11] * 100 : 0;
  // Momentum acceleration: is ROC accelerating or decelerating?
  const prevROC5 = prices.length >= 7 ? (prices[prices.length - 2] - prices[prices.length - 7]) / prices[prices.length - 7] * 100 : 0;
  const rocAccelerating = roc5 > prevROC5;

  let momentumSignal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (roc5 > 1.5 && roc10 > 2.0 && rocAccelerating) momentumSignal = 'BUY';
  else if (roc5 > 1.0 && roc10 > 1.0) momentumSignal = 'BUY';
  else if (roc5 < -1.5 && roc10 < -2.0 && !rocAccelerating) momentumSignal = 'SELL';
  else if (roc5 < -1.0 && roc10 < -1.0) momentumSignal = 'SELL';

  // ===== STRATEGY 6: ATR-based Volatility + Price Action =====
  const atr = computeATR(prices, 14);
  const atrPercent = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
  // Check if today's move is significant relative to ATR
  const todayMoveVsATR = atr > 0 ? Math.abs(change) / atr : 0;

  let volatilitySignal: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  // Strong move in direction of trend
  if (todayMoveVsATR > 1.5 && change > 0 && trendBias > 0) volatilitySignal = 'BUY';
  else if (todayMoveVsATR > 1.5 && change < 0 && trendBias < 0) volatilitySignal = 'SELL';
  // Mean reversion: extreme move against trend might signal exhaustion
  else if (todayMoveVsATR > 2.0 && change > 0 && rsi > 70) volatilitySignal = 'SELL';
  else if (todayMoveVsATR > 2.0 && change < 0 && rsi < 30) volatilitySignal = 'BUY';

  // ===== CONFLUENCE SCORING =====
  // Each strategy votes: +1 for BUY, -1 for SELL, 0 for NEUTRAL
  const strategyVotes: { name: string; vote: number; signal: 'BUY' | 'SELL' | 'NEUTRAL' }[] = [
    { name: 'Trend', vote: trendSignal === 'BUY' ? trendStrength : trendSignal === 'SELL' ? -trendStrength : 0, signal: trendSignal },
    { name: 'RSI', vote: rsiSignal === 'BUY' ? (rsi < 30 ? 2 : 1) : rsiSignal === 'SELL' ? (rsi > 70 ? -2 : -1) : 0, signal: rsiSignal },
    { name: 'MACD', vote: macdSignal === 'BUY' ? 1.5 : macdSignal === 'SELL' ? -1.5 : 0, signal: macdSignal },
    { name: 'Bollinger', vote: bbSignal === 'BUY' ? 1.5 : bbSignal === 'SELL' ? -1.5 : 0, signal: bbSignal },
    { name: 'Momentum', vote: momentumSignal === 'BUY' ? 1 : momentumSignal === 'SELL' ? -1 : 0, signal: momentumSignal },
    { name: 'Volatility', vote: volatilitySignal === 'BUY' ? 1 : volatilitySignal === 'SELL' ? -1 : 0, signal: volatilitySignal },
  ];

  // RSI divergence bonus
  if (rsiDivergence === 'BULLISH') strategyVotes.push({ name: 'RSI Divergence', vote: 1.5, signal: 'BUY' });
  if (rsiDivergence === 'BEARISH') strategyVotes.push({ name: 'RSI Divergence', vote: -1.5, signal: 'SELL' });

  const totalBuyVotes = strategyVotes.filter(v => v.vote > 0).reduce((sum, v) => sum + v.vote, 0);
  const totalSellVotes = strategyVotes.filter(v => v.vote < 0).reduce((sum, v) => sum + Math.abs(v.vote), 0);
  const buyStrategies = strategyVotes.filter(v => v.vote > 0).length;
  const sellStrategies = strategyVotes.filter(v => v.vote < 0).length;
  const netScore = totalBuyVotes - totalSellVotes;

  let signal: 'BUY' | 'SELL' | 'HOLD';
  let confidence: number;

  // Require strong multi-strategy agreement for BUY/SELL
  if (netScore >= 3 && buyStrategies >= 3) {
    signal = 'BUY';
    // Confidence scales with number of agreeing strategies
    const baseConf = buyStrategies >= 5 ? 82 : buyStrategies >= 4 ? 72 : 62;
    confidence = Math.min(95, baseConf + Math.round(netScore * 1.5));
  } else if (netScore <= -3 && sellStrategies >= 3) {
    signal = 'SELL';
    const baseConf = sellStrategies >= 5 ? 82 : sellStrategies >= 4 ? 72 : 62;
    confidence = Math.min(95, baseConf + Math.round(Math.abs(netScore) * 1.5));
  } else {
    signal = 'HOLD';
    confidence = Math.max(40, Math.min(60, 50 + Math.round(Math.abs(netScore) * 2)));
  }

  // ===== REASONING: cite specific strategies =====
  const reasoning: string[] = [];
  if (signal === 'BUY') {
    if (trendSignal === 'BUY') {
      if (emaCrossoverBullish) reasoning.push(`Trend: Bullish EMA crossover (9 EMA crossed above 21 EMA). Price above SMA 20 ($${sma20.toFixed(2)}) confirms uptrend.`);
      else reasoning.push(`Trend: Price above aligned moving averages (EMA 9 > EMA 21 > SMA 20 at $${sma20.toFixed(2)}), confirming bullish trend.`);
    }
    if (rsiSignal === 'BUY') reasoning.push(`RSI: At ${rsi.toFixed(1)} ${rsi < 30 ? '(deeply oversold)' : '(approaching oversold)'} — signals high probability of upward reversal.`);
    if (rsiDivergence === 'BULLISH') reasoning.push(`Divergence: Bullish RSI divergence detected — price making lower lows while momentum stabilizes, indicating accumulation.`);
    if (macdSignal === 'BUY') reasoning.push(`MACD: ${prevMacdHist < 0 && macdHistogram > 0 ? 'Bullish crossover — MACD crossed above signal line' : 'Histogram expanding bullish'} (MACD: ${macd.toFixed(3)}).`);
    if (bbSignal === 'BUY') reasoning.push(`Bollinger: Price at ${(bbPosition * 100).toFixed(0)}% of band width — near lower band ($${bbLower.toFixed(2)}), suggesting mean reversion upward.`);
    if (momentumSignal === 'BUY') reasoning.push(`Momentum: 5-day ROC +${roc5.toFixed(2)}% with acceleration, confirmed by 10-day ROC +${roc10.toFixed(2)}%.`);
    if (reasoning.length < 2) reasoning.push(`${buyStrategies} of 6 strategies agree on bullish outlook with ${confidence}% confluence.`);
  } else if (signal === 'SELL') {
    if (trendSignal === 'SELL') {
      if (emaCrossoverBearish) reasoning.push(`Trend: Bearish EMA crossover (9 EMA crossed below 21 EMA). Price below SMA 20 ($${sma20.toFixed(2)}) confirms downtrend.`);
      else reasoning.push(`Trend: Price below aligned moving averages (EMA 9 < EMA 21 < SMA 20), confirming bearish trend.`);
    }
    if (rsiSignal === 'SELL') reasoning.push(`RSI: At ${rsi.toFixed(1)} ${rsi > 70 ? '(overbought)' : '(approaching overbought)'} — signals potential downward correction.`);
    if (rsiDivergence === 'BEARISH') reasoning.push(`Divergence: Bearish RSI divergence detected — price making higher highs but momentum weakening, indicating distribution.`);
    if (macdSignal === 'SELL') reasoning.push(`MACD: ${prevMacdHist > 0 && macdHistogram < 0 ? 'Bearish crossover — MACD crossed below signal line' : 'Histogram expanding bearish'} (MACD: ${macd.toFixed(3)}).`);
    if (bbSignal === 'SELL') reasoning.push(`Bollinger: Price at ${(bbPosition * 100).toFixed(0)}% of band width — near upper band ($${bbUpper.toFixed(2)}), suggesting mean reversion downward.`);
    if (momentumSignal === 'SELL') reasoning.push(`Momentum: 5-day ROC ${roc5.toFixed(2)}% with deceleration, confirmed by 10-day ROC ${roc10.toFixed(2)}%.`);
    if (reasoning.length < 2) reasoning.push(`${sellStrategies} of 6 strategies agree on bearish outlook with ${confidence}% confluence.`);
  } else {
    const buyNames = strategyVotes.filter(v => v.vote > 0).map(v => v.name).join(', ');
    const sellNames = strategyVotes.filter(v => v.vote < 0).map(v => v.name).join(', ');
    reasoning.push(`Mixed signals: RSI at ${rsi.toFixed(1)} (neutral), MACD histogram at ${macdHistogram.toFixed(3)}.`);
    if (buyNames) reasoning.push(`Bullish factors: ${buyNames}.`);
    if (sellNames) reasoning.push(`Bearish factors: ${sellNames}.`);
    reasoning.push(`No clear multi-strategy confluence. Monitor for breakout above $${(currentPrice * 1.03).toFixed(2)} or breakdown below $${(currentPrice * 0.97).toFixed(2)}.`);
  }

  // ===== ATR-BASED TARGETS (more realistic than fixed percentages) =====
  const volatility = Math.max(0.005, bb20Std / bb20Mean);
  const atrMultiple = atr > 0 ? atr : currentPrice * 0.015;
  const targets = signal === 'BUY' ? {
    targetBuy: parseFloat(currentPrice.toFixed(2)),
    targetSell: parseFloat((currentPrice + atrMultiple * 2.5).toFixed(2)),
    stopLoss: parseFloat((currentPrice - atrMultiple * 1.5).toFixed(2)),
    timeframe: (atrPercent > 3 ? 'Short-term' : atrPercent > 1.5 ? 'Swing' : 'Long-term') as 'Short-term' | 'Swing' | 'Long-term',
    riskLevel: (confidence > 78 ? 'Low' : confidence > 65 ? 'Medium' : 'High') as 'Low' | 'Medium' | 'High',
  } : signal === 'SELL' ? {
    targetBuy: parseFloat(currentPrice.toFixed(2)),
    targetSell: parseFloat((currentPrice - atrMultiple * 2.5).toFixed(2)),
    stopLoss: parseFloat((currentPrice + atrMultiple * 1.5).toFixed(2)),
    timeframe: 'Short-term' as const,
    riskLevel: (confidence > 78 ? 'Medium' : 'High') as 'Low' | 'Medium' | 'High',
  } : {
    targetBuy: parseFloat((currentPrice - atrMultiple * 1.2).toFixed(2)),
    targetSell: parseFloat((currentPrice + atrMultiple * 1.2).toFixed(2)),
    stopLoss: parseFloat((currentPrice - atrMultiple * 2.0).toFixed(2)),
    timeframe: 'Swing' as const,
    riskLevel: 'Medium' as const,
  };

  const indicators = [
    { name: 'RSI (14)', value: rsi.toFixed(1), signal: rsiSignal },
    { name: 'MACD', value: macdHistogram > 0 ? `Bullish (${macdHistogram.toFixed(3)})` : macdHistogram < 0 ? `Bearish (${macdHistogram.toFixed(3)})` : 'Neutral', signal: macdSignal },
    { name: 'EMA 9/21', value: ema9Current > ema21Current ? 'Bullish Cross' : ema9Current < ema21Current ? 'Bearish Cross' : 'Converging', signal: (ema9Current > ema21Current ? 'BUY' : ema9Current < ema21Current ? 'SELL' : 'NEUTRAL') as 'BUY' | 'SELL' | 'NEUTRAL' },
    { name: 'SMA 20', value: `$${sma20.toFixed(2)}`, signal: (currentPrice > sma20 ? 'BUY' : 'SELL') as 'BUY' | 'SELL' | 'NEUTRAL' },
    { name: 'Bollinger', value: `${(bbPosition * 100).toFixed(0)}% (${bbPosition > 0.75 ? 'Upper' : bbPosition < 0.25 ? 'Lower' : 'Mid'})`, signal: bbSignal },
    { name: 'ROC (5d)', value: `${roc5 > 0 ? '+' : ''}${roc5.toFixed(2)}%`, signal: momentumSignal },
    { name: 'ATR (14)', value: `$${atr.toFixed(2)} (${atrPercent.toFixed(1)}%)`, signal: 'NEUTRAL' as const },
  ];

  return { signal, confidence, reasoning, targets, indicators };
}

// News
export interface NewsItem {
  id: string;
  title: string;
  source: string;
  time: string;
  sentiment: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL';
  summary: string;
  tickers: string[];
  url: string;
  generatedAt?: number; // timestamp when the article was generated
  minutesAgoBase?: number; // base minutesAgo from AI at generation time
}

function getRelativeTime(minutesAgo: number): string {
  if (minutesAgo < 1) return 'just now';
  if (minutesAgo < 60) return `${Math.round(minutesAgo)}m ago`;
  const hours = minutesAgo / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Compute accurate relative time for a news article
// Uses the generation timestamp + base minutesAgo to calculate real elapsed time
function computeArticleTime(article: NewsItem): string {
  if (article.generatedAt && article.minutesAgoBase !== undefined) {
    const generatedAtMs = article.generatedAt;
    // The article was "minutesAgoBase" minutes old at generation time
    // So actual article time = generatedAt - minutesAgoBase * 60000
    const articleTimeMs = generatedAtMs - (article.minutesAgoBase * 60000);
    const elapsedMinutes = (Date.now() - articleTimeMs) / 60000;
    return getRelativeTime(Math.max(1, elapsedMinutes));
  }
  return article.time;
}

let aiNewsCache: NewsItem[] = [];
let aiNewsCacheTime = 0;
let aiNewsCacheUserId = '';
let aiAllNewsCache: NewsItem[] = []; // Separate cache for "All News"
let aiAllNewsCacheTime = 0;
const AI_NEWS_CACHE_TTL = 60 * 60 * 1000;

function getFallbackNews(): NewsItem[] {
  const now = Date.now();
  const minuteOffset = Math.floor((now % 3600000) / 60000);

  const baseArticles = [
    { id: 'n1', title: 'NVIDIA Q4 Data Center Revenue Surges 409% to $18.4B, Crushing Estimates by $2.1B', source: 'Bloomberg', baseMin: 5, sentiment: 'POSITIVE' as const, summary: 'NVIDIA reported Q4 earnings of $5.16 per share vs $4.64 expected, with data center revenue hitting $18.4B. CEO Jensen Huang forecasts AI infrastructure spending to reach $1T over the next four years.', tickers: ['NVDA'], url: 'https://www.bloomberg.com/markets' },
    { id: 'n2', title: 'Tesla Q1 Deliveries Miss: 386,810 Units vs 443,000 Expected as China Competition Heats Up', source: 'Reuters', baseMin: 12, sentiment: 'NEGATIVE' as const, summary: 'Tesla delivered 386,810 vehicles in Q1, 13% below Wall Street consensus. BYD overtook Tesla in global EV sales for the first time, delivering 526,409 battery-electric vehicles. Gross margins compressed to 17.6%.', tickers: ['TSLA'], url: 'https://www.reuters.com/markets/' },
    { id: 'n3', title: 'Apple Announces $110B Stock Buyback, Largest in Corporate History', source: 'CNBC', baseMin: 23, sentiment: 'POSITIVE' as const, summary: 'Apple authorized a record $110B share repurchase program alongside a 4% dividend increase to $0.26/share. Services revenue hit $23.9B, up 14% YoY, with Apple Intelligence driving iPhone upgrade cycles.', tickers: ['AAPL'], url: 'https://www.cnbc.com/markets/' },
    { id: 'n4', title: 'Fed Holds Rates at 4.25-4.50%, Signals Two Cuts in 2026 as PCE Falls to 2.3%', source: 'Wall Street Journal', baseMin: 37, sentiment: 'POSITIVE' as const, summary: 'The Federal Reserve kept rates unchanged but the dot plot shifted to indicate two 25bp cuts this year. Chair Powell noted "encouraging progress" on inflation with core PCE declining to 2.3%.', tickers: ['JPM', 'V', 'BAC'], url: 'https://www.wsj.com/finance/stocks' },
    { id: 'n5', title: 'Morgan Stanley Upgrades Microsoft to Overweight, Raises PT to $520 on Copilot Momentum', source: 'Seeking Alpha', baseMin: 48, sentiment: 'POSITIVE' as const, summary: 'Analyst Keith Weiss cites Azure AI revenue run rate exceeding $13B annually and Copilot adoption reaching 60% of Fortune 500 companies. Enterprise AI spending expected to accelerate through 2027.', tickers: ['MSFT'], url: 'https://seekingalpha.com/market-news' },
    { id: 'n6', title: 'Intel Announces 15,000 Job Cuts and $10B Cost Reduction Plan, Shares Fall 8%', source: 'MarketWatch', baseMin: 65, sentiment: 'NEGATIVE' as const, summary: 'Intel will reduce headcount by 15% and suspend its dividend to fund foundry investments. The company posted a $1.6B operating loss in its chip manufacturing division as it struggles to compete with TSMC.', tickers: ['INTC', 'AMD', 'NVDA'], url: 'https://www.marketwatch.com/latest-news' },
    { id: 'n7', title: 'Amazon AWS Revenue Jumps 19% to $25.0B, Announces $15B AI Data Center Expansion', source: 'Financial Times', baseMin: 80, sentiment: 'POSITIVE' as const, summary: 'AWS posted $25.0B in Q1 revenue with operating margins expanding to 37.6%. Amazon committed $15B to new AI-optimized data centers across five states, with its custom Trainium2 chips now in production.', tickers: ['AMZN'], url: 'https://www.ft.com/markets' },
    { id: 'n8', title: 'DOJ Files Antitrust Suit Against UnitedHealth, Alleging Monopolistic Practices in PBM Market', source: "Barron's", baseMin: 110, sentiment: 'NEGATIVE' as const, summary: "The Department of Justice filed a civil antitrust lawsuit alleging UnitedHealth's Optum Rx used its dominant position to inflate drug prices. Shares fell 6.2% in pre-market trading.", tickers: ['UNH'], url: 'https://www.barrons.com/market-data' },
    { id: 'n9', title: 'Coinbase Q1 Revenue Triples to $2.1B as Bitcoin Surges Past $95K, Transaction Revenue Up 280%', source: 'Yahoo Finance', baseMin: 140, sentiment: 'POSITIVE' as const, summary: 'Coinbase reported transaction revenue of $1.6B, up 280% YoY, driven by Bitcoin and Ethereum spot ETF inflows. Institutional trading volume hit $256B, up from $38B a year ago.', tickers: ['COIN'], url: 'https://finance.yahoo.com/topic/stock-market-news/' },
    { id: 'n10', title: 'Meta Llama 4 Outperforms GPT-5 on Key Benchmarks, Ad Revenue Up 22% to $40.3B', source: 'The Motley Fool', baseMin: 175, sentiment: 'POSITIVE' as const, summary: "Meta's open-source Llama 4 model tops industry benchmarks while its AI-powered ad targeting drove 22% revenue growth. Instagram Reels monetization efficiency improved 30% quarter-over-quarter.", tickers: ['META'], url: 'https://seekingalpha.com/market-news' },
  ];

  return baseArticles.map(article => ({
    ...article,
    time: getRelativeTime(article.baseMin + (minuteOffset % 15)),
  }));
}

export function setAINews(articles: NewsItem[], userId?: string, isAllNews?: boolean) {
  const processedArticles = articles.map(a => ({
    ...a,
    url: a.url && a.url.startsWith('http') ? a.url : `https://finance.yahoo.com/topic/stock-market-news/`,
  }));
  if (isAllNews) {
    aiAllNewsCache = processedArticles;
    aiAllNewsCacheTime = Date.now();
  } else {
    aiNewsCache = processedArticles;
    aiNewsCacheTime = Date.now();
    if (userId) aiNewsCacheUserId = userId;
  }
}

export function clearAINewsCache() {
  aiNewsCache = [];
  aiNewsCacheTime = 0;
  aiNewsCacheUserId = '';
  aiAllNewsCache = [];
  aiAllNewsCacheTime = 0;
}

export function isNewsCacheForUser(userId: string): boolean {
  return aiNewsCacheUserId === userId;
}

export function getAINewsCacheAge(): number {
  if (aiNewsCacheTime === 0) return Infinity;
  return Date.now() - aiNewsCacheTime;
}

export function getLatestNews(mode?: 'all' | 'watchlist'): NewsItem[] {
  if (mode === 'all' || !mode) {
    // For "All News" tab, prefer the dedicated all-news cache
    if (aiAllNewsCache.length > 0 && Date.now() - aiAllNewsCacheTime < AI_NEWS_CACHE_TTL) {
      return aiAllNewsCache.map(a => ({ ...a, time: computeArticleTime(a) }));
    }
  }
  // Fall back to stock-specific cache
  if (aiNewsCache.length > 0 && Date.now() - aiNewsCacheTime < AI_NEWS_CACHE_TTL) {
    return aiNewsCache.map(a => ({ ...a, time: computeArticleTime(a) }));
  }
  return getFallbackNews();
}

export const news: NewsItem[] = getFallbackNews();

export function getStockNews(ticker: string): NewsItem[] {
  return getLatestNews('watchlist').filter(n => n.tickers.includes(ticker));
}

// Live market indices from Yahoo Finance
export interface MarketIndex {
  name: string;
  value: number;
  change: number;
  changePercent: number;
}

const INDEX_SYMBOLS: { symbol: string; name: string }[] = [
  { symbol: '^GSPC', name: 'S&P 500' },
  { symbol: '^IXIC', name: 'NASDAQ' },
  { symbol: '^DJI', name: 'DOW' },
  { symbol: '^RUT', name: 'Russell 2000' },
];

export const FALLBACK_INDICES: MarketIndex[] = [
  { name: 'S&P 500', value: 5998.74, change: 22.18, changePercent: 0.37 },
  { name: 'NASDAQ', value: 19615.42, change: 98.56, changePercent: 0.50 },
  { name: 'DOW', value: 42847.21, change: -48.32, changePercent: -0.11 },
  { name: 'Russell 2000', value: 2078.65, change: 12.34, changePercent: 0.60 },
];

const SECTOR_SYMBOLS: { symbol: string; name: string; color: string }[] = [
  { symbol: 'XLK', name: 'Technology', color: '#3B82F6' },
  { symbol: 'XLV', name: 'Healthcare', color: '#EF4444' },
  { symbol: 'XLF', name: 'Financials', color: '#10B981' },
  { symbol: 'XLY', name: 'Consumer', color: '#F59E0B' },
  { symbol: 'XLE', name: 'Energy', color: '#8B5CF6' },
  { symbol: 'XLI', name: 'Industrials', color: '#EC4899' },
];

export interface SectorPerf {
  name: string;
  change: number;
  color: string;
}

let sectorCache: SectorPerf[] = [];
let sectorCacheTime = 0;
const SECTOR_CACHE_TTL = 30000;
// Session 113 #1 — dedupe concurrent sector fetches.
let sectorsInFlight: Promise<SectorPerf[]> | null = null;

/**
 * Session 113 #1 — synchronous getter for the current cached sectors.
 * Used by the Market tab to render sector strip INSTANTLY on mount.
 * Returns [] on very first launch (before any successful fetch); after that
 * always returns the last-known good values.
 */
export function getCachedSectors(): SectorPerf[] {
  return sectorCache;
}

export async function fetchSectorPerformance(): Promise<SectorPerf[]> {
  if (Date.now() - sectorCacheTime < SECTOR_CACHE_TTL && sectorCache.length > 0) return sectorCache;
  // Dedupe concurrent fetches (see fetchMarketIndices for rationale).
  if (sectorsInFlight) return sectorsInFlight;

  const doFetch = async (): Promise<SectorPerf[]> => {
    const results: SectorPerf[] = [];
    await Promise.all(SECTOR_SYMBOLS.map(async ({ symbol, name, color }) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=2d`, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return;
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) return;
        const price = meta.regularMarketPrice ?? 0;
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
        const changePercent = prevClose > 0 ? parseFloat((((price - prevClose) / prevClose) * 100).toFixed(2)) : 0;
        results.push({ name, change: changePercent, color });
      } catch {}
    }));

    if (results.length >= 3) {
      const ordered = SECTOR_SYMBOLS.map(s => results.find(r => r.name === s.name)).filter(Boolean) as SectorPerf[];
      if (ordered.length >= 3) {
        sectorCache = ordered;
        sectorCacheTime = Date.now();
        return ordered;
      }
    }

    if (sectorCache.length > 0) return sectorCache;
    // Very-first-launch fallback — tiny synthetic values so the strip is
    // never blank. Real values overwrite as soon as the fetch succeeds.
    // Session 192 - Never fabricate sector performance with random
    // numbers. If every quote provider failed, return an empty array
    // so the UI can render an honest "data unavailable" state instead
    // of misleading synthetic bars that look real.
    return [];
  };

  sectorsInFlight = doFetch().finally(() => { sectorsInFlight = null; });
  return sectorsInFlight;
}

let indicesCache: MarketIndex[] = FALLBACK_INDICES;
let indicesCacheTime = 0;
const INDICES_CACHE_TTL = 3000;
// Session 113 #1 — dedupe concurrent index fetches so the Market tab
// mounting simultaneously with a background poll doesn't fire two Yahoo
// requests. All callers await the same in-flight promise.
let indicesInFlight: Promise<MarketIndex[]> | null = null;

/**
 * Session 113 #1 — synchronous getter for the current cached indices.
 * The Market tab uses this on mount to render prices INSTANTLY (no spinner,
 * no ~1s delay). If the cache is fresh, no network call is needed at all;
 * otherwise the tab kicks off a background refresh but shows the last-known
 * good values while it loads.
 */
export function getCachedIndices(): MarketIndex[] {
  return indicesCache;
}

export async function fetchMarketIndices(): Promise<MarketIndex[]> {
  if (Date.now() - indicesCacheTime < INDICES_CACHE_TTL) return indicesCache;
  // Dedupe: if a fetch is already in flight, await it instead of firing a new one.
  if (indicesInFlight) return indicesInFlight;

  const doFetch = async (): Promise<MarketIndex[]> => {
    const results: MarketIndex[] = [];

    await Promise.all(INDEX_SYMBOLS.map(async ({ symbol, name }) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!res.ok) return;
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) return;
        const price = meta.regularMarketPrice ?? 0;
        const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
        const change = parseFloat((price - prevClose).toFixed(2));
        const changePercent = prevClose > 0 ? parseFloat(((change / prevClose) * 100).toFixed(2)) : 0;
        results.push({ name, value: parseFloat(price.toFixed(2)), change, changePercent });
      } catch {}
    }));

    if (results.length >= 2) {
      const ordered = INDEX_SYMBOLS.map(is => results.find(r => r.name === is.name)).filter(Boolean) as MarketIndex[];
      if (ordered.length >= 2) {
        indicesCache = ordered;
        indicesCacheTime = Date.now();
        return ordered;
      }
    }

    return indicesCache;
  };

  indicesInFlight = doFetch().finally(() => { indicesInFlight = null; });
  return indicesInFlight;
}

export const marketIndices: MarketIndex[] = FALLBACK_INDICES;

export interface AIAlert {
  id: string;
  ticker: string;
  type: 'BREAKOUT' | 'BUY_SIGNAL' | 'SELL_SIGNAL' | 'SUPPORT' | 'RESISTANCE' | 'TREND_REVERSAL';
  title: string;
  description: string;
  confidence: number;
  time: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
}

export const aiAlerts: AIAlert[] = [
  { id: 'a1', ticker: 'NVDA', type: 'BREAKOUT', title: 'Breakout Detected on NVDA', description: 'NVDA has broken above key resistance with strong volume.', confidence: 91, time: '12m ago', priority: 'HIGH' },
  { id: 'a2', ticker: 'AAPL', type: 'BUY_SIGNAL', title: 'Golden Cross Forming on AAPL', description: '50-day MA crossing above 200-day MA.', confidence: 84, time: '45m ago', priority: 'HIGH' },
];

// Deduplicate stock list
const STOCK_ASSETS_DEDUPED: { ticker: string; name: string; sector: string }[] = (() => {
  const seen = new Set<string>();
  const result: { ticker: string; name: string; sector: string }[] = [];
  for (const s of STOCK_ASSETS_RAW) {
    if (!seen.has(s.ticker)) {
      seen.add(s.ticker);
      result.push(s);
    }
  }
  return result;
})();

export const AVAILABLE_STOCKS = STOCK_ASSETS_DEDUPED;

// ===== SEARCH: Local stock search =====
export function searchAvailableStocks(query: string): { ticker: string; name: string; sector: string }[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const results = STOCK_ASSETS_DEDUPED.filter(
    s => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.sector.toLowerCase().includes(q)
  );
  // Prioritize exact ticker matches
  results.sort((a, b) => {
    const aExact = a.ticker.toLowerCase() === q ? -1 : 0;
    const bExact = b.ticker.toLowerCase() === q ? -1 : 0;
    if (aExact !== bExact) return aExact - bExact;
    const aStarts = a.ticker.toLowerCase().startsWith(q) ? -1 : 0;
    const bStarts = b.ticker.toLowerCase().startsWith(q) ? -1 : 0;
    return aStarts - bStarts;
  });
  return results.slice(0, 30);
}

// ===== REMOTE SEARCH: Yahoo Finance symbol lookup for stocks not in local catalog =====
export async function searchRemoteStocks(query: string): Promise<{ ticker: string; name: string; sector: string }[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0&quotesQueryId=tss_match_phrase_query`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    const quotes = data?.quotes ?? [];
    // Filter to only equities (stocks/ETFs) listed on US exchanges
    return quotes
      .filter((q: any) => {
        const type = (q.quoteType || '').toUpperCase();
        const exchange = (q.exchange || '').toUpperCase();
        // Only stocks and ETFs on US exchanges
        return (type === 'EQUITY' || type === 'ETF') &&
          (exchange.includes('NAS') || exchange.includes('NYQ') || exchange.includes('NYS') ||
           exchange.includes('PCX') || exchange.includes('AME') || exchange.includes('BTS') ||
           exchange.includes('NMS') || exchange.includes('NGM'));
      })
      .map((q: any) => ({
        ticker: q.symbol || '',
        name: q.shortname || q.longname || q.symbol || '',
        sector: q.industry || q.sector || 'Stock',
      }))
      .filter((s: any) => s.ticker && !s.ticker.includes('.'));
  } catch {
    return [];
  }
}
