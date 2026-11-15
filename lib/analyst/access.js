// Who may read which AI Analyst run: one country → that country's access; 'all' → only an
// admin who may see every country. Server-only (session cookie).
import { allowedCountryCodes, canAccessCountry } from '../adminCountry';
import { ANALYST_COUNTRIES } from './math.js';

export const mayRead = (cc) => (cc === 'all' ? !allowedCountryCodes() : ANALYST_COUNTRIES.includes(cc) && canAccessCountry(cc));
