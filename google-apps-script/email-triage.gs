/**
 * Principal Email Triage System - v2.5 (RBK Command Center)
 *
 * Changes from v2.4:
 * - Updated to send to RBK Command Center instead of Zapier
 * - Webhook URL: https://rbk-command-center.vercel.app/api/webhook/email
 *
 * Features preserved:
 * - STAR RULE: Starred emails = RBK Action (New emails only)
 * - BACKLOG PROTECTION: Only applies to emails after Jan 9, 2026
 * - VIP Sender Hierarchy (RBK Action)
 * - Personal Account Protection (TD.com -> RBK)
 * - Attachment Routing (Invoices/ICS -> EG Action)
 * - AI-generated summaries and draft replies
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

function getPrincipalTriageConfig() {
  var scriptProperties = PropertiesService.getScriptProperties();
  return {
    openaiApiKey: scriptProperties.getProperty('OPENAI_API_KEY'),
    // NEW: RBK Command Center webhook (replaces Zapier)
    commandCenterWebhookUrl: 'https://rbk-command-center.vercel.app/api/webhook/email',
    webhookSecret: scriptProperties.getProperty('WEBHOOK_SECRET'),
    principalEmail: 'kraussb@saracademy.org',
    assistantEmail: scriptProperties.getProperty('ASSISTANT_EMAIL') || 'egray@saracademy.org',
    openaiModel: scriptProperties.getProperty('OPENAI_MODEL') || 'gpt-4o-mini',
    maxEmailsPerRun: parseInt(scriptProperties.getProperty('MAX_EMAILS_PER_RUN') || '50'),
    // Only apply the Star Rule to emails received after this specific time
    activationDate: new Date('January 9, 2026 12:00:00 EST')
  };
}

// ============================================================================
// MAIN TRIAGE FUNCTION
// ============================================================================

function triagePrincipalEmails() {
  var config = getPrincipalTriageConfig();

  if (!config.openaiApiKey || !config.principalEmail) {
    Logger.log('ERROR: Configuration missing');
    return;
  }

  if (!config.webhookSecret) {
    Logger.log('ERROR: WEBHOOK_SECRET not configured in Script Properties');
    return;
  }

  Logger.log('Starting triage (v2.5 - RBK Command Center)...');
  Logger.log('DEBUG: Script running as: ' + Session.getActiveUser().getEmail());
  Logger.log('DEBUG: Principal email: ' + config.principalEmail);
  var emails = getUnlabeledPrincipalEmails(config);

  if (emails.length === 0) {
    Logger.log('No emails to process');
    return;
  }

  var stats = { processed: 0, rbk_action: 0, eg_action: 0, review: 0, fyi: 0, invitation: 0, meeting_invite: 0, important_no_action: 0, errors: 0, sent_to_dashboard: 0 };

  for (var i = 0; i < emails.length; i++) {
    try {
      var result = processPrincipalEmail(emails[i], config);
      stats.processed++;
      if (stats.hasOwnProperty(result.priority)) {
        stats[result.priority]++;
      }
      if (result.sentToDashboard) {
        stats.sent_to_dashboard++;
      }
      if (i < emails.length - 1) Utilities.sleep(500);
    } catch (e) {
      Logger.log('Error processing email: ' + e.toString());
      stats.errors++;
    }
  }

  Logger.log('Triage complete. Stats: ' + JSON.stringify(stats));
}

function getUnlabeledPrincipalEmails(config) {
  // Search for all emails without triage labels (regardless of read/unread status)
  // Using 30d window and searching both To: and CC: fields, limited to inbox
  var searchQuery = 'in:inbox (to:' + config.principalEmail + ' OR cc:' + config.principalEmail + ') newer_than:30d ' +
                    '-label:"RBK Action Item" -label:"EG Action Item" ' +
                    '-label:"Review" -label:"FYI" -label:"Invitation" ' +
                    '-label:"Meeting Invite" -label:"Important - No Action" ' +
                    '-from:notifications@monday.com ' +
                    '-subject:"Helpdesk Kiosk Ticket" -subject:"Ticket Created"';

  Logger.log('DEBUG: Search query: ' + searchQuery);
  var threads = GmailApp.search(searchQuery, 0, config.maxEmailsPerRun);
  Logger.log('DEBUG: Search found ' + threads.length + ' threads');
  var emails = [];

  for (var i = 0; i < threads.length; i++) {
    var messages = threads[i].getMessages();
    var lastMessage = messages[messages.length - 1];
    var subject = lastMessage.getSubject();

    Logger.log('DEBUG: Checking thread: "' + subject + '"');

    // Blacklist check
    var from = lastMessage.getFrom().toLowerCase();
    var subjectLower = subject.toLowerCase();
    if (from.includes('techsupport@saracademy.org') && (subjectLower.includes('ticket created') || subjectLower.includes('kiosk'))) {
      Logger.log('DEBUG: Skipped (blacklist): ' + subject);
      continue;
    }

    if (!hasPrincipalTriageLabel(lastMessage)) {
      Logger.log('DEBUG: Added to queue: ' + subject);
      emails.push(lastMessage);
    } else {
      var labels = lastMessage.getThread().getLabels().map(function(l) { return l.getName(); }).join(', ');
      Logger.log('DEBUG: Skipped (has labels): ' + subject + ' [' + labels + ']');
    }
  }
  return emails;
}

function hasPrincipalTriageLabel(message) {
  var labels = message.getThread().getLabels();
  var triageLabels = ['RBK Action Item', 'EG Action Item', 'Review', 'FYI', 'Invitation', 'Meeting Invite', 'Important - No Action'];
  return labels.some(l => triageLabels.includes(l.getName()));
}

// ============================================================================
// PRE-FILTERING RULES (RESTORED FROM v2.2)
// ============================================================================

function applyPreFilters(emailData, config, message) {
  var fromEmail = emailData.from.toLowerCase();
  var subject = emailData.subject.toLowerCase();
  var emailDate = message.getDate();
  var thread = message.getThread();
  var messagesInThread = thread.getMessages();

  // 1. STAR RULE (With New Email Protection)
  // Only triggers if the email is starred AND was received after the script activation date
  if (message.isStarred() && emailDate > config.activationDate) {
    Logger.log('Pre-filter: New starred message -> rbk_action');
    return 'rbk_action';
  }

  // 2. VIP SENDER HIERARCHY
  var vips = [
    'sjabbour@saracademy.org', 'debra@saracademy.org', 'omuschel@saracademy.org',
    'rnagata@saracademy.org', 'bpepper@saracademy.org', 'srichter@saracademy.org',
    'mrothwax@saracademy.org', 'nfadda@saracademy.org', 'shana.krauss@kirkland.com',
    'gailbendheim@gmail.com', 'jcb@pahc.com', 'aeisenstat@ecaplp.com'
  ];
  if (vips.some(vip => fromEmail.includes(vip))) {
    Logger.log('Pre-filter: VIP sender -> rbk_action');
    return 'rbk_action';
  }

  // 3. PERSONAL ACCOUNT PROTECTION (TD Bank)
  if (fromEmail.includes('td.com')) {
    Logger.log('Pre-filter: Personal account -> rbk_action');
    return 'rbk_action';
  }

  // 4. THREAD PARTICIPATION
  if (messagesInThread.length > 1) {
    for (var i = 0; i < messagesInThread.length; i++) {
      if (messagesInThread[i].getFrom().includes(config.principalEmail)) {
        Logger.log('Pre-filter: Thread participation -> rbk_action');
        return 'rbk_action';
      }
    }
  }

  // 5. ATTACHMENT LOGIC (Invoices/Invites)
  var attachments = message.getAttachments();
  for (var j = 0; j < attachments.length; j++) {
    var type = attachments[j].getContentType();
    var name = attachments[j].getName().toLowerCase();
    if (type.indexOf('calendar') !== -1 || name.endsWith('.ics')) {
      Logger.log('Pre-filter: Calendar attachment -> meeting_invite');
      return 'meeting_invite';
    }
    if (name.endsWith('.pdf') && (name.includes('invoice') || name.includes('statement') || name.includes('bill'))) {
      Logger.log('Pre-filter: Invoice attachment -> eg_action');
      return 'eg_action';
    }
  }

  // 6. TECH SUPPORT REPLIES
  if (fromEmail.includes('techsupport@saracademy.org') && subject.startsWith('re:')) {
    Logger.log('Pre-filter: Tech support reply -> rbk_action');
    return 'rbk_action';
  }

  // 7. VERACROSS STUDENT COMMENT NOTIFICATIONS (Must come BEFORE general Veracross rule)
  if (subject.indexOf('sar Veracross: Internal Student Comment Notification') !== -1) {
    Logger.log('Pre-filter: Veracross student comment -> important_no_action');
    return 'important_no_action';
  }

  // 8. CALENDAR NOTIFICATION EMAILS
  var calendarSenders = ['calendar-notification@google.com', 'calendar-notification@saracademy.org', 'calendar@google.com'];
  for (var k = 0; k < calendarSenders.length; k++) {
    if (fromEmail.includes(calendarSenders[k])) {
      Logger.log('Pre-filter: Calendar notification -> meeting_invite');
      return 'meeting_invite';
    }
  }

  // 9. ZOOM MEETING INVITES
  if ((fromEmail.includes('zoom.us') || fromEmail.includes('zoom.com')) &&
      (subject.indexOf('invite') !== -1 || subject.indexOf('meeting') !== -1 || subject.indexOf('scheduled') !== -1)) {
    Logger.log('Pre-filter: Zoom meeting -> meeting_invite');
    return 'meeting_invite';
  }

  // 10. MICROSOFT TEAMS MEETING INVITES
  if (fromEmail.includes('microsoft.com') && subject.indexOf('meeting') !== -1) {
    Logger.log('Pre-filter: Teams meeting -> meeting_invite');
    return 'meeting_invite';
  }

  // 11. TRAVEL & RESERVATION CONFIRMATIONS
  var travelSenders = ['jetblue.com', 'delta.com', 'united.com', 'american.com', 'southwest.com',
                       'booking.com', 'hotels.com', 'airbnb.com', 'expedia.com', 'kayak.com',
                       'opentable.com', 'resy.com', 'ubereats.com', 'doordash.com'];
  for (var m = 0; m < travelSenders.length; m++) {
    if (fromEmail.includes(travelSenders[m])) {
      if (subject.indexOf('confirmation') !== -1 || subject.indexOf('receipt') !== -1 ||
          subject.indexOf('itinerary') !== -1 || subject.indexOf('reservation') !== -1 ||
          subject.indexOf('booking') !== -1) {
        Logger.log('Pre-filter: Travel/reservation confirmation -> important_no_action');
        return 'important_no_action';
      }
    }
  }

  // 12. RECEIPT/INVOICE EMAILS
  if ((subject.indexOf('receipt') !== -1 || subject.indexOf('invoice') !== -1) && fromEmail.indexOf('@') !== -1) {
    var domain = fromEmail.split('@')[1].toLowerCase();
    if (domain.indexOf('marketing') === -1 && domain.indexOf('promo') === -1 && domain.indexOf('newsletter') === -1) {
      Logger.log('Pre-filter: Receipt/invoice -> important_no_action');
      return 'important_no_action';
    }
  }

  // 13. STANDARD FYI RULES (General Veracross emails - after specific student comments)
  if (fromEmail.includes('.veracross.com') || subject.includes('hamakom') || subject.startsWith('fyi:')) {
    Logger.log('Pre-filter: Standard FYI -> fyi');
    return 'fyi';
  }

  return null; // Proceed to AI if no pre-filter matches
}

// ============================================================================
// EMAIL PROCESSING & AI
// ============================================================================

function processPrincipalEmail(message, config) {
  var emailData = {
    from: message.getFrom(),
    subject: message.getSubject(),
    body: message.getPlainBody().substring(0, 8000),
    to: message.getTo(),
    cc: message.getCc(),
    id: message.getId(),
    threadId: message.getThread().getId(),
    date: message.getDate()
  };

  // Step 1: Check pre-filter rules
  var preFilteredPriority = applyPreFilters(emailData, config, message);

  // Step 2: ALWAYS run AI analysis to get summary, draft, and action_needed
  // (Even for VIP emails, we want the AI to generate helpful summaries and drafts)
  var aiAnalysis = analyzePrincipalEmail(emailData, config);

  // Step 3: Combine results - use pre-filter priority if it exists, otherwise use AI priority
  var finalPriority = preFilteredPriority || aiAnalysis.priority;

  // FIXED: Correct assigned_to logic for all priorities
  var finalAssignedTo = 'rbk'; // default
  if (finalPriority === 'eg_action') {
    finalAssignedTo = 'emily';
  } else if (finalPriority === 'rbk_action') {
    finalAssignedTo = 'rbk';
  } else if (finalPriority === 'meeting_invite' || finalPriority === 'important_no_action') {
    // Meeting invites and important_no_action are for RBK to see
    finalAssignedTo = 'rbk';
  } else {
    // For fyi, review, invitation - use AI's suggestion
    finalAssignedTo = aiAnalysis.assigned_to || 'rbk';
  }

  var analysis = {
    priority: finalPriority,
    category: preFilteredPriority ? 'pre-filtered' : aiAnalysis.category,
    summary: aiAnalysis.summary,
    action_needed: aiAnalysis.action_needed,
    draft_reply: aiAnalysis.draft_reply,
    assigned_to: finalAssignedTo
  };

  Logger.log('Final analysis for "' + emailData.subject + '": ' + analysis.priority + ' (assigned to: ' + analysis.assigned_to + ')');

  // Step 4: Apply Gmail label
  applyPrincipalLabel(message, analysis.priority);

  // Step 5: Send ALL emails to RBK Command Center (not just action items like Zapier)
  var sentToDashboard = false;
  if (config.commandCenterWebhookUrl && config.webhookSecret) {
    sendToCommandCenter(emailData, analysis, config);
    sentToDashboard = true;
    Logger.log('Sent to RBK Command Center: ' + analysis.priority);
  }

  return {
    priority: analysis.priority,
    sentToDashboard: sentToDashboard
  };
}

function analyzePrincipalEmail(emailData, config) {
  var prompt = buildPrincipalTriagePrompt(emailData);
  var options = {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + config.openaiApiKey, 'Content-Type': 'application/json' },
    payload: JSON.stringify({
      model: config.openaiModel,
      messages: [
        { role: 'system', content: 'You are an executive triage assistant for Principal RBK. Be concise and professional.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2
    }),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch('https://api.openai.com/v1/chat/completions', options);
    var result = JSON.parse(response.getContentText());
    return parsePrincipalAIResponse(result.choices[0].message.content);
  } catch (e) {
    Logger.log('AI Error: ' + e.toString());
    return {
      priority: 'rbk_action',
      category: 'error',
      summary: 'AI analysis failed - requires manual review',
      action_needed: 'Review email content',
      draft_reply: '',
      assigned_to: 'rbk'
    };
  }
}

function buildPrincipalTriagePrompt(emailData) {
  return 'Analyze this email for Principal RBK and his assistant Emily:\n\n' +
         'From: ' + emailData.from + '\n' +
         'Subject: ' + emailData.subject + '\n' +
         'Body: ' + emailData.body + '\n\n' +
         'Categorization Rules:\n' +
         '- rbk_action: Strategic decisions, VIP requests, personal matters, urgent parent issues requiring principal response\n' +
         '- eg_action: Scheduling requests, routine parent questions, vendor inquiries, administrative tasks Emily can handle\n' +
         '- invitation: Bar/bat mitzvah, wedding, bris, political event, or conference invitation (NOT calendar meeting requests)\n' +
         '- meeting_invite: Calendar meeting requests, Zoom invites, scheduled calls, internal meetings with .ics attachments\n' +
         '- important_no_action: RBK MUST read this but no response needed (e.g., play run-of-show, policy updates, board reports)\n' +
         '- review: Documents/reports requiring thoughtful review when time permits (e.g., curriculum proposals, grant applications)\n' +
         '- fyi: Pure informational, automated notifications, newsletters, general announcements\n\n' +
         'CRITICAL: EVERY email must be categorized. If uncertain, default to important_no_action.\n\n' +
         'Provide ALL fields in this EXACT format:\n\n' +
         'priority: [rbk_action/eg_action/invitation/meeting_invite/important_no_action/review/fyi]\n' +
         'category: [brief category name]\n' +
         'summary: [One sentence summary - be specific and actionable]\n' +
         'action_needed: [Very brief action, or "No action needed" if read-only]\n' +
         'draft_reply: [Write a professional draft reply from RBK. If no reply needed, write "No reply needed"]\n' +
         'assigned_to: [rbk or emily]';
}

function parsePrincipalAIResponse(aiResponse) {
  var analysis = {
    priority: 'rbk_action',
    category: 'other',
    summary: 'Email received',
    action_needed: 'Review email',
    draft_reply: '',
    assigned_to: 'rbk'
  };

  var lines = aiResponse.split('\n');
  var currentField = null;
  var draftLines = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();

    if (line.toLowerCase().startsWith('priority:')) {
      analysis.priority = line.split(':')[1].trim().toLowerCase().replace(/ /g, '_');
      currentField = null;
    }
    else if (line.toLowerCase().startsWith('category:')) {
      analysis.category = line.split(':')[1].trim();
      currentField = null;
    }
    else if (line.toLowerCase().startsWith('summary:')) {
      analysis.summary = line.substring(line.indexOf(':') + 1).trim();
      currentField = null;
    }
    else if (line.toLowerCase().startsWith('action_needed:')) {
      analysis.action_needed = line.substring(line.indexOf(':') + 1).trim();
      currentField = null;
    }
    else if (line.toLowerCase().startsWith('assigned_to:')) {
      analysis.assigned_to = line.split(':')[1].trim().toLowerCase();
      currentField = null;
    }
    else if (line.toLowerCase().startsWith('draft_reply:')) {
      var draftStart = line.substring(line.indexOf(':') + 1).trim();
      if (draftStart) draftLines.push(draftStart);
      currentField = 'draft_reply';
    }
    else if (currentField === 'draft_reply' && line) {
      draftLines.push(line);
    }
  }

  if (draftLines.length > 0) {
    analysis.draft_reply = draftLines.join('\n');
  }

  return analysis;
}

function applyPrincipalLabel(message, priority) {
  var labelMap = {
    'rbk_action': 'RBK Action Item',
    'eg_action': 'EG Action Item',
    'review': 'Review',
    'fyi': 'FYI',
    'invitation': 'Invitation',
    'meeting_invite': 'Meeting Invite',
    'important_no_action': 'Important - No Action'
  };
  var labelName = labelMap[priority] || 'RBK Action Item';
  var label = GmailApp.getUserLabelByName(labelName) || GmailApp.createLabel(labelName);
  message.getThread().addLabel(label);
}

// ============================================================================
// SEND TO RBK COMMAND CENTER (Replaces Zapier)
// ============================================================================

function sendToCommandCenter(emailData, analysis, config) {
  var payload = {
    // Required fields for RBK Command Center webhook
    message_id: emailData.id,
    thread_id: emailData.threadId,
    from: emailData.from,
    to: emailData.to,
    subject: emailData.subject,
    body: emailData.body,
    date: emailData.date.toISOString(),
    priority: analysis.priority,
    category: analysis.category,
    summary: analysis.summary,
    action_needed: analysis.action_needed,
    draft_reply: analysis.draft_reply,
    assigned_to: analysis.assigned_to
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + config.webhookSecret
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(config.commandCenterWebhookUrl, options);
    var responseCode = response.getResponseCode();
    var responseBody = response.getContentText();

    if (responseCode === 200) {
      Logger.log('Successfully sent to Command Center: ' + emailData.subject);
    } else if (responseCode === 401) {
      Logger.log('ERROR: Unauthorized - check WEBHOOK_SECRET in Script Properties');
    } else {
      Logger.log('ERROR: Command Center returned ' + responseCode + ': ' + responseBody);
    }

    return responseCode === 200;
  } catch (e) {
    Logger.log('ERROR sending to Command Center: ' + e.toString());
    return false;
  }
}

// ============================================================================
// TEST FUNCTION - Run this to verify webhook connection
// ============================================================================

function testCommandCenterConnection() {
  var config = getPrincipalTriageConfig();

  if (!config.webhookSecret) {
    Logger.log('ERROR: WEBHOOK_SECRET not set in Script Properties');
    Logger.log('Go to Project Settings (gear icon) -> Script Properties -> Add:');
    Logger.log('  Property: WEBHOOK_SECRET');
    Logger.log('  Value: BTQX/b8S9P/cFVE0qPIETtLv5vhD2iJSjMg8BaOYE/I=');
    return;
  }

  Logger.log('Testing connection to RBK Command Center...');
  Logger.log('Webhook URL: ' + config.commandCenterWebhookUrl);

  var testPayload = {
    message_id: 'test-' + new Date().getTime(),
    thread_id: 'test-thread-' + new Date().getTime(),
    from: 'Apps Script Test <test@saracademy.org>',
    to: 'kraussb@saracademy.org',
    subject: 'Test Email from Apps Script - ' + new Date().toLocaleString(),
    body: 'This is a test email to verify the Apps Script -> Command Center connection is working.',
    date: new Date().toISOString(),
    priority: 'fyi',
    category: 'test',
    summary: 'Test email to verify webhook connection',
    action_needed: 'None - this is a test',
    draft_reply: 'No reply needed - test email',
    assigned_to: 'emily'
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + config.webhookSecret
    },
    payload: JSON.stringify(testPayload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(config.commandCenterWebhookUrl, options);
    var responseCode = response.getResponseCode();
    var responseBody = response.getContentText();

    Logger.log('Response Code: ' + responseCode);
    Logger.log('Response Body: ' + responseBody);

    if (responseCode === 200) {
      Logger.log('SUCCESS! Connection to RBK Command Center is working.');
      Logger.log('Check your dashboard at https://rbk-command-center.vercel.app to see the test email.');
    } else if (responseCode === 401) {
      Logger.log('ERROR: Unauthorized. Your WEBHOOK_SECRET does not match.');
      Logger.log('Make sure WEBHOOK_SECRET in Script Properties matches the one in Vercel.');
    } else {
      Logger.log('ERROR: Unexpected response. Check the response body above.');
    }
  } catch (e) {
    Logger.log('ERROR: ' + e.toString());
  }
}

// ============================================================================
// TRIGGER MANAGEMENT
// ============================================================================

function createPrincipalTriageTrigger() {
  deletePrincipalTriageTrigger();
  ScriptApp.newTrigger('triagePrincipalEmails').timeBased().everyMinutes(15).create();
  Logger.log('Trigger created: runs every 15 minutes');
}

function deletePrincipalTriageTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === 'triagePrincipalEmails') {
      ScriptApp.deleteTrigger(t);
    }
  });
  Logger.log('Existing triggers deleted');
}

// ============================================================================
// SETUP INSTRUCTIONS
// ============================================================================

/**
 * SETUP STEPS:
 *
 * 1. Go to Project Settings (gear icon on left sidebar)
 *
 * 2. Scroll down to "Script Properties" and click "Add Script Property"
 *
 * 3. Add these properties:
 *    - OPENAI_API_KEY: your OpenAI API key
 *    - WEBHOOK_SECRET: BTQX/b8S9P/cFVE0qPIETtLv5vhD2iJSjMg8BaOYE/I=
 *    - ASSISTANT_EMAIL: egray@saracademy.org
 *    - OPENAI_MODEL: gpt-4o-mini (optional, this is the default)
 *    - MAX_EMAILS_PER_RUN: 50 (optional, this is the default)
 *
 * 4. Run testCommandCenterConnection() to verify the webhook works
 *
 * 5. Run createPrincipalTriageTrigger() to start automatic processing
 *
 * NOTE: You can remove ZAPIER_WEBHOOK_URL from Script Properties - it's no longer used.
 */
