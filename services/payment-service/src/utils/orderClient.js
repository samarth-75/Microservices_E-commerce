/**
 * Order Client — Payment Service
 *
 * REST client for cross-service communication with Order Service.
 * Used to:
 *   1. Fetch order details (verify order exists and is CONFIRMED)
 *   2. Update order status to PAID after Stripe webhook confirms payment
 *
 * Why REST and not RabbitMQ?
 *   - The create-session endpoint needs an immediate answer (order data)
 *   - The "spinner rule": user is waiting → use REST
 *   - The webhook handler MUST update the order synchronously to ensure
 *     consistency before acknowledging the webhook to Stripe
 *
 * Why does the Payment Service update the Order status?
 *   - The Payment Service is the only service that receives the Stripe
 *     webhook. It's the authority on payment completion.
 *   - The Order Service exposes PUT /orders/:id/status for admin use.
 *     The Payment Service calls it with a service-level JWT (or we
 *     accept that in the Docker network, internal calls are trusted).
 *   - For this project, we use direct HTTP within the Docker network.
 *     In production, service mesh mTLS would replace this.
 */

const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://order-service:3004';

/**
 * Fetch order details from Order Service.
 * Called during create-session to verify order exists and get amount.
 *
 * @param {string} orderId - UUID of the order
 * @param {string} authToken - JWT token to forward for authorization
 * @returns {object} Order data with items
 */
async function getOrder(orderId, authToken) {
    const url = `${ORDER_SERVICE_URL}/orders/${orderId}`;

    const response = await fetch(url, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${authToken}`,
            'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));

        if (response.status === 404) {
            throw new Error(`Order ${orderId} not found`);
        }
        if (response.status === 403) {
            throw new Error('You do not have access to this order');
        }

        throw new Error(errorBody.message || `Order Service returned ${response.status}`);
    }

    const data = await response.json();
    return data.order;
}

/**
 * Update order status via Order Service.
 * Called by the webhook handler to transition order to PAID.
 *
 * NOTE: This is an internal service-to-service call within the Docker network.
 * We use a system-level JWT here. In a real system, this would use mTLS or
 * a service account. For this project, we sign a temporary admin JWT.
 *
 * @param {string} orderId - UUID of the order
 * @param {string} newStatus - New status (e.g. 'PAID')
 * @returns {object} Updated order data
 */
async function updateOrderStatus(orderId, newStatus) {
    const jwt = require('jsonwebtoken');

    // Create a short-lived internal service token for the cross-service call
    const JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'dev_access_secret_change_in_production';
    const serviceToken = jwt.sign(
        { id: 'payment-service', email: 'payment-service@internal', role: 'admin' },
        JWT_ACCESS_SECRET,
        { expiresIn: '30s' }
    );

    const url = `${ORDER_SERVICE_URL}/orders/${orderId}/status`;

    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${serviceToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status: newStatus }),
        signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(
            errorBody.message || `Failed to update order ${orderId} to ${newStatus}: ${response.status}`
        );
    }

    return response.json();
}

module.exports = { getOrder, updateOrderStatus };
