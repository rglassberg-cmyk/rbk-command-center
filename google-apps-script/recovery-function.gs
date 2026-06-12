/**
 * ONE-TIME RECOVERY: Re-send emails from the last 3 days that were labeled
 * but never made it to the Command Center (due to Vercel being down).
 *
 * IMPORTANT: Make sure commandCenterWebhookUrl is updated to Firebase first!
 * Run this ONCE, then delete it.
 */
function recoverMissedEmails() {
  var config = getPrincipalTriageConfig();

  if (config.commandCenterWebhookUrl.indexOf('vercel.app') !== -1) {
    Logger.log('ERROR: Webhook URL still points to Vercel! Update it to https://rbk-cmd-center.web.app/api/webhook/email first.');
    return;
  }

  Logger.log('Starting recovery of missed emails...');
  Logger.log('Webhook URL: ' + config.commandCenterWebhookUrl);

  var triageLabels = ['RBK Action Item', 'EG Action Item', 'Review', 'FYI', 'Invitation', 'Meeting Invite', 'Important - No Action'];
  var labelToPriority = {
    'RBK Action Item': 'rbk_action',
    'EG Action Item': 'eg_action',
    'Review': 'review',
    'FYI': 'fyi',
    'Invitation': 'invitation',
    'Meeting Invite': 'meeting_invite',
    'Important - No Action': 'important_no_action'
  };

  var stats = { found: 0, sent: 0, errors: 0 };
  var threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  for (var i = 0; i < triageLabels.length; i++) {
    var labelName = triageLabels[i];
    var label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      Logger.log('Label not found: ' + labelName);
      continue;
    }

    var threads = label.getThreads(0, 100);

    for (var j = 0; j < threads.length; j++) {
      var messages = threads[j].getMessages();
      var lastMessage = messages[messages.length - 1];
      var messageDate = lastMessage.getDate();

      if (messageDate < threeDaysAgo) {
        continue;
      }

      stats.found++;
      var subject = lastMessage.getSubject();
      var priority = labelToPriority[labelName];

      Logger.log('Processing: "' + subject + '" (' + priority + ')');

      var emailData = {
        from: lastMessage.getFrom(),
        subject: subject,
        body: lastMessage.getPlainBody().substring(0, 8000),
        to: lastMessage.getTo(),
        cc: lastMessage.getCc(),
        id: lastMessage.getId(),
        threadId: threads[j].getId(),
        date: messageDate
      };

      try {
        var aiAnalysis = analyzePrincipalEmail(emailData, config);

        var assignedTo = 'rbk';
        if (priority === 'eg_action') {
          assignedTo = 'emily';
        }

        var analysis = {
          priority: priority,
          category: aiAnalysis.category,
          summary: aiAnalysis.summary,
          action_needed: aiAnalysis.action_needed,
          draft_reply: aiAnalysis.draft_reply,
          assigned_to: assignedTo
        };

        sendToCommandCenter(emailData, analysis, config);
        stats.sent++;
        Logger.log('  -> Sent successfully');

        if (j < threads.length - 1) {
          Utilities.sleep(1000);
        }
      } catch (e) {
        Logger.log('  -> ERROR: ' + e.toString());
        stats.errors++;
      }
    }
  }

  Logger.log('');
  Logger.log('=== RECOVERY COMPLETE ===');
  Logger.log('Found: ' + stats.found);
  Logger.log('Sent: ' + stats.sent);
  Logger.log('Errors: ' + stats.errors);
  Logger.log('');
  Logger.log('You can delete this function now.');
}
