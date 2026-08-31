/**
 * Cart Client — Order Service
 *
 * HTTP client for cross-service cart retrieval. When a customer creates
 * an order, we fetch their current cart from the Cart Service via REST.
 *
 * The JWT is forwarded so the cart service knows which user's cart to return.
 * After order creation, we also clear the cart.
 */

const CART_SERVICE_URL = process.env.CART_SERVICE_URL || 'http://cart-service:3003';

/**
 * Fetch the authenticated user's cart from the Cart Service.
 * Returns the cart object or null on error.
 */
async function getCart(authToken) {
    try {
        const url = `${CART_SERVICE_URL}/cart`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'warn',
                service: 'order-service',
                message: `Cart service returned ${response.status}`,
            }));
            return null;
        }

        const data = await response.json();
        return data;
    } catch (err) {
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: 'order-service',
            message: 'Failed to fetch cart from cart service',
            error: err.message,
        }));
        return null;
    }
}

/**
 * Clear the user's cart after successful order creation.
 */
async function clearCart(authToken) {
    try {
        const url = `${CART_SERVICE_URL}/cart`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const response = await fetch(url, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`,
            },
            signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
            console.error(JSON.stringify({
                timestamp: new Date().toISOString(),
                level: 'warn',
                service: 'order-service',
                message: `Failed to clear cart — status ${response.status}`,
            }));
        }

        return response.ok;
    } catch (err) {
        // Cart clear failure is not fatal — the order was already created.
        // The cart will eventually expire via TTL.
        console.error(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: 'order-service',
            message: 'Failed to clear cart (non-fatal)',
            error: err.message,
        }));
        return false;
    }
}

module.exports = { getCart, clearCart };
