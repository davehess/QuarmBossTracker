Privacy Policy
Quarm Raid Timer Bot
Effective Date: April 21, 2025  •  Last Updated: April 21, 2025

1. Overview
This Privacy Policy describes how the Quarm Raid Timer Bot (“Bot,” “we,” or “our”) handles information when you use the Bot in your Discord server. We are committed to being transparent about what limited data the Bot processes and why.
The Bot is a free, community utility tool. It is not a commercial product and does not monetize user data in any way. We collect only the minimum information necessary for the Bot to function.

2. Who This Policy Applies To
This policy applies to all Discord users who interact with the Bot, including:
•	Guild members who use slash commands such as /kill, /unkill, or /timers
•	Users who click buttons on the boss board posted by the Bot
•	Server administrators who deploy and configure the Bot
By using the Bot, you acknowledge that you have read and understood this Privacy Policy.

3. Information We Collect
3.1 Information Collected Automatically
When you interact with the Bot, the following data is automatically processed:
•	Discord User ID — A numeric identifier assigned by Discord. This is collected when you record a boss kill and is stored alongside the kill record for attribution purposes (e.g., “Killed by @Username”).
•	Interaction timestamps — The date and time at which a /kill command or button interaction is submitted. This is used to calculate next spawn times.
•	Command input data — The boss ID selected when recording a kill. This is used to update the spawn timer state.
3.2 Information We Do Not Collect
The Bot does not collect, store, or process any of the following:
•	Real names, email addresses, or contact information
•	IP addresses or device identifiers
•	Message content from general Discord conversations (the Bot only reads slash command interactions directed at it)
•	Payment or financial information of any kind
•	Location data
•	Any data from users who do not directly interact with Bot commands

4. How We Use Your Information
The limited data we collect is used exclusively for the following purposes:
•	Spawn timer calculation — Kill timestamps are used to compute when a boss will next respawn based on known timer values from PQDI.cc.
•	Kill attribution — Discord User IDs are displayed in kill confirmation embeds so guild members can see who recorded a kill. This is a transparency feature for guild leadership.
•	Notification delivery — Spawn alerts are posted to the designated guild channel when a timer expires. No personal data is included in these notifications.
We do not use your data for advertising, profiling, analytics, or any purpose beyond direct Bot functionality.

5. Data Storage and Retention
5.1 Where Data Is Stored
Kill state data (boss ID, kill timestamp, next spawn timestamp, and the Discord User ID of whoever recorded the kill) is stored in a local JSON file on the server or hosting environment where the Bot is deployed. This file is not transmitted to any external service or third party.
5.2 How Long Data Is Retained
Kill records persist until one of the following occurs:
•	A new kill is recorded for the same boss, overwriting the previous entry
•	The /unkill command is used to manually clear a record
•	The Bot operator deletes or resets the state file
•	The Bot is uninstalled or its hosting environment is terminated
There is no automatic expiration of kill records. Data is stored only as long as it is operationally relevant to the Bot’s function.
5.3 Security
The Bot operator takes reasonable precautions to protect stored data, including restricting access to the hosting environment. However, as a community-operated tool, we cannot guarantee enterprise-grade security. Users should be aware that Discord User IDs are semi-public identifiers already visible within Discord’s platform.

6. Data Sharing and Disclosure
We do not sell, rent, trade, or share your data with third parties for commercial purposes. Your data may be disclosed only in the following limited circumstances:
•	Within your Discord server — Kill records including your Discord User ID are visible to other members of the server in kill confirmation messages. This is a core feature of the Bot and is necessary for guild coordination.
•	Legal requirements — If required by applicable law, regulation, or valid legal process, we may disclose data as necessary to comply with such obligations.
•	Service operation — The Bot interacts with Discord’s API to function. Discord’s own Privacy Policy (discord.com/privacy) governs how Discord handles data on their platform.

7. Third-Party Services
The Bot operates within and depends on the following third-party platforms. Their respective privacy policies govern data handling on their platforms:
•	Discord Inc. — discord.com/privacy — All Bot interactions occur through Discord’s platform. Discord processes interaction data according to their own policies.
•	PQDI.cc — Spawn timer data is read from this public database. The Bot does not transmit user data to PQDI.cc.
•	Hosting provider — The server or platform hosting the Bot (e.g., Railway, a personal VPS, or Docker environment) may log operational data such as process output. Refer to your hosting provider’s privacy policy for details.
The Operator is not responsible for the privacy practices of any third-party service.

8. Your Rights and Choices
Depending on your jurisdiction, you may have rights regarding your personal data. As a practical matter, the only personal data the Bot stores about you is your Discord User ID tied to kill records you submitted. You may exercise the following options:
•	Request deletion — Contact the guild administrator operating the Bot to request removal of kill records associated with your Discord User ID. Records can be cleared using the /unkill command or by direct deletion from the state file.
•	Stop using the Bot — You can stop interacting with Bot commands at any time. The Bot does not collect data from users who do not interact with it.
•	Request a copy — You may request a summary of any data stored under your Discord User ID by contacting the guild administrator.
Because Discord User IDs are platform identifiers rather than directly identifying personal information in most jurisdictions, the Bot’s data handling falls outside the scope of most consumer privacy regulations. However, we honor reasonable data requests in good faith.

9. Children’s Privacy
The Bot is not directed at children under the age of 13, consistent with Discord’s own minimum age requirement. We do not knowingly collect data from users under 13. If you believe a minor has used the Bot, please contact the guild administrator to have any associated records removed.

10. Changes to This Policy
We may update this Privacy Policy from time to time. When we do, we will update the “Last Updated” date at the top of this document. Continued use of the Bot following any update constitutes acceptance of the revised policy. We encourage you to review this policy periodically.

11. Contact
This Bot is operated as a free community utility. For privacy-related questions, data deletion requests, or other inquiries, please contact the guild administrator who deployed this Bot instance in your Discord server.
This Privacy Policy applies solely to data processed by the Bot itself. It does not govern any other services, websites, or applications operated by the guild or its members.

