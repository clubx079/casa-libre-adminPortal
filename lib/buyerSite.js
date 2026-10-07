// Each country's public buyer site, for "View on site" links from the admin.
export const BUYER_ORIGIN = {
  py: 'https://casa-libre.com.py',
  bo: 'https://casa-libre.com.bo',
  uy: 'https://uy.casa-libre.com',
  ve: 'https://casa-libre.com.ve',
};

export const listingUrl = (cc, id) => `${BUYER_ORIGIN[cc] || BUYER_ORIGIN.py}/propiedad/${id}`;
