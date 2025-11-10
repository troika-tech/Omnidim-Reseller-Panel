/**
 * Utility functions for retrying failed API calls
 */

/**
 * Retry a function with exponential backoff
 * @param {Function} fn - The function to retry
 * @param {Object} options - Retry options
 * @param {number} options.maxRetries - Maximum number of retries (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms (default: 1000)
 * @param {number} options.maxDelay - Maximum delay in ms (default: 10000)
 * @param {Function} options.shouldRetry - Function to determine if retry should happen (default: retry on any error)
 * @returns {Promise} - The result of the function
 */
async function retryWithBackoff(fn, options = {}) {
  const maxRetries = options.maxRetries || 3;
  const initialDelay = options.initialDelay || 1000;
  const maxDelay = options.maxDelay || 10000;
  const shouldRetry = options.shouldRetry || (() => true);

  let retries = 0;
  let lastError;

  while (retries <= maxRetries) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Check if we should retry
      if (retries >= maxRetries || !shouldRetry(error)) {
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(initialDelay * Math.pow(2, retries), maxDelay);
      
      // Log retry attempt
      console.log(`Retry attempt ${retries + 1}/${maxRetries} after ${delay}ms delay`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
      
      retries++;
    }
  }
  
  throw lastError;
}

module.exports = {
  retryWithBackoff
};
