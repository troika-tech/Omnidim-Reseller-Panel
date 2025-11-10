/**
 * User Plans Configuration
 * Defines available plans with their minute allocations
 */

const plans = {
  basic: {
    id: 'basic',
    name: 'Basic',
    displayName: 'Basic Plan',
    minutesPerMonth: 1000,
    price: 0, // Can be set if needed
    features: [
      '1000 minutes per month',
      'Standard support',
      'Basic features'
    ]
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    displayName: 'Pro Plan',
    minutesPerMonth: 2000,
    price: 0, // Can be set if needed
    features: [
      '2000 minutes per month',
      'Priority support',
      'Advanced features'
    ]
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    displayName: 'Enterprise Plan',
    minutesPerMonth: 3000,
    price: 0, // Can be set if needed
    features: [
      '3000 minutes per month',
      'Premium support',
      'All features',
      'Dedicated account manager'
    ]
  }
};

/**
 * Get all plans as an array
 */
const getAllPlans = () => {
  return Object.values(plans);
};

/**
 * Get a plan by ID
 */
const getPlanById = (planId) => {
  return plans[planId] || null;
};

/**
 * Validate if a plan ID exists
 */
const isValidPlanId = (planId) => {
  return plans.hasOwnProperty(planId);
};

module.exports = {
  plans,
  getAllPlans,
  getPlanById,
  isValidPlanId
};

