/**
 * CommerceSphere Notification Service — Notifier
 *
 * Simulated notification provider. Instead of calling SendGrid/Twilio,
 * we log structured JSON that includes all the fields a real provider
 * would need (channel, recipient, subject, body). This makes it trivial
 * to swap in a real provider later — just replace the send functions.
 *
 * Per PRD.md §4: "Real SMS/email delivery integration — a logged/simulated
 * notification is fine; the interesting part is the event pipeline, not the
 * third-party integration."
 */

/**
 * Simulate sending an email notification.
 */
function sendEmail({ to, subject, body, metadata = {} }) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'notification-service',
        channel: 'email',
        action: 'SEND_EMAIL',
        to,
        subject,
        body,
        ...metadata,
        note: 'SIMULATED — replace with SendGrid/Mailgun/SES in production',
    }));

    return { success: true, channel: 'email', to, subject };
}

/**
 * Simulate sending an SMS notification.
 */
function sendSMS({ to, body, metadata = {} }) {
    console.log(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'info',
        service: 'notification-service',
        channel: 'sms',
        action: 'SEND_SMS',
        to,
        body,
        ...metadata,
        note: 'SIMULATED — replace with Twilio/SNS in production',
    }));

    return { success: true, channel: 'sms', to };
}

/**
 * Send notification on both channels.
 */
function notifyUser({ userId, email, phone, subject, body, metadata = {} }) {
    const results = [];

    if (email) {
        results.push(sendEmail({ to: email, subject, body, metadata }));
    }

    if (phone) {
        results.push(sendSMS({ to: phone, body, metadata }));
    }

    // Fallback: if no contact info, log with userId for debugging
    if (!email && !phone) {
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'warn',
            service: 'notification-service',
            channel: 'none',
            action: 'NOTIFY_SKIPPED',
            userId,
            subject,
            body,
            reason: 'No contact information available — notification logged only',
            ...metadata,
        }));
    }

    return results;
}

module.exports = { sendEmail, sendSMS, notifyUser };
