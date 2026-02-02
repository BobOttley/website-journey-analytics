/**
 * Email Service - Microsoft Graph API Integration
 * Sends email notifications for new visitors
 */

const { ClientSecretCredential } = require('@azure/identity');
const { Client } = require('@microsoft/microsoft-graph-client');
const { TokenCredentialAuthenticationProvider } = require('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials');

// Configuration from environment variables
const config = {
  clientId: process.env.MS_CLIENT_ID,
  clientSecret: process.env.MS_CLIENT_SECRET,
  tenantId: process.env.MS_TENANT_ID,
  senderEmail: process.env.SENDER_EMAIL,
  notifyEmail: process.env.EMAIL_NOTIFY
};

let graphClient = null;

/**
 * Initialise the Microsoft Graph client
 */
function getGraphClient() {
  if (graphClient) {
    return graphClient;
  }

  // Check if credentials are configured
  if (!config.clientId || !config.clientSecret || !config.tenantId) {
    console.warn('Microsoft Graph credentials not configured. Email notifications disabled.');
    return null;
  }

  try {
    const credential = new ClientSecretCredential(
      config.tenantId,
      config.clientId,
      config.clientSecret
    );

    const authProvider = new TokenCredentialAuthenticationProvider(credential, {
      scopes: ['https://graph.microsoft.com/.default']
    });

    graphClient = Client.initWithMiddleware({
      authProvider: authProvider
    });

    return graphClient;
  } catch (error) {
    console.error('Failed to initialise Graph client:', error.message);
    return null;
  }
}

/**
 * Send an email via Microsoft Graph API
 */
async function sendEmail(subject, htmlBody, textBody) {
  const client = getGraphClient();

  if (!client) {
    console.log('Email service not configured, skipping notification');
    return { success: false, reason: 'not_configured' };
  }

  if (!config.senderEmail || !config.notifyEmail) {
    console.warn('Sender or recipient email not configured');
    return { success: false, reason: 'missing_emails' };
  }

  try {
    const message = {
      subject: subject,
      body: {
        contentType: 'HTML',
        content: htmlBody
      },
      toRecipients: [
        {
          emailAddress: {
            address: config.notifyEmail
          }
        }
      ]
    };

    await client.api(`/users/${config.senderEmail}/sendMail`).post({
      message: message,
      saveToSentItems: false
    });

    console.log(`Email sent: ${subject}`);
    return { success: true };
  } catch (error) {
    console.error('Failed to send email:', error.message);
    return { success: false, reason: error.message };
  }
}

/**
 * Send notification for new website visitor
 */
async function sendNewVisitorNotification(visitor) {
  const subject = `New Website Visitor - ${visitor.entry_page || 'Unknown page'}`;

  const referrerText = visitor.referrer
    ? `<p><strong>Referrer:</strong> ${visitor.referrer}</p>`
    : '<p><strong>Referrer:</strong> Direct visit</p>';

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #091825; color: white; padding: 20px; border-bottom: 3px solid #FF9F1C;">
        <h1 style="margin: 0; font-size: 20px;">New Website Visitor</h1>
      </div>
      <div style="padding: 24px; background: #f8fafc; border: 1px solid #e5e7eb;">
        <p style="margin: 0 0 12px 0;"><strong>Entry Page:</strong> <a href="${visitor.entry_page || '#'}" style="color: #034674;">${visitor.entry_page || 'Unknown'}</a></p>
        ${referrerText}
        <p style="margin: 0 0 12px 0;"><strong>Device:</strong> ${visitor.device_type || 'Unknown'}</p>
        <p style="margin: 0 0 12px 0;"><strong>Time:</strong> ${new Date(visitor.first_seen).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        <p style="margin: 0;"><strong>Journey ID:</strong> <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px;">${visitor.journey_id}</code></p>
      </div>
      <div style="padding: 16px; background: white; border: 1px solid #e5e7eb; border-top: none; text-align: center;">
        <a href="${process.env.APP_URL || 'http://localhost:3000'}/realtime" style="display: inline-block; background: linear-gradient(135deg, #FF9F1C 0%, #E88A00 100%); color: white; padding: 10px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">View Real-time Dashboard</a>
      </div>
    </div>
  `;

  const textBody = `
New Website Visitor

Entry Page: ${visitor.entry_page || 'Unknown'}
Referrer: ${visitor.referrer || 'Direct visit'}
Device: ${visitor.device_type || 'Unknown'}
Time: ${new Date(visitor.first_seen).toLocaleString('en-GB')}
Journey ID: ${visitor.journey_id}

View dashboard: ${process.env.APP_URL || 'http://localhost:3000'}/realtime
  `;

  return sendEmail(subject, htmlBody, textBody);
}

/**
 * Check if email service is configured
 */
function isConfigured() {
  return !!(config.clientId && config.clientSecret && config.tenantId && config.senderEmail && config.notifyEmail);
}

module.exports = {
  sendEmail,
  sendNewVisitorNotification,
  isConfigured
};
