// Plain labels for the Referrals page (client-safe: no imports).
export const STATE_LABEL = {
  signed_up: 'Signed up, waiting for a live listing', qualified: 'Qualified', rejected: 'Not counted',
  pending: 'Pending', granted: 'Granted', expired: 'Ended', revoked: 'Revoked',
};
export const HOLD_LABEL = {
  no_listing: 'no listing yet', checking_photos: 'photos being checked', payment_pending: 'listing waiting for payment',
  duplicate: 'listing held as a possible duplicate', photos_rejected: 'photos rejected', not_live: 'listing not live',
};
export const REASON_LABEL = {
  same_person: 'same person as the referrer', referrer_inactive: 'referrer blocked or inactive', referred_blocked: 'account blocked', admin: 'rejected by an admin',
};
export const TYPE_LABEL = { new_user: 'New member', referrer: 'Referrer', milestone: 'Milestone (home page)', manual: 'Manual' };
export const PLAN_LABEL = { verified: 'Verified', home: 'Verified + home page' };
